/**
 * ============================================================================
 * @m0saic/charts/line-chart — frame geometry (the REAL m0 rectangles)
 * ============================================================================
 *
 * The chart frame is REAL m0 geometry, not a stack of full-canvas overlays.
 * This module is the single source of truth for the coarse frame split:
 *
 *     row: header | body | x-gutter
 *     body (col): y-gutter | plot | right-margin
 *
 * JS PIXEL MATH → INTEGER WEIGHTS (bounded basis) → m0 DSL. The plot rect is
 * DERIVED from the chosen weights so the animated data layer (the one part that
 * can't be m0 geometry) lands exactly on the geometry cells at every resolution.
 *
 * Why a bounded basis: literal-mode splits above ~200 cells trip the engine's
 * pixel-rounding bug (see the internal engine-split-pixel-rounding-bug notes).
 * Exact-pixel weights would need basis = W/gcd, which can exceed 200 at 1080p+.
 * We quantize to BASIS_COL / BASIS_ROW (≤200) and let the data follow geometry.
 * At 1280×720 the quantization is exact (reproduces the approved 72/16/120/48).
 *
 * PURE — no rendering, no m0saic types, no registration.
 * ============================================================================
 */

import type { ResolvedPadding } from "./types";

/** Column basis (width axis). ≤200 to stay under the engine split-rounding cap. */
export const BASIS_COL = 160;
/** Row basis (height axis). */
export const BASIS_ROW = 90;

export type FrameWeights = {
  basisRow: number;
  basisCol: number;
  /** Row weights: [header, body, xGutter] — sum === basisRow. */
  rootRow: [number, number, number];
  /** Body col weights: [yGutter, plot, rightMargin] — sum === basisCol. */
  bodyCol: [number, number, number];
  /** Plot rect in absolute px, DERIVED from the weights (geometry is truth). */
  plot: { left: number; top: number; right: number; bottom: number };
};

/**
 * Split a 3-part proportion into integer weights summing exactly to `basis`,
 * each ≥ 1. Round the two outer parts, give the middle the remainder so the
 * sum is exact (the middle = plot/body, which absorbs rounding harmlessly).
 */
function quantize3(parts: [number, number, number], basis: number): [number, number, number] {
  const sum = parts[0] + parts[1] + parts[2] || 1;
  const a = Math.max(1, Math.round((parts[0] / sum) * basis));
  const c = Math.max(1, Math.round((parts[2] / sum) * basis));
  const b = Math.max(1, basis - a - c);
  // Re-normalise if the clamps pushed us off `basis` (only when parts are tiny).
  const total = a + b + c;
  if (total !== basis) return [a, basis - a - c >= 1 ? basis - a - c : b, c] as [number, number, number];
  return [a, b, c];
}

/**
 * Compute the frame weights + the derived plot rect for a canvas of (W,H) with
 * the requested plot insets. The returned `plot` rect is what the caller must
 * feed to the chart MODEL so the data line/points align to the geometry cells.
 */
export function computeFrame(W: number, H: number, pad: ResolvedPadding): FrameWeights {
  const rootRow = quantize3([pad.top, H - pad.top - pad.bottom, pad.bottom], BASIS_ROW);
  const bodyCol = quantize3([pad.left, W - pad.left - pad.right, pad.right], BASIS_COL);

  const left = (bodyCol[0] / BASIS_COL) * W;
  const right = ((bodyCol[0] + bodyCol[1]) / BASIS_COL) * W;
  const top = (rootRow[0] / BASIS_ROW) * H;
  const bottom = ((rootRow[0] + rootRow[1]) / BASIS_ROW) * H;

  return { basisRow: BASIS_ROW, basisCol: BASIS_COL, rootRow, bodyCol, plot: { left, top, right, bottom } };
}
