import type {
  MosaicBoxFrac,
  MosaicDocument,
  MosaicGeometryEditRecord,
  MosaicSource,
} from "@m0saic/types";
import { asFlattenedStableKey } from "@m0saic/types";
import { parseM0StringToFullGraph, validateM0String, type EditorFrame } from "@m0saic/dsl";
import { rebuildRects } from "@m0saic/dsl-stdlib";

/**
 * Bake every source's render-time `placement.inset` into the m0 geometry —
 * the doc-level wrapper around the same idea as `@m0saic/dsl-stdlib`'s
 * `bakeInsets`, built on `rebuildRects` so the whole sidecar-migration kit
 * (source gather via `sourceOrder`, stableKey rekey for labels and ref
 * back-edges) rides along.
 *
 * Why a user would want this: inset-recovery layouts (`placeInsetRects` /
 * `placeInsetPieces`) keep the m0 cheap by hiding the exact rects in per-source
 * `placement.inset` fibers — visually lossless, but the STRING is no longer
 * self-describing. Fine for `.m0c` (context travels with the file); not fine
 * when the bare m0 must carry the exact rects on its own (portable `.m0`,
 * hand-off to tools that only read the string). Baking folds the fibers into
 * the geometry: afterwards the m0 alone reproduces the exact painted rects.
 *
 * Costs (deliberate, surfaced in the Make Edit UI):
 * - The m0 grows — the output is an absolute (per-pixel band) rebuild.
 * - Resolution-baked at `canvas`, the same trade the Full edit engine makes;
 *   a `kind:"rebuild"` record marks the doc resolution-committed.
 *
 * Exactness: each leaf's baked rect applies core `applyInsetToRect`'s math
 * (`Math.floor(frac · cellSize)` per edge, then `Math.max(1, …)` on size) to
 * the integer render frame, so the rebuilt geometry equals what the engine
 * painted, pixel for pixel. All `placement.inset` fields are then stripped
 * (including no-op zero insets — the promise is an inset-free doc).
 *
 * The record reuses `kind:"rebuild"` (this IS a full-graph rebuild): `nodes[]`
 * carries one `{fromKey,toKey,prevRect,nextRect}` per inset-baked leaf — the
 * legible intent ("each of these cells shrank to its painted box") — and
 * `movedSourceCount` is the baked-leaf count.
 *
 * Pure and deterministic. The document must be FLAT (children empty).
 */

export type BakeDocumentInsetsResult =
  | {
      ok: true;
      doc: MosaicDocument;
      record: MosaicGeometryEditRecord;
      /** Leaves whose geometry actually changed (non-identity insets). */
      insetCount: number;
      dslLengthBefore: number;
      dslLengthAfter: number;
    }
  | { ok: false; error: string };

type Rect = { x: number; y: number; w: number; h: number };
type BoxFrac = { top: number; right: number; bottom: number; left: number };

function fail(error: string): BakeDocumentInsetsResult {
  return { ok: false, error };
}

function isRenderable(s: MosaicSource): boolean {
  return s.type !== "data";
}

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

/**
 * Resolve a `MosaicBoxFrac` to per-edge fractions — the same collapse core's
 * engine performs before `applyInsetToRect` (see
 * `dsl-file-formats/MIRRORED_TYPES.md` for the authoring-superset contract).
 */
