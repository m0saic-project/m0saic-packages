import { validateM0String } from "@m0saic/dsl";
import { queryFrames } from "@m0saic/dsl-stdlib";
import { buildContainLayout, computeContainRect } from "./layout";

describe("computeContainRect", () => {
  it("letterboxes a square logo inside a wide canvas", () => {
    expect(computeContainRect(1920, 1080, 272, 272)).toEqual({ w: 1080, h: 1080 });
  });

  it("pillarboxes a wide logo inside a square canvas", () => {
    expect(computeContainRect(1080, 1080, 272, 100)).toEqual({
      w: 1080,
      h: Math.round((100 / 272) * 1080),
    });
  });

  it("returns the full canvas on an exact aspect match", () => {
    expect(computeContainRect(1080, 1080, 272, 272)).toEqual({ w: 1080, h: 1080 });
  });

  it("never exceeds the canvas or collapses to zero", () => {
    const r = computeContainRect(100, 3, 272, 272);
    expect(r.w).toBeLessThanOrEqual(100);
    expect(r.h).toBeLessThanOrEqual(3);
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
    expect(computeContainRect(100, 100, 0, 0)).toEqual({ w: 100, h: 100 });
  });
});

describe("buildContainLayout", () => {
  it("carves exactly one centered rendered frame at the fit rect", () => {
    const layout = buildContainLayout(1920, 1080, 272, 272);
    expect(validateM0String(layout.m0).ok).toBe(true);
    expect(layout.exactFit).toBe(false);
    const frames = queryFrames(layout.m0, { width: 1920, height: 1080 }).logical();
    expect(frames.length).toBe(1);
    const f = frames[0]!;
    expect(f.width).toBe(1080);
    expect(f.height).toBe(1080);
    expect(f.x).toBe((1920 - 1080) / 2);
    expect(f.y).toBe(0);
  });

  it("flags exact fits so callers skip pointless nesting", () => {
    const layout = buildContainLayout(1080, 1080, 272, 272);
    expect(layout.exactFit).toBe(true);
  });

  it("is deterministic", () => {
    const a = buildContainLayout(1920, 1080, 300, 100);
    const b = buildContainLayout(1920, 1080, 300, 100);
    expect(a.m0).toBe(b.m0);
    expect(a.rect).toEqual(b.rect);
  });
});
