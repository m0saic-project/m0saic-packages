/**
 * Behavior locks for the hoisted polyline kit (ex line-chart geometry.ts) —
 * path shapes, curve flattening, dash marks, slivers, bboxes, determinism.
 */

import {
  areaPolygonPath,
  buildDashMarks,
  buildSweepSlivers,
  curvePolyline,
  local,
  markerPath,
  polylineStrokeBBox,
  polylineStrokePath,
  rectPath,
  ribbonQuadPath,
  vertexFractions,
  type Pt,
} from "./polyline";

const LINE: Pt[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
];

describe("path builders", () => {
  it("rectPath emits a closed axis-aligned rectangle", () => {
    expect(rectPath(1, 2, 10, 5)).toBe("M 1 2 L 11 2 L 11 7 L 1 7 Z");
  });

  it("ribbonQuadPath strokes a horizontal segment symmetrically", () => {
    expect(ribbonQuadPath({ x: 0, y: 10 }, { x: 20, y: 10 }, 4)).toBe("M 0 12 L 20 12 L 20 8 L 0 8 Z");
  });

  it("markerPath covers circle / square / diamond", () => {
    expect(markerPath({ x: 5, y: 5 }, 2, "square")).toBe(rectPath(3, 3, 4, 4));
    expect(markerPath({ x: 5, y: 5 }, 2, "diamond")).toContain("M 5 3");
    expect(markerPath({ x: 5, y: 5 }, 2, "circle")).toContain("a 2 2");
  });

  it("areaPolygonPath closes down to the baseline", () => {
    const p = areaPolygonPath(LINE, 80);
    expect(p.startsWith("M 0 0")).toBe(true);
    expect(p).toContain("L 100 80");
    expect(p).toContain("L 0 80");
    expect(p.endsWith("Z")).toBe(true);
  });

  it("local shifts into a cell frame", () => {
    expect(local({ x: 10, y: 20 }, 3, 4)).toEqual({ x: 7, y: 16 });
  });
});

describe("curvePolyline", () => {
  it("linear passes points through with arc-length vertex fracs", () => {
    const { poly, vertexFracs } = curvePolyline(LINE, "linear");
    expect(poly).toEqual(LINE);
    expect(vertexFracs[0]).toBe(0);
    expect(vertexFracs[vertexFracs.length - 1]).toBeCloseTo(1);
  });

  it("stepped holds then jumps (2n-1 points)", () => {
    const { poly } = curvePolyline(LINE, "stepped");
    expect(poly).toHaveLength(5);
    expect(poly[1]).toEqual({ x: 100, y: 0 }); // hold at y of previous
  });

  it("smooth passes through every original point, densely sampled", () => {
    const { poly, vertexFracs } = curvePolyline(LINE, "smooth");
    expect(poly.length).toBeGreaterThan(LINE.length * 10);
    for (const p of LINE) {
      expect(poly.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6)).toBe(true);
    }
    expect(vertexFracs).toHaveLength(LINE.length);
    for (let i = 1; i < vertexFracs.length; i++) expect(vertexFracs[i]).toBeGreaterThan(vertexFracs[i - 1]);
  });
});

describe("dash marks + slivers", () => {
  it("dotted marks are dots; dashed marks are short ribbons; fracs ascend", () => {
    const dots = buildDashMarks(LINE, 2, "dotted");
    expect(dots.length).toBeGreaterThan(3);
    expect(dots.every((m) => m.isDot && m.a === m.b)).toBe(true);
    const dashes = buildDashMarks(LINE, 2, "dashed");
    expect(dashes.every((m) => !m.isDot)).toBe(true);
    for (let i = 1; i < dashes.length; i++) expect(dashes[i].frac0).toBeGreaterThan(dashes[i - 1].frac0);
  });

  it("maxMarks caps the count by widening the period", () => {
    expect(buildDashMarks(LINE, 1, "dotted", { maxMarks: 5 }).length).toBeLessThanOrEqual(6);
  });

  it("sweep slivers respect the cap and cover the full arc", () => {
    const slivers = buildSweepSlivers(LINE, 2, { sliverPx: 10, maxSlivers: 8 });
    expect(slivers.length).toBeLessThanOrEqual(8 + 2);
    expect(slivers[0].frac0).toBe(0);
    const last = slivers[slivers.length - 1];
    expect(last.b).toEqual(LINE[LINE.length - 1]);
  });
});

describe("bboxes + determinism", () => {
  it("polylineStrokeBBox inflates by the half stroke", () => {
    const b = polylineStrokeBBox(LINE, 4);
    expect(b.minY).toBe(-2);
    expect(b.maxX).toBe(102);
  });

  it("vertexFractions spans [0, 1]", () => {
    const f = vertexFractions(LINE);
    expect(f[0]).toBe(0);
    expect(f[f.length - 1]).toBeCloseTo(1);
  });

  it("everything is deterministic", () => {
    const once = JSON.stringify({
      p: polylineStrokePath(LINE, 3),
      c: curvePolyline(LINE, "smooth"),
      d: buildDashMarks(LINE, 2, "dashed"),
      s: buildSweepSlivers(LINE, 2),
    });
    const twice = JSON.stringify({
      p: polylineStrokePath(LINE, 3),
      c: curvePolyline(LINE, "smooth"),
      d: buildDashMarks(LINE, 2, "dashed"),
      s: buildSweepSlivers(LINE, 2),
    });
    expect(twice).toBe(once);
  });
});
