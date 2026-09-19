import { mulberry32 } from "@m0saic/template-utils";
import { classifySpans, spanArea, spanVisibleAspect, SPAN_CLASSES } from "./classify";
import { groupPlans, planUpgrades, tileStaggered } from "./tiler";
import type { ImageSpanOptions, PlacedSpan, SpanClass, SpanPlan } from "./types";

/** Visible aspects for a synthetic lattice unit. */
function visibleFor(cols: number, rows: number, unitW = 150, unitH = 120, gx = 16, gy = 14) {
  const visible: Partial<Record<SpanClass, number>> = {};
  for (const s of SPAN_CLASSES) {
    const { c, r } = { c: Number(s[0]), r: Number(s[2]) };
    if (c <= cols && r <= rows) visible[s] = spanVisibleAspect(s, unitW, unitH, gx, gy);
  }
  return visible;
}

const menusFor = (aspects: number[], cols: number, rows: number): ImageSpanOptions[] =>
  classifySpans(aspects, visibleFor(cols, rows), 0.3);

/** Every unit covered exactly once and every span in bounds. */
function assertExactCover(placed: PlacedSpan[], cols: number, rows: number): void {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (const p of placed) {
    expect(p.c0).toBeGreaterThanOrEqual(0);
    expect(p.r0).toBeGreaterThanOrEqual(0);
    expect(p.c0 + p.cs).toBeLessThanOrEqual(cols);
    expect(p.r0 + p.rs).toBeLessThanOrEqual(rows);
    for (let r = p.r0; r < p.r0 + p.rs; r++)
      for (let c = p.c0; c < p.c0 + p.cs; c++) grid[r][c]++;
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 1)
        throw new Error(`cell (${c},${r}) covered ${grid[r][c]} times\n${grid.map((x) => x.join("")).join("\n")}`);
    }
}

describe("planUpgrades — exact area spend", () => {
  it("spends E exactly across a parameter grid", () => {
    const rng = mulberry32(7);
    for (const [cols, rows, n] of [[4, 3, 6], [6, 5, 15], [11, 9, 49], [8, 2, 9], [2, 2, 2], [5, 5, 25]]) {
      const aspects = Array.from({ length: n }, (_, i) => 0.5 + ((i * 37) % 20) * 0.1);
      const plan = planUpgrades(cols, rows, menusFor(aspects, cols, rows), rng);
      expect(plan.totalArea).toBe(cols * rows);
      expect(plan.assignments.length).toBe(n);
    }
  });

  it("resolves the parked-at-4 parity corner (area menu has no 5)", () => {
    // 3×3 = 9 units, 2 images whose best span is 2x2 → greedy parks both at
    // area 4 with E=1 stranded; the atomic repair must close it (6+3).
    const cols = 3, rows = 3;
    const heroAspect = spanVisibleAspect("2x2", 150, 120, 16, 14);
    const plan = planUpgrades(cols, rows, menusFor([heroAspect, heroAspect], cols, rows), mulberry32(1));
    expect(plan.totalArea).toBe(9);
    const areas = plan.assignments.map((a) => spanArea(a.span)).sort((a, b) => a - b);
    expect(areas).toEqual([3, 6]);
  });

  it("portraits buy 1x2 with the first upgrades (cost-driven phase)", () => {
    // 4×3 = 12 units, 8 images: 4 landscape (unit-matched) + 4 portrait.
    const unit = spanVisibleAspect("1x1", 150, 120, 16, 14);
    const tall = spanVisibleAspect("1x2", 150, 120, 16, 14);
    const aspects = [unit, unit, unit, unit, tall, tall, tall, tall];
    const plan = planUpgrades(4, 3, menusFor(aspects, 4, 3), mulberry32(2));
    // E = 4 and the biggest gains are the four portraits' 1x1→1x2 moves.
    for (let i = 4; i < 8; i++) expect(plan.assignments[i].span).toBe("1x2");
  });

  it("throws when the lattice is smaller than the image count", () => {
    expect(() => planUpgrades(2, 2, menusFor([1, 1, 1, 1, 1], 2, 2), mulberry32(1))).toThrow(/smaller/);
  });
});

describe("groupPlans", () => {
  it("prefers staggered splits and always ends with the single group", () => {
    const plans = groupPlans(11, 2, mulberry32(3));
    expect(plans[plans.length - 1]).toEqual([11]);
    expect(plans.length).toBeGreaterThan(1);
    for (const p of plans) expect(p.reduce((a, w) => a + w, 0)).toBe(11);
  });
  it("never emits a plan whose widest group can't hold the widest span", () => {
    for (const p of groupPlans(8, 4, mulberry32(4))) expect(Math.max(...p)).toBeGreaterThanOrEqual(4);
  });
  it("degenerates to G1 for narrow lattices", () => {
    expect(groupPlans(3, 2, mulberry32(5))).toEqual([[3]]);
  });
});

