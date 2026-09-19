import { describe, expect, it } from "@jest/globals";
import { planSlots } from "./slotPlanner";

describe("planSlots — v1 spatial-primary", () => {
  it("a 5s 24fps clip with 64×36 cells and BCH(127,*) returns sensible plan", () => {
    const plan = planSlots({
      durationMs: 5000,
      fps: 24,
      cols: 64,
      rows: 36,
      codewordBits: 127,
    });
    expect(plan.count).toBe(1);
    expect(plan.framesPerSlot).toBe(120);
    expect(plan.startMs).toBe(0);
    // 64*36 = 2304 cells / 127 bits = 18 cells per bit
    expect(plan.repetition).toBe(18);
  });

  it("a 60s 30fps clip with 64×36 cells and BCH(255,*) returns 9 cells per bit", () => {
    const plan = planSlots({
      durationMs: 60_000,
      fps: 30,
      cols: 64,
      rows: 36,
      codewordBits: 255,
    });
    expect(plan.framesPerSlot).toBe(1800);
    // 2304 / 255 = 9.03 → 9
    expect(plan.repetition).toBe(9);
  });

  it("throws when clip has fewer than 4 frames", () => {
    expect(() =>
      planSlots({
        durationMs: 50, // 50ms × 24fps / 1000 = 1.2 → 1 frame
        fps: 24,
        cols: 64,
        rows: 36,
        codewordBits: 127,
      }),
    ).toThrow();
  });

  it("throws when codewordBits exceeds cellCount", () => {
    expect(() =>
      planSlots({
        durationMs: 5000,
        fps: 24,
        cols: 8,
        rows: 8,
        codewordBits: 127,
      }),
    ).toThrow();
  });

  it("respects minFrames override", () => {
    expect(() =>
      planSlots({
        durationMs: 200,
        fps: 24,
        cols: 16,
        rows: 9,
        codewordBits: 31,
        minFrames: 10,
      }),
    ).toThrow();
  });

  it("startMs is always 0 in v1", () => {
    const p = planSlots({
      durationMs: 30_000,
      fps: 30,
      cols: 64,
      rows: 36,
      codewordBits: 127,
    });
    expect(p.startMs).toBe(0);
  });
});
