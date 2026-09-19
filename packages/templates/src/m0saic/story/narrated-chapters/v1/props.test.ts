import { coerceStoryProp, validateStoryShape } from "./props";
import type { StoryDocument } from "./props";

describe("coerceStoryProp", () => {
  it("treats absent/null/empty as demo mode, not an error", () => {
    expect(coerceStoryProp(undefined)).toEqual({ story: null, errors: [] });
    expect(coerceStoryProp(null)).toEqual({ story: null, errors: [] });
    expect(coerceStoryProp("  ")).toEqual({ story: null, errors: [] });
  });

  it("accepts an object as-is", () => {
    const story = { schemaVersion: 1, sections: [] };
    expect(coerceStoryProp(story).story).toBe(story);
  });

  it("parses a JSON string (type:'json' props can arrive stringified)", () => {
    const r = coerceStoryProp('{"schemaVersion":1,"title":"T","sections":[]}');
    expect(r.errors).toEqual([]);
    expect(r.story).toEqual({ schemaVersion: 1, title: "T", sections: [] });
  });

  it("reports a malformed JSON string", () => {
    const r = coerceStoryProp("{ not json");
    expect(r.story).toBeNull();
    expect(r.errors[0]).toContain("not valid JSON");
  });

  it("rejects non-object stories", () => {
    expect(coerceStoryProp(42).errors[0]).toContain("must be a story object");
    expect(coerceStoryProp([1, 2]).errors[0]).toContain("must be a story object");
  });
});

describe("validateStoryShape", () => {
  const valid: StoryDocument = {
    schemaVersion: 1,
    title: "T",
    sections: [{ narrationText: "x" }],
  };

  it("passes a valid story with no errors", () => {
    expect(validateStoryShape(valid)).toEqual([]);
  });

  it("tolerates an omitted schemaVersion but rejects a wrong one", () => {
    const { schemaVersion, ...rest } = valid;
    expect(validateStoryShape(rest as StoryDocument)).toEqual([]);
    expect(validateStoryShape({ ...valid, schemaVersion: 2 })[0]).toContain("schemaVersion 2");
  });

  it("requires a non-empty sections array within the cap", () => {
    expect(validateStoryShape({ ...valid, sections: undefined })[0]).toContain("non-empty array");
    expect(validateStoryShape({ ...valid, sections: [] })[0]).toContain("non-empty array");
    const many = Array.from({ length: 31 }, () => ({ narrationText: "x" }));
    expect(validateStoryShape({ ...valid, sections: many })[0]).toContain("31");
  });

  it("rejects blank or non-string image entries (index shifts would corrupt imageFocus)", () => {
    const errors = validateStoryShape({
      ...valid,
      sections: [{ narrationText: "x", images: ["/a.jpg", "  ", 42 as never] }],
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("images[1]");
    expect(errors[1]).toContain("images[2]");
  });

  it("rejects non-object sections, naming the index", () => {
    const errors = validateStoryShape({ ...valid, sections: [{ narrationText: "x" }, "nope" as never] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("sections[1]");
  });

  it("rejects unknown outputs values, listing the valid ones", () => {
    const errors = validateStoryShape({ ...valid, outputs: ["landscape", "vertical" as never] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"vertical"');
    expect(errors[0]).toContain('"portrait"');
  });

  it("collects every problem in one pass", () => {
    const errors = validateStoryShape({
      schemaVersion: 3,
      outputs: ["huge" as never],
      sections: [],
    });
    expect(errors).toHaveLength(3);
  });
});
