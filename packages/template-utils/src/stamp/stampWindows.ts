/**
 * Pure window planning + variant selection for time-windowed stamps
 * (watermarks, QR stamps — any overlay that appears in windows over a
 * video and picks a light/dark variant per window).
 *
 * Given a source video's duration + a luminance probe of the stamp's
 * destination rect, produce a deterministic plan of when the stamp is
 * visible and which variant (light / dark) each appearance uses.
 *
 * Ported VERBATIM from `qr-stamp/video/v2/windows.ts` (which is now a
 * re-export shim over this module — its test suite staying green is
 * the parity proof), with the QR-specific names generalized:
 * `QrWindow` → `StampWindow`, `QrVariant` → `StampVariant`,
 * `qrNaturalDurMs` → `slotDurMs` (it was already a pure parameter —
 * the natural duration of one stamp appearance / animation loop).
 *
 * No IO, no engine types — just math against `LuminanceBucket[]`.
 */

import type { LuminanceBucket } from "@m0saic/types";

export type StampVariant = "light" | "dark";

export type StampWindow = {
  /** Inclusive ms on the OUTPUT timeline when the stamp becomes visible. */
  startMs: number;
  /** Exclusive ms on the OUTPUT timeline when the stamp disappears. */
  endMs: number;
  /** Which variant this window uses. */
  variant: StampVariant;
};

export type PlanStampWindowsOpts = {
  /** Duration of the input video, ms. */
  videoDurMs: number;
  /** Natural duration of one stamp appearance (animation loop / slot width), ms. */
  slotDurMs: number;
  /** Region luminance probe (typically 500ms-bucketed). May be empty. */
  luminanceBuckets: LuminanceBucket[];
  /** Override the coverage tier. Fraction in [0, 1]. */
  coverageOverride?: number;
  /**
   * Minimum gap between consecutive multi-window stamps, ms. Back-to-back
   * outro-and-respawn on adjacent slots feels twitchy — this forces at
   * least `ceil((slotDur+minGap)/slotDur)` empty slots between picks.
   * When the requested # of windows can't fit with this gap, planWindows
   * falls back to single-window mode (one retimed playback) rather than
   * cramming windows next to each other. Default 3000ms.
   */
  minGapMs?: number;
  /**
   * Minimum window duration for single-window mode (readability floor).
   * Default 1500.
   */
  minSingleWindowDurMs?: number;
  /**
   * Luminance threshold (0..255) above which the region counts as "bright"
   * → light variant (cohesion); at or below → dark variant. Default 128.
   */
  variantThreshold?: number;
};

export type PlanStampWindowsResult = {
  windows: StampWindow[];
  /**
   * Uniform playback-speed multiplier applied to ALL stamp sources in this
   * plan. Only meaningful for ANIMATED stamps (the QR consumer):
   * - Multi-window mode: always 1.0 (windows are slot-aligned to the loop).
   * - Single-window mode: `slotDurMs / windowDurMs` so the animation
   *   stretches (or compresses) to fill the chosen window.
   * Static-artwork consumers (the watermark) ignore it.
   */
  playbackSpeed: number;
};

/**
 * Coverage tiers — fraction of the output the stamp is on-screen for.
 *
 * Bumped up for the longer tiers (≤60s and above) after the original
 * spec values felt under-stamped — a 45s render at the old 35% tier
 * produced only two 7s appearances, which read as "barely there"
 * given the 30+ seconds of unstamped base video between them. The
 * short-clip tiers (≤8s, ≤20s) are unchanged because they collapse
 * to single-window mode where the stamp already dominates the frame.
 *
 *   ≤   8s   → 90% — one retimed single window covering most of clip
 *   ≤  20s   → 62.5%
 *   ≤  60s   → 55% (was 35%)
 *   ≤   5m   → 32% (was 17.5%)
 *   >   5m   → 18% (was 8.5%)
 *
 * Effective coverage is capped by the `minGapMs` constraint — at high
 * tiers + high source durations, the gap-respecting `maxK` may force
 * fewer windows than requested. The picked count is `min(requestedK,
 * maxK)`; coverage degrades gracefully rather than cramming.
 */
const COVERAGE_TIERS: ReadonlyArray<{ maxDurMs: number; coverage: number }> = [
  { maxDurMs:    8_000, coverage: 0.90 },
  { maxDurMs:   20_000, coverage: 0.625 },
  { maxDurMs:   60_000, coverage: 0.55 },
  { maxDurMs:  300_000, coverage: 0.32 },
  { maxDurMs: Number.POSITIVE_INFINITY, coverage: 0.18 },
];

