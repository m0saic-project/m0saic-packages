import { parseM0StringToFullGraph, validateM0String, type EditorFrame } from "@m0saic/dsl";
import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import { placeRect, addOverlayLayer, getLayerCount } from "@m0saic/dsl-stdlib";
import { rebuildDocumentGeometry, computeRebuildFloor } from "./rebuildDocumentGeometry";
import { applyRectEditToMosaicDocument } from "./applyRectEditToMosaicDocument";
import { serializeMosaicDocument } from "../serializeMosaicDocument";

const CANVAS = { w: 200, h: 200 };

function doc(m0: string, sources: MosaicSource[], labels?: Record<string, string>): MosaicDocument {
  const d: MosaicDocument = {
    kind: "mosaic_document",
    size: { width: 640, height: 360 },
    version: 1,
    m0: m0 as MosaicDocument["m0"],
    assets: {} as MosaicDocument["assets"],
    sources,
  };
  if (labels) d.labels = labels;
  return d;
}

function src(marker: string): MosaicSource {
  return { type: "lavfi", marker } as unknown as MosaicSource;
}
function dataSrc(marker: string): MosaicSource {
  return { type: "data", marker } as unknown as MosaicSource;
}
function refSrc(marker: string, flattenedStableKey: string): MosaicSource {
  return { type: "ref", marker, flattenedStableKey } as unknown as MosaicSource;
}
function markers(sources: MosaicSource[]): string[] {
  return sources.map((s) => (s as unknown as { marker: string }).marker);
}
function frames(m0: string): EditorFrame[] {
  return parseM0StringToFullGraph(m0, CANVAS.w, CANVAS.h);
}
function keyOf(m0: string, kind: string, index: number): string {
  const matches = frames(m0).filter((f) => f.kind === kind);
  if (index >= matches.length) throw new Error(`no ${kind} #${index}`);
  return String(matches[index]!.meta.stableKey);
}
function renderedGeometry(m0: string): string[] {
  return frames(m0)
    .filter((f) => (f.kind === "frame" || f.kind === "root") && f.logicalIndex != null)
    .map((f) => `${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.width)},${Math.round(f.height)}`)
    .sort();
}
function renderedEditorFrames(m0: string) {
  return frames(m0).filter(
    (f) => (f.kind === "frame" || f.kind === "root") && f.logicalIndex != null,
  );
}

// 2×2 grid at 200×200 — each cell exactly 100×100.
const GRID = "2(2[1,1],2[1,1])";

