import { subdivideForSweep, sweepInverseEase, MAX_SLIVERS } from "./anim";
import { segmentsToAngles } from "./geometry";

describe("subdivideForSweep", () => {
  it("subdivides spans into clockwise slivers tagged by segment", () => {
    const slivers = subdivideForSweep(segmentsToAngles([75, 25]));
    expect(slivers.length).toBeGreaterThan(2);
    expect(slivers.length).toBeLessThanOrEqual(MAX_SLIVERS);
    // monotonic clockwise leading edges
    for (let i = 1; i < slivers.length; i++) {
      expect(slivers[i].frac0).toBeGreaterThanOrEqual(slivers[i - 1].frac0 - 1e-9);
    }
    // every sliver maps to a real segment
    for (const s of slivers) expect([0, 1]).toContain(s.segIndex);
  });

  it("widens the pitch to honor maxSlivers", () => {
    const slivers = subdivideForSweep(segmentsToAngles([1]), { sliverDeg: 1, maxSlivers: 10 });
    expect(slivers.length).toBeLessThanOrEqual(10);
  });
});

describe("sweepInverseEase", () => {
  it("is the inverse of the easeOut quadratic", () => {
    // easeOut eased(t) = 1-(1-t)^2; inverse(p) = 1-sqrt(1-p)
    expect(sweepInverseEase("easeOut", 0)).toBeCloseTo(0, 6);
    expect(sweepInverseEase("easeOut", 1)).toBeCloseTo(1, 6);
    expect(sweepInverseEase("easeOut", 0.75)).toBeCloseTo(0.5, 6);
  });
  it("is identity for linear", () => {
    expect(sweepInverseEase("linear", 0.3)).toBeCloseTo(0.3, 6);
  });
});
