/**
 * ============================================================================
 * @m0saic/charts/bar-graph — Animation Helpers (Contract + Signatures)
 * ============================================================================
 *
 * RESPONSIBILITY:
 *   Central home for the animation *contract* used by the HERO bar graph.
 *
 * CANONICAL RULE:
 *   - BarFill is the ONLY template that should generate FFmpeg expressions
 *     for animated bar fill. (No scattered math in BarsStack/BarCell/etc.)
 *
 * WHY THIS EXISTS:
 *   Animation math must be centralized so that:
 *     1) Orientation/layout templates stay “boring”.
 *     2) Timing + easing behavior is canonical across the entire HERO chart.
 *     3) Easing/timing can be unit-tested independently of rendering.
 *     4) Adding a new ease curve requires changing only this file (and BarFill).
 *
 * TIME UNITS:
 *   Seconds (not ms). This matches:
 *   - FFmpeg’s `t`
 *   - overlay.startAtSec / enable expressions
 *   - your existing templates (AnimatedWireframe, etc.)
 *
 * PRODUCTION BEHAVIOR (eventually):
 *   computeBarTiming(index, anim) → { startAtSec, endAtSec }
 *   easingExpr(ease, u) → FFmpeg-safe expression that maps u∈[0..1] → eased∈[0..1]
 *   fillFractionExpr(targetFraction, timing, anim) → expression yielding fillFraction∈[0..1]
 *
 * GUIDELINES:
 *   - NO side effects, NO template registration, NO rendering logic.
 *   - All functions must be PURE and deterministic.
 *   - FFmpeg expressions must be safe (parenthesized, no semicolons).
 *   - Boundary stability: u(0)=0, u(1)=1, no NaNs, no negative surprises.
 * ============================================================================
 */

import type { AnimConfig, EaseName } from "./types";

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export type BarTiming = {
  /** Absolute start time (sec) for this bar's intro animation. */
  startAtSec: number;
  /** Absolute end time (sec) for this bar's intro animation. */
  endAtSec: number;
};

/**
 * Compute the absolute start/end timestamps for a bar's intro animation.
 *
 * PRODUCTION:
 *   startAtSec = intro.delaySec + (index * intro.staggerSec)
 *   endAtSec   = startAtSec + intro.durationSec
 */
export function computeBarTiming(index: number, anim: AnimConfig): BarTiming {
  const startAtSec = anim.intro.delaySec + index * anim.intro.staggerSec;
  const endAtSec = startAtSec + anim.intro.durationSec;
  return { startAtSec, endAtSec };
}

// ---------------------------------------------------------------------------
// Easing expressions (FFmpeg-safe)
// ---------------------------------------------------------------------------

/**
 * Generate an FFmpeg expression string for the named easing function.
 *
 * PRODUCTION INTENT:
 *   - linear:     u
 *   - smoothstep: u*u*(3-2*u)
 *   - easeInOut:  (may be same as smoothstep for v1, or a different canonical polynomial)
 *
 * @param ease - Easing function name (must match types.ts)
 * @param uVar - The normalized progress variable name in the expression (default "u")
 */
export function easingExpr(ease: EaseName, uVar: string = "u"): string {
  // Scaffold only — BarFill will own actual expression generation first.
  // We still provide a safe default that won't break if called accidentally.
  if (ease === "smoothstep") return `(${uVar})*(${uVar})*(3-2*(${uVar}))`;
  if (ease === "easeInOut") return `(${uVar})*(${uVar})*(3-2*(${uVar}))`;
  return `${uVar}`; // linear
}

// ---------------------------------------------------------------------------
// Fill fraction expression (placeholder)
// ---------------------------------------------------------------------------

/**
 * Build an FFmpeg expression for a bar's fill fraction.
 *
 * CANONICAL INTENT:
 *   If reduceMotion:
 *     return constant target fraction: `${fraction}`
 *
 *   Otherwise:
 *     - Map time t into normalized u in [0..1] over [startAtSec..endAtSec]
 *     - Apply easing to u
 *     - Multiply by target fraction
 *     - Clamp to [0..fraction]
 *
 * NOTE (scaffold):
 *   We only return the reduceMotion constant today.
 *   The animated expression will be implemented in BarFill (the sole owner
 *   of FFmpeg fill math), potentially using helper pieces from this file.
 */
export function fillFractionExpr(
  fraction: number,
  _timing: BarTiming,
  anim: AnimConfig,
): string {
  if (anim.reduceMotion) return `${fraction}`;
  // Placeholder: returning empty string forces BarFill to supply its own math for now.
  return "";
}