/**
 * latticeSnap — divisor-rich pixel snapping for print dielines (the fix for
 * "hostile axis" DSL blowups).
 *
 * `placeInsetRects` / `placeInsetPieces` quantize cells to a divisor lattice
 * of the axis (slots ≤ basis, default 120) and recover exact rects via
 * `placement.inset`. The pitch must DIVIDE the axis, so a prime (or
 * divisor-poor) axis length has no usable lattice: the emit degrades to exact
 * unit columns and the m0 pays ~axisLen tokens PER OCCUPIED BAND. dvd-wrap's
 * dieline at 300 DPI landed on primes (canvas 3307, panels 1571) and ballooned
 * to ~73K chars of DSL.
 *
 * Physical print tolerances dwarf a couple of pixels — ±3px at 300 DPI is
 * ±0.25mm, far inside any trim/fold tolerance — so print templates snap their
 * PIXEL dielines to divisor-rich lengths and keep the mm spec as the
 * human-facing label. Deterministic: pure integer math, no state.
 */

export interface LatticeSnapOptions {
  /** Max pixels an edge may move. Default 3 (±0.25mm at 300 DPI). */
  tolerancePx?: number;
  /** Target split basis (max slot count), matching placeInsetRects. Default 120. */
  basis?: number;
}

const DEFAULT_TOLERANCE_PX = 3;
const DEFAULT_BASIS = 120;
/** Spans with a lattice this fine (≥ 0.7 × basis slots) are "excellent" —
 *  already-excellent axes are never moved. */
function excellentSlots(basis: number): number {
  return Math.ceil(basis * 0.7);
}

/**
 * Finest usable lattice for an axis: the LARGEST slot count s = n / d (d a
 * divisor of n) with s ≤ basis. Always ≥ 1 (d = n). A prime axis > basis
 * returns 1 — a single giant cell, which `minFill` clamps straight through
 * to hostile-exact at runtime.
 */
export function latticeMaxSlots(n: number, basis: number = DEFAULT_BASIS): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`latticeMaxSlots: n must be a positive integer, got ${n}`);
  }
  if (!(basis >= 1)) {
    throw new Error(`latticeMaxSlots: basis must be ≥ 1, got ${basis}`);
  }
  if (n <= basis) return n; // exact placement already fits the budget
  for (let d = Math.ceil(n / basis); d <= n; d++) {
    if (n % d === 0) return n / d;
  }
  return 1; // unreachable (d = n always divides), kept for totality
}

/**
 * Quality tier of an axis length for lattice placement:
 *   2 — excellent: axis ≤ basis (exact is cheap) or a ≥0.7×basis lattice exists
 *   1 — usable: a ≥30-slot lattice exists (coarse; minFill may clamp)
 *   0 — effectively hostile: only degenerate lattices exist
 */
export function latticeAxisTier(n: number, basis: number = DEFAULT_BASIS): 0 | 1 | 2 {
  if (n <= basis) return 2;
  const slots = latticeMaxSlots(n, basis);
  if (slots >= excellentSlots(basis)) return 2;
  if (slots >= 30) return 1;
  return 0;
}

type Ranked = { value: number; tier: number; absDelta: number; slots: number };

function rankBetter(a: Ranked, b: Ranked): boolean {
  if (a.tier !== b.tier) return a.tier > b.tier;
  if (a.absDelta !== b.absDelta) return a.absDelta < b.absDelta;
  if (a.slots !== b.slots) return a.slots > b.slots;
  return a.value < b.value;
}

/**
 * Snap one pixel length to the most lattice-friendly value within
 * ±tolerancePx. An already-excellent length never moves (delta 0 wins all
 * ties at its tier). Returns the input when nothing in the window is better.
 */
