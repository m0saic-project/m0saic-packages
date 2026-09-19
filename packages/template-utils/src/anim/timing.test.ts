import type { MosaicEngineContext } from "@m0saic/types";
import { DEFAULT_DURATION_MS } from "@m0saic/types";
import {
  computeTimeline,
  stepNumberExpr,
  resolvePinnedDurationMs,
  resolveOutputDurationMs,
  resolveWindow,
  DEFAULT_WINDOW_FRACTION,
  type Timeline,
} from "./timing";

/**
 * Field goldens captured from dsl-tutorial's `computeTiming`
 * (packages/templates/src/m0saic/dsl-tutorial/v1/pipeline/timing.ts) BEFORE
 * the F2 extraction (Seam A), at full double precision. `computeTimeline` at
 * the defaults must reproduce them EXACTLY (`toBe`, not `toBeCloseTo`) — the
 * Phase 3 wrapper swap is only render-identical if the floats are identical.
 */
const dump = (t: Timeline) => ({
  stepCount: t.stepCount,
  stepDurSec: t.stepDurSec,
  transitionSec: t.transitionSec,
  leadSec: t.leadSec,
  trailSec: t.trailSec,
  durationMs: t.durationMs,
  start1: t.stepStartSec(1),
  start5: t.stepStartSec(5),
  startLast: t.stepStartSec(t.stepCount),
  start0: t.stepStartSec(0), // i<1 clamps to step 1
});

describe("computeTimeline — field parity vs captured computeTiming goldens", () => {
  test("natural, 12 steps at speed 1", () => {
    expect(dump(computeTimeline({ stepCount: 12 }))).toEqual({
      stepCount: 12,
      stepDurSec: 0.9,
      transitionSec: 0.35,
      leadSec: 0.5,
      trailSec: 0.9,
      durationMs: 12200,
      start1: 0.5,
      start5: 4.0999999999999996,
      startLast: 10.4,
      start0: 0.5,
    });
  });

  test("dense walk pinned to 30s (64 steps)", () => {
    expect(dump(computeTimeline({ stepCount: 64, targetDurationMs: 30000 }))).toEqual({
      stepCount: 64,
      stepDurSec: 0.4576271186440678,
      transitionSec: 0.17796610169491522,
      leadSec: 0.25423728813559321,
      trailSec: 0.4576271186440678,
      durationMs: 30000,
      start1: 0.25423728813559321,
      start5: 2.0847457627118642,
      startLast: 29.084745762711862,
      start0: 0.25423728813559321,
    });
  });

  test("natural at speed 2 (20 steps)", () => {
    expect(dump(computeTimeline({ stepCount: 20, speedMultiplier: 2 }))).toEqual({
      stepCount: 20,
      stepDurSec: 0.45,
      transitionSec: 0.175,
      leadSec: 0.5,
      trailSec: 0.9,
      durationMs: 10400,
      start1: 0.5,
      start5: 2.2999999999999998,
      startLast: 9.0500000000000007,
      start0: 0.5,
    });
  });

  test("speed 1.5 pinned to 12s (8 steps)", () => {
    expect(
      dump(computeTimeline({ stepCount: 8, speedMultiplier: 1.5, targetDurationMs: 12000 })),
    ).toEqual({
      stepCount: 8,
      stepDurSec: 1.161290322580645,
      transitionSec: 0.45161290322580638,
      leadSec: 0.96774193548387089,
      trailSec: 1.7419354838709675,
      durationMs: 12000,
      start1: 0.96774193548387089,
      start5: 5.6129032258064511,
      startLast: 9.0967741935483861,
      start0: 0.96774193548387089,
    });
  });

  test("fractional step count rounds (7.4 → 7)", () => {
    const t = computeTimeline({ stepCount: 7.4 });
    expect(t.stepCount).toBe(7);
    expect(t.durationMs).toBe(7700);
    expect(t.stepStartSec(7)).toBe(5.9000000000000004);
  });
});

