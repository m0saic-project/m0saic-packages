/**
 * Pure expression builders for the brand QR spawn-in animation.
 *
 * All builders return ffmpeg-evaluator-compatible strings using `t`
 * (global wall-clock seconds). No filesystem, no random state —
 * fully deterministic from inputs.
 */

/**
 * Format a number to 3 decimal places for deterministic expression output.
 * Keeps the rendered expressions byte-identical across runs.
 * (Same shape as `fixed()` in the qr-stamp video expressions.)
 */
function fixed(n: number): string {
  return n.toFixed(3);
}

/** Tile geometry slice consumed by ranking. */
export type RankInputTile = {
  /** Tile's top-left x in canvas pixels. */
  x: number;
  /** Tile's top-left y in canvas pixels. */
  y: number;
  /** DFS-order index of this visible tile — used to break ties deterministically. */
  logicalIndex: number;
};

/**
 * Build percentile ranks (0..1) for a set of tiles using a diagonal sweep
 * score `(x + y)`. The tile closest to (0, 0) gets rank 0; the tile
 * farthest along the diagonal gets rank 1. Ties on the same diagonal are
 * broken by ascending `x`, then by ascending `logicalIndex` — both stable
 * across runs.
 *
 * Returned array is aligned with the input: `ranks[i]` is the rank of
 * `tiles[i]`. So callers can keep tiles in their original DFS order when
 * emitting sources and just look up the rank by source index.
 */
export function buildDiagonalRanks(tiles: ReadonlyArray<RankInputTile>): number[] {
  const n = tiles.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // Build a sort order with input-index attached so we can scatter back.
  const order = tiles.map((t, i) => ({ i, t }));
  order.sort((a, b) => {
    const sa = a.t.x + a.t.y;
    const sb = b.t.x + b.t.y;
    if (sa !== sb) return sa - sb;
    if (a.t.x !== b.t.x) return a.t.x - b.t.x;
    return a.t.logicalIndex - b.t.logicalIndex;
  });

  const ranks = new Array<number>(n);
  for (let pos = 0; pos < n; pos += 1) {
    // Even spread across [0, 1] — first tile rank 0, last tile rank 1.
    ranks[order[pos].i] = pos / (n - 1);
  }
  return ranks;
}

export type SpawnTimingParams = {
  /** Total seconds from rank-0 tile starting its fade to rank-1 tile starting its fade. */
  spawnDurSec: number;
  /** Per-tile fade duration in seconds (each tile's 0→1 ramp). */
  tileFadeSec: number;
};

/**
 * Smoothstep-eased fade-in alpha for a single tile.
 *
 * Returns an expression in `[0, 1]`:
 *   - 0 for `t < rank * spawnDurSec`
 *   - smoothstep((t - startSec) / tileFadeSec) for the ramp
 *   - 1 once the tile's local progress reaches 1
 *
 * Smoothstep gives the entrance a softer, "premium watch" feel vs. a
 * raw linear ramp — matches the convention used by `buildEntranceExpr`
 * in `qr-stamp/video/v1/expressions.ts`.
 */
export function buildTileAlphaExpr(
  rank: number,
  params: SpawnTimingParams,
): string {
  const startSec = rank * params.spawnDurSec;
  const fadeSec = Math.max(0.001, params.tileFadeSec);
  // u = clamp((t - startSec) / fadeSec, 0, 1)
  const u = `min(1,max(0,(t-${fixed(startSec)})/${fixed(fadeSec)}))`;
  // smoothstep(u) = u² * (3 - 2u)
  return `(${u}*${u}*(3-2*${u}))`;
}

export type OffsetParams = SpawnTimingParams & {
  /** Pixel offset the tile starts from (positive = down/right). Decays to 0 over `tileFadeSec`. */
  offsetPx: number;
};