describe("rebuildDocumentGeometry — group move (proportional scaling)", () => {
  it("scales descendant leaves keeping shared sibling edges coincident", () => {
    const groupKey = keyOf(GRID, "group", 0); // left column {0,0,100,200}, two rows
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    const r = rebuildDocumentGeometry(input, {
      stableKey: groupKey,
      rect: { x: 50, y: 50, w: 100, h: 100 },
      canvas: CANVAS,
    });
    if (!r.ok) throw new Error(r.error);
    expect(validateM0String(r.doc.m0).ok).toBe(true);
    // Left column's two rows scale into {50,50,100,100}: {50,50,100,50} and
    // {50,100,100,50} — their shared edge at y=100 stays coincident. The right
    // column is untouched.
    expect(renderedGeometry(r.doc.m0)).toEqual(
      ["100,0,100,100", "100,100,100,100", "50,100,100,50", "50,50,100,50"].sort(),
    );
    expect(r.record.kind).toBe("rebuild");
    expect(r.record.scope).toBe("subtree");
    expect(r.record.nodes).toHaveLength(2);
    expect(r.record.movedSourceCount).toBe(2);
  });

  it("rejects a rect that collapses a descendant leaf below 1px (returns the floor)", () => {
    const groupKey = keyOf(GRID, "group", 0);
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    const r = rebuildDocumentGeometry(input, {
      stableKey: groupKey,
      rect: { x: 0, y: 0, w: 100, h: 1 }, // 2 rows can't fit in 1px
      canvas: CANVAS,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/needs ≥ 1x2/);
  });
});

describe("computeRebuildFloor", () => {
  it("bare leaf → 1×1", () => {
    expect(computeRebuildFloor(GRID, keyOf(GRID, "frame", 0), CANVAS)).toEqual({ w: 1, h: 1 });
  });
  it("left column (two stacked rows) → 1×2", () => {
    expect(computeRebuildFloor(GRID, keyOf(GRID, "group", 0), CANVAS)).toEqual({ w: 1, h: 2 });
  });
  it("root over the whole 2×2 → 2×2", () => {
    expect(computeRebuildFloor(GRID, keyOf(GRID, "root", 0), CANVAS)).toEqual({ w: 2, h: 2 });
  });
});

describe("rebuildDocumentGeometry — rect_only", () => {
  const M0 = "2(1{1},1)"; // left leaf {0,0,100,200} + its overlay; right leaf {100,0,100,200}
  it("moves only the node's own leaf; overlay descendants keep their rects", () => {
    const leafKey = keyOf(M0, "frame", 0);
    const input = doc(M0, [src("s0"), src("s1"), src("s2")]);
    const r = rebuildDocumentGeometry(input, {
      stableKey: leafKey,
      rect: { x: 120, y: 20, w: 60, h: 60 },
      canvas: CANVAS,
      scope: "rect_only",
    });
    if (!r.ok) throw new Error(r.error);
    const geo = renderedGeometry(r.doc.m0);
    expect(geo).toContain("120,20,60,60"); // base moved
    expect(geo).toContain("0,0,100,200"); // overlay child stayed
    expect(geo).toContain("100,0,100,200"); // right leaf untouched
    expect(r.record.scope).toBe("rect_only");
    expect(r.record.movedSourceCount).toBe(1);
  });

  it("rejects rect_only on a group node", () => {
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    const r = rebuildDocumentGeometry(input, {
      stableKey: keyOf(GRID, "group", 0),
      rect: { x: 0, y: 0, w: 50, h: 50 },
      canvas: CANVAS,
      scope: "rect_only",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/rendered leaf/);
  });
});

describe("rebuildDocumentGeometry — z order", () => {
  // Two overlapping tiles: base {0,0,100,100} (paints first), overlay {50,50,100,100}.
  const base = String(placeRect({ rootW: 200, rootH: 200, rectW: 100, rectH: 100, x: 0, y: 0 }).m0);
  const over = String(placeRect({ rootW: 200, rootH: 200, rectW: 100, rectH: 100, x: 50, y: 50 }).m0);
  const OVL = addOverlayLayer(base, over);

  it("bring-to-front lifts the base leaf above the overlay", () => {
    const baseLeaf = keyOf(OVL, "frame", 0);
    const input = doc(OVL, [src("base"), src("over")]);
    const r = rebuildDocumentGeometry(input, {
      stableKey: baseLeaf,
      z: { op: "front" },
      canvas: CANVAS,
    });
    if (!r.ok) throw new Error(r.error);
    expect(renderedGeometry(r.doc.m0)).toEqual(renderedGeometry(OVL));
    const fr = renderedEditorFrames(r.doc.m0);
    const fbase = fr.find((f) => Math.round(f.x) === 0)!;
    const fover = fr.find((f) => Math.round(f.x) === 50)!;
    expect(fbase.overlayDepth).toBeGreaterThan(fover.overlayDepth);
    expect(r.record.z?.op).toBe("front");
    expect(r.record.z!.nextPaintIndex).toBeGreaterThan(r.record.z!.prevPaintIndex);
  });

  it("forward on a node overlapping nothing later is a no-op move", () => {
    // GRID cells are disjoint — nothing overlaps, so 'forward' can't move.
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    const r = rebuildDocumentGeometry(input, {
      stableKey: keyOf(GRID, "frame", 0),
      z: { op: "forward" },
      canvas: CANVAS,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.record.z!.prevPaintIndex).toBe(r.record.z!.nextPaintIndex);
    expect(renderedGeometry(r.doc.m0)).toEqual(renderedGeometry(GRID));
  });
});

describe("rebuildDocumentGeometry — sources", () => {
  it("keeps an interleaved data source pinned and preserves the renderable multiset", () => {
    const leafKey = keyOf(GRID, "frame", 0);
    const input = doc(GRID, [src("s0"), dataSrc("d0"), src("s1"), src("s2"), src("s3")]);
    const r = rebuildDocumentGeometry(input, {
      stableKey: leafKey,
      rect: { x: 10, y: 10, w: 50, h: 50 },
      canvas: CANVAS,
    });
    if (!r.ok) throw new Error(r.error);
    // Data source holds its absolute position; no renderable lost or duplicated.
    expect(markers(r.doc.sources)[1]).toBe("d0");
    expect(markers(r.doc.sources).filter((m) => m !== "d0").sort()).toEqual(["s0", "s1", "s2", "s3"]);
  });

  it("handles the renderable-root gotcha (root counts as a rendered leaf)", () => {
    // 1{2(1,1)}: root paints source #0; two overlay cells are #1/#2.
    const ROOT_OV = "1{2(1,1)}";
    const leafKey = keyOf(ROOT_OV, "frame", 0);
    const input = doc(ROOT_OV, [src("bg"), src("s1"), src("s2")]);
    const r = rebuildDocumentGeometry(input, {
      stableKey: leafKey,
      rect: { x: 10, y: 10, w: 50, h: 50 },
      canvas: CANVAS,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.record.movedSourceCount).toBe(1);
    expect(markers(r.doc.sources).sort()).toEqual(["bg", "s1", "s2"]);
    expect(renderedEditorFrames(r.doc.m0)).toHaveLength(3);
  });
});

describe("rebuildDocumentGeometry — labels + refs", () => {
  it("rekeys a surviving leaf label and PRUNES a group label (groups collapse)", () => {
    const groupKey = keyOf(GRID, "group", 1); // right column group
    const untouchedLeaf = keyOf(GRID, "frame", 0);
    const input = doc(
      GRID,
      [src("s0"), src("s1"), src("s2"), src("s3")],
      { [groupKey]: "right column", [untouchedLeaf]: "top-left cell" },
    );
    const r = rebuildDocumentGeometry(input, {
      stableKey: keyOf(GRID, "frame", 1),
      rect: { x: 5, y: 105, w: 90, h: 90 },
      canvas: CANVAS,
    });
    if (!r.ok) throw new Error(r.error);
    const labelValues = Object.values(r.doc.labels ?? {});
    expect(labelValues).toContain("top-left cell"); // leaf label survives (rekeyed)
    expect(labelValues).not.toContain("right column"); // group label pruned
    // Every surviving label key resolves to a real rendered leaf.
    for (const k of Object.keys(r.doc.labels ?? {})) {
      expect(renderedGeometry(r.doc.m0).length).toBeGreaterThan(0);
      expect(frames(r.doc.m0).some((f) => String(f.meta.stableKey) === k)).toBe(true);
    }
  });

  it("rekeys a ref flattenedStableKey back-edge to a live leaf", () => {
    const targetLeaf = keyOf(GRID, "frame", 2); // top-right cell
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), refSrc("s3", targetLeaf)]);
    const r = rebuildDocumentGeometry(input, {
      stableKey: keyOf(GRID, "frame", 0),
      rect: { x: 10, y: 10, w: 50, h: 50 },
      canvas: CANVAS,
    });
    if (!r.ok) throw new Error(r.error);
    const ref = r.doc.sources.find((s) => s.type === "ref") as unknown as {
      flattenedStableKey: string;
    };
    expect(typeof ref.flattenedStableKey).toBe("string");
    expect(frames(r.doc.m0).some((f) => String(f.meta.stableKey) === ref.flattenedStableKey)).toBe(true);
  });
});

describe("rebuildDocumentGeometry — record + serialization", () => {
  it("appends the record and round-trips through the strict serializer", () => {
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    const r = rebuildDocumentGeometry(input, {
      stableKey: keyOf(GRID, "frame", 0),
      rect: { x: 10, y: 10, w: 50, h: 50 },
      canvas: CANVAS,
      at: "2026-07-06T00:00:00.000Z",
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.doc.editor?.geometryEdits).toHaveLength(1);
    expect(r.doc.editor!.geometryEdits![0]).toEqual(r.record);
    expect(r.record.at).toBe("2026-07-06T00:00:00.000Z");
    const out = JSON.parse(serializeMosaicDocument(r.doc));
    expect(out.editor.geometryEdits[0].kind).toBe("rebuild");
    expect(out.m0).toBe(r.doc.m0);
  });

  it("does not mutate the input document", () => {
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    rebuildDocumentGeometry(input, {
      stableKey: keyOf(GRID, "frame", 0),
      rect: { x: 10, y: 10, w: 50, h: 50 },
      canvas: CANVAS,
    });
    expect(input.m0).toBe(GRID);
    expect(markers(input.sources)).toEqual(["s0", "s1", "s2", "s3"]);
    expect(input.editor).toBeUndefined();
  });
});

describe("rebuildDocumentGeometry — rebuild after a V1 edit", () => {
  it("collapses the additive overlay layer and drops a null-origin label", () => {
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    // V1: null frame#1 in place + place its content on a new topmost layer.
    const v1 = applyRectEditToMosaicDocument(input, {
      stableKey: keyOf(GRID, "frame", 1),
      rect: { x: 10, y: 10, w: 50, h: 50 },
      canvas: CANVAS,
      kind: "move_subtree",
    });
    if (!v1.ok) throw new Error(v1.error);
    expect(getLayerCount(v1.doc.m0)).toBe(2);

    // Stamp a label on the nulled origin tile — it should die on rebuild.
    const nullKey = String(frames(v1.doc.m0).find((f) => f.kind === "null")!.meta.stableKey);
    const staged: MosaicDocument = { ...v1.doc, labels: { ...(v1.doc.labels ?? {}), [nullKey]: "orphan" } };

    const r = rebuildDocumentGeometry(staged, {
      stableKey: v1.record.toKey,
      rect: { x: 0, y: 100, w: 100, h: 100 }, // back into the freed bottom-left cell
      canvas: CANVAS,
    });
    if (!r.ok) throw new Error(r.error);
    expect(validateM0String(r.doc.m0).ok).toBe(true);
    // The null tile is gone: exactly 4 rendered leaves, overlay collapsed.
    expect(renderedEditorFrames(r.doc.m0)).toHaveLength(4);
    expect(getLayerCount(r.doc.m0)).toBeLessThan(getLayerCount(v1.doc.m0)!);
    expect(Object.values(r.doc.labels ?? {})).not.toContain("orphan");
  });
});

describe("rebuildDocumentGeometry — guards", () => {
  const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
  it("rejects a non-flat document", () => {
    const nested = { ...input, children: { c0: doc("1", [src("x")]) } } as MosaicDocument;
    const r = rebuildDocumentGeometry(nested, {
      stableKey: keyOf(GRID, "frame", 0),
      rect: { x: 0, y: 0, w: 50, h: 50 },
      canvas: CANVAS,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/FLAT/);
  });
  it("rejects an edit with neither rect nor z", () => {
    const r = rebuildDocumentGeometry(input, { stableKey: keyOf(GRID, "frame", 0), canvas: CANVAS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/rect.*z|z.*rect/);
  });
  it("rejects a rect escaping the canvas", () => {
    const r = rebuildDocumentGeometry(input, {
      stableKey: keyOf(GRID, "frame", 0),
      rect: { x: 180, y: 0, w: 50, h: 50 },
      canvas: CANVAS,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/out of bounds/);
  });
  it("rejects an unknown stableKey", () => {
    const r = rebuildDocumentGeometry(input, {
      stableKey: "nope/9",
      rect: { x: 0, y: 0, w: 50, h: 50 },
      canvas: CANVAS,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no node found/);
  });
});
