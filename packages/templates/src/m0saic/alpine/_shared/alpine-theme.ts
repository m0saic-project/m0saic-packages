/**
 * ============================================================================
 * Alpine pack — shared theme tokens
 * ============================================================================
 *
 * The Alpine data-viz pack (`@m0saic/alpine/*`) is a single brand flavor: a
 * friendly, mobile-marketing aesthetic — white rounded cards, soft borders, a
 * clean type scale, and a warm-but-trustworthy palette. Every Alpine template
 * pulls its colors from ONE {@link AlpineTheme} so the whole pack reads as a
 * coherent set.
 *
 * These tokens are pack-local on purpose: Alpine is standalone, NOT a re-skin of
 * the generic `@m0saic/charts/*` primitives. The generic charts keep their own
 * presets; Alpine owns this look.
 *
 * Palette derived from the Alpine dashboard reference: a #2563EB primary, slate
 * text, hairline gridlines, and a six-color categorical ramp matching the
 * reference treemap/donut colors.
 * ============================================================================
 */

import type { MosaicColor, MosaicEngineContext, MosaicThemeTokens } from "@m0saic/types";
import { resolveThemeTokens, type ThemeSourceConfig } from "@m0saic/template-utils";

/** One coherent Alpine look. Consumed by every template in the pack. */
export type AlpineTheme = {
  // ── Surfaces ──
  /** Page/canvas behind the card. */
  canvas: MosaicColor;
  /** Card surface (the rounded panel a chart sits on). */
  card: MosaicColor;
  /** Hairline card border color. */
  border: MosaicColor;
  /** Card border opacity (0..1). */
  borderAlpha: number;

  // ── Text ──
  /** Card title (bold, dominant). */
  title: MosaicColor;
  /** Card subtitle (muted caption under the title). */
  subtitle: MosaicColor;
  /** In-chart labels (categories, axis values). */
  label: MosaicColor;
  /** De-emphasized text (secondary captions, ticks). */
  muted: MosaicColor;

  // ── Data marks ──
  /** Primary series / bar / line color. */
  primary: MosaicColor;
  /** Positive delta / up-trend. */
  positive: MosaicColor;
  /** Negative delta / down-trend. */
  negative: MosaicColor;

  // ── Chrome ──
  /** Gridline color. */
  grid: MosaicColor;
  /** Gridline opacity (0..1). */
  gridAlpha: number;
  /** Axis line color. */
  axis: MosaicColor;
  /** Axis line opacity (0..1). */
  axisAlpha: number;

  // ── Shape ──
  /** Card corner radius as a fraction of the shorter side (0..1). Friendly = generous. */
  cornerRadius: number;
};

/**
 * Categorical ramp for multi-series / multi-segment marks (donut slices, stacked
 * bars, treemap tiles). Index 0 is the primary; cycle for additional series.
 * Mirrors the reference dashboard's tile colors.
 */
export const ALPINE_PALETTE: MosaicColor[] = [
  "#2563EB", // blue (primary)
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#0EA5E9", // sky
];

/** Theme presets. `light` is the canonical Alpine look; `dark` is the night variant. */
export const ALPINE_PRESETS: Record<"light" | "dark", AlpineTheme> = {
  light: {
    canvas: "#F8FAFC",
    card: "#FFFFFF",
    border: "#E5E7EB",
    borderAlpha: 1,
    title: "#0F172A",
    subtitle: "#64748B",
    label: "#334155",
    muted: "#94A3B8",
    primary: "#2563EB",
    positive: "#16A34A",
    negative: "#DC2626",
    grid: "#E2E8F0",
    gridAlpha: 1,
    axis: "#CBD5E1",
    axisAlpha: 1,
    cornerRadius: 0.08,
  },
  dark: {
    canvas: "#0B1120",
    card: "#111827",
    border: "#1F2937",
    borderAlpha: 1,
    title: "#F1F5F9",
    subtitle: "#94A3B8",
    label: "#CBD5E1",
    muted: "#64748B",
    primary: "#3B82F6",
    positive: "#22C55E",
    negative: "#F87171",
    grid: "#1E293B",
    gridAlpha: 1,
    axis: "#334155",
    axisAlpha: 1,
    cornerRadius: 0.08,
  },
};

