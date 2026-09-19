/**
 * ============================================================================
 * dsl-tutorial — timing model
 * ============================================================================
 *
 * Pure, deterministic mapping from (step count, speed) → the one timeline every
 * panel keys off. There is no per-output-frame JS callback; all animation is
 * ffmpeg expressions over these precomputed windows, so the camera, caret, diff
 * fields, highlight, and step pill all move together.
 *
 * Time is global `t` (seconds). A step `i` (1-based) owns the window
 * `[stepStartSec(i), stepStartSec(i) + stepDurSec)`, with a short transition at
 * its head where values cross-fade old→new.
 * ============================================================================
 */

/** Base seconds per step at speed 1.0 (before the speed multiplier). */
const BASE_STEP_SEC = 0.9;
/** Auto pacing: walks of at most this many steps run at 1× (a lesson is READ). */
const AUTO_SPEED_UNIT_STEPS = 24;
/** Auto pacing ceiling — a huge layout still assembles at a watchable rate. */
const AUTO_SPEED_MAX = 15;
/** Lead pad before the first step. */
const LEAD_SEC = 0.5;
/** Trail pad after the last step. */
const TRAIL_SEC = 0.9;

export type Timing = {
  /** Number of steps (== Step[].length). */
  stepCount: number;
  /** Seconds each step holds. */
  stepDurSec: number;
  /** Seconds of cross-fade at the head of each step. */
  transitionSec: number;
  /** Lead pad seconds before step 1. */
  leadSec: number;
  /** Trail pad seconds after the last step. */
  trailSec: number;
  /** Total video duration in ms (drives doc.durationMs; children inherit it). */
  durationMs: number;
  /** Start time (s) of step `i` (1-based). */
  stepStartSec: (i: number) => number;
};

/**
 * Build the timeline for `stepCount` steps at `speedMultiplier` (>1 = faster).
 *
 * The "natural" duration is the recommendation derived purely from how much
 * there is to paint: `lead + steps·stepDur + trail`. When `targetDurationMs` is
 * supplied (the render's authoritative output length), the WHOLE timeline is
 * uniformly rescaled to fit it EXACTLY — every component (lead, trail, per-step
 * hold, transition) multiplied by the same factor `k = target / natural`. So a
 * dense 64-tile walk pinned to 30s simply runs proportionally faster and still
 * paints every tile, instead of being truncated mid-walk; a sparse walk pinned
 * to a long duration stretches to fill it instead of ending in dead air. Ratios
 * (transition vs. step) are preserved, so caret/fields/highlight/camera stay in
 * lockstep at any duration.
 *
 * @param targetDurationMs  when >0, fit the timeline to exactly this length;
 *   omit (or 0) to use the natural tile-count-driven recommendation.
 */
/**
 * Speed multiplier for a walk whose author left `speedMultiplier` unset
 * (founder direction 2026-09-05): 1× up to {@link AUTO_SPEED_UNIT_STEPS} steps —
 * a lesson-sized layout is read at a comfortable pace, numbers and all — then the
 * SQUARE ROOT of the step count over that unit (a 4× bigger layout runs 2×
 * faster), capped at {@link AUTO_SPEED_MAX}. Nobody reads the numbers on a
 * 5,000-step walk; it is watched as an ASSEMBLY, so the pace follows the size:
 *   16 → 1×, 96 → 2×, 243 → 3.2×, 1000 → 6.5×, 2400 → 10×, ≥ 5400 → 15×.
 * Pure and monotonic; an explicit `speedMultiplier` is absolute and bypasses it.
 */
export function autoSpeed(stepCount: number): number {
  const steps = Math.max(1, Math.round(stepCount));
  return Math.min(AUTO_SPEED_MAX, Math.max(1, Math.sqrt(steps / AUTO_SPEED_UNIT_STEPS)));
}

/**
 * Pacing TIERS (founder direction 2026-09-05), picked by the PRETTY string's
 * character count — a plain proxy for how busy the canvas is:
 *  - **teach** (≤ {@link TEACH_MAX_CHARS} chars) — the hero experience: show
 *    everything, read it. Natural length at 1× (auto up to 2× for the bigger
 *    lessons).
 *  - **summarize** (≤ {@link SUMMARIZE_MAX_CHARS}) — "watch the renderer paint":
 *    the whole walk fits {@link SUMMARIZE_TARGET_MS}; passthrough / null visuals
 *    go light; the camera stays on the full layout.
 *  - **sloth** (beyond) — tens of thousands of characters, not what the template
 *    is for: {@link SLOTH_TARGET_MS}, passthroughs not drawn at all, no labels.
 * An explicit `speedMultiplier` or a pin (user ask) still wins in every tier.
 */
export type PaceTier = "teach" | "summarize" | "sloth";
export const TEACH_MAX_CHARS = 400;
export const SUMMARIZE_MAX_CHARS = 8000;
/** The ABSOLUTE ceiling (founder ruling 2026-09-06): past this many characters the
 *  tutorial refuses outright, at any output size. The 52k-char / 26k-passthrough
 *  dictionary pick rendered at 4K (the only size whose canvas panel clears its
 *  1874×1080 floor) took 93 minutes for 20 s and "is clearly not the intended use
 *  case" — the template is not the tool for a layout that size (Layout is).
 *  Why chars: every character is a step, and the per-step work is what scales —
 *  the cursor track is one drawbox per cursor move in ONE lavfi chain, and ffmpeg
 *  walks that chain per frame at a cost QUADRATIC in its length (measured 09-06 at
 *  the 1330×750 panel: 1k boxes 13 ms/frame, 4k 105 ms, 8k 410 ms); a passthrough-
 *  heavy layout moves the cursor on every comma, ~half its characters. 16k chars
 *  (2× the sloth line) keeps a 20 s sloth walk's canvas around 4 min at 1080p under
 *  that model, and the DSL strip (the next wall, O(chars)) in the same order. */
