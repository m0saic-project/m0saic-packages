import { parseM0StringToFullGraph, validateM0String, type EditorFrame } from "@m0saic/dsl";
import type { MosaicDocument, MosaicSource } from "@m0saic/types";
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

/** Minimal renderable source stub with a marker for order assertions. */
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

/** StableKey of the Nth node of a kind (parse order). */
function keyOf(m0: string, kind: string, index: number): string {
  const matches = frames(m0).filter((f) => f.kind === kind);
  if (index >= matches.length) throw new Error(`no ${kind} #${index}`);
  return String(matches[index]!.meta.stableKey);
}

function leafByKey(m0: string, key: string): EditorFrame {
  const f = frames(m0).find((x) => String(x.meta.stableKey) === key);
  if (!f) throw new Error(`no node ${key}`);
  return f;
}

// 2×2 grid at 200×200 — each cell exactly 100×100.
const GRID = "2(2[1,1],2[1,1])";

describe("applyRectEditToMosaicDocument — move_subtree (leaf)", () => {
  const leafKey = keyOf(GRID, "frame", 1); // bottom-left cell
  const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
  const rect = { x: 10, y: 10, w: 50, h: 50 };
  const result = applyRectEditToMosaicDocument(input, {
    stableKey: leafKey,
    rect,
    canvas: CANVAS,
    kind: "move_subtree",
    at: "2026-07-06T00:00:00.000Z",
  });

  it("succeeds and produces a valid m0", () => {
    if (!result.ok) throw new Error(result.error);
    expect("error" in validateM0String(result.doc.m0)).toBe(false);
  });

  it("leaves every untouched frame byte-identical (rect AND stableKey)", () => {
    if (!result.ok) throw new Error(result.error);
    const before = frames(GRID).filter(
      (f) => f.kind === "frame" && String(f.meta.stableKey) !== leafKey,
    );
    const after = frames(result.doc.m0);
    for (const b of before) {
      const match = after.find(
        (a) => String(a.meta.stableKey) === String(b.meta.stableKey),
      );
      expect(match).toBeDefined();
      expect({ x: match!.x, y: match!.y, w: match!.width, h: match!.height }).toEqual({
        x: b.x,
        y: b.y,
        w: b.width,
        h: b.height,
      });
    }
  });

  it("places the moved leaf at exactly the target rect", () => {
    if (!result.ok) throw new Error(result.error);
    const placed = leafByKey(result.doc.m0, result.record.toKey);
    expect({ x: placed.x, y: placed.y, w: placed.width, h: placed.height }).toEqual({
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
    });
  });

  it("moves the leaf's source to the end, preserving the others' order", () => {
    if (!result.ok) throw new Error(result.error);
    expect(markers(result.doc.sources)).toEqual(["s0", "s2", "s3", "s1"]);
  });

  it("records the edit on editor.geometryEdits", () => {
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.editor?.geometryEdits).toHaveLength(1);
    const rec = result.doc.editor!.geometryEdits![0]!;
    expect(rec).toEqual(result.record);
    expect(rec.kind).toBe("move_subtree");
    expect(rec.fromKey).toBe(leafKey);
    expect(rec.prevRect).toEqual({ x: 0, y: 100, w: 100, h: 100 });
    expect(rec.nextRect).toEqual(rect);
    expect(rec.canvas).toEqual(CANVAS);
    expect(rec.movedSourceCount).toBe(1);
    expect(rec.at).toBe("2026-07-06T00:00:00.000Z");
  });

  it("does not mutate the input document", () => {
    expect(input.m0).toBe(GRID);
    expect(markers(input.sources)).toEqual(["s0", "s1", "s2", "s3"]);
    expect(input.editor).toBeUndefined();
  });

  it("round-trips through the strict serializer with the edit record intact", () => {
    if (!result.ok) throw new Error(result.error);
    const out = JSON.parse(serializeMosaicDocument(result.doc));
    expect(out.editor.geometryEdits).toHaveLength(1);
    expect(out.editor.geometryEdits[0].fromKey).toBe(leafKey);
    expect(out.m0).toBe(result.doc.m0);
  });
});

