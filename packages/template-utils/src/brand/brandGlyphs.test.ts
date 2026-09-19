import { BRAND_ORANGE, HEADER_M_GLYPH, STATUS_M0_GLYPH, brandGlyphTile } from "./brandGlyphs";

describe("brandGlyphs", () => {
  it("glyphs are square design spaces with non-trivial paths", () => {
    for (const glyph of [HEADER_M_GLYPH, STATUS_M0_GLYPH]) {
      expect(glyph.bounds.width).toBe(glyph.bounds.height);
      expect(glyph.path.length).toBeGreaterThan(100);
      expect(glyph.path.startsWith("M")).toBe(true);
    }
  });

  it("brandGlyphTile paints a masked color tile", () => {
    const tile = brandGlyphTile(HEADER_M_GLYPH, BRAND_ORANGE) as {
      type?: string;
      color?: string;
      mask?: { kind?: string; bounds?: { width?: number } };
    };
    expect(tile.type).toBe("lavfi");
    expect(tile.color).toBe(BRAND_ORANGE);
    expect(tile.mask?.kind).toBe("inline-mask");
    expect(tile.mask?.bounds?.width).toBe(272);
  });
});
