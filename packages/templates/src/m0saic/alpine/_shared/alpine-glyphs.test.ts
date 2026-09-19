import { ALPINE_GLYPHS, ALPINE_GLYPH_NAMES, resolveAlpineGlyph } from "./alpine-glyphs";
import { KPI_GLYPHS } from "../../hero/ffmpeg-pulse/_shared/pulse-glyphs";

describe("alpine-glyphs — the friendly door to raw iconPath agent props", () => {
  it("catalog is non-empty and every entry is a plausible SVG path", () => {
    expect(ALPINE_GLYPH_NAMES.length).toBeGreaterThanOrEqual(8);
    for (const name of ALPINE_GLYPH_NAMES) {
      expect(ALPINE_GLYPHS[name]).toMatch(/^M[\d.]/);
    }
  });

  it("the hero pack's KPI_GLYPHS is THIS catalog (one source of truth)", () => {
    expect(KPI_GLYPHS).toBe(ALPINE_GLYPHS);
  });

  it("resolves a friendly name; the RAW agent prop wins as override", () => {
    expect(resolveAlpineGlyph("commits", undefined, "@t")).toBe(ALPINE_GLYPHS.commits);
    expect(resolveAlpineGlyph("commits", "M0 0h1", "@t")).toBe("M0 0h1");
    expect(resolveAlpineGlyph(undefined, undefined, "@t")).toBeUndefined();
  });

  it("an unknown friendly name fails fast, naming the options", () => {
    expect(() => resolveAlpineGlyph("nope", undefined, "@t")).toThrow(/unknown icon "nope".*commits/);
  });
});
