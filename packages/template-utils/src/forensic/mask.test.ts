import { describe, expect, it } from "@jest/globals";
import { buildCellMask, cellRowCol } from "./mask";

describe("buildCellMask", () => {
  it("is deterministic for fixed seed + shape", () => {
    const a = buildCellMask({ cols: 16, rows: 9, codewordBits: 32, seed: 0xc0ffee });
    const b = buildCellMask({ cols: 16, rows: 9, codewordBits: 32, seed: 0xc0ffee });
    expect(Array.from(a.bitIdx)).toEqual(Array.from(b.bitIdx));
    expect(Array.from(a.sign)).toEqual(Array.from(b.sign));
  });

  it("different seeds → different masks", () => {
    const a = buildCellMask({ cols: 16, rows: 9, codewordBits: 32, seed: 1 });
    const b = buildCellMask({ cols: 16, rows: 9, codewordBits: 32, seed: 2 });
    expect(Array.from(a.bitIdx)).not.toEqual(Array.from(b.bitIdx));
  });

  it("each codeword bit covers floor(cells/n) cells (+1 for leftovers)", () => {
    const cols = 16;
    const rows = 9;
    const cellCount = cols * rows;
    const n = 10; // 144 cells / 10 = 14.4 → cellsPerBit=14, leftover=4
    const m = buildCellMask({ cols, rows, codewordBits: n, seed: 7 });
    expect(m.cellsPerBit).toBe(14);
    // bits 0..3 get 15 cells, bits 4..9 get 14 cells
    const counts: number[] = new Array(n).fill(0);
    for (let i = 0; i < cellCount; i += 1) counts[m.bitIdx[i]!]! += 1;
    expect(counts).toEqual([15, 15, 15, 15, 14, 14, 14, 14, 14, 14]);
  });

  it("cellsByBit reverse-indexes correctly", () => {
    const m = buildCellMask({ cols: 8, rows: 8, codewordBits: 16, seed: 42 });
    for (let b = 0; b < m.codewordBits; b += 1) {
      for (const cellIdx of m.cellsByBit[b]!) {
        expect(m.bitIdx[cellIdx]).toBe(b);
      }
    }
  });

  it("sign array has values in {-1, +1} and is roughly balanced", () => {
    const m = buildCellMask({ cols: 64, rows: 36, codewordBits: 127, seed: 0xabc });
    let neg = 0;
    let pos = 0;
    for (let i = 0; i < m.cellCount; i += 1) {
      const s = m.sign[i]!;
      expect(s === -1 || s === 1).toBe(true);
      if (s === -1) neg += 1;
      else pos += 1;
    }
    // 64*36 = 2304 cells; sign mean should be near 0 — give it a generous
    // band (sign imbalance is fine; the goal is mean-zero on the order
    // of a few % at this sample size).
    expect(Math.abs(pos - neg) / m.cellCount).toBeLessThan(0.1);
  });

  it("rejects codewordBits > cellCount", () => {
    expect(() =>
      buildCellMask({ cols: 4, rows: 4, codewordBits: 32, seed: 1 }),
    ).toThrow();
  });

  it("cellRowCol round-trips with row-major layout", () => {
    expect(cellRowCol(0, 16)).toEqual({ row: 0, col: 0 });
    expect(cellRowCol(15, 16)).toEqual({ row: 0, col: 15 });
    expect(cellRowCol(16, 16)).toEqual({ row: 1, col: 0 });
    expect(cellRowCol(35, 16)).toEqual({ row: 2, col: 3 });
  });
});
