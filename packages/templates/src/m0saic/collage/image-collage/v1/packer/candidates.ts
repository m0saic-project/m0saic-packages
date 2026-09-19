/**
 * Candidate enumeration — the bounded lattice search space.
 *
 * A candidate is a (cols, rows) unit lattice derived from a unit-aspect
 * target. Targets come from the image mix (median landscape aspect; a
 * portrait-fit target so 1×2 suits the portrait median; 1.0 when squares
 * dominate). Column counts come from the cell-scale bounds; rows follow from
 * the canvas and the target. Everything is filtered for area-achievability
 * and pre-scored so the solver only tiles a capped, ordered list.
 */

import { classifySpans, fittingSpans, spanArea, spanVisibleAspect } from "./classify";
import { roughAxes } from "./score";
import type { LatticeCandidate, SpanClass } from "./types";

export type EnumerateCandidatesOptions = {
  canvasW: number;
  canvasH: number;
  /** Image count on this sheet. */
  count: number;
  gutterXPx: number;
  gutterYPx: number;
  marginPx: number;
  /** Readability bounds on the typical cell scale √(unitW·unitH). */
  minCellPx: number;
  maxCellPx: number;
  /** Intrinsic aspects (drives unit-aspect targets + the crop pre-score). */
  aspects: number[];
  /** Hard cap on the returned list. Default 64. */
  maxCandidates?: number;
  /** Soft crop budget (pre-score prefers within-budget menus). Default 0.3. */
  cropBudget?: number;
};

const median = (xs: number[]): number | undefined => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Unit-aspect targets from the aspect histogram. Deduplicated, deterministic
 * order (most-load-bearing first).
 */
export function unitAspectTargets(aspects: number[]): number[] {
  const landscape = aspects.filter((a) => a > 1.15);
  const portrait = aspects.filter((a) => a < 0.87);
  const squares = aspects.length - landscape.length - portrait.length;

  const targets: number[] = [];
  const push = (u: number | undefined) => {
    if (u == null) return;
    const c = clamp(u, 0.6, 2.0);
    if (!targets.some((t) => Math.abs(t - c) < 0.05)) targets.push(c);
  };
  // The modal-landscape unit (the seed's 1.27): 1×1 near-free for the modal class.
  push(median(landscape) ?? 1.27);
  // Portrait-fit: A(1,2) ≈ u/2 (gutters shift it slightly; the R±1 sweep absorbs that).
  const mp = median(portrait);
  if (mp != null) push(2 * mp);
  // Square-heavy mixes want a square-ish unit on the menu too.
  if (squares >= aspects.length * 0.3) push(1.0);
  return targets;
}

/**
 * Exact-cover ACHIEVABILITY of a lattice area: N spans with areas from the
 * fitting menu summing to exactly C·R. Areas form {1,…,maxA} minus gaps (the
 * full menu's areas are {1,2,3,4,6} — no 5). Unreachable sums are those in
 * a gap above the second-largest achievable ceiling: with the full menu only
 * `6N−1` (all-but-one at max 6, one needing the nonexistent 5). Computed
 * generically so lattice-limited menus (e.g. a 1-column lattice) stay honest.
 */
export function coverAchievable(count: number, units: number, spans: SpanClass[]): boolean {
  const areas = [...new Set(spans.map(spanArea))].sort((a, b) => a - b);
  if (areas.length === 0) return false;
  const maxA = areas[areas.length - 1];
  if (units < count || units > maxA * count) return false;
  // Greedy-safe check: walk down from the largest area; a sum is achievable
  // iff after taking k spans at maxA the remainder fits the smaller menu.
  // Small search (areas ≤ 5 distinct, count can be large) — DP over remainder
  // mod nothing needed: since 1 ∈ areas always (1x1 fits any lattice), any
  // remainder r with 0 ≤ r ≤ (count−k)·secondMax… simplest exact rule: take
  // k = max spans at maxA, rest flexible in [count−k, (count−k)·nextMax].
  if (areas[0] === 1 && areas.length >= 2) {
    const next = areas[areas.length - 2];
    for (let k = 0; k <= count; k++) {
      const rest = units - k * maxA;
      const others = count - k;
      if (rest < others * areas[0]) break; // too many maxed spans already
      if (rest <= others * next) return true;
    }
    return false;
  }
  // Degenerate menus (only 1x1): exact only.
  return units === count;
}

