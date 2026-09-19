/**
 * checkDocGeometry — the pure intent-vs-realized checker.
 *
 * Parses `doc.m0` at the canvas, matches expectations to render frames, and
 * compares each realized (and inset-recovered) box to the author's intent.
 * NEVER throws — invalid m0 degrades to "every expectation missing its frame",
 * and the `evaluateM0` floors are computed under a guard.
 *
 * The crux: `placement.inset` is applied by the ENGINE at render time
 * (`applyInsetToRect`), NOT by the m0 parser — so the parsed render frame for an
 * inset piece is its OUTWARD-quantized CELL, not the painted box. The checker
 * replays the engine's floor math (`engineRecover`) to get the painted box, then
 * asserts THAT against intent. Comparing the raw cell would false-fail every
 * inset-recovery piece.
 *
 * Selection precedence per expectation: **StableKey** (`meta.stableKey` —
 * guaranteed unique identity, assert a subset without enumerating every rect) >
 * **zip** (front-door emitters: one expectation per painted frame, same paint
 * order) > **nearest-containing** (hand-built positional, by intended center).
 */

import type {
  MosaicDocument,
  MosaicGeometryViolation,
  MosaicGeometryContractFloors,
  MosaicGeometryContractMatch,
} from "@m0saic/types";
import { parseM0StringComplete, validateM0String, type RenderFrame } from "@m0saic/dsl";
import { evaluateM0 } from "@m0saic/dsl-stdlib";
import type { GeometryExpectation, CheckDocGeometryResult } from "./types";

type Rect = { x: number; y: number; w: number; h: number };

const DEFAULT_TOLERANCE_PX = 1;
const DEFAULT_ASPECT_TOLERANCE = 0.02;

/**
 * Replicate the engine's `applyInsetToRect` (core `ffmpegCommands.ts`): FLOOR
 * per edge, then clamp size to ≥1. The zero-drift contract is judged under
 * EXACTLY this math. Kept inline (not imported from a test) so the checker
 * carries its own copy of the reference — mirrors `placeInsetRects.test.ts`'s
 * `engineRecover`.
 */
export function engineRecover(cell: Rect, inset: GeometryExpectation["inset"]): Rect {
  if (!inset) return { ...cell };
  const l = Math.floor(inset.left * cell.w);
  const r = Math.floor(inset.right * cell.w);
  const t = Math.floor(inset.top * cell.h);
  const b = Math.floor(inset.bottom * cell.h);
  return {
    x: cell.x + l,
    y: cell.y + t,
    w: Math.max(1, cell.w - (l + r)),
    h: Math.max(1, cell.h - (t + b)),
  };
}

function frameRect(f: RenderFrame): Rect {
  // RenderFrame extends M0Rect = { x, y, width, height } — map to w/h.
  return { x: f.x, y: f.y, w: f.width, h: f.height };
}

