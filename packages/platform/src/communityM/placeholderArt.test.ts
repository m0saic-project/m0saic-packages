import { artHash, placeholderAvatarSvg, placeholderLogoSvg, placeholderMixUrl } from "./placeholderArt";

describe("placeholderArt", () => {
  it("is deterministic and valid-looking SVG", () => {
    for (let i = 0; i < 33; i++) {
      const a = placeholderAvatarSvg(i), l = placeholderLogoSvg(i);
      expect(a).toBe(placeholderAvatarSvg(i));
      expect(l).toBe(placeholderLogoSvg(i));
      expect(a.startsWith("<svg")).toBe(true);
      expect(l.startsWith("<svg")).toBe(true);
    }
  });
  it("spreads all six logo kinds across the tiles (no index correlation) and a shuffle re-deals", () => {
    const kindOf = (svg: string) => svg.includes("rx=\"40\"") ? "mono" : svg.includes("{}") ? "brace" : svg.includes("polyline") ? "chev" : svg.includes("crispEdges") ? "pixel" : svg.includes("polygon") ? "hex" : "circle";
    const kinds = new Set(Array.from({ length: 33 }, (_, i) => kindOf(placeholderLogoSvg(i, 1))));
    expect(kinds.size).toBe(6);
    // Even the "every third tile" subset the old Mix used sees more than two kinds.
    const thirds = new Set(Array.from({ length: 33 }, (_, i) => i).filter((i) => i % 3 === 1).map((i) => kindOf(placeholderLogoSvg(i, 1))));
    expect(thirds.size).toBeGreaterThan(2);
    const changed = Array.from({ length: 33 }, (_, i) => placeholderLogoSvg(i, 1) !== placeholderLogoSvg(i, 2)).filter(Boolean).length;
    expect(changed).toBeGreaterThan(20);
    expect(artHash(3, 1, 1)).not.toBe(artHash(3, 2, 1));
  });
  it("mix balance moves the logo share", () => {
    const logos = (p: number) => Array.from({ length: 33 }, (_, i) => placeholderMixUrl(i, 1, p) === placeholderMixUrl(i, 1, 1)).filter(Boolean).length;
    expect(logos(1)).toBe(33);
    expect(logos(0)).toBe(0);
    const third = logos(1 / 3);
    expect(third).toBeGreaterThan(4);
    expect(third).toBeLessThan(20);
  });
});
