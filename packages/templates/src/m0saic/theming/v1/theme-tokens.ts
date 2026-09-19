/**
 * ============================================================================
 * `@m0saic/theming` — the m0saic design-token system
 * ============================================================================
 *
 * A layered token system (the standard design-system shape — cf. Material 3,
 * Primer, Spectrum), so a template author codes against STABLE semantic roles
 * and never a raw hex, and so a third party can re-brand by swapping ONE layer:
 *
 *   Layer 1 — REFERENCE ({@link M0saicBrand}): the raw brand ramps. The
 *             identity lives here; fork this to re-brand.
 *   Layer 2 — SEMANTIC ({@link ThemeTokens}): role-based tokens templates read
 *             (`surface`, `textPrimary`, `accent`, …). Names mirror the app's
 *             `App.css :root` so the whole m0saic surface speaks one language.
 *   Layer 3 — PRESETS ({@link THEME_PRESETS}): the semantic layer resolved per
 *             MODE — `dark` / `light` / `high-contrast`. Modes are luminance
 *             schemes of the SAME brand, never different brands.
 *
 * The m0saic identity is **deep navy + orange**, lifted verbatim from the app's
 * design tokens (`apps/mosaic/web/src/App.css :root`): `--brand-navy #050314`,
 * `--brand-orange #EF7525`, the `--color-bg-*` surface ladder, `--color-text-*`,
 * status `#4ade80 / #f87171`. `dark` == the app today. `light` + `high-contrast`
 * are derived from the same brand.
 *
 * ⛔ Ratified vocabulary (KEYS) is additive-only; renames force a re-checkpoint.
 * Each consumer keeps its current constants as the deterministic standalone
 * fallback → an un-themed render is byte-identical to today.
 * ============================================================================
 */
import type { MosaicColor, MosaicThemeTokens, MosaicThemeMode } from "@m0saic/types";

/** The shared semantic contract (lives in `@m0saic/types`). Re-exported here
 *  so this template is a complete reference of the theming system. */
export type ThemeTokens = MosaicThemeTokens;
export type ThemeMode = MosaicThemeMode;
/** @deprecated use {@link ThemeMode}. */
export type ThemePreset = ThemeMode;

// ── Layer 1: REFERENCE — the m0saic brand (swap this object to re-brand) ────
/**
 * Raw brand ramps. Not consumed by templates directly — the semantic presets
 * below resolve from these. A third party supplies their own `M0saicBrand`
 * (or forks this file) to ship their identity through the same semantic
 * contract.
 */
export type M0saicBrand = {
  orange: MosaicColor;
  orangeSoft: MosaicColor;
  orangePale: MosaicColor;
  orangeGlow: MosaicColor; // orange @ ~25% for focus glows
  navy: MosaicColor; // app background
  navyDeep: MosaicColor; // preview well (darkest)
  surface: MosaicColor;
  surfaceRaised: MosaicColor;
  surfaceHover: MosaicColor;
  surfaceInset: MosaicColor;
  navySoft: MosaicColor;
  navyMuted: MosaicColor;
  textHi: MosaicColor;
  textMid: MosaicColor;
  green: MosaicColor;
  red: MosaicColor;
  /** Orange-anchored categorical ramp, harmonized on navy. */
  dataRamp: MosaicColor[];
};

/** The built-in m0saic brand — values from `App.css :root`. */
export const M0SAIC_BRAND: M0saicBrand = {
  orange: "#EF7525",
  orangeSoft: "#F99666",
  orangePale: "#FFC6A9",
  orangeGlow: "#EF752540",
  navy: "#050314",
  navyDeep: "#03020C",
  surface: "#12111F",
  surfaceRaised: "#1E1D2D",
  surfaceHover: "#2A293D",
  surfaceInset: "#161525",
  navySoft: "#3A394F",
  navyMuted: "#6D6D84",
  textHi: "#F5F5F7",
  textMid: "#A0A0B0",
  green: "#4ADE80",
  red: "#F87171",
  dataRamp: ["#EF7525", "#3FB6C9", "#F5C451", "#E0607F", "#8B7FE8", "#5AD1A0"],
};

