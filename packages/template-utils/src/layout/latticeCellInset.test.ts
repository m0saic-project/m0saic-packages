import { latticeCellInset, type LatticeUnitRect } from "./latticeCellInset";
import { engineRecover } from "../geometry-contract/checkDocGeometry";

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Simulate the raw cells a unit-weight split tree realizes: each lattice line
 * lands at the independently-rounded ideal `round(k·axis/count)`. The real
 * emitter (Phase 3) parses these back from the m0; here we replicate the same
 * ±0.5px quantization the resolver must absorb.
 */
function rawCellFor(unit: LatticeUnitRect, cols: number, rows: number, W: number, H: number): Rect {
  const bx = (k: number) => Math.round((k * W) / cols);
  const by = (k: number) => Math.round((k * H) / rows);
  return {
    x: bx(unit.c0),
    y: by(unit.r0),
    w: bx(unit.c0 + unit.cs) - bx(unit.c0),
    h: by(unit.r0 + unit.rs) - by(unit.r0),
  };
}

const cellsFor = (units: LatticeUnitRect[], cols: number, rows: number, W: number, H: number) =>
  units.map((unit) => ({ unit, raw: rawCellFor(unit, cols, rows, W, H) }));

/** Full 1×1 tiling of the lattice. */
const fullTiling = (cols: number, rows: number): LatticeUnitRect[] => {
  const units: LatticeUnitRect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) units.push({ c0: c, r0: r, cs: 1, rs: 1 });
  return units;
};

