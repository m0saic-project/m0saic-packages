import { validateM0String } from "@m0saic/dsl";

import { scatterLayers, scatterNode } from "./scatter";

describe("scatterLayers (loads the shipped scatter pack)", () => {
  for (const [W, H, label] of [[1920, 1080, "desktop"], [1080, 1080, "square"], [1080, 1920, "mobile"]] as const) {
    it(`builds valid painted layers for ${label} ${W}x${H}`, () => {
      const layers = scatterLayers({ W, H });
      expect(layers.length).toBeGreaterThan(0);
      for (const ly of layers) {
        expect(validateM0String(ly.m0).ok).toBe(true);
        expect(ly.sources.length).toBeGreaterThan(0);
        expect(ly.sources.every((s) => s.type === "lavfi")).toBe(true);
      }
    });
  }

  it("is deterministic — same dims → identical layers", () => {
    const a = scatterLayers({ W: 1920, H: 1080 });
    const b = scatterLayers({ W: 1920, H: 1080 });
    expect(a.map((l) => l.m0)).toEqual(b.map((l) => l.m0));
    expect(a.reduce((n, l) => n + l.sources.length, 0)).toBe(b.reduce((n, l) => n + l.sources.length, 0));
  });

  it("picks a different variant per aspect (tile counts differ)", () => {
    const desk = scatterLayers({ W: 1920, H: 1080 }).reduce((n, l) => n + l.sources.length, 0);
    const mob = scatterLayers({ W: 1080, H: 1920 }).reduce((n, l) => n + l.sources.length, 0);
    expect(desk).not.toBe(mob);
  });

  it("scatterNode composes a single valid Node", () => {
    const n = scatterNode({ W: 1920, H: 1080 });
    expect(validateM0String(n.m0).ok).toBe(true);
    expect(n.sources.length).toBeGreaterThan(0);
  });
});
