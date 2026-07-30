import { describe, expect, it } from "vitest";

import { evaluateSubmissionWindow, isValidGrade } from "./submission-rules";

const NOW = new Date("2026-07-15T12:00:00Z");
const BEFORE = new Date("2026-07-20T12:00:00Z");
const AFTER = new Date("2026-07-10T12:00:00Z");

describe("evaluateSubmissionWindow", () => {
  const base = { now: NOW, allowLate: true, maxAttempts: 1, usedAttempts: 0 };

  it("allows an on-time first attempt", () => {
    expect(evaluateSubmissionWindow({ ...base, dueAt: BEFORE })).toEqual({
      allowed: true,
      isLate: false,
    });
  });

  it("allows a no-deadline assignment", () => {
    expect(evaluateSubmissionWindow({ ...base, dueAt: null })).toEqual({
      allowed: true,
      isLate: false,
    });
  });

  it("flags a late submission when late is allowed", () => {
    expect(evaluateSubmissionWindow({ ...base, dueAt: AFTER })).toEqual({
      allowed: true,
      isLate: true,
    });
  });

  it("blocks a late submission when late is not allowed", () => {
    const r = evaluateSubmissionWindow({ ...base, dueAt: AFTER, allowLate: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/deadline/i);
  });

  it("blocks once attempts are exhausted, even before the deadline", () => {
    const r = evaluateSubmissionWindow({
      ...base,
      dueAt: BEFORE,
      maxAttempts: 2,
      usedAttempts: 2,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/attempts/i);
  });

  it("attempt limit takes precedence over an open deadline", () => {
    const r = evaluateSubmissionWindow({
      ...base,
      dueAt: null,
      maxAttempts: 1,
      usedAttempts: 1,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/attempts/i);
  });

  it("allows a later attempt while attempts remain", () => {
    expect(
      evaluateSubmissionWindow({ ...base, dueAt: BEFORE, maxAttempts: 3, usedAttempts: 1 }),
    ).toEqual({ allowed: true, isLate: false });
  });
});

describe("isValidGrade", () => {
  it.each([
    [0, 100, true],
    [100, 100, true],
    [55, 100, true],
    [-1, 100, false],
    [101, 100, false],
    [50.5, 100, false],
  ])("points %s of %s -> %s", (points, max, expected) => {
    expect(isValidGrade(points, max)).toBe(expected);
  });
});
