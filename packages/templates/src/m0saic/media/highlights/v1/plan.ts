/**
 * Pure math + naming for `@m0saic/media/highlights/v1`.
 *
 * No IO, no ffmpeg, no ctx — everything here is unit-testable in
 * isolation (trickplay's `plan.ts` precedent). Range parsing/clamping
 * itself lives in `@m0saic/template-utils` (`parseTimeRangesValue` /
 * `normalizeTimeRanges`) so the next ranges-consuming template reuses
 * it; this module owns what is highlights-specific: step naming, label
 * derivation, and output-canvas sizing.
 */

export type HighlightsOutputFormat = "mp4" | "webm";

/** Resolved knobs a step needs (validated once by the template). */
export type HighlightsKnobs = {
  outputFormat: HighlightsOutputFormat;
  /** Optional downscale cap (px). Never upscales. */
  maxWidth?: number;
  muteAudio: boolean;
};

/** Step name for range `rangeIndex` (0-based → `__range_01`). Positional
 * across ALL ranges including invalid slots, so names stay stable. */
export function rangeStepName(stepBaseName: string, rangeIndex: number): string {
  return `${stepBaseName}__range_${String(rangeIndex + 1).padStart(2, "0")}`;
}

/** Input basename without directory or extension — the label base.
 * Local (not node:path) so the template stays web-bundle clean. */
export function inputLabel(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Seconds with one decimal, for default labels: 5300 → "5.3s". */
export function fmtRangeSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Filename-safe label: path-hostile characters collapse to `_`
 * (`expandOutputPattern` does NOT sanitize `{{label}}`), trimmed,
 * capped at 64 chars. Returns "" when nothing survives — callers
 * fall back to {@link defaultRangeLabel}.
 */
export function sanitizeLabel(label: string): string {
  return label
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** Default per-range label: `<input>_<start>-<end>` (e.g. `hero_1_0.5s-2.0s`). */
export function defaultRangeLabel(inputBase: string, startMs: number, endMs: number): string {
  return sanitizeLabel(`${inputBase}_${fmtRangeSeconds(startMs)}-${fmtRangeSeconds(endMs)}`);
}

/** Nearest even integer ≥ 2 (yuv420p-safe dimensions). */
export function evenRound(v: number): number {
  return Math.max(2, Math.round(v / 2) * 2);
}

/**
 * Output canvas from probed source dims: even-rounded always, and
 * aspect-preservingly downscaled when `maxWidth` is set below the
 * source width. Never upscales.
 */
export function scaleToMaxWidth(
  width: number,
  height: number,
  maxWidth?: number,
): { width: number; height: number } {
  if (maxWidth != null && maxWidth > 0 && width > maxWidth) {
    const scale = maxWidth / width;
    return { width: evenRound(maxWidth), height: evenRound(height * scale) };
  }
  return { width: evenRound(width), height: evenRound(height) };
}
