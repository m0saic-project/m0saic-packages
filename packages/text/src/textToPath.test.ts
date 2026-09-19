import { textToPath, bundledFontPath, measureText } from "./textToPath";
import * as fs from "fs";

/** Pull every absolute moveto X from an SVG path `d` (Roboto outlines emit
 *  absolute "M x y" commands). Used to assert horizontal placement without
 *  pinning exact glyph coordinates. */
function moveXs(d: string): number[] {
  const xs: number[] = [];
  const re = /M\s*(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) xs.push(parseFloat(m[1]));
  return xs;
}
function moveYs(d: string): number[] {
  const ys: number[] = [];
  const re = /M\s*-?[\d.]+\s+(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) ys.push(parseFloat(m[1]));
  return ys;
}
const minX = (d: string) => Math.min(...moveXs(d));
const minY = (d: string) => Math.min(...moveYs(d));

describe("textToPath", () => {
  it("bundles a readable default font", () => {
    expect(fs.existsSync(bundledFontPath())).toBe(true);
  });

  it("returns an SVG path `d` of glyph outlines for a basic string", () => {
    const d = textToPath("1", { fontSize: 60 }, { width: 200, height: 200 });
    expect(typeof d).toBe("string");
    expect(d.length).toBeGreaterThan(0);
    expect(d.trimStart().startsWith("M")).toBe(true);
  });

  it("returns '' for empty / whitespace-only / newline-only text", () => {
    expect(textToPath("", { fontSize: 40 }, { width: 100, height: 100 })).toBe("");
    expect(textToPath("\n\n", { fontSize: 40 }, { width: 100, height: 100 })).toBe("");
  });

  it("horizontal alignment shifts the glyphs left → center → right", () => {
    const c = { width: 1000, height: 200 };
    const left = minX(textToPath("AB", { fontSize: 40, hAlign: "left" }, c));
    const center = minX(textToPath("AB", { fontSize: 40, hAlign: "center" }, c));
    const right = minX(textToPath("AB", { fontSize: 40, hAlign: "right" }, c));
    expect(left).toBeLessThan(center);
    expect(center).toBeLessThan(right);
  });

  it("vertical alignment shifts the glyphs top → middle → bottom", () => {
    const c = { width: 200, height: 1000 };
    const top = minY(textToPath("A", { fontSize: 40, vAlign: "top" }, c));
    const middle = minY(textToPath("A", { fontSize: 40, vAlign: "middle" }, c));
    const bottom = minY(textToPath("A", { fontSize: 40, vAlign: "bottom" }, c));
    expect(top).toBeLessThan(middle);
    expect(middle).toBeLessThan(bottom);
  });

  it("padding insets a top-left run away from the edges", () => {
    const c = { width: 500, height: 500 };
    const noPad = textToPath("1", { fontSize: 40, hAlign: "left", vAlign: "top" }, c);
    const padded = textToPath(
      "1",
      { fontSize: 40, hAlign: "left", vAlign: "top", padding: 50 },
      c,
    );
    expect(minX(padded)).toBeGreaterThan(minX(noPad));
    expect(minY(padded)).toBeGreaterThan(minY(noPad));
  });

  it("stacks multi-line text downward", () => {
    const c = { width: 400, height: 400 };
    const d = textToPath("AA\nBB", { fontSize: 40, vAlign: "top" }, c);
    const ys = moveYs(d).sort((a, b) => a - b);
    // Two visually separated bands → spread between first and last moveY.
    expect(ys[ys.length - 1] - ys[0]).toBeGreaterThan(20);
  });

  describe("m0 escape hatch (single-frame contract)", () => {
    it("places text inside a single-frame m0 box (carved with null tiles)", () => {
      const c = { width: 1000, height: 400 };
      // 2(F,-) → one frame, left half (x<500). 2(-,F) → right half (x>500).
      const left = textToPath("R", { fontSize: 80, m0: "2(F,-)" }, c);
      const right = textToPath("R", { fontSize: 80, m0: "2(-,F)" }, c);
      expect(minX(left)).toBeLessThan(500);
      expect(minX(right)).toBeGreaterThan(500);
    });

    it("throws when the m0 resolves to MORE than one frame", () => {
      expect(() =>
        textToPath("x", { fontSize: 20, m0: "2(1,1)" }, { width: 100, height: 100 }),
      ).toThrow(/exactly one frame/);
    });

    it("throws when the m0 resolves to ZERO frames", () => {
      expect(() =>
        textToPath("x", { fontSize: 20, m0: "-" }, { width: 100, height: 100 }),
      ).toThrow(/exactly one frame/);
    });

    it("rejects setting both m0 and rect", () => {
      expect(() =>
        textToPath(
          "x",
          { fontSize: 20, m0: "F", rect: { width: 50, height: 50 } },
          { width: 100, height: 100 },
        ),
      ).toThrow(/either .*m0.* or .*rect/);
    });
  });

  describe("rect escape hatch (placeRect-generated)", () => {
    it("places text in an exact pixel rect", () => {
      const c = { width: 1000, height: 400 };
      const d = textToPath(
        "R",
        { fontSize: 80, rect: { width: 200, height: 200, x: 600, y: 100 } },
        c,
      );
      // box top-left at (600,100) → glyphs sit right-of-600, below-100.
      expect(minX(d)).toBeGreaterThanOrEqual(600);
      expect(minY(d)).toBeGreaterThanOrEqual(100);
    });

    it("aligns the box within the canvas (right/bottom) when x/y omitted", () => {
      const c = { width: 1000, height: 400 };
      const left = textToPath(
        "R",
        { fontSize: 60, rect: { width: 100, height: 100, hAlign: "left", vAlign: "top" } },
        c,
      );
      const right = textToPath(
        "R",
        { fontSize: 60, rect: { width: 100, height: 100, hAlign: "right", vAlign: "bottom" } },
        c,
      );
      expect(minX(left)).toBeLessThan(minX(right));
      expect(minY(left)).toBeLessThan(minY(right));
    });

    it("throws (via placeRect) when the rect does not fit the canvas", () => {
      expect(() =>
        textToPath(
          "x",
          { fontSize: 20, rect: { width: 500, height: 50 } },
          { width: 100, height: 100 },
        ),
      ).toThrow();
    });
  });

  it("validates fontSize and canvas dimensions", () => {
    expect(() => textToPath("x", { fontSize: 0 }, { width: 100, height: 100 })).toThrow(
      /fontSize/,
    );
    expect(() => textToPath("x", { fontSize: 20 }, { width: 0, height: 100 })).toThrow(
      /canvas/,
    );
  });
});

