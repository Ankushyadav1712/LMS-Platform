import { Prisma } from "@/generated/prisma/client";
import { can, DomainError, NotFoundError, type Actor } from "@/lib/authz";
import { db } from "@/lib/db";
import { getEnrollment } from "@/lib/learn";
import { evaluateSubmissionWindow, isValidGrade } from "@/lib/submission-rules";

/**
 * Load an assignment the actor may manage (course owner or admin), or 404.
 * 404-masked like the course loaders — no cross-course probing.
 */
export async function getOwnedAssignment(actor: Actor, assignmentId: string) {
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { course: true },
  });
  if (!assignment || !can.manageCourse(actor, assignment.course)) {
    throw new NotFoundError("Assignment not found");
  }
  return assignment;
}

/**
 * Load a published assignment a student may submit to: published assignment
 * in a published course the student is (effectively) enrolled in. 404 otherwise.
 */
export async function getSubmittableAssignment(actor: Actor, assignmentId: string) {
  const assignment = await db.assignment.findFirst({
    where: { id: assignmentId, isPublished: true, course: { status: "PUBLISHED" } },
    include: { course: { select: { id: true } } },
  });
  if (!assignment) throw new NotFoundError("Assignment not found");

  const enrollment = await getEnrollment(actor.id, assignment.course.id);
  if (!enrollment) throw new NotFoundError("Assignment not found");

  return assignment;
}

/**
 * Create a submission attempt. The whole check-and-insert runs in one
 * serializable transaction so two concurrent submits can't both slip past
 * the attempt cap; the unique (assignmentId, studentId, attemptNumber)
 * constraint is the final backstop.
 */
export async function submitAttempt(opts: {
  actor: Actor;
  assignmentId: string;
  now: Date;
  textContent: string | null;
  fileKey: string | null;
}) {
  const { actor, assignmentId, now } = opts;
  const assignment = await getSubmittableAssignment(actor, assignmentId);

  if (!opts.textContent?.trim() && !opts.fileKey) {
    throw new DomainError("EMPTY_SUBMISSION", "Add text or a file before submitting");
  }

  try {
    return await db.$transaction(
      async (tx) => {
        const used = await tx.submission.count({
          where: { assignmentId, studentId: actor.id },
        });
        const window = evaluateSubmissionWindow({
          now,
          dueAt: assignment.dueAt,
          allowLate: assignment.allowLate,
          maxAttempts: assignment.maxAttempts,
          usedAttempts: used,
        });
        if (!window.allowed) {
          throw new DomainError("WINDOW_CLOSED", window.reason ?? "Submissions are closed");
        }
        return tx.submission.create({
          data: {
            assignmentId,
            studentId: actor.id,
            attemptNumber: used + 1,
            textContent: opts.textContent?.trim() || null,
            fileKey: opts.fileKey,
            isLate: window.isLate,
            status: "SUBMITTED",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    // Serialization failure or the unique backstop firing both mean a
    // concurrent attempt won the race — surface a clean conflict.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      (e.code === "P2002" || e.code === "P2034")
    ) {
      throw new DomainError(
        "CONFLICT",
        "Another attempt was just submitted — reload and check",
        undefined,
        409,
      );
    }
    throw e;
  }
}

/** Record a grade the course owner assigns. Latest Grade row = current grade. */
export async function gradeSubmission(opts: {
  actor: Actor;
  submissionId: string;
  points: number;
  feedback: string | null;
}) {
  const submission = await db.submission.findUnique({
    where: { id: opts.submissionId },
    include: { assignment: { include: { course: true } } },
  });
  if (
    !submission ||
    !can.gradeSubmission(opts.actor, {
      courseInstructorId: submission.assignment.course.instructorId,
    })
  ) {
    throw new NotFoundError("Submission not found");
  }

  if (!isValidGrade(opts.points, submission.assignment.maxPoints)) {
    throw new DomainError(
      "INVALID_POINTS",
      `Points must be a whole number between 0 and ${submission.assignment.maxPoints}`,
    );
  }

  return db.$transaction(async (tx) => {
    const grade = await tx.grade.create({
      data: {
        submissionId: submission.id,
        graderId: opts.actor.id,
        points: opts.points,
        feedback: opts.feedback?.trim() || null,
      },
    });
    await tx.submission.update({
      where: { id: submission.id },
      data: { status: "GRADED" },
    });
    return grade;
  });
}
