import { describe, expect, it } from "vitest";

import { computePublishBlockers } from "./publish-rules";

const lecture = (published: boolean) => ({ isPublished: published });
const section = (published: boolean, lectures: { isPublished: boolean }[]) => ({
  isPublished: published,
  lectures,
});

describe("computePublishBlockers", () => {
  it("passes a course with a description and one visible lecture", () => {
    expect(
      computePublishBlockers({
        description: "Learn things",
        sections: [section(true, [lecture(true)])],
      }),
    ).toEqual([]);
  });

  it("blocks a missing description", () => {
    expect(
      computePublishBlockers({
        description: null,
        sections: [section(true, [lecture(true)])],
      }),
    ).toEqual(["Add a course description"]);
  });

  it("blocks a whitespace-only description", () => {
    expect(
      computePublishBlockers({ description: "   ", sections: [section(true, [lecture(true)])] }),
    ).toContain("Add a course description");
  });

  it("blocks when the only published lecture is in an unpublished section", () => {
    expect(
      computePublishBlockers({
        description: "x",
        sections: [section(false, [lecture(true)])],
      }),
    ).toEqual(["Publish at least one lecture inside a published section"]);
  });

  it("blocks when the published section has only draft lectures", () => {
    expect(
      computePublishBlockers({
        description: "x",
        sections: [section(true, [lecture(false), lecture(false)])],
      }),
    ).toEqual(["Publish at least one lecture inside a published section"]);
  });

  it("blocks an empty course on both rules", () => {
    expect(computePublishBlockers({ description: null, sections: [] })).toHaveLength(2);
  });

  it("passes when any one of several sections is visible", () => {
    expect(
      computePublishBlockers({
        description: "x",
        sections: [section(false, [lecture(true)]), section(true, [lecture(false), lecture(true)])],
      }),
    ).toEqual([]);
  });
});
