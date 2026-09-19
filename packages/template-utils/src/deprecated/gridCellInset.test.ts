import { gridCellInset } from "./gridCellInset";

describe("gridCellInset", () => {
  describe("full-bleed (default)", () => {
    const inset = gridCellInset({ rows: 3, cols: 3, gridW: 900, gridH: 900, gapPx: 10 });

    it("insets interior cells on all four shared edges", () => {
      const box = inset(1, 1);
      // cell = 300×300, half-gap = 5px → 5/300 fraction on every side.
      expect(box).toEqual({
        top: 5 / 300,
        right: 5 / 300,
        bottom: 5 / 300,
        left: 5 / 300,
      });
    });

    it("gives no OUTER inset (full-bleed) — top-left cell only insets right+bottom", () => {
      expect(inset(0, 0)).toEqual({ top: 0, right: 5 / 300, bottom: 5 / 300, left: 0 });
    });

    it("bottom-right cell only insets top+left", () => {
      expect(inset(2, 2)).toEqual({ top: 5 / 300, right: 0, bottom: 0, left: 5 / 300 });
    });
  });

  describe("outerMargin: true (equal cells, e.g. bars)", () => {
    const inset = gridCellInset({
      rows: 1, cols: 4, gridW: 800, gridH: 400, gapPx: 20, outerMargin: true,
    });

    it("insets every cell uniformly so all cells are equal size", () => {
      // 1 row → top/bottom are edges; with outerMargin they get the inset too.
      // cellW = 200, half = 10 → 10/200; cellH = 400, half = 10 → 10/400.
      const a = inset(0, 0);
      const b = inset(0, 2);
      expect(a).toEqual(b); // edge and interior cells get identical insets
      expect(a).toEqual({ top: 10 / 400, right: 10 / 200, bottom: 10 / 400, left: 10 / 200 });
    });
  });

  describe("per-axis outerMargin (bars: equal widths, full height)", () => {
    // A single row of bars: margin on the layout axis (x) for equal widths,
    // none on the cross axis (y) so bars keep full height.
    const inset = gridCellInset({
      rows: 1, cols: 4, gridW: 800, gridH: 400, gapPx: 20,
      outerMargin: { x: true, y: false },
    });

    it("insets every bar equally on x (incl. outer edges)", () => {
      const first = inset(0, 0);
      const mid = inset(0, 1);
      const last = inset(0, 3);
      expect(first).toEqual(mid);
      expect(last).toEqual(mid);
      expect((mid as { left: number }).left).toBeCloseTo(10 / 200, 6);
      expect((mid as { right: number }).right).toBeCloseTo(10 / 200, 6);
    });

    it("never insets the cross axis (bars keep full height)", () => {
      const box = inset(0, 1) as { top: number; bottom: number };
      expect(box.top).toBe(0);
      expect(box.bottom).toBe(0);
    });
  });

  describe("axis correction", () => {
    it("uses different fractions per axis when cells aren't square", () => {
      // cellW = 1920/4 = 480, cellH = 1080/2 = 540 → same px gap, different fracs.
      const inset = gridCellInset({ rows: 2, cols: 4, gridW: 1920, gridH: 1080, gapPx: 8 });
      const box = inset(0, 1) as { left: number; bottom: number };
      expect(box.left).toBeCloseTo(4 / 480, 6); // interior horizontal
      expect(box.bottom).toBeCloseTo(4 / 540, 6); // interior vertical
      expect(box.left).not.toBeCloseTo(box.bottom, 6);
    });
  });

  describe("1-row layout (horizontal bars)", () => {
    it("produces horizontal-only gaps (no vertical inset) in full-bleed", () => {
      const inset = gridCellInset({ rows: 1, cols: 3, gridW: 600, gridH: 300, gapPx: 12 });
      // Interior bar: shares left+right with neighbors; top/bottom are edges.
      expect(inset(0, 1)).toEqual({ top: 0, right: 6 / 200, bottom: 0, left: 6 / 200 });
    });
  });

  describe("edge cases", () => {
    it("returns undefined for every cell when gapPx <= 0", () => {
      const inset = gridCellInset({ rows: 4, cols: 4, gridW: 800, gridH: 800, gapPx: 0 });
      expect(inset(0, 0)).toBeUndefined();
      expect(inset(2, 2)).toBeUndefined();
    });

    it("a 1×1 grid never insets (every edge is an outer edge, full-bleed)", () => {
      const inset = gridCellInset({ rows: 1, cols: 1, gridW: 100, gridH: 100, gapPx: 10 });
      expect(inset(0, 0)).toBeUndefined();
    });

    it("skipFirstRowTop zeroes the top gap on row 0 only", () => {
      const inset = gridCellInset({ rows: 3, cols: 1, gridW: 100, gridH: 900, gapPx: 30, skipFirstRowTop: true });
      // row 0: shares bottom with row 1, but top is forced 0.
      expect((inset(0, 0) as { top: number }).top).toBe(0);
      // row 1: interior → top gap present.
      expect((inset(1, 0) as { top: number }).top).toBeGreaterThan(0);
    });
  });
});
