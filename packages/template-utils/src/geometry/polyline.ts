/**
 * ============================================================================
 * Polyline geometry kit (SVG path builders for masks)
 * ============================================================================
 *
 * Pure path-string builders for stroked-polyline rendering: ribbon quads,
 * curve flattening (Catmull-Rom / stepped), dash/dot marks, area polygons,
 * point markers, sweep slivers, and their bboxes. Every shape is a FILLED
 * path used as an inline-mask on a color tile (engine masks are fill-only).
 * Paths are authored in absolute px against the caller's bounds rect; use
 * {@link local} to shift into a cell-local frame.
 *
 * Hoisted verbatim from `@m0saic/charts/line-chart/v1/geometry.ts`
 * (2026-08-18) so other packs (mermaid edges) can reuse the math without a
 * cross-pack template import; the line-chart re-exports thinly and stays
 * byte-identical. No m0saic types, no rendering — just math → path strings.
 * ============================================================================
 */

/** 2D point (canvas px). Structurally matches every pack-local `Pt`. */
export type Pt = { x: number; y: number };
/** Polyline flattening mode (the line-chart vocabulary, hoisted with the kit). */
export type Curve = "linear" | "smooth" | "stepped";

const n = (v: number) => Math.round(v * 100) / 100;

/** Axis-aligned bounding box in canvas px. */
export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

/** BBox of a stroked ribbon segment (the 4 quad corners). */
export function ribbonQuadBBox(p0: Pt, p1: Pt, strokeWidth: number): BBox {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const hw = strokeWidth / 2;
  const px = (-dy / len) * hw;
  const py = (dx / len) * hw;
  const xs = [p0.x + px, p1.x + px, p1.x - px, p0.x - px];
  const ys = [p0.y + py, p1.y + py, p1.y - py, p0.y - py];
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** BBox of a point marker of radius r. */
export function markerBBox(p: Pt, r: number): BBox {
  return { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r };
}

/**
 * The ENTIRE stroked polyline as ONE filled path (concatenated segment quads).
 * Used when there's no draw-on animation (reduceMotion): the whole line renders
 * from a single tight rect instead of dozens of sliver overlays.
 */
export function polylineStrokePath(points: Pt[], strokeWidth: number): string {
  const subs: string[] = [];
  for (let i = 0; i < points.length - 1; i++) subs.push(ribbonQuadPath(points[i], points[i + 1], strokeWidth));
  return subs.join(" ");
}

/** BBox of the whole stroked polyline (union of its segment quad bboxes). */
export function polylineStrokeBBox(points: Pt[], strokeWidth: number): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const b = ribbonQuadBBox(points[i], points[i + 1], strokeWidth);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Curve flattening — `smooth` / `stepped` become a DENSE polyline so every
// downstream builder (slivers, dash marks, area, sweep) stays unchanged. The
// returned `vertexFracs` are the arc-length fractions of the ORIGINAL data
// points along the flattened path, so point-marker reveals still land on the
// real vertices.
// ---------------------------------------------------------------------------

function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/** Arc-length fractions [0..1] at the given indices into `poly`. */
function fracsAtIndices(poly: Pt[], idxs: number[]): number[] {
  const cum: number[] = [0];
  let total = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    total += Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
    cum.push(total);
  }
  const denom = total || 1;
  return idxs.map((i) => cum[i] / denom);
}

const SMOOTH_SAMPLES = 16;

/**
 * Flatten the data points into the polyline the line/area actually trace, per
 * `curve`. linear → the points; stepped → step-after (hold then jump); smooth →
 * a Catmull-Rom spline through the points, sampled densely.
 */
export function curvePolyline(points: Pt[], curve: Curve): { poly: Pt[]; vertexFracs: number[] } {
  if (points.length < 2 || curve === "linear") {
    return { poly: points, vertexFracs: vertexFractions(points) };
  }
  if (curve === "stepped") {
    const poly: Pt[] = [points[0]];
    const vertexIdx: number[] = [0];
    for (let i = 0; i < points.length - 1; i++) {
      poly.push({ x: points[i + 1].x, y: points[i].y }); // horizontal hold
      poly.push(points[i + 1]); //                          then vertical jump
      vertexIdx.push(poly.length - 1);
    }
    return { poly, vertexFracs: fracsAtIndices(poly, vertexIdx) };
  }
  // smooth (Catmull-Rom): passes through every original point.
  const poly: Pt[] = [points[0]];
  const vertexIdx: number[] = [0];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    for (let s = 1; s <= SMOOTH_SAMPLES; s++) poly.push(catmullRom(p0, p1, p2, p3, s / SMOOTH_SAMPLES));
    vertexIdx.push(poly.length - 1); // sample at t=1 === p2 (the original point)
  }
  return { poly, vertexFracs: fracsAtIndices(poly, vertexIdx) };
}