describe("latticeCellInset — content-grid retargeted insets", () => {
  // The seed collage's shape: 11×9 lattice at 1920×1280, ~20px gutters, margin = gutter.
  const SEED = { cols: 11, rows: 9, canvasW: 1920, canvasH: 1280, gutterXPx: 20, gutterYPx: 18, marginPx: 20 };

  it("recovers every target EXACTLY under the engine's floor math (seed lattice, mixed spans)", () => {
    const units: LatticeUnitRect[] = [
      { c0: 0, r0: 0, cs: 1, rs: 1 },   // unit
      { c0: 1, r0: 0, cs: 2, rs: 2 },   // hero
      { c0: 3, r0: 0, cs: 1, rs: 2 },   // portrait
      { c0: 4, r0: 0, cs: 2, rs: 1 },   // panorama
      { c0: 10, r0: 8, cs: 1, rs: 1 },  // far corner
    ];
    const cells = cellsFor(units, SEED.cols, SEED.rows, SEED.canvasW, SEED.canvasH);
    const res = latticeCellInset({ ...SEED, cells });
    expect(res.maxClampPx).toBe(0);
    cells.forEach(({ raw }, i) => {
      const inset = res.insetAt(i);
      const recovered = inset ? engineRecover(raw, inset) : raw;
      expect(recovered).toEqual(res.targets[i]);
    });
  });

  it("margins are exactly marginPx and edge-to-edge gutters exactly gutterPx (full tiling)", () => {
    const units = fullTiling(SEED.cols, SEED.rows);
    const cells = cellsFor(units, SEED.cols, SEED.rows, SEED.canvasW, SEED.canvasH);
    const res = latticeCellInset({ ...SEED, cells });
    expect(res.maxClampPx).toBe(0);

    const recovered = cells.map(({ raw }, i) => {
      const inset = res.insetAt(i);
      return inset ? engineRecover(raw, inset) : raw;
    });
    // Outer margins on all four canvas edges.
    for (let r = 0; r < SEED.rows; r++) {
      expect(recovered[r * SEED.cols].x).toBe(SEED.marginPx);
      const last = recovered[r * SEED.cols + SEED.cols - 1];
      expect(last.x + last.w).toBe(SEED.canvasW - SEED.marginPx);
    }
    for (let c = 0; c < SEED.cols; c++) {
      expect(recovered[c].y).toBe(SEED.marginPx);
      const last = recovered[(SEED.rows - 1) * SEED.cols + c];
      expect(last.y + last.h).toBe(SEED.canvasH - SEED.marginPx);
    }
    // EVERY horizontal and vertical gap is exactly the gutter.
    for (let r = 0; r < SEED.rows; r++)
      for (let c = 1; c < SEED.cols; c++) {
        const prev = recovered[r * SEED.cols + c - 1];
        const cur = recovered[r * SEED.cols + c];
        expect(cur.x - (prev.x + prev.w)).toBe(SEED.gutterXPx);
      }
    for (let r = 1; r < SEED.rows; r++)
      for (let c = 0; c < SEED.cols; c++) {
        const above = recovered[(r - 1) * SEED.cols + c];
        const cur = recovered[r * SEED.cols + c];
        expect(cur.y - (above.y + above.h)).toBe(SEED.gutterYPx);
      }
    // Same-class cells differ only by independent-rounding jitter (≤1px per axis).
    const ws = recovered.map((b) => b.w);
    const hs = recovered.map((b) => b.h);
    expect(Math.max(...ws) - Math.min(...ws)).toBeLessThanOrEqual(1);
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(1);
  });

  it("null-space accounting closes: painted + gutters + margins == canvas area", () => {
    const units = fullTiling(SEED.cols, SEED.rows);
    const cells = cellsFor(units, SEED.cols, SEED.rows, SEED.canvasW, SEED.canvasH);
    const res = latticeCellInset({ ...SEED, cells });
    const painted = res.targets.reduce((a, t) => a + t.w * t.h, 0);
    // Structural null space, computed from the integer lattice lines: vertical
    // gutter strips + horizontal strips (minus double-counted intersections)
    // + the margin frame.
    const innerW = SEED.canvasW - 2 * SEED.marginPx;
    const innerH = SEED.canvasH - 2 * SEED.marginPx;
    const gutterArea =
      (SEED.cols - 1) * SEED.gutterXPx * innerH +
      (SEED.rows - 1) * SEED.gutterYPx * innerW -
      (SEED.cols - 1) * (SEED.rows - 1) * SEED.gutterXPx * SEED.gutterYPx;
    const marginArea = SEED.canvasW * SEED.canvasH - innerW * innerH;
    expect(painted + gutterArea + marginArea).toBe(SEED.canvasW * SEED.canvasH);
  });

  it("stays exact across canvases, including hostile prime dims", () => {
    const lattices = [
      { cols: 5, rows: 4, canvasW: 1920, canvasH: 1080 },
      { cols: 5, rows: 4, canvasW: 1080, canvasH: 1920 },
      { cols: 5, rows: 4, canvasW: 997, canvasH: 613 }, // primes — raw split quantizes hard
      { cols: 4, rows: 3, canvasW: 640, canvasH: 360 },
    ];
    for (const l of lattices) {
      const units = fullTiling(l.cols, l.rows);
      const cells = cellsFor(units, l.cols, l.rows, l.canvasW, l.canvasH);
      const res = latticeCellInset({ ...l, gutterXPx: 4, gutterYPx: 4, marginPx: 4, cells });
      expect(res.maxClampPx).toBe(0);
      cells.forEach(({ raw }, i) => {
        const inset = res.insetAt(i);
        const recovered = inset ? engineRecover(raw, inset) : raw;
        expect(recovered).toEqual(res.targets[i]);
      });
    }
  });

  it("returns undefined insets when the raw lattice already IS the target (g=0, m=0, even split)", () => {
    const cells = cellsFor(fullTiling(5, 4), 5, 4, 1000, 800); // 1000/5, 800/4 divide evenly
    const res = latticeCellInset({ cols: 5, rows: 4, canvasW: 1000, canvasH: 800, gutterXPx: 0, gutterYPx: 0, marginPx: 0, cells });
    cells.forEach((_, i) => expect(res.insetAt(i)).toBeUndefined());
    expect(res.maxClampPx).toBe(0);
  });

  it("line-fitting keeps margin ≫ gutter EXACT (the old clamp case, resolved)", () => {
    // m=40 vs g=10 at C=8 used to force target clamps (narrowed gutters).
    // Lattice lines now fit their feasible windows [rawStart, rawEnd+g], so
    // gutters and margins stay exact and CELL WIDTHS absorb the variance.
    const cols = 8, rows = 2, W = 800, H = 200;
    const cells = cellsFor(fullTiling(cols, rows), cols, rows, W, H);
    const res = latticeCellInset({ cols, rows, canvasW: W, canvasH: H, gutterXPx: 10, gutterYPx: 10, marginPx: 40, cells });
    expect(res.maxClampPx).toBe(0);
    expect(res.clampedEdges).toBe(0);
    // Margins exact; every horizontal gap between row-adjacent targets exact.
    for (let r = 0; r < rows; r++) {
      expect(res.targets[r * cols].x).toBe(40);
      const last = res.targets[r * cols + cols - 1];
      expect(last.x + last.w).toBe(W - 40);
      for (let c = 0; c < cols - 1; c++) {
        const a = res.targets[r * cols + c];
        const b = res.targets[r * cols + c + 1];
        expect(b.x - (a.x + a.w)).toBe(10);
      }
    }
    // And recovery through the engine's floor math stays byte-exact.
    cells.forEach(({ raw }, i) => {
      const inset = res.insetAt(i);
      const rec = inset ? engineRecover(raw, inset) : raw;
      expect(rec).toEqual(res.targets[i]);
    });
  });

  it("degrades and REPORTS only when a line's window is genuinely infeasible", () => {
    // Synthetic inconsistency: two rows disagree about the col-1 raw
    // boundary by more than the gutter (100 vs 115, g=4) — no line position
    // satisfies both, so the legacy escape-clamp path reports it. A real
    // single-parse tiling shares boundaries and can never hit this.
    const cells = [
      { unit: { c0: 0, r0: 0, cs: 1, rs: 1 }, raw: { x: 0, y: 0, w: 100, h: 100 } },
      { unit: { c0: 1, r0: 0, cs: 1, rs: 1 }, raw: { x: 100, y: 0, w: 100, h: 100 } },
      { unit: { c0: 0, r0: 1, cs: 1, rs: 1 }, raw: { x: 0, y: 100, w: 115, h: 100 } },
      { unit: { c0: 1, r0: 1, cs: 1, rs: 1 }, raw: { x: 115, y: 100, w: 85, h: 100 } },
    ];
    const res = latticeCellInset({
      cols: 2, rows: 2, canvasW: 200, canvasH: 200,
      gutterXPx: 4, gutterYPx: 4, marginPx: 4, cells,
    });
    expect(res.clampedEdges).toBeGreaterThan(0);
    expect(res.maxClampPx).toBeGreaterThan(0);
    // Insets remain valid (recovered box stays inside its raw cell).
    cells.forEach(({ raw }, i) => {
      const inset = res.insetAt(i);
      const rec = inset ? engineRecover(raw, inset) : raw;
      expect(rec.x).toBeGreaterThanOrEqual(raw.x);
      expect(rec.x + rec.w).toBeLessThanOrEqual(raw.x + raw.w);
    });
  });

  it("fail-fast validation", () => {
    const ok = cellsFor([{ c0: 0, r0: 0, cs: 1, rs: 1 }], 4, 4, 400, 400);
    const base = { cols: 4, rows: 4, canvasW: 400, canvasH: 400, gutterXPx: 4, gutterYPx: 4, marginPx: 4, cells: ok };
    expect(() => latticeCellInset({ ...base, gutterXPx: 4.5 })).toThrow(/gutterXPx/);
    expect(() => latticeCellInset({ ...base, cols: 0 })).toThrow(/cols/);
    expect(() => latticeCellInset({ ...base, cells: [] })).toThrow(/non-empty/);
    expect(() =>
      latticeCellInset({ ...base, cells: [{ unit: { c0: 3, r0: 0, cs: 2, rs: 1 }, raw: { x: 0, y: 0, w: 100, h: 100 } }] }),
    ).toThrow(/outside/);
    // Lattice that can't leave 1px per unit.
    expect(() =>
      latticeCellInset({ ...base, canvasW: 40, canvasH: 40, gutterXPx: 10, gutterYPx: 10, marginPx: 10 }),
    ).toThrow(/does not fit/);
  });
});