/**
 * Pixelate-in rank: each tile gets a deterministic-but-shuffled rank in
 * [0, 1] based on a hash of its `logicalIndex`. Unlike the diagonal
 * sweep, this produces a "noise resolving to image" feel — tiles appear
 * scattered across the canvas, all converging at the same end-time.
 *
 * Uses a simple integer-hash (Knuth's multiplicative) → normalized.
 * Stable for a given logicalIndex; no randomness, no seed needed
 * (the logicalIndex itself acts as the seed input).
 */
export function buildPseudoRanks(tiles: ReadonlyArray<RankInputTile>): number[] {
  const n = tiles.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  // Score each tile by Knuth's multiplicative hash on logicalIndex.
  // Spread is uniform mod 2^32 — good enough for visually-random ordering.
  const KNUTH = 2654435761;
  const order = tiles.map((t, i) => ({
    i,
    score: ((t.logicalIndex * KNUTH) >>> 0) / 0x100000000,
    logicalIndex: t.logicalIndex,
  }));
  order.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.logicalIndex - b.logicalIndex;
  });
  const ranks = new Array<number>(n);
  for (let pos = 0; pos < n; pos += 1) {
    ranks[order[pos].i] = pos / (n - 1);
  }
  return ranks;
}

export type ModulePhaseParams = SpawnTimingParams & {
  /** Wall-clock seconds when the idle phase ends and fade-out begins. */
  exitStartSec: number;
  /** Smoothstep fade-out duration in seconds. */
  fadeOutSec: number;
};

/**
 * Full-timeline alpha for a module tile:
 *
 * 1. **Spawn** (`rank·spawnDurSec ≤ t < rank·spawnDurSec + tileFadeSec`):
 *    smoothstep 0 → 1.
 * 2. **Hold** (until `exitStartSec`): 1.
 * 3. **Exit** (`exitStartSec ≤ t < exitStartSec + fadeOutSec`):
 *    smoothstep 1 → 0.
 * 4. After: 0.
 *
 * One expression, three phases. The exit gate is built with `if(lt(t,...))`
 * so the spawn smoothstep is never evaluated during the exit (avoids
 * floating-point surprises near the boundary).
 */
export function buildModuleAlphaExpr(
  rank: number,
  params: ModulePhaseParams,
): string {
  const { spawnDurSec, tileFadeSec, exitStartSec, fadeOutSec } = params;
  const startSec = rank * spawnDurSec;
  const fadeSec = Math.max(0.001, tileFadeSec);
  const exitFade = Math.max(0.001, fadeOutSec);
  // Spawn smoothstep.
  const u = `min(1,max(0,(t-${fixed(startSec)})/${fixed(fadeSec)}))`;
  const spawn = `(${u}*${u}*(3-2*${u}))`;
  // Exit smoothstep — reverses to 0 as t crosses exitStartSec.
  const v = `min(1,max(0,(t-${fixed(exitStartSec)})/${fixed(exitFade)}))`;
  const exit = `(1-(${v}*${v}*(3-2*${v})))`;
  // Multiply: spawn fades in, exit fades back out. Both clamped, so they
  // hold at 1 during the middle.
  return `(${spawn})*(${exit})`;
}

/** Tuning for the optional per-cell QR-module gleam. */
export type ModuleGleamParams = {
  /** Seconds for the shimmer band to sweep once through rank space. */
  sweepSec?: number;
  /** Floor alpha between band passes — keeps modules legible/scannable. */
  minAlpha?: number;
  /** Band width in rank space (0..1). */
  width?: number;
};

const GLEAM_DEFAULTS = { sweepSec: 2.4, minAlpha: 0.82, width: 0.22 };

/**
 * Per-cell "gleam" factor in `[minAlpha, 1]` for a QR module cell — a travelling
 * shine. A shimmer band sweeps through rank space; the cell the band is over
 * reaches 1, the rest sit at `minAlpha`. MULTIPLY a module's base alpha by this
 * for a premium per-cell gleam (same shape as the brand-M loading shimmer, but
 * generic — works for any QR since rank comes from the module's own position).
 *
 * `minAlpha` stays high so the QR remains scannable; and because each cell only
 * dips while the band is elsewhere, any contrast loss is transient (a few
 * frames), so a sparing gleam doesn't break scanning. Cyclic wrap distance
 * (the p±1 terms) makes the sweep seamless across the rank-space boundary.
 */
