import type {
  MosaicDocument,
  MosaicGeometryEditRecord,
  MosaicGeometryEditRect,
  MosaicSource,
} from "@m0saic/types";
import { asFlattenedStableKey } from "@m0saic/types";
import { parseM0StringToFullGraph, validateM0String, type EditorFrame } from "@m0saic/dsl";
import { rebuildRects } from "@m0saic/dsl-stdlib";

export type RebuildEditInput = {
  /** StableKey of the grabbed node: any leaf, group, or renderable root. */
  stableKey: string;
  /** Target rect in integer DOCUMENT OUTPUT px. Omitted for a pure z change. */
  rect?: MosaicGeometryEditRect;
  /** Z-order operation. Omitted for a pure geometry change. */
  z?: { op: "front" | "back" | "forward" | "backward" };
  /**
   * `"subtree"` (default): descendant leaves scale proportionally into the
   * new node rect. `"rect_only"`: only the node's own rendered leaf moves;
   * overlay descendants keep their rects (disabled for groups).
   */
  scope?: "subtree" | "rect_only";
  /** Document output dims — the placeRects root and floor basis. */
  canvas: { w: number; h: number };
  /** Optional ISO timestamp stamped onto the edit record. */
  at?: string;
};

export type RebuildEditResult =
  | { ok: true; doc: MosaicDocument; record: MosaicGeometryEditRecord }
  | { ok: false; error: string };

type Rect = { x: number; y: number; w: number; h: number };

function fail(error: string): RebuildEditResult {
  return { ok: false, error };
}

function isRenderable(s: MosaicSource): boolean {
  return s.type !== "data";
}

/**
 * A parsed node that consumes a renderable source slot. Only rendered frames
 * carry a logicalIndex — INCLUDING a renderable root (`1{…}` / `F{…}` parses
 * as kind "root" with logicalIndex 0).
 */
function isRenderedLeaf(f: EditorFrame): boolean {
  return (f.kind === "frame" || f.kind === "root") && f.logicalIndex != null;
}

