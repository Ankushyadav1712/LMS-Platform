// Pure rate-limit policy — no DB, no clock. The limits live here as data so
// they're reviewable in one place and the window maths is unit-testable.

export type RateLimit = { limit: number; windowSeconds: number };

/**
 * Per-actor limits, keyed by action. Chosen for a classroom-scale app, not a
 * public API: generous enough that no honest instructor or student hits them,
 * tight enough to bound abuse and cost.
 */
export const RATE_LIMITS = {
  // Each call spends real money at the model provider — the tightest limit.
  "ai-draft": { limit: 20, windowSeconds: 60 * 60 },
  // Presigned uploads: bounds storage-filling abuse.
  presign: { limit: 60, windowSeconds: 60 * 60 },
  // Submissions: attempt caps already bound these; this stops hammering.
  submit: { limit: 30, windowSeconds: 60 * 60 },
  // Enrolment is idempotent, but no reason to allow floods.
  enroll: { limit: 30, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimit>;

export type RateLimitAction = keyof typeof RATE_LIMITS;

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window frees up — drives the Retry-After header. */
  retryAfterSeconds: number;
};

/**
 * Decide from a window's existing hits. `windowStart` is the timestamp of the
 * oldest hit still counted; once it ages out the window resets.
 */
export function evaluateRateLimit(opts: {
  action: RateLimitAction;
  hits: number;
  windowStartedAt: Date | null;
  now: Date;
}): RateLimitDecision {
  const { limit, windowSeconds } = RATE_LIMITS[opts.action];
  const remaining = Math.max(limit - opts.hits, 0);

  if (opts.hits < limit) {
    return {
      allowed: true,
      remaining: remaining - 1 < 0 ? 0 : remaining - 1,
      retryAfterSeconds: 0,
    };
  }

  const elapsedMs = opts.windowStartedAt ? opts.now.getTime() - opts.windowStartedAt.getTime() : 0;
  const remainingMs = windowSeconds * 1000 - elapsedMs;
  return {
    allowed: false,
    remaining: 0,
    // Always advertise at least a second so clients don't hot-loop.
    retryAfterSeconds: Math.max(Math.ceil(remainingMs / 1000), 1),
  };
}