const DEFAULT_VARIANT_THRESHOLD = 128;
const DEFAULT_MIN_SINGLE_WINDOW_MS = 1500;
const DEFAULT_MIN_GAP_MS = 3000;

export function pickCoverage(videoDurMs: number): number {
  for (const tier of COVERAGE_TIERS) {
    if (videoDurMs <= tier.maxDurMs) return tier.coverage;
  }
  // Shouldn't reach — last tier has Infinity max — but guard regardless.
  return COVERAGE_TIERS[COVERAGE_TIERS.length - 1]!.coverage;
}

/**
 * Average luminance of `buckets` weighted by their overlap with [startMs, endMs).
 * Returns 128 (neutral) if no buckets overlap, so missing probes degrade safely.
 */
export function avgLumaForWindow(
  buckets: LuminanceBucket[],
  startMs: number,
  endMs: number,
): number {
  let weightedSum = 0;
  let weight = 0;
  for (const b of buckets) {
    const overlap = Math.min(b.endMs, endMs) - Math.max(b.startMs, startMs);
    if (overlap <= 0) continue;
    weightedSum += b.avgLuma * overlap;
    weight += overlap;
  }
  return weight > 0 ? weightedSum / weight : DEFAULT_VARIANT_THRESHOLD;
}

/**
 * Pick the variant whose artwork tones with the underlying region.
 *
 * This is a *cohesion* mapping, not a contrast one:
 *
 *   Bright region (high YAVG)  → light variant (artwork made for bright frames)
 *   Dark region   (low YAVG)   → dark variant  (artwork made for dark frames)
 */
export function pickVariantForWindow(
  buckets: LuminanceBucket[],
  startMs: number,
  endMs: number,
  threshold = DEFAULT_VARIANT_THRESHOLD,
): StampVariant {
  const avg = avgLumaForWindow(buckets, startMs, endMs);
  return avg >= threshold ? "light" : "dark";
}

export function planStampWindows(opts: PlanStampWindowsOpts): PlanStampWindowsResult {
  const {
    videoDurMs,
    slotDurMs,
    luminanceBuckets,
  } = opts;
  if (!Number.isFinite(videoDurMs) || videoDurMs <= 0) {
    throw new Error(
      `planStampWindows: videoDurMs must be > 0 (got ${videoDurMs})`,
    );
  }
  if (!Number.isFinite(slotDurMs) || slotDurMs <= 0) {
    throw new Error(
      `planStampWindows: slotDurMs must be > 0 (got ${slotDurMs})`,
    );
  }

  const coverage =
    opts.coverageOverride !== undefined
      ? clamp01(opts.coverageOverride)
      : pickCoverage(videoDurMs);
  const threshold = opts.variantThreshold ?? DEFAULT_VARIANT_THRESHOLD;
  const minSingleWindowDurMs =
    opts.minSingleWindowDurMs ?? DEFAULT_MIN_SINGLE_WINDOW_MS;
  const minGapMs = opts.minGapMs ?? DEFAULT_MIN_GAP_MS;

  const totalVisibleMs = videoDurMs * coverage;

  // Slot inventory + gap math. Each "window slot" in multi-window mode
  // is `slotDurMs` wide; we require ≥ `minGapMs` of base-video
  // breathing room between consecutive windows, so successive picks
  // must be at least `slotIncrement` slots apart.
  const numAvailableSlots = Math.max(
    1,
    Math.floor(videoDurMs / slotDurMs),
  );
  const slotIncrement = Math.max(
    1,
    Math.ceil((slotDurMs + minGapMs) / slotDurMs),
  );
  const maxK =
    Math.floor((numAvailableSlots - 1) / slotIncrement) + 1;
  const requestedK = Math.max(
    1,
    Math.round(totalVisibleMs / slotDurMs),
  );

  // ── Single-window mode ───────────────────────────────────────────
  // Used when we don't have room for ≥ 2 gap-separated windows, OR
  // the requested coverage only asks for one playthrough. The single
  // window's playback is retimed (`playbackSpeed`) so an animated
  // stamp fills the desired coverage time. This is the "extend the
  // first one to run longer" path — when multi-window can't fit with
  // the gap requirement, the user gets one longer appearance covering
  // the same total visible time instead of two crammed adjacent ones.
  if (requestedK <= 1 || maxK <= 1) {
    const windowDurMs = clamp(
      Math.round(totalVisibleMs),
      minSingleWindowDurMs,
      videoDurMs,
    );
    // Anchor at t=0 — the engine has no source-scheduling primitive,
    // and the stamp's own fade/spawn-in handles graceful entry.
    const startMs = 0;
    const endMs = Math.min(videoDurMs, windowDurMs);
    return {
      windows: [
        {
          startMs,
          endMs,
          variant: pickVariantForWindow(
            luminanceBuckets,
            startMs,
            endMs,
            threshold,
          ),
        },
      ],
      playbackSpeed: slotDurMs / windowDurMs,
    };
  }

  // ── Multi-window mode ────────────────────────────────────────────
  // Slot-align to multiples of slotDurMs so each window catches one
  // full loop cycle (loop period == window width at playbackSpeed=1).
  // Distribute K windows evenly across N slots; `K ≤ maxK` guarantees
  // every adjacent pair is at least `slotIncrement` slots apart, so
  // the gap constraint is satisfied without further enforcement.
  const K = Math.min(requestedK, maxK);
  const windows: StampWindow[] = [];
  for (let i = 0; i < K; i += 1) {
    const slotIdx =
      K === 1
        ? Math.floor((numAvailableSlots - 1) / 2)
        : Math.round((i * (numAvailableSlots - 1)) / (K - 1));
    const startMs = slotIdx * slotDurMs;
    const endMs = startMs + slotDurMs;
    windows.push({
      startMs,
      endMs,
      variant: pickVariantForWindow(
        luminanceBuckets,
        startMs,
        endMs,
        threshold,
      ),
    });
  }

  return { windows, playbackSpeed: 1.0 };
}