describe("computeTimeline — behavior (ported from dsl-tutorial timing.test.ts)", () => {
  test("duration grows with step count (more steps → longer recommendation)", () => {
    const few = computeTimeline({ stepCount: 4 }).durationMs;
    const many = computeTimeline({ stepCount: 64 }).durationMs;
    expect(many).toBeGreaterThan(few);
  });

  test("higher speed → shorter natural duration", () => {
    expect(computeTimeline({ stepCount: 20, speedMultiplier: 2 }).durationMs).toBeLessThan(
      computeTimeline({ stepCount: 20, speedMultiplier: 1 }).durationMs,
    );
  });

  test("fits EXACTLY to the pinned duration regardless of step count", () => {
    expect(computeTimeline({ stepCount: 64, targetDurationMs: 30000 }).durationMs).toBe(30000);
    expect(computeTimeline({ stepCount: 4, targetDurationMs: 30000 }).durationMs).toBe(30000);
  });

  test("a dense walk pinned short still shows every step (no truncation)", () => {
    const steps = 64;
    const t = computeTimeline({ stepCount: steps, targetDurationMs: 30000 });
    const lastStart = t.stepStartSec(steps);
    expect(lastStart + t.stepDurSec).toBeLessThanOrEqual(30.0001);
    expect(lastStart).toBeGreaterThan(0);
  });

  test("uniform rescale preserves the transition : step ratio", () => {
    const nat = computeTimeline({ stepCount: 40 });
    const fit = computeTimeline({ stepCount: 40, targetDurationMs: 12000 });
    expect(fit.transitionSec / fit.stepDurSec).toBeCloseTo(nat.transitionSec / nat.stepDurSec, 6);
  });

  test("lead/trail scale with the rest (steps fill the whole clip)", () => {
    const t = computeTimeline({ stepCount: 10, targetDurationMs: 20000 });
    expect(t.leadSec + 10 * t.stepDurSec + t.trailSec).toBeCloseTo(20, 4);
  });

  test("zero / negative target → natural duration (no fit)", () => {
    const nat = computeTimeline({ stepCount: 12 }).durationMs;
    expect(computeTimeline({ stepCount: 12, targetDurationMs: 0 }).durationMs).toBe(nat);
    expect(computeTimeline({ stepCount: 12, targetDurationMs: -5 }).durationMs).toBe(nat);
  });

  test("non-positive speed falls back to 1", () => {
    expect(computeTimeline({ stepCount: 12, speedMultiplier: 0 }).durationMs).toBe(
      computeTimeline({ stepCount: 12 }).durationMs,
    );
    expect(computeTimeline({ stepCount: 12, speedMultiplier: -2 }).durationMs).toBe(
      computeTimeline({ stepCount: 12 }).durationMs,
    );
  });

  test("deterministic under fit", () => {
    const a = computeTimeline({ stepCount: 50, targetDurationMs: 30000 });
    const b = computeTimeline({ stepCount: 50, targetDurationMs: 30000 });
    expect(dump(a)).toEqual(dump(b));
  });
});

describe("computeTimeline — generalization knobs (new surface)", () => {
  test("baseStepSec drives the per-step hold", () => {
    expect(computeTimeline({ stepCount: 10, baseStepSec: 1.2 }).stepDurSec).toBe(1.2);
  });

  test("lead/trail pads are overridable", () => {
    const t = computeTimeline({ stepCount: 10, leadSec: 0, trailSec: 0 });
    expect(t.leadSec).toBe(0);
    expect(t.trailSec).toBe(0);
    expect(t.stepStartSec(1)).toBe(0);
    expect(t.durationMs).toBe(9000);
  });

  test("transitionFrac / transitionMaxSec control the head cross-fade", () => {
    // frac binds: 0.9 * 0.1 = 0.09 < maxSec 10.
    expect(computeTimeline({ stepCount: 10, transitionFrac: 0.1, transitionMaxSec: 10 }).transitionSec).toBeCloseTo(0.09, 10);
    // cap binds: 0.9 * 0.45 = 0.405 > 0.2.
    expect(computeTimeline({ stepCount: 10, transitionMaxSec: 0.2 }).transitionSec).toBe(0.2);
  });
});

describe("stepNumberExpr", () => {
  test("golden parity vs dsl-tutorial (8 steps at speed 1)", () => {
    expect(stepNumberExpr(computeTimeline({ stepCount: 8 }), "Step ", " / 8")).toBe(
      "Step %{eif\\:min(8\\,max(0\\,1+(t-0.5000)/0.9000))\\:d} / 8",
    );
  });

  test("clamps to [0, total] (step 0 = the lead) and floors", () => {
    const e = stepNumberExpr(computeTimeline({ stepCount: 8 }), "Step ", " / 8");
    expect(e).toContain("min(8");
    expect(e).toContain("max(0"); // step 0 reachable during the lead
    expect(e.startsWith("Step ")).toBe(true);
    expect(e.endsWith(" / 8")).toBe(true);
  });
});

