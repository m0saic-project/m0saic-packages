/**
 * Paging — spill N images across balanced sheets.
 *
 * Pages split in INPUT ORDER with balanced sizes (N/P, first N mod P pages
 * one heavier). Two lattice modes (founder decision, 2026-07-11):
 *
 * - `"uniform"` (default): ONE lattice fitted to the global aspect mix is
 *   shared by every page — the sheets read as a designed set. Per-page span
 *   assignment still varies, and the exact-cover upgrade budget automatically
 *   gives lighter pages bigger heroes. The lattice is chosen by solving the
 *   heaviest page against the mix-fitted candidates, then cross-scoring the
 *   top few across ALL pages.
 * - `"independent"`: every page runs its own full search — best per-page crop
 *   numbers, less sibling consistency.
 *
 * Paging triggers when `maxImagesPerSheet` says so, or geometrically when N
 * exceeds the sheet's capacity (`maxLatticeUnits` — each image needs ≥1 unit).
 */

import { splitmix32 } from "@m0saic/template-utils";
import { enumerateCandidates, maxLatticeUnits, relaxedMaxCellPx } from "./candidates";
import { solveCandidate, solveCollage, type SolveCollageOptions } from "./solve";
import type { SolveResult } from "./types";

export type PageLatticeMode = "uniform" | "independent";

export type SolvePagesOptions = Omit<SolveCollageOptions, "keep"> & {
  maxImagesPerSheet?: number;
  pageLattice?: PageLatticeMode;
};

export type PageSolve = {
  /** Global input indexes on this page, in input order. */
  imageIndexes: number[];
  /** The page's solve — image indexes inside are PAGE-LOCAL (0..n−1). */
  solve: SolveResult;
};

const pageSeed = (seed: number, page: number): number =>
  Math.floor(splitmix32((seed ^ (page * 0x9e3779b1)) >>> 0)() * 4294967296);

/** Balanced page split: input order, sizes differ by at most 1. */
export function planPages(count: number, perSheet: number): number[][] {
  const pages = Math.max(1, Math.ceil(count / perSheet));
  const base = Math.floor(count / pages);
  const heavy = count % pages;
  const out: number[][] = [];
  let at = 0;
  for (let p = 0; p < pages; p++) {
    const size = base + (p < heavy ? 1 : 0);
    out.push(Array.from({ length: size }, (_, i) => at + i));
    at += size;
  }
  return out;
}

/**
 * Solve the full input as one or more pages. Deterministic. Throws only when
 * not even one image fits the canvas (capacity 0) or a page search finds no
 * lattice — both are caller-facing configuration errors.
 */
export function solvePages(opts: SolvePagesOptions): PageSolve[] {
  const { aspects } = opts;
  const count = aspects.length;
  const seed = opts.seed ?? 1;
  if (count === 0) throw new Error("solvePages: no images");

  const capacity = maxLatticeUnits(opts);
  if (capacity === 0)
    throw new Error(
      `solvePages: no lattice fits ${opts.canvasW}×${opts.canvasH} within cell bounds ` +
        `[${opts.minCellPx}, ${opts.maxCellPx}]px`,
    );
  const perSheet = Math.max(1, Math.min(opts.maxImagesPerSheet ?? Infinity, capacity));
  const pages = planPages(count, perSheet);
  if (pages.length === 1) {
    const [solve] = solveCollage({ ...opts, seed });
    return [{ imageIndexes: pages[0], solve }];
  }

  const mode: PageLatticeMode = opts.pageLattice ?? "uniform";
  const pageAspects = pages.map((idxs) => idxs.map((i) => aspects[i]));

  if (mode === "independent") {
    return pages.map((imageIndexes, p) => {
      const [solve] = solveCollage({ ...opts, aspects: pageAspects[p], seed: pageSeed(seed, p) });
      return { imageIndexes, solve };
    });
  }

  // ── uniform: one mix-fitted lattice shared across the set ──
  const heaviest = pages[0].length;
  const cropBudget = opts.cropBudget ?? 0.3;
  const candidates = enumerateCandidates({
    canvasW: opts.canvasW,
    canvasH: opts.canvasH,
    count: heaviest,
    gutterXPx: opts.gutterXPx,
    gutterYPx: opts.gutterYPx,
    marginPx: opts.marginPx,
    minCellPx: opts.minCellPx,
    // Pages hold `heaviest` images each — the taste bound yields accordingly.
    maxCellPx: relaxedMaxCellPx(opts.maxCellPx, opts.canvasW, opts.canvasH, heaviest),
    aspects, // the FULL mix — the shared lattice must suit everyone
    maxCandidates: opts.maxCandidates,
    cropBudget,
  });
  if (candidates.length === 0)
    throw new Error(`solvePages: no shared lattice fits ${heaviest} images per sheet on ${opts.canvasW}×${opts.canvasH}`);

  // Rank lattices on the heaviest page, then cross-score the top few over
  // every page (clean pages first, then summed score).
  const page0 = candidates
    .map((candidate) => {
      try {
        return { candidate, solve: solveCandidate(candidate, pageAspects[0], cropBudget, pageSeed(seed, 0)) };
      } catch {
        return undefined;
      }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort(
      (a, b) =>
        (a.solve.metrics.fillerCount > 0 ? 1 : 0) - (b.solve.metrics.fillerCount > 0 ? 1 : 0) ||
        a.solve.score - b.solve.score,
    );
  if (page0.length === 0) throw new Error("solvePages: every shared-lattice candidate failed the heaviest page");

  let best: { total: number; dirty: number; solves: SolveResult[] } | undefined;
  for (const { candidate, solve: first } of page0.slice(0, 3)) {
    const solves: SolveResult[] = [first];
    let total = first.score;
    let dirty = first.metrics.fillerCount > 0 ? 1 : 0;
    let failed = false;
    for (let p = 1; p < pages.length; p++) {
      try {
        const s = solveCandidate(candidate, pageAspects[p], cropBudget, pageSeed(seed, p));
        solves.push(s);
        total += s.score;
        if (s.metrics.fillerCount > 0) dirty++;
      } catch {
        failed = true;
        break;
      }
    }
    if (failed) continue;
    if (!best || dirty < best.dirty || (dirty === best.dirty && total < best.total)) best = { total, dirty, solves };
  }
  if (!best) {
    // No shared lattice covers every page (rare density corners) — fall back
    // to independent pages rather than failing the render.
    return pages.map((imageIndexes, p) => {
      const [solve] = solveCollage({ ...opts, aspects: pageAspects[p], seed: pageSeed(seed, p) });
      return { imageIndexes, solve };
    });
  }
  return pages.map((imageIndexes, p) => ({ imageIndexes, solve: best.solves[p] }));
}