describe("applyRectEditToMosaicDocument — move_subtree (group with labels + refs)", () => {
  const groupKey = keyOf(GRID, "group", 0); // left column 2[1,1]
  const innerLeafKey = keyOf(GRID, "frame", 0);
  const untouchedLeafKey = keyOf(GRID, "frame", 2);
  const input = doc(
    GRID,
    [src("s0"), src("s1"), src("s2"), refSrc("s3", innerLeafKey)],
    {
      [groupKey]: "left column",
      [innerLeafKey]: "top-left cell",
      [untouchedLeafKey]: "top-right cell",
    },
  );
  const rect = { x: 50, y: 50, w: 100, h: 100 };
  const result = applyRectEditToMosaicDocument(input, {
    stableKey: groupKey,
    rect,
    canvas: CANVAS,
    kind: "move_subtree",
  });

  it("moves both subtree sources to the end in order", () => {
    if (!result.ok) throw new Error(result.error);
    expect(markers(result.doc.sources)).toEqual(["s2", "s3", "s0", "s1"]);
    expect(result.record.movedSourceCount).toBe(2);
  });

  it("places the subtree's leaves inside the target rect (rows of the moved column)", () => {
    if (!result.ok) throw new Error(result.error);
    const after = frames(result.doc.m0)
      .filter((f) => f.kind === "frame" && f.logicalIndex != null)
      .sort((a, b) => (a.logicalIndex ?? 0) - (b.logicalIndex ?? 0));
    const placed = after.slice(after.length - 2);
    expect({ x: placed[0]!.x, y: placed[0]!.y, w: placed[0]!.width, h: placed[0]!.height }).toEqual(
      { x: 50, y: 50, w: 100, h: 50 },
    );
    expect({ x: placed[1]!.x, y: placed[1]!.y, w: placed[1]!.width, h: placed[1]!.height }).toEqual(
      { x: 50, y: 100, w: 100, h: 50 },
    );
  });

  it("re-keys labels on the moved subtree by prefix and keeps others", () => {
    if (!result.ok) throw new Error(result.error);
    const labels = result.doc.labels!;
    const { toKey } = result.record;
    expect(labels[toKey]).toBe("left column");
    const movedLeafLabelKey = Object.keys(labels).find((k) => labels[k] === "top-left cell")!;
    expect(movedLeafLabelKey.startsWith(toKey)).toBe(true);
    expect(labels[untouchedLeafKey]).toBe("top-right cell");
    // Re-keyed labels resolve to real nodes in the edited parse.
    expect(() => leafByKey(result.doc.m0, movedLeafLabelKey)).not.toThrow();
  });

  it("re-keys ref flattenedStableKey back-edges pointing into the subtree", () => {
    if (!result.ok) throw new Error(result.error);
    const ref = result.doc.sources.find((s) => s.type === "ref") as unknown as {
      flattenedStableKey: string;
    };
    expect(ref.flattenedStableKey.startsWith(result.record.toKey)).toBe(true);
    expect(() => leafByKey(result.doc.m0, ref.flattenedStableKey)).not.toThrow();
  });
});

describe("applyRectEditToMosaicDocument — move_subtree (leaf with overlay travels)", () => {
  const M0 = "2(1{1},1)";
  const leafKey = keyOf(M0, "frame", 0);
  const input = doc(M0, [src("s0"), src("s1"), src("s2")]);
  const result = applyRectEditToMosaicDocument(input, {
    stableKey: leafKey,
    rect: { x: 20, y: 20, w: 60, h: 60 },
    canvas: CANVAS,
    kind: "move_subtree",
  });

  it("carries the overlay child with the moved leaf", () => {
    if (!result.ok) throw new Error(result.error);
    // Both the leaf's source AND its overlay child's source moved.
    expect(markers(result.doc.sources)).toEqual(["s2", "s0", "s1"]);
    expect(result.record.movedSourceCount).toBe(2);
    // No overlay content remains at the origin: the origin column's null
    // carries no overlay (the null replaced body + overlay).
    const after = frames(result.doc.m0);
    const placedOverlayLeaf = after.find(
      (f) =>
        f.kind === "frame" &&
        String(f.meta.stableKey).startsWith(result.record.toKey) &&
        String(f.meta.stableKey) !== result.record.toKey,
    );
    expect(placedOverlayLeaf).toBeDefined();
  });
});