function resolveBoxFrac(v: MosaicBoxFrac | undefined): BoxFrac {
  if (typeof v === "number") return { top: v, right: v, bottom: v, left: v };
  const o = (v ?? {}) as {
    x?: number;
    y?: number;
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  const x = o.x ?? 0;
  const y = o.y ?? 0;
  return { top: o.top ?? y, right: o.right ?? x, bottom: o.bottom ?? y, left: o.left ?? x };
}

function sourceInset(src: MosaicSource | undefined): BoxFrac | null {
  const raw = (src as { placement?: { inset?: MosaicBoxFrac } } | undefined)?.placement?.inset;
  if (raw == null) return null;
  const box = resolveBoxFrac(raw);
  return box.top || box.right || box.bottom || box.left ? box : null;
}

/** Strip `placement.inset` from a source (dropping an emptied `placement`). */
function stripInset(src: MosaicSource): MosaicSource {
  const placement = (src as { placement?: Record<string, unknown> }).placement;
  if (!placement || placement.inset == null) return src;
  const { inset: _drop, ...restPlacement } = placement;
  if (Object.keys(restPlacement).length === 0) {
    const { placement: _dropAll, ...rest } = src as MosaicSource & {
      placement?: Record<string, unknown>;
    };
    return rest as MosaicSource;
  }
  return { ...(src as object), placement: restPlacement } as MosaicSource;
}

/**
 * How many renderable sources carry a non-identity `placement.inset` — the
 * UI's "is there anything to bake?" probe. Cheap: no parse.
 */
export function countDocumentInsetSources(doc: MosaicDocument): number {
  let n = 0;
  for (const s of doc.sources ?? []) {
    if (isRenderable(s) && sourceInset(s)) n++;
  }
  return n;
}

const DEEP_COUNT_DEPTH_CAP = 64;

/**
 * Deep variant of {@link countDocumentInsetSources}: counts non-identity
 * insets across a renderable's WHOLE tree — a document's nested `children`
 * (recursively, with children-scope inheritance ignored — every child doc is
 * visited once) and a pipeline's step docs. This is what an always-visible
 * "Bake insets" button gates on: the bake flattens first, and flatten pulls
 * every nested source into the flat doc, so the deep count is the number of
 * insets the bake will actually fold. Cheap: no parse, no flatten.
 */
export function countRenderableInsetsDeep(renderable: unknown): number {
  const seen = new Set<object>();
  let n = 0;
  const visitDoc = (d: unknown, depth: number): void => {
    if (!d || typeof d !== "object" || depth > DEEP_COUNT_DEPTH_CAP) return;
    if (seen.has(d)) return;
    seen.add(d);
    const doc = d as {
      kind?: string;
      sources?: MosaicSource[];
      children?: Record<string, unknown>;
      steps?: Array<{ file?: unknown }>;
    };
    if (doc.kind === "mosaic_pipeline") {
      for (const step of doc.steps ?? []) visitDoc(step?.file, depth + 1);
      return;
    }
    if (doc.kind !== "mosaic_document" && doc.kind !== "mosaicx_document") return;
    for (const s of doc.sources ?? []) {
      if (isRenderable(s) && sourceInset(s)) n++;
    }
    for (const child of Object.values(doc.children ?? {})) visitDoc(child, depth + 1);
  };
  visitDoc(renderable, 0);
  return n;
}

export function bakeDocumentInsets(
  doc: MosaicDocument,
  canvas: { w: number; h: number },
  opts?: { at?: string },
): BakeDocumentInsetsResult {
  // ── Guards ──
  if (doc.kind !== "mosaic_document") {
    return fail("bakeDocumentInsets: document must be a mosaic_document");
  }
  if (doc.children && Object.keys(doc.children).length > 0) {
    return fail("bakeDocumentInsets: document must be FLAT (children empty) — flatten it first");
  }

  const m0 = doc.m0;
  let frames: EditorFrame[];
  try {
    frames = parseM0StringToFullGraph(m0, canvas.w, canvas.h);
  } catch (err: unknown) {
    return fail(
      `bakeDocumentInsets: document m0 failed to parse at ${canvas.w}x${canvas.h}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const renderedLeaves = frames
    .filter(isRenderedLeaf)
    .sort((a, b) => (a.logicalIndex ?? 0) - (b.logicalIndex ?? 0));
  if (renderedLeaves.length === 0) {
    return fail("bakeDocumentInsets: document has no rendered frames");
  }

  const renderables = (doc.sources ?? []).filter(isRenderable);
  if (renderables.length !== renderedLeaves.length) {
    return fail(
      `bakeDocumentInsets: sources/frames mismatch (${renderables.length} renderable sources, ${renderedLeaves.length} rendered leaves)`,
    );
  }

  // ── Per-leaf baked rect (exact engine inset math) ──
  const overrides: Record<string, Rect> = {};
  const nodes: MosaicGeometryEditRecord["nodes"] = [];
  let insetCount = 0;
  for (const leaf of renderedLeaves) {
    const inset = sourceInset(renderables[leaf.logicalIndex!]);
    if (!inset) continue;
    const cell = roundRect(leaf);
    // EXACT mirror of core applyInsetToRect (and stdlib bakeInsets): floor per
    // edge on the integer cell, then clamp size to ≥ 1.
    const l = Math.floor(inset.left * cell.w);
    const r = Math.floor(inset.right * cell.w);
    const t = Math.floor(inset.top * cell.h);
    const b = Math.floor(inset.bottom * cell.h);
    if (!(l || r || t || b)) continue; // rounds to identity at this canvas
    const next: Rect = {
      x: cell.x + l,
      y: cell.y + t,
      w: Math.max(1, cell.w - (l + r)),
      h: Math.max(1, cell.h - (t + b)),
    };
    const key = String(leaf.meta.stableKey);
    overrides[key] = next;
    nodes.push({
      fromKey: key,
      toKey: key, // remapped after the rebuild rekeys
      prevRect: cell,
      nextRect: next,
    });
    insetCount++;
  }

  if (insetCount === 0 && countDocumentInsetSources(doc) === 0) {
    return fail("bakeDocumentInsets: no render-time insets to bake");
  }

  // ── Rebuild at the baked rects ──
  let rb: ReturnType<typeof rebuildRects>;
  try {
    rb = rebuildRects({
      m0,
      width: canvas.w,
      height: canvas.h,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    });
  } catch (err: unknown) {
    return fail(`bakeDocumentInsets: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!validateM0String(rb.m0).ok) {
    return fail("bakeDocumentInsets: rebuilt m0 failed validation — internal error");
  }

  // ── Sidecar migration (mirrors rebuildDocumentGeometry) ──
  const rekeyMap = new Map(rb.rekey.map((p) => [p.from, p.to]));
  const mapKey = (k: string): string => rekeyMap.get(k) ?? k;
  const liveSet = new Set(rb.liveKeys);

  const rekeySource = (src: MosaicSource): MosaicSource => {
    if (src.type === "ref" && typeof src.flattenedStableKey === "string") {
      const mapped = mapKey(src.flattenedStableKey);
      if (mapped !== src.flattenedStableKey) {
        if (liveSet.has(mapped)) {
          return { ...src, flattenedStableKey: asFlattenedStableKey(mapped) };
        }
        const { flattenedStableKey: _drop, ...rest } = src;
        return rest as MosaicSource;
      }
    }
    return src;
  };

  // Gather renderables into the rebuilt frame order, rekey back-edges, and
  // strip EVERY placement.inset — the whole point of the bake.
  const newRenderables = rb.sourceOrder.map((oi) => stripInset(rekeySource(renderables[oi]!)));
  const newSources: MosaicSource[] = new Array((doc.sources ?? []).length);
  let rc = 0;
  for (let i = 0; i < (doc.sources ?? []).length; i++) {
    const s = doc.sources![i]!;
    newSources[i] = isRenderable(s) ? newRenderables[rc++]! : s;
  }

  let nextLabels = doc.labels;
  if (doc.labels) {
    nextLabels = {};
    for (const [k, v] of Object.entries(doc.labels)) {
      const nk = mapKey(k);
      if (liveSet.has(nk)) nextLabels[nk] = v;
    }
  }

  // ── Record ──
  const anchorKey = String(renderedLeaves[0]!.meta.stableKey);
  const canvasRect = { x: 0, y: 0, w: canvas.w, h: canvas.h };
  const record: MosaicGeometryEditRecord = {
    kind: "rebuild",
    fromKey: anchorKey,
    toKey: mapKey(anchorKey),
    prevRect: canvasRect,
    nextRect: canvasRect,
    canvas: { ...canvas },
    movedSourceCount: insetCount,
    scope: "subtree",
    nodes: nodes.map((n) => ({ ...n, toKey: mapKey(n.fromKey) })),
    ...(opts?.at != null ? { at: opts.at } : {}),
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

  return {
    ok: true,
    doc: nextDoc,
    record,
    insetCount,
    dslLengthBefore: String(m0).length,
    dslLengthAfter: String(rb.m0).length,
  };
}