describe("tileStaggered — exact cover with repair", () => {
  it("tiles the seed-shaped solve (11×9, 49 images)", () => {
    const cols = 11, rows = 9;
    const aspects = [
      ...Array.from({ length: 34 }, (_, i) => 1.2 + (i % 7) * 0.1),
      ...Array.from({ length: 14 }, (_, i) => 0.55 + (i % 5) * 0.05),
      1.0,
    ];
    const menus = menusFor(aspects, cols, rows);
    const rng = mulberry32(11);
    const plan = planUpgrades(cols, rows, menus, rng);
    const res = tileStaggered(plan, cols, rows, menus, rng);
    assertExactCover(res.placed, cols, rows);
    expect(res.fillerCount).toBe(0);
    expect(res.assignments.length).toBe(49);
    // Every image landed exactly once.
    const imgs = res.placed.filter((p) => p.imageIndex >= 0).map((p) => p.imageIndex).sort((a, b) => a - b);
    expect(imgs).toEqual(Array.from({ length: 49 }, (_, i) => i));
  });

  it("F1 regression pin: {3x2,3x2,2x2} on 4×4 has NO geometric cover — repair terminates honestly", () => {
    // Area-feasible (6+6+4 = 16) but two 3-wides can't share two 4-wide
    // 2-bands with a 2-wide. The repair ladder must terminate with an exact
    // cover; this pathological density (CR = 5.3·N) is allowed to mint
    // fillers — the honest escape the score punishes.
    const cols = 4, rows = 4;
    const menus = menusFor([2.0, 2.0, 1.27], cols, rows);
    const plan: SpanPlan = {
      assignments: [
        { imageIndex: 0, span: "3x2", cost: 0.1 },
        { imageIndex: 1, span: "3x2", cost: 0.1 },
        { imageIndex: 2, span: "2x2", cost: 0.05 },
      ],
      totalArea: 16,
    };
    const res = tileStaggered(plan, cols, rows, menus, mulberry32(6));
    assertExactCover(res.placed, cols, rows);
    expect(res.repairs.length).toBeGreaterThan(0);
  });

  it("F3 regression pin: run-fill counting failure {3,3,2} across width-4 rows", () => {
    const cols = 4, rows = 2;
    const menus = menusFor([3.2, 3.2, 2.4], cols, rows);
    const plan: SpanPlan = {
      assignments: [
        { imageIndex: 0, span: "3x1", cost: 0.1 },
        { imageIndex: 1, span: "3x1", cost: 0.1 },
        { imageIndex: 2, span: "2x1", cost: 0.1 },
      ],
      totalArea: 8,
    };
    const res = tileStaggered(plan, cols, rows, menus, mulberry32(8));
    assertExactCover(res.placed, cols, rows);
    expect(res.fillerCount).toBe(0); // repair can re-spend within {1,2,3,4} widths
    expect(res.repairs.length).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed", () => {
    const cols = 8, rows = 6;
    const aspects = Array.from({ length: 20 }, (_, i) => 0.6 + ((i * 13) % 15) * 0.1);
    const menus = menusFor(aspects, cols, rows);
    const run = (seed: number) => {
      const rng = mulberry32(seed);
      const plan = planUpgrades(cols, rows, menus, rng);
      return tileStaggered(plan, cols, rows, menus, rng);
    };
    expect(run(42)).toEqual(run(42));
  });
});

describe("tiler property sweep (seeded, deterministic)", () => {
  it("600 realistic cases: exact cover, bounded repairs; zero fillers ≤2.2 density, ≤2.5% dirty to 3.0", () => {
    // Measured envelope (3000-case sweep, 2026-07-11): 0% dirty at density
    // ≤2.0 (the seed's zone is 2.0), 0.4% in (2.0,2.5], ~1% in (2.5,3.0].
    // The rare dirty cases are adversarial lattice×mix pairings the SEARCH
    // never selects (e.g. a portrait-heavy mix on a 3-row landscape lattice);
    // the tiler is TOTAL (fillers are the honest escape) and the zero-filler
    // product guarantee lives at solve level (see solve.test.ts sweep).
    const gen = mulberry32(20260711);
    let cases = 0;
    let denseCases = 0;
    let denseDirty = 0;
    for (let k = 0; cases < 600 && k < 3000; k++) {
      const cols = 2 + Math.floor(gen() * 13); // 2..14
      const rows = 2 + Math.floor(gen() * 9); //  2..10
      const units = cols * rows;
      const density = 1.2 + gen() * 1.8; // CR/N ∈ [1.2, 3.0]
      const n = Math.max(1, Math.round(units / density));
      if (n > units) continue;
      // Aspect mix: landscape-heavy, portrait-heavy, or wild (with extremes).
      const mode = Math.floor(gen() * 3);
      const aspects = Array.from({ length: n }, () => {
        const r = gen();
        if (mode === 0) return r < 0.7 ? 1.2 + gen() * 0.8 : 0.55 + gen() * 0.35;
        if (mode === 1) return r < 0.7 ? 0.45 + gen() * 0.4 : 1.1 + gen() * 0.6;
        return r < 0.05 ? 4 + gen() * 2 : r < 0.1 ? 0.2 + gen() * 0.1 : 0.5 + gen() * 1.6;
      });
      const menus = menusFor(aspects, cols, rows);
      const rng = mulberry32(k + 1);
      const plan = planUpgrades(cols, rows, menus, rng);
      expect(plan.totalArea).toBe(units);
      const res = tileStaggered(plan, cols, rows, menus, rng);
      assertExactCover(res.placed, cols, rows);
      const d = units / n;
      if (d <= 2.2) {
        if (res.fillerCount !== 0)
          throw new Error(`fillers=${res.fillerCount} at case k=${k} (${cols}×${rows}, n=${n}, mode=${mode}, d=${d.toFixed(2)})`);
      } else {
        denseCases++;
        if (res.fillerCount !== 0) denseDirty++;
      }
      expect(res.repairs.length).toBeLessThanOrEqual(14 * n + 8);
      cases++;
    }
    expect(cases).toBe(600);
    expect(denseDirty / Math.max(1, denseCases)).toBeLessThanOrEqual(0.025);
  });
});
