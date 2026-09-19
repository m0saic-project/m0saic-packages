import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";
import type { LuminanceBucket } from "@m0saic/types";
import {
  bucketLightAlpha,
  buildAdaptiveAlphaExpr,
  buildCornerStampM0,
  buildEntranceExpr,
  composeAlpha,
} from "./expressions";

describe("bucketLightAlpha", () => {
  it("returns 0 when luma is at or below the (low,high) midpoint", () => {
    // midpoint of [100, 156] = 128
    expect(bucketLightAlpha(50, 100, 156)).toBe(0);
    expect(bucketLightAlpha(100, 100, 156)).toBe(0);
    expect(bucketLightAlpha(128, 100, 156)).toBe(0);
  });
  it("returns 1 when luma is above the midpoint", () => {
    expect(bucketLightAlpha(129, 100, 156)).toBe(1);
    expect(bucketLightAlpha(156, 100, 156)).toBe(1);
    expect(bucketLightAlpha(220, 100, 156)).toBe(1);
  });
  it("handles collapsed band (low == high) — threshold == that value", () => {
    expect(bucketLightAlpha(199, 200, 200)).toBe(0);
    expect(bucketLightAlpha(201, 200, 200)).toBe(1);
  });
});

describe("buildAdaptiveAlphaExpr", () => {
  it("empty buckets — light variant on, dark variant off (matches still 'light' fallback)", () => {
    expect(buildAdaptiveAlphaExpr([], "light", 100, 156)).toBe("1.000");
    expect(buildAdaptiveAlphaExpr([], "dark", 100, 156)).toBe("0.000");
  });

  it("single bucket — constant 0 or 1 depending on threshold", () => {
    const b: LuminanceBucket[] = [{ startMs: 0, endMs: 1000, avgLuma: 200 }];
    expect(buildAdaptiveAlphaExpr(b, "light", 100, 156)).toBe("1.000");
    expect(buildAdaptiveAlphaExpr(b, "dark", 100, 156)).toBe("0.000");
  });

  it("all buckets agree — single constant, no transition emitted", () => {
    const b: LuminanceBucket[] = [
      { startMs: 0, endMs: 500, avgLuma: 50 },
      { startMs: 500, endMs: 1000, avgLuma: 80 },
      { startMs: 1000, endMs: 1500, avgLuma: 60 },
    ];
    expect(buildAdaptiveAlphaExpr(b, "light", 100, 156)).toBe("0.000");
    expect(buildAdaptiveAlphaExpr(b, "dark", 100, 156)).toBe("1.000");
  });

  it("one transition — smoothstep centered on the bucket boundary", () => {
    const b: LuminanceBucket[] = [
      { startMs: 0, endMs: 1000, avgLuma: 50 }, // dark scene → light variant off
      { startMs: 1000, endMs: 2000, avgLuma: 200 }, // light scene → light variant on
    ];
    const lightExpr = buildAdaptiveAlphaExpr(b, "light", 100, 156, 0.4);
    // Boundary at 1.000s; crossfade 0.4s centered → smoothstep starts at 0.800.
    expect(lightExpr).toContain("min(1,max(0,(t-0.800)/0.400))");
    // Hold at 0 before, smoothstep transition adding +1, clamped.
    expect(lightExpr.startsWith("min(1,max(0,0.000+")).toBe(true);
    expect(lightExpr).toContain("(1.000*");
  });

  it("dark variant transitions are the negation of light variant transitions", () => {
    const b: LuminanceBucket[] = [
      { startMs: 0, endMs: 1000, avgLuma: 50 },
      { startMs: 1000, endMs: 2000, avgLuma: 200 },
    ];
    const darkExpr = buildAdaptiveAlphaExpr(b, "dark", 100, 156, 0.4);
    // Starts held at 1, transitions down by -1 across the boundary.
    expect(darkExpr.startsWith("min(1,max(0,1.000+")).toBe(true);
    expect(darkExpr).toContain("(-1.000*");
  });

  it("custom crossfade duration is honored", () => {
    const b: LuminanceBucket[] = [
      { startMs: 0, endMs: 1000, avgLuma: 50 },
      { startMs: 1000, endMs: 2000, avgLuma: 200 },
    ];
    // 200ms crossfade → starts at boundary - 100ms = 0.900s, dur 0.200s.
    const expr = buildAdaptiveAlphaExpr(b, "light", 100, 156, 0.2);
    expect(expr).toContain("(t-0.900)/0.200");
  });

  it("is deterministic — same input twice → byte-identical output", () => {
    const b: LuminanceBucket[] = [
      { startMs: 0, endMs: 500, avgLuma: 80 },
      { startMs: 500, endMs: 1000, avgLuma: 150 },
      { startMs: 1000, endMs: 1500, avgLuma: 180 },
    ];
    const a = buildAdaptiveAlphaExpr(b, "light", 100, 156);
    const b2 = buildAdaptiveAlphaExpr(b, "light", 100, 156);
    expect(a).toBe(b2);
  });
});

