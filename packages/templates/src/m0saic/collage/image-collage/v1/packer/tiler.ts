/**
 * The tiler — exact cover of the unit lattice by menu spans.
 *
 * Three stages, all deterministic under a seeded rng:
 *
 * 1. `planUpgrades` — every image starts at 1×1 and the extra area
 *    E = C·R − N is spent as span upgrades: cost-driven first (portraits buy
 *    1×2, panoramas buy 3×1), then taste-driven (seeded picks among
 *    near-neutral upgrades — this is where the hero 2×2s come from). Every
 *    move preserves the BAND-FEASIBILITY invariant (`bandFeasible`): the
 *    aggregate shelf accounting 3·⌈W₃/C⌉ + 2·⌈W₂/C⌉ ≤ R must keep holding,
 *    so the plan never demands more tall bands than the lattice has rows —
 *    without this, portrait-heavy mixes plan themselves into unrepairable
 *    F2 loops.
 * 2. Group split — the columns are cut into 1–3 vertical groups, each
 *    shelf-tiled independently. Bands never align across groups, which is the
 *    staggered-masonry look the seed collage has (plain shelves cannot
 *    produce it: the seed crosses EVERY interior row boundary).
 * 3. Shelf tiling per group with a bounded repair loop: on a packing failure
 *    the culprit downgrades one step — FAILURE-AWARE (F2 prefers shorter
 *    replacement spans, F1/F3 narrower ones) — and the freed area re-spends
 *    on untouched images under the same band-feasibility filter (never
 *    re-upgrading a downgraded image), so the touched set only grows and
 *    every image's area only shrinks after first touch. The terminal state
 *    (all 1×1 + fillers) always tiles row-major; under the soft crop budget
 *    fillers should never survive the candidate search (tests assert zero on
 *    realistic densities).
 */

import type { SeededRng } from "@m0saic/template-utils";
import { SPAN_CLASSES, SPAN_MENU, fittingSpans, spanArea } from "./classify";
import type {
  ImageSpanOptions,
  PlacedSpan,
  RepairEvent,
  SpanAssignment,
  SpanClass,
  SpanPlan,
} from "./types";

// ── band feasibility (the invariant that keeps plans shelvable) ──

/** Width totals by span height (h1 is implied by area conservation). */
function heightWidths(spans: readonly SpanClass[]): { W2: number; W3: number } {
  let W2 = 0, W3 = 0;
  for (const s of spans) {
    const { c, r } = SPAN_MENU[s];
    if (r === 2) W2 += c;
    else if (r === 3) W3 += c;
  }
  return { W2, W3 };
}

/** Aggregate shelf accounting: the tall bands demanded must fit the rows. */
export function bandFeasible(W2: number, W3: number, cols: number, rows: number): boolean {
  const n3 = W3 > 0 ? Math.ceil(W3 / cols) : 0;
  const n2 = W2 > 0 ? Math.ceil(W2 / cols) : 0;
  return 3 * n3 + 2 * n2 <= rows;
}

const heightDelta = (from: SpanClass, to: SpanClass): { dW2: number; dW3: number } => {
  const d = { dW2: 0, dW3: 0 };
  const f = SPAN_MENU[from], t = SPAN_MENU[to];
  if (f.r === 2) d.dW2 -= f.c;
  if (f.r === 3) d.dW3 -= f.c;
  if (t.r === 2) d.dW2 += t.c;
  if (t.r === 3) d.dW3 += t.c;
  return d;
};

// ── planUpgrades ─────────────────────────────────────────────

type CostLookup = (imageIndex: number, span: SpanClass) => number;

function makeCostLookup(menus: ImageSpanOptions[]): CostLookup {
  const maps = menus.map((m) => new Map(m.options.map((o) => [o.span, o.cost])));
  return (i, s) => {
    const c = maps[i].get(s);
    if (c == null) throw new Error(`no cost for image ${i} span ${s} (span does not fit the lattice)`);
    return c;
  };
}

type Move = { imageIndex: number; span: SpanClass; delta: number; gain: number };

