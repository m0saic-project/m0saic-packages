import {
  DEFAULT_DURATION_MS,
  DEFAULT_FPS,
  MIN_FPS,
  MAX_FPS,
  DEFAULT_PLAY_SPEED,
  MIN_PLAY_SPEED,
  MAX_PLAY_SPEED,
} from "./timing";

describe("timing defaults", () => {
  it("fps defaults sit inside the clamp range", () => {
    expect(MIN_FPS).toBeLessThan(DEFAULT_FPS);
    expect(DEFAULT_FPS).toBeLessThan(MAX_FPS);
  });

  it("durationMs default is a positive integer", () => {
    expect(Number.isInteger(DEFAULT_DURATION_MS)).toBe(true);
    expect(DEFAULT_DURATION_MS).toBeGreaterThan(0);
  });

  it("playSpeed default is realtime, inside the clamp range", () => {
    expect(DEFAULT_PLAY_SPEED).toBe(1);
    expect(MIN_PLAY_SPEED).toBeLessThan(DEFAULT_PLAY_SPEED);
    expect(DEFAULT_PLAY_SPEED).toBeLessThan(MAX_PLAY_SPEED);
  });

  it("playSpeed clamp range keeps the atempo decomposition ≤ 4 stages", () => {
    // Each ffmpeg atempo instance accepts 0.5–2.0; ±10× needs at most
    // three full-step stages plus one residual.
    expect(MAX_PLAY_SPEED).toBeLessThanOrEqual(2 ** 4);
    expect(MIN_PLAY_SPEED).toBeGreaterThanOrEqual(0.5 ** 4);
  });
});
