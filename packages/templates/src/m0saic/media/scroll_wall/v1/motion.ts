/**
 * Scroll Wall v1 — the per-tile `overlay.xExpr` motion algebra.
 *
 * `overlay.xExpr` is an OFFSET added to the cell's DSL x (the engine emits
 * `x='(baseX)+(xExpr)'`), so each tile's expression carries its phase plus
 * the shared scroll, and the absolute position collapses to
 *
 *   absX_i(t) = mod(C_i ± v·t, P) - pitch        (floor-mod, range [-pitch, P-pitch))
 *
 * Why each piece exists:
 *
 * - **`-pitch` (the origin shift) is load-bearing.** ffmpeg's `mod` returns
 *   `[0, P)`, so without it a clip could never leave the LEFT edge — it would
 *   land flush at `x = 0`, fully visible, and teleport once per period.
 *   Shifting by `pitch` (not `cellW`) puts the wrap handoff `gapX` px past
 *   fully-off-screen.
 * - **The bias costs nothing.** For left-moving rows it folds into the integer
 *   literal `C_i`, making the mod argument provably ≥ 0 for every rendered t —
 *   the emitted string shape is identical and the template is correct under
 *   either mod convention (ffmpeg's is floor-mod; verified on the pinned
 *   toolchain: mod(-30,100)=70).
 * - **All-integer constants, no `w`/`W`.** Baking pixels avoids any dependence
 *   on the engine's macro-substitution order.
 *
 * The emitted shape is ~5 additive terms, far under the ~99-term expression
 * parse cliff, so no `rebalanceAdditiveChains` call is needed. If you ever add
 * terms here, import it from `@m0saic/platform/ffexpr` and wrap the result
 * (precedent: `meta/camera-debug/v1`).
 *
 * "Seamless" means POSITION-CONTINUOUS across the loop point, not
 * frame-identical: the last rendered frame sits at `(N-1)/fps`, one frame
 * BEFORE the period closes, so `frame[0]` and `frame[N-1]` differ by exactly
 * `v/fps` px — correct, and the loop plays through with no jump. Assert
 * `absX(0) == absX(N/fps)`; never assert frame equality. Clip CONTENT runs on
 * the global clock and does not loop with the positions.
 */

/** Everything shared by all tiles of one row. */
export type ScrollMotionParams = {
  /** DSL footprints across the canvas — `baseX_i = (i mod slots) * pitch`. */
  slots: number;
  /** Tile pitch (px). */
  pitch: number;
  /** Strip period `P = slotCount * pitch` (px). */
  period: number;
  /** Row phase in `[0, pitch)` (px) — see {@link rowPhasePx}. */
  phasePx: number;
  /** -1 = leftward travel, +1 = rightward. */
  sign: -1 | 1;
  /** Exact scroll velocity (px/sec) — see {@link resolveSpeedPxPerSec}. */
  pxPerSec: number;
  /** Render duration (sec) — sizes the left-direction non-negativity bias. */
  durationSec: number;
};

/** Floor-mod (result in `[0, b)` for `b > 0`) — ffmpeg's `mod` convention. */
export function floorMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/**
 * Resolve the exact scroll velocity in px/sec.
 *
 * In `"cycles"` mode the velocity comes from the FRAME COUNT, not the wall
 * duration: frames sit at `t = k/fps`, so the strip must travel `cycles·P`
 * over `N = round(durationMs/1000 · fps)` frames — `v = cycles·P·fps/N`.
 * (Identical to `cycles·P/durationSec` when `durationMs·fps/1000` is whole;
 * correct when it isn't.) Whole-number `cycles` values loop seamlessly.
 *
 * `snapVelocityToFrameGrid` rounds to an integer px/frame, killing the ±1px
 * truncation jitter at the cost of exact seamlessness — default off.
 */
export function resolveSpeedPxPerSec(args: {
  speedMode: "cycles" | "pxPerSec";
  cycles: number;
  pxPerSec: number;
  period: number;
  fps: number;
  durationMs: number;
  snapVelocityToFrameGrid: boolean;
}): number {
  const { speedMode, cycles, pxPerSec, period, fps, durationMs, snapVelocityToFrameGrid } = args;
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps));
  let v = speedMode === "pxPerSec" ? pxPerSec : (cycles * period * fps) / totalFrames;
  if (snapVelocityToFrameGrid) {
    v = Math.max(1, Math.round(v / fps)) * fps;
  }
  return v;
}