const moveOrder = (a: Move, b: Move): number =>
  b.gain - a.gain ||
  a.delta - b.delta ||
  a.imageIndex - b.imageIndex ||
  SPAN_CLASSES.indexOf(a.span) - SPAN_CLASSES.indexOf(b.span);

/** All upgrade moves from `span` for one image, best-first. Static per (image, span). */
function upgradesFrom(
  imageIndex: number,
  span: SpanClass,
  fitting: readonly SpanClass[],
  costOf: CostLookup,
): Move[] {
  const curArea = spanArea(span);
  const curCost = costOf(imageIndex, span);
  const moves: Move[] = [];
  for (const s of fitting) {
    const delta = spanArea(s) - curArea;
    if (delta <= 0) continue;
    moves.push({ imageIndex, span: s, delta, gain: (curCost - costOf(imageIndex, s)) / delta });
  }
  return moves.sort(moveOrder);
}

/** Near-neutral gain window for the taste phase (seeded hero picking). */
const TASTE_GAIN_FLOOR = -0.02;
const TASTE_POOL = 4;

/**
 * Spend E = cols·rows − count as upgrades, keeping band feasibility. The rng
 * only picks among near-equivalent taste upgrades. O(E·N·menu).
 */
export function planUpgrades(
  cols: number,
  rows: number,
  menus: ImageSpanOptions[],
  rng: SeededRng,
): SpanPlan {
  const count = menus.length;
  const fitting = fittingSpans(cols, rows);
  const costOf = makeCostLookup(menus);
  const current: SpanClass[] = new Array(count).fill("1x1");
  const moveLists: Move[][] = current.map((s, i) => upgradesFrom(i, s, fitting, costOf));
  let { W2, W3 } = heightWidths(current);
  let E = cols * rows - count;
  if (E < 0) throw new Error(`planUpgrades: lattice ${cols}×${rows} smaller than image count ${count}`);

  /** Images excluded from further upgrades after a parity stuck-repair. */
  const parked = new Set<number>();
  let stuckRepairs = 0;

  const admissible = (i: number): Move | undefined => {
    for (const m of moveLists[i]) {
      if (m.delta > E) continue;
      const { dW2, dW3 } = heightDelta(current[i], m.span);
      if (!bandFeasible(W2 + dW2, W3 + dW3, cols, rows)) continue;
      return m;
    }
    return undefined;
  };

  const apply = (i: number, span: SpanClass, dE: number): void => {
    const { dW2, dW3 } = heightDelta(current[i], span);
    W2 += dW2;
    W3 += dW3;
    current[i] = span;
    moveLists[i] = upgradesFrom(i, span, fitting, costOf);
    E -= dE;
  };

  while (E > 0) {
    // Per-image best admissible move; global best + a small taste pool.
    let best: Move | undefined;
    const pool: Move[] = [];
    for (let i = 0; i < count; i++) {
      if (parked.has(i)) continue;
      const m = admissible(i);
      if (!m) continue;
      if (!best || moveOrder(m, best) < 0) best = m;
      if (m.gain >= TASTE_GAIN_FLOOR) {
        pool.push(m);
        pool.sort(moveOrder);
        if (pool.length > TASTE_POOL) pool.pop();
      }
    }
    if (!best) {
      // No single move fits (parity gap, or every path is band-blocked at the
      // intermediate state — e.g. {1x2,1x2}→{1x3,1x3} on a 2×3). Search for a
      // COORDINATED pair: two images change spans atomically, combined area
      // delta exactly E, only the END state must be band-feasible.
      let pair: { i: number; si: SpanClass; j: number; sj: SpanClass; gain: number } | undefined;
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          for (const si of fitting) {
            if (si === current[i]) continue;
            const di = spanArea(si) - spanArea(current[i]);
            for (const sj of fitting) {
              if (sj === current[j]) continue;
              const dj = spanArea(sj) - spanArea(current[j]);
              if (di + dj !== E) continue;
              const a = heightDelta(current[i], si);
              const b = heightDelta(current[j], sj);
              if (!bandFeasible(W2 + a.dW2 + b.dW2, W3 + a.dW3 + b.dW3, cols, rows)) continue;
              const gain =
                costOf(i, current[i]) - costOf(i, si) + (costOf(j, current[j]) - costOf(j, sj));
              if (!pair || gain > pair.gain) pair = { i, si, j, sj, gain };
            }
          }
        }
      }
      if (pair) {
        apply(pair.i, pair.si, spanArea(pair.si) - spanArea(current[pair.i]));
        apply(pair.j, pair.sj, spanArea(pair.sj) - spanArea(current[pair.j]));
        continue;
      }
      // Last resort: step one image DOWN so a bigger move can close the gap;
      // park it so it can't bounce back up.
      if (++stuckRepairs > count)
        throw new Error(`planUpgrades: cannot spend remaining ${E} units on ${cols}×${rows} (internal)`);
      const candidates = current
        .map((s, i) => ({ i, area: spanArea(s) }))
        .filter(({ area }) => area > 1)
        .sort((a, b) => b.area - a.area || a.i - b.i);
      if (candidates.length === 0)
        throw new Error(`planUpgrades: stuck with E=${E} and all images at 1×1 (internal)`);
      const victim = candidates[0];
      const down = downgradeOf(current[victim.i], fitting, (s) => costOf(victim.i, s), {
        feasible: (s) => {
          const { dW2, dW3 } = heightDelta(current[victim.i], s);
          return bandFeasible(W2 + dW2, W3 + dW3, cols, rows);
        },
      });
      if (!down) throw new Error(`planUpgrades: image ${victim.i} at ${current[victim.i]} cannot shrink (internal)`);
      apply(victim.i, down, -(victim.area - spanArea(down)));
      parked.add(victim.i);
      continue;
    }
    // Cost phase: clear positive-gain winner. Taste phase: seeded pick among
    // the near-neutral top of the pool (which images become heroes).
    let pick = best;
    if (best.gain <= 0 && pool.length > 1) pick = pool[Math.floor(rng() * pool.length)];
    apply(pick.imageIndex, pick.span, pick.delta);
  }

  const assignments: SpanAssignment[] = current.map((span, imageIndex) => ({
    imageIndex,
    span,
    cost: costOf(imageIndex, span),
  }));
  return { assignments, totalArea: assignments.reduce((a, x) => a + spanArea(x.span), 0) };
}

