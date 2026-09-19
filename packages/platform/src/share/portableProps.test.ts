import {
  buildPortablePropsPayload,
  diffPropsAgainstDefaults,
  isPathPropDef,
  stripUntravelableProps,
  type PortablePropsSchema,
} from "./portableProps";

// Fixtures mirror real first-party schemas:
//   imagePath   → brand/qr-stamp/still/v1 (`type: "media"`, picker "file")
//   photos      → collage/image-collage/v1 (`type: "media[]"`)
//   sessionDir  → benchmark/report/v1 (`type: "string"`, picker "folder")
//   subtitles   → a string knob with an `extensions` filter (sidecar file)
//   look        → an alpine-style group with a nested media field
const schema: PortablePropsSchema = {
  imagePath: { type: "media", meta: { control: { picker: "file" } } },
  photos: { type: "media[]" },
  sessionDir: { type: "string", meta: { control: { picker: "folder" } } },
  subtitles: { type: "string", meta: { control: { extensions: ["srt"] } } },
  title: { type: "string" },
  count: { type: "number" },
  look: {
    type: "group",
    fields: {
      logo: { type: "media" },
      accent: { type: "string" },
    },
  },
  items: { type: "list" },
};

describe("isPathPropDef", () => {
  it("flags media, media[], file/folder pickers and extension-filtered strings", () => {
    expect(isPathPropDef(schema.imagePath)).toBe(true);
    expect(isPathPropDef(schema.photos)).toBe(true);
    expect(isPathPropDef(schema.sessionDir)).toBe(true);
    expect(isPathPropDef(schema.subtitles)).toBe(true);
  });
  it("leaves plain knobs alone", () => {
    expect(isPathPropDef(schema.title)).toBe(false);
    expect(isPathPropDef(schema.count)).toBe(false);
    expect(isPathPropDef(schema.look)).toBe(false);
    expect(isPathPropDef(undefined)).toBe(false);
    expect(isPathPropDef({ type: "string", meta: { control: { extensions: [] } } })).toBe(false);
  });
});

describe("stripUntravelableProps", () => {
  it("removes every path-bearing knob and reports the ones that were changed", () => {
    const r = stripUntravelableProps(
      schema,
      {
        imagePath: "/Users/me/logo.png",
        photos: ["/Users/me/a.jpg"],
        sessionDir: "/Users/me/session",
        subtitles: "/Users/me/x.srt",
        title: "kept",
        count: 3,
      },
      { imagePath: "", photos: [], sessionDir: "", subtitles: "", title: "", count: 1 },
    );
    expect(r.props).toEqual({ title: "kept", count: 3 });
    expect(r.stripped).toEqual(["imagePath", "photos", "sessionDir", "subtitles"]);
    expect(r.hadSourceIds).toBe(false);
  });

  it("does not report a path knob still at its default or empty (nothing is lost)", () => {
    const r = stripUntravelableProps(
      schema,
      { imagePath: "placeholder.png", photos: [], title: "t" },
      { imagePath: "placeholder.png", photos: [] },
    );
    expect(r.props).toEqual({ title: "t" });
    expect(r.stripped).toEqual([]);
  });

  it("recurses into a group, reports `group.field`, keeps the sibling", () => {
    const r = stripUntravelableProps(
      schema,
      { look: { logo: "/Users/me/m.png", accent: "#f0f" } },
      { look: { logo: "", accent: "#000" } },
    );
    expect(r.props).toEqual({ look: { accent: "#f0f" } });
    expect(r.stripped).toEqual(["look.logo"]);
  });

  it("strips sourceId / sourceIds without a schema and flags that inputs were set", () => {
    const r = stripUntravelableProps(undefined, { sourceIds: ["/x.mp4"], sourceId: "", title: "t" });
    expect(r.props).toEqual({ title: "t" });
    expect(r.hadSourceIds).toBe(true);
    expect(stripUntravelableProps(undefined, { sourceIds: [] }).hadSourceIds).toBe(false);
  });

  it("keeps unknown keys and list items untouched", () => {
    const r = stripUntravelableProps(schema, { mystery: 1, items: [{ path: "/x" }] });
    expect(r.props).toEqual({ mystery: 1, items: [{ path: "/x" }] });
  });
});

describe("diffPropsAgainstDefaults", () => {
  it("keeps only changed keys, by JSON equality", () => {
    const defaults = { a: 1, b: [1, 2], c: { x: 1 }, d: "s" };
    expect(diffPropsAgainstDefaults({ a: 1, b: [1, 2], c: { x: 1 }, d: "t" }, defaults)).toEqual({ d: "t" });
    expect(diffPropsAgainstDefaults({ b: [1, 3], c: { x: 1, y: 2 } }, defaults)).toEqual({ b: [1, 3], c: { x: 1, y: 2 } });
  });
  it("includes keys the defaults don't have and skips undefined values", () => {
    expect(diffPropsAgainstDefaults({ extra: true, gone: undefined }, {})).toEqual({ extra: true });
  });
});

describe("buildPortablePropsPayload", () => {
  it("strips first, then diffs — a changed path prop is reported, not silently dropped", () => {
    const r = buildPortablePropsPayload({
      props: { imagePath: "/Users/me/x.png", title: "Changed", count: 1, sourceIds: ["/v.mp4"] },
      defaults: { imagePath: "", title: "Default", count: 1 },
      schema,
    });
    expect(r.props).toEqual({ title: "Changed" });
    expect(r.stripped).toEqual(["imagePath"]);
    expect(r.hadSourceIds).toBe(true);
  });
  it("works with no defaults and no schema", () => {
    expect(buildPortablePropsPayload({ props: { a: 1 }, defaults: undefined, schema: undefined })).toEqual({
      props: { a: 1 },
      stripped: [],
      hadSourceIds: false,
    });
  });
});