/** Preset id union — the `preset` prop type Alpine templates expose. */
export type AlpinePreset = keyof typeof ALPINE_PRESETS;

/** Resolve a preset id to its theme (defaults to `light`). */
export function alpineTheme(preset?: AlpinePreset): AlpineTheme {
  return ALPINE_PRESETS[preset ?? "light"];
}

// ─────────────────────────────────────────────────────────────────────────────
// Producer theming (F4 U-A0). Bridge the pack-local `AlpineTheme` (20 keys) to
// the repo's 21-key `MosaicThemeTokens` so a producer (`@m0saic/theming/v1`) can
// re-skin every Family-A alpine template through ONE resolver. The two maps are
// exact inverses on the used keys, so an UNTHEMED render is byte-identical to the
// old `alpineTheme(preset)` path (verified by round-trip). The categorical
// `ALPINE_PALETTE` stays local for now — per-mark colors already resolve with
// explicit-prop-wins at each callsite (`resolveColor(item.color ?? …, palette)`).
// ─────────────────────────────────────────────────────────────────────────────

/** Map an `AlpineTheme` onto the 21-key `MosaicThemeTokens` (the resolver fallback). */
export function alpineToTokens(t: AlpineTheme): MosaicThemeTokens {
  return {
    surfaceApp: t.canvas,
    surface: t.card,
    surfaceRaised: t.card,
    surfaceInset: t.canvas,
    border: t.border,
    borderStrong: t.border,
    textPrimary: t.title,
    textSecondary: t.subtitle,
    textMuted: t.label,
    eyebrow: t.muted,
    accent: t.primary,
    accentSoft: t.primary,
    accentGlow: t.primary,
    positive: t.positive,
    negative: t.negative,
    grid: t.grid,
    gridAlpha: t.gridAlpha,
    axis: t.axis,
    axisAlpha: t.axisAlpha,
    radius: t.cornerRadius,
    dataPalette: ALPINE_PALETTE,
  };
}

/** Overlay resolved `MosaicThemeTokens` back onto `AlpineTheme` keys. `base`
 *  supplies the scalars with no token home (`borderAlpha`). Inverse of
 *  `alpineToTokens` on the used keys → round-trip identity when unthemed. */
export function tokensToAlpine(tk: MosaicThemeTokens, base: AlpineTheme): AlpineTheme {
  return {
    canvas: tk.surfaceApp,
    card: tk.surface,
    border: tk.border,
    borderAlpha: base.borderAlpha,
    title: tk.textPrimary,
    subtitle: tk.textSecondary,
    label: tk.textMuted,
    muted: tk.eyebrow,
    primary: tk.accent,
    positive: tk.positive,
    negative: tk.negative,
    grid: tk.grid,
    gridAlpha: tk.gridAlpha,
    axis: tk.axis,
    axisAlpha: tk.axisAlpha,
    cornerRadius: tk.radius,
  };
}

/**
 * Producer-overridable theme resolver — the Family-A theming chokepoint. Drop-in
 * async replacement for `alpineTheme(preset)`: builds the preset fallback, runs it
 * through `resolveThemeTokens` (which overlays `ctx.upstreamData["theme"]` / a
 * seeded `config.slug` per-key), and maps back to `AlpineTheme`. Unthemed →
 * returns the preset unchanged (byte-identical). `props.theme` (producer) wins over
 * `props.preset`; explicit per-mark color props still win at each callsite.
 */
export async function resolveAlpineTheme(
  preset: AlpinePreset | undefined,
  ctx: MosaicEngineContext,
  config?: ThemeSourceConfig,
): Promise<AlpineTheme> {
  const base = alpineTheme(preset);
  const resolved = await resolveThemeTokens(alpineToTokens(base), ctx, config);
  return tokensToAlpine(resolved, base);
}