// ---------------------------------------------------------------------------
// Dashed / dotted line marks — masks are fill-only, so a dashed/dotted line is
// a row of filled dash quads / dots spaced along the polyline arc-length. Each
// mark carries its arc-length fraction so the draw-on can reveal it in order.
// ---------------------------------------------------------------------------

export type DashMark = {
  a: Pt;
  /** For a dash, the segment end; for a dot, equal to `a`. */
  b: Pt;
  isDot: boolean;
  frac0: number;
};

/** Point at arc-length `d` along the polyline. */
function pointAtArcLen(points: Pt[], segLen: number[], d: number): Pt {
  let acc = 0;
  for (let i = 0; i < segLen.length; i++) {
    if (acc + segLen[i] >= d) {
      const t = (d - acc) / (segLen[i] || 1);
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    acc += segLen[i];
  }
  return points[points.length - 1];
}

/**
 * Dash / dot marks along the polyline. `dashed` = short ribbon segments with
 * gaps; `dotted` = evenly-spaced dots. `maxMarks` caps the count (overlay-depth
 * guard when animated; subpath budget when flattened).
 */
export function buildDashMarks(points: Pt[], strokeWidth: number, style: "dashed" | "dotted", opts: { maxMarks?: number } = {}): DashMark[] {
  if (points.length < 2) return [];
  const segLen = segmentLengths(points);
  const total = segLen.reduce((a, b) => a + b, 0) || 1;
  const sw = Math.max(1, strokeWidth);
  const dotted = style === "dotted";
  let period = dotted ? sw * 2.6 : sw * 7;
  const maxMarks = opts.maxMarks ?? 120;
  if (total / period > maxMarks) period = total / maxMarks;
  const on = dotted ? 0 : Math.min(period * 0.5, sw * 3.5);

  const marks: DashMark[] = [];
  for (let dist = 0; dist < total - 1e-6; dist += period) {
    if (dotted) {
      const c = pointAtArcLen(points, segLen, Math.min(dist, total));
      marks.push({ a: c, b: c, isDot: true, frac0: dist / total });
    } else {
      const a = pointAtArcLen(points, segLen, dist);
      const b = pointAtArcLen(points, segLen, Math.min(dist + on, total));
      marks.push({ a, b, isDot: false, frac0: dist / total });
    }
  }
  return marks;
}

const dotRadiusOf = (strokeWidth: number) => Math.max(1, strokeWidth) * 0.9;

/** Filled mask path for one dash/dot mark, in cell-local coords. */
export function dashMarkPath(m: DashMark, strokeWidth: number, ox: number, oy: number): string {
  return m.isDot
    ? markerPath(local(m.a, ox, oy), dotRadiusOf(strokeWidth), "circle")
    : ribbonQuadPath(local(m.a, ox, oy), local(m.b, ox, oy), Math.max(1, strokeWidth));
}

/** BBox of one dash/dot mark. */
export function dashMarkBBox(m: DashMark, strokeWidth: number): BBox {
  return m.isDot ? markerBBox(m.a, dotRadiusOf(strokeWidth)) : ribbonQuadBBox(m.a, m.b, Math.max(1, strokeWidth));
}

/** Union bbox of all dash/dot marks. */
export function dashMarksBBox(marks: DashMark[], strokeWidth: number): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of marks) {
    const b = dashMarkBBox(m, strokeWidth);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
}

/** BBox of the closed area polygon (line down to its baseline). */
export function areaBBox(points: Pt[], baselineY: number): BBox {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y).concat(baselineY);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Translate a point into a cell-local frame (subtract the cell origin). */
export const local = (p: Pt, ox: number, oy: number): Pt => ({ x: p.x - ox, y: p.y - oy });

/** Axis-aligned filled rectangle (gridline / axis / tick / legend swatch). */
export function rectPath(x: number, y: number, w: number, h: number): string {
  return `M ${n(x)} ${n(y)} L ${n(x + w)} ${n(y)} L ${n(x + w)} ${n(y + h)} L ${n(x)} ${n(y + h)} Z`;
}

/** A filled ribbon quad (a stroked segment) from p0→p1 with the given stroke width. */
export function ribbonQuadPath(p0: Pt, p1: Pt, strokeWidth: number): string {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const hw = strokeWidth / 2;
  // unit perpendicular
  const px = (-dy / len) * hw;
  const py = (dx / len) * hw;
  return (
    `M ${n(p0.x + px)} ${n(p0.y + py)} ` +
    `L ${n(p1.x + px)} ${n(p1.y + py)} ` +
    `L ${n(p1.x - px)} ${n(p1.y - py)} ` +
    `L ${n(p0.x - px)} ${n(p0.y - py)} Z`
  );
}

