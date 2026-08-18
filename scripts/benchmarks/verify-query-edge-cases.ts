import "dotenv/config";
import assert from "node:assert/strict";

import { db } from "../../src/lib/db";
import { getGradebook } from "../../src/lib/gradebook";

/**
 * Closes the two gaps verify-query-equivalence.ts reported as unexercised:
 *   1. No DROPPED enrollment existed on a course with assignments, so the
 *      in-memory filter that replaced the `studentId IN (...)` list was never
 *      actually tested. That filter is the only behavioural risk in the change.
 *   2. ai_reviews was empty, so old-vs-new agreement counts matched trivially.
 *
 * Both mutate the benchmark DB and restore it in a finally block.
 */

async function bench(label: string, reps: number, fn: () => Promise<unknown>) {
  await fn();
  const times: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`  ${label}: ${median.toFixed(2)}ms median (${reps} reps)`);
  return median;
}

async function testDroppedStudent() {
  console.log("\n=== 1. DROPPED student must not leak cells (the removed IN list's job) ===");

  // A course with assignments where some enrolled student has a graded cell.
  const courses = await db.course.findMany({
    where: { assignments: { some: {} } },
    select: { id: true, title: true },
  });
  let target: { courseId: string; studentId: string; cellKeys: string[] } | null = null;
  for (const c of courses) {
    const gb = await getGradebook(c.id);
    const keys = Object.keys(gb.cells);
    if (keys.length === 0) continue;
    const studentId = keys[0].split(":")[0];
    target = {
      courseId: c.id,
      studentId,
      cellKeys: keys.filter((k) => k.startsWith(`${studentId}:`)),
    };
    break;
  }
  assert.ok(target, "no course with graded cells — cannot test the DROPPED path");
  const { courseId, studentId, cellKeys } = target;

  const enrollment = await db.enrollment.findFirstOrThrow({
    where: { studentId, courseId },
    select: { id: true, status: true },
  });
  console.log(
    `  target: student ${studentId} on course ${courseId}, ${cellKeys.length} graded cell(s), status ${enrollment.status}`,
  );

  try {
    await db.enrollment.update({ where: { id: enrollment.id }, data: { status: "DROPPED" } });

    const gb = await getGradebook(courseId);
    assert.ok(!gb.students.some((s) => s.id === studentId), "DROPPED student still in students[]");
    const leaked = Object.keys(gb.cells).filter((k) => k.startsWith(`${studentId}:`));
    assert.deepEqual(leaked, [], `DROPPED student leaked cells: ${leaked.join(", ")}`);

    // The submissions are still in the table and still match the assignmentId
    // filter — proof the in-memory filter, not the query, is excluding them.
    const stillThere = await db.submission.count({
      where: { studentId, assignment: { courseId } },
    });
    assert.ok(stillThere > 0, "expected the DROPPED student's submissions to still exist");
    console.log(
      `  ✓ excluded from students[] and cells while ${stillThere} of their submissions still match the assignmentId filter`,
    );
  } finally {
    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { status: enrollment.status },
    });
  }

  const restored = await getGradebook(courseId);
  assert.ok(
    restored.students.some((s) => s.id === studentId),
    "restore failed: student missing",
  );
  for (const k of cellKeys) {
    assert.ok(restored.cells[k] !== undefined, `restore failed: cell ${k} missing`);
  }
  console.log(`  ✓ enrollment restored to ${enrollment.status}; all cells back`);
}

const norm = (rows: { instructorAction: string | null; _count: { _all: number } }[]) =>
  rows
    .map((r) => `${r.instructorAction}=${r._count._all}`)
    .sort()
    .join(",");

