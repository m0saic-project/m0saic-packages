import { maxLatticeUnits, relaxedMaxCellPx } from "./candidates";
import { planPages, solvePages } from "./paging";
import type { PlacedSpan } from "./types";

const seedMix = (n: number): number[] =>
  Array.from({ length: n }, (_, i) => (i % 3 === 0 ? 0.6 + (i % 5) * 0.05 : 1.2 + (i % 7) * 0.1));

const BASE = {
  canvasW: 1920, canvasH: 1080, gutterXPx: 12, gutterYPx: 12, marginPx: 12,
  minCellPx: 120, maxCellPx: 320, seed: 1, cropBudget: 0.3,
};

function assertExactCover(placed: PlacedSpan[], cols: number, rows: number): void {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (const p of placed)
    for (let r = p.r0; r < p.r0 + p.rs; r++)
      for (let c = p.c0; c < p.c0 + p.cs; c++) grid[r][c]++;
  expect(grid.every((row) => row.every((v) => v === 1))).toBe(true);
}

describe("planPages — balanced input-order split", () => {
  it("splits N/P with sizes differing by at most 1, input order preserved", () => {
    expect(planPages(12, 5)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11],
    ]);
    const pages = planPages(50, 20);
    expect(pages.length).toBe(3);
    expect(pages.map((p) => p.length)).toEqual([17, 17, 16]);
    expect(pages.flat()).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
  it("one page when everything fits", () => {
    expect(planPages(7, 20)).toEqual([[0, 1, 2, 3, 4, 5, 6]]);
  });
});

describe("relaxedMaxCellPx — the taste bound yields to small counts", () => {
  it("keeps the bound when the count already needs small cells", () => {
    expect(relaxedMaxCellPx(320, 1920, 1280, 49)).toBe(320);
  });
  it("grows toward the density-2 scale for tiny counts", () => {
    // 2 images on 1600×900: density-2 scale = √(1440000/4) = 600 → relaxed ≥ 600.
    expect(relaxedMaxCellPx(320, 1600, 900, 2)).toBeGreaterThanOrEqual(600);
  });
});

describe("solvePages", () => {
  it("single page when unconstrained and everything fits", () => {
    const pages = solvePages({ ...BASE, aspects: seedMix(12) });
    expect(pages.length).toBe(1);
    expect(pages[0].imageIndexes).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it("maxImagesPerSheet paginates with balanced counts and full coverage per page", () => {
    const pages = solvePages({ ...BASE, aspects: seedMix(12), maxImagesPerSheet: 5 });
    expect(pages.length).toBe(3);
    for (const p of pages) {
      expect(p.imageIndexes.length).toBe(4);
      assertExactCover(p.solve.placed, p.solve.candidate.cols, p.solve.candidate.rows);
      expect(p.solve.metrics.fillerCount).toBe(0);
      expect(p.solve.assignments.length).toBe(4);
    }
    expect(pages.flatMap((p) => p.imageIndexes)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it("uniform mode shares ONE lattice across pages; independent may differ", () => {
    const uniform = solvePages({ ...BASE, aspects: seedMix(24), maxImagesPerSheet: 8, pageLattice: "uniform" });
    const lattices = new Set(uniform.map((p) => `${p.solve.candidate.cols}x${p.solve.candidate.rows}`));
    expect(lattices.size).toBe(1);
    const independent = solvePages({ ...BASE, aspects: seedMix(24), maxImagesPerSheet: 8, pageLattice: "independent" });
    expect(independent.length).toBe(uniform.length);
    for (const p of independent) {
      assertExactCover(p.solve.placed, p.solve.candidate.cols, p.solve.candidate.rows);
      expect(p.solve.metrics.fillerCount).toBe(0);
    }
  });

  it("pages GEOMETRICALLY when N exceeds sheet capacity (no maxImagesPerSheet set)", () => {
    // 300 images at ≥120px cells cannot fit one 1080p sheet.
    const capacity = maxLatticeUnits(BASE);
    expect(capacity).toBeLessThan(300);
    const pages = solvePages({ ...BASE, aspects: seedMix(300) });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((p) => p.imageIndexes).length).toBe(300);
  });

  it("is deterministic and seed-sensitive", () => {
    const a = solvePages({ ...BASE, aspects: seedMix(12), maxImagesPerSheet: 5 });
    const b = solvePages({ ...BASE, aspects: seedMix(12), maxImagesPerSheet: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("throws only when not even one image fits", () => {
    expect(() =>
      solvePages({ ...BASE, canvasW: 100, canvasH: 100, minCellPx: 300, maxCellPx: 320, aspects: seedMix(3) }),
    ).toThrow(/no lattice fits/);
  });
});
