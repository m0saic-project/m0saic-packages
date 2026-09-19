import {
  segmentsToAngles,
  annularSectorPath,
  annularSectorBBox,
  sectorCentroid,
  MAX_SEGMENTS,
} from "./geometry";

describe("segmentsToAngles", () => {
  it("splits two weights into clockwise spans summing to 360", () => {
    const a = segmentsToAngles([75, 25]);
    expect(a).toHaveLength(2);
    expect(a[0].startDeg).toBe(0);
    expect(a[0].endDeg).toBeCloseTo(270, 5);
    expect(a[1].endDeg).toBeCloseTo(360, 5);
    expect(a[0].frac).toBeCloseTo(0.75, 5);
  });
  it("rejects empty / over-cap / negative input", () => {
    expect(() => segmentsToAngles([])).toThrow();
    expect(() => segmentsToAngles(new Array(MAX_SEGMENTS + 1).fill(1))).toThrow();
    expect(() => segmentsToAngles([1, -1])).toThrow();
  });
});

describe("annularSectorPath", () => {
  it("emits arc commands and closes", () => {
    const p = annularSectorPath({ cx: 100, cy: 100, rOuter: 90, rInner: 50, startDeg: 0, endDeg: 90 });
    expect(p).toContain("A ");
    expect(p.trim().endsWith("Z")).toBe(true);
  });
  it("splits a full ring into two arcs (single 360° arc is degenerate)", () => {
    const p = annularSectorPath({ cx: 100, cy: 100, rOuter: 90, rInner: 50, startDeg: 0, endDeg: 360 });
    expect((p.match(/M /g) || []).length).toBe(2);
  });
});

describe("annularSectorBBox — tight bounds", () => {
  it("a top-right quarter sector occupies only that quadrant, not the full circle", () => {
    // r=100 at (100,100). [0,90] sweeps top→right.
    const b = annularSectorBBox({ cx: 100, cy: 100, rOuter: 100, rInner: 60, startDeg: 0, endDeg: 90 });
    expect(b.minX).toBeCloseTo(100, 3); // never crosses to the left half
    expect(b.maxX).toBeCloseTo(200, 3); // reaches the right extreme (90°)
    expect(b.minY).toBeCloseTo(0, 3); // reaches the top extreme (0°, a corner)
    expect(b.maxY).toBeCloseTo(100, 3); // never dips below center
  });

  it("includes the cardinal the outer arc sweeps through", () => {
    // [45,135] sweeps through 90° (right extreme) → maxX must reach cx+rOuter.
    const b = annularSectorBBox({ cx: 100, cy: 100, rOuter: 100, rInner: 60, startDeg: 45, endDeg: 135 });
    expect(b.maxX).toBeCloseTo(200, 3);
  });

  it("a full ring bounds the whole circle", () => {
    const b = annularSectorBBox({ cx: 100, cy: 100, rOuter: 100, rInner: 60, startDeg: 0, endDeg: 360 });
    expect(b.minX).toBeCloseTo(0, 3);
    expect(b.minY).toBeCloseTo(0, 3);
    expect(b.maxX).toBeCloseTo(200, 3);
    expect(b.maxY).toBeCloseTo(200, 3);
  });

  it("a thin sliver's bbox is far smaller than the circle's", () => {
    const full = annularSectorBBox({ cx: 180, cy: 180, rOuter: 165, rInner: 105, startDeg: 0, endDeg: 360 });
    const fullArea = (full.maxX - full.minX) * (full.maxY - full.minY);
    const sliver = annularSectorBBox({ cx: 180, cy: 180, rOuter: 165, rInner: 105, startDeg: 0, endDeg: 12 });
    const slivArea = (sliver.maxX - sliver.minX) * (sliver.maxY - sliver.minY);
    expect(slivArea).toBeLessThan(fullArea * 0.35);
  });
});

describe("sectorCentroid", () => {
  it("sits at mid-angle, mid-radius", () => {
    const c = sectorCentroid({ cx: 100, cy: 100, rOuter: 100, rInner: 60, startDeg: 0, endDeg: 180 });
    // mid-angle 90° (right), mid-radius 80 → (180, 100)
    expect(c.x).toBeCloseTo(180, 1);
    expect(c.y).toBeCloseTo(100, 1);
  });
});
