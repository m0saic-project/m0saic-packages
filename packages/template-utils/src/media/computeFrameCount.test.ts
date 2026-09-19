import { computeFrameCount } from "./computeFrameCount";

describe("computeFrameCount", () => {
  it("returns N frames for an integer-duration / integer-fps pair", () => {
    expect(computeFrameCount({ durationMs: 1000, fps: 30 })).toEqual({
      count: 30,
      frameDurationMs: 1000 / 30,
    });
    expect(computeFrameCount({ durationMs: 5000, fps: 24 })).toEqual({
      count: 120,
      frameDurationMs: 1000 / 24,
    });
  });

  it("rounds — sub-frame remainders prefer one extra frame over truncation", () => {
    // 999ms @ 24fps → 23.976 → round to 24 (don't lose the final frame).
    expect(computeFrameCount({ durationMs: 999, fps: 24 }).count).toBe(24);
    // 100ms @ 30fps → 3.0 exactly → 3.
    expect(computeFrameCount({ durationMs: 100, fps: 30 }).count).toBe(3);
  });

  it("floors at 1 — zero or negative duration still yields one frame", () => {
    expect(computeFrameCount({ durationMs: 0, fps: 30 }).count).toBe(1);
    expect(computeFrameCount({ durationMs: -100, fps: 30 }).count).toBe(1);
  });

  it("caps at maxFrames when set", () => {
    expect(computeFrameCount({ durationMs: 60_000, fps: 30, maxFrames: 100 }).count).toBe(100);
    // Cap above natural is a no-op.
    expect(computeFrameCount({ durationMs: 1000, fps: 30, maxFrames: 100 }).count).toBe(30);
  });

  it("ignores maxFrames when zero/negative/non-finite", () => {
    expect(computeFrameCount({ durationMs: 1000, fps: 30, maxFrames: 0 }).count).toBe(30);
    expect(computeFrameCount({ durationMs: 1000, fps: 30, maxFrames: -5 }).count).toBe(30);
  });

  it("floors a fractional maxFrames", () => {
    expect(computeFrameCount({ durationMs: 1000, fps: 30, maxFrames: 5.9 }).count).toBe(5);
  });

  it("rejects non-positive fps", () => {
    expect(() => computeFrameCount({ durationMs: 1000, fps: 0 })).toThrow(/fps must be a positive number/);
    expect(() => computeFrameCount({ durationMs: 1000, fps: -30 })).toThrow(/fps must be a positive number/);
    expect(() => computeFrameCount({ durationMs: 1000, fps: NaN })).toThrow(/fps must be a positive number/);
  });

  it("returns the frame-duration alongside the count", () => {
    const r = computeFrameCount({ durationMs: 1000, fps: 60 });
    expect(r.frameDurationMs).toBeCloseTo(1000 / 60);
  });
});
