import {
  annularSectorPath,
  sectorCentroid,
  segmentsToAngles,
  MAX_SEGMENTS,
} from "./geometry";

describe("segmentsToAngles", () => {
  it("normalizes raw weights into cumulative clockwise spans", () => {
    const a = segmentsToAngles([75, 25]);
    expect(a).toEqual([
      { startDeg: 0, endDeg: 270, frac: 0.75 },
      { startDeg: 270, endDeg: 360, frac: 0.25 },
    ]);
  });

  it("splits an angular gap evenly off both ends of each span", () => {
    const a = segmentsToAngles([50, 50], { gapDeg: 4 });
    expect(a[0].startDeg).toBeCloseTo(2);
    expect(a[0].endDeg).toBeCloseTo(178);
    expect(a[1].startDeg).toBeCloseTo(182);
    expect(a[1].endDeg).toBeCloseTo(358);
  });

  it("tolerates zero-weight segments (degenerate spans, fractions intact)", () => {
    const a = segmentsToAngles([100, 0]);
    expect(a[1].startDeg).toBeCloseTo(360);
    expect(a[1].endDeg).toBeCloseTo(360);
    expect(a[1].frac).toBe(0);
  });

  it("fails fast on degenerate input", () => {
    expect(() => segmentsToAngles([])).toThrow();
    expect(() => segmentsToAngles([1, -2])).toThrow();
    expect(() => segmentsToAngles([0, 0])).toThrow();
    expect(() => segmentsToAngles([NaN, 1])).toThrow();
    expect(() => segmentsToAngles(Array(MAX_SEGMENTS + 1).fill(1))).toThrow();
    expect(() => segmentsToAngles([1, 1], { gapDeg: -1 })).toThrow();
  });
});

describe("annularSectorPath", () => {
  const base = { cx: 180, cy: 180, rOuter: 100, rInner: 60 };

  it("emits the outer arc, inner return leg, and closes (90° sector)", () => {
    const p = annularSectorPath({ ...base, startDeg: 0, endDeg: 90 });
    // 0° = 12 o'clock → (180, 80); 90° = 3 o'clock → (280, 180).
    expect(p).toBe(
      "M 180 80 A 100 100 0 0 1 280 180 L 240 180 A 60 60 0 0 0 180 120 Z",
    );
  });

  it("sets the large-arc flag for sweeps over 180° (the 75% segment)", () => {
    const p = annularSectorPath({ ...base, startDeg: 0, endDeg: 270 });
    expect(p).toContain("A 100 100 0 1 1"); // outer, large-arc CW
    expect(p).toContain("A 60 60 0 1 0"); //  inner, large-arc CCW return
  });

  it("splits a full circle into two half sectors in one path", () => {
    const p = annularSectorPath({ ...base, startDeg: 0, endDeg: 360 });
    const subpaths = p.split("M ").filter((s) => s.trim() !== "");
    expect(subpaths).toHaveLength(2);
    expect(p).not.toContain("A 100 100 0 1"); // no degenerate 360° arc
  });

  it("fails fast on invalid radii or sweep", () => {
    expect(() => annularSectorPath({ ...base, rInner: 100, startDeg: 0, endDeg: 90 })).toThrow();
    expect(() => annularSectorPath({ ...base, startDeg: 90, endDeg: 90 })).toThrow();
    expect(() => annularSectorPath({ ...base, rOuter: 0, startDeg: 0, endDeg: 90 })).toThrow();
  });
});

describe("sectorCentroid", () => {
  it("sits at mid-angle, mid-radius", () => {
    // 0..180° sweep → mid-angle 90° (3 o'clock), mid-radius 80.
    const c = sectorCentroid({ cx: 180, cy: 180, rOuter: 100, rInner: 60, startDeg: 0, endDeg: 180 });
    expect(c.x).toBeCloseTo(260, 0);
    expect(c.y).toBeCloseTo(180, 0);
  });

  it("is deterministic (0.1px rounding)", () => {
    const opts = { cx: 289, cy: 166, rOuter: 89, rInner: 57, startDeg: 270, endDeg: 360 };
    expect(sectorCentroid(opts)).toEqual(sectorCentroid(opts));
  });
});
