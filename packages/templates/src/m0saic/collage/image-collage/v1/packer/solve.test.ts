import { mulberry32 } from "@m0saic/template-utils";
import { solveCollage } from "./solve";
import type { PlacedSpan } from "./types";

const seedMix = (): number[] => [
  ...Array.from({ length: 34 }, (_, i) => 1.2 + (i % 7) * 0.1),
  ...Array.from({ length: 14 }, (_, i) => 0.55 + (i % 5) * 0.05),
  1.0,
];

function assertExactCover(placed: PlacedSpan[], cols: number, rows: number): void {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (const p of placed)
    for (let r = p.r0; r < p.r0 + p.rs; r++)
      for (let c = p.c0; c < p.c0 + p.cs; c++) grid[r][c]++;
  expect(grid.every((row) => row.every((v) => v === 1))).toBe(true);
}

const SEED_OPTS = {
  canvasW: 1920, canvasH: 1280, gutterXPx: 20, gutterYPx: 18, marginPx: 20,
  minCellPx: 100, maxCellPx: 260, aspects: seedMix(), seed: 1,
};

describe("solveCollage — end to end", () => {
  it("solves the seed collage: exact cover, zero fillers, sane crops", () => {
    const [best] = solveCollage(SEED_OPTS);
    const { cols, rows } = best.candidate;
    assertExactCover(best.placed, cols, rows);
    expect(best.metrics.fillerCount).toBe(0);
    expect(best.metrics.meanCrop).toBeLessThan(0.15); // seed mix fits its own lattice family well
    expect(best.metrics.maxCrop).toBeLessThanOrEqual(0.5);
    expect(best.assignments.length).toBe(49);
    expect(best.metrics.stagger).toBeGreaterThanOrEqual(0);
    expect(best.metrics.sizeDiversity).toBeGreaterThan(0.2); // more than one span class in play
  });

  it("is byte-deterministic for a seed, and keep returns ascending scores", () => {
    const a = solveCollage({ ...SEED_OPTS, keep: 5 });
    const b = solveCollage({ ...SEED_OPTS, keep: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (let i = 1; i < a.length; i++) expect(a[i].score).toBeGreaterThanOrEqual(a[i - 1].score);
  });

  it("different seeds may differ, same lattice invariants always hold", () => {
    for (const seed of [2, 3, 99]) {
      const [best] = solveCollage({ ...SEED_OPTS, seed });
      assertExactCover(best.placed, best.candidate.cols, best.candidate.rows);
      expect(best.metrics.fillerCount).toBe(0);
    }
  });

  it("N=1 hero sheet", () => {
    const [best] = solveCollage({
      canvasW: 1200, canvasH: 800, gutterXPx: 10, gutterYPx: 10, marginPx: 10,
      minCellPx: 250, maxCellPx: 1200, aspects: [1.5], seed: 1,
    });
    assertExactCover(best.placed, best.candidate.cols, best.candidate.rows);
    expect(best.assignments.length).toBe(1);
    expect(best.metrics.fillerCount).toBe(0);
  });

  it("tiny sheets (N=2, N=5)", () => {
    for (const n of [2, 5]) {
      const aspects = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1.5 : 0.66));
      const [best] = solveCollage({
        canvasW: 1600, canvasH: 900, gutterXPx: 12, gutterYPx: 12, marginPx: 12,
        minCellPx: 180, maxCellPx: 700, aspects, seed: 4,
      });
      assertExactCover(best.placed, best.candidate.cols, best.candidate.rows);
      expect(best.metrics.fillerCount).toBe(0);
      expect(best.assignments.length).toBe(n);
    }
  });

  it("throws a clear error when no lattice fits", () => {
    expect(() =>
      solveCollage({
        canvasW: 400, canvasH: 300, gutterXPx: 8, gutterYPx: 8, marginPx: 8,
        minCellPx: 300, maxCellPx: 400, aspects: seedMix(), seed: 1,
      }),
    ).toThrow(/no lattice fits/);
  });

  it("product guarantee sweep: the BEST solve is always filler-free (60 scenarios)", () => {
    // The tiler is total-with-fillers; the search + clean-preference sort is
    // what guarantees no background holes. 200-scenario measurement
    // 2026-07-11: 182/182 clean after the full-window candidate enumeration.
    const gen = mulberry32(777);
    const canvases = [[1920, 1080], [1080, 1920], [1920, 1280], [1080, 1080], [800, 600]] as const;
    let total = 0;
    for (let k = 0; total < 60 && k < 200; k++) {
      const [W, H] = canvases[Math.floor(gen() * canvases.length)];
      const n = 1 + Math.floor(gen() * 80);
      const mode = Math.floor(gen() * 3);
      const aspects = Array.from({ length: n }, () => {
        const r = gen();
        if (mode === 0) return r < 0.7 ? 1.2 + gen() * 0.8 : 0.55 + gen() * 0.35;
        if (mode === 1) return r < 0.7 ? 0.45 + gen() * 0.4 : 1.1 + gen() * 0.6;
        return r < 0.05 ? 4 + gen() * 2 : r < 0.1 ? 0.2 + gen() * 0.1 : 0.5 + gen() * 1.6;
      });
      const g = 4 + Math.floor(gen() * 20);
      let best;
      try {
        [best] = solveCollage({
          canvasW: W, canvasH: H, gutterXPx: g, gutterYPx: g, marginPx: g,
          minCellPx: 80, maxCellPx: 400, aspects, seed: k,
        });
      } catch (e) {
        // Only the honest "nothing fits" escape is acceptable.
        expect(String(e)).toMatch(/no lattice fits/);
        continue;
      }
      assertExactCover(best.placed, best.candidate.cols, best.candidate.rows);
      if (best.metrics.fillerCount !== 0)
        throw new Error(`dirty best solve at k=${k} (${W}×${H}, n=${n}, mode=${mode})`);
      expect(best.assignments.length).toBe(n);
      total++;
    }
    expect(total).toBe(60);
  });

  it("perf budget: a default search over N=500 stays interactive", () => {
    const gen = mulberry32(500);
    const aspects = Array.from({ length: 500 }, () => 0.4 + gen() * 1.8);
    // CPU time, not wall clock: under the full-suite parallel run the worker
    // gets descheduled and wall time balloons 5-10× while compute stays flat.
    const c0 = process.cpuUsage();
    const [best] = solveCollage({
      canvasW: 3840, canvasH: 2160, gutterXPx: 12, gutterYPx: 12, marginPx: 12,
      minCellPx: 80, maxCellPx: 200, aspects, seed: 9,
    });
    const du = process.cpuUsage(c0);
    const cpuMs = (du.user + du.system) / 1000;
    assertExactCover(best.placed, best.candidate.cols, best.candidate.rows);
    expect(best.metrics.fillerCount).toBe(0);
    // ~2.5s CPU standalone (2026-07-11); the bound catches order-of-magnitude
    // regressions (the pre-optimization solver measured ~15s).
    expect(cpuMs).toBeLessThan(12000);
  });
});