describe("measureText", () => {
  it("scales width linearly with fontSize", () => {
    const a = measureText("1234", { fontSize: 20 });
    const b = measureText("1234", { fontSize: 40 });
    expect(b.width).toBeCloseTo(a.width * 2, 1);
  });

  it("wider strings measure wider at the same size", () => {
    const short = measureText("1", { fontSize: 40 });
    const long = measureText("123456789", { fontSize: 40 });
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("reports widest line + per-line stacked height for multi-line text", () => {
    const one = measureText("AA", { fontSize: 40 });
    const two = measureText("AA\nBBBB", { fontSize: 40 });
    expect(two.lines).toBe(2);
    expect(two.width).toBeGreaterThan(one.width); // widest line is "BBBB"
    expect(two.height).toBeGreaterThan(one.height); // extra line adds a lineStep
  });

  it("agrees with textToPath's advance (measure-then-place fits)", () => {
    // measureText is the budget; textToPath lays out at that size. The emitted
    // glyph extent must not exceed the measured advance (within rounding).
    const size = 50;
    const text = "1920";
    const measured = measureText(text, { fontSize: size });
    const d = textToPath(text, { fontSize: size, hAlign: "left", vAlign: "top" }, {
      width: 2000,
      height: 200,
    });
    const xs = moveXs(d);
    const extent = Math.max(...xs) - Math.min(...xs);
    // Glyph move-tos span at most the advance width (last glyph's left edge).
    expect(extent).toBeLessThanOrEqual(measured.width + 1);
  });

  it("empty text measures to zero extent", () => {
    const m = measureText("", { fontSize: 40 });
    expect(m.width).toBe(0);
    expect(m.lines).toBe(0);
  });

  it("rejects non-positive fontSize", () => {
    expect(() => measureText("x", { fontSize: 0 })).toThrow(/fontSize/);
  });
});