// ── group plans ──────────────────────────────────────────────

/**
 * Candidate column-group splits, stagger-first. G1 (no split) is always last:
 * it always partitions, so the pipeline cannot dead-end.
 */
export function groupPlans(cols: number, maxSpanWidth: number, rng: SeededRng): number[][] {
  const plans: number[][] = [];
  const push = (widths: number[]) => {
    if (widths.some((w) => w < 1)) return;
    if (Math.max(...widths) < maxSpanWidth) return; // widest span must fit somewhere
    const key = widths.join(",");
    if (!plans.some((p) => p.join(",") === key)) plans.push(widths);
  };
  if (cols >= 2 * Math.max(2, maxSpanWidth)) {
    const lo = Math.ceil(cols * 0.38);
    const hi = Math.floor(cols * 0.62);
    const w1 = Math.min(hi, Math.max(lo, Math.round(cols * (0.38 + 0.24 * rng()))));
    push([w1, cols - w1]);
  }
  if (cols >= 3 * Math.max(2, maxSpanWidth)) {
    const third = Math.floor(cols / 3);
    push([third, third, cols - 2 * third]);
  }
  if (cols >= 2 * Math.max(2, maxSpanWidth)) push([Math.ceil(cols / 2), Math.floor(cols / 2)]);
  push([cols]);
  return plans;
}

/** Greedy area partition of spans into groups. Returns per-group span lists, or null. */
function partitionToGroups(
  assignments: SpanAssignment[],
  widths: number[],
  rows: number,
): SpanAssignment[][] | null {
  const remaining = widths.map((w) => w * rows);
  const groups: SpanAssignment[][] = widths.map(() => []);
  const order = [...assignments].sort(
    (a, b) => spanArea(b.span) - spanArea(a.span) || a.imageIndex - b.imageIndex,
  );
  for (const a of order) {
    const area = spanArea(a.span);
    const { c, r } = SPAN_MENU[a.span];
    let best = -1;
    for (let g = 0; g < widths.length; g++) {
      if (c > widths[g] || r > rows || remaining[g] < area) continue;
      if (best === -1 || remaining[g] > remaining[best]) best = g;
    }
    if (best === -1) return null;
    groups[best].push(a);
    remaining[best] -= area;
  }
  return remaining.every((r) => r === 0) ? groups : null;
}

