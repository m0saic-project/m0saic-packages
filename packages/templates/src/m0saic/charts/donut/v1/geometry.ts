/**
 * ============================================================================
 * @m0saic/charts/donut/v1 — ring geometry (pure)
 * ============================================================================
 *
 * Pure math for the donut's annular sectors. No engine imports, no I/O —
 * deterministic functions a unit test can pin exactly.
 *
 * Conventions:
 *   - Angles in DEGREES, clockwise, 0° at 12 o'clock (screen coords, y down).
 *   - Paths are authored in the consuming cell's own pixel space; the mask
 *     `bounds` must match the cell so the engine's scale stays uniform
 *     (the stat-card triangleSource idiom).
 * ============================================================================
 */

export type DonutSegmentAngles = {
  /** Clockwise start, degrees from 12 o'clock. */
  startDeg: number;
  /** Clockwise end, degrees from 12 o'clock. Always > startDeg. */
  endDeg: number;
  /** Normalized share of the whole [0..1]. */
  frac: number;
};

export type AnnularSectorOpts = {
  cx: number;
  cy: number;
  rOuter: number;
  rInner: number;
  startDeg: number;
  endDeg: number;
};

/** Max segments the ring accepts — beyond this the slices stop reading. */
export const MAX_SEGMENTS = 12;

/** Round to 0.1px — keeps paths compact and rasterization deterministic. */
const n = (x: number): number => Math.round(x * 10) / 10;

/** Polar → cartesian with 0° at 12 o'clock, clockwise, y down. */
function pt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/**
 * Normalize raw segment weights into cumulative clockwise angle spans,
 * optionally separated by an angular gap (split evenly off both ends of
 * each span). Fails fast on degenerate input.
 */
export function segmentsToAngles(
  values: number[],
  opts: { gapDeg?: number } = {},
): DonutSegmentAngles[] {
  const gapDeg = opts.gapDeg ?? 0;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("segmentsToAngles: values must be non-empty");
  }
  if (values.length > MAX_SEGMENTS) {
    throw new Error(
      `segmentsToAngles: at most ${MAX_SEGMENTS} segments, got ${values.length}`,
    );
  }
  if (!Number.isFinite(gapDeg) || gapDeg < 0 || gapDeg >= 360 / values.length) {
    throw new Error(`segmentsToAngles: gapDeg out of range, got ${gapDeg}`);
  }
  let sum = 0;
  for (const v of values) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`segmentsToAngles: values must be non-negative numbers, got ${v}`);
    }
    sum += v;
  }
  if (sum <= 0) {
    throw new Error("segmentsToAngles: values must sum to > 0");
  }

  const out: DonutSegmentAngles[] = [];
  let acc = 0;
  for (const v of values) {
    const frac = v / sum;
    const start = (acc / sum) * 360;
    const end = ((acc + v) / sum) * 360;
    out.push({
      startDeg: start + gapDeg / 2,
      endDeg: Math.max(start + gapDeg / 2, end - gapDeg / 2),
      frac,
    });
    acc += v;
  }
  return out;
}

/**
 * SVG path for one annular sector (ring slice). Handles the large-arc
 * flag for spans > 180°; a (near-)full circle is emitted as two half
 * sectors in one path (a single 360° arc is degenerate in SVG).
 */
export function annularSectorPath(opts: AnnularSectorOpts): string {
  const { cx, cy, rOuter, rInner, startDeg, endDeg } = opts;
  if (!(rOuter > 0) || !(rInner >= 0) || rInner >= rOuter) {
    throw new Error(
      `annularSectorPath: need 0 <= rInner < rOuter, got rInner=${rInner} rOuter=${rOuter}`,
    );
  }
  const sweep = endDeg - startDeg;
  if (!(sweep > 0)) {
    throw new Error(`annularSectorPath: endDeg must exceed startDeg (sweep=${sweep})`);
  }

  if (sweep >= 359.999) {
    const mid = startDeg + sweep / 2;
    return (
      sectorPath(cx, cy, rOuter, rInner, startDeg, mid) +
      " " +
      sectorPath(cx, cy, rOuter, rInner, mid, startDeg + sweep)
    );
  }
  return sectorPath(cx, cy, rOuter, rInner, startDeg, endDeg);
}

/**
 * Visual center of an annular sector — mid-angle at mid-radius. Where a
 * per-segment label (e.g. "75%") sits, like the classic donut mocks.
 */
export function sectorCentroid(opts: AnnularSectorOpts): { x: number; y: number } {
  const midDeg = (opts.startDeg + opts.endDeg) / 2;
  const rMid = (opts.rOuter + opts.rInner) / 2;
  const [x, y] = pt(opts.cx, opts.cy, rMid, midDeg);
  return { x: n(x), y: n(y) };
}

function sectorPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number,
): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const [ax, ay] = pt(cx, cy, rOuter, startDeg);
  const [bx, by] = pt(cx, cy, rOuter, endDeg);
  const [dx, dy] = pt(cx, cy, rInner, endDeg);
  const [ex, ey] = pt(cx, cy, rInner, startDeg);
  return (
    `M ${n(ax)} ${n(ay)} ` +
    `A ${n(rOuter)} ${n(rOuter)} 0 ${large} 1 ${n(bx)} ${n(by)} ` +
    `L ${n(dx)} ${n(dy)} ` +
    `A ${n(rInner)} ${n(rInner)} 0 ${large} 0 ${n(ex)} ${n(ey)} Z`
  );
}
