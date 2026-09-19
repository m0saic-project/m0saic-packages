/**
 * ============================================================================
 * dsl-tutorial — canvas camera (follow the active tile)
 * ============================================================================
 *
 * Turns the deterministic Step[] timeline into an `effects.camera` for the
 * canvas panel: a fixed zoom plus an eased `focusX`/`focusY` that pans to
 * center each tile as the geometry walk reaches it.
 *
 * The camera is ONE scale+crop on the finished canvas video (applied by the
 * engine via {@link MosaicCamera}), so it is depth-independent — it follows the
 * active tile identically whether the layout has 4 tiles or 400, which is the
 * whole point of "panning the canvas" for large layouts.
 *
 * All motion is a single ffmpeg expression over global `t` (smoothstep between
 * per-tile keyframes), so it stays frame-synced with the reveal + highlight.
 * ============================================================================
 */

import type { Step } from "./buildSteps";
import type { Timing } from "./timing";

export type CameraSpec = { zoom: number | string; focusX: string; focusY: string };

/** Min on-screen tile dimension (px) for its number + dims to paint legibly. */
const LEGIBLE_TILE_PX = 104;
/** Don't bother zooming for a sliver of legibility gain. */
const MIN_WORTH_ZOOM = 1.05;
/** Cap auto-zoom so even a pathologically dense layout keeps some context. */
const MAX_AUTO_ZOOM = 4;

/**
 * Pick the canvas zoom from LEGIBILITY, per the rule: if every tile already
 * renders its number + dims well at fit-to-panel, don't zoom (return 1).
 * Otherwise zoom just enough that the SMALLEST tile reaches a legible on-screen
 * size — the minimum zoom, which keeps the most tiles visible while the walk
 * pans across them.
 *
 * @param cellW/cellH  the canvas panel's pixel size (tiles are laid out within it).
 */
export function autoCanvasZoom(
  steps: Step[],
  parseW: number,
  parseH: number,
  cellW: number,
  cellH: number,
): number {
  if (parseW <= 0 || parseH <= 0 || cellW <= 0 || cellH <= 0) return 1;
  const leaves = steps.filter((s) => s.eventType === "emitLeaf");
  if (leaves.length === 0) return 1;

  let minTilePx = Infinity;
  let maxTileW = 0;
  let maxTileH = 0;
  for (const s of leaves) {
    const pxW = (s.rect.width / parseW) * cellW;
    const pxH = (s.rect.height / parseH) * cellH;
    minTilePx = Math.min(minTilePx, pxW, pxH);
    maxTileW = Math.max(maxTileW, s.rect.width);
    maxTileH = Math.max(maxTileH, s.rect.height);
  }
  if (!(minTilePx > 0)) return 1;

  // Never zoom past what FITS the biggest tile. At zoom z the viewport shows
  // parseW/z × parseH/z of the canvas, so a tile wider/taller than that is
  // clipped — and the walk to its side (e.g. passthroughs feeding a full-width
  // hero) falls off-screen. Capping the legibility zoom to `fitZoom` keeps every
  // tile fully on-screen; a full-bleed tile (maxTile == canvas) pins zoom to 1.
  const fitZoom = Math.min(
    maxTileW > 0 ? parseW / maxTileW : Infinity,
    maxTileH > 0 ? parseH / maxTileH : Infinity,
  );
  const z = Math.min(LEGIBLE_TILE_PX / minTilePx, fitZoom);
  if (z < MIN_WORTH_ZOOM) return 1; // tiles already fit legibly (or a full-bleed tile) → no zoom
  return Math.min(MAX_AUTO_ZOOM, z);
}

/**
 * The `focus` value (0..1) that CENTERS a tile-center fraction `f` (0..1) in a
 * `zoom`× crop window, clamped so the window never leaves the canvas.
 *
 * The camera crop window's center sits at fraction
 *   ((zoom-1)/zoom)·focus + 1/(2·zoom)
 * of the source; solving "= f" for focus gives the expression below. A tile at
 * the very edge can't be perfectly centered without showing past the canvas, so
 * the result is clamped to [0,1] (the camera bumps against the edge instead).
 */
function centerFocus(f: number, zoom: number): number {
  const v = (f * zoom - 0.5) / (zoom - 1);
  return Math.max(0, Math.min(1, v));
}

/**
 * Smoothstep piecewise interpolation through (t, v) keyframes → ffmpeg expr.
 * Holds the first value before the first keyframe and the last value after the
 * last, easing (ease-in-out) between adjacent keyframes.
 *
 * Emitted as a FLAT SUM of disjoint window-gated segments — NOT a nested
 * if-else chain. ffmpeg's expression parser has a ~100 recursion budget and a
 * nested chain consumes one level per keyframe, so a dense walk (10×10 = 100
 * leaves) makes `crop` fail at config ("Missing ')' or too many args" →
 * Invalid argument). The gates partition the timeline (`lt` head, half-open
 * `gte·lt` segments, `gte` tail), so exactly one term is nonzero at any `t`.
 * The engine rebalances the long `+` chain into a tree (applyCamera →
 * rebalanceAdditiveChains), keeping parse depth O(log n).
 */
