import { DomainError } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  evaluateRateLimit,
  RATE_LIMITS,
  type RateLimitAction,
  type RateLimitDecision,
} from "@/lib/rate-limit-rules";

/**
 * Consume one unit of an actor's budget for `action`.
 *
 * Fixed window in Postgres: one row per (subject, action), incremented
 * atomically. When the stored window has aged out the row is reset rather than
 * deleted, so there's no cleanup job to run.
 */
export async function consumeRateLimit(
  subject: string,
  action: RateLimitAction,
): Promise<RateLimitDecision> {
  const { windowSeconds } = RATE_LIMITS[action];
  const now = new Date();
  const windowFloor = new Date(now.getTime() - windowSeconds * 1000);

  // Reset first if the window has expired — a separate statement so the
  // increment below stays a single atomic upsert.
  await db.rateLimitHit.updateMany({
    where: { subject, action, windowStartedAt: { lt: windowFloor } },
    data: { hits: 0, windowStartedAt: now },
  });

  const row = await db.rateLimitHit.upsert({
    where: { subject_action: { subject, action } },
    create: { subject, action, hits: 1, windowStartedAt: now },
    update: { hits: { increment: 1 } },
  });

  // `hits` already includes this attempt; evaluate against the count before it.
  return evaluateRateLimit({
    action,
    hits: row.hits - 1,
    windowStartedAt: row.windowStartedAt,
    now,
  });
}

/** Consume budget or throw a 429 carrying Retry-After. */
export async function enforceRateLimit(
  subject: string,
  action: RateLimitAction,
): Promise<RateLimitDecision> {
  const decision = await consumeRateLimit(subject, action);
  if (!decision.allowed) {
    throw new DomainError(
      "RATE_LIMITED",
      `Too many requests — try again in ${formatWait(decision.retryAfterSeconds)}`,
      { retryAfterSeconds: decision.retryAfterSeconds },
      429,
    );
  }
  return decision;
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.ceil(minutes / 60)}h`;
}