/**
 * Partition windows by variant. Used by renderers to instantiate at most
 * two overlay sources (one per used variant), each ramped by its own
 * windows' alpha expression.
 */
export function groupWindowsByVariant(
  windows: StampWindow[],
): Record<StampVariant, StampWindow[]> {
  const light: StampWindow[] = [];
  const dark: StampWindow[] = [];
  for (const w of windows) {
    (w.variant === "light" ? light : dark).push(w);
  }
  return { light, dark };
}

export type BuildWindowsAlphaExprOpts = {
  /** Peak alpha during the plateau, 0..1. Default 1.0. */
  peakAlpha?: number;
  /** Linear fade-in duration at each window's start, seconds. Default 0.4. */
  fadeInSec?: number;
  /** Linear fade-out duration at each window's end, seconds. Default 0.4. */
  fadeOutSec?: number;
};

/**
 * Build an ffmpeg `alpha` expression that ramps the stamp in / out at every
 * window boundary so the artwork fades cleanly. Without this the enable
 * gate hard-cuts the stamp on the last frame of each window — visible as
 * a snap on/off. NEVER pair this with `overlay.enable` — the engine
 * collapses enable+alpha into one multiplied expression and hard-cuts
 * the ramp.
 *
 * Shape per window (linear ramps via `min` of two clipped slopes):
 *
 *   alpha_w(t) = min(
 *     clip((t - startSec)  / fadeInSec,  0, 1),
 *     clip((endSec - t)    / fadeOutSec, 0, 1),
 *   )
 *
 * Across N non-overlapping windows we sum the per-window terms and clip to
 * `peakAlpha`. Since windows never overlap by construction (single-window
 * mode has one; multi-window mode is slot-aligned and de-duped), the sum is
 * either 0 (between windows) or a single non-zero term (inside one).
 *
 * Empty → `undefined` (caller should skip the overlay entirely).
 */
export function buildWindowsAlphaExpr(
  windows: StampWindow[],
  opts: BuildWindowsAlphaExprOpts = {},
): string | undefined {
  if (windows.length === 0) return undefined;
  const peakAlpha = opts.peakAlpha ?? 1;
  const fadeInSec = opts.fadeInSec ?? 0.4;
  const fadeOutSec = opts.fadeOutSec ?? 0.4;

  const fixed = (n: number) => n.toFixed(3);
  const terms = windows.map((w) => {
    const s = fixed(w.startMs / 1000);
    const e = fixed(w.endMs / 1000);
    const fadeIn = `clip((t-${s})/${fixed(fadeInSec)},0,1)`;
    const fadeOut = `clip((${e}-t)/${fixed(fadeOutSec)},0,1)`;
    return `min(${fadeIn},${fadeOut})`;
  });

  const sum = terms.length === 1 ? terms[0]! : terms.join("+");
  return `${fixed(peakAlpha)}*clip(${sum},0,1)`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}