async function testAgreementWithRealDepth() {
  console.log("\n=== 2. Agreement counts with real ai_reviews depth ===");
  const preexisting = await db.aiReview.count();
  assert.equal(preexisting, 0, `expected an empty ai_reviews table, found ${preexisting} rows`);

  const submissions = await db.submission.findMany({ select: { id: true } });
  const DRAFTS = 9; // append-only history depth this table is designed for
  const ACTIONS = ["PENDING", "ACCEPTED", "EDITED", "REJECTED"] as const;

  console.log(`  inserting ${submissions.length * DRAFTS} synthetic drafts...`);
  try {
    for (let d = 0; d < DRAFTS; d++) {
      await db.aiReview.createMany({
        data: submissions.map((s, i) => ({
          submissionId: s.id,
          draftFeedback: `synthetic draft ${d} — ${"x".repeat(200)}`,
          suggestedScore: (i + d) % 11,
          model: "claude-opus-5",
          // Only the newest draft carries a verdict in production; spread
          // actions so every group is represented in the counts.
          instructorAction: ACTIONS[(i + d) % ACTIONS.length],
        })),
        skipDuplicates: true,
      });
    }
    await db.$executeRawUnsafe("ANALYZE ai_reviews");
    const total = await db.aiReview.count();
    console.log(`  ai_reviews now has ${total} rows`);

    const assignments = await db.assignment.findMany({ select: { id: true, title: true } });
    let compared = 0;
    let nonEmpty = 0;
    for (const a of assignments) {
      const ids = (
        await db.submission.findMany({ where: { assignmentId: a.id }, select: { id: true } })
      ).map((s) => s.id);
      const [oldRows, newRows] = await Promise.all([
        db.aiReview.groupBy({
          by: ["instructorAction"],
          where: { submission: { assignmentId: a.id } },
          _count: { _all: true },
        }),
        db.aiReview.groupBy({
          by: ["instructorAction"],
          where: { submissionId: { in: ids } },
          _count: { _all: true },
        }),
      ]);
      assert.equal(norm(oldRows), norm(newRows), `agreement mismatch on ${a.title}`);
      compared++;
      if (oldRows.length > 0) nonEmpty++;
    }
    console.log(
      `  ✓ ${compared} assignments identical old-vs-new (${nonEmpty} with non-empty counts)`,
    );

    // Timing on the assignment with the most submissions.
    const busiest = (
      await db.assignment.findMany({
        select: { id: true, _count: { select: { submissions: true } } },
        orderBy: { submissions: { _count: "desc" } },
        take: 1,
      })
    )[0];
    const ids = (
      await db.submission.findMany({ where: { assignmentId: busiest.id }, select: { id: true } })
    ).map((s) => s.id);
    console.log(`  assignment with ${busiest._count.submissions} submissions:`);
    const before = await bench("before (relation filter, scans all reviews)", 10, () =>
      db.aiReview.groupBy({
        by: ["instructorAction"],
        where: { submission: { assignmentId: busiest.id } },
        _count: { _all: true },
      }),
    );
    const after = await bench("after  (submissionId IN, index-pruned)    ", 10, () =>
      db.aiReview.groupBy({
        by: ["instructorAction"],
        where: { submissionId: { in: ids } },
        _count: { _all: true },
      }),
    );
    console.log(
      `  => ${before.toFixed(2)}ms -> ${after.toFixed(2)}ms (${(before / after).toFixed(1)}x) at ${total} rows`,
    );
    return { total, before, after, submissions: busiest._count.submissions };
  } finally {
    const deleted = await db.aiReview.deleteMany({});
    await db.$executeRawUnsafe("ANALYZE ai_reviews");
    console.log(`  cleaned up: deleted ${deleted.count} synthetic rows`);
    const left = await db.aiReview.count();
    assert.equal(left, 0, `cleanup failed, ${left} rows remain`);
  }
}

async function main() {
  await testDroppedStudent();
  const agreement = await testAgreementWithRealDepth();
  console.log("\n=== SUMMARY ===");
  console.log(
    `agreement groupBy @ ${agreement.total} ai_reviews rows, ${agreement.submissions} submissions:`,
  );
  console.log(
    `  ${agreement.before.toFixed(2)}ms -> ${agreement.after.toFixed(2)}ms (${(
      agreement.before / agreement.after
    ).toFixed(1)}x)`,
  );
  console.log("all assertions passed; DB restored");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
