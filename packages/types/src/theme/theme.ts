/**
 * Shared theming contract — the interop layer between a **theme producer**
 * (a template that publishes design tokens onto the upstream channel) and any
 * **theme consumer** (a template that reads them via `ctx.upstreamVariables` /
 * `ctx.upstreamData`).
 *
 * The contract is intentionally minimal: ONE agreed token shape
 * ({@link MosaicThemeTokens}) published under ONE agreed alias
 * ({@link MOSAIC_THEME_ALIAS}). Any producer that emits this shape under this
 * alias is swappable under any consumer that reads it — no coupling to a
 * specific producer template. `@m0saic/theming/v1` is the reference producer;
 * the `@m0saic/template-utils` `publishTheme` / `readTheme` / `applyTheme`
 * helpers are the reference plumbing.
 *
 * VALUES are not part of the contract — the m0saic brand (navy + orange) and
 * its dark/light/high-contrast presets live in the producer template; a third
 * party ships their own values through the same shape.
 */
import type { MosaicColor } from "../colors/mosaicColor";

/**
 * The canonical upstream **alias** a theme block publishes under. Producers
 * set `alias: MOSAIC_THEME_ALIAS` on their data source; consumers read
 * `ctx.upstreamData[MOSAIC_THEME_ALIAS]`. Sharing one constant is what lets
 * independent producers and consumers find each other.
 */
export const MOSAIC_THEME_ALIAS = "theme";

/**
 * Recommended luminance modes. A theme producer typically exposes these as a
 * `preset` prop; the MODE is producer-internal, only the resolved
 * {@link MosaicThemeTokens} crosses the wire. Not a closed universe — a
 * producer may define its own modes.
 */
export type MosaicThemeMode = "dark" | "light" | "high-contrast";

/**
 * The shared semantic design-token set. Role-based, mode-stable keys — a
 * consumer references `accent`, never a hex. Names mirror a conventional
 * app design-token vocabulary (`surface`, `text*`, `accent`, …) so UI and
 * template surfaces speak one language.
 *
 * A producer publishes a full set; a consumer keeps its own constants as a
 * deterministic fallback and overlays whatever the producer supplies (see
 * `applyTheme`). All keys are additive — new tokens extend this interface,
 * never rename.
 */
export interface MosaicThemeTokens {
  // ── Surfaces ──
  /** Page/canvas behind everything. */
  surfaceApp: MosaicColor;
  /** The panel/card a component sits on. */
  surface: MosaicColor;
  /** A raised element on the surface. */
  surfaceRaised: MosaicColor;
  /** Wells / inputs (recessed). */
  surfaceInset: MosaicColor;
  border: MosaicColor;
  borderStrong: MosaicColor;
  // ── Text ──
  textPrimary: MosaicColor;
  textSecondary: MosaicColor;
  textMuted: MosaicColor;
  /** Small accent kicker over a title. */
  eyebrow: MosaicColor;
  // ── Accent (the brand mark) ──
  accent: MosaicColor;
  accentSoft: MosaicColor;
  accentGlow: MosaicColor;
  // ── Status ──
  positive: MosaicColor;
  negative: MosaicColor;
  // ── Chart chrome ──
  grid: MosaicColor;
  gridAlpha: number;
  axis: MosaicColor;
  axisAlpha: number;
  // ── Shape ──
  /** Corner radius as a fraction of the shorter side (0..1). */
  radius: number;
  // ── Data marks ──
  /**
   * Categorical ramp (index 0 == brand). Ships as a brand default; a
   * content-owning consumer may keep its own palette locally when the DATA
   * has intrinsic colors (e.g. a GitHub view keeping GitHub-green).
   */
  dataPalette: MosaicColor[];
}

/** Every {@link MosaicThemeTokens} key, for iteration / validation / UI. */
export const MOSAIC_THEME_TOKEN_KEYS = [
  "surfaceApp",
  "surface",
  "surfaceRaised",
  "surfaceInset",
  "border",
  "borderStrong",
  "textPrimary",
  "textSecondary",
  "textMuted",
  "eyebrow",
  "accent",
  "accentSoft",
  "accentGlow",
  "positive",
  "negative",
  "grid",
  "gridAlpha",
  "axis",
  "axisAlpha",
  "radius",
  "dataPalette",
] as const satisfies readonly (keyof MosaicThemeTokens)[];

export type MosaicThemeTokenKey = (typeof MOSAIC_THEME_TOKEN_KEYS)[number];
