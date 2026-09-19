import { parseM0StringToFullGraph, type EditorFrame } from "@m0saic/dsl";
import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import {
  bakeDocumentInsets,
  countDocumentInsetSources,
  countRenderableInsetsDeep,
} from "./bakeDocumentInsets";

const CANVAS = { w: 200, h: 200 };

function doc(m0: string, sources: MosaicSource[], labels?: Record<string, string>): MosaicDocument {
  const d: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: m0 as MosaicDocument["m0"],
    assets: {} as MosaicDocument["assets"],
    sources,
  };
  if (labels) d.labels = labels;
  return d;
}

function src(marker: string, inset?: unknown): MosaicSource {
  const s: Record<string, unknown> = { type: "lavfi", marker };
  if (inset != null) s.placement = { inset };
  return s as unknown as MosaicSource;
}
function dataSrc(marker: string): MosaicSource {
  return { type: "data", marker } as unknown as MosaicSource;
}
function markers(sources: MosaicSource[]): string[] {
  return sources.map((s) => (s as unknown as { marker: string }).marker);
}
function renderedLeaves(m0: string): EditorFrame[] {
  return parseM0StringToFullGraph(m0, CANVAS.w, CANVAS.h).filter(
    (f) => (f.kind === "frame" || f.kind === "root") && f.logicalIndex != null,
  );
}
function rectOf(f: EditorFrame): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(f.x),
    y: Math.round(f.y),
    w: Math.round(f.width),
    h: Math.round(f.height),
  };
}

// Two columns at 200×200 — each cell exactly 100×200.
const COLS = "2(1,1)";

describe("bakeDocumentInsets", () => {
  it("bakes a source inset into exact geometry and strips the fiber", () => {
    // 10% inset on the second cell: floor(.1·100)=10 x-edges, floor(.1·200)=20 y-edges.
    const input = doc(COLS, [src("s0"), src("s1", 0.1)]);
    const res = bakeDocumentInsets(input, CANVAS);
    if (!res.ok) throw new Error(res.error);

    expect(res.insetCount).toBe(1);
    expect(res.dslLengthAfter).toBeGreaterThan(res.dslLengthBefore);

    // The baked doc's rendered rects: cell 0 untouched, cell 1 shrunk by the
    // engine's exact floor math.
    const rects = renderedLeaves(res.doc.m0)
      .map((f) => {
        const idx = f.logicalIndex!;
        return { idx, ...rectOf(f) };
      })
      .sort((a, b) => a.idx - b.idx);
    const bakedMarkers = markers(res.doc.sources);
    // Source order follows the rebuilt frame order — marker s1's frame is the
    // shrunk one wherever it landed.
    const s1Frame = rects[bakedMarkers.indexOf("s1")]!;
    expect({ x: s1Frame.x, y: s1Frame.y, w: s1Frame.w, h: s1Frame.h }).toEqual({
      x: 110,
      y: 20,
      w: 80,
      h: 160,
    });

    // Every placement.inset is gone — the doc is inset-free.
    expect(countDocumentInsetSources(res.doc)).toBe(0);
    for (const s of res.doc.sources) {
      expect((s as { placement?: { inset?: unknown } }).placement?.inset).toBeUndefined();
    }

    // Record: a rebuild whose nodes carry the bake intent.
    expect(res.record.kind).toBe("rebuild");
    expect(res.record.movedSourceCount).toBe(1);
    expect(res.record.nodes).toHaveLength(1);
    const node = res.record.nodes![0]!;
    expect(node.prevRect).toEqual({ x: 100, y: 0, w: 100, h: 200 });
    expect(node.nextRect).toEqual({ x: 110, y: 20, w: 80, h: 160 });
    expect(res.doc.editor?.geometryEdits).toHaveLength(1);
  });

  it("resolves the MosaicBoxFrac authoring superset (x/y shorthand)", () => {
    const input = doc(COLS, [src("s0", { x: 0.2 }), src("s1")]);
    const res = bakeDocumentInsets(input, CANVAS);
    if (!res.ok) throw new Error(res.error);
    const bakedMarkers = markers(res.doc.sources);
    const rects = renderedLeaves(res.doc.m0).sort(
      (a, b) => a.logicalIndex! - b.logicalIndex!,
    );
    const s0 = rectOf(rects[bakedMarkers.indexOf("s0")]!);
    // x shorthand → left/right only: floor(.2·100)=20 each side, no y change.
    expect(s0).toEqual({ x: 20, y: 0, w: 60, h: 200 });
  });

  it("refuses a doc with nothing to bake (UI disables, this is the backstop)", () => {
    const res = bakeDocumentInsets(doc(COLS, [src("s0"), src("s1")]), CANVAS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no render-time insets/);
  });

  it("counts only renderable sources with non-identity insets", () => {
    expect(countDocumentInsetSources(doc(COLS, [src("s0"), src("s1")]))).toBe(0);
    expect(countDocumentInsetSources(doc(COLS, [src("s0", 0), src("s1", 0.1)]))).toBe(1);
    // Data sources never count (they hold no cell).
    const withData = doc(COLS, [src("s0", 0.1), src("s1")]);
    withData.sources.push(dataSrc("d0"));
    expect(countDocumentInsetSources(withData)).toBe(1);
  });

  it("keeps data sources in place and rejects non-flat docs", () => {
    const withData = doc(COLS, [src("s0", 0.1), dataSrc("d0"), src("s1")]);
    const res = bakeDocumentInsets(withData, CANVAS);
    if (!res.ok) throw new Error(res.error);
    expect((res.doc.sources[1] as unknown as { marker: string }).marker).toBe("d0");

    const nested = doc(COLS, [src("s0", 0.1), src("s1")]);
    (nested as { children?: Record<string, unknown> }).children = {
      kid: { kind: "mosaic_document" },
    } as never;
    const nestedRes = bakeDocumentInsets(nested, CANVAS);
    expect(nestedRes.ok).toBe(false);
    if (!nestedRes.ok) expect(nestedRes.error).toMatch(/FLAT/);
  });

  it("is deterministic", () => {
    const input = doc(COLS, [src("s0"), src("s1", 0.1)]);
    const a = bakeDocumentInsets(input, CANVAS);
    const b = bakeDocumentInsets(input, CANVAS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("countRenderableInsetsDeep", () => {
  it("counts across nested children and pipeline steps", () => {
    const child = doc(COLS, [src("c0", 0.1), src("c1", 0.05)]);
    const parent = doc(COLS, [src("p0", 0.1), src("p1")]);
    (parent as { children?: Record<string, unknown> }).children = { kid: child } as never;
    expect(countRenderableInsetsDeep(parent)).toBe(3);

    const pipeline = { kind: "mosaic_pipeline", steps: [{ file: parent }] };
    expect(countRenderableInsetsDeep(pipeline)).toBe(3);
  });

  it("returns 0 for inset-free trees, null, and unknown kinds", () => {
    expect(countRenderableInsetsDeep(doc(COLS, [src("s0"), src("s1")]))).toBe(0);
    expect(countRenderableInsetsDeep(null)).toBe(0);
    expect(countRenderableInsetsDeep({ kind: "nope" })).toBe(0);
  });

  it("survives cyclic children", () => {
    const a = doc(COLS, [src("s0", 0.1), src("s1")]);
    (a as { children?: Record<string, unknown> }).children = { self: a } as never;
    expect(countRenderableInsetsDeep(a)).toBe(1);
  });
});
