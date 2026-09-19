/**
 * Per-machine speed correction for the render-time estimate (estimate-v2,
 * Phase E).
 *
 * The cost model's coefficients are fitted on ONE reference machine; every
 * render record now carries the model's `predictedMs` next to the measured
 * command times, so the machine's true speed relative to the reference is
 * directly observable. Hosts multiply the a-priori `estimatedMs` by the
 * rolling median of actual/predicted — a slow laptop's estimates converge
 * within a dozen renders, with no refit and no configuration.
 *
 * Robustness choices:
 *  - MEDIAN over a small window (12): one AV-scan-inflated render can't
 *    move it, and it tracks genuine machine changes within ~6 renders.
 *  - The actual is `commands.totalCommandMs` (the ffmpeg phase — what
 *    `predictedMs` models), not `elapsedMs` (which adds plan build /
 *    probing / sidecars).
 *  - Wrapped records (`stampWrapped`) are skipped — the free-tier QR wrap
 *    re-encodes the output outside the model.
 *  - Sub-3s renders are skipped — spawn jitter dominates their ratio.
 *  - Clamped to [1/3, 3]: a corrupt record can't produce an absurd factor.
 */

import type { MosaicRenderRecord } from "@m0saic/types";
import { listRenderRecords } from "./recordStore";

/** Records from cost-model versions below this predict differently — skip.
 *  (Kept local: platform must not import @m0saic/core's model constant.)
 *  v3 (2026-07-20, per-kind scales): v2 predictions are no longer
 *  comparable, so both the scalar and two-factor fits require v3 records —
 *  after the model upgrade the factor sits at neutral 1 until 3 fresh
 *  renders land (converges within a dozen). */
const MIN_COST_MODEL_VERSION = 3;

export type MachineFactorOptions = {
  /** How many qualifying recent records feed the median. Default 12. */
  window?: number;
  /** Below this many samples, return the neutral factor 1. Default 3. */
  minSamples?: number;
  /** Skip renders whose ffmpeg phase ran shorter than this. Default 3000. */
  minActualMs?: number;
};

const DEFAULTS: Required<MachineFactorOptions> = {
  window: 12,
  minSamples: 3,
  minActualMs: 3_000,
};

const CLAMP_MIN = 1 / 3;
const CLAMP_MAX = 3;

/** Pure: newest-first records → clamped rolling-median speed factor. */
export function computeMachineFactor(
  records: readonly MosaicRenderRecord[],
  options?: MachineFactorOptions,
): number {
  const opts = { ...DEFAULTS, ...(options ?? {}) };
  const ratios: number[] = [];
  for (const r of records) {
    if (ratios.length >= opts.window) break;
    if (!r.ok || r.stampWrapped) continue;
    if ((r.costModelVersion ?? 0) < MIN_COST_MODEL_VERSION) continue;
    if (r.predictedMs === undefined || r.predictedMs <= 0) continue;
    const actual = r.commands?.totalCommandMs ?? 0;
    if (actual < opts.minActualMs) continue;
    ratios.push(actual / r.predictedMs);
  }
  if (ratios.length < opts.minSamples) return 1;
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, median));
}

/**
 * Host convenience: read recent local records and compute the factor.
 * NEVER throws (estimation must never break a render); returns 1 on any
 * failure or when telemetry recording is off/empty.
 */
export function loadMachineFactor(options?: MachineFactorOptions): number {
  try {
    const { records } = listRenderRecords({ limit: 50 });
    return computeMachineFactor(records, options);
  } catch {
    return 1;
  }
}

/* ------------------------------------------------------------------ */
/*  Two-factor machine model (cost-model v3)                           */
/* ------------------------------------------------------------------ */

export type MachineFactors = { setupFactor: number; slopeFactor: number };

// A 15W laptop measured ~7× the reference on spawn/setup-dominated commands
// but only ~1.2× on per-frame throughput (render-captures analysis,
// 2026-07-20) — hence the wider setup clamp.
const SETUP_CLAMP_MAX = 8;

/**
 * Pure: newest-first records → two-factor machine correction.
 *
 * Solves ordinary least squares over the qualifying window:
 *   actual ≈ setupFactor · predictedSetupUnits + slopeFactor · predictedSlopeUnits
 * (2×2 normal equations — closed form, no iteration). Records without the
 * split regressors (pre-v3) can't participate; when fewer than `minSamples`
 * qualify, falls back to the scalar rolling-median applied to BOTH factors,
 * so behavior degrades gracefully to the v2 model.
 */
export function computeMachineFactors(
  records: readonly MosaicRenderRecord[],
  options?: MachineFactorOptions,
): MachineFactors {
  const opts = { ...DEFAULTS, ...(options ?? {}) };
  const rows: { setup: number; slope: number; actual: number }[] = [];
  for (const r of records) {
    if (rows.length >= opts.window) break;
    if (!r.ok || r.stampWrapped) continue;
    if ((r.costModelVersion ?? 0) < MIN_COST_MODEL_VERSION) continue;
    const setup = r.predictedSetupUnits;
    const slope = r.predictedSlopeUnits;
    if (setup === undefined || slope === undefined || setup + slope <= 0) continue;
    const actual = r.commands?.totalCommandMs ?? 0;
    if (actual < opts.minActualMs) continue;
    rows.push({ setup, slope, actual });
  }

  if (rows.length < opts.minSamples) {
    const scalar = computeMachineFactor(records, options);
    return { setupFactor: scalar, slopeFactor: scalar };
  }

  // Normal equations for [sf, lf]: minimize Σ (sf·s + lf·l − a)².
  let ss = 0, sl = 0, ll = 0, sa = 0, la = 0;
  for (const { setup: sU, slope: lU, actual: a } of rows) {
    ss += sU * sU;
    sl += sU * lU;
    ll += lU * lU;
    sa += sU * a;
    la += lU * a;
  }
  const det = ss * ll - sl * sl;
  const clampSetup = (x: number) => Math.min(SETUP_CLAMP_MAX, Math.max(CLAMP_MIN, x));
  const clampSlope = (x: number) => Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, x));
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6 * Math.max(1, ss * ll)) {
    // Degenerate window (all renders the same setup/slope mix) — the two
    // factors aren't separable; use the scalar ratio for both.
    const scalar = computeMachineFactor(records, options);
    return { setupFactor: scalar, slopeFactor: scalar };
  }
  const sf = (sa * ll - la * sl) / det;
  const lf = (la * ss - sa * sl) / det;
  if (!Number.isFinite(sf) || !Number.isFinite(lf)) {
    const scalar = computeMachineFactor(records, options);
    return { setupFactor: scalar, slopeFactor: scalar };
  }
  return { setupFactor: clampSetup(sf), slopeFactor: clampSlope(lf) };
}

/**
 * Host convenience: read recent local records and compute both factors.
 * NEVER throws; neutral (1, 1) on any failure or empty history.
 */
export function loadMachineFactors(options?: MachineFactorOptions): MachineFactors {
  try {
    const { records } = listRenderRecords({ limit: 50 });
    return computeMachineFactors(records, options);
  } catch {
    return { setupFactor: 1, slopeFactor: 1 };
  }
}