export function buildModuleGleamFactor(
  rank: number,
  params: ModuleGleamParams = {},
): string {
  const sweepSec = Math.max(0.1, params.sweepSec ?? GLEAM_DEFAULTS.sweepSec);
  const minAlpha = Math.max(0, Math.min(1, params.minAlpha ?? GLEAM_DEFAULTS.minAlpha));
  const width = Math.max(0.01, params.width ?? GLEAM_DEFAULTS.width);
  const p = `mod(t,${fixed(sweepSec)})/${fixed(sweepSec)}`;
  const halfW = `(${fixed(width)}/2)`;
  const d0 = `abs(${fixed(rank)}-(${p}))`;
  const d1 = `abs(${fixed(rank)}-((${p})-1))`;
  const d2 = `abs(${fixed(rank)}-((${p})+1))`;
  const d = `min(min(${d0},${d1}),${d2})`;
  const u = `max(min(1-(${d})/(${halfW}),1),0)`;
  const band = `(${u})*(${u})*(3-2*(${u}))`;
  return `(${fixed(minAlpha)}+(1-${fixed(minAlpha)})*${band})`;
}

export type MTilePhaseParams = {
  /** Wall-clock seconds when the M phase begins (modulesEnd + mDelay). */
  mStartSec: number;
  /** Total M entrance window in seconds (all 33 tiles converge by `mStartSec + mInDurSec`). */
  mInDurSec: number;
  /** Per-tile entrance smoothstep duration in seconds. */
  mTileFadeSec: number;
  /** Loading-UI base breathing — minimum alpha. */
  baseMin: number;
  /** Loading-UI base breathing — maximum alpha. */
  baseMax: number;
  /** Loading-UI base breathing — cycle period (sec). */
  basePulseSec: number;
  /** Loading-UI shimmer sweep — cycle period (sec). */
  shimmerSec: number;
  /** Loading-UI shimmer band width — fraction of the rank axis (0..1). */
  shimmerWidth: number;
  /** Loading-UI shimmer amplitude — how much the band boosts a tile (0..1). */
  shimmerAmp: number;
  /** Wall-clock seconds when the idle phase ends and fade-out begins. */
  exitStartSec: number;
  /** Smoothstep fade-out duration in seconds. */
  fadeOutSec: number;
};

/**
 * Full-timeline alpha for a single M-rect tile.
 *
 * Combines three phases in one expression, switched by `if(lt(t, ...))`:
 *
 * 1. **M entrance** (`mStartSec + rank·(mInDurSec - mTileFadeSec) ≤ t <
 *    + mTileFadeSec`): smoothstep 0 → loading-base-peak. Per-rank
 *    staggered so the M assembles "rect by rect" — exactly the editor's
 *    loading-shimmer aesthetic.
 *
 * 2. **Loading-UI idle** (`mInEndSec ≤ t < exitStartSec`): base breathing
 *    (cos pulse) plus a rank-aware shimmer band sweeping across the
 *    33 rects. Each rect carries its own phase offset via its rank,
 *    so the 33 rects animate independently. Replicates
 *    `buildLoadingUiAlphaExpr` from `brand/logo/v3` verbatim.
 *
 * 3. **Exit** (`exitStartSec ≤ t < exitStartSec + fadeOutSec`):
 *    smoothstep loading-alpha → 0.
 *
 * Before `mStartSec` the entrance smoothstep clamps to 0. After
 * `exitStartSec + fadeOutSec` everything clamps to 0.
 */
