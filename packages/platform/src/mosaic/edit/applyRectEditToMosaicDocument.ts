import type {
  MosaicDocument,
  MosaicGeometryEditKind,
  MosaicGeometryEditRecord,
  MosaicGeometryEditRect,
  MosaicSource,
} from "@m0saic/types";
import { asFlattenedStableKey } from "@m0saic/types";
import { parseM0StringToFullGraph, type EditorFrame } from "@m0saic/dsl";
import {
  addOverlayLayer,
  evaluateM0,
  extractNodeByStableId,
  findFirstFrame,
  placeRect,
  replaceNodeByStableId,
  setTileType,
  toM0String,
} from "@m0saic/dsl-stdlib";

export type RectEditInput = {
  /** StableKey of the node to move, in the document's (flat) m0 keyspace. */
  stableKey: string;
  /** Target rect in integer DOCUMENT OUTPUT pixels. */
  rect: MosaicGeometryEditRect;
  /** Document output dims (`doc.size`); the placeRect root and floor basis. */
  canvas: { w: number; h: number };
  kind: MosaicGeometryEditKind;
  /** Optional ISO timestamp stamped onto the edit record. */
  at?: string;
};

export type RectEditResult =
  | { ok: true; doc: MosaicDocument; record: MosaicGeometryEditRecord }
  | { ok: false; error: string };

/** Rect-equality tolerance (px) when relocating the nulled origin node. */
const RECT_EPSILON = 1.5;

function fail(error: string): RectEditResult {
  return { ok: false, error };
}

function isRenderable(s: MosaicSource): boolean {
  return s.type !== "data";
}

/**
 * A parsed node that consumes a renderable source slot. Only rendered
 * frames carry a logicalIndex — INCLUDING a renderable root (`1{…}` /
 * `F{…}` parses as kind "root" with logicalIndex 0), which flat template
 * docs commonly use as the base layer under an overlay chain.
 */
function isRenderedLeaf(f: EditorFrame): boolean {
  return (f.kind === "frame" || f.kind === "root") && f.logicalIndex != null;
}

function sameRect(a: EditorFrame, b: EditorFrame): boolean {
  return (
    Math.abs(a.x - b.x) <= RECT_EPSILON &&
    Math.abs(a.y - b.y) <= RECT_EPSILON &&
    Math.abs(a.width - b.width) <= RECT_EPSILON &&
    Math.abs(a.height - b.height) <= RECT_EPSILON
  );
}

/**
 * Apply one human rect edit to a FLAT `MosaicDocument` — the safe
 * "null + re-place" operation that never rebalances sibling geometry:
 *
 * 1. Null the grabbed node in place (`-` consumes its space without
 *    donating, so every untouched frame keeps its exact rect AND its
 *    stableKey).
 * 2. Re-place the node's content as a `placeRect` layer appended as the
 *    new TOPMOST root overlay layer (overlays never shift structural
 *    identity).
 * 3. Reorder `sources` positionally (the appended layer's leaves parse
 *    last in logical order) and re-key stableKey-addressed sidecar data
 *    (`labels`, ref `flattenedStableKey` back-edges) from the old keys
 *    to the new ones.
 *
 * Kinds:
 * - `"move_subtree"` (default grab) — the node and everything inside it,
 *   including an attached overlay chain, move together.
 * - `"move_rect_only"` — only the node's own rendered leaf moves; its
 *   overlay children stay behind under the nulled origin.
 *
 * The document must be flat (`children` empty): one m0, one keyspace,
 * positional sources. Flatten first via `flattenMosaicDocument`.
 *
 * Known limitation (by design): the placed layer is always topmost, so
 * an edit can break z-order against content that painted above the
 * origin. Edits of that nature belong at the template level.
 */