// ── shelf tiling of one group ────────────────────────────────

type GroupTileResult =
  | { placed: PlacedSpan[] }
  | { failure: "F1" | "F2" | "F3"; culprit?: SpanAssignment };

/** Exact-sum run fill from a width-multiset pool. Mutates `pool` on success. */
function exactFill(pool: SpanAssignment[], target: number): SpanAssignment[] | null {
  const widthOf = (a: SpanAssignment) => SPAN_MENU[a.span].c;
  const sorted = [...pool].sort((a, b) => widthOf(b) - widthOf(a) || a.imageIndex - b.imageIndex);
  const picked: number[] = [];
  const used = new Set<number>();
  let remaining = target;
  let steps = 0;
  let from = 0;
  while (remaining > 0) {
    if (++steps > 500) return null;
    let found = -1;
    for (let i = from; i < sorted.length; i++) {
      if (used.has(i)) continue;
      if (widthOf(sorted[i]) <= remaining) { found = i; break; }
    }
    if (found === -1) {
      const last = picked.pop();
      if (last == null) return null;
      used.delete(last);
      remaining += widthOf(sorted[last]);
      from = last + 1;
      continue;
    }
    picked.push(found);
    used.add(found);
    remaining -= widthOf(sorted[found]);
    from = 0;
  }
  const chosen = picked.map((i) => sorted[i]);
  for (const c of chosen) pool.splice(pool.indexOf(c), 1);
  return chosen;
}

/** First-fit-decreasing of spans into `bins` of capacity `width`. Null on overflow. */
function ffd(spans: SpanAssignment[], bins: number, width: number): SpanAssignment[][] | null {
  const packs: SpanAssignment[][] = Array.from({ length: bins }, () => []);
  const room = new Array(bins).fill(width);
  const order = [...spans].sort(
    (a, b) => SPAN_MENU[b.span].c - SPAN_MENU[a.span].c || a.imageIndex - b.imageIndex,
  );
  for (const s of order) {
    const w = SPAN_MENU[s.span].c;
    const g = room.findIndex((r) => r >= w);
    if (g === -1) return null;
    packs[g].push(s);
    room[g] -= w;
  }
  return packs;
}

const shuffled = <T,>(xs: T[], rng: SeededRng): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Assemble bands + fill segments once, for a fixed band composition. */
function assembleBands(
  bins3: SpanAssignment[][],
  bins2: SpanAssignment[][],
  n1: number,
  h1: SpanAssignment[],
  c0: number,
  width: number,
  rng: SeededRng,
): { placed: PlacedSpan[] } | { pool: SpanAssignment[] } {
  type Band = { h: number; chunks: SpanAssignment[] };
  const bands: Band[] = shuffled(
    [
      ...bins3.map((b) => ({ h: 3, chunks: b })),
      ...bins2.map((b) => ({ h: 2, chunks: b })),
      ...Array.from({ length: n1 }, () => ({ h: 1, chunks: [] as SpanAssignment[] })),
    ],
    rng,
  );

  const pool = [...h1];
  const placed: PlacedSpan[] = [];
  let r0 = 0;
  for (const band of bands) {
    const chunkWidth = band.chunks.reduce((a, s) => a + SPAN_MENU[s.span].c, 0);
    const leftover = width - chunkWidth;
    const runs: SpanAssignment[][] = [];
    for (let sub = 0; sub < (leftover > 0 ? band.h : 0); sub++) {
      const run = exactFill(pool, leftover);
      if (!run) {
        for (const r of runs) pool.push(...r);
        return { pool };
      }
      runs.push(run);
    }
    const items: Array<{ w: number; place: (x: number) => void }> = band.chunks.map((s) => ({
      w: SPAN_MENU[s.span].c,
      place: (x) =>
        placed.push({ imageIndex: s.imageIndex, span: s.span, c0: x, r0, cs: SPAN_MENU[s.span].c, rs: band.h }),
    }));
    if (leftover > 0) {
      items.push({
        w: leftover,
        place: (x) => {
          runs.forEach((run, sub) => {
            let rx = x;
            for (const s of run) {
              placed.push({ imageIndex: s.imageIndex, span: s.span, c0: rx, r0: r0 + sub, cs: SPAN_MENU[s.span].c, rs: 1 });
              rx += SPAN_MENU[s.span].c;
            }
          });
        },
      });
    }
    let x = c0;
    for (const item of shuffled(items, rng)) {
      item.place(x);
      x += item.w;
    }
    r0 += band.h;
  }
  return { placed };
}

