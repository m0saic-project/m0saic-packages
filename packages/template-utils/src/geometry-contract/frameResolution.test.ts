import type { MosaicDocument, MosaicSource, MosaicTemplatePropDefinition } from "@m0saic/types";
import { placeInsetPieces } from "../layout/placeInsetPieces";
import { bindProp, bindPropPath, bindPropRange, bindPropRect, bindProps, tag } from "./layoutConstraint";
import { resolveDocFrames, resolvePropBindings } from "./frameResolution";

// ── fixtures ────────────────────────────────────────────────────────────────
type Piece = { x: number; y: number; w: number; h: number; source: MosaicSource };

const lavfi = (): MosaicSource => ({ type: "lavfi", color: "#000000" } as unknown as MosaicSource);

/** Real front door: pieces ride through placeInsetPieces (zero drift). */
const docOf = (pieces: Piece[], W: number, H: number, extra?: Partial<MosaicDocument>): MosaicDocument => {
  const { m0, sources } = placeInsetPieces({
    rootW: W,
    rootH: H,
    pieces: pieces.map((p) => ({ rect: { x: p.x, y: p.y, w: p.w, h: p.h }, source: p.source })),
  });
  return { kind: "mosaic_document", version: 1, assets: {} as any, m0: String(m0) as any, sources, ...extra } as MosaicDocument;
};

const def = (type: MosaicTemplatePropDefinition["type"], fields?: Record<string, MosaicTemplatePropDefinition>): MosaicTemplatePropDefinition =>
  ({ type, required: false, ...(fields ? { fields } : {}) });

const SCHEMA: Record<string, MosaicTemplatePropDefinition> = {
  title: def("string"),
  labels: def("string[]"),
  values: def("number[]"),
  on: def("boolean"),
  titles: def("group", { title: def("string") }),
};

describe("resolveDocFrames", () => {
  it("joins source tags to stableKeys by logicalIndex", () => {
    const doc = docOf(
      [
        { x: 0, y: 0, w: 500, h: 500, source: tag(lavfi(), "a") },
        { x: 500, y: 500, w: 500, h: 500, source: tag(lavfi(), "b") },
      ],
      1000,
      1000,
    );
    const r = resolveDocFrames(doc, 1000, 1000);
    expect(r.labelToIndices.get("a")).toHaveLength(1);
    expect(r.labelToIndices.get("b")).toHaveLength(1);
    const keyA = Object.entries(r.resolvedLabels).find(([, l]) => l === "a")![0];
    expect(String(r.framesByLogical[r.labelToIndices.get("a")![0]].meta.stableKey)).toBe(keyA);
  });
});