export function focusExpr(keys: { t: number; v: number }[]): string {
  const f = (n: number) => n.toFixed(5);
  if (keys.length === 0) return "0.5";
  if (keys.length === 1) return f(keys[0].v);

  const terms: string[] = [];
  terms.push(`lt(t,${f(keys[0].t)})*(${f(keys[0].v)})`); // hold first value
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const dur = Math.max(1e-4, b.t - a.t);
    const p = `min(1,max(0,(t-${f(a.t)})/${f(dur)}))`;
    const sp = `(${p})*(${p})*(3-2*(${p}))`; // smoothstep
    const lerp = `(${f(a.v)}+(${f(b.v)}-${f(a.v)})*${sp})`;
    terms.push(`(gte(t,${f(a.t)})*lt(t,${f(b.t)}))*${lerp}`);
  }
  terms.push(`gte(t,${f(keys[keys.length - 1].t)})*(${f(keys[keys.length - 1].v)})`); // hold last
  return terms.join("+");
}

/**
 * Build a follow-the-active-tile camera from the leaf steps, or `undefined` when
 * `zoom ≤ 1` (no zoom → the canvas stays fit-to-panel, the M1a behavior).
 *
 * Keyframes are placed at each leaf's active-window CENTER so the camera is
 * settled on the tile while its highlight is brightest, easing between.
 *
 * @param parseW/parseH  the dimensions the Step rects were parsed at (camera
 *   focus is a fraction, so only the ratio matters — must match `buildSteps`).
 */
export function buildCanvasCamera(
  steps: Step[],
  timing: Timing,
  parseW: number,
  parseH: number,
  zoom: number,
): CameraSpec | undefined {
  if (!(zoom > 1) || parseW <= 0 || parseH <= 0) return undefined;

  // Keyframe on tiles AND passthroughs so the camera FOLLOWS the walk through the
  // donating `>` slots too — otherwise it pre-centers on the next EMITTED tile and
  // the passthroughs (to the side of a wide absorber) walk by off-screen.
  const leaves = steps
    .filter((s) => s.eventType === "emitLeaf" || s.eventType === "passthrough")
    .sort((a, b) => a.index - b.index);
  if (leaves.length === 0) return undefined;

  const xs: { t: number; v: number }[] = [];
  const ys: { t: number; v: number }[] = [];
  let lastSettle = 0;
  for (const s of leaves) {
    const t = timing.stepStartSec(s.index) + timing.stepDurSec / 2;
    const fx = (s.rect.x + s.rect.width / 2) / parseW;
    const fy = (s.rect.y + s.rect.height / 2) / parseH;
    xs.push({ t, v: centerFocus(fx, zoom) });
    ys.push({ t, v: centerFocus(fy, zoom) });
    lastSettle = t;
  }

  // FINAL pull-back: once the last tile has painted, ease zoom → 1 and focus →
  // center over the tail so the whole layout is revealed at the end. The engine
  // scale is rounded to EVEN every frame (applyCamera), so the per-frame `crop`
  // reinitialises cleanly as the (animated) zoom shrinks. At zoom 1 the crop offset
  // resolves to 0 → the full frame.
  const endT = timing.durationMs / 1000;
  const revealLast = timing.stepStartSec(leaves[leaves.length - 1].index); // last tile appears
  const settleOut = Math.min(lastSettle + timing.stepDurSec / 2, endT);
  // End on a deliberate HOLD of the full layout: ease to full view (zoom 1,
  // centered) by `zoomEndT`, then hold it to `endT`. Target ~`HOLD_TARGET`s of
  // hold and fit it into the tail after the last tile — the pull-back never
  // begins before the last tile is on screen (`revealLast`), so the hold is as
  // long as the tail allows. The walk's closing exit steps happen under the
  // (already-moving) pull-back, which is why the hold can outlast a short trail.
  const HOLD_TARGET = 2.0;
  const outStart = Math.max(revealLast, Math.min(settleOut, endT - HOLD_TARGET - 0.6));
  const zoomEndT = Math.min(endT, Math.max(outStart + 0.3, endT - HOLD_TARGET));
  if (endT > outStart + 1e-3) {
    xs.push({ t: outStart, v: xs[xs.length - 1].v }); // hold the last focus, then…
    ys.push({ t: outStart, v: ys[ys.length - 1].v });
    xs.push({ t: zoomEndT, v: 0.5 }); // …pan to center by zoomEndT; focusExpr then
    ys.push({ t: zoomEndT, v: 0.5 }); //    tail-HOLDS center (0.5) from zoomEndT → endT
  }

  // Zoom holds at `zoom` through the walk, eases to 1 by `zoomEndT`, then the last
  // keyframe's value (1) tail-holds through the end hold. No tail → hold `zoom`.
  const zoomExpr =
    endT > outStart + 1e-3
      ? focusExpr([{ t: outStart, v: zoom }, { t: zoomEndT, v: 1 }])
      : focusExpr([{ t: outStart, v: zoom }]);

  return { zoom: zoomExpr, focusX: focusExpr(xs), focusY: focusExpr(ys) };
}