export function buildMTileAlphaExpr(
  rank: number,
  params: MTilePhaseParams,
): string {
  const {
    mStartSec,
    mInDurSec,
    mTileFadeSec,
    baseMin,
    baseMax,
    basePulseSec,
    shimmerSec,
    shimmerWidth,
    shimmerAmp,
    exitStartSec,
    fadeOutSec,
  } = params;

  // ── Entrance: per-rank staggered smoothstep into loading-baseline ──
  // Each rect's start = mStartSec + rank * (mInDurSec - mTileFadeSec)
  // so the last rect just finishes by mInDurSec.
  const tileFade = Math.max(0.001, mTileFadeSec);
  const stagger = Math.max(0, mInDurSec - tileFade);
  const entStart = mStartSec + rank * stagger;
  const u = `min(1,max(0,(t-${fixed(entStart)})/${fixed(tileFade)}))`;
  const entrance = `(${u}*${u}*(3-2*${u}))`;

  // ── Loading-UI idle (verbatim from brand/logo/v3 buildLoadingUiAlphaExpr) ──
  // base = baseMin + (baseMax - baseMin) * 0.5 * (1 - cos(2*PI*t/basePulseSec))
  const base =
    `(${fixed(baseMin)})+(${fixed(baseMax)}-${fixed(baseMin)})*0.5*` +
    `(1-cos(2*PI*t/${fixed(Math.max(0.01, basePulseSec))}))`;
  // shimmer center p ∈ [0..1)
  const p = `mod(t,${fixed(Math.max(0.01, shimmerSec))})/${fixed(Math.max(0.01, shimmerSec))}`;
  const halfW = `(${fixed(Math.max(0.001, shimmerWidth))}/2)`;
  // wrap distance (handles cyclic rank space)
  const d0 = `abs(${fixed(rank)}-(${p}))`;
  const d1 = `abs(${fixed(rank)}-((${p})-1))`;
  const d2 = `abs(${fixed(rank)}-((${p})+1))`;
  const d = `min(min(${d0},${d1}),${d2})`;
  // band strength: u' = clamp(1 - d/halfW, 0, 1)
  const u2 = `max(min(1-(${d})/(${halfW}),1),0)`;
  // smoothstep(u') for soft band edges
  const band = `(${u2})*(${u2})*(3-2*(${u2}))`;
  const hi = `(${fixed(shimmerAmp)})*${band}`;
  const loadingAlpha = `max(min((${base})+(${hi}),1),0)`;

  // ── Exit smoothstep: loading → 0 ──
  const v = `min(1,max(0,(t-${fixed(exitStartSec)})/${fixed(Math.max(0.001, fadeOutSec))}))`;
  const exitFactor = `(1-(${v}*${v}*(3-2*${v})))`;

  // Entrance phase ramps the loading alpha in. We compute the COMBINED
  // value as entrance * loadingAlpha — during the entrance, loadingAlpha
  // is whatever it is at that moment, and entrance scales it from 0 to 1.
  // After entrance completes (u = 1), entrance = 1, so we get pure
  // loadingAlpha. Exit multiplies the whole thing down to 0.
  return `(${entrance})*(${loadingAlpha})*${exitFactor}`;
}

/**
 * Per-tile pixel-offset expression for the entrance settle.
 *
 * Returns `offsetPx * (1 - smoothstep(u))` where `u` is the same clamped
 * progress used by {@link buildTileAlphaExpr}. So the tile starts shifted
 * `offsetPx` pixels and eases back to 0 by the time it finishes fading in.
 *
 * The same expression works for both `xExpr` and `yExpr` — callers pass
 * positive `offsetPx` to start down/right and decay to the tile's natural
 * position.
 */
export function buildTileOffsetExpr(
  rank: number,
  params: OffsetParams,
): string {
  if (params.offsetPx === 0) return "0";
  const startSec = rank * params.spawnDurSec;
  const fadeSec = Math.max(0.001, params.tileFadeSec);
  const u = `min(1,max(0,(t-${fixed(startSec)})/${fixed(fadeSec)}))`;
  const smooth = `(${u}*${u}*(3-2*${u}))`;
  return `(${fixed(params.offsetPx)}*(1-${smooth}))`;
}