function tileGroup(
  spans: SpanAssignment[],
  c0: number,
  width: number,
  rows: number,
  rng: SeededRng,
): GroupTileResult {
  const h1 = spans.filter((s) => SPAN_MENU[s.span].r === 1);
  const h2 = spans.filter((s) => SPAN_MENU[s.span].r === 2);
  const h3 = spans.filter((s) => SPAN_MENU[s.span].r === 3);
  const W2 = h2.reduce((a, s) => a + SPAN_MENU[s.span].c, 0);
  const W3 = h3.reduce((a, s) => a + SPAN_MENU[s.span].c, 0);

  const n3min = W3 > 0 ? Math.ceil(W3 / width) : 0;
  if (3 * n3min > rows) return { failure: "F2", culprit: widest(h3) };
  const n2min = W2 > 0 ? Math.ceil(W2 / width) : 0;
  if (3 * n3min + 2 * n2min > rows) return { failure: "F2", culprit: widest(h2.length > 0 ? h2 : h3) };

  // Band counts are MINIMUMS: FFD may need extra bands (bin slack), and area
  // conservation holds for any valid count (an extra 2-band trades two
  // 1-bands for 2·width of stacked segment runs). Sweep upward before
  // declaring failure; retry each composition under fresh seeded shuffles.
  let failure: GroupTileResult = { failure: "F1", culprit: widest(h3.length > 0 ? h3 : h2) };
  const n3max = W3 > 0 ? Math.floor(rows / 3) : 0;
  for (let n3 = n3min; n3 <= n3max || (n3 === 0 && n3max === 0); n3++) {
    const bins3 = n3 > 0 ? ffd(h3, n3, width) : h3.length > 0 ? null : [];
    if (!bins3) { if (n3 >= n3max) break; continue; }
    const n2cap = Math.floor((rows - 3 * n3) / 2);
    const n2max = W2 > 0 ? n2cap : 0;
    for (let n2 = n2min; n2 <= n2max || (n2 === 0 && n2max === 0); n2++) {
      const bins2 = n2 > 0 ? ffd(h2, n2, width) : h2.length > 0 ? null : [];
      if (!bins2) {
        failure = { failure: "F1", culprit: widest(h2) };
        if (n2 >= n2max) break;
        continue;
      }
      const n1 = rows - 3 * n3 - 2 * n2;
      for (let retry = 0; retry < 3; retry++) {
        const res = assembleBands(bins3, bins2, n1, h1, c0, width, rng);
        if ("placed" in res) return res;
        failure = { failure: "F3", culprit: widest(res.pool) };
      }
      if (n2 >= n2max) break;
    }
    if (n3 >= n3max) break;
  }
  return failure;
}

const widest = (spans: SpanAssignment[]): SpanAssignment | undefined => {
  // Repair victims: real images only (fillers are already minimal 1×1s).
  const real = spans.filter((s) => s.imageIndex >= 0);
  return [...(real.length > 0 ? real : spans)].sort(
    (a, b) => SPAN_MENU[b.span].c - SPAN_MENU[a.span].c || b.cost - a.cost || a.imageIndex - b.imageIndex,
  )[0];
};

// ── repair ───────────────────────────────────────────────────

type DowngradePrefs = {
  /** F2 wants SHORTER replacements (height pressure); F1/F3 want narrower. */
  preferLowHeight?: boolean;
  /** Reject replacements that break an invariant (e.g. band feasibility). */
  feasible?: (span: SpanClass) => boolean;
};

