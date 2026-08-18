import { describe, expect, it } from "vitest";

import { evaluateRateLimit, RATE_LIMITS } from "./rate-limit-rules";

const NOW = new Date("2026-08-07T12:00:00Z");

describe("RATE_LIMITS policy", () => {
  it("keeps the paid AI action the tightest limit", () => {
    const ai = RATE_LIMITS["ai-draft"].limit;
    for (const [action, cfg] of Object.entries(RATE_LIMITS)) {
      if (action !== "ai-draft") expect(cfg.limit).toBeGreaterThan(ai);
    }
  });

  it("uses positive windows everywhere", () => {
    for (const cfg of Object.values(RATE_LIMITS)) {
      expect(cfg.limit).toBeGreaterThan(0);
      expect(cfg.windowSeconds).toBeGreaterThan(0);
    }
  });
});

describe("evaluateRateLimit", () => {
  it("allows a first hit and reports the remaining budget", () => {
    const d = evaluateRateLimit({ action: "ai-draft", hits: 0, windowStartedAt: null, now: NOW });
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(RATE_LIMITS["ai-draft"].limit - 1);
    expect(d.retryAfterSeconds).toBe(0);
  });

  it("allows the final hit inside the limit", () => {
    const limit = RATE_LIMITS["ai-draft"].limit;
    const d = evaluateRateLimit({
      action: "ai-draft",
      hits: limit - 1,
      windowStartedAt: NOW,
      now: NOW,
    });
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(0);
  });

  it("blocks once the limit is reached", () => {
    const limit = RATE_LIMITS["ai-draft"].limit;
    const d = evaluateRateLimit({
      action: "ai-draft",
      hits: limit,
      windowStartedAt: NOW,
      now: NOW,
    });
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
    expect(d.retryAfterSeconds).toBe(RATE_LIMITS["ai-draft"].windowSeconds);
  });

  it("shrinks retry-after as the window ages", () => {
    const startedAt = new Date(NOW.getTime() - 45 * 60 * 1000); // 45 min in
    const d = evaluateRateLimit({
      action: "ai-draft",
      hits: RATE_LIMITS["ai-draft"].limit,
      windowStartedAt: startedAt,
      now: NOW,
    });
    expect(d.retryAfterSeconds).toBe(15 * 60);
  });

  it("never advertises a zero or negative retry-after on a stale window", () => {
    const startedAt = new Date(NOW.getTime() - 5 * 60 * 60 * 1000); // long past
    const d = evaluateRateLimit({
      action: "ai-draft",
      hits: RATE_LIMITS["ai-draft"].limit,
      windowStartedAt: startedAt,
      now: NOW,
    });
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("blocks over-limit hits too (a counter can exceed under races)", () => {
    const d = evaluateRateLimit({
      action: "presign",
      hits: RATE_LIMITS.presign.limit + 5,
      windowStartedAt: NOW,
      now: NOW,
    });
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
  });
});
