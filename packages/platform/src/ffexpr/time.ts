/**
 * Pure expression-building helpers for ffmpeg time variables.
 *
 * Templates write expressions using `lt` (local time) and `t` (global time).
 * No escaping or quoting here — these produce raw expression strings
 * that later pass through ffmpeg.ts for quoting at the boundary.
 */

import type { MosaicOverlayExpr } from "@m0saic/types";

/** The two time variables available in m0saic expressions. */
export type TimeVar = "t" | "lt";

/**
 * Build an enable expression for a local time window.
 *
 * @example enableLocalWindow(2) => "between(lt,0,2)"
 */
export function enableLocalWindow(durSec: number | string): string {
  return `between(lt,0,${durSec})`;
}

/**
 * Build an enable expression using global time boundaries.
 *
 * @example enableGlobalWindow(1, 3) => "between(t,1,3)"
 */
export function enableGlobalWindow(
  startSec: number | string,
  endSec: number | string,
): string {
  return `between(t,${startSec},${endSec})`;
}

/**
 * Wrap an expression so its value is clamped to [0, 1].
 *
 * @example clamp01("lt/2") => "min(1,max(0,lt/2))"
 */
export function clamp01(x: string): string {
  return `min(1,max(0,${x}))`;
}

/**
 * Build a 0→1 progress ramp over `durSec` seconds.
 *
 * Uses `lt` by default so the ramp is relative to `startAtSec`.
 * Result is clamped to [0, 1].
 *
 * @example u01(2)        => "min(1,max(0,lt/2))"
 * @example u01(2, "t")   => "min(1,max(0,t/2))"
 */
export function u01(durSec: number | string, timeVar: TimeVar = "lt"): string {
  return `min(1,max(0,${timeVar}/${durSec}))`;
}

/**
 * Create a partial overlay with just `startAtSec`.
 *
 * Convenience for templates that want to set the local time origin.
 */
export function localStartAt(
  startAtSec: number,
): Pick<MosaicOverlayExpr, "startAtSec"> {
  return { startAtSec };
}