/** Marker path for a point: circle (two arcs), square, or diamond. */
export function markerPath(p: Pt, r: number, shape: "circle" | "square" | "diamond"): string {
  if (shape === "square") {
    return rectPath(p.x - r, p.y - r, r * 2, r * 2);
  }
  if (shape === "diamond") {
    return `M ${n(p.x)} ${n(p.y - r)} L ${n(p.x + r)} ${n(p.y)} L ${n(p.x)} ${n(p.y + r)} L ${n(p.x - r)} ${n(p.y)} Z`;
  }
  // circle: two semicircle arcs
  return `M ${n(p.x - r)} ${n(p.y)} a ${r} ${r} 0 1 0 ${n(r * 2)} 0 a ${r} ${r} 0 1 0 ${n(-r * 2)} 0 Z`;
}

/** Closed area polygon under a polyline down to a baseline y. */
export function areaPolygonPath(points: Pt[], baselineY: number): string {
  if (points.length === 0) return "";
  const top = points.map((p, i) => `${i === 0 ? "M" : "L"} ${n(p.x)} ${n(p.y)}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  return `${top} L ${n(last.x)} ${n(baselineY)} L ${n(first.x)} ${n(baselineY)} Z`;
}

// ---------------------------------------------------------------------------
// Sweep slivers — subdivide a polyline into many short ribbons for a draw-on.
// ---------------------------------------------------------------------------

export type Sliver = {
  /** Segment endpoints (canvas px) — the caller builds a cell-local mask path. */
  a: Pt;
  b: Pt;
  /** Arc-length fraction [0..1] of this sliver's LEADING edge along the line. */
  frac0: number;
};

export type SweepOpts = {
  /** Target sliver length in px (smaller ⇒ smoother draw, more layers). */
  sliverPx?: number;
  /** Hard cap on total slivers (overlay-stack depth / perf guard). */
  maxSlivers?: number;
};

const DEFAULT_SLIVER_PX = 26;
const DEFAULT_MAX_SLIVERS = 44;

/** Per-vertex arc-length fractions (used to time point-marker reveals). */
export function vertexFractions(points: Pt[]): number[] {
  const segLen = segmentLengths(points);
  const total = segLen.reduce((a, b) => a + b, 0) || 1;
  const out: number[] = [0];
  let acc = 0;
  for (const l of segLen) {
    acc += l;
    out.push(acc / total);
  }
  return out;
}

function segmentLengths(points: Pt[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push(Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y));
  }
  return out;
}

/**
 * Subdivide a polyline into ribbon slivers for a left→right draw-on. Slivers
 * never span a vertex (so consecutive ribbons within a segment stay collinear
 * and align seamlessly; vertices are covered by point markers). Each sliver
 * carries its arc-length fraction so the caller can schedule cascade timing.
 */
export function buildSweepSlivers(points: Pt[], strokeWidth: number, opts: SweepOpts = {}): Sliver[] {
  if (points.length < 2) return [];
  const segLen = segmentLengths(points);
  const total = segLen.reduce((a, b) => a + b, 0) || 1;
  const maxSlivers = opts.maxSlivers ?? DEFAULT_MAX_SLIVERS;
  let sliverPx = opts.sliverPx ?? DEFAULT_SLIVER_PX;
  // Widen the pitch deterministically if we'd exceed the cap.
  if (total / sliverPx > maxSlivers) sliverPx = total / maxSlivers;

  const slivers: Sliver[] = [];

  // DENSE polyline (more segments than the cap — e.g. a flattened smooth curve):
  // per-segment subdivision would emit ≥1 sliver PER segment and blow past the
  // cap, leaving fade windows too short to overlap (the draw-on looks serrated).
  // Walk EVEN arc-length chords instead — exactly `maxSlivers` of them. Safe here
  // because a dense curve's vertices are near-collinear samples (chords barely
  // deviate); sparse polylines with real corners (linear / stepped) take the
  // per-segment path below, which never spans a vertex.
  if (points.length - 1 > maxSlivers) {
    const step = total / maxSlivers;
    for (let k = 0; k < maxSlivers; k++) {
      const d0 = k * step;
      slivers.push({
        a: pointAtArcLen(points, segLen, d0),
        b: pointAtArcLen(points, segLen, Math.min(d0 + step, total)),
        frac0: d0 / total,
      });
    }
    return slivers;
  }

  let cumLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = segLen[i];
    const nSub = Math.max(1, Math.round(len / sliverPx));
    for (let k = 0; k < nSub; k++) {
      const t0 = k / nSub;
      const t1 = (k + 1) / nSub;
      const s0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
      const s1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      slivers.push({ a: s0, b: s1, frac0: (cumLen + len * t0) / total });
    }
    cumLen += len;
  }
  return slivers;
}
