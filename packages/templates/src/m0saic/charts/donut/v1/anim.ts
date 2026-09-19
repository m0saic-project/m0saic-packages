/**
 * ============================================================================
 * @m0saic/charts/donut/v1 — sweep animation math (pure)
 * ============================================================================
 *
 * Timing math for the donut's intro animation, kept out of the template
 * body per the bar-graph contract (math in anim.ts, ffmpeg expressions
 * confined to leaf sources).
 *
 * The engine has no radial primitive, so a continuous clockwise wipe is
 * approximated by a QUANTIZED SWEEP: the ring subdivides into thin
 * angular slivers, each its own masked color source, revealed on a
 * staggered schedule. Overlapping alpha fades soften the leading edge
 * so it reads as one motion, not a strobing fan.
 *
 * The schedule runs through the INVERSE of the easing so the sweep's
 * angular progress matches the eased count-up in the hole — the ring
 * closes exactly as the number lands.
 * ============================================================================
 */

import type { EaseName } from "@m0saic/template-utils";
import type { DonutSegmentAngles } from "./geometry";

export type SweepSliver = {
  /** Which input segment this sliver belongs to (color lookup). */
  segIndex: number;
  /** Sliver span, degrees clockwise from 12 o'clock. */
  startDeg: number;
  endDeg: number;
  /** Sweep progress [0..1] at the sliver's LEADING edge (startDeg/360). */
  frac0: number;
};

export const DEFAULT_SLIVER_DEG = 12;
export const MAX_SLIVERS = 36;

/**
 * Subdivide the segment spans into a single global clockwise schedule
 * of slivers. Each segment gets ceil(span/sliverDeg) uniform slivers;
 * when the whole ring would exceed `maxSlivers`, the pitch widens
 * deterministically to fit.
 */
export function subdivideForSweep(
  angles: DonutSegmentAngles[],
  opts: { sliverDeg?: number; maxSlivers?: number } = {},
): SweepSliver[] {
  const maxSlivers = opts.maxSlivers ?? MAX_SLIVERS;
  let sliverDeg = opts.sliverDeg ?? DEFAULT_SLIVER_DEG;
  if (!(sliverDeg > 0) || !(maxSlivers >= 1)) {
    throw new Error("subdivideForSweep: sliverDeg and maxSlivers must be positive");
  }
  if (360 / sliverDeg > maxSlivers) sliverDeg = 360 / maxSlivers;

  const out: SweepSliver[] = [];
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const span = a.endDeg - a.startDeg;
    if (span <= 0.0001) continue;
    const n = Math.max(1, Math.ceil(span / sliverDeg));
    const step = span / n;
    for (let k = 0; k < n; k++) {
      const s = a.startDeg + k * step;
      out.push({
        segIndex: i,
        startDeg: s,
        endDeg: a.startDeg + (k + 1) * step,
        frac0: s / 360,
      });
    }
  }
  return out;
}

/**
 * Inverse of the easing curve: the TIME fraction u at which the eased
 * progress reaches `p`. Used schedule-side (plain JS, deterministic) so
 * sliver start times line up with the ffmpeg-side eased count-up.
 *
 * Exact for "easeOut" (quadratic, matching template-utils' easingExpr)
 * and "linear". The cubic pair (smoothstep / easeInOut) falls back to
 * linear scheduling — the sweep still completes with the intro, it just
 * doesn't decelerate in lockstep.
 */
export function sweepInverseEase(ease: EaseName, p: number): number {
  const c = Math.max(0, Math.min(1, p));
  switch (ease) {
    case "easeOut":
      return 1 - Math.sqrt(1 - c);
    case "linear":
    case "smoothstep":
    case "easeInOut":
    default:
      return c;
  }
}