describe("resolvePinnedDurationMs", () => {
  const ctx = (userMs?: number, outMs?: number) =>
    ({
      userIntent: userMs != null ? { durationMs: userMs } : undefined,
      output: outMs != null ? { durationMs: outMs } : undefined,
    }) as unknown as MosaicEngineContext;

  test("explicit CLI userIntent wins over everything", () => {
    expect(resolvePinnedDurationMs(ctx(9000, 30000))).toBe(9000);
    expect(resolvePinnedDurationMs(ctx(9000, DEFAULT_DURATION_MS))).toBe(9000);
  });

  test("output.durationMs is NEVER a pin (Q1: hosts seed it from the template's own hints)", () => {
    // Pre-Q1 this read as a pin and stretched custom timing to fit the
    // hint (the gate-27 search-typing class).
    expect(resolvePinnedDurationMs(ctx(undefined, 30000))).toBeUndefined();
  });

  test("the bare engine default is NOT a pin", () => {
    expect(resolvePinnedDurationMs(ctx(undefined, DEFAULT_DURATION_MS))).toBeUndefined();
  });

  test("zero / missing output duration is NOT a pin", () => {
    expect(resolvePinnedDurationMs(ctx(undefined, 0))).toBeUndefined();
    expect(resolvePinnedDurationMs(ctx(undefined, undefined))).toBeUndefined();
    expect(resolvePinnedDurationMs({} as unknown as MosaicEngineContext)).toBeUndefined();
  });
});

describe("resolveOutputDurationMs (Q3 — the one duration-follow helper)", () => {
  const ctx = (userMs: number | undefined, targetMs: number) =>
    ({
      userIntent: userMs != null ? { durationMs: userMs } : undefined,
      target: { durationMs: targetMs },
    }) as unknown as MosaicEngineContext;

  test("L0: an explicit user ask wins over the natural follow", () => {
    expect(resolveOutputDurationMs(ctx(9000, 10000), { naturalMs: 183_000 })).toBe(9000);
  });

  test("unpinned: follows the natural length (rounded to integer ms)", () => {
    expect(resolveOutputDurationMs(ctx(undefined, 10000), { naturalMs: 183_000 })).toBe(183_000);
    expect(resolveOutputDurationMs(ctx(undefined, 10000), { naturalMs: 183_000.6 })).toBe(183_001);
  });

  test("invalid naturals are ignored — falls through to the render target", () => {
    expect(resolveOutputDurationMs(ctx(undefined, 10000), { naturalMs: 0 })).toBe(10000);
    expect(resolveOutputDurationMs(ctx(undefined, 10000), { naturalMs: -5 })).toBe(10000);
    expect(resolveOutputDurationMs(ctx(undefined, 10000), { naturalMs: NaN })).toBe(10000);
    expect(resolveOutputDurationMs(ctx(undefined, 10000), {})).toBe(10000);
    expect(resolveOutputDurationMs(ctx(undefined, 10000))).toBe(10000);
  });

  test("the target is a hint, never a pin: natural still wins over it unpinned", () => {
    // Pre-Q3 hand-rolls each re-derived this; the helper is the one spelling.
    expect(resolveOutputDurationMs(ctx(undefined, 10000), { naturalMs: 2000 })).toBe(2000);
  });
});

describe("resolveWindow", () => {
  const TEN_SEC = 10000;

  test("undefined window → canonical defaults (70% of the clip, easeOut)", () => {
    expect(resolveWindow(undefined, TEN_SEC)).toEqual({
      startSec: 0,
      durationSec: DEFAULT_WINDOW_FRACTION * 10,
      staggerSec: 0,
      ease: "easeOut",
    });
  });

  test("fraction resolves against the render duration", () => {
    expect(resolveWindow({ fraction: 0.5 }, TEN_SEC).durationSec).toBe(5);
  });

  test("ms overrides fraction", () => {
    expect(resolveWindow({ fraction: 0.2, ms: 1500 }, TEN_SEC).durationSec).toBe(1.5);
  });

  test("fraction clamps to [0,1]", () => {
    expect(resolveWindow({ fraction: 1.5 }, TEN_SEC).durationSec).toBe(10);
    expect(resolveWindow({ fraction: -1 }, TEN_SEC).durationSec).toBe(0);
  });

  test("delay and stagger convert to seconds (negatives clamp to 0)", () => {
    const r = resolveWindow({ delayMs: 250, staggerMs: 120 }, TEN_SEC);
    expect(r.startSec).toBe(0.25);
    expect(r.staggerSec).toBe(0.12);
    expect(resolveWindow({ delayMs: -100, staggerMs: -100 }, TEN_SEC)).toMatchObject({
      startSec: 0,
      staggerSec: 0,
    });
  });

  test("ease passes through", () => {
    expect(resolveWindow({ ease: "linear" }, TEN_SEC).ease).toBe("linear");
    expect(resolveWindow({ ease: "smoothstep" }, TEN_SEC).ease).toBe("smoothstep");
  });

  test("deterministic", () => {
    const win = { fraction: 0.4, delayMs: 100, staggerMs: 60, ease: "easeInOut" as const };
    expect(resolveWindow(win, TEN_SEC)).toEqual(resolveWindow(win, TEN_SEC));
  });
});
