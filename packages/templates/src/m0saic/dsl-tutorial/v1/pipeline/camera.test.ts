import { focusExpr, buildCanvasCamera, autoCanvasZoom } from "./camera";
import { computeTiming } from "./timing";
import type { Step } from "./buildSteps";

function leaf(index: number, x: number, y: number, w: number, h: number): Step {
  return {
    eventType: "emitLeaf",
    index,
    rect: { x, y, width: w, height: h },
  } as unknown as Step;
}

describe("focusExpr", () => {
  test("no keyframes → centered", () => {
    expect(focusExpr([])).toBe("0.5");
  });

  test("single keyframe → constant value (no time dependence)", () => {
    expect(focusExpr([{ t: 1, v: 0.3 }])).toBe("0.30000");
  });

  test("multiple keyframes → smoothstep segments holding first/last", () => {
    const e = focusExpr([
      { t: 0, v: 0.2 },
      { t: 1, v: 0.8 },
    ]);
    expect(e).toContain("lt(t,0.00000)*(0.20000)"); // hold before first
    expect(e).toContain("(gte(t,0.00000)*lt(t,1.00000))*"); // gated segment
    expect(e).toContain("3-2*"); // smoothstep ease
    expect(e).toContain("gte(t,1.00000)*(0.80000)"); // holds last
  });

  test("gated segments, not nested ifs — parse depth stays flat per keyframe", () => {
    // ffmpeg's expression parser has a ~100 recursion budget; a nested if-else
    // chain consumes one level per keyframe and fails a dense (10×10 = 100+
    // leaf) walk at crop config. The gated-sum shape keeps per-segment depth
    // constant regardless of keyframe count.
    const keys = Array.from({ length: 300 }, (_v, i) => ({
      t: i * 0.04,
      v: (i % 10) / 10,
    }));
    const e = focusExpr(keys);
    expect(e).not.toContain("if(");
    let d = 0;
    let maxDepth = 0;
    for (const ch of e) {
      if (ch === "(") {
        d++;
        if (d > maxDepth) maxDepth = d;
      } else if (ch === ")") d--;
    }
    expect(maxDepth).toBeLessThanOrEqual(8);
  });

  test("deterministic", () => {
    const k = [
      { t: 0, v: 0.1 },
      { t: 0.5, v: 0.6 },
      { t: 1, v: 0.9 },
    ];
    expect(focusExpr(k)).toBe(focusExpr(k));
  });
});

describe("buildCanvasCamera", () => {
  const W = 1000;
  const H = 1000;
  // Top-left and top-right tiles → centers (0.25,0.25) and (0.75,0.25).
  const steps = [leaf(1, 0, 0, 500, 500), leaf(2, 500, 0, 500, 500)];
  const timing = computeTiming(2, 1);

  test("zoom <= 1 → undefined (canvas stays fit-to-panel)", () => {
    expect(buildCanvasCamera(steps, timing, W, H, 1)).toBeUndefined();
    expect(buildCanvasCamera(steps, timing, W, H, 0.5)).toBeUndefined();
  });

  test("no leaf steps → undefined", () => {
    expect(buildCanvasCamera([], timing, W, H, 2)).toBeUndefined();
  });

  test("zoom > 1 → animated focus exprs + a zoom that eases back out at the end", () => {
    const cam = buildCanvasCamera(steps, timing, W, H, 2);
    expect(cam).toBeDefined();
    // Zoom is a time-varying expr: holds at 2, then smoothsteps to 1 over the tail
    // (the final pull-back). The engine even-rounds the scale so the crop reinits.
    expect(typeof cam!.zoom).toBe("string");
    expect(cam!.zoom as string).toContain("2"); // the held zoom level
    expect(cam!.zoom as string).toContain("3-2*"); // smoothstep down to 1
    expect(cam!.focusX).toContain("gte(t,"); // pans horizontally over time (gated segments)
    expect(cam!.focusX).toContain("3-2*"); // eased (smoothstep)
  });

  test("a perfectly centered tile maps to focus 0.5 (and holds center on the pull-back)", () => {
    const cam = buildCanvasCamera([leaf(1, 250, 250, 500, 500)], timing, W, H, 2);
    expect(cam!.focusX).toContain("0.50000");
    expect(cam!.focusY).toContain("0.50000");
  });

  test("an edge tile clamps focus to stay in-bounds (never < 0), then pans to center", () => {
    // tile flush to the left edge, center fraction 0.1 → unclamped focus would be
    // negative; must clamp to 0. The final pull-back then pans toward 0.5.
    const cam = buildCanvasCamera([leaf(1, 0, 450, 200, 100)], timing, W, H, 2);
    expect(cam!.focusX).toContain("0.00000"); // the held edge-clamped focus
    expect(cam!.focusX).toContain("0.50000"); // pans to center on the pull-back
  });

  test("deterministic", () => {
    expect(JSON.stringify(buildCanvasCamera(steps, timing, W, H, 1.5))).toBe(
      JSON.stringify(buildCanvasCamera(steps, timing, W, H, 1.5))
    );
  });
});

describe("autoCanvasZoom (legibility-driven)", () => {
  const W = 1000;
  const H = 1000;
  // A roomy canvas panel.
  const cellW = 1400;
  const cellH = 700;

  function grid(n: number): Step[] {
    // n×n tiles, each 1/n of the layout.
    const out: Step[] = [];
    const s = 1000 / n;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        out.push(leaf(r * n + c + 1, c * s, r * s, s, s));
      }
    }
    return out;
  }

  test("sparse layout (2×2) → no zoom (tiles are already legible)", () => {
    expect(autoCanvasZoom(grid(2), W, H, cellW, cellH)).toBe(1);
  });

  test("dense layout (8×8) → zooms in past 1", () => {
    const z = autoCanvasZoom(grid(8), W, H, cellW, cellH);
    expect(z).toBeGreaterThan(1);
  });

  test("denser layout zooms more than a sparser one", () => {
    expect(autoCanvasZoom(grid(12), W, H, cellW, cellH)).toBeGreaterThan(
      autoCanvasZoom(grid(6), W, H, cellW, cellH)
    );
  });

  test("zoom is capped (pathologically dense stays bounded)", () => {
    expect(autoCanvasZoom(grid(40), W, H, cellW, cellH)).toBeLessThanOrEqual(4);
  });

  test("no leaves / degenerate sizes → 1", () => {
    expect(autoCanvasZoom([], W, H, cellW, cellH)).toBe(1);
    expect(autoCanvasZoom(grid(4), 0, H, cellW, cellH)).toBe(1);
    expect(autoCanvasZoom(grid(4), W, H, 0, 0)).toBe(1);
  });

  test("deterministic", () => {
    expect(autoCanvasZoom(grid(10), W, H, cellW, cellH)).toBe(
      autoCanvasZoom(grid(10), W, H, cellW, cellH)
    );
  });
});
