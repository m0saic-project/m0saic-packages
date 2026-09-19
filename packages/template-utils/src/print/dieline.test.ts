import { dielineOverlayGeometry, resolveDieline } from "./dieline";

const SPEC = {
  panels: [
    { id: "back", widthMm: 130 },
    { id: "spine", widthMm: 14 },
    { id: "front", widthMm: 130 },
  ] as const,
  heightMm: 184,
  bleedMm: 3,
  safeMarginMm: 5,
};

describe("resolveDieline", () => {
  it("matches the standard 300-DPI DVD canvas", () => {
    const resolved = resolveDieline(SPEC, 300);
    expect(resolved.canvas).toEqual({ x: 0, y: 0, width: 3307, height: 2244 });
    // Cumulative endpoints: round(277mm) - round(3mm) = 3237px. The trim
    // width deliberately need not equal independently-rounded 274mm.
    expect(resolved.trimBox.width).toBe(3237);
    expect(resolved.panels.map((panel) => panel.id)).toEqual(["back", "spine", "front"]);
  });

  it("tiles panels exactly at every supported DPI", () => {
    for (let dpi = 72; dpi <= 600; dpi++) {
      const resolved = resolveDieline(SPEC, dpi);
      const [back, spine, front] = resolved.panels;
      expect(back.trim.x + back.trim.width).toBe(spine.trim.x);
      expect(spine.trim.x + spine.trim.width).toBe(front.trim.x);
      expect(front.trim.x + front.trim.width).toBe(
        resolved.trimBox.x + resolved.trimBox.width,
      );
      expect(back.trim.width + spine.trim.width + front.trim.width).toBe(
        resolved.trimBox.width,
      );
    }
  });

  it("derives guide geometry from the same oracle", () => {
    const resolved = resolveDieline(SPEC, 300);
    const overlay = dielineOverlayGeometry(resolved);
    expect(overlay.trim).toEqual(resolved.trimBox);
    expect(overlay.safeRects).toEqual(resolved.panels.map((panel) => panel.safe));
    expect(overlay.foldLines.map((line) => line.x)).toEqual(resolved.foldLinesX);
  });

  it("rejects duplicate panels and collapsing safe margins", () => {
    expect(() => resolveDieline({ ...SPEC, panels: [{ id: "x", widthMm: 10 }, { id: "x", widthMm: 10 }] }, 300)).toThrow();
    expect(() => resolveDieline({ ...SPEC, safeMarginMm: 8 }, 300)).toThrow();
  });
});
