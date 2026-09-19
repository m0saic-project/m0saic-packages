/**
 * ============================================================================
 * @m0saic/charts/bar-graph — Defaults + Canonical Tokens
 * ============================================================================
 *
 * RESPONSIBILITY:
 *   Central home for:
 *   - Default props for the HERO bar graph
 *   - Canonical design tokens (per preset)
 *   - “Resolved props” helpers used by the top-level template
 *
 * WHY THIS FILE EXISTS:
 *   Production templates become unmaintainable if defaults are duplicated
 *   across barGraph.ts + internal templates.
 *
 * CANONICAL RULES:
 *   - Public props are permissive; internals should receive RESOLVED values.
 *   - Any union types in public props (like Padding, barColor being single vs array)
 *     should be normalized here or in the top-level template via helpers from here.
 *
 * WHAT THIS FILE SHOULD NOT DO:
 *   - No rendering
 *   - No FFmpeg expression math (that belongs in bar-fill)
 *   - No template registration
 * ============================================================================
 */

import type {
  AnimConfig,
  BarGraphPreset,
  BaselineConfig,
  GridConfig,
  Orientation,
  Padding,
  ResolvedPadding,
  TrackConfig,
  ValueLabelsConfig,
} from "./types";
import type { MosaicColor } from "@m0saic/types";

// ---------------------------------------------------------------------------
// Canonical preset tokens
// ---------------------------------------------------------------------------

/**
 * In production, each preset becomes a real “theme token pack”:
 * background colors, text colors, grid opacity, track opacity, etc.
 *
 * For scaffold: keep it small. The production comment blocks explain what
 * should be added later.
 */
export type BarGraphPresetTokens = {
  barColor: MosaicColor;
  // Future: backgroundColor, textColor, gridColor, trackColor, etc.
};

export const PRESET_TOKENS: Record<BarGraphPreset, BarGraphPresetTokens> = {
  neutral: { barColor: "#111827" },
  dark: { barColor: "#f9fafb" },
  terminal: { barColor: "#22c55e" },
  glass: { barColor: "#60a5fa" },
  paper: { barColor: "#0f172a" },
};

// ---------------------------------------------------------------------------
// Default config blocks
// ---------------------------------------------------------------------------

export const DEFAULT_ORIENTATION: Orientation = "vertical";

export const DEFAULT_GAP = 18;

/**
 * Default padding: symmetric, but we keep it in Resolved form because internals
 * should not deal with unions.
 */
export const DEFAULT_PADDING: ResolvedPadding = {
  top: 72,
  right: 72,
  bottom: 72,
  left: 72,
};

/** Geometric radius fraction (0..1). See RoundingOptions.borderRadius. */
export const DEFAULT_CORNER_RADIUS = 0.15;

export const DEFAULT_TRACK: TrackConfig = {
  show: true,
};

export const DEFAULT_GRID: GridConfig = {
  show: true,
  count: 5,
};

export const DEFAULT_BASELINE: BaselineConfig = {
  show: true,
};

export const DEFAULT_VALUE_AXIS: BaselineConfig = {
  show: true,
};

export const DEFAULT_VALUE_LABELS: ValueLabelsConfig = {
  show: true,
  format: "compact",
  decimals: 0,
  suffix: "",
};

export const DEFAULT_ANIM: AnimConfig = {
  intro: {
    durationSec: 1.1,
    delaySec: 0.1,
    staggerSec: 0.06,
    ease: "smoothstep",
  },
  reduceMotion: false,
};

export const DEFAULT_PRESET: BarGraphPreset = "neutral";

// ---------------------------------------------------------------------------
// Helpers: resolve padding + shallow merge blocks
// ---------------------------------------------------------------------------

/**
 * Resolve public padding input into canonical ResolvedPadding.
 *
 * PRODUCTION NOTE:
 *   In production you might also adjust padding based on:
 *   - title/subtitle presence
 *   - labelDock rules
 *   - whether value labels are on
 *   But that logic should still live centrally (here or in top-level render),
 *   not scattered across internals.
 */
export function resolvePadding(padding: Padding | undefined): ResolvedPadding {
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  if (padding && typeof padding === "object") {
    return {
      top: padding.top,
      right: padding.right,
      bottom: padding.bottom,
      left: padding.left,
    };
  }
  return DEFAULT_PADDING;
}

/**
 * Resolve which “base bar color” to use when the user passes a single color
 * or nothing. If user supplies an array, we keep it as-is (handled later).
 */
export function resolveBaseBarColor(opts: {
  preset: BarGraphPreset;
  barColor?: MosaicColor | MosaicColor[];
}): MosaicColor {
  const { preset, barColor } = opts;
  if (typeof barColor === "string") return barColor;
  return PRESET_TOKENS[preset].barColor;
}

/**
 * Resolve child configs with defaults. Kept shallow on purpose.
 *
 * RULE:
 *   Avoid deep-merge magic. Be explicit about what you merge so props remain
 *   predictable and learnable.
 */
export function resolveTrack(track?: Partial<TrackConfig>): TrackConfig {
  return { ...DEFAULT_TRACK, ...(track ?? {}) };
}

export function resolveGrid(grid?: Partial<GridConfig>): GridConfig {
  return { ...DEFAULT_GRID, ...(grid ?? {}) };
}

export function resolveBaseline(baseline?: Partial<BaselineConfig>): BaselineConfig {
  return { ...DEFAULT_BASELINE, ...(baseline ?? {}) };
}

export function resolveValueAxis(axis?: Partial<BaselineConfig>): BaselineConfig {
  return { ...DEFAULT_VALUE_AXIS, ...(axis ?? {}) };
}

export function resolveValueLabels(valueLabels?: Partial<ValueLabelsConfig>): ValueLabelsConfig {
  return { ...DEFAULT_VALUE_LABELS, ...(valueLabels ?? {}) };
}

export function resolveAnim(anim?: Partial<AnimConfig>): AnimConfig {
  // Note: intro is nested; keep this explicit so we don’t accidentally drop fields.
  const intro = { ...DEFAULT_ANIM.intro, ...(anim?.intro ?? {}) };
  const reduceMotion = anim?.reduceMotion ?? DEFAULT_ANIM.reduceMotion;
  return { intro, reduceMotion };
}