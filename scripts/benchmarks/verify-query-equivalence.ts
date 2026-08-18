import "dotenv/config";
import assert from "node:assert/strict";

import { db } from "../../src/lib/db";
import { getGradebook } from "../../src/lib/gradebook";
import { getCourseProgress, getProgressForCourses } from "../../src/lib/learn";
import { toProgress } from "../../src/lib/progress-rules";

/** Median of a timed closure, warmed. */
async function bench(label: string, reps: number, fn: () => Promise<unknown>) {
  await fn(); // warm
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

// ---------- OLD SHAPES, inlined verbatim from git HEAD ----------

async function oldGradebookCells(courseId: string) {
  const [enrollments, assignments] = await Promise.all([
    db.enrollment.findMany({
      where: { courseId, status: { not: "DROPPED" } },
      include: { student: { select: { id: true, name: true, email: true } } },
      orderBy: { student: { name: "asc" } },
    }),
    db.assignment.findMany({
      where: { courseId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, maxPoints: true },
    }),
  ]);
  const studentIds = enrollments.map((e) => e.studentId);
  const assignmentIds = assignments.map((a) => a.id);
  const submissions =
    studentIds.length && assignmentIds.length
      ? await db.submission.findMany({
          where: { studentId: { in: studentIds }, assignmentId: { in: assignmentIds } },
          include: { grades: { orderBy: { gradedAt: "desc" }, take: 1 } },
          orderBy: { attemptNumber: "desc" },
        })
      : [];
  const cells: Record<string, number> = {};
  for (const s of submissions) {
    const key = `${s.studentId}:${s.assignmentId}`;
    if (cells[key] === undefined && s.grades[0]) cells[key] = s.grades[0].points;
  }
  return { students: enrollments.map((e) => e.student), assignments, cells };
}

async function oldAgreementCounts(assignmentId: string) {
  return db.aiReview.groupBy({
    by: ["instructorAction"],
    where: { submission: { assignmentId } },
    _count: { _all: true },
  });
}

async function newAgreementCounts(assignmentId: string) {
  const submissions = await db.submission.findMany({
    where: { assignmentId },
    select: { id: true },
  });
  return db.aiReview.groupBy({
    by: ["instructorAction"],
    where: { submissionId: { in: submissions.map((s) => s.id) } },
    _count: { _all: true },
  });
}

const norm = (rows: { instructorAction: string | null; _count: { _all: number } }[]) =>
  rows
    .map((r) => `${r.instructorAction}=${r._count._all}`)
    .sort()
    .join(",");

// ---------- EQUIVALENCE ----------

async function verifyProgress() {
  console.log("\n=== 1. Dashboard progress: per-course vs grouped ===");
  // Every student who has any enrollment, not just one sample.
  const students = await db.user.findMany({
    where: { role: "STUDENT", enrollments: { some: {} } },
    select: { id: true, email: true },
  });
  let checked = 0;
  let maxCourses = 0;
  for (const s of students) {
    const enrollments = await db.enrollment.findMany({
      where: { studentId: s.id },
      select: { courseId: true },
    });
    const courseIds = enrollments.map((e) => e.courseId);
    maxCourses = Math.max(maxCourses, courseIds.length);

    const grouped = await getProgressForCourses(s.id, courseIds);
    for (const courseId of courseIds) {
      const old = await getCourseProgress(s.id, courseId);
      assert.deepEqual(
        grouped.get(courseId),
        old,
        `MISMATCH student=${s.email} course=${courseId}: grouped=${JSON.stringify(
          grouped.get(courseId),
        )} per-course=${JSON.stringify(old)}`,
      );
      checked++;
    }
  }
  console.log(
    `  ✓ ${checked} (student, course) pairs identical across ${students.length} students (max ${maxCourses} enrollments)`,
  );

  // Edge cases the grouped query has to get right on its own.
  assert.deepEqual([...(await getProgressForCourses("nobody", []))], [], "empty courseIds");
  const ghost = await getProgressForCourses("nobody", ["no-such-course"]);
  assert.deepEqual(ghost.get("no-such-course"), { total: 0, completed: 0, percent: 0 });
  assert.deepEqual(toProgress(0, 0), { total: 0, completed: 0, percent: 0 });
  console.log("  ✓ empty list, unknown course, and zero-lecture course all return total 0");

  // Timing on the widest student.
  const widest = (
    await db.enrollment.groupBy({
      by: ["studentId"],
      _count: { _all: true },
      orderBy: { _count: { studentId: "desc" } },
      take: 1,
    })
  )[0];
  const ids = (
    await db.enrollment.findMany({
      where: { studentId: widest.studentId },
      select: { courseId: true },
    })
  ).map((e) => e.courseId);
  console.log(`  N=${ids.length} enrollments:`);
  const before = await bench("before (2N+2 queries)", 15, () =>
    Promise.all(ids.map((c) => getCourseProgress(widest.studentId, c))),
  );
  const after = await bench("after  (2 queries)   ", 15, () =>
    getProgressForCourses(widest.studentId, ids),
  );
  return { n: ids.length, before, after, pairs: checked };
}

async function verifyGradebook() {
  console.log("\n=== 2. Gradebook: old query shape vs new ===");
  const courses = await db.course.findMany({
    where: { assignments: { some: {} } },
    select: { id: true, title: true },
  });
  let cellCount = 0;
  for (const c of courses) {
    const [oldGb, newGb] = await Promise.all([oldGradebookCells(c.id), getGradebook(c.id)]);
    assert.deepEqual(newGb.cells, oldGb.cells, `cells mismatch on ${c.title}`);
    assert.deepEqual(newGb.students, oldGb.students, `students mismatch on ${c.title}`);
    assert.deepEqual(newGb.assignments, oldGb.assignments, `assignments mismatch on ${c.title}`);
    cellCount += Object.keys(newGb.cells).length;
  }
  console.log(
    `  ✓ ${courses.length} courses, ${cellCount} graded cells — identical students/assignments/cells`,
  );

  // A DROPPED student must not appear, and must not leak a cell. Prove the
  // in-memory filter actually does the work the removed IN list used to.
  const dropped = await db.enrollment.findFirst({
    where: { status: "DROPPED", course: { assignments: { some: {} } } },
    select: { studentId: true, courseId: true },
  });
  if (dropped) {
    const gb = await getGradebook(dropped.courseId);
    assert.ok(
      !gb.students.some((s) => s.id === dropped.studentId),
      "DROPPED student appeared in gradebook",
    );
    const leaked = Object.keys(gb.cells).filter((k) => k.startsWith(`${dropped.studentId}:`));
    assert.deepEqual(leaked, [], `DROPPED student leaked cells: ${leaked.join()}`);
    const subs = await db.submission.count({
      where: { studentId: dropped.studentId, assignment: { courseId: dropped.courseId } },
    });
    console.log(
      `  ✓ DROPPED student (${subs} submissions in this course) excluded from students and cells`,
    );
  } else {
    console.log("  ! no DROPPED enrollment in a course with assignments — filter unexercised");
  }

  const biggest = (
    await db.course.findMany({
      where: { assignments: { some: {} } },
      select: { id: true, _count: { select: { enrollments: true } } },
      orderBy: { enrollments: { _count: "desc" } },
      take: 1,
    })
  )[0];
  console.log(`  course with ${biggest._count.enrollments} enrollments:`);
  const before = await bench("before (studentId IN + include)", 10, () =>
    oldGradebookCells(biggest.id),
  );
  const after = await bench("after  (assignmentId + select) ", 10, () => getGradebook(biggest.id));
  return { enrollments: biggest._count.enrollments, before, after };
}

async function verifyAgreement() {
  console.log("\n=== 3. AI agreement counts: relation filter vs id filter ===");
  const assignments = await db.assignment.findMany({ select: { id: true, title: true } });
  const reviewTotal = await db.aiReview.count();
  let same = 0;
  for (const a of assignments) {
    const [oldRows, newRows] = await Promise.all([
      oldAgreementCounts(a.id),
      newAgreementCounts(a.id),
    ]);
    assert.equal(norm(oldRows), norm(newRows), `agreement mismatch on ${a.title}`);
    same++;
  }
  console.log(`  ✓ ${same} assignments identical (ai_reviews rows in DB: ${reviewTotal})`);
  if (reviewTotal === 0) {
    console.log("  ! ai_reviews is empty — equivalence holds trivially; see synthetic-load note");
  }
  // in: [] must be a safe false predicate, not "match everything".
  const empty = await db.aiReview.groupBy({
    by: ["instructorAction"],
    where: { submissionId: { in: [] } },
    _count: { _all: true },
  });
  assert.deepEqual(empty, [], "in: [] did not behave as a false predicate");
  console.log("  ✓ `submissionId: { in: [] }` returns no groups (safe empty case)");
}

async function main() {
  const progress = await verifyProgress();
  const gradebook = await verifyGradebook();
  await verifyAgreement();

  console.log("\n=== SUMMARY ===");
  console.log(
    `dashboard progress  N=${progress.n}: ${progress.before.toFixed(
      2,
    )}ms -> ${progress.after.toFixed(2)}ms  (${(progress.before / progress.after).toFixed(1)}x)`,
  );
  console.log(
    `gradebook  ${gradebook.enrollments} students: ${gradebook.before.toFixed(
      2,
    )}ms -> ${gradebook.after.toFixed(2)}ms  (${(gradebook.before / gradebook.after).toFixed(1)}x)`,
  );
  console.log("all equivalence assertions passed");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
