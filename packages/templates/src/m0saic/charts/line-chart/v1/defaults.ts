/**
 * ============================================================================
 * @m0saic/charts/line-chart — Defaults + Canonical Tokens + Resolvers
 * ============================================================================
 *
 * Central home for default props, per-preset design tokens, and the
 * union→resolved helpers the public template uses. No rendering, no FFmpeg
 * math, no template registration here.
 *
 * The token sets are LIGHT-first: `neutral` reproduces the default Chart.js
 * line chart (white card, light grid, dark text, blue line).
 * ============================================================================
 */

import type { MosaicColor } from "@m0saic/types";
import type {
  AnimConfig,
  AxisConfigInput,
  BorderConfig,
  LegendConfig,
  LineChartPreset,
  Padding,
  PointBorder,
  ResolvedAxis,
  ResolvedBorder,
  ResolvedLegend,
  ResolvedPadding,
  ResolvedValueLabels,
  ValueLabelsConfig,
} from "./types";

// ---------------------------------------------------------------------------
// Preset tokens
// ---------------------------------------------------------------------------

export type LineChartPresetTokens = {
  /** Page/canvas color behind the card. */
  bg: MosaicColor;
  /** Card surface color (the plot ground). */
  card: MosaicColor;
  /** Gridline color. */
  grid: MosaicColor;
  /** Axis line + tick color. */
  axis: MosaicColor;
  /** Tick-label / subtitle text color. */
  axisText: MosaicColor;
  /** Title color. */
  title: MosaicColor;
  /** Default first-series line color. */
  line: MosaicColor;
  /** Card inner-stroke color + alpha. */
  border: MosaicColor;
  borderAlpha: number;
};

export const PRESET_TOKENS: Record<LineChartPreset, LineChartPresetTokens> = {
  // Canonical light look — matches the approved reference.
  neutral: {
    bg: "#ffffff", card: "#ffffff", grid: "#eef2f7", axis: "#d1d5db",
    axisText: "#6b7280", title: "#111827", line: "#2563eb",
    border: "#e5e7eb", borderAlpha: 1,
  },
  paper: {
    bg: "#f8fafc", card: "#ffffff", grid: "#eef2f7", axis: "#cbd5e1",
    axisText: "#64748b", title: "#0f172a", line: "#2563eb",
    border: "#0f172a", borderAlpha: 0.1,
  },
  dark: {
    bg: "#0b0f14", card: "#0f172a", grid: "#1f2937", axis: "#374151",
    axisText: "#9ca3af", title: "#f9fafb", line: "#60a5fa",
    border: "#ffffff", borderAlpha: 0.08,
  },
  terminal: {
    bg: "#050505", card: "#0b0b0b", grid: "#14301c", axis: "#14532d",
    axisText: "#22c55e", title: "#22c55e", line: "#22c55e",
    border: "#22c55e", borderAlpha: 0.18,
  },
  glass: {
    bg: "#0b0f14", card: "#111827", grid: "#1f2937", axis: "#374151",
    axisText: "#cbd5e1", title: "#ffffff", line: "#60a5fa",
    border: "#ffffff", borderAlpha: 0.1,
  },
};

/** Multi-series default palette (cycled in series order). */
export const SERIES_PALETTE: MosaicColor[] = [
  "#2563eb", "#16a34a", "#db2777", "#d97706", "#7c3aed",
];

// ---------------------------------------------------------------------------
// Scalar defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PRESET: LineChartPreset = "neutral";
export const DEFAULT_CORNER_RADIUS = 0.04;

/**
 * Default plot insets (px, at 1280×720) — match the approved sandbox frame:
 *   y-gutter 72 | plot | x-gutter 48 ; header 120 top.
 */
export const DEFAULT_PADDING: ResolvedPadding = { top: 120, right: 16, bottom: 48, left: 72 };

export const DEFAULT_STROKE_WIDTH = 2;
export const DEFAULT_POINT_RADIUS = 3;