describe("applyRectEditToMosaicDocument — move_rect_only (overlay children stay)", () => {
  const M0 = "2(1{1},1)";
  const leafKey = keyOf(M0, "frame", 0);
  const overlayChildKey = keyOf(M0, "frame", 1); // the overlay leaf
  const input = doc(M0, [src("s0"), src("s1"), src("s2")], {
    [leafKey]: "base tile",
    [overlayChildKey]: "floating badge",
  });
  const rect = { x: 120, y: 120, w: 60, h: 60 };
  const result = applyRectEditToMosaicDocument(input, {
    stableKey: leafKey,
    rect,
    canvas: CANVAS,
    kind: "move_rect_only",
  });

  it("moves exactly one source; the overlay child's source stays in place", () => {
    if (!result.ok) throw new Error(result.error);
    expect(markers(result.doc.sources)).toEqual(["s1", "s2", "s0"]);
    expect(result.record.movedSourceCount).toBe(1);
  });

  it("keeps the overlay child rendering at the origin rect", () => {
    if (!result.ok) throw new Error(result.error);
    const before = leafByKey(M0, overlayChildKey);
    const after = frames(result.doc.m0).filter(
      (f) => f.kind === "frame" && f.logicalIndex != null,
    );
    // Some rendered leaf in the edited doc still covers the origin rect
    // (the overlay child now hangs off the nulled origin).
    const stayed = after.find(
      (f) => f.x === before.x && f.y === before.y && f.width === before.width && f.height === before.height,
    );
    expect(stayed).toBeDefined();
  });

  it("re-keys the moved leaf's label to the placed key and the overlay child's label to the nulled origin", () => {
    if (!result.ok) throw new Error(result.error);
    const labels = result.doc.labels!;
    expect(labels[result.record.toKey]).toBe("base tile");
    const badgeKey = Object.keys(labels).find((k) => labels[k] === "floating badge")!;
    // The re-keyed label resolves to a real rendered leaf at the origin rect.
    const badgeFrame = leafByKey(result.doc.m0, badgeKey);
    const before = leafByKey(M0, overlayChildKey);
    expect({ x: badgeFrame.x, y: badgeFrame.y }).toEqual({ x: before.x, y: before.y });
  });

  it("rejects move_rect_only on a group node", () => {
    const gridInput = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    const r = applyRectEditToMosaicDocument(gridInput, {
      stableKey: keyOf(GRID, "group", 0),
      rect,
      canvas: CANVAS,
      kind: "move_rect_only",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/rendered leaf/);
  });
});

describe("applyRectEditToMosaicDocument — resize floor", () => {
  it("rejects a rect below the subtree's feasibility/precision floor", () => {
    const groupKey = keyOf(GRID, "group", 0); // 2[1,1] needs h ≥ 2
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    const r = applyRectEditToMosaicDocument(input, {
      stableKey: groupKey,
      rect: { x: 0, y: 0, w: 100, h: 1 },
      canvas: CANVAS,
      kind: "move_subtree",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/below the node's floor/);
  });

  it("accepts a rect exactly at the floor", () => {
    const groupKey = keyOf(GRID, "group", 0);
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    const r = applyRectEditToMosaicDocument(input, {
      stableKey: groupKey,
      rect: { x: 0, y: 0, w: 1, h: 2 },
      canvas: CANVAS,
      kind: "move_subtree",
    });
    expect(r.ok).toBe(true);
  });
});

describe("applyRectEditToMosaicDocument — data sources hold their position", () => {
  it("keeps a data source in place while renderables reorder around it", () => {
    const leafKey = keyOf(GRID, "frame", 1);
    const input = doc(GRID, [src("s0"), dataSrc("d0"), src("s1"), src("s2"), src("s3")]);
    const r = applyRectEditToMosaicDocument(input, {
      stableKey: leafKey,
      rect: { x: 10, y: 10, w: 50, h: 50 },
      canvas: CANVAS,
      kind: "move_subtree",
    });
    if (!r.ok) throw new Error(r.error);
    expect(markers(r.doc.sources)).toEqual(["s0", "d0", "s2", "s3", "s1"]);
  });
});

describe("applyRectEditToMosaicDocument — re-editing a placed rect (overlay-namespace key)", () => {
  it("moves an already-moved leaf again", () => {
    const leafKey = keyOf(GRID, "frame", 1);
    const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
    const first = applyRectEditToMosaicDocument(input, {
      stableKey: leafKey,
      rect: { x: 10, y: 10, w: 50, h: 50 },
      canvas: CANVAS,
      kind: "move_subtree",
    });
    if (!first.ok) throw new Error(first.error);

    const second = applyRectEditToMosaicDocument(first.doc, {
      stableKey: first.record.toKey,
      rect: { x: 140, y: 140, w: 40, h: 40 },
      canvas: CANVAS,
      kind: "move_subtree",
    });
    if (!second.ok) throw new Error(second.error);

    expect(second.doc.editor?.geometryEdits).toHaveLength(2);
    const placed = leafByKey(second.doc.m0, second.record.toKey);
    expect({ x: placed.x, y: placed.y, w: placed.width, h: placed.height }).toEqual({
      x: 140,
      y: 140,
      w: 40,
      h: 40,
    });
    // Source order: the re-moved source stays last.
    expect(markers(second.doc.sources)).toEqual(["s0", "s2", "s3", "s1"]);
  });
});

describe("applyRectEditToMosaicDocument — renderable root (`1{…}`)", () => {
  // Flat template docs commonly paint source #0 on the ROOT itself with
  // the content in an overlay chain. The root parses as kind "root" WITH
  // logicalIndex 0 — it must count as a rendered leaf or the
  // sources/frames invariant misfires (regression: 27 sources vs 26
  // leaves on every edit of such a doc).
  const ROOT_OV = "1{2(1,1)}";

  it("moves an overlay leaf; the root source keeps position 0", () => {
    const leafKey = keyOf(ROOT_OV, "frame", 0); // first overlay cell
    const input = doc(ROOT_OV, [src("bg"), src("s1"), src("s2")]);
    const r = applyRectEditToMosaicDocument(input, {
      stableKey: leafKey,
      rect: { x: 10, y: 10, w: 50, h: 50 },
      canvas: CANVAS,
      kind: "move_subtree",
    });
    if (!r.ok) throw new Error(r.error);
    expect(markers(r.doc.sources)).toEqual(["bg", "s2", "s1"]);
    // Root rect untouched; placed leaf at the target.
    const root = frames(r.doc.m0).find((f) => f.kind === "root")!;
    expect({ x: root.x, y: root.y, w: root.width, h: root.height }).toEqual({
      x: 0,
      y: 0,
      w: CANVAS.w,
      h: CANVAS.h,
    });
    const placed = leafByKey(r.doc.m0, r.record.toKey);
    expect({ x: placed.x, y: placed.y, w: placed.width, h: placed.height }).toEqual({
      x: 10,
      y: 10,
      w: 50,
      h: 50,
    });
  });

  it("still rejects moving the renderable root itself", () => {
    const input = doc(ROOT_OV, [src("bg"), src("s1"), src("s2")]);
    const r = applyRectEditToMosaicDocument(input, {
      stableKey: keyOf(ROOT_OV, "root", 0),
      rect: { x: 10, y: 10, w: 50, h: 50 },
      canvas: CANVAS,
      kind: "move_subtree",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/root/);
  });
});

describe("applyRectEditToMosaicDocument — guards", () => {
  const input = doc(GRID, [src("s0"), src("s1"), src("s2"), src("s3")]);
  const rect = { x: 0, y: 0, w: 50, h: 50 };

  it("rejects a non-flat document", () => {
    const nested = {
      ...input,
      children: { c0: doc("1", [src("x")]) },
    } as MosaicDocument;
    const r = applyRectEditToMosaicDocument(nested, {
      stableKey: keyOf(GRID, "frame", 0),
      rect,
      canvas: CANVAS,
      kind: "move_subtree",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/FLAT/);
  });

  it("rejects an unknown stableKey", () => {
    const r = applyRectEditToMosaicDocument(input, {
      stableKey: "nonexistent/key",
      rect,
      canvas: CANVAS,
      kind: "move_subtree",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no node found/);
  });

  it("rejects moving the root node", () => {
    const r = applyRectEditToMosaicDocument(input, {
      stableKey: keyOf(GRID, "root", 0),
      rect,
      canvas: CANVAS,
      kind: "move_subtree",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/root/);
  });

  it("rejects a non-integer rect", () => {
    const r = applyRectEditToMosaicDocument(input, {
      stableKey: keyOf(GRID, "frame", 0),
      rect: { x: 0.5, y: 0, w: 50, h: 50 },
      canvas: CANVAS,
      kind: "move_subtree",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/integer/);
  });

  it("rejects a rect escaping the canvas (placeRect guard)", () => {
    const r = applyRectEditToMosaicDocument(input, {
      stableKey: keyOf(GRID, "frame", 0),
      rect: { x: 180, y: 0, w: 50, h: 50 },
      canvas: CANVAS,
      kind: "move_subtree",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a source-count mismatch", () => {
    const short = doc(GRID, [src("s0"), src("s1")]);
    const r = applyRectEditToMosaicDocument(short, {
      stableKey: keyOf(GRID, "frame", 0),
      rect,
      canvas: CANVAS,
      kind: "move_subtree",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mismatch/);
  });
});
