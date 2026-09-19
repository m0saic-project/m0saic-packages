/**
 * Animation-mode expression builders for `@m0saic/media/logo-animate/v1`.
 *
 * All builders return ffmpeg-evaluator-compatible strings of global `t`
 * (wall-clock seconds). No filesystem, no random state — fully
 * deterministic from inputs.
 *
 * The `assemble` mode re-uses the qr-animate v1 builders directly (the
 * same cross-version import qr-animate/v2 already does). The other four
 * modes are local ports of the module-private builders in
 * `brand/logo/v3/logo.ts` — the same copy each brand/logo version
 * carries; kept verbatim-shaped so the two stay diffable.
 */

export {
  buildModuleAlphaExpr,
  buildPseudoRanks,
  buildTileOffsetExpr,
  type ModulePhaseParams,
  type RankInputTile,
} from "../../qr/animate/v1/expressions";

/**
 * `logo_loop` — loopable per-tile enable expression for `overlay.enable`.
 * Reveal-in by rank, hold, then reveal-out by reverse rank; seamless over
 * `loopSec`. Scalar per-frame gate (free — no alpha fold).
 */
export function buildLoopEnableExpr(
  rank: number,
  opts: {
    loopSec: number;
    inEnd: number;
    outStart: number;
    feather: number;
    fps: number;
    startDelay: number;
    endDelay: number;
    easing: "linear" | "smoothstep";
  },
): string {
  const { loopSec, inEnd, outStart, feather, fps, startDelay, endDelay } = opts;
  const p = `mod(t,${loopSec})/${loopSec}`;
  const pFrame = `(1/${fps})/${loopSec}`;
  const startGate = `gte(${p},${pFrame})`;

  const activeStart = `${startDelay}`;
  const activeEnd = `(1-${endDelay})`;
  const activeDur = `(${activeEnd}-${activeStart})`;
  const activeGate = `gte(${p},${activeStart})*lt(${p},${activeEnd})`;

  const pA = `(((${p})-${activeStart})/${activeDur})`;
  const pE =
    opts.easing === "smoothstep"
      ? `(${pA})*(${pA})*(3-2*(${pA}))`
      : `${pA}`;

  const outDur = `(1-${outStart})`;
  const inProg = `min((${pE})/${inEnd},1)`;
  const outProg = `min(max(((${pE})-${outStart})/${outDur},0),1)`;

  return `${startGate}*${activeGate}*gte((${inProg})+${feather},${rank})*gte((1-(${outProg}))+${feather},${rank})`;
}

/**
 * `progress_fill` — enable when `(p + feather) >= rank`. `p` is a static
 * `progress` value, a one-shot ramp over `progressSec`, or a repeating
 * ramp. Rank MUST be a percentile rank in [0..1] across visible tiles.
 */
export function buildProgressFillEnableExpr(
  rank: number,
  opts: {
    progress?: number;
    progressSec: number;
    oneShot: boolean;
    feather: number;
    fps: number;
  },
): string {
  const { progress, progressSec, oneShot, feather, fps } = opts;

  // Frame-0 guard (skip when progress is explicitly set — static fills
  // should render at t=0 for single-image output, not wait a frame).
  const isStaticProgress = progress !== undefined;
  const startGate = isStaticProgress ? "1" : `gte(t,1/${fps})`;

  const pExpr =
    progress !== undefined
      ? String(Math.max(0, Math.min(1, progress)))
      : oneShot
        ? `min(max(t/${progressSec},0),1)`
        : `mod(t,${progressSec})/${progressSec}`;

  return `${startGate}*gte((${pExpr})+${feather},${rank})`;
}

/**
 * `breathing` — the loading-UI glow: base cos-pulse plus a rank-aware
 * shimmer band, as an `overlay.alpha` value in [0..1].
 */
export function buildBreathingAlphaExpr(
  rank: number,
  opts: {
    baseMin: number;
    baseMax: number;
    basePulseSec: number;
    shimmerSec: number;
    shimmerWidth: number;
    shimmerAmp: number;
    feather: number;
    fps: number;
  },
): string {
  const { baseMin, baseMax, basePulseSec, shimmerSec, shimmerWidth, shimmerAmp, feather, fps } = opts;

  const startGate = `gte(t,1/${fps})`;

  // base breathing: baseMin + (baseMax-baseMin)*0.5*(1-cos(2*pi*t/basePulseSec))
  const base =
    `(${baseMin})+(${baseMax}-${baseMin})*0.5*(1-cos(2*PI*t/${basePulseSec}))`;

  // moving center p in [0..1)
  const p = `mod(t,${shimmerSec})/${shimmerSec}`;
  const halfW = `(${shimmerWidth}/2)`;

  // wrap distance
  const d0 = `abs(${rank}-(${p}))`;
  const d1 = `abs(${rank}-((${p})-1))`;
  const d2 = `abs(${rank}-((${p})+1))`;
  const d = `min(min(${d0},${d1}),${d2})`;

  // band strength u in [0..1]: u = clamp(1 - d/halfW, 0, 1)
  const u = `max(min(1-(${d})/(${halfW}),1),0)`;

  // smoothstep(u) = u*u*(3-2*u)
  const band = `(${u})*(${u})*(3-2*(${u}))`;

  const hi = `(${shimmerAmp})*${band}`;

  const a = `max(min((${base})+(${hi})+${feather},1),0)`;

  return `${startGate}*(${a})`;
}

/**
 * `shimmer` — travelling highlight band as an `overlay.enable` gate:
 * a tile is on while the band center is within `shimmerWidth/2` of its
 * rank (cyclic wrap via the p±1 comparisons).
 */
export function buildShimmerEnableExpr(
  rank: number,
  opts: {
    shimmerSec: number;
    shimmerWidth: number;
    feather: number;
    fps: number;
  },
): string {
  const { shimmerSec, shimmerWidth, feather, fps } = opts;

  const startGate = `gte(t,1/${fps})`;
  const p = `mod(t,${shimmerSec})/${shimmerSec}`;
  const halfW = `(${shimmerWidth}/2)`;

  // d = min( abs(rank - p), abs(rank - (p-1)), abs(rank - (p+1)) )
  const d0 = `abs(${rank}-(${p}))`;
  const d1 = `abs(${rank}-((${p})-1))`;
  const d2 = `abs(${rank}-((${p})+1))`;
  const d = `min(min(${d0},${d1}),${d2})`;

  return `${startGate}*lte(${d},(${halfW})+${feather})`;
}