// ── Layer 2: SEMANTIC — the role tokens templates read ──────────────────────
// The `MosaicThemeTokens` contract now lives in `@m0saic/types` (aliased as
// `ThemeTokens` at the top of this file) so producers + consumers share it.

// ── Layer 3: PRESETS — the m0saic brand resolved per mode ───────────────────
export const THEME_PRESETS: Record<ThemeMode, ThemeTokens> = {
  // `dark` == the app today (App.css :root).
  dark: {
    surfaceApp: M0SAIC_BRAND.navy,
    surface: M0SAIC_BRAND.surface,
    surfaceRaised: M0SAIC_BRAND.surfaceRaised,
    surfaceInset: M0SAIC_BRAND.surfaceInset,
    border: M0SAIC_BRAND.surfaceHover,
    borderStrong: M0SAIC_BRAND.navySoft,
    textPrimary: M0SAIC_BRAND.textHi,
    textSecondary: M0SAIC_BRAND.textMid,
    textMuted: M0SAIC_BRAND.navyMuted,
    eyebrow: M0SAIC_BRAND.orange,
    accent: M0SAIC_BRAND.orange,
    accentSoft: M0SAIC_BRAND.orangeSoft,
    accentGlow: M0SAIC_BRAND.orangeGlow,
    positive: M0SAIC_BRAND.green,
    negative: M0SAIC_BRAND.red,
    grid: M0SAIC_BRAND.surfaceRaised,
    gridAlpha: 1,
    axis: M0SAIC_BRAND.navySoft,
    axisAlpha: 1,
    radius: 0.06,
    dataPalette: M0SAIC_BRAND.dataRamp,
  },
  // Same brand, light mode (derived — orange accent kept, navy-tinted neutrals).
  light: {
    surfaceApp: "#F7F6FB",
    surface: "#FFFFFF",
    surfaceRaised: "#FBFAFE",
    surfaceInset: "#F1F0F7",
    border: "#E4E2ED",
    borderStrong: "#CFCCDD",
    textPrimary: "#12111F",
    textSecondary: "#56546A",
    textMuted: "#8A88A0",
    eyebrow: "#D65E14",
    accent: "#EF7525",
    accentSoft: "#F99666",
    accentGlow: "#EF752520",
    positive: "#16A34A",
    negative: "#DC2626",
    grid: "#EDEBF3",
    gridAlpha: 1,
    axis: "#D8D5E4",
    axisAlpha: 1,
    radius: 0.06,
    dataPalette: ["#E4670F", "#0E9AAE", "#D9A521", "#C8395C", "#6D5FD1", "#12A574"],
  },
  // Accessibility mode — max luminance separation, orange intensified.
  "high-contrast": {
    surfaceApp: "#000000",
    surface: "#0A0A12",
    surfaceRaised: "#12121C",
    surfaceInset: "#08080F",
    border: "#FFFFFF",
    borderStrong: "#FFFFFF",
    textPrimary: "#FFFFFF",
    textSecondary: "#E6E6EE",
    textMuted: "#C8C8D4",
    eyebrow: "#FF8A3D",
    accent: "#FF8A3D",
    accentSoft: "#FFB07A",
    accentGlow: "#FF8A3D40",
    positive: "#37E88B",
    negative: "#FF6B6B",
    grid: "#FFFFFF",
    gridAlpha: 0.35,
    axis: "#FFFFFF",
    axisAlpha: 0.6,
    radius: 0.03,
    dataPalette: ["#FF8A3D", "#33D6E8", "#FFD740", "#FF6B8A", "#B39DFF", "#5AF2B0"],
  },
};

export const THEME_MODES: ThemeMode[] = ["dark", "light", "high-contrast"];
export const DEFAULT_THEME_MODE: ThemeMode = "dark";
/** @deprecated use {@link DEFAULT_THEME_MODE}. */
export const DEFAULT_THEME_PRESET = DEFAULT_THEME_MODE;

/** Resolve a mode to its full semantic token set (defaults to `dark`). */
export function resolveTheme(mode: ThemeMode = DEFAULT_THEME_MODE): ThemeTokens {
  return THEME_PRESETS[mode] ?? THEME_PRESETS[DEFAULT_THEME_MODE];
}
