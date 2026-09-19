import { MM_PER_INCH, mmSpanToPx, mmToPx, pxToMm } from "./units";

describe("print units", () => {
  it("uses the exact international inch and round-trips device pixels", () => {
    expect(MM_PER_INCH).toBe(25.4);
    expect(mmToPx(25.4, 300)).toBe(300);
    expect(pxToMm(300, 300)).toBeCloseTo(25.4, 12);
  });

  it("derives adjacent widths from shared cumulative boundaries", () => {
    for (let dpi = 72; dpi <= 600; dpi++) {
      const a = mmSpanToPx(3, 133, dpi);
      const b = mmSpanToPx(133, 147, dpi);
      const c = mmSpanToPx(147, 277, dpi);
      expect(a + b + c).toBe(mmSpanToPx(3, 277, dpi));
    }
  });

  it("rejects invalid inputs", () => {
    expect(() => mmToPx(1, 0)).toThrow();
    expect(() => pxToMm(1, -1)).toThrow();
    expect(() => mmSpanToPx(2, 1, 300)).toThrow();
  });
});
