/**
 * Lattice relations — 2-D relational checkers for packed layouts.
 *
 * The 1-D `gutter` relation sorts ALL boxes along one axis and measures
 * consecutive gaps — correct for a single row/column, meaningless for a 2-D
 * lattice (boxes in different rows overlap along x, so "gaps" go negative).
 * These checkers are the 2-D siblings, built for layout-solver templates
 * (image-collage) whose invariants are "every adjacent pair of cells sits
 * exactly `g` px apart" and "gutters + margins are the ONLY null space".
 *
 * Units are PIXELS, not canvas fractions, on purpose: the gutter is authored
 * in pixels (a `gutterPx` prop) and the tolerance is the engine's per-edge
 * floor-error bound (≤2px), which is absolute — a fraction would make the
 * check meaninglessly loose on large canvases and impossibly strict on small
 * ones.
 */

import type { MosaicLayoutViolation } from "@m0saic/types";

type Box = { x: number; y: number; w: number; h: number };

/**
 * 2-D lattice gutter invariant. Per axis: every DIRECTLY-adjacent pair of
 * boxes (sharing a cross-axis band, with no box between them) contributes one
 * gutter sample. With a target, every sample must sit within `tolerancePx` of
 * it; without one, the samples must be uniform (spread ≤ 2·`tolerancePx`). An
 * axis with no samples (single column/row) checks nothing. Note this asserts
 * EVERY adjacent gap — a layout with a hole reads as a giant gap and fails,
 * which is exactly the packing-failure signal a full-cover collage wants.
 */
export type LatticeGutterSpec = {
  /** Target gap in px between x-adjacent boxes. Omit → assert uniformity only. */
  gutterXPx?: number;
  /** Target gap in px between y-adjacent boxes. Omit → assert uniformity only. */
  gutterYPx?: number;
  /** Per-sample tolerance in px. Default `2` (the per-edge floor-error bound). */
  tolerancePx?: number;
};

/**
 * Null-space accounting: the labeled boxes' painted area vs the canvas.
 * `expectedNullFrac` is the fraction of the canvas the solver PLANNED to leave
 * unpainted (gutters + margins). Painted area is overlap-corrected (pairwise),
 * so overlapping boxes — an emitter bug — both shrink the painted number and
 * surface in the violation detail.
 */
export type CoverageSpec = {
  /** Planned unpainted fraction of the canvas (gutters + margins). */
  expectedNullFrac: number;
  /** Tolerance as a canvas-area fraction. Default `0.01`. */
  tolerance?: number;
};

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Gap samples between every DIRECTLY-adjacent pair along `axis`. A pair is
 * adjacent when it shares a cross-axis band wider than `tol` px (a genuine
 * band, not a corner kiss) and no third box sits between them inside that
 * shared band. Direct adjacency (not nearest-neighbor) matters for spans: a
 * 1×2 tall cell beside two stacked cells fronts TWO gutters, and both must
 * hold. Boxes further than `tol` past an edge (real overlaps) are not
 * adjacency — the coverage check owns those. O(n³) worst case; fine at
 * contact-sheet counts (paging bounds n).
 */
function gapSamples(boxes: Box[], axis: "x" | "y", tol: number): number[] {
  const start = (b: Box) => (axis === "x" ? b.x : b.y);
  const end = (b: Box) => (axis === "x" ? b.x + b.w : b.y + b.h);
  const crossStart = (b: Box) => (axis === "x" ? b.y : b.x);
  const crossEnd = (b: Box) => (axis === "x" ? b.y + b.h : b.x + b.w);

  const samples: number[] = [];
  for (const a of boxes) {
    for (const b of boxes) {
      if (b === a) continue;
      if (start(b) < end(a) - tol) continue;
      const lo = Math.max(crossStart(a), crossStart(b));
      const hi = Math.min(crossEnd(a), crossEnd(b));
      if (hi - lo <= tol) continue;
      const occluded = boxes.some((c) => {
        if (c === a || c === b) return false;
        if (Math.min(hi, crossEnd(c)) - Math.max(lo, crossStart(c)) <= tol) return false;
        return start(c) >= end(a) - tol && end(c) <= start(b) + tol;
      });
      if (!occluded) samples.push(start(b) - end(a));
    }
  }
  return samples;
}

/** Check the 2-D lattice-gutter invariant. Appends violations; never throws. */
export function checkLatticeGutter(
  label: string,
  spec: LatticeGutterSpec,
  boxes: Box[],
  out: MosaicLayoutViolation[],
): void {
  const tol = spec.tolerancePx ?? 2;
  for (const axis of ["x", "y"] as const) {
    const target = axis === "x" ? spec.gutterXPx : spec.gutterYPx;
    const samples = gapSamples(boxes, axis, tol);
    if (samples.length === 0) continue;

    if (target != null) {
      let worst = samples[0];
      for (const s of samples) if (Math.abs(s - target) > Math.abs(worst - target)) worst = s;
      if (Math.abs(worst - target) > tol)
        out.push({
          label, rule: "lattice-gutter", expected: target, actual: round1(worst),
          detail: `"${label}" ${axis}-lattice gutter ${round1(worst)}px ≠ target ${target}px (±${tol}px) across ${samples.length} adjacent pairs.`,
        });
    } else {
      const min = Math.min(...samples), max = Math.max(...samples);
      if (max - min > 2 * tol)
        out.push({
          label, rule: "lattice-gutter", expected: `uniform ±${tol}px`, actual: round1(max - min),
          detail: `"${label}" ${axis}-lattice gutters not uniform: ${round1(min)}px…${round1(max)}px (Δ ${round1(max - min)}px > ${2 * tol}px) across ${samples.length} adjacent pairs.`,
        });
    }
  }
}

/** Pairwise intersection area (a correct collage has none; a bug surfaces here). */
function overlapArea(boxes: Box[]): number {
  let sum = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ow > 0 && oh > 0) sum += ow * oh;
    }
  }
  return sum;
}

/** Check the coverage / null-space invariant. Appends violations; never throws. */
export function checkCoverage(
  label: string,
  spec: CoverageSpec,
  boxes: Box[],
  canvasW: number,
  canvasH: number,
  out: MosaicLayoutViolation[],
): void {
  const tol = spec.tolerance ?? 0.01;
  const canvasArea = canvasW * canvasH;
  if (canvasArea <= 0) return;
  const sum = boxes.reduce((acc, b) => acc + b.w * b.h, 0);
  const overlap = overlapArea(boxes);
  const painted = sum - overlap;
  const nullFrac = 1 - painted / canvasArea;
  if (Math.abs(nullFrac - spec.expectedNullFrac) > tol) {
    const overlapNote = overlap > 0 ? ` (${Math.round(overlap)}px² of box OVERLAP — boxes should be disjoint)` : "";
    out.push({
      label, rule: "coverage", expected: spec.expectedNullFrac, actual: round3(nullFrac),
      detail: `"${label}" null space ${(nullFrac * 100).toFixed(1)}% ≠ planned ${(spec.expectedNullFrac * 100).toFixed(1)}% (±${(tol * 100).toFixed(1)}%) — painted ${(100 - nullFrac * 100).toFixed(1)}% of ${canvasW}×${canvasH}${overlapNote}.`,
    });
  }
}
