/**
 * ============================================================================
 * @m0saic/charts/bar-graph — Value label formatting
 * ============================================================================
 *
 * Pure formatters for the three canonical value-label modes.
 *   - "raw":     value.toFixed(decimals)
 *   - "percent": ((value / max) * 100).toFixed(decimals) + "%"
 *   - "compact": k/M/B/T suffix notation, e.g. 1500 → "1.5K", 2.3e9 → "2.3B"
 *
 * No side effects, no template registration, no rendering — these run inside
 * any internal that needs to display a value.
 * ============================================================================
 */

import { niceNum } from "@m0saic/dsl-stdlib";

import type { ValueLabelFormat } from "./types";

export type FormatDomain = {
  /** Domain max — used to compute percentage (value / max * 100). */
  max?: number;
};

export function formatValue(
  value: number,
  format: ValueLabelFormat,
  decimals: number,
  domain?: FormatDomain,
  suffix?: string,
): string {
  const base = ((): string => {
    switch (format) {
      case "raw":
        return value.toFixed(decimals);
      case "percent": {
        const max = domain?.max ?? 100;
        if (max === 0) return (0).toFixed(decimals) + "%";
        return ((value / max) * 100).toFixed(decimals) + "%";
      }
      case "compact":
        return formatCompact(value, decimals);
    }
  })();
  return suffix ? `${base}${suffix}` : base;
}

function formatCompact(n: number, decimals: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(decimals) + "T";
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(decimals) + "B";
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(decimals) + "M";
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(decimals) + "K";
  return sign + abs.toFixed(decimals);
}

// ---------------------------------------------------------------------------
// Nice axis selection
// ---------------------------------------------------------------------------

export type NiceAxis = {
  /** Lower bound of the axis (rounded down to a multiple of step). */
  min: number;
  /** Upper bound of the axis (rounded up to a multiple of step). */
  max: number;
  /** Step between adjacent ticks (a "nice" value: 1, 2, or 5 × 10^k). */
  step: number;
  /** Tick values from min → max, inclusive. Length = (max - min) / step + 1. */
  ticks: number[];
};

/**
 * Round a raw step up to the nearest "nice" value. Delegates the Heckbert
 * nice-number rule to the shared `niceNum` in `@m0saic/dsl-stdlib` (single
 * source of truth across the graph base), passing bar-graph's augmented set
 * `[1, 2, 2.5, 5]` so ranges like 0..120 resolve to step 25 (6 ticks) instead
 * of 50 (4 ticks).
 */
function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  return niceNum(rawStep, [1, 2, 2.5, 5]);
}

/**
 * Compute a "nice" axis (round-number ticks) covering [min..max] with
 * approximately `targetTickCount` ticks. Returns `min`, `max`, `step`, and
 * the full tick list min → max. The resulting axis is guaranteed to contain
 * the input range (niceMin ≤ min, niceMax ≥ max).
 *
 * Example: niceAxis(0, 85, 6) → { min: 0, max: 100, step: 20,
 *   ticks: [0, 20, 40, 60, 80, 100] }.
 *
 * @param min Raw lower bound.
 * @param max Raw upper bound.
 * @param targetTickCount Desired tick count including both endpoints.
 *                         The actual count may differ slightly so the step
 *                         stays a nice round number.
 */
export function niceAxis(min: number, max: number, targetTickCount: number): NiceAxis {
  if (max === min) {
    return { min, max: max + 1, step: 1, ticks: [min, max + 1] };
  }
  const range = Math.abs(max - min);
  const rawStep = range / Math.max(1, targetTickCount - 1);
  const step = niceStep(rawStep);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Use a small epsilon to handle floating-point drift at the upper bound.
  const eps = step * 1e-6;
  for (let v = niceMin; v <= niceMax + eps; v += step) {
    // Round to step's natural decimal precision to avoid "0.30000000000000004".
    ticks.push(Number(v.toFixed(6)));
  }
  return { min: niceMin, max: niceMax, step, ticks };
}