describe("resolvePropBindings", () => {
  it("resolves root bindings to stableKey + sourceIndex in logical order", () => {
    const doc = docOf(
      [
        { x: 0, y: 0, w: 1000, h: 200, source: bindProp(tag(lavfi(), "hdr"), "title") },
        { x: 0, y: 300, w: 400, h: 200, source: bindProp(lavfi(), "labels", 0) },
        { x: 600, y: 300, w: 400, h: 200, source: bindProp(lavfi(), "labels", 1) },
        { x: 0, y: 700, w: 1000, h: 200, source: lavfi() }, // unbound
      ],
      1000,
      1000,
    );
    const { byProp, rejected } = resolvePropBindings(doc, 1000, 1000);
    expect(rejected).toEqual([]);
    expect(Object.keys(byProp).sort()).toEqual(["labels", "title"]);
    expect(byProp.title).toHaveLength(1);
    expect(byProp.title[0]).toMatchObject({ propKey: "title", sourceIndex: 0, childPath: [] });
    expect("index" in byProp.title[0]).toBe(false);
    expect(byProp.labels.map((b) => b.index)).toEqual([0, 1]);
    expect(byProp.labels.map((b) => b.sourceIndex)).toEqual([1, 2]);
    // the stableKey is the frame's own key — same one the label resolver reports
    const frames = resolveDocFrames(doc, 1000, 1000);
    expect(byProp.title[0].stableKey).toBe(String(frames.framesByLogical[0].meta.stableKey));
    expect(frames.resolvedLabels[byProp.title[0].stableKey]).toBe("hdr");
  });

  it("walks mosaic-ref children with childPath, and can skip them", () => {
    const plot = docOf(
      [
        { x: 0, y: 0, w: 200, h: 400, source: bindProp(lavfi(), "values", 0) },
        { x: 300, y: 0, w: 200, h: 400, source: bindProp(lavfi(), "values", 1) },
      ],
      500,
      400,
    );
    const root = docOf(
      [
        { x: 0, y: 0, w: 1000, h: 100, source: bindProp(lavfi(), "title") },
        { x: 250, y: 200, w: 500, h: 400, source: { type: "mosaic", ref: "plot" } as unknown as MosaicSource },
      ],
      1000,
      1000,
      { children: { plot } },
    );
    const { byProp } = resolvePropBindings(root, 1000, 1000);
    expect(byProp.title[0].childPath).toEqual([]);
    expect(byProp.values).toHaveLength(2);
    expect(byProp.values.map((b) => b.index)).toEqual([0, 1]);
    expect(byProp.values.every((b) => b.childPath.length === 1 && b.childPath[0] === "plot")).toBe(true);
    // child keys are doc-local: they equal what the child resolves on its own
    const own = resolvePropBindings(plot, 500, 400);
    expect(byProp.values.map((b) => b.stableKey)).toEqual(own.byProp.values.map((b) => b.stableKey));

    const noKids = resolvePropBindings(root, 1000, 1000, { children: false });
    expect(noKids.byProp.values).toBeUndefined();
    expect(noKids.byProp.title).toHaveLength(1);
  });

  it("files schema rejections instead of resolving them", () => {
    const doc = docOf(
      [
        { x: 0, y: 0, w: 200, h: 200, source: bindProp(lavfi(), "ghost") }, // unknown
        { x: 300, y: 0, w: 200, h: 200, source: bindProp(lavfi(), "labels") }, // list w/o index
        { x: 600, y: 0, w: 200, h: 200, source: bindProp(lavfi(), "on") }, // boolean
        { x: 0, y: 400, w: 200, h: 200, source: bindProp(lavfi(), "titles.title") }, // dotted ok
        { x: 300, y: 400, w: 200, h: 200, source: bindProp(lavfi(), "titles") }, // group itself
        { x: 600, y: 400, w: 200, h: 200, source: bindProp(lavfi(), "values", 3) }, // ok
      ],
      1000,
      1000,
    );
    const { byProp, rejected } = resolvePropBindings(doc, 1000, 1000, { propsSchema: SCHEMA });
    expect(Object.keys(byProp).sort()).toEqual(["titles.title", "values"]);
    expect(byProp.values[0]).toMatchObject({ index: 3, sourceIndex: 5 });
    expect(rejected.map((r) => [r.propKey, r.reason])).toEqual([
      ["ghost", "unknown-prop"],
      ["labels", "index-required"],
      ["on", "unsupported-type"],
      ["titles", "unsupported-type"],
    ]);
    // without a schema nothing is rejected — the resolver is schema-agnostic by default
    expect(resolvePropBindings(doc, 1000, 1000).rejected).toEqual([]);
  });

  it("media props resolve like their text twins: scalar whole, list by index, structured leaf by path + kind", () => {
    const schema: Record<string, MosaicTemplatePropDefinition> = {
      ...SCHEMA,
      facecam: def("media"),
      teasers: def("media[]"),
      rows: def("json"),
    };
    const doc = docOf(
      [
        { x: 0, y: 0, w: 200, h: 200, source: bindProp(lavfi(), "facecam") }, // ok
        { x: 300, y: 0, w: 200, h: 200, source: bindProp(lavfi(), "teasers") }, // list w/o index
        { x: 600, y: 0, w: 200, h: 200, source: bindProp(lavfi(), "teasers", 1) }, // ok
        { x: 0, y: 400, w: 200, h: 200, source: bindPropPath(lavfi(), "rows", [2, "image"], "media") }, // ok
        { x: 300, y: 400, w: 200, h: 200, source: bindProps(lavfi(), [{ propKey: "rows", path: [2, "image"] }]) }, // no kind
      ],
      1000,
      1000,
    );
    const { byProp, rejected } = resolvePropBindings(doc, 1000, 1000, { propsSchema: schema });
    expect(Object.keys(byProp).sort()).toEqual(["facecam", "rows", "teasers"]);
    expect(byProp.teasers[0]).toMatchObject({ index: 1, sourceIndex: 2 });
    expect(rejected.map((r) => [r.propKey, r.reason])).toEqual([
      ["teasers", "index-required"],
      ["rows", "kind-required"],
    ]);
  });

  it("never throws: invalid m0 resolves to nothing", () => {
    const doc = { kind: "mosaic_document", version: 1, assets: {} as any, m0: "not m0 at all" as any, sources: [bindProp(lavfi(), "title")] } as MosaicDocument;
    expect(resolvePropBindings(doc, 1000, 1000)).toEqual({ byProp: {}, rejected: [] });
  });
});