/**
 * `maxCellPx` is a taste PREFERENCE, not a floor — with few images on a big
 * canvas it must yield, or the only lattices in the window are far denser
 * than the images can cover (2 images at the 320px default on 1600×900 has
 * NO achievable lattice at all). Relax it toward the scale a density-2 pack
 * of `count` images actually needs, with headroom for lattice quantization.
 */
export function relaxedMaxCellPx(maxCellPx: number, canvasW: number, canvasH: number, count: number): number {
  const densityTwoScale = Math.sqrt((canvasW * canvasH) / (2 * Math.max(1, count)));
  return Math.max(maxCellPx, Math.ceil(densityTwoScale * 1.25));
}

/**
 * The largest unit count any lattice in the cell-scale window offers —
 * the geometric CAPACITY of a sheet (each image needs ≥1 unit). Drives the
 * paging trigger: more images than this cannot fit one sheet at readable
 * cell sizes. `0` = no lattice fits at all (canvas below the cell floor).
 */
export function maxLatticeUnits(opts: {
  canvasW: number;
  canvasH: number;
  gutterXPx: number;
  gutterYPx: number;
  marginPx: number;
  minCellPx: number;
  maxCellPx: number;
}): number {
  const { canvasW, canvasH, gutterXPx, gutterYPx, marginPx, minCellPx, maxCellPx } = opts;
  let best = 0;
  for (let cols = 1; cols <= 64; cols++) {
    const unitW = (canvasW - 2 * marginPx - (cols - 1) * gutterXPx) / cols;
    if (unitW < 1) break;
    for (let rows = 1; rows <= 64; rows++) {
      const unitH = (canvasH - 2 * marginPx - (rows - 1) * gutterYPx) / rows;
      if (unitH < 1) break;
      const scale = Math.sqrt(unitW * unitH);
      if (scale > maxCellPx) continue;
      if (scale < minCellPx) break;
      best = Math.max(best, cols * rows);
    }
  }
  return best;
}

/**
 * Enumerate, filter, pre-score, and cap the lattice candidates.
 * Deterministic: stable ordering by (preScore, cols, rows, target).
 */
