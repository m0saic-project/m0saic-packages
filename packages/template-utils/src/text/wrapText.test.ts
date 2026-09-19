import { wrapText, multilineTextLayers } from "./wrapText";

describe("wrapText", () => {
  it("returns single line when under the cap", () => {
    expect(wrapText("hello world", 20)).toEqual(["hello world"]);
  });

  it("wraps greedily on whitespace", () => {
    expect(wrapText("one two three four five", 10)).toEqual([
      "one two",
      "three four",
      "five",
    ]);
  });

  it("trims surrounding whitespace and collapses internal runs", () => {
    expect(wrapText("  one   two   three  ", 20)).toEqual(["one two three"]);
  });

  it("emits empty array for empty / whitespace input", () => {
    expect(wrapText("", 20)).toEqual([]);
    expect(wrapText("   ", 20)).toEqual([]);
  });

  it("does not split a word longer than the cap (lets it overflow standalone)", () => {
    expect(wrapText("aaaa bbbbbbbbbbbbbbbbbb cc", 10)).toEqual([
      "aaaa",
      "bbbbbbbbbbbbbbbbbb",
      "cc",
    ]);
  });

  it("handles maxCharsPerLine <= 0 by returning the original text as one line", () => {
    expect(wrapText("anything goes", 0)).toEqual(["anything goes"]);
  });
});

describe("multilineTextLayers", () => {
  it("returns one layer per wrapped line, vertically centered around the rect midpoint", () => {
    const layers = multilineTextLayers({
      // "alpha beta" (10) + ["gamma", "delta"] (each over the +5 budget)
      text: "alpha beta gamma delta",
      maxCharsPerLine: 10,
      fontSize: 20,
    });
    expect(layers).toHaveLength(3);
    // lineHeight = 20 * 1.3 = 26; offsets -1, 0, +1
    expect(layers[0].placement?.yExpr).toBe("(h-text_h)/2 + (-1) * 26");
    expect(layers[1].placement?.yExpr).toBe("(h-text_h)/2 + (0) * 26");
    expect(layers[2].placement?.yExpr).toBe("(h-text_h)/2 + (1) * 26");
  });

  it("returns empty array for empty input", () => {
    expect(multilineTextLayers({ text: "", maxCharsPerLine: 10, fontSize: 20 })).toEqual([]);
  });

  it("respects custom lineHeightRatio and hAlign", () => {
    const layers = multilineTextLayers({
      text: "one two",
      maxCharsPerLine: 3,
      fontSize: 10,
      lineHeightRatio: 2,
      hAlign: "left",
    });
    expect(layers).toHaveLength(2);
    expect(layers[0].placement?.hAlign).toBe("left");
    expect(layers[0].placement?.yExpr).toBe("(h-text_h)/2 + (-0.5) * 20");
  });
});