describe("resolvePropBindings — structured (json/list) leaves", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bindPropPath } = require("./layoutConstraint") as typeof import("./layoutConstraint");
  const rowsSchema: Record<string, MosaicTemplatePropDefinition> = {
    ...SCHEMA,
    rows: { type: "array", required: true } as unknown as MosaicTemplatePropDefinition,
  };

  it("resolves leaf bindings with their full path + declared kind, in source order", () => {
    const doc = docOf(
      [
        { x: 0, y: 0, w: 500, h: 200, source: bindPropPath(lavfi(), "rows", [0, "title"], "string") },
        { x: 500, y: 0, w: 500, h: 200, source: bindPropPath(lavfi(), "rows", [0, "pr"], "number") },
        { x: 0, y: 300, w: 500, h: 200, source: bindPropPath(lavfi(), "rows", [1, "title"], "string") },
        { x: 500, y: 300, w: 500, h: 200, source: bindPropPath(lavfi(), "rows", [1, "reviewers", 0], "string") },
      ],
      1000,
      1000,
    );
    const { byProp, rejected } = resolvePropBindings(doc, 1000, 1000, { propsSchema: rowsSchema });
    expect(rejected).toEqual([]);
    expect(byProp.rows.map((b) => b.path)).toEqual([[0, "title"], [0, "pr"], [1, "title"], [1, "reviewers", 0]]);
    expect(byProp.rows.map((b) => b.kind)).toEqual(["string", "number", "string", "string"]);
    expect(byProp.rows.every((b) => b.index === undefined)).toBe(true);
    // basic bindings now report their kind + folded path too
    const basic = resolvePropBindings(docOf([{ x: 0, y: 0, w: 1000, h: 1000, source: bindProp(lavfi(), "labels", 3) }], 1000, 1000), 1000, 1000, { propsSchema: rowsSchema });
    expect(basic.byProp.labels[0]).toMatchObject({ index: 3, path: [3], kind: "string" });
  });

  it("files path-required / kind-required for structured props, index-required for basic lists", () => {
    const doc = docOf(
      [
        { x: 0, y: 0, w: 300, h: 300, source: bindProp(lavfi(), "rows") }, // no path
        { x: 350, y: 0, w: 300, h: 300, source: (() => { const s = lavfi() as any; s.editor = { binding: { propKey: "rows", path: [0, "title"] } }; return s as MosaicSource; })() }, // no kind
        { x: 700, y: 0, w: 300, h: 300, source: bindProp(lavfi(), "labels") },
      ],
      1000,
      1000,
    );
    const { rejected, byProp } = resolvePropBindings(doc, 1000, 1000, { propsSchema: rowsSchema });
    expect(byProp).toEqual({});
    expect(rejected.map((r) => r.reason)).toEqual(["path-required", "kind-required", "index-required"]);
  });
});