function roundRect(f: { x: number; y: number; width: number; height: number }): Rect {
  return {
    x: Math.max(0, Math.round(f.x)),
    y: Math.max(0, Math.round(f.y)),
    w: Math.max(1, Math.round(f.width)),
    h: Math.max(1, Math.round(f.height)),
  };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Per-axis rebuild floor: the smallest node rect at which every descendant
 * leaf still scales to ≥ 1px. `ceil(max over descendant leaves of P / leafDim)`
 * — the max ratio comes from the smallest leaf. A bare leaf yields 1×1.
 *
 * ## Why not the DSL's `evaluateM0.recommendedMin` (as V1 does)?
 *
 * V1 is resolution-INDEPENDENT — it keeps the weight-based split structure, so
 * it must respect the DSL feasibility+precision floor. V2 REBUILDS to
 * exact-pixel `placeRects`, which changes which floor is meaningful:
 *
 *  - `recommendedMin` bundles a PRECISION floor (weight bases quantize; the DSL
 *    wants ~px-per-weight headroom so spread stays imperceptible). A rebuild
 *    emits pixel-exact rects with ZERO quantization spread on the locked
 *    canvas, so that floor doesn't apply — using it would block valid resizes
 *    (the "resize any node" headline).
 *  - The FEASIBILITY half evaluates the ORIGINAL split arithmetic (split counts:
 *    a `100(…)` needs 100px), but that structure is discarded on rebuild. The
 *    only real constraint is geometric: each scaled leaf rect ≥ 1px — a leaf-SIZE
 *    property, computed here, deliberately far below V1's floor.
 *
 * This value is advisory (the friendly pre-check / error message). The hard
 * gate is the inline `w<1||h<1` check during scaling plus `validateM0String`
 * on the rebuilt string, so real infeasibility is caught regardless.
 */
export function computeRebuildFloor(
  m0: string,
  stableKey: string,
  canvas: { w: number; h: number },
): { w: number; h: number } {
  const frames = parseM0StringToFullGraph(m0, canvas.w, canvas.h);
  const origin = frames.find((f) => String(f.meta.stableKey) === stableKey);
  if (!origin) throw new Error(`computeRebuildFloor: no node with stableKey "${stableKey}"`);
  const P = roundRect(origin);
  const prefix = `${stableKey}/`;
  const leaves = frames.filter((f) => {
    if (!isRenderedLeaf(f)) return false;
    const k = String(f.meta.stableKey);
    return k === stableKey || k.startsWith(prefix);
  });
  let wRatio = 1;
  let hRatio = 1;
  for (const L of leaves) {
    const r = roundRect(L);
    wRatio = Math.max(wRatio, P.w / r.w);
    hRatio = Math.max(hRatio, P.h / r.h);
  }
  return { w: Math.ceil(wRatio), h: Math.ceil(hRatio) };
}

/**
 * Rebuild a FLAT `MosaicDocument`'s geometry to apply one human edit — the V2
 * "Rebuild" operation. Unlike the additive V1 op, this throws the entire m0
 * away and regenerates it from its rendered leaves (via `rebuildRects`), so it
 * can RESIZE, reorder (Z), and move GROUP / mosaic nodes with descendant leaves
 * scaling proportionally. Resolution-baked at `canvas` (post-render, output
 * locked). One drop = one call = one commit.
 *
 * Steps: guards → subtree → leaf-override expansion (edge-based proportional
 * scaling, degenerate → floor error) → z permutation → `rebuildRects` →
 * sidecar migration (sources GATHER, labels + ref back-edges rekeyed then
 * pruned to liveKeys) → validate → append a `kind:"rebuild"` record.
 *
 * The document must be flat (`children` empty). Presence of a `kind:"rebuild"`
 * record marks the doc resolution-committed at `record.canvas`.
 */
export function rebuildDocumentGeometry(
  doc: MosaicDocument,
  edit: RebuildEditInput,
): RebuildEditResult {
  const { stableKey: originKey, rect, z, canvas } = edit;
  const scope = edit.scope ?? "subtree";

  // ── Guards ──
  if (doc.kind !== "mosaic_document") {
    return fail("rebuildDocumentGeometry: document must be a mosaic_document");
  }
  if (doc.children && Object.keys(doc.children).length > 0) {
    return fail("rebuildDocumentGeometry: document must be FLAT (children empty) — flatten it first");
  }
  if (!rect && !z) {
    return fail("rebuildDocumentGeometry: edit needs a rect, a z op, or both");
  }
  if (rect) {
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isInteger) || rect.w < 1 || rect.h < 1) {
      return fail("rebuildDocumentGeometry: rect must be integer px with w/h ≥ 1");
    }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > canvas.w || rect.y + rect.h > canvas.h) {
      return fail(
        `rebuildDocumentGeometry: rect (${rect.x},${rect.y},${rect.w},${rect.h}) is out of bounds for ${canvas.w}x${canvas.h}`,
      );
    }
  }

  const m0 = doc.m0;
  let frames: EditorFrame[];
  try {
    frames = parseM0StringToFullGraph(m0, canvas.w, canvas.h);
  } catch (err: unknown) {
    return fail(
      `rebuildDocumentGeometry: document m0 failed to parse at ${canvas.w}x${canvas.h}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const origin = frames.find((f) => String(f.meta.stableKey) === originKey);
  if (!origin) {
    return fail(`rebuildDocumentGeometry: no node found with stableKey "${originKey}"`);
  }
  if (origin.kind === "null" || origin.kind === "passthrough") {
    return fail(`rebuildDocumentGeometry: cannot grab a ${origin.kind} node ("${originKey}")`);
  }
  const originIsLeaf = isRenderedLeaf(origin);
  if (scope === "rect_only" && !originIsLeaf) {
    return fail(
      `rebuildDocumentGeometry: rect_only targets a rendered leaf; "${originKey}" is a ${origin.kind}`,
    );
  }

  // ── Rendered leaves in paint (render-walk) order ──
  const renderedLeaves = frames
    .filter(isRenderedLeaf)
    .sort((a, b) => (a.logicalIndex ?? 0) - (b.logicalIndex ?? 0));
  const paintOrderKeys = renderedLeaves.map((f) => String(f.meta.stableKey));
  const rectByKey = new Map<string, Rect>();
  for (const f of renderedLeaves) rectByKey.set(String(f.meta.stableKey), roundRect(f));

  // ── Descendant leaves of the grabbed node ──
  const prefix = `${originKey}/`;
  const descKeys = paintOrderKeys.filter((k) => k === originKey || k.startsWith(prefix));
  if (descKeys.length === 0) {
    return fail(`rebuildDocumentGeometry: node "${originKey}" contains no renderable leaves`);
  }
  // The block that moves / reorders. rect_only moves only the node's own leaf.
  const blockKeys = scope === "rect_only" ? [originKey] : descKeys;

  const P = roundRect(origin);

  // ── Subtree → leaf-override expansion (edge-based proportional scaling) ──
  const overrides: Record<string, Rect> = {};
  if (rect) {
    const scaleKeys = scope === "rect_only" ? [originKey] : descKeys;
    const sx = rect.w / P.w;
    const sy = rect.h / P.h;
    for (const k of scaleKeys) {
      const L = rectByKey.get(k)!;
      // Scale by EDGES (not pos+size) so shared sibling edges stay coincident —
      // misaligned edges force y-subdivision spills in placeRects.
      const left = rect.x + Math.round((L.x - P.x) * sx);
      const right = rect.x + Math.round((L.x + L.w - P.x) * sx);
      const top = rect.y + Math.round((L.y - P.y) * sy);
      const bottom = rect.y + Math.round((L.y + L.h - P.y) * sy);
      const w = right - left;
      const h = bottom - top;
      if (w < 1 || h < 1) {
        const floor = computeRebuildFloor(m0, originKey, canvas);
        return fail(
          `rebuildDocumentGeometry: rect ${rect.w}x${rect.h} collapses a descendant leaf below 1px ` +
            `(needs ≥ ${floor.w}x${floor.h})`,
        );
      }
      overrides[k] = { x: left, y: top, w, h };
    }
  }

  // ── Z permutation ──
  let order: string[] | undefined;
  let prevPaintIndex = 0;
  let nextPaintIndex = 0;
  if (z) {
    const blockSet = new Set(blockKeys);
    const others = paintOrderKeys.filter((k) => !blockSet.has(k));
    const block = paintOrderKeys.filter((k) => blockSet.has(k)); // current relative order
    const positions = blockKeys.map((k) => paintOrderKeys.indexOf(k));
    const minPos = Math.min(...positions);
    const maxPos = Math.max(...positions);
    prevPaintIndex = minPos;

    const overlapsBlock = (k: string): boolean =>
      block.some((bk) => rectsOverlap(rectByKey.get(k)!, rectByKey.get(bk)!));

    let newOrder: string[];
    if (z.op === "front") {
      newOrder = [...others, ...block];
    } else if (z.op === "back") {
      newOrder = [...block, ...others];
    } else if (z.op === "forward") {
      let target = -1;
      for (let p = maxPos + 1; p < paintOrderKeys.length; p++) {
        const k = paintOrderKeys[p]!;
        if (blockSet.has(k)) continue;
        if (overlapsBlock(k)) { target = p; break; }
      }
      if (target < 0) {
        newOrder = paintOrderKeys.slice(); // no overlapping later leaf → no-op
      } else {
        const targetKey = paintOrderKeys[target]!;
        newOrder = [];
        for (const k of others) {
          newOrder.push(k);
          if (k === targetKey) newOrder.push(...block);
        }
      }
    } else {
      // backward
      let target = -1;
      for (let p = minPos - 1; p >= 0; p--) {
        const k = paintOrderKeys[p]!;
        if (blockSet.has(k)) continue;
        if (overlapsBlock(k)) { target = p; break; }
      }
      if (target < 0) {
        newOrder = paintOrderKeys.slice();
      } else {
        const targetKey = paintOrderKeys[target]!;
        newOrder = [];
        for (const k of others) {
          if (k === targetKey) newOrder.push(...block);
          newOrder.push(k);
        }
      }
    }
    order = newOrder;
    nextPaintIndex = newOrder.indexOf(block[0]!);
  }

  // ── Rebuild ──
  let rb: ReturnType<typeof rebuildRects>;
  try {
    rb = rebuildRects({
      m0,
      width: canvas.w,
      height: canvas.h,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      ...(order ? { order } : {}),
    });
  } catch (err: unknown) {
    return fail(
      `rebuildDocumentGeometry: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Gate: validate the rebuilt m0 ──
  if (!validateM0String(rb.m0).ok) {
    return fail("rebuildDocumentGeometry: rebuilt m0 failed validation — internal error");
  }

  // ── Sidecar migration ──
  const rekeyMap = new Map(rb.rekey.map((p) => [p.from, p.to]));
  const mapKey = (k: string): string => rekeyMap.get(k) ?? k;
  const liveSet = new Set(rb.liveKeys);

  // Sources: GATHER the renderables via sourceOrder; data sources hold their
  // absolute position (equivalently, their position relative to renderables).
  const oldRenderables = doc.sources.filter(isRenderable);
  if (oldRenderables.length !== rb.meta.frameCount) {
    return fail(
      `rebuildDocumentGeometry: sources/frames mismatch (${oldRenderables.length} renderable sources, ${rb.meta.frameCount} rendered leaves)`,
    );
  }
  const newRenderables = rb.sourceOrder.map((oi) => oldRenderables[oi]!);
  const rekeySource = (src: MosaicSource): MosaicSource => {
    if (src.type === "ref" && typeof src.flattenedStableKey === "string") {
      const mapped = mapKey(src.flattenedStableKey);
      if (mapped !== src.flattenedStableKey) {
        if (liveSet.has(mapped)) {
          return { ...src, flattenedStableKey: asFlattenedStableKey(mapped) };
        }
        // Dangling after the rebuild — drop the back-edge, keep the source.
        const { flattenedStableKey: _drop, ...rest } = src;
        return rest as MosaicSource;
      }
    }
    return src;
  };
  const newSources: MosaicSource[] = new Array(doc.sources.length);
  let rc = 0;
  for (let i = 0; i < doc.sources.length; i++) {
    const s = doc.sources[i]!;
    newSources[i] = isRenderable(s) ? rekeySource(newRenderables[rc++]!) : s;
  }

  // Labels: rekey then prune to live rendered leaves (labels on collapsed
  // groups / V1-nulled tiles die here, correctly).
  let nextLabels = doc.labels;
  if (doc.labels) {
    nextLabels = {};
    for (const [k, v] of Object.entries(doc.labels)) {
      const nk = mapKey(k);
      if (liveSet.has(nk)) nextLabels[nk] = v;
    }
  }

  // ── Record ──
  const nextNodeRect: MosaicGeometryEditRect = rect
    ? { ...rect }
    : { x: P.x, y: P.y, w: P.w, h: P.h };
  const nodes = blockKeys.map((k) => {
    const prev = rectByKey.get(k)!;
    const next = overrides[k] ?? prev;
    return {
      fromKey: k,
      toKey: mapKey(k),
      prevRect: { x: prev.x, y: prev.y, w: prev.w, h: prev.h },
      nextRect: { x: next.x, y: next.y, w: next.w, h: next.h },
    };
  });
  const record: MosaicGeometryEditRecord = {
    kind: "rebuild",
    fromKey: originKey,
    // Anchor into the rebuilt doc: the block's base (lowest-paint) leaf's new
    // key. For a leaf grab that is the node itself; for a group it is its first
    // descendant leaf.
    toKey: mapKey(blockKeys[0]!),
    prevRect: { x: P.x, y: P.y, w: P.w, h: P.h },
    nextRect: nextNodeRect,
    canvas: { ...canvas },
    movedSourceCount: blockKeys.length,
    scope,
    ...(z ? { z: { op: z.op, prevPaintIndex, nextPaintIndex } } : {}),
    nodes,
    ...(edit.at != null ? { at: edit.at } : {}),
  };

  const nextDoc: MosaicDocument = {
    ...doc,
    m0: rb.m0 as MosaicDocument["m0"],
    sources: newSources,
    ...(nextLabels ? { labels: nextLabels } : {}),
    editor: {
      ...doc.editor,
      geometryEdits: [...(doc.editor?.geometryEdits ?? []), record],
    },
  };

  return { ok: true, doc: nextDoc, record };
}
