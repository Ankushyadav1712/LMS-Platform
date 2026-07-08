import { describe, expect, it } from "vitest";

import { slugify, slugifyUnique } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("Intro to Web Development")).toBe("intro-to-web-development");
  });

  it("strips punctuation and symbols", () => {
    expect(slugify("C++ & Rust: Systems (2026)!")).toBe("c-rust-systems-2026");
  });

  it("collapses consecutive separators", () => {
    expect(slugify("a  --  b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("removes diacritics", () => {
    expect(slugify("Café Résumé")).toBe("cafe-resume");
  });

  it("returns empty string for symbol-only input", () => {
    expect(slugify("!!!")).toBe("");
  });

  it("caps length at 80 characters", () => {
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("slugifyUnique", () => {
  it("appends the suffix", () => {
    expect(slugifyUnique("My Course", "a1b2")).toBe("my-course-a1b2");
  });

  it("falls back to the suffix alone when the base is empty", () => {
    expect(slugifyUnique("!!!", "a1b2")).toBe("a1b2");
  });
});
