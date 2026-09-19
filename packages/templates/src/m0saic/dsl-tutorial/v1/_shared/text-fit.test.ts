import { textEmUnits } from "@m0saic/template-utils";
import {
  PROSE_EM,
  DIGIT_EM,
  fitFontPx,
  fitFontPxAll,
  fitLine,
  m0GlyphEm,
  textWidthPx,
  widestM0GlyphEm,
} from "./text-fit";

describe("dsl-tutorial text-fit — the CLI width model", () => {
  it("keeps the height-driven size when the text already fits", () => {
    expect(fitFontPx("Animated Wireframe", 442, 29, 12)).toBe(29);
    expect(fitLine("Animated Wireframe", 442, 29, 12)).toEqual({ text: "Animated Wireframe", fontSize: 29 });
  });

  it("shrinks to the width, never below the floor (portrait header title)", () => {
    // 248px title cell at 1080 wide, 52px height-driven font → 18 chars × .62 × f ≤ 248 → f = 22
    const f = fitFontPx("Animated Wireframe", 248, 52, 12);
    expect(f).toBe(Math.floor(248 / (18 * PROSE_EM)));
    expect(textWidthPx("Animated Wireframe", f)).toBeLessThanOrEqual(248);
    expect(fitFontPx("Animated Wireframe", 40, 52, 12)).toBe(12);
  });

  it("ellipsizes only at the floor, to the em budget", () => {
    const r = fitLine("The m0 DSL geometry walk, a step-by-step tutorial", 110, 29, 12);
    expect(r.fontSize).toBe(12);
    expect(r.text.endsWith("…")).toBe(true);
    expect(textWidthPx(r.text, 12)).toBeLessThanOrEqual(110);
  });

  it("fits a set of strings at ONE shared font (status metrics)", () => {
    const items = [
      { text: "passthroughs", availW: 78 },
      { text: "canvas", availW: 40 },
      { text: "1920×1080", availW: 60, em: DIGIT_EM },
    ];
    const f = fitFontPxAll(items, 23, 9);
    for (const it of items) expect(textWidthPx(it.text, f, it.em ?? PROSE_EM)).toBeLessThanOrEqual(it.availW);
    expect(f).toBeLessThan(23);
    expect(fitFontPxAll(items, 23, 9)).toBeGreaterThanOrEqual(9);
  });

  it("models wide scripts wider than Latin (textEmUnits)", () => {
    expect(textWidthPx("日本語", 20)).toBeGreaterThan(textWidthPx("abc", 20));
    expect(textEmUnits("abc")).toBe(3);
  });

  it("m0 glyph model: `>` is the widest glyph; punctuation is narrow", () => {
    expect(m0GlyphEm(">")).toBeGreaterThan(m0GlyphEm("2"));
    expect(m0GlyphEm("2")).toBeGreaterThan(m0GlyphEm(","));
    expect(m0GlyphEm("(")).toBe(m0GlyphEm("]"));
    expect(widestM0GlyphEm([..."2(2[F,F],2[F,F])"])).toBe(m0GlyphEm("2"));
    expect(widestM0GlyphEm([..."4(>,F,>,F)"])).toBe(m0GlyphEm(">"));
    expect(widestM0GlyphEm([])).toBeGreaterThan(0);
  });
});
