import { SLOTH_TARGET_MS, SUMMARIZE_MAX_CHARS, SUMMARIZE_TARGET_MS, TEACH_MAX_CHARS, autoSpeed, computeTiming, resolveTier, stepNumberExpr, tierTiming } from "./timing";

describe("computeTiming — natural (recommendation)", () => {
  test("duration grows with step count (more tiles → longer recommendation)", () => {
    const few = computeTiming(4, 1).durationMs;
    const many = computeTiming(64, 1).durationMs;
    expect(many).toBeGreaterThan(few);
  });

  test("higher speed → shorter natural duration", () => {
    expect(computeTiming(20, 2).durationMs).toBeLessThan(
      computeTiming(20, 1).durationMs,
    );
  });

  test("deterministic", () => {
    expect(computeTiming(30, 1.25).durationMs).toBe(
      computeTiming(30, 1.25).durationMs,
    );
  });
});

describe("computeTiming — fit to output duration", () => {
  test("fits EXACTLY to the pinned duration regardless of step count", () => {
    expect(computeTiming(64, 1, 30000).durationMs).toBe(30000);
    expect(computeTiming(4, 1, 30000).durationMs).toBe(30000);
  });

  test("a dense walk pinned short still paints every step (last step starts before the end)", () => {
    const steps = 64;
    const t = computeTiming(steps, 1, 30000);
    const lastStart = t.stepStartSec(steps);
    // The final step must begin within the clip and leave room for its hold —
    // i.e. it is not truncated past the 30s end.
    expect(lastStart + t.stepDurSec).toBeLessThanOrEqual(30.0001);
    expect(lastStart).toBeGreaterThan(0);
  });

  test("a STRETCH (pin longer than natural) rescales uniformly — the transition : step ratio is preserved", () => {
    const nat = computeTiming(10, 1); // 10.4 s natural
    const fit = computeTiming(10, 1, 20000);
    expect(fit.transitionSec / fit.stepDurSec).toBeCloseTo(nat.transitionSec / nat.stepDurSec, 6);
    expect(fit.leadSec).toBeGreaterThan(0.5); // the lead stretched with the rest
  });

  test("a COMPRESSION (pin shorter than natural) keeps the lead and the closing hold ABSOLUTE — only the step pace squeezes (09-05)", () => {
    const fit = computeTiming(40, 1, 12000); // 37.4 s natural → 12 s
    expect(fit.durationMs).toBe(12000);
    expect(fit.leadSec).toBe(0.5);
    expect(fit.trailSec).toBe(0.9);
    expect(fit.leadSec + 40 * fit.stepDurSec + fit.trailSec).toBeCloseTo(12, 6);
    const hard = computeTiming(5150, 1, 20000); // the brand M pinned to 20 s
    expect(hard.trailSec).toBe(0.9); // the finished layout is still HELD
    expect(hard.stepStartSec(5150) + hard.stepDurSec).toBeLessThanOrEqual(20 - 0.9 + 1e-6);
  });

  test("lead/trail scale with the rest (steps fill the whole clip)", () => {
    const steps = 10;
    const t = computeTiming(steps, 1, 20000);
    const total = t.leadSec + steps * t.stepDurSec + t.trailSec;
    expect(total).toBeCloseTo(20, 4);
  });

  test("zero / negative target → natural duration (no fit)", () => {
    const nat = computeTiming(12, 1).durationMs;
    expect(computeTiming(12, 1, 0).durationMs).toBe(nat);
    expect(computeTiming(12, 1, -5).durationMs).toBe(nat);
  });

  test("deterministic under fit", () => {
    const a = computeTiming(50, 1, 30000);
    const b = computeTiming(50, 1, 30000);
    const fields = (t: typeof a) => ({
      stepCount: t.stepCount,
      stepDurSec: t.stepDurSec,
      transitionSec: t.transitionSec,
      leadSec: t.leadSec,
      trailSec: t.trailSec,
      durationMs: t.durationMs,
      lastStart: t.stepStartSec(t.stepCount),
    });
    expect(fields(a)).toEqual(fields(b));
  });
});

describe("stepNumberExpr", () => {
  test("clamps to [0, total] (step 0 = the lead) and floors", () => {
    const e = stepNumberExpr(computeTiming(8, 1), "Step ", " / 8");
    expect(e).toContain("min(8");
    expect(e).toContain("max(0"); // step 0 reachable during the lead
    expect(e.startsWith("Step ")).toBe(true);
    expect(e.endsWith(" / 8")).toBe(true);
  });
});