/** Per-row travel direction: base sign from `direction`, flipped on odd rows when alternating. */
export function rowDirectionSign(
  direction: "left" | "right",
  row: number,
  alternateRowDirection: boolean,
): -1 | 1 {
  const base = direction === "right" ? 1 : -1;
  return (alternateRowDirection && row % 2 === 1 ? -base : base) as -1 | 1;
}

/**
 * Per-row phase in `[0, pitch)`. `rowOffsetFrac` is a fraction of PITCH, not
 * of the period — a phase of `k·pitch` merely relabels which clip sits where
 * (positions are pitch-multiples mod P), so only a sub-pitch phase actually
 * breaks vertical column alignment.
 */
export function rowPhasePx(rowOffsetFrac: number, row: number, pitch: number): number {
  return floorMod(Math.round(rowOffsetFrac * row * pitch), pitch);
}

/** Left-direction bias: folds into C so the mod argument stays ≥ 0 for all rendered t. */
function biasPx(p: ScrollMotionParams): number {
  return p.sign < 0 ? p.period * (Math.ceil((p.pxPerSec * p.durationSec) / p.period) + 1) : 0;
}

/** The integer phase constant `C_i` for tile `i` of a row. */
function phaseConstant(p: ScrollMotionParams, tileIndex: number): number {
  return tileIndex * p.pitch + p.phasePx + biasPx(p);
}

/**
 * The emitted `overlay.xExpr` for tile `i` — one shape for both directions:
 * `mod(C±v*t,P)-SUB` with `SUB_i = pitch + (i mod slots)·pitch` (the engine
 * adds `baseX_i = (i mod slots)·pitch` back, collapsing to `mod(...) - pitch`).
 */
export function buildScrollXExpr(p: ScrollMotionParams, tileIndex: number): string {
  const c = phaseConstant(p, tileIndex);
  const sub = p.pitch + (tileIndex % p.slots) * p.pitch;
  const v = String(p.pxPerSec);
  // JS shortest round-trip formatting never yields exponent notation in this
  // template's velocity range; guard anyway — ffmpeg must see a plain decimal.
  if (!/^\d+(\.\d+)?$/.test(v)) {
    throw new Error(`scroll-wall: velocity ${v} px/s does not format as a plain decimal.`);
  }
  return `mod(${c}${p.sign < 0 ? "-" : "+"}${v}*t,${p.period})-${sub}`;
}

/**
 * Independent floor-mod reference model for tile `i`'s ABSOLUTE x at time
 * `t` (i.e. after the engine adds `baseX_i`). Tests prove string ≡ model
 * without rendering.
 */
export function scrollAbsX(p: ScrollMotionParams, tileIndex: number, t: number): number {
  return floorMod(phaseConstant(p, tileIndex) + p.sign * p.pxPerSec * t, p.period) - p.pitch;
}

/** The parsed pieces of one emitted expression. */
export type ParsedScrollXExpr = {
  c: number;
  sign: -1 | 1;
  pxPerSec: number;
  period: number;
  sub: number;
};

const XEXPR_SHAPE = /^mod\((\d+)([+-])(\d+(?:\.\d+)?)\*t,(\d+)\)-(\d+)$/;

/** Parse the one expression shape this template emits. Throws on any other. */
export function parseScrollXExpr(expr: string): ParsedScrollXExpr {
  const m = XEXPR_SHAPE.exec(expr);
  if (!m) throw new Error(`scroll-wall: not a scroll xExpr: "${expr}"`);
  return {
    c: Number(m[1]),
    sign: m[2] === "-" ? -1 : 1,
    pxPerSec: Number(m[3]),
    period: Number(m[4]),
    sub: Number(m[5]),
  };
}

/**
 * Evaluate an emitted expression at time `t` exactly as ffmpeg's overlay
 * evaluator would (floor-mod) — this is the OFFSET the engine adds to the
 * cell's `baseX`. `evalScrollXExpr(expr, t) + baseX` must equal
 * {@link scrollAbsX} for the same tile.
 */
export function evalScrollXExpr(expr: string, t: number): number {
  const { c, sign, pxPerSec, period, sub } = parseScrollXExpr(expr);
  return floorMod(c + sign * pxPerSec * t, period) - sub;
}
