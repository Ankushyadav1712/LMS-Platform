import "dotenv/config";
import { writeFileSync } from "node:fs";

import { db } from "../../src/lib/db";

/** Captures EXPLAIN (ANALYZE, BUFFERS) for each query shape into a markdown doc. */

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const list = (xs: string[]) => xs.map(lit).join(",");

async function explain(sql: string): Promise<string> {
  const rows = await db.$queryRawUnsafe<Record<string, string>[]>(
    `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
  );
  return rows.map((r) => Object.values(r)[0]).join("\n");
}

/** Median execution+planning time reported by EXPLAIN, over n runs. */
async function timed(sql: string, n = 5) {
  const totals: number[] = [];
  let plan = "";
  for (let i = 0; i < n; i++) {
    plan = await explain(sql);
    const exec = Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? 0);
    const planning = Number(/Planning Time: ([\d.]+) ms/.exec(plan)?.[1] ?? 0);
    totals.push(exec + planning);
  }
  totals.sort((a, b) => a - b);
  return { plan, ms: totals[Math.floor(totals.length / 2)] };
}

const out: string[] = [];
const section = (t: string) => out.push(`\n## ${t}\n`);
const block = (label: string, ms: number, plan: string) =>
  out.push(
    `**${label}** — ${ms.toFixed(2)} ms (planning + execution, median of 5)\n`,
    "```",
    plan,
    "```",
    "",
  );

async function main() {
  const course = (
    await db.course.findMany({
      where: { assignments: { some: {} } },
      select: { id: true, title: true, _count: { select: { enrollments: true } } },
      orderBy: { enrollments: { _count: "desc" } },
      take: 1,
    })
  )[0];
  const enrollments = await db.enrollment.findMany({
    where: { courseId: course.id, status: { not: "DROPPED" } },
    select: { studentId: true },
  });
  const studentIds = enrollments.map((e) => e.studentId);
  const assignmentIds = (
    await db.assignment.findMany({ where: { courseId: course.id }, select: { id: true } })
  ).map((a) => a.id);

  const dbCounts = await db.$queryRaw<{ t: string; n: bigint }[]>`
    SELECT 'users' AS t, count(*) AS n FROM users
    UNION ALL SELECT 'courses', count(*) FROM courses
    UNION ALL SELECT 'lectures', count(*) FROM lectures
    UNION ALL SELECT 'enrollments', count(*) FROM enrollments
    UNION ALL SELECT 'submissions', count(*) FROM submissions
    UNION ALL SELECT 'grades', count(*) FROM grades
    UNION ALL SELECT 'lecture_progress', count(*) FROM lecture_progress
    ORDER BY 1`;

  out.push(
    "# Week 12 — query plans, before and after",
    "",
    "Captured with `EXPLAIN (ANALYZE, BUFFERS)` against the benchmark dataset",
    "(`pnpm db:seed:load`), warm cache, median of 5 runs. The demo seed is far too",
    "small to plan realistically — Postgres sequentially scans a 6-row table no",
    "matter how it is indexed, so every number here comes from the load seed.",
    "",
    "**How to read these numbers.** No query on any of these paths exceeded 50 ms even",
    "before the fix; total DB time per page was single-digit milliseconds. These are",
    "structural defects — query count or rows-read growing with enrollment count or",
    "with global table size — caught before they became incidents, not incidents",
    "resolved. At this data size the query-level ratios are dominated by planning time",
    "and vary run to run; **buffer counts and end-to-end timings are the stable",
    "metrics**, and both are given below.",
    "",
    "Reproduce with `pnpm db:seed:load && pnpm bench:plans`. The equivalence proofs —",
    "that every re-shaped query returns byte-identical results to the one it replaced —",
    "are `pnpm bench:verify`, in `scripts/benchmarks/`.",
    "",
    "**No schema change was needed.** All three fixes are query-shape changes served",
    "by indexes that already existed; see `docs/benchmarks/week12-perf.md` for the",
    "reasoning and for the indexes that were measured and deliberately *not* added.",
    "",
    "## Dataset",
    "",
    "| table | rows |",
    "| --- | --- |",
    ...dbCounts.map((r) => `| ${r.t} | ${Number(r.n)} |`),
    "",
    `Fixture: course \`${course.title}\` (${course._count.enrollments} enrollments, ` +
      `${studentIds.length} non-DROPPED, ${assignmentIds.length} assignments).`,
  );

  // ---------- 1. gradebook submissions ----------
  section("1. Gradebook submissions — redundant `studentId IN (...)` removed");
  out.push(
    "The 400-element `studentId` list was logically redundant — these assignments",
    "already scope the course — and it drove the planner to the wrong index. Leading",
    "with `studentId` pulls every submission those 400 students ever made, *across",
    "every course*, then discards the ones from other courses (`Rows Removed by",
    "Filter: 2800` — 7 of every 8 rows read). Planning alone cost more than execution.",
    "",
    "Dropping the list makes `assignmentId` the driving predicate, so the existing",
    "`submissions_assignmentId_studentId_attemptNumber_key` index is scanned on its",
    "leading column and only this course's rows are touched. `include` → `select` on",
    "the same query stops dragging `textContent`/`fileKey`/`status` across the wire to",
    "compute a matrix of integers (plan `width` 199 → 56).",
    "",
    "The removed `studentId` list was also doing one real job: excluding DROPPED",
    "students. That now happens in memory against the enrollment set — exercised",
    "directly in `verify-query-edge-cases.ts`, which drops a student who has a graded cell and",
    "asserts the cell disappears while their submission still matches the query.",
    "",
  );
  const before1 = await timed(
    `SELECT s.id, s."assignmentId", s."studentId", s."attemptNumber", s."textContent",
            s."fileKey", s."isLate", s.status::text, s."submittedAt"
     FROM submissions s
     WHERE s."studentId" IN (${list(studentIds)}) AND s."assignmentId" IN (${list(assignmentIds)})
     ORDER BY s."attemptNumber" DESC`,
  );
  const after1 = await timed(
    `SELECT s."studentId", s."assignmentId"
     FROM submissions s
     WHERE s."assignmentId" IN (${list(assignmentIds)})
     ORDER BY s."attemptNumber" DESC`,
  );
  block("Before", before1.ms, before1.plan);
  block("After", after1.ms, after1.plan);
  out.push(
    `→ ${before1.ms.toFixed(2)} ms → ${after1.ms.toFixed(2)} ms on this run.`,
    "",
    "**Do not quote that ratio.** At this table size the query-level figure is mostly",
    "*planning* time, which is volatile — repeated runs of this same script produced",
    "ratios between roughly 10× and 20× with no code change. The two numbers here that",
    "are stable and mean something:",
    "",
    "- **Buffers read: 78 → 7.** The old shape touched 7 of every 8 rows for nothing.",
    "- **End-to-end `getGradebook()` through Prisma: 9.06 ms → 4.98 ms (1.8×)** for a",
    "  401-student course, median of 10 warm runs (`verify-query-equivalence.ts`). This is the honest",
    "  headline — it includes the enrollments, users and assignments queries that the",
    "  fix does not touch.\n",
  );

  // ---------- 2. dashboard progress ----------
  section("2. Dashboard progress — 2N+2 queries collapsed to 2");
  const widest = (
    await db.enrollment.groupBy({
      by: ["studentId"],
      _count: { _all: true },
      orderBy: { _count: { studentId: "desc" } },
      take: 1,
    })
  )[0];
  const courseIds = (
    await db.enrollment.findMany({
      where: { studentId: widest.studentId },
      select: { courseId: true },
    })
  ).map((e) => e.courseId);
  out.push(
    `Student with the most enrollments: ${courseIds.length} courses, so the old code`,
    `issued ${2 * courseIds.length + 2} queries and re-scanned the same lectures/sections`,
    `${2 * courseIds.length} times. Below is *one* of the ${courseIds.length} per-course`,
    "completed-counts, then the single grouped query that replaces all of them.",
    "",
  );
  const before2 = await timed(
    `SELECT COUNT(*) FROM lecture_progress p
     JOIN lectures l ON l.id = p."lectureId"
     JOIN sections s ON s.id = l."sectionId"
     WHERE p."studentId" = ${lit(widest.studentId)} AND p."isCompleted"
       AND l."isPublished" AND s."isPublished" AND s."courseId" = ${lit(courseIds[0])}`,
  );
  const after2 = await timed(
    `SELECT s."courseId", COUNT(*)::bigint AS n FROM lecture_progress p
     JOIN lectures l ON l.id = p."lectureId"
     JOIN sections s ON s.id = l."sectionId"
     WHERE p."studentId" = ${lit(widest.studentId)} AND p."isCompleted"
       AND l."isPublished" AND s."isPublished" AND s."courseId" = ANY(ARRAY[${list(courseIds)}])
     GROUP BY s."courseId"`,
  );
  block(`Before — one course of ${courseIds.length}`, before2.ms, before2.plan);
  block(`After — all ${courseIds.length} courses in one query`, after2.ms, after2.plan);
  out.push(
    `→ The grouped query costs about the same as **one** of the ${courseIds.length} it replaces.`,
    "Measured end-to-end through Prisma (`verify-query-equivalence.ts`), not just in the planner:",
    "**2.32 ms → 0.49 ms (4.7×)**, 18 queries → 4.\n",
  );

  // ---------- 3. ai_reviews agreement ----------
  section("3. AI agreement counts — relation filter replaced with an id filter");
  const pre = await db.aiReview.count();
  if (pre !== 0) throw new Error(`expected empty ai_reviews, found ${pre}`);
  const busiest = (
    await db.assignment.findMany({
      select: { id: true, _count: { select: { submissions: true } } },
      orderBy: { submissions: { _count: "desc" } },
      take: 1,
    })
  )[0];
  const subIds = (
    await db.submission.findMany({ where: { assignmentId: busiest.id }, select: { id: true } })
  ).map((s) => s.id);
  const allSubs = await db.submission.findMany({ select: { id: true } });
  out.push(
    "`ai_reviews` is empty in the benchmark DB, so this defect is invisible at head.",
    "It is an append-only table, so to measure it honestly I inserted 9 drafts per",
    "submission (28,800 rows), ran `ANALYZE`, captured the plans, then deleted them.",
    "",
    "Filtering through the `submission` relation puts the predicate on the *joined*",
    "table, so no index on `ai_reviews` can prune it: cost scales with **global**",
    "review volume, not with this assignment. The fix reuses submission ids the page",
    "has already fetched.",
    "",
  );
  try {
    for (let d = 0; d < 9; d++) {
      await db.aiReview.createMany({
        data: allSubs.map((s, i) => ({
          submissionId: s.id,
          draftFeedback: `synthetic draft ${d} — ${"x".repeat(200)}`,
          suggestedScore: (i + d) % 11,
          model: "claude-opus-5",
          instructorAction: (["PENDING", "ACCEPTED", "EDITED", "REJECTED"] as const)[(i + d) % 4],
        })),
      });
    }
    await db.$executeRawUnsafe("ANALYZE ai_reviews");
    const total = await db.aiReview.count();
    out.push(`Rows in \`ai_reviews\` for this measurement: **${total}**.\n`);

    const before3 = await timed(
      `SELECT COUNT(*), r."instructorAction"::text FROM ai_reviews r
       LEFT JOIN submissions j0 ON j0.id = r."submissionId"
       WHERE j0."assignmentId" = ${lit(busiest.id)} AND j0.id IS NOT NULL
       GROUP BY r."instructorAction"`,
    );
    const after3 = await timed(
      `SELECT COUNT(*), r."instructorAction"::text FROM ai_reviews r
       WHERE r."submissionId" IN (${list(subIds)})
       GROUP BY r."instructorAction"`,
    );
    block("Before — relation filter", before3.ms, before3.plan);
    block("After — id filter", after3.ms, after3.plan);
    out.push(
      `→ **${(before3.ms / after3.ms).toFixed(1)}× faster** at ${total} rows, and the plan is now`,
      "bounded by this assignment instead of the whole table. End-to-end through",
      "Prisma: **3.71 ms → 1.78 ms (2.1×)**.\n",
    );
  } finally {
    const del = await db.aiReview.deleteMany({});
    await db.$executeRawUnsafe("ANALYZE ai_reviews");
    out.push(`_Synthetic rows removed after measurement: ${del.count} deleted, table back to 0._`);
  }

  writeFileSync("docs/benchmarks/week12-query-plans.md", out.join("\n") + "\n");
  console.log("wrote docs/benchmarks/week12-query-plans.md");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