export function snapPxToLatticeFriendly(
  px: number,
  opts: LatticeSnapOptions = {},
): number {
  const tolerancePx = opts.tolerancePx ?? DEFAULT_TOLERANCE_PX;
  const basis = opts.basis ?? DEFAULT_BASIS;
  if (!Number.isInteger(px) || px < 1) {
    throw new Error(`snapPxToLatticeFriendly: px must be a positive integer, got ${px}`);
  }
  if (!Number.isInteger(tolerancePx) || tolerancePx < 0 || tolerancePx > 10) {
    throw new Error(`snapPxToLatticeFriendly: tolerancePx must be an integer in [0, 10], got ${tolerancePx}`);
  }
  let best: Ranked | null = null;
  for (let o = -tolerancePx; o <= tolerancePx; o++) {
    const value = px + o;
    if (value < 1) continue;
    const cand: Ranked = {
      value,
      tier: latticeAxisTier(value, basis),
      absDelta: Math.abs(o),
      slots: latticeMaxSlots(value, basis),
    };
    if (!best || rankBetter(cand, best)) best = cand;
  }
  return best ? best.value : px;
}

/**
 * Jointly snap an ascending list of cumulative pixel breakpoints (the last
 * entry is the axis total) so that every CONSECUTIVE SPAN — and the total
 * itself — is lattice-friendly. This is the dieline case: panel seams are the
 * breakpoints, panel paint widths are the spans, and the canvas is both the
 * final breakpoint and its own axis (the top-level document's rootW).
 *
 * Exhaustive search over the (2·tolerance+1)^k offset grid — keep k small
 * (≤ 5 breakpoints). Scoring is lexicographic across all spans + the total:
 * maximize Σtier, then minimize Σ|offset|, then maximize Σslots, then prefer
 * the lexicographically smallest edge list (fully deterministic).
 */
export function snapEdgesToLattice(
  edges: readonly number[],
  opts: LatticeSnapOptions = {},
): number[] {
  const tolerancePx = opts.tolerancePx ?? DEFAULT_TOLERANCE_PX;
  const basis = opts.basis ?? DEFAULT_BASIS;
  if (edges.length === 0) return [];
  if (edges.length > 5) {
    throw new Error(`snapEdgesToLattice: at most 5 breakpoints supported, got ${edges.length}`);
  }
  if (!Number.isInteger(tolerancePx) || tolerancePx < 0 || tolerancePx > 10) {
    throw new Error(`snapEdgesToLattice: tolerancePx must be an integer in [0, 10], got ${tolerancePx}`);
  }
  for (let i = 0; i < edges.length; i++) {
    if (!Number.isInteger(edges[i]) || edges[i] < 1) {
      throw new Error(`snapEdgesToLattice: edges[${i}] must be a positive integer, got ${edges[i]}`);
    }
    if (i > 0 && edges[i] <= edges[i - 1]) {
      throw new Error("snapEdgesToLattice: edges must be strictly ascending");
    }
  }

  const spansOf = (candidate: number[]): number[] => {
    const spans: number[] = [];
    let prev = 0;
    for (const e of candidate) {
      spans.push(e - prev);
      prev = e;
    }
    spans.push(candidate[candidate.length - 1]); // the total is an axis too
    return spans;
  };

  let bestEdges: number[] | null = null;
  let bestScore: { tiers: number; absDelta: number; slots: number } | null = null;

  const candidate = edges.slice();
  const visit = (i: number, absDeltaSoFar: number): void => {
    if (i === edges.length) {
      const spans = spansOf(candidate);
      if (spans.some((s) => s < 1)) return;
      let tiers = 0;
      let slots = 0;
      for (const s of spans) {
        tiers += latticeAxisTier(s, basis);
        slots += latticeMaxSlots(s, basis);
      }
      const better =
        !bestScore ||
        tiers > bestScore.tiers ||
        (tiers === bestScore.tiers &&
          (absDeltaSoFar < bestScore.absDelta ||
            (absDeltaSoFar === bestScore.absDelta &&
              (slots > bestScore.slots ||
                (slots === bestScore.slots &&
                  candidate.join(",") < (bestEdges ?? []).join(","))))));
      if (better) {
        bestScore = { tiers, absDelta: absDeltaSoFar, slots };
        bestEdges = candidate.slice();
      }
      return;
    }
    for (let o = -tolerancePx; o <= tolerancePx; o++) {
      const value = edges[i] + o;
      if (value < 1) continue;
      if (i > 0 && value <= candidate[i - 1]) continue;
      candidate[i] = value;
      visit(i + 1, absDeltaSoFar + Math.abs(o));
    }
    candidate[i] = edges[i];
  };
  visit(0, 0);

  return bestEdges ?? edges.slice();
}
