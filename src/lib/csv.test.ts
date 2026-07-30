import { describe, expect, it } from "vitest";

import { buildCsv, csvCell, neutralizeFormula } from "./csv";

describe("csvCell", () => {
  it.each([
    ["plain", "plain"],
    ["has,comma", '"has,comma"'],
    ['has"quote', '"has""quote"'],
    ["line\nbreak", '"line\nbreak"'],
    ["", ""],
    ["carriage\rreturn", '"carriage\rreturn"'],
  ])("escapes %j -> %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });
});

describe("neutralizeFormula", () => {
  it.each([
    ["=cmd()", "'=cmd()"],
    ["+1", "'+1"],
    ["-1+2", "'-1+2"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ['=HYPERLINK("http://evil")', '\'=HYPERLINK("http://evil")'],
    ["Priya Sharma", "Priya Sharma"],
    ["student1@demo.lms", "student1@demo.lms"],
    ["", ""],
  ])("guards %j -> %j", (input, expected) => {
    expect(neutralizeFormula(input)).toBe(expected);
  });

  it("a guarded value still round-trips through csvCell quoting", () => {
    // "=A1,B1" needs both the formula guard AND structural quoting.
    expect(csvCell(neutralizeFormula("=A1,B1"))).toBe('"\'=A1,B1"');
  });
});

describe("buildCsv", () => {
  it("joins cells and rows with commas and CRLF, trailing newline", () => {
    expect(
      buildCsv([
        ["a", "b"],
        ["1", "2"],
      ]),
    ).toBe("a,b\r\n1,2\r\n");
  });

  it("quotes fields that would otherwise break the structure", () => {
    expect(
      buildCsv([
        ["name", "note"],
        ["Ada, Jr", 'said "hi"'],
      ]),
    ).toBe('name,note\r\n"Ada, Jr","said ""hi"""\r\n');
  });

  it("handles an empty grade cell", () => {
    expect(buildCsv([["Bob", ""]])).toBe("Bob,\r\n");
  });
});