function centerContains(box: Rect, r: Rect): boolean {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function label(exp: GeometryExpectation, i: number): string {
  return exp.name ?? `piece[${i}]`;
}

function mkViolation(
  index: number,
  exp: GeometryExpectation,
  kind: MosaicGeometryViolation["kind"],
  axis: "x" | "y" | undefined,
  intended: Rect,
  realized: Rect | undefined,
  deltaPx: number,
  detail: string,
): MosaicGeometryViolation {
  return { index, name: exp.name, kind, axis, intended, realized, deltaPx: round1(deltaPx), detail };
}

/** Guarded floors — `evaluateM0` throws on invalid m0; degrade, never throw. */
function floorsFor(m0: string, w: number, h: number): MosaicGeometryContractFloors {
  try {
    const e = evaluateM0(m0, { width: w, height: h });
    return { feasible: e.feasible, meetsPrecision: e.meetsPrecision, maxSpreadPx: e.maxSpreadPx };
  } catch {
    return { feasible: false, meetsPrecision: false, maxSpreadPx: Infinity };
  }
}

/** No inset: split any divergence into `position` (x/y) and `size` (w/h) per axis. */
function pushPositionSize(
  out: MosaicGeometryViolation[],
  i: number,
  exp: GeometryExpectation,
  intended: Rect,
  box: Rect,
  tol: number,
): void {
  const dx = box.x - intended.x;
  const dy = box.y - intended.y;
  const dw = box.w - intended.w;
  const dh = box.h - intended.h;
  if (Math.abs(dx) > tol)
    out.push(mkViolation(i, exp, "position", "x", intended, box, dx,
      `${label(exp, i)}: x off by ${round1(dx)}px (intended ${intended.x}, realized ${box.x}; tol ${tol}).`));
  if (Math.abs(dy) > tol)
    out.push(mkViolation(i, exp, "position", "y", intended, box, dy,
      `${label(exp, i)}: y off by ${round1(dy)}px (intended ${intended.y}, realized ${box.y}; tol ${tol}).`));
  if (Math.abs(dw) > tol)
    out.push(mkViolation(i, exp, "size", "x", intended, box, dw,
      `${label(exp, i)}: width off by ${round1(dw)}px (intended ${intended.w}, realized ${box.w}; tol ${tol}).`));
  if (Math.abs(dh) > tol)
    out.push(mkViolation(i, exp, "size", "y", intended, box, dh,
      `${label(exp, i)}: height off by ${round1(dh)}px (intended ${intended.h}, realized ${box.h}; tol ${tol}).`));
}

/** Keyed dims-only: assert realized w/h against `expectSize`, independent of position. */
function pushSizeOnly(
  out: MosaicGeometryViolation[],
  i: number,
  exp: GeometryExpectation,
  intended: Rect,
  box: Rect,
  want: { w?: number; h?: number },
  tol: number,
): void {
  if (want.w != null) {
    const dw = box.w - want.w;
    if (Math.abs(dw) > tol)
      out.push(mkViolation(i, exp, "size", "x", intended, box, dw,
        `${label(exp, i)}: width off by ${round1(dw)}px (intended ${want.w}, realized ${box.w}; tol ${tol}).`));
  }
  if (want.h != null) {
    const dh = box.h - want.h;
    if (Math.abs(dh) > tol)
      out.push(mkViolation(i, exp, "size", "y", intended, box, dh,
        `${label(exp, i)}: height off by ${round1(dh)}px (intended ${want.h}, realized ${box.h}; tol ${tol}).`));
  }
}

/** Inset piece: the recovered box must reproduce intent under floor math (per axis). */
function pushInsetRecovery(
  out: MosaicGeometryViolation[],
  i: number,
  exp: GeometryExpectation,
  intended: Rect,
  box: Rect,
  tol: number,
): void {
  const dx = box.x - intended.x;
  const dy = box.y - intended.y;
  const dw = box.w - intended.w;
  const dh = box.h - intended.h;
  if (Math.abs(dx) > tol || Math.abs(dw) > tol) {
    const d = Math.abs(dx) >= Math.abs(dw) ? dx : dw;
    out.push(mkViolation(i, exp, "inset-recovery", "x", intended, box, d,
      `${label(exp, i)}: inset recovery off on x (intended x=${intended.x} w=${intended.w}, ` +
        `recovered x=${box.x} w=${box.w}; tol ${tol}).`));
  }
  if (Math.abs(dy) > tol || Math.abs(dh) > tol) {
    const d = Math.abs(dy) >= Math.abs(dh) ? dy : dh;
    out.push(mkViolation(i, exp, "inset-recovery", "y", intended, box, d,
      `${label(exp, i)}: inset recovery off on y (intended y=${intended.y} h=${intended.h}, ` +
        `recovered y=${box.y} h=${box.h}; tol ${tol}).`));
  }
}

/**
 * Check that every expectation's intended geometry survived to the parsed m0's
 * render frames at `(canvasW, canvasH)`. Pure; never throws.
 */
export function checkDocGeometry(
  doc: MosaicDocument,
  opts: {
    canvasW: number;
    canvasH: number;
    expectations: GeometryExpectation[];
    /**
     * Default per-edge tolerance. `1` = healthy-RATIO jitter allowed (the ≤1px
     * quantization spread is by-design); inset-recovery expectations default to
     * `0` regardless — byte-exactness is their contract.
     */
    tolerancePx?: number;
  },
): CheckDocGeometryResult {
  const W = Math.max(1, Math.round(opts.canvasW));
  const H = Math.max(1, Math.round(opts.canvasH));
  const m0 = String(doc.m0 ?? "");
  const defaultTol = opts.tolerancePx ?? DEFAULT_TOLERANCE_PX;
  const floors = floorsFor(m0, W, H);
  const expectations = opts.expectations ?? [];

  if (expectations.length === 0) {
    return { ok: true, violations: [], floors, matched: [], resolvedLabels: {} };
  }

  // Parse → render frames (painted leaves only). Invalid m0 → no frames → every
  // expectation reports missing-frame (still never throws).
  const parsed = validateM0String(m0).ok ? parseM0StringComplete(m0, W, H) : null;
  const frames: RenderFrame[] = parsed && parsed.ok ? parsed.ir.renderFrames : [];

  // The engine binds a source to a cell by `logicalIndex` — `sources[frame.
  // logicalIndex]`, NOT by paint order. Index frames by that so a tagged source
  // (wherever the builder placed it in the m0 string) ties to the exact node.
  const framesByLogical: RenderFrame[] = [];
  for (const f of frames) framesByLogical[f.logicalIndex] = f;

  // Resolve every tagged source (`sources[i].editor.label`) → its stableKey, so
  // the caller can backfill `doc.labels`. Cheap: reuses the one parse above.
  const sources = doc.sources ?? [];
  const srcLabel = (i: number): string | undefined =>
    (sources[i] as { editor?: { label?: string } } | undefined)?.editor?.label;
  const resolvedLabels: Record<string, string> = {};
  for (const f of frames) {
    const label = srcLabel(f.logicalIndex);
    if (label) resolvedLabels[String(f.meta.stableKey)] = label;
  }

  // Matching. StableKey → guaranteed identity selection (assert a subset). Else
  // the front-door fast path: emitters (placeInsetPieces / placeOptimizedPieces)
  // produce one expectation per painted frame in the SAME paint order → zip by
  // index (only when EVERY expectation is positional). Else hand-built → nearest
  // CONTAINING frame with a deterministic tiebreak → missing-frame if none.
  const allPositional = expectations.every((e) => !e.stableKey);
  const zip = allPositional && frames.length > 0 && frames.length === expectations.length;

  const violations: MosaicGeometryViolation[] = [];
  const matched: MosaicGeometryContractMatch[] = [];

  expectations.forEach((exp, i) => {
    // `intended` for readouts/missing-frame before the frame is resolved.
    const declaredIntent: Rect = exp.rect
      ? { x: exp.rect.x, y: exp.rect.y, w: exp.rect.w, h: exp.rect.h }
      : { x: 0, y: 0, w: exp.expectSize?.w ?? 0, h: exp.expectSize?.h ?? 0 };

    let frame: RenderFrame | undefined;
    let how: string;
    if (exp.stableKey) {
      frame = frames.find((f) => f.meta.stableKey === exp.stableKey);
      how = `with stableKey "${exp.stableKey}"`;
    } else if (zip) {
      // Front-door order: expectation[i] ↔ sources[i] ↔ the frame with
      // logicalIndex i (the engine's source binding), NOT frames[i] by paint.
      frame = framesByLogical[i];
      how = `at source index ${i}`;
    } else if (exp.rect) {
      // Nearest containing: frames whose box contains the intended center;
      // tiebreak by smallest area, then lowest logicalIndex (deterministic).
      frame = frames
        .filter((f) => centerContains(frameRect(f), declaredIntent))
        .sort((a, b) => a.width * a.height - b.width * b.height || a.logicalIndex - b.logicalIndex)[0];
      how = "containing its intended center";
    } else {
      how = "— expectation declares no selector (need stableKey or rect)";
    }

    // Resolve identity for EVERY expectation (pass or fail) from the one parse:
    // the stableKey, the sourceIndex (= logicalIndex = its index into
    // `sources[]`), and the source's human tag.
    const stableKey = frame ? String(frame.meta.stableKey) : undefined;
    const sourceIndex = frame ? frame.logicalIndex : undefined;
    const tag = frame ? srcLabel(frame.logicalIndex) : undefined;
    matched.push({ index: i, name: exp.name, stableKey, sourceIndex, label: tag });

    if (!frame) {
      violations.push(mkViolation(i, exp, "missing-frame", undefined, declaredIntent, undefined, 0,
        `${label(exp, i)}: no render frame ${how} (${W}×${H}).`));
      return;
    }

    const cell = frameRect(frame);
    const box = exp.inset ? engineRecover(cell, exp.inset) : cell;
    const tol = exp.tolerancePx ?? (exp.inset ? 0 : defaultTol);
    // With a rect: the declared intent. Keyed dims-only: keep the realized
    // position, substitute the expected size (so readouts stay sensible).
    const intended: Rect = exp.rect
      ? declaredIntent
      : { x: box.x, y: box.y, w: exp.expectSize?.w ?? box.w, h: exp.expectSize?.h ?? box.h };

    // Collect this expectation's violations locally, then stamp the matched
    // frame's identity (stableKey + paintIndex) onto each before merging.
    const local: MosaicGeometryViolation[] = [];

    if (exp.inset && exp.rect) pushInsetRecovery(local, i, exp, intended, box, tol);
    else if (exp.rect) pushPositionSize(local, i, exp, intended, box, tol);
    else if (exp.expectSize) pushSizeOnly(local, i, exp, intended, box, exp.expectSize, tol);

    // min-size clip guard.
    if (exp.minPx) {
      if (exp.minPx.w != null && box.w < exp.minPx.w)
        local.push(mkViolation(i, exp, "min-size", "x", intended, box, box.w - exp.minPx.w,
          `${label(exp, i)}: realized width ${box.w}px < min ${exp.minPx.w}px (clip risk).`));
      if (exp.minPx.h != null && box.h < exp.minPx.h)
        local.push(mkViolation(i, exp, "min-size", "y", intended, box, box.h - exp.minPx.h,
          `${label(exp, i)}: realized height ${box.h}px < min ${exp.minPx.h}px (clip risk).`));
    }

    // aspect ratio.
    if (exp.expectAspect != null) {
      const at = exp.aspectTolerance ?? DEFAULT_ASPECT_TOLERANCE;
      const ar = box.w / Math.max(1, box.h);
      if (Math.abs(ar - exp.expectAspect) > at)
        local.push(mkViolation(i, exp, "aspect", undefined, intended, box, ar - exp.expectAspect,
          `${label(exp, i)}: realized aspect ${ar.toFixed(3)} ≠ ${exp.expectAspect.toFixed(3)} (±${at}).`));
    }

    // mask-scale: mask bounds must scale 1:1 (undistorted) into the painted box.
    if (exp.maskBounds) {
      const at = exp.aspectTolerance ?? DEFAULT_ASPECT_TOLERANCE;
      const maskAr = exp.maskBounds.width / Math.max(1, exp.maskBounds.height);
      const boxAr = box.w / Math.max(1, box.h);
      if (Math.abs(maskAr - boxAr) > at)
        local.push(mkViolation(i, exp, "mask-scale", undefined, intended, box, boxAr - maskAr,
          `${label(exp, i)}: mask bounds aspect ${maskAr.toFixed(3)} distorts into box aspect ${boxAr.toFixed(3)}.`));
    }

    for (const v of local) {
      v.stableKey = stableKey;
      v.sourceIndex = sourceIndex;
    }
    violations.push(...local);
  });

  return { ok: violations.length === 0, violations, floors, matched, resolvedLabels };
}