describe("buildEntranceExpr", () => {
  it("returns smoothstep formula u*u*(3-2u) for u over the entrance window", () => {
    const expr = buildEntranceExpr(0, 0.4);
    expect(expr).toContain("min(1,max(0,(t-0.000)/0.400))");
    expect(expr).toMatch(/\*\(3-2\*/);
  });

  it("returns 1 for zero duration (skipped entrance)", () => {
    expect(buildEntranceExpr(0, 0)).toBe("1");
    expect(buildEntranceExpr(2, -1)).toBe("1");
  });

  it("supports non-zero start time", () => {
    expect(buildEntranceExpr(1.5, 0.4)).toContain("(t-1.500)/0.400");
  });
});

describe("buildCornerStampM0", () => {
  it("produces a valid m0 string with one cell per overlay layer", () => {
    const r = buildCornerStampM0({
      canvasW: 1280,
      canvasH: 720,
      stampPx: 100,
      gutterPx: 24,
      overlayCount: 2,
    });
    expect(isValidM0String(r.m0)).toBe(true);
    const frames = parseM0StringToRenderFrames(r.m0, 1280, 720);
    // base + 2 overlay cells = 3 renderable frames
    expect(frames).toHaveLength(3);
  });

  it("places each overlay cell at the bottom-right at stampPx+gutterPx size", () => {
    const r = buildCornerStampM0({
      canvasW: 1280,
      canvasH: 720,
      stampPx: 100,
      gutterPx: 24,
      overlayCount: 1,
    });
    expect(r.cellW).toBe(124);
    expect(r.cellH).toBe(124);
    const frames = parseM0StringToRenderFrames(r.m0, 1280, 720);
    expect(frames).toHaveLength(2); // base + 1 cell
    // overlay frame: 124x124 at (1156, 596) — flush against bottom-right canvas edge
    expect(frames[1]!.width).toBe(124);
    expect(frames[1]!.height).toBe(124);
    expect(frames[1]!.x).toBe(1280 - 124);
    expect(frames[1]!.y).toBe(720 - 124);
  });

  it("returns inset = gutter / cellSide so the QR lands at natural pixel size", () => {
    const r = buildCornerStampM0({
      canvasW: 1280,
      canvasH: 720,
      stampPx: 100,
      gutterPx: 24,
      overlayCount: 1,
    });
    expect(r.insetRight).toBeCloseTo(24 / 124, 4);
    expect(r.insetBottom).toBeCloseTo(24 / 124, 4);
  });

  it("rejects non-positive overlayCount", () => {
    expect(() =>
      buildCornerStampM0({
        canvasW: 1280,
        canvasH: 720,
        stampPx: 100,
        gutterPx: 24,
        overlayCount: 0,
      }),
    ).toThrow(/overlayCount/);
    expect(() =>
      buildCornerStampM0({
        canvasW: 1280,
        canvasH: 720,
        stampPx: 100,
        gutterPx: 24,
        overlayCount: 1.5,
      }),
    ).toThrow(/overlayCount/);
  });

  it("clamps the cell to the canvas when stamp+gutter exceeds it", () => {
    const r = buildCornerStampM0({
      canvasW: 200,
      canvasH: 200,
      stampPx: 300, // intentionally too big
      gutterPx: 50,
      overlayCount: 1,
    });
    expect(r.cellW).toBe(200);
    expect(r.cellH).toBe(200);
    expect(isValidM0String(r.m0)).toBe(true);
  });
});

describe("composeAlpha", () => {
  it("clamps the product of its factors to [0, 1]", () => {
    const c = composeAlpha("0.5", "0.8");
    expect(c).toBe("min(1,max(0,0.5*0.8))");
  });

  it("drops `1` factors as they're no-ops", () => {
    const c = composeAlpha("1", "0.5", "1", "0.8");
    expect(c).toBe("min(1,max(0,0.5*0.8))");
  });

  it("returns `1` when all factors are dropped", () => {
    expect(composeAlpha()).toBe("1");
    expect(composeAlpha("1", "1")).toBe("1");
  });
});
