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

  // Submissions arrive highest-attempt-first; the first graded one we see per
  // (student, assignment) is the current grade.
  const cells: Record<string, number> = {};
  for (const s of submissions) {
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
