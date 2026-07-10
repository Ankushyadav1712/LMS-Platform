// Pure policy layer: no DB, no framework, no env — the whole role ×
// ownership matrix stays unit-testable in isolation. Session-coupled
// guards live in src/lib/guards.ts.

export type Role = "STUDENT" | "INSTRUCTOR" | "ADMIN";

// ---------------------------------------------------------------
// Typed errors — src/lib/api.ts maps these to HTTP responses.
// ---------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401;
  readonly code = "UNAUTHORIZED";
  constructor(message = "Authentication required") {
    super(message);
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";
  constructor(message = "You do not have permission to do this") {
    super(message);
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = "NOT_FOUND";
  constructor(message = "Not found") {
    super(message);
  }
}

/**
 * Domain-rule violation with a machine-readable code (e.g. NOT_READY,
 * ARCHIVED). `details` is spread into the error envelope so clients can
 * read structured fields like `blockers`.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------
// Policy layer. Pure functions over (user, resource) — no DB, no
// framework — so the whole role × ownership matrix is unit-testable.
// Route handlers load the resource, then ask `can.*`; they never
// inline role checks.
// ---------------------------------------------------------------

export type Actor = { id: string; role: Role };

export const can = {
  /** Instructors and admins can author courses at all. */
  createCourse(actor: Actor): boolean {
    return actor.role === "INSTRUCTOR" || actor.role === "ADMIN";
  },

  /** Only the owning instructor (or an admin) may modify a course. */
  manageCourse(actor: Actor, course: { instructorId: string }): boolean {
    return (
      actor.role === "ADMIN" || (actor.role === "INSTRUCTOR" && course.instructorId === actor.id)
    );
  },

  /** Students enroll; instructors/admins interact through other flows. */
  enroll(actor: Actor): boolean {
    return actor.role === "STUDENT";
  },

  /** A submission is visible to its author, the course owner, or an admin. */
  viewSubmission(
    actor: Actor,
    submission: { studentId: string; courseInstructorId: string },
  ): boolean {
    return (
      actor.role === "ADMIN" ||
      submission.studentId === actor.id ||
      (actor.role === "INSTRUCTOR" && submission.courseInstructorId === actor.id)
    );
  },

  /** Grading is course-owner (or admin) only — role alone is not enough. */
  gradeSubmission(actor: Actor, submission: { courseInstructorId: string }): boolean {
    return (
      actor.role === "ADMIN" ||
      (actor.role === "INSTRUCTOR" && submission.courseInstructorId === actor.id)
    );
  },

  /** Role changes: admins only, and never their own account (no self-lockout). */
  changeRole(actor: Actor, target: { id: string }): boolean {
    return actor.role === "ADMIN" && target.id !== actor.id;
  },

  /** Admin area (user management, moderation, stats). */
  administrate(actor: Actor): boolean {
    return actor.role === "ADMIN";
  },
} as const;
