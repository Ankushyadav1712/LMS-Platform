import { buildCsv, neutralizeFormula } from "@/lib/csv";
import { db } from "@/lib/db";

export type Gradebook = {
  students: { id: string; name: string; email: string }[];
  assignments: { id: string; title: string; maxPoints: number }[];
  // key: `${studentId}:${assignmentId}` -> current points (latest graded attempt)
  cells: Record<string, number>;
};

/**
 * A course's gradebook matrix. The "current grade" for a (student,
 * assignment) is the grade on their highest-numbered graded attempt —
 * consistent with the latest-row-wins rule used everywhere else.
 */
export async function getGradebook(courseId: string): Promise<Gradebook> {
  const [enrollments, assignments] = await Promise.all([
    db.enrollment.findMany({
      where: { courseId, status: { not: "DROPPED" } },
      select: { studentId: true, student: { select: { id: true, name: true, email: true } } },
      orderBy: { student: { name: "asc" } },
    }),
    db.assignment.findMany({
      where: { courseId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, maxPoints: true },
    }),
  ]);

  const enrolledIds = new Set(enrollments.map((e) => e.studentId));
  const assignmentIds = assignments.map((a) => a.id);

  // Filtered by assignment only. Adding `studentId: { in: [...] }` was
  // redundant — these assignments already scope the course — and the 400-value
  // ANY() cost more to plan than to run: it forced a Seq Scan (2800 rows
  // discarded) instead of using the (assignmentId, studentId, attemptNumber)
  // unique index. DROPPED students are filtered below instead.
  const submissions =
    enrolledIds.size && assignmentIds.length
      ? await db.submission.findMany({
          where: { assignmentId: { in: assignmentIds } },
          select: {
            studentId: true,
            assignmentId: true,
            grades: { orderBy: { gradedAt: "desc" }, take: 1, select: { points: true } },
          },
          orderBy: { attemptNumber: "desc" },
        })
      : [];

  // Submissions arrive highest-attempt-first; the first graded one we see per
  // (student, assignment) is the current grade.
  const cells: Record<string, number> = {};
  for (const s of submissions) {
    if (!enrolledIds.has(s.studentId)) continue; // keeps DROPPED students out
    const key = `${s.studentId}:${s.assignmentId}`;
    if (cells[key] === undefined && s.grades[0]) cells[key] = s.grades[0].points;
  }

  return { students: enrollments.map((e) => e.student), assignments, cells };
}

/** Render a gradebook as CSV: Student, Email, then one column per assignment. */
export function gradebookToCsv(gb: Gradebook): string {
  // name/email/title are user- or instructor-controlled → formula-guard them.
  // Points are non-negative numbers we generate → left as-is.
  const header = [
    "Student",
    "Email",
    ...gb.assignments.map((a) => neutralizeFormula(`${a.title} (/${a.maxPoints})`)),
  ];
  const rows = gb.students.map((s) => [
    neutralizeFormula(s.name),
    neutralizeFormula(s.email),
    ...gb.assignments.map((a) => {
      const pts = gb.cells[`${s.id}:${a.id}`];
      return pts === undefined ? "" : String(pts);
    }),
  ]);
  return buildCsv([header, ...rows]);
}
