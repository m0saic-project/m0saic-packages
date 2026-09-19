/**
 * ============================================================================
 * anim/timing — duration-fit timeline + shared time windows
 * ============================================================================
 *
 * Layer 1 of the motion kit: carving the one global clock `t` into per-step
 * windows. A timeline of N steps has a "natural" length driven purely by how
 * much there is to show:
 *
 *   natural = lead + stepCount·stepDur + trail
 *
 * When the render pins an explicit output duration, the WHOLE timeline is
 * uniformly rescaled to fit it EXACTLY — every component (lead, trail,
 * per-step hold, transition) multiplied by the same `k = target / natural`.
 * A dense walk pinned short runs proportionally faster and still shows every
 * step (no truncation); a sparse walk pinned long stretches instead of ending
 * in dead air. Because ratios are preserved, everything keyed off the same
 * windows (caret, camera, highlight, narration…) stays in lockstep at any
 * duration.
 *
 * Extracted from dsl-tutorial's `computeTiming` (its constants demoted to
 * defaults here); field-for-field parity at the defaults is locked by tests.
 * ============================================================================
 */

import type { MosaicEngineContext, MosaicTimeWindow } from "@m0saic/types";
import { DEFAULT_DURATION_MS } from "@m0saic/types";
import type { EaseName } from "./index";

/** Base seconds per step at speed 1.0 (dsl-tutorial's BASE_STEP_SEC). */
const DEFAULT_BASE_STEP_SEC = 0.9;
/** Lead pad before the first step. */
const DEFAULT_LEAD_SEC = 0.5;
/** Trail pad after the last step. */
const DEFAULT_TRAIL_SEC = 0.9;
/** Head cross-fade fraction of the step hold. */
const DEFAULT_TRANSITION_FRAC = 0.45;
/** Head cross-fade cap in seconds (at speed 1). */
const DEFAULT_TRANSITION_MAX_SEC = 0.35;

export type TimelineSpec = {
  stepCount: number;
  /** >1 = faster. Default 1. */
  speedMultiplier?: number;
  /**
   * Fit the WHOLE timeline (uniform rescale of every component) to exactly
   * this length. Omit/0 → the natural content-driven recommendation.
   */
  targetDurationMs?: number;
  /** Base seconds per step at speed 1. Default 0.9. */
  baseStepSec?: number;
  /** Lead pad before step 1. Default 0.5. */
  leadSec?: number;
  /** Trail pad after the last step. Default 0.9. */
  trailSec?: number;
  /** Head cross-fade: min(stepDur·frac, maxSec/speed). Default frac 0.45. */
  transitionFrac?: number;
  /** Head cross-fade cap (seconds, at speed 1). Default 0.35. */
  transitionMaxSec?: number;
};

/** The one timeline every animated element keys off (field-identical to
 *  dsl-tutorial's Timing). */
export type Timeline = {
  /** Number of steps (clamped to ≥1, rounded). */
  stepCount: number;
  /** Seconds each step holds. */
  stepDurSec: number;
  /** Seconds of cross-fade at the head of each step. */
  transitionSec: number;
  /** Lead pad seconds before step 1. */
  leadSec: number;
  /** Trail pad seconds after the last step. */
  trailSec: number;
  /** Total duration in ms (drives doc.durationMs; children inherit it). */
  durationMs: number;
  /** Start time (s) of step `i` (1-based; i<1 clamps to 1). */
  stepStartSec: (i: number) => number;
};

/**
 * Build the timeline for `spec.stepCount` steps. See the module header for
 * the natural-vs-pinned model. Deterministic: same spec → same timeline.
 */
export function computeTimeline(spec: TimelineSpec): Timeline {
  const {
    speedMultiplier = 1,
    targetDurationMs,
    baseStepSec = DEFAULT_BASE_STEP_SEC,
    leadSec: leadPadSec = DEFAULT_LEAD_SEC,
    trailSec: trailPadSec = DEFAULT_TRAIL_SEC,
    transitionFrac = DEFAULT_TRANSITION_FRAC,
    transitionMaxSec = DEFAULT_TRANSITION_MAX_SEC,
  } = spec;
  const speed = speedMultiplier > 0 ? speedMultiplier : 1;
  const steps = Math.max(1, Math.round(spec.stepCount));

  let stepDurSec = baseStepSec / speed;
  let transitionSec = Math.min(stepDurSec * transitionFrac, transitionMaxSec / speed);
  let leadSec = leadPadSec;
  let trailSec = trailPadSec;
  let durationSec = leadSec + steps * stepDurSec + trailSec;

  // Fit to the output duration: uniform rescale of every time component so the
  // timeline fills exactly `targetDurationMs` (no truncation, no dead air).
  if (targetDurationMs != null && targetDurationMs > 0 && durationSec > 0) {
    const k = targetDurationMs / 1000 / durationSec;
    stepDurSec *= k;
    transitionSec *= k;
    leadSec *= k;
    trailSec *= k;
    durationSec = targetDurationMs / 1000;
  }

  return {
    stepCount: steps,
    stepDurSec,
    transitionSec,
    leadSec,
    trailSec,
    durationMs: Math.round(durationSec * 1000),
    stepStartSec: (i: number) => leadSec + (Math.max(1, i) - 1) * stepDurSec,
  };
}