export function enumerateCandidates(opts: EnumerateCandidatesOptions): LatticeCandidate[] {
  const {
    canvasW, canvasH, count, gutterXPx, gutterYPx, marginPx,
    minCellPx, maxCellPx, aspects,
  } = opts;
  const maxCandidates = opts.maxCandidates ?? 64;
  const cropBudget = opts.cropBudget ?? 0.3;
  if (count <= 0) throw new Error("enumerateCandidates: count must be ≥ 1");
  // `aspects` is the MIX the lattice must suit (unit-aspect targets + the
  // min-crop pre-score); `count` is how many images actually land on the
  // sheet. They're equal for a single sheet; uniform paging passes the FULL
  // mix with a per-page count so every page shares one statistics-fitted
  // lattice.
  if (aspects.length < count)
    throw new Error(`enumerateCandidates: aspects.length ${aspects.length} < count ${count}`);
  if (!(minCellPx > 0) || !(maxCellPx >= minCellPx))
    throw new Error(`enumerateCandidates: bad cell-scale bounds [${minCellPx}, ${maxCellPx}]`);

  const targets = unitAspectTargets(aspects);

  // Stage 1 — sweep the FULL (cols, rows) window the cell-scale bounds allow
  // (sampling rows only around an aspect-derived ideal misses viable
  // low-density lattices whenever the ideal conflicts with the CR ≤ maxA·N
  // cap — six landscape images on a portrait canvas found only over-dense
  // candidates that way). Rough-score cheaply, no per-image work yet.
  type Rough = { cols: number; rows: number; unitW: number; unitH: number; target: number; rough: number };
  const rough: Rough[] = [];
  for (let cols = 1; cols <= 64; cols++) {
    const unitW = (canvasW - 2 * marginPx - (cols - 1) * gutterXPx) / cols;
    if (unitW < 1) break;
    for (let rows = 1; rows <= 64; rows++) {
      const unitH = (canvasH - 2 * marginPx - (rows - 1) * gutterYPx) / rows;
      if (unitH < 1) break;
      const scale = Math.sqrt(unitW * unitH);
      if (scale > maxCellPx) continue; // rows too few — keep growing
      if (scale < minCellPx) break; //    rows too many — smaller from here on
      const units = cols * rows;
      if (units > 6 * count) break;
      if (!coverAchievable(count, units, fittingSpans(cols, rows))) continue;
      const unitAspect = unitW / unitH;
      const aspectTerm = Math.min(...targets.map((t) => Math.abs(Math.log(unitAspect / t))));
      const nearest = targets.reduce((best, t) =>
        Math.abs(Math.log(unitAspect / t)) < Math.abs(Math.log(unitAspect / best)) ? t : best,
      );
      const areaPrior = Math.abs(units - 2 * count) / count;
      rough.push({ cols, rows, unitW, unitH, target: nearest, rough: aspectTerm + 0.25 * areaPrior + 0.03 * roughAxes(cols, rows) });
    }
  }
  // The emitted m0's basis IS the lattice, so a lattice whose unit count is
  // rough (14 = 2·7) composes with nothing — the packer only proposes lattices
  // on the 5-smooth lattice (or ≤ 12 units per axis: content fill), which is
  // dense enough (1–12, 15, 16, 18, 20, 24, 25, 27, 30, 32, 36, 40, …) that a
  // sheet loses nothing; the whole window is the fallback if nothing fits.
  const onLattice = rough.filter((r) => roughAxes(r.cols, r.rows) === 0);
  const pool = onLattice.length > 0 ? onLattice : rough;
  pool.sort((a, b) => a.rough - b.rough || a.cols - b.cols || a.rows - b.rows);

  // Stage 2 — classify the surviving slice for the real pre-score (min-crop
  // estimate: each image at its cheapest fitting span) + the CR ≈ 2N prior.
  const out: LatticeCandidate[] = [];
  for (const r of pool.slice(0, Math.max(maxCandidates, 96))) {
    const spans = fittingSpans(r.cols, r.rows);
    const visibleAspect: Partial<Record<SpanClass, number>> = {};
    for (const s of spans) visibleAspect[s] = spanVisibleAspect(s, r.unitW, r.unitH, gutterXPx, gutterYPx);
    const menus = classifySpans(aspects, visibleAspect, cropBudget);
    const minCrop = menus.reduce((a, m) => a + m.options[0].cost, 0) / Math.max(1, menus.length);
    const areaPrior = Math.abs(r.cols * r.rows - 2 * count) / count;
    out.push({
      cols: r.cols,
      rows: r.rows,
      unitAspectTarget: r.target,
      unitW: r.unitW,
      unitH: r.unitH,
      visibleAspect,
      canvasW, canvasH, gutterXPx, gutterYPx, marginPx,
      preScore: minCrop + 0.05 * areaPrior + 0.03 * roughAxes(r.cols, r.rows),
    });
  }

  out.sort(
    (a, b) =>
      a.preScore - b.preScore ||
      a.cols - b.cols ||
      a.rows - b.rows ||
      a.unitAspectTarget - b.unitAspectTarget,
  );
  return out.slice(0, maxCandidates);
}
