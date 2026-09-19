import { buildCursorRects } from "./cursor";
import { buildSteps } from "./buildSteps";
import { computeTiming } from "./timing";

function cursorFor(m0: string, w = 1000, h = 600) {
  const { steps } = buildSteps(m0 as any, w, h);
  return buildCursorRects(steps, computeTiming(steps.length, 1), w, h);
}

describe("buildCursorRects", () => {
  test("emits enable-gated fractional rects with non-overlapping forward windows", () => {
    const rects = cursorFor("2(1,1)");
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      for (const v of [r.xFrac, r.yFrac, r.wFrac, r.hFrac]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1.0001);
      }
      expect(r.activeEndSec).toBeGreaterThan(r.activeStartSec);
    }
    // windows tile forward in time: each starts where the previous handed off.
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i].activeStartSec).toBeCloseTo(rects[i - 1].activeEndSec, 3);
    }
  });

  test("the root frame (full canvas) appears, then the first column (half width)", () => {
    const rects = cursorFor("2(1,1)");
    expect(rects.some((r) => Math.abs(r.wFrac - 1) < 1e-6)).toBe(true); // root frame
    expect(rects.some((r) => Math.abs(r.wFrac - 0.5) < 1e-6)).toBe(true); // first column
  });

  test("the cursor slides to the second column (xFrac 0.5) on the comma", () => {
    const rects = cursorFor("2(1,1)");
    expect(rects.some((r) => Math.abs(r.xFrac - 0.5) < 1e-6 && Math.abs(r.wFrac - 0.5) < 1e-6)).toBe(true);
  });

  test("consecutive identical positions collapse into one window", () => {
    const { steps } = buildSteps("2(1,1)" as any, 1000, 600);
    const timing = computeTiming(steps.length, 1);
    const rects = buildCursorRects(steps, timing, 1000, 600);
    // fewer distinct positions than steps (some steps don't move the cursor).
    expect(rects.length).toBeLessThanOrEqual(steps.length);
    // no two adjacent rects share the same bounds (they were collapsed).
    for (let i = 1; i < rects.length; i++) {
      const a = rects[i - 1];
      const b = rects[i];
      const same =
        Math.abs(a.xFrac - b.xFrac) < 1e-6 &&
        Math.abs(a.yFrac - b.yFrac) < 1e-6 &&
        Math.abs(a.wFrac - b.wFrac) < 1e-6 &&
        Math.abs(a.hFrac - b.hFrac) < 1e-6;
      expect(same).toBe(false);
    }
  });

  test("nested layout keeps all fractions in [0,1]", () => {
    const rects = cursorFor("2(3[1,1,1],2[1,1])");
    for (const r of rects) {
      for (const v of [r.xFrac, r.yFrac, r.wFrac, r.hFrac]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  test("deterministic", () => {
    expect(JSON.stringify(cursorFor("2(1,1)"))).toBe(JSON.stringify(cursorFor("2(1,1)")));
  });
});
