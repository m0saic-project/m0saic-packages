/**
 * The solver front door: enumerate lattice candidates, solve each
 * (classify → upgrade plan → staggered tiling), score, keep the best.
 *
 * Pure and deterministic: all variation flows from `seed` via mulberry32,
 * with per-candidate streams seeded off the candidate's position so one
 * candidate's consumption never shifts another's picks. The caller (the
 * template shell, Phase 4) adds the layout-contract gate on finalists —
 * this module is pixel-free beyond the candidate geometry.
 */

import { mulberry32, splitmix32 } from "@m0saic/template-utils";
import { classifySpans } from "./classify";
import { enumerateCandidates, relaxedMaxCellPx, type EnumerateCandidatesOptions } from "./candidates";
import { computeMetrics, scoreCandidate } from "./score";
import { planUpgrades, tileStaggered } from "./tiler";
import type { LatticeCandidate, SolveResult } from "./types";

export type SolveCollageOptions = Omit<EnumerateCandidatesOptions, "count"> & {
  cropBudget?: number;
  seed?: number;
  /** How many top-scored solves to return (the best is `[0]`). Default 1. */
  keep?: number;
};

/** Solve one candidate lattice. Deterministic per (inputs, rngSeed). */
export function solveCandidate(
  candidate: LatticeCandidate,
  aspects: number[],
  cropBudget: number,
  rngSeed: number,
): SolveResult {
  const rng = mulberry32(rngSeed);
  const menus = classifySpans(aspects, candidate.visibleAspect, cropBudget);
  const plan = planUpgrades(candidate.cols, candidate.rows, menus, rng);
  const tiled = tileStaggered(plan, candidate.cols, candidate.rows, menus, rng);
  const metrics = computeMetrics(candidate, tiled.placed, tiled.assignments, cropBudget);
  return {
    candidate,
    placed: tiled.placed,
    assignments: tiled.assignments,
    metrics,
    repairs: tiled.repairs,
    score: scoreCandidate(metrics),
  };
}

/**
 * Solve a sheet: N images (their aspects) onto the best lattice for this
 * canvas. Returns the `keep` best solves, best first. Throws when no lattice
 * candidate exists (canvas/cell bounds impossible for this N — the caller
 * pages or errors).
 */
export function solveCollage(opts: SolveCollageOptions): SolveResult[] {
  const cropBudget = opts.cropBudget ?? 0.3;
  const seed = opts.seed ?? 1;
  const keep = Math.max(1, opts.keep ?? 1);
  // Adaptive search width: big sheets cost more per solve and benefit less
  // from lattice variety (mix statistics dominate), so the default candidate
  // budget shrinks with N to keep the search interactive.
  const n = opts.aspects.length;
  const maxCandidates = opts.maxCandidates ?? (n > 240 ? 24 : n > 120 ? 40 : 64);
  // Few images on a big canvas need big cells — the max-cell taste bound
  // yields to the density-2 scale (see relaxedMaxCellPx).
  const maxCellPx = relaxedMaxCellPx(opts.maxCellPx, opts.canvasW, opts.canvasH, n);
  const candidates = enumerateCandidates({ ...opts, count: n, cropBudget, maxCandidates, maxCellPx });
  if (candidates.length === 0)
    throw new Error(
      `solveCollage: no lattice fits ${opts.aspects.length} images on ${opts.canvasW}×${opts.canvasH} ` +
        `within cell bounds [${opts.minCellPx}, ${opts.maxCellPx}]px`,
    );

  // One decorrelated rng seed per candidate, independent of list order
  // churn: keyed off the candidate's identity, not its index. A candidate
  // whose plan/tiling proves infeasible (rare geometric corners the area
  // filter can't see) is skipped — the search moves on; only an all-fail
  // search surfaces the error.
  const results: SolveResult[] = [];
  let lastError: unknown;
  for (const c of candidates) {
    const streamSeed = Math.floor(splitmix32((seed ^ (c.cols * 131 + c.rows * 17)) >>> 0)() * 4294967296);
    try {
      results.push(solveCandidate(c, opts.aspects, cropBudget, streamSeed));
    } catch (e) {
      lastError = e;
    }
  }
  if (results.length === 0) throw lastError ?? new Error("solveCollage: every candidate failed");

  // A filler-bearing solve (background holes) must never outrank a clean one,
  // regardless of score — the founder's no-filler guarantee lives here.
  results.sort(
    (a, b) =>
      (a.metrics.fillerCount > 0 ? 1 : 0) - (b.metrics.fillerCount > 0 ? 1 : 0) ||
      a.score - b.score ||
      a.candidate.cols - b.candidate.cols ||
      a.candidate.rows - b.candidate.rows,
  );
  return results.slice(0, keep);
}