describe("bindPropRange — one line of a string prop", () => {
  type Span = { start: number; end: number };
  const src = () =>
    ({ type: "lavfi", color: "#000" }) as {
      type: string;
      color: string;
      editor?: { binding?: { propKey: string; index?: number; range?: Span; focus?: Span } };
    };
  it("stamps range + focus (raw-prop offsets) and validates them", () => {
    const b = bindPropRange(src(), "states", 1, { start: 19, end: 30 }, { start: 19, end: 25 });
    expect(b.editor?.binding).toEqual({ propKey: "states", index: 1, range: { start: 19, end: 30 }, focus: { start: 19, end: 25 } });
    expect(bindPropRange(src(), "lyrics", undefined, { start: 0, end: 0 }).editor?.binding).toEqual({ propKey: "lyrics", range: { start: 0, end: 0 } });
    expect(() => bindPropRange(src(), "states", 0, { start: 5, end: 2 })).toThrow(/range/);
    expect(() => bindPropRange(src(), "states", 0, { start: 0, end: 4 }, { start: 2, end: 6 })).toThrow(/focus/);
    expect(() => bindPropRange(src(), "states", -1, { start: 0, end: 4 })).toThrow(/index/);
    expect(() => bindPropRange(src(), "", 0, { start: 0, end: 4 })).toThrow(/propKey/);
  });
});

describe("rect bindings", () => {
  const schema = {
    facecamRegion: { type: "json", required: false, description: "d", meta: { control: { picker: "regions", regions: { max: 1 } } } },
    rows: { type: "json", required: false, description: "d" },
  } as unknown as Record<string, MosaicTemplatePropDefinition>;
  const cell = (): MosaicSource => ({ type: "lavfi", color: "#000" } as unknown as MosaicSource);
  const docWith = (src: MosaicSource): MosaicDocument =>
    ({
      kind: "mosaic_document",
      version: 1,
      m0: "F",
      sources: [src],
      size: { width: 640, height: 360 },
      fps: 30,
      durationMs: 1000,
    }) as unknown as MosaicDocument;

  it("bindPropRect on a one-region regions picker resolves to the cell's frame", () => {
    const doc = docWith(bindPropRect(tag(cell(), "facecam"), "facecamRegion"));
    const res = resolvePropBindings(doc, 640, 360, { propsSchema: schema });
    expect(res.rejected).toEqual([]);
    expect(res.byProp.facecamRegion).toHaveLength(1);
    expect(res.byProp.facecamRegion[0]).toMatchObject({ propKey: "facecamRegion", kind: "rect", sourceIndex: 0, childPath: [] });
    expect(typeof res.byProp.facecamRegion[0].stableKey).toBe("string");
  });
  it("a rect binding on any other structured prop is rejected as unsupported-type", () => {
    const doc = docWith(bindPropRect(cell(), "rows"));
    const res = resolvePropBindings(doc, 640, 360, { propsSchema: schema });
    expect(res.rejected.map((r) => r.reason)).toEqual(["unsupported-type"]);
  });
  it("bindPropRect with an index binds ONE element of a rect-list picker; the index is the path", () => {
    const listSchema = {
      ...schema,
      bubbles: { type: "json", required: false, description: "d", meta: { control: { picker: "regions", shapes: ["rect"] } } },
    } as unknown as Record<string, MosaicTemplatePropDefinition>;
    const doc = docWith(bindPropRect(tag(cell(), "balloon"), "bubbles", 3));
    const res = resolvePropBindings(doc, 640, 360, { propsSchema: listSchema });
    expect(res.rejected).toEqual([]);
    expect(res.byProp.bubbles[0]).toMatchObject({ propKey: "bubbles", index: 3, path: [3], kind: "rect", sourceIndex: 0 });
    // The same index on the ONE-region picker is refused (it binds whole).
    const whole = resolvePropBindings(docWith(bindPropRect(cell(), "facecamRegion", 0)), 640, 360, { propsSchema: listSchema });
    expect(whole.rejected.map((r) => r.reason)).toEqual(["unsupported-type"]);
    expect(() => bindPropRect(cell(), "bubbles", -1)).toThrow(/index/);
    expect(() => bindPropRect(cell(), "bubbles", 1.5)).toThrow(/index/);
  });
});