describe("autoSpeed — pacing follows the layout's size (founder direction 2026-09-05)", () => {
  test("a lesson-sized walk is read at 1× (up to 24 steps)", () => {
    expect(autoSpeed(1)).toBe(1);
    expect(autoSpeed(16)).toBe(1); // the 2×2 default
    expect(autoSpeed(24)).toBe(1);
  });
  test("then the square root of the step count over 24 — 4× the steps = 2× the speed", () => {
    expect(autoSpeed(96)).toBeCloseTo(2, 6);
    expect(autoSpeed(384)).toBeCloseTo(4, 6);
    expect(autoSpeed(2400)).toBeCloseTo(10, 6);
  });
  test("capped at 15× for the biggest layouts (a 5k-step brand mark assembles in minutes, not an hour)", () => {
    expect(autoSpeed(5400)).toBe(15);
    expect(autoSpeed(50000)).toBe(15);
    const natural = computeTiming(5150, autoSpeed(5150)).durationMs;
    expect(natural).toBeLessThan(6 * 60 * 1000);
    expect(natural).toBeGreaterThan(4 * 60 * 1000);
  });
  test("monotonic and deterministic", () => {
    let prev = 0;
    for (const n of [1, 10, 24, 25, 50, 100, 243, 500, 1000, 2000, 5000, 9000]) { const v = autoSpeed(n); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    expect(autoSpeed(243)).toBe(autoSpeed(243));
  });
});

describe("computeTiming — the natural length is a whole number of frames (nested children trim with -t, 09-05)", () => {
  test("snaps UP to the next frame and past that frame's end in ms", () => {
    for (const [steps, speed, fps] of [[883, 6.0656, 30], [16, 1.3, 30], [16, 1.30514, 30], [243, 3.18, 30], [61, 1, 25], [100, 2.2, 24], [5150, 15, 60]] as const) {
      const { durationMs } = computeTiming(steps, speed, undefined, fps);
      const frames = Math.round((durationMs * fps) / 1000); // what the parent renders
      expect(durationMs / 1000).toBeGreaterThanOrEqual(frames / fps); // every child frame ENDS inside the trim
      expect(Math.abs((durationMs * fps) / 1000 - frames)).toBeLessThan(0.1); // and it IS a whole frame count
    }
  });
  test("an already whole-frame length is untouched (the 15.8 s default = 474 frames)", () => {
    expect(computeTiming(16, 1, undefined, 30).durationMs).toBe(15800);
    expect(computeTiming(16, 1).durationMs).toBe(15800);
  });
  test("a pin is never snapped — it fits exactly", () => {
    expect(computeTiming(883, 6, 132417, 30).durationMs).toBe(132417);
  });
});

describe("pacing tiers (founder direction 2026-09-05): teach ≤ 400 chars · summarize ≤ 8,000 · sloth beyond", () => {
  test("resolveTier by character count, with an explicit override", () => {
    expect(resolveTier(16)).toBe("teach");
    expect(resolveTier(TEACH_MAX_CHARS)).toBe("teach");
    expect(resolveTier(TEACH_MAX_CHARS + 1)).toBe("summarize");
    expect(resolveTier(SUMMARIZE_MAX_CHARS)).toBe("summarize");
    expect(resolveTier(SUMMARIZE_MAX_CHARS + 1)).toBe("sloth");
    expect(resolveTier(16, "sloth")).toBe("sloth");
    expect(resolveTier(50000, "teach")).toBe("teach");
    expect(resolveTier(50000, "auto")).toBe("sloth");
  });
  test("teach = natural length, auto speed capped at 2×", () => {
    expect(tierTiming({ stepCount: 16, tier: "teach", fps: 30 }).durationMs).toBe(15800);
    expect(tierTiming({ stepCount: 243, tier: "teach", fps: 30 }).durationMs).toBe(computeTiming(243, 2).durationMs);
  });
  test("summarize / sloth fit the target with an ABSOLUTE lead and closing hold (only the per-step pace compresses)", () => {
    const s = tierTiming({ stepCount: 5150, tier: "summarize", fps: 30 });
    expect(s.durationMs).toBe(SUMMARIZE_TARGET_MS);
    expect(s.leadSec).toBe(0.5);
    expect(s.trailSec).toBeGreaterThanOrEqual(0.9);
    expect(s.stepDurSec * 5150 + s.leadSec + s.trailSec).toBeCloseTo(30, 3);
    const z = tierTiming({ stepCount: 5150, tier: "sloth", fps: 30 });
    expect(z.durationMs).toBe(SLOTH_TARGET_MS);
    expect(z.trailSec).toBeGreaterThanOrEqual(0.9);
    // A walk already shorter than the target keeps its natural length.
    expect(tierTiming({ stepCount: 16, tier: "summarize", fps: 30 }).durationMs).toBe(15800);
  });
  test("a pin, then an explicit speed, win over the tier", () => {
    expect(tierTiming({ stepCount: 5150, tier: "summarize", fps: 30, pinnedMs: 12000 }).durationMs).toBe(12000);
    expect(tierTiming({ stepCount: 5150, tier: "sloth", fps: 30, speedMultiplier: 2 }).durationMs).toBe(computeTiming(5150, 2, undefined, 30).durationMs);
  });
});
