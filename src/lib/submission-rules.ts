// Pure submission-window logic — no DB, no env. Same pattern as authz.ts
// and publish-rules.ts: the decision lives here and is unit-tested; the
// service (assignments.ts) does the IO around it.

export type SubmissionWindow = {
  allowed: boolean;
  isLate: boolean;
  reason?: string;
};

/**
 * Can this student submit right now, and would it count as late?
 *
 * - past the deadline with allowLate=false  -> blocked
 * - past the deadline with allowLate=true   -> allowed, flagged late
 * - all attempts already used               -> blocked
 */
export function evaluateSubmissionWindow(opts: {
  now: Date;
  dueAt: Date | null;
  allowLate: boolean;
  maxAttempts: number;
  usedAttempts: number;
}): SubmissionWindow {
  if (opts.usedAttempts >= opts.maxAttempts) {
    return {
      allowed: false,
      isLate: false,
      reason: `No attempts left (${opts.maxAttempts} used)`,
    };
  }

  const past = opts.dueAt !== null && opts.now.getTime() > opts.dueAt.getTime();
  if (past && !opts.allowLate) {
    return { allowed: false, isLate: false, reason: "The deadline has passed" };
  }

  return { allowed: true, isLate: past };
}

/** A grade must land within the assignment's point range. */
export function isValidGrade(points: number, maxPoints: number): boolean {
  return Number.isInteger(points) && points >= 0 && points <= maxPoints;
}