/** One step down the ladder: the largest strictly-smaller area with a fitting span. */
export function downgradeOf(
  span: SpanClass,
  fitting: readonly SpanClass[],
  costOf: (s: SpanClass) => number,
  prefs: DowngradePrefs = {},
): SpanClass | null {
  const area = spanArea(span);
  for (let target = area - 1; target >= 1; target--) {
    const opts = fitting
      .filter((s) => spanArea(s) === target)
      .filter((s) => prefs.feasible?.(s) ?? true)
      .sort((a, b) => {
        if (prefs.preferLowHeight && SPAN_MENU[a].r !== SPAN_MENU[b].r) return SPAN_MENU[a].r - SPAN_MENU[b].r;
        return costOf(a) - costOf(b) || SPAN_CLASSES.indexOf(a) - SPAN_CLASSES.indexOf(b);
      });
    if (opts.length > 0) return opts[0];
  }
  return null;
}

// ── the public tiler ─────────────────────────────────────────

export type TileResult = {
  placed: PlacedSpan[];
  /** Final per-image assignment after any repairs (imageIndex-ordered; fillers excluded). */
  assignments: SpanAssignment[];
  repairs: RepairEvent[];
  fillerCount: number;
};

/**
 * Tile the plan onto the lattice: try stagger-first group plans, shelf-tile
 * each group, repair on failure (failure-aware downgrade + band-feasible
 * group-local re-spend + fillers-as-last-resort), fall back to the single
 * group. Total; the all-1×1 terminal always tiles.
 */