export const DEFAULT_ANIM: AnimConfig = {
  intro: { durationSec: 1.1, delaySec: 0.1, staggerSec: 0.12, ease: "smoothstep" },
  reduceMotion: false,
};

export const DEFAULT_VALUE_LABELS: ResolvedValueLabels = {
  show: false, format: "compact", decimals: 0, fontSize: 12,
};

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export function resolvePadding(p: Padding | undefined): ResolvedPadding {
  if (typeof p === "number") return { top: p, right: p, bottom: p, left: p };
  if (p && typeof p === "object") return { top: p.top, right: p.right, bottom: p.bottom, left: p.left };
  return DEFAULT_PADDING;
}

export function resolveBorder(b: BorderConfig | undefined, preset: LineChartPreset): ResolvedBorder {
  const tk = PRESET_TOKENS[preset];
  return { color: b?.color ?? tk.border, alpha: b?.alpha ?? tk.borderAlpha };
}

export function resolveLegend(l: LegendConfig | undefined, preset: LineChartPreset): ResolvedLegend {
  const tk = PRESET_TOKENS[preset];
  return {
    show: l?.show ?? true,
    position: l?.position ?? "top",
    color: l?.color ?? tk.axisText,
    fontSize: l?.fontSize ?? 13,
  };
}

export function resolveValueLabels(v: ValueLabelsConfig | undefined): ResolvedValueLabels {
  return { ...DEFAULT_VALUE_LABELS, ...(v ?? {}) };
}

export function resolveAnim(anim: AnimConfig | undefined, reduceMotion?: boolean): AnimConfig {
  const intro = { ...DEFAULT_ANIM.intro, ...(anim?.intro ?? {}) };
  const rm = reduceMotion ?? anim?.reduceMotion ?? DEFAULT_ANIM.reduceMotion;
  return { intro, reduceMotion: rm };
}

/**
 * Resolve a public per-axis group into a fully-resolved ResolvedAxis. `which`
 * selects sensible per-axis defaults (the y axis shows gridlines + labels; the
 * x axis shows category labels but no vertical grid by default — Chart.js look).
 */
export function resolveAxis(
  cfg: AxisConfigInput | undefined,
  which: "x" | "y",
  preset: LineChartPreset,
): ResolvedAxis {
  const tk = PRESET_TOKENS[preset];
  const c = cfg ?? {};
  return {
    show: c.show ?? true,
    color: c.color ?? tk.axis,
    thickness: c.thickness ?? 1,

    showLabels: c.showLabels ?? true,
    labelColor: c.labelColor ?? tk.axisText,
    fontSize: c.fontSize ?? 13,
    // Canonical numeric-axis look = grouped raw ("10,000"), matching the
    // approved reference. Callers can switch to "compact" (10K) / "percent".
    format: c.format ?? "raw",
    decimals: c.decimals ?? 0,
    prefix: c.prefix ?? "",
    suffix: c.suffix ?? "",

    tickCount: c.tickCount ?? 0, // 0 ⇒ derive from scale ticks / categories
    showTicks: c.showTicks ?? false,
    tickLength: c.tickLength ?? 4,
    tickColor: c.tickColor ?? tk.axis,

    rotation: c.rotation ?? 0,

    showGrid: c.showGrid ?? (which === "y"),
    gridCount: c.gridCount ?? 0, // 0 ⇒ one line per tick/category
    gridColor: c.gridColor ?? tk.grid,
    gridOpacity: c.gridOpacity ?? 1,
    gridDash: c.gridDash ?? "solid",
  };
}

/** First-series line color when nothing explicit was passed. */
export function presetLineColor(preset: LineChartPreset): MosaicColor {
  return PRESET_TOKENS[preset].line;
}

export function resolvePointBorder(pb: PointBorder | undefined): { color?: MosaicColor; width: number } {
  return { color: pb?.color, width: pb?.width ?? 0 };
}
