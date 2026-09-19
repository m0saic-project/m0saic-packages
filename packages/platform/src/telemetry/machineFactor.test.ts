import type { MosaicRenderRecord } from "@m0saic/types";
import { computeMachineFactor, computeMachineFactors } from "./machineFactor";

let seq = 0;
function rec(over: Partial<MosaicRenderRecord> = {}): MosaicRenderRecord {
  seq += 1;
  return {
    schemaVersion: 1,
    recordId: `r-${seq}`,
    surface: "cli",
    startedAt: "2026-07-18T00:00:00.000Z",
    finishedAt: "2026-07-18T00:00:10.000Z",
    elapsedMs: 10_000,
    ok: true,
    exitCode: 0,
    outcome: "ok",
    predictedMs: 5_000,
    costModelVersion: 3,
    commands: {
      total: 3,
      completed: 3,
      failed: 0,
      totalCommandMs: 10_000,
      maxCommandMs: 8_000,
    },
    errors: [],
    warningsCount: 0,
    ...over,
  };
}

describe("computeMachineFactor", () => {
  it("returns the median actual/predicted over qualifying records", () => {
    const records = [
      rec({ predictedMs: 5_000 }), // ratio 2.0
      rec({ predictedMs: 10_000 }), // ratio 1.0
      rec({ predictedMs: 20_000 }), // ratio 0.5
    ];
    expect(computeMachineFactor(records)).toBe(1.0);
  });

  it("below minSamples: neutral 1", () => {
    expect(computeMachineFactor([rec(), rec()])).toBe(1);
    expect(computeMachineFactor([])).toBe(1);
  });

  it("skips wrapped, failed, v1, missing-prediction, and sub-3s records", () => {
    const noise = [
      rec({ stampWrapped: true, predictedMs: 100 }), // wrap re-encode
      rec({ ok: false, outcome: "error_ffmpeg", predictedMs: 100 }),
      rec({ costModelVersion: undefined, predictedMs: 100 }),
      rec({ predictedMs: undefined }),
      rec({
        commands: { total: 1, completed: 1, failed: 0, totalCommandMs: 500, maxCommandMs: 500 },
      }), // sub-3s ffmpeg phase
    ];
    // Only the three clean records qualify → median of their ratio (2.0).
    const clean = [rec(), rec(), rec()]; // each 10000/5000 = 2.0
    expect(computeMachineFactor([...noise, ...clean])).toBe(2.0);
  });

  it("uses the ffmpeg-phase actual (totalCommandMs), not elapsedMs", () => {
    const records = [
      rec({ elapsedMs: 99_999 }),
      rec({ elapsedMs: 99_999 }),
      rec({ elapsedMs: 99_999 }),
    ];
    // totalCommandMs 10000 / predicted 5000 = 2.0 — elapsed is ignored.
    expect(computeMachineFactor(records)).toBe(2.0);
  });

  it("clamps pathological medians to [1/3, 3]", () => {
    const slow = [
      rec({ predictedMs: 100 }),
      rec({ predictedMs: 100 }),
      rec({ predictedMs: 100 }),
    ]; // ratios 100×
    expect(computeMachineFactor(slow)).toBe(3);
    const fast = [
      rec({ predictedMs: 1_000_000 }),
      rec({ predictedMs: 1_000_000 }),
      rec({ predictedMs: 1_000_000 }),
    ];
    expect(computeMachineFactor(fast)).toBeCloseTo(1 / 3, 5);
  });

  it("windows to the newest N records (newest-first input order)", () => {
    // 12 newest at ratio 1.0, older tail at ratio 3.0 — tail must not count.
    const newest = Array.from({ length: 12 }, () => rec({ predictedMs: 10_000 }));
    const tail = Array.from({ length: 10 }, () => rec({ predictedMs: 3_333 }));
    expect(computeMachineFactor([...newest, ...tail])).toBe(1.0);
  });
});


describe("computeMachineFactors (two-factor, v3)", () => {
  const split = (setup: number, slope: number, actual: number) =>
    rec({
      predictedSetupUnits: setup,
      predictedSlopeUnits: slope,
      commands: { total: 3, completed: 3, failed: 0, totalCommandMs: actual, maxCommandMs: actual },
    });

  it("recovers known factors from a mixed window (least squares)", () => {
    // Ground truth: setupFactor 5, slopeFactor 1.2 — the laptop profile.
    const rows = [
      split(1000, 9000, 5 * 1000 + 1.2 * 9000),
      split(8000, 2000, 5 * 8000 + 1.2 * 2000),
      split(3000, 5000, 5 * 3000 + 1.2 * 5000),
      split(500, 12000, 5 * 500 + 1.2 * 12000),
    ];
    const f = computeMachineFactors(rows);
    expect(f.setupFactor).toBeCloseTo(5, 3);
    expect(f.slopeFactor).toBeCloseTo(1.2, 3);
  });

  it("falls back to the scalar-for-both when split records are scarce", () => {
    // Only scalar-era records (no split fields): both factors = rolling median.
    const rows = [
      rec({ predictedMs: 1000, commands: { total: 1, completed: 1, failed: 0, totalCommandMs: 4000, maxCommandMs: 4000 } }),
      rec({ predictedMs: 1000, commands: { total: 1, completed: 1, failed: 0, totalCommandMs: 4000, maxCommandMs: 4000 } }),
      rec({ predictedMs: 1000, commands: { total: 1, completed: 1, failed: 0, totalCommandMs: 4000, maxCommandMs: 4000 } }),
    ];
    const f = computeMachineFactors(rows);
    expect(f.setupFactor).toBe(f.slopeFactor);
    expect(f.setupFactor).toBeCloseTo(3, 5); // clamped median 4000/1000 → CLAMP_MAX 3
  });

  it("degenerate window (identical setup/slope mix) falls back to scalar-for-both", () => {
    // Every render the same shape → the two factors are not separable.
    const rows = [
      split(1000, 4000, 12000),
      split(1000, 4000, 12000),
      split(1000, 4000, 12000),
      split(1000, 4000, 12000),
    ];
    const f = computeMachineFactors(rows);
    expect(f.setupFactor).toBe(f.slopeFactor);
  });

  it("clamps: setup to [1/3, 8], slope to [1/3, 3]", () => {
    const rows = [
      split(1000, 9000, 50 * 1000 + 0.01 * 9000),
      split(8000, 2000, 50 * 8000 + 0.01 * 2000),
      split(3000, 5000, 50 * 3000 + 0.01 * 5000),
      split(500, 12000, 50 * 500 + 0.01 * 12000),
    ];
    const f = computeMachineFactors(rows);
    expect(f.setupFactor).toBe(8);
    expect(f.slopeFactor).toBeCloseTo(1 / 3, 5);
  });

  it("skips wrapped / failed / pre-v3 records", () => {
    const good = [
      split(1000, 9000, 2 * 1000 + 1.5 * 9000),
      split(8000, 2000, 2 * 8000 + 1.5 * 2000),
      split(3000, 5000, 2 * 3000 + 1.5 * 5000),
    ];
    const noise = [
      { ...split(100, 100, 99999), ok: false },
      { ...split(100, 100, 99999), stampWrapped: true },
      { ...split(100, 100, 99999), costModelVersion: 2 },
    ];
    const f = computeMachineFactors([...noise, ...good]);
    expect(f.setupFactor).toBeCloseTo(2, 3);
    expect(f.slopeFactor).toBeCloseTo(1.5, 3);
  });
});