export const MAX_CHARS = 16_000;
/** The ABSOLUTE frame (tile) ceiling (founder, 2026-09-06: "no need to try and render
 *  something with way too many frames"). Past the canvas's reveal-curtain budget
 *  (`CURTAIN_BOX_BUDGET`, 6,000 boxes) every tile is visible from t=0 and the
 *  tile-by-tile reveal — the lesson — is gone, so the walk is refused at the same
 *  line rather than rendered without it. The 272×272 brand bitmap is 36,770 frames. */
export const MAX_FRAMES = 6_000;
/** Teach never runs faster than this (auto pacing is for READING here). */
const TEACH_MAX_AUTO_SPEED = 2;
export const SUMMARIZE_TARGET_MS = 30_000;
export const SLOTH_TARGET_MS = 20_000;

export function resolveTier(chars: number, override?: "auto" | PaceTier): PaceTier {
  if (override && override !== "auto") return override;
  return chars <= TEACH_MAX_CHARS ? "teach" : chars <= SUMMARIZE_MAX_CHARS ? "summarize" : "sloth";
}

/** The one timeline for a walk: pin > explicit speed > tier. */
export function tierTiming(opts: {
  stepCount: number;
  tier: PaceTier;
  fps: number;
  speedMultiplier?: number;
  pinnedMs?: number;
}): Timing {
  const { stepCount, tier, fps, speedMultiplier, pinnedMs } = opts;
  if (pinnedMs != null && pinnedMs > 0) return computeTiming(stepCount, speedMultiplier ?? 1, pinnedMs, fps);
  if (speedMultiplier != null && speedMultiplier > 0) return computeTiming(stepCount, speedMultiplier, undefined, fps);
  if (tier === "teach") return computeTiming(stepCount, Math.min(autoSpeed(stepCount), TEACH_MAX_AUTO_SPEED), undefined, fps);
  const target = tier === "summarize" ? SUMMARIZE_TARGET_MS : SLOTH_TARGET_MS;
  const natural = computeTiming(stepCount, 1, undefined, fps);
  return natural.durationMs <= target ? natural : computeTiming(stepCount, 1, target, fps);
}

export function computeTiming(
  stepCount: number,
  speedMultiplier: number,
  targetDurationMs?: number,
  fps = 30,
): Timing {
  const speed = speedMultiplier > 0 ? speedMultiplier : 1;
  const steps = Math.max(1, Math.round(stepCount));

  let stepDurSec = BASE_STEP_SEC / speed;
  let transitionSec = Math.min(stepDurSec * 0.45, 0.35 / speed);
  let leadSec = LEAD_SEC;
  let trailSec = TRAIL_SEC;
  let durationSec = leadSec + steps * stepDurSec + trailSec;

  // Fit to the output duration: uniform rescale of every time component so the
  // walk fills exactly `targetDurationMs` (no truncation, no trailing dead air).
  if (targetDurationMs != null && targetDurationMs > 0 && durationSec > 0) {
    const targetSec = targetDurationMs / 1000;
    if (targetSec < durationSec && targetSec > leadSec + trailSec + steps * 0.001) {
      // COMPRESSING (a pin or a tier target shorter than the natural length): only
      // the per-step pace compresses; the lead and the closing hold stay ABSOLUTE,
      // so the finished layout is held at the end however hard the walk was
      // squeezed (a uniform squeeze of a 5k-step walk into 20 s left a 4 ms hold
      // and a still-zoomed last frame — 2026-09-05). STRETCHING keeps the uniform
      // rescale below, so a sparse walk fills a long pin without dead air.
      stepDurSec = (targetSec - leadSec - trailSec) / steps;
      transitionSec = Math.min(stepDurSec * 0.45, 0.35);
    } else {
      const k = targetSec / durationSec;
      stepDurSec *= k;
      transitionSec *= k;
      leadSec *= k;
      trailSec *= k;
    }
    durationSec = targetSec;
  } else if (fps > 0) {
    // Snap the NATURAL length UP to a whole frame, and its ms UP past that frame's
    // end. The panels are nested video children the engine trims with `-t`, which
    // keeps a frame only when it ENDS inside the trim; the parent takes
    // round(duration × fps) frames. A duration between those (132.417 s at 30 fps:
    // parent 3973 frames, children 3972) makes the parent's last frame read past
    // its children and LOOP to their first frame — "Step 0" as the closing frame
    // (2026-09-05). Whole-frame lengths (15.8 s = 474 frames) never showed it.
    const frames = Math.ceil(durationSec * fps - 1e-6);
    const snappedSec = Math.ceil((frames * 1000) / fps - 1e-6) / 1000;
    trailSec += snappedSec - durationSec; // the slack rides on the closing hold
    durationSec = snappedSec;
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
 * Step 0 = the lead (the unparsed canvas, before step 1 begins); then 1..total.
 *
 * n(t) = clamp( 1 + floor((t - lead) / stepDur), 0, total )
 */
export function stepNumberExpr(t: Timing, prefix = "", suffix = ""): string {
  const lead = t.leadSec.toFixed(4);
  const d = t.stepDurSec.toFixed(4);
  const total = t.stepCount;
  // eif:d truncates toward zero. During the lead, (t-lead)<0 → 1+frac ∈ (0,1) →
  // truncates to 0 (step 0). At/after step 1, the value is ≥1.
  const inner = `min(${total}\\,max(0\\,1+(t-${lead})/${d}))`;
  return `${prefix}%{eif\\:${inner}\\:d}${suffix}`;
}