export function tileStaggered(
  plan: SpanPlan,
  cols: number,
  rows: number,
  menus: ImageSpanOptions[],
  rng: SeededRng,
): TileResult {
  const fitting = fittingSpans(cols, rows);
  const costOf = makeCostLookup(menus);
  const repairs: RepairEvent[] = [];
  const maxSpanWidth = Math.max(1, ...plan.assignments.map((a) => SPAN_MENU[a.span].c));
  const plans = groupPlans(cols, maxSpanWidth, rng);

  for (const widths of plans) {
    // Fresh working copy per plan attempt; repairs are plan-local.
    const work = plan.assignments.map((a) => ({ ...a }));
    const touched = new Set<number>();
    // Each image may receive at most ONE re-spend upgrade per plan: unlimited
    // re-spends let one image ladder 1x1→1x2→1x3→2x2 across repair rounds,
    // rebuilding the exact tall/wide pressure each downgrade just released
    // (observed as a 60-repair oscillation before this cap).
    const respent = new Set<number>();
    // Per-image shapes already tried this plan — bounds the zero-delta swap
    // repair (each image visits a span class at most once).
    const visited = new Map<number, Set<SpanClass>>();
    for (const w of work) visited.set(w.imageIndex, new Set([w.span]));
    let fillers = 0;
    const budget = 14 * work.length + 8; // downgrade steps + shape swaps
    let attempts = 0;

    attempt: while (attempts++ < budget) {
      const withFillers: SpanAssignment[] = [
        ...work,
        ...Array.from({ length: fillers }, (_, k) => ({ imageIndex: -1 - k, span: "1x1" as SpanClass, cost: 0 })),
      ];
      const groups = partitionToGroups(withFillers, widths, rows);
      if (!groups) break; // this group plan can't partition — next plan

      const placed: PlacedSpan[] = [];
      let cOff = 0;
      for (let g = 0; g < widths.length; g++) {
        const res = tileGroup(groups[g], cOff, widths[g], rows, rng);
        if ("failure" in res) {
          const culprit = res.culprit && res.culprit.imageIndex >= 0 ? res.culprit : undefined;
          if (!culprit) break attempt; // filler-only failure: structurally impossible; be defensive
          const idx = work.findIndex((w) => w.imageIndex === culprit.imageIndex);
          const hw = () => heightWidths(work.map((w) => w.span));
          // FIRST try a zero-delta SHAPE SWAP (2x1↔1x2, 3x1↔1x3, 2x2↔4x1):
          // most small-lattice failures are shape mismatches, not area
          // problems — a swap fixes them without freeing area that then needs
          // re-spending. Bounded by the per-image visited-shapes set.
          const seen = visited.get(culprit.imageIndex)!;
          const swap = fitting
            .filter(
              (s) =>
                s !== work[idx].span &&
                spanArea(s) === spanArea(work[idx].span) &&
                !seen.has(s) &&
                (() => {
                  const cur = hw();
                  const { dW2, dW3 } = heightDelta(work[idx].span, s);
                  return bandFeasible(cur.W2 + dW2, cur.W3 + dW3, cols, rows);
                })(),
            )
            .sort((a, b) => {
              if (res.failure !== "F1" && SPAN_MENU[a].r !== SPAN_MENU[b].r) return SPAN_MENU[a].r - SPAN_MENU[b].r;
              return (
                costOf(culprit.imageIndex, a) - costOf(culprit.imageIndex, b) ||
                SPAN_CLASSES.indexOf(a) - SPAN_CLASSES.indexOf(b)
              );
            })[0];
          if (swap) {
            repairs.push({
              kind: "swap",
              imageIndex: culprit.imageIndex,
              detail: `${res.failure}: ${work[idx].span} ⇄ ${swap}`,
            });
            work[idx].span = swap;
            work[idx].cost = costOf(culprit.imageIndex, swap);
            seen.add(swap);
            continue attempt;
          }
          const down = downgradeOf(work[idx].span, fitting, (s) => costOf(culprit.imageIndex, s), {
            preferLowHeight: res.failure !== "F1",
            feasible: (s) => {
              const cur = hw();
              const { dW2, dW3 } = heightDelta(work[idx].span, s);
              return bandFeasible(cur.W2 + dW2, cur.W3 + dW3, cols, rows);
            },
          });
          if (!down) break attempt; // already 1×1 — can't shrink; next plan
          let freed = spanArea(work[idx].span) - spanArea(down);
          repairs.push({
            kind: "downgrade",
            imageIndex: culprit.imageIndex,
            detail: `${res.failure}: ${work[idx].span} → ${down} (freed ${freed})`,
          });
          work[idx].span = down;
          work[idx].cost = costOf(culprit.imageIndex, down);
          touched.add(culprit.imageIndex);
          seen.add(down);
          // Re-spend freed units on untouched images: best band-feasible gain.
          respend: while (freed > 0) {
            const cur = hw();
            let best: Move | undefined;
            for (let i = 0; i < work.length; i++) {
              if (touched.has(work[i].imageIndex) || respent.has(work[i].imageIndex)) continue;
              for (const m of upgradesFrom(i, work[i].span, fitting, (ii, s) => costOf(work[ii].imageIndex, s))) {
                if (m.delta > freed) continue;
                const { dW2, dW3 } = heightDelta(work[i].span, m.span);
                if (!bandFeasible(cur.W2 + dW2, cur.W3 + dW3, cols, rows)) continue;
                if (!best || moveOrder(m, best) < 0) best = m;
                break; // move lists are best-first per image
              }
            }
            if (!best) break respend;
            repairs.push({
              kind: "respend",
              imageIndex: work[best.imageIndex].imageIndex,
              detail: `${work[best.imageIndex].span} → ${best.span}`,
            });
            work[best.imageIndex].span = best.span;
            work[best.imageIndex].cost = costOf(work[best.imageIndex].imageIndex, best.span);
            respent.add(work[best.imageIndex].imageIndex);
            freed -= best.delta;
          }
          if (freed > 0) {
            fillers += freed;
            repairs.push({ kind: "filler", imageIndex: -1, detail: `minted ${freed} filler unit(s)` });
          }
          continue attempt;
        }
        placed.push(...res.placed);
        cOff += widths[g];
      }
      // Success.
      const assignments = work.map((w) => ({ ...w })).sort((a, b) => a.imageIndex - b.imageIndex);
      return { placed, assignments, repairs, fillerCount: fillers };
    }
    if (widths.length > 1)
      repairs.push({ kind: "group-collapse", imageIndex: -1, detail: `plan [${widths.join(",")}] abandoned` });
  }

  throw new Error("tileStaggered: no group plan tiled — the G1 terminal state should be total (internal)");
}
