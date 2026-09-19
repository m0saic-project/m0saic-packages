/**
 * ============================================================================
 * hero/ffmpeg-pulse — pack theme tokens
 * ============================================================================
 *
 * The FFmpeg Weekly Pulse hero is a single, dark, GitHub-flavored look: a deep
 * slate canvas (#0d1117), #161b22 cards with hairline borders, restrained green
 * accents, and a scattered field of dark/green rectangles behind every beat.
 *
 * Every beat-chrome + nested viz pulls its colors from ONE {@link PulseTheme}
 * so the whole pack reads as one set. The nested Alpine cards are themed via
 * their `dark` preset + color props passed from these tokens, so the composed
 * panels match the chrome.
 * ============================================================================
 */

import type { MosaicColor } from "@m0saic/types";

/** One coherent FFmpeg-Pulse look. Consumed by the chrome + every beat. */
export type PulseTheme = {
  // ── Surfaces ──
  /** Page/canvas behind everything. */
  canvas: MosaicColor;
  /** Card / panel surface. */
  card: MosaicColor;
  /** Hairline border color. */
  border: MosaicColor;
  /** Border opacity (0..1). */
  borderAlpha: number;

  // ── Text ──
  /** "BEAT N" eyebrow label (green). */
  eyebrow: MosaicColor;
  /** Big beat title (near-white). */
  title: MosaicColor;
  /** Subtitle under the title (muted). */
  subtitle: MosaicColor;
  /** In-panel labels. */
  label: MosaicColor;
  /** Footer / de-emphasized text. */
  muted: MosaicColor;

  // ── Accents ──
  /** Brand green (darker fills). */
  primary: MosaicColor;
  /** Bright green (highlights, markers). */
  primaryBright: MosaicColor;
  /** Positive delta / up-trend. */
  positive: MosaicColor;
  /** Negative delta / down-trend. */
  negative: MosaicColor;

  // ── Chrome ──
  /** Gridline color. */
  grid: MosaicColor;
  /** Gridline opacity (0..1). */
  gridAlpha: number;

  // ── Background scatter ──
  /** Dark rectangle shades for the background field. */
  scatterDark: MosaicColor[];
  /** Occasional green accents in the background field. */
  scatterGreen: MosaicColor[];

  // ── Shape ──
  /** Corner radius as a fraction of the shorter side (0..1). */
  cornerRadius: number;
};

/**
 * Categorical ramp for multi-segment marks (donut slices, area legend).
 * Index 0 is the primary green; cycle for additional series. Mirrors the
 * storyboard's "changes by area" colors.
 */
export const PULSE_PALETTE: MosaicColor[] = [
  "#2ea043", // green (libavcodec)
  "#238636", // dark green (libavformat)
  "#3fb950", // bright green (libavfilter)
  "#d29922", // amber (doc)
  "#8957e5", // violet (tests)
  "#6e7681", // grey (other)
];

const PULSE_DARK: PulseTheme = {
  canvas: "#0d1117",
  card: "#161b22",
  border: "#30363d",
  borderAlpha: 1,
  eyebrow: "#3fb950",
  title: "#f0f6fc",
  subtitle: "#8b949e",
  label: "#c9d1d9",
  muted: "#8b949e",
  primary: "#238636",
  primaryBright: "#3fb950",
  positive: "#3fb950",
  negative: "#f85149",
  grid: "#21262d",
  gridAlpha: 1,
  scatterDark: ["#161b22", "#1c2128", "#21262d", "#272e36"],
  scatterGreen: ["#238636", "#2ea043", "#196c2e"],
  cornerRadius: 0.06,
};

/** Preset id union. The pack ships a single dark look today; structured for
 *  extension (a light variant could follow without changing call sites). */
export type PulsePreset = "dark";

export const PULSE_PRESETS: Record<PulsePreset, PulseTheme> = {
  dark: PULSE_DARK,
};

/** Resolve a preset id to its theme (defaults to `dark`). */
export function pulseTheme(preset?: PulsePreset): PulseTheme {
  return PULSE_PRESETS[preset ?? "dark"];
}
