import {
  buildBreathingAlphaExpr,
  buildLoopEnableExpr,
  buildProgressFillEnableExpr,
  buildPseudoRanks,
  buildShimmerEnableExpr,
} from "./expressions";

/** Every builder must emit a pure expression of `t` — no JS leakage. */
function expectCleanExpr(expr: string): void {
  expect(typeof expr).toBe("string");
  expect(expr.length).toBeGreaterThan(0);
  expect(expr).not.toMatch(/NaN|undefined|Infinity/);
  expect(expr).toContain("t");
}

const RANKS = [0, 0.25, 0.5, 0.75, 1];

describe("logo-animate expression builders", () => {
  it("buildLoopEnableExpr emits a clean loopable gate per rank", () => {
    for (const rank of RANKS) {
      expectCleanExpr(
        buildLoopEnableExpr(rank, {
          loopSec: 3.2,
          inEnd: 0.25,
          outStart: 0.75,
          feather: 0.02,
          fps: 30,
          startDelay: 0.1,
          endDelay: 0.2,
          easing: "smoothstep",
        }),
      );
    }
  });

  it("buildProgressFillEnableExpr animates by default and freezes on static progress", () => {
    const animated = buildProgressFillEnableExpr(0.5, {
      progressSec: 2,
      oneShot: false,
      feather: 0.02,
      fps: 30,
    });
    expectCleanExpr(animated);
    expect(animated.startsWith("gte(t,1/30)")).toBe(true);

    const frozen = buildProgressFillEnableExpr(0.5, {
      progress: 0.4,
      progressSec: 2,
      oneShot: false,
      feather: 0.02,
      fps: 30,
    });
    expect(frozen.startsWith("1*")).toBe(true);
    expect(frozen).toContain("0.4");
  });

  it("buildBreathingAlphaExpr emits a gated, clamped alpha", () => {
    for (const rank of RANKS) {
      const expr = buildBreathingAlphaExpr(rank, {
        baseMin: 0.18,
        baseMax: 0.32,
        basePulseSec: 1.6,
        shimmerSec: 1.2,
        shimmerWidth: 0.18,
        shimmerAmp: 0.75,
        feather: 0.02,
        fps: 30,
      });
      expectCleanExpr(expr);
      expect(expr.startsWith("gte(t,1/30)")).toBe(true);
    }
  });

  it("buildShimmerEnableExpr emits a wrap-aware band gate", () => {
    const expr = buildShimmerEnableExpr(0.5, {
      shimmerSec: 1.2,
      shimmerWidth: 0.18,
      feather: 0.02,
      fps: 30,
    });
    expectCleanExpr(expr);
    // Cyclic wrap: the band compares against p, p-1 and p+1.
    expect(expr).toContain(")-1)");
    expect(expr).toContain(")+1)");
  });

  it("buildPseudoRanks (re-export) stays seed-stable and normalized", () => {
    const tiles = [0, 1, 2, 3, 4].map((i) => ({ x: i, y: i, logicalIndex: i }));
    const a = buildPseudoRanks(tiles);
    const b = buildPseudoRanks(tiles);
    expect(a).toEqual(b);
    expect(Math.min(...a)).toBe(0);
    expect(Math.max(...a)).toBe(1);
  });
});