/**
 * Drawtext-safe expression for the CURRENT step number (a stepped/floored
 * integer that advances one per step window, clamped to `[0, total]`). Use as
 * the `expr` of an `eval:"frame"` text layer. Commas/colons are escaped for
 * `%{eif:…}` expansion.
 *
 * Step 0 = the lead (before step 1 begins); then 1..total.
 *
 * n(t) = clamp( 1 + floor((t - lead) / stepDur), 0, total )
 */
export function stepNumberExpr(t: Timeline, prefix = "", suffix = ""): string {
  const lead = t.leadSec.toFixed(4);
  const d = t.stepDurSec.toFixed(4);
  const total = t.stepCount;
  // eif:d truncates toward zero. During the lead, (t-lead)<0 → 1+frac ∈ (0,1) →
  // truncates to 0 (step 0). At/after step 1, the value is ≥1.
  const inner = `min(${total}\\,max(0\\,1+(t-${lead})/${d}))`;
  return `${prefix}%{eif\\:${inner}\\:d}${suffix}`;
}

/**
 * The ONE duration pin (Q1, gate-28 tree ruling): a render duration is
 * pinned ONLY by an explicit user ask — `ctx.userIntent.durationMs`
 * (CLI `--durationMs`; Make's Duration field when the user sets it).
 * `ctx.output.durationMs` is NEVER read as a pin anymore: hosts seed it
 * from the template's own `outputHints`, and treating that echo as an ask
 * silently stretched custom timing to fit the hint (the gate-27
 * search-typing class — 30ms/char typing stretched 5× by its own
 * default). Unpinned ⇒ the template follows its natural cadence.
 */
export function resolvePinnedDurationMs(ctx: MosaicEngineContext): number | undefined {
  const ask = ctx.userIntent?.durationMs;
  return typeof ask === "number" && Number.isFinite(ask) && ask > 0 ? ask : undefined;
}

/**
 * The ONE duration-follow resolver (Q3, gate-28 tree ruling): encodes the
 * "explicit ask wins, else follow the natural length" law that subtitle-burn,
 * search-typing, and highlights each hand-rolled with different spellings
 * (canonical original: subtitle-burn's gate-26 founder catch — "when i
 * dropped big buck bunny, it defaulted to 10 seconds instead of the duration
 * of the file").
 *
 * Precedence:
 * - **L0** — the explicit user ask ({@link resolvePinnedDurationMs}) wins;
 * - else follow the template's NATURAL length (`naturalMs` — a probed source
 *   duration, a last-cue end, a computed timeline), rounded to integer ms;
 *   invalid (missing / non-finite / <= 0) naturals are ignored;
 * - else the host-seeded render target (`ctx.target.durationMs` — typically
 *   echoing the template's own `outputHints`; a hint, never a pin).
 *
 * The follow only STICKS if the template AUTHORS the result onto
 * `doc.durationMs` (L1 — authored declarations out-rank hint-derived targets
 * at plan time, the gate-26 `stampDocOutput` law). Call this, then author it.
 */
export function resolveOutputDurationMs(
  ctx: MosaicEngineContext,
  opts: { naturalMs?: number } = {},
): number {
  const pinned = resolvePinnedDurationMs(ctx);
  if (pinned !== undefined) {
    return pinned;
  }
  const natural = opts.naturalMs;
  if (typeof natural === "number" && Number.isFinite(natural) && natural > 0) {
    return Math.round(natural);
  }
  return ctx.target.durationMs;
}

/** Default window length when neither `fraction` nor `ms` is given — 70% of
 *  the clip, the fleet's intro convention (stat-card et al.). */
export const DEFAULT_WINDOW_FRACTION = 0.7;

/** Concrete time window resolved against a render duration. */
export type ResolvedTimeWindow = {
  /** Window start (s) — `delayMs` in seconds. */
  startSec: number;
  /** Window ramp length (s). */
  durationSec: number;
  /** Per-item cascade (s), for templates that stagger. */
  staggerSec: number;
  /** Easing over the ramp. */
  ease: EaseName;
};

/**
 * Resolve a declarative {@link MosaicTimeWindow} against the render duration:
 * a parent passes ONE window spec (typically as an `intro` prop) to every
 * animated child and each resolves it identically — one source of truth, no
 * per-template prop translation. The resolved `{startSec, durationSec}` is
 * also exactly a UI timeline band (Make's TimelinePanel thinks in ms bands).
 *
 * `ms` overrides `fraction`; `fraction` is clamped to [0,1] of the duration;
 * negative delays/staggers clamp to 0. Defaults: 70% of the clip
 * ({@link DEFAULT_WINDOW_FRACTION}), no delay, no stagger, "easeOut" (the
 * count-up default — decelerate, premium feel).
 */
export function resolveWindow(
  window: MosaicTimeWindow | undefined,
  durationMs: number,
): ResolvedTimeWindow {
  const totalSec = Math.max(0, durationMs) / 1000;
  const durationSec =
    window?.ms != null
      ? Math.max(0, window.ms) / 1000
      : Math.min(1, Math.max(0, window?.fraction ?? DEFAULT_WINDOW_FRACTION)) * totalSec;
  return {
    startSec: Math.max(0, window?.delayMs ?? 0) / 1000,
    durationSec,
    staggerSec: Math.max(0, window?.staggerMs ?? 0) / 1000,
    ease: window?.ease ?? "easeOut",
  };
}
