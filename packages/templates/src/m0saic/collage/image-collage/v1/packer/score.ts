/**
 * Solve metrics + the candidate score (lower = better).
 *
 * The score is the search's taste function: crop fidelity dominates, the
 * soft-budget overage is punished hard (it exists but should be rare), fillers
 * are punished harder (they should not exist), and small bonuses reward the
 * seed collage's look (span variety + staggered row rhythm). Weights are
 * module constants, not props — the Phase 7 sandbox loop is where they get
 * tuned against the founder's eye.
 */

import { LATTICE_SMALL_BASIS, isSmooth } from "@m0saic/template-utils";
import { fittingSpans } from "./classify";
import type { LatticeCandidate, PlacedSpan, SolveMetrics, SpanAssignment } from "./types";

export const DEFAULT_SCORE_WEIGHTS = {
  meanCrop: 1,
  maxCrop: 0.25,
  overBudgetTotal: 3,
  overBudgetCount: 0.05,
  fillerUnit: 0.5,
  sizeDiversity: -0.06,
  stagger: -0.04,
  // A nudge, not a veto: between near-equal crops, prefer the lattice whose
  // unit counts are 5-smooth (or ≤ 12) so the collage composes and every
  // guillotine sub-split stays on the lattice too.
  latticeRough: 0.03,
} as const;

export function computeMetrics(
  candidate: LatticeCandidate,
  placed: PlacedSpan[],
  assignments: SpanAssignment[],
  cropBudget: number,
): SolveMetrics {
  const real = assignments.filter((a) => a.imageIndex >= 0);
  const crops = real.map((a) => a.cost);
  const n = Math.max(1, crops.length);
  const meanCrop = crops.reduce((a, c) => a + c, 0) / n;
  const maxCrop = crops.length > 0 ? Math.max(...crops) : 0;
  const over = crops.map((c) => Math.max(0, c - cropBudget));
  const overBudgetCount = over.filter((o) => o > 0).length;
  const overBudgetTotal = over.reduce((a, o) => a + o, 0);
  const fillerCount = placed.filter((p) => p.imageIndex < 0).reduce((a, p) => a + p.cs * p.rs, 0);

  const used = new Set(real.map((a) => a.span));
  const sizeDiversity = used.size / fittingSpans(candidate.cols, candidate.rows).length;

  // Fraction of interior row boundaries crossed by at least one span — the
  // seed collage crosses all of them; plain full-width shelves cross none.
  let crossed = 0;
  const interior = Math.max(0, candidate.rows - 1);
  for (let r = 1; r < candidate.rows; r++) {
    if (placed.some((p) => p.r0 < r && r < p.r0 + p.rs)) crossed++;
  }
  const stagger = interior > 0 ? crossed / interior : 0;
  const latticeRough = roughAxes(candidate.cols, candidate.rows);

  return { meanCrop, maxCrop, overBudgetCount, overBudgetTotal, fillerCount, sizeDiversity, stagger, latticeRough };
}

export function scoreCandidate(
  metrics: SolveMetrics,
  weights: typeof DEFAULT_SCORE_WEIGHTS = DEFAULT_SCORE_WEIGHTS,
): number {
  return (
    weights.meanCrop * metrics.meanCrop +
    weights.maxCrop * metrics.maxCrop +
    weights.overBudgetTotal * metrics.overBudgetTotal +
    weights.overBudgetCount * metrics.overBudgetCount +
    weights.fillerUnit * metrics.fillerCount +
    weights.sizeDiversity * metrics.sizeDiversity +
    weights.stagger * metrics.stagger +
    weights.latticeRough * metrics.latticeRough
  );
}

/** How many of a lattice's axes are off the 5-smooth lattice (counts ≤ 12 pass as content fill). */
export function roughAxes(cols: number, rows: number): number {
  return [cols, rows].filter((n) => n > LATTICE_SMALL_BASIS && !isSmooth(n)).length;
}