export function applyRectEditToMosaicDocument(
  doc: MosaicDocument,
  edit: RectEditInput,
): RectEditResult {
  const { stableKey: fromKey, rect, canvas, kind } = edit;

  if (doc.kind !== "mosaic_document") {
    return fail("applyRectEditToMosaicDocument: document must be a mosaic_document");
  }
  if (doc.children && Object.keys(doc.children).length > 0) {
    return fail(
      "applyRectEditToMosaicDocument: document must be FLAT (children empty) — flatten it first",
    );
  }
  if (
    ![rect.x, rect.y, rect.w, rect.h].every(Number.isInteger) ||
    rect.w < 1 ||
    rect.h < 1
  ) {
    return fail(`applyRectEditToMosaicDocument: rect must be integer px with w/h ≥ 1`);
  }

  // ── Locate the origin node in the pre-edit parse ──
  const m0 = doc.m0;
  let frames: EditorFrame[];
  try {
    frames = parseM0StringToFullGraph(m0, canvas.w, canvas.h);
  } catch (err: unknown) {
    return fail(
      `applyRectEditToMosaicDocument: document m0 failed to parse at ${canvas.w}x${canvas.h}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const origin = frames.find((f) => String(f.meta.stableKey) === fromKey);
  if (!origin) {
    return fail(`applyRectEditToMosaicDocument: no node found with stableKey "${fromKey}"`);
  }
  if (origin.kind === "root") {
    return fail("applyRectEditToMosaicDocument: cannot move the root node");
  }
  if (kind === "move_rect_only" && origin.kind !== "frame") {
    return fail(
      `applyRectEditToMosaicDocument: move_rect_only targets a rendered leaf; "${fromKey}" is a ${origin.kind}`,
    );
  }
  if (kind === "move_subtree" && origin.kind !== "frame" && origin.kind !== "group") {
    return fail(
      `applyRectEditToMosaicDocument: cannot move a ${origin.kind} node ("${fromKey}") — donors and holes are not subtrees`,
    );
  }

  // ── Which renderable leaves travel with the node ──
  const prefix = `${fromKey}/`;
  const isMovedLeaf = (f: EditorFrame): boolean => {
    if (!isRenderedLeaf(f)) return false;
    const k = String(f.meta.stableKey);
    if (kind === "move_rect_only") return k === fromKey;
    return k === fromKey || k.startsWith(prefix);
  };
  const movedLeaves = frames
    .filter(isMovedLeaf)
    .sort((a, b) => (a.logicalIndex ?? 0) - (b.logicalIndex ?? 0));
  if (movedLeaves.length === 0) {
    return fail(
      `applyRectEditToMosaicDocument: node "${fromKey}" contains no renderable leaves`,
    );
  }
  const movedLogical = new Set(movedLeaves.map((f) => f.logicalIndex as number));

  // ── Build the next m0: null in place + placeRect layer on top ──
  let subtreeM0: string | null = null;
  let next: string;
  try {
    let base: string;
    let layer = String(
      placeRect({
        rootW: canvas.w,
        rootH: canvas.h,
        rectW: rect.w,
        rectH: rect.h,
        x: rect.x,
        y: rect.y,
      }).m0,
    );

    if (kind === "move_subtree") {
      subtreeM0 = extractNodeByStableId(m0, fromKey);

      // The resize floor: the subtree must still render AND look right
      // at the new rect (feasibility and precision are independent
      // floors — enforce the per-axis max of both).
      const ev = evaluateM0(subtreeM0, { width: rect.w, height: rect.h });
      if (!ev.feasible || !ev.meetsPrecision) {
        return fail(
          `applyRectEditToMosaicDocument: rect ${rect.w}x${rect.h} is below the node's floor ` +
            `(needs ≥ ${ev.recommendedMin.width}x${ev.recommendedMin.height})`,
        );
      }

      base = replaceNodeByStableId(m0, fromKey, "-", { overlay: "drop" });
      // Graft the subtree into the placed layer's single rendered frame.
      const slot = findFirstFrame(layer, (f) => f.kind === "frame");
      if (!slot) {
        return fail("applyRectEditToMosaicDocument: placed layer has no frame slot — internal error");
      }
      layer = replaceNodeByStableId(layer, String(slot.meta.stableKey), subtreeM0);
    } else {
      // move_rect_only: retype the leaf token; an attached overlay block
      // stays at the origin (that is the point of this kind).
      base = setTileType(m0, { by: "stableKey", key: fromKey }, "-");
    }

    next = addOverlayLayer(base, layer);
  } catch (err: unknown) {
    return fail(
      `applyRectEditToMosaicDocument: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Re-parse and derive the placed node's new identity ──
  let nextFrames: EditorFrame[];
  try {
    nextFrames = parseM0StringToFullGraph(next, canvas.w, canvas.h);
  } catch (err: unknown) {
    return fail(
      `applyRectEditToMosaicDocument: edited m0 failed to parse: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const originalLeafCount = frames.filter(isRenderedLeaf).length;
  const nextLeaves = nextFrames
    .filter(isRenderedLeaf)
    .sort((a, b) => (a.logicalIndex ?? 0) - (b.logicalIndex ?? 0));
  if (nextLeaves.length !== originalLeafCount) {
    return fail(
      `applyRectEditToMosaicDocument: leaf count changed (${originalLeafCount} → ${nextLeaves.length}) — internal error`,
    );
  }

  // The appended layer's leaves are the LAST k in logical order. Segment
  // PATHS are preserved relative to the subtree root, but overlay-namespace
  // segments encode their ABSOLUTE overlay depth (ov{d}c{k}) — the depth
  // renumbers under the graft — so the new root key is derived by segment
  // COUNT, and descendant keys are mapped empirically (see below), never by
  // string-prefix rewriting.
  const k = movedLeaves.length;
  const placedLeaves = nextLeaves.slice(nextLeaves.length - k);
  const fromSegCount = fromKey.split("/").length;
  let toKey: string | null = null;
  for (let i = 0; i < k; i++) {
    const relSegCount = String(movedLeaves[i]!.meta.stableKey).split("/").length - fromSegCount;
    const newSegs = String(placedLeaves[i]!.meta.stableKey).split("/");
    if (relSegCount < 0 || relSegCount >= newSegs.length) {
      return fail(
        `applyRectEditToMosaicDocument: grafted leaf depth mismatch — internal error`,
      );
    }
    const candidate = newSegs.slice(0, newSegs.length - relSegCount).join("/");
    if (toKey == null) toKey = candidate;
    else if (toKey !== candidate) {
      return fail(
        `applyRectEditToMosaicDocument: grafted leaves disagree on the new root key ("${toKey}" vs "${candidate}") — internal error`,
      );
    }
  }
  if (toKey == null) {
    return fail("applyRectEditToMosaicDocument: could not derive the placed node's key — internal error");
  }

  // ── For move_rect_only, locate the nulled origin (its overlay
  //    children stay behind under the null's key) ──
  let nulledKey: string | null = null;
  if (kind === "move_rect_only") {
    const parentKey = origin.meta.parentStableKey == null ? null : String(origin.meta.parentStableKey);
    const nulled = nextFrames.find(
      (f) =>
        f.kind === "null" &&
        (f.meta.parentStableKey == null ? null : String(f.meta.parentStableKey)) === parentKey &&
        sameRect(f, origin),
    );
    if (!nulled) {
      return fail(
        "applyRectEditToMosaicDocument: could not relocate the nulled origin node — internal error",
      );
    }
    nulledKey = String(nulled.meta.stableKey);
  }

  // ── Key mapping for stableKey-addressed sidecar data ──
  // Empirical: the subtree's structure is byte-identical before and after
  // the graft, so its nodes appear in the same relative parse order under
  // both roots — zip them. (String-prefix rewriting would corrupt
  // overlay-namespace segments, whose ov-depth renumbers under the graft.)
  const subtreeKeys = (all: EditorFrame[], rootKey: string): string[] =>
    all
      .map((f) => String(f.meta.stableKey))
      .filter((key) => key === rootKey || key.startsWith(`${rootKey}/`));

  const keyMap = new Map<string, string>();
  {
    const oldRoot = fromKey;
    // Where did the subtree's nodes land?
    // - move_subtree: the whole subtree lives under the placed key.
    // - move_rect_only: only the leaf moved (fromKey → toKey); its overlay
    //   descendants stayed behind under the nulled origin.
    const oldKeys = subtreeKeys(frames, oldRoot);
    const newKeys =
      kind === "move_subtree"
        ? subtreeKeys(nextFrames, toKey)
        : [toKey, ...subtreeKeys(nextFrames, nulledKey as string).slice(1)];
    if (oldKeys.length !== newKeys.length) {
      return fail(
        `applyRectEditToMosaicDocument: subtree node count changed (${oldKeys.length} → ${newKeys.length}) — internal error`,
      );
    }
    for (let i = 0; i < oldKeys.length; i++) keyMap.set(oldKeys[i]!, newKeys[i]!);
  }
  const mapKey = (key: string): string => keyMap.get(key) ?? key;

  // ── Reorder sources: moved renderables (in order) go to the end ──
  const kept: MosaicSource[] = [];
  const moved: MosaicSource[] = [];
  let renderIdx = -1;
  for (const src of doc.sources) {
    if (!isRenderable(src)) {
      kept.push(src);
      continue;
    }
    renderIdx += 1;
    if (movedLogical.has(renderIdx)) moved.push(src);
    else kept.push(src);
  }
  if (renderIdx + 1 !== originalLeafCount) {
    return fail(
      `applyRectEditToMosaicDocument: sources/frames mismatch (${renderIdx + 1} renderable sources, ${originalLeafCount} rendered leaves)`,
    );
  }
  if (moved.length !== k) {
    return fail(
      `applyRectEditToMosaicDocument: moved-source mismatch (${moved.length} sources, ${k} leaves) — internal error`,
    );
  }

  const rekeySource = (src: MosaicSource): MosaicSource => {
    if (src.type === "ref" && typeof src.flattenedStableKey === "string") {
      const mapped = mapKey(src.flattenedStableKey);
      if (mapped !== src.flattenedStableKey) {
        return { ...src, flattenedStableKey: asFlattenedStableKey(mapped) };
      }
    }
    return src;
  };
  const nextSources = [...kept, ...moved].map(rekeySource);

  // ── Re-key labels ──
  let nextLabels = doc.labels;
  if (doc.labels) {
    nextLabels = {};
    for (const [key, value] of Object.entries(doc.labels)) {
      nextLabels[mapKey(key)] = value;
    }
  }

  // ── Assemble ──
  const record: MosaicGeometryEditRecord = {
    kind,
    fromKey,
    toKey,
    prevRect: {
      x: Math.round(origin.x),
      y: Math.round(origin.y),
      w: Math.round(origin.width),
      h: Math.round(origin.height),
    },
    nextRect: { ...rect },
    canvas: { ...canvas },
    movedSourceCount: moved.length,
    ...(edit.at != null ? { at: edit.at } : {}),
  };

  const nextDoc: MosaicDocument = {
    ...doc,
    m0: toM0String(next, "applyRectEditToMosaicDocument"),
    sources: nextSources,
    ...(nextLabels ? { labels: nextLabels } : {}),
    editor: {
      ...doc.editor,
      geometryEdits: [...(doc.editor?.geometryEdits ?? []), record],
    },
  };

  return { ok: true, doc: nextDoc, record };
}
