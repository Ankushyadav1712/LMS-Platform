import { describe, expect, it } from "vitest";

import { toProgress } from "./progress-rules";

describe("toProgress", () => {
  it("reports 0% for a course with no published lectures", () => {
    // Guards the division: "nothing to do" is not "everything done".
    expect(toProgress(0, 0)).toEqual({ total: 0, completed: 0, percent: 0 });
  });

  it("reports 0% when nothing is completed", () => {
    expect(toProgress(30, 0).percent).toBe(0);
  });

  it("reports 100% only when every lecture is complete", () => {
    expect(toProgress(30, 30).percent).toBe(100);
    expect(toProgress(30, 29).percent).toBe(97);
  });

  it("rounds to the nearest whole percent", () => {
    expect(toProgress(3, 1).percent).toBe(33); // 33.33 -> 33
    expect(toProgress(3, 2).percent).toBe(67); // 66.67 -> 67
    expect(toProgress(8, 1).percent).toBe(13); // 12.5 -> 13 (half rounds up)
  });

  it("passes total and completed through unchanged", () => {
    expect(toProgress(6, 5)).toEqual({ total: 6, completed: 5, percent: 83 });
  });

  it("rounds a nearly-complete course up to 100% (known display quirk)", () => {
    // 999/1000 displays as 100% because percent is a rounded integer. Pinned
    // deliberately: `completed`/`total` are shown alongside it ("999/1000
    // lectures · 100%"), so the exact count is never hidden, and the alternative
    // (clamping to 99) would make a genuinely complete course ambiguous.
    // Callers must test completion with completed === total, never percent.
    expect(toProgress(1000, 999).percent).toBe(100);
    expect(toProgress(200, 199).percent).toBe(100);
  });
});
