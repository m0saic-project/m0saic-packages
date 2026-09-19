/**
 * Luminance-adaptive per-cell α (embedding strength) curve.
 *
 * Spread-spectrum watermarks face a fundamental trade-off: too small
 * α is invisible but doesn't survive codec quantization; too large α
 * is robust but visible. The standard mitigation is **perceptual
 * masking** — embedding more aggressively in regions where the
 * watermark hides better.
 *
 * In v1 we use a simple two-knob model keyed on per-cell average
 * luminance:
 *
 *   - **Dark cells (Y ≈ 0)** can carry slightly more positive lift
 *     than negative dip (subtracting from near-0 luminance shows
 *     more banding than adding). We keep these in the middle band.
 *   - **Bright cells (Y ≈ 255)** suffer the symmetric problem.
 *   - **Mid-luminance cells (Y ≈ 128)** mask noise best — that's
 *     where the textbook says to dump the watermark energy.
 *
 * Resulting α curve (bell): α_min at the dark/bright extremes,
 * α_max near Y=128. Implemented as a clamped quadratic.
 *
 * When `luminanceAdaptive` is false (or `luminanceY` is undefined),
 * every cell uses `alphaBase`.
 */

export interface AlphaCurveOpts {
  alphaBase: number;
  alphaMin: number;
  alphaMax: number;
  luminanceAdaptive: boolean;
}

/**
 * Host "activity" (luma units) at which a cell is considered fully
 * textured and earns the full adaptive α. Activity is the spread
 * (max − min) of a cell's 2×2 sub-cell means: a smooth gradient reads
 * ~1–4, real texture ≥ 24. Below this the gain falls linearly — a flat
 * wall or sky carries the mark at `alphaMin`, where a constant per-cell
 * step is what the eye picks out as a faint checkerboard (gate-34
 * founder catch: "sorta visible on renders").
 */
export const ACTIVITY_FULL_GAIN = 24;

/**
 * Texture gain in [0, 1] from a cell's activity (max − min of its 2×2
 * sub-cell means). Undefined activity → 1 (luma-only curve).
 */
export function textureGain(activity: number | undefined): number {
  if (activity === undefined || !Number.isFinite(activity)) return 1;
  return clamp(activity / ACTIVITY_FULL_GAIN, 0, 1);
}

/**
 * Per-cell α from BOTH masks: the luminance bell (`alphaForLuminance`)
 * scaled toward `alphaMin` on low-activity cells. Non-adaptive → `alphaBase`.
 */
export function alphaForCell(
  luminanceY: number | undefined,
  activity: number | undefined,
  opts: AlphaCurveOpts,
): number {
  if (!opts.luminanceAdaptive) return opts.alphaBase;
  const byLuma = alphaForLuminance(luminanceY, opts);
  if (activity === undefined) return byLuma;
  const a = opts.alphaMin + (byLuma - opts.alphaMin) * textureGain(activity);
  return clamp(a, opts.alphaMin, opts.alphaMax);
}

/**
 * Compute the per-cell α given the cell's average luminance (0-255).
 *
 * When `luminanceAdaptive` is false, returns `alphaBase`. When true,
 * returns a bell curve peaking at Y=128 with α_max, falling to α_min
 * at Y=0 and Y=255.
 */
export function alphaForLuminance(
  luminanceY: number | undefined,
  opts: AlphaCurveOpts,
): number {
  if (!opts.luminanceAdaptive || luminanceY === undefined) {
    return opts.alphaBase;
  }
  const y = Math.max(0, Math.min(255, luminanceY));
  // Normalize Y to [-1, +1] centered on 128.
  const u = (y - 128) / 128;
  // Bell: peak at u=0 (luminanceY=128), zero at |u|=1.
  // shape = 1 - u^2 ∈ [0, 1]
  const shape = 1 - u * u;
  // Linear blend between alphaMin and alphaMax according to shape.
  const a = opts.alphaMin + (opts.alphaMax - opts.alphaMin) * shape;
  return clamp(a, opts.alphaMin, opts.alphaMax);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Default α settings tuned for "survives YouTube re-upload" at
 * 1080p/30fps with 64×36 cell grid. These are starting points;
 * production tuning will refine via the round-trip harness in
 * `packages/cli/__tests__/forensic-watermark.round-trip.e2e.test.js`.
 */
export const DEFAULT_ALPHA_OPTS: AlphaCurveOpts = {
  alphaBase: 0.012,
  alphaMin: 0.004,
  alphaMax: 0.025,
  luminanceAdaptive: true,
};
