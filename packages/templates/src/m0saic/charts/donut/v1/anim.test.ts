import { segmentsToAngles } from "./geometry";
import {
  subdivideForSweep,
  sweepInverseEase,
  DEFAULT_SLIVER_DEG,
  MAX_SLIVERS,
} from "./anim";

describe("subdivideForSweep", () => {
  it("subdivides each segment into ~sliverDeg slices on one global schedule", () => {
    const slivers = subdivideForSweep(segmentsToAngles([75, 25]));
    // 270° → 23 slivers, 90° → 8 slivers at the 12° default.
    expect(slivers.length).toBe(
      Math.ceil(270 / DEFAULT_SLIVER_DEG) + Math.ceil(90 / DEFAULT_SLIVER_DEG),
    );
    // Monotonic clockwise: every sliver starts where sweep progress says.
    for (let i = 1; i < slivers.length; i++) {
      expect(slivers[i].frac0).toBeGreaterThan(slivers[i - 1].frac0);
    }
    // Segment indices partition the schedule in order.
    expect(slivers[0].segIndex).toBe(0);
    expect(slivers[slivers.length - 1].segIndex).toBe(1);
  });

  it("widens the pitch deterministically to respect maxSlivers", () => {
    const slivers = subdivideForSweep(segmentsToAngles([1, 1, 1, 1]), {
      sliverDeg: 1,
      maxSlivers: 12,
    });
    expect(slivers.length).toBeLessThanOrEqual(12 + 4); // per-segment ceil slack
  });

  it("skips zero-span segments", () => {
    const slivers = subdivideForSweep(segmentsToAngles([100, 0]));
    expect(slivers.every((s) => s.segIndex === 0)).toBe(true);
  });

  it("is deterministic", () => {
    const a = subdivideForSweep(segmentsToAngles([19, 10, 17, 22, 23, 8]));
    const b = subdivideForSweep(segmentsToAngles([19, 10, 17, 22, 23, 8]));
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(MAX_SLIVERS + 6); // per-segment ceil slack
  });
});

describe("sweepInverseEase", () => {
  it("is the exact inverse of the quadratic easeOut", () => {
    // easeOut: p = 1-(1-u)^2 — so u = inverse(p) must round-trip.
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const p = 1 - (1 - u) * (1 - u);
      expect(sweepInverseEase("easeOut", p)).toBeCloseTo(u, 10);
    }
  });

  it("clamps out-of-range progress", () => {
    expect(sweepInverseEase("easeOut", -0.5)).toBe(0);
    expect(sweepInverseEase("easeOut", 1.5)).toBe(1);
  });

  it("falls back to linear for the cubic easings", () => {
    expect(sweepInverseEase("smoothstep", 0.3)).toBe(0.3);
    expect(sweepInverseEase("easeInOut", 0.7)).toBe(0.7);
    expect(sweepInverseEase("linear", 0.42)).toBe(0.42);
  });
});
