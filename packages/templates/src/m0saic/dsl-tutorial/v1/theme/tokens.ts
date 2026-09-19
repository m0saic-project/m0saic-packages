/**
 * ============================================================================
 * dsl-tutorial — theme tokens (light / dark)
 * ============================================================================
 *
 * One coherent IDE/debugger look shared by the parent orchestrator and every
 * panel subtemplate, so the whole tutorial reads as a single SaaS-clean app.
 * Pack-local on purpose (not a re-skin of charts/* or alpine/*): this template
 * owns the "code editor" aesthetic — deep surface, panel cards, hairline
 * borders, a purple accent, and git-style positive/negative diff colors.
 *
 * `syntax` is the per-token-type color map for the live DSL string panel.
 * ============================================================================
 */

import type { MosaicColor } from "@m0saic/types";

/** Per-token-type colors for the syntax-highlighted m0 string. */
export type DslSyntaxTheme = {
  /** Rendered tile `1` / `F`. */
  frame: MosaicColor;
  /** Split count digits (`2`, `4`, `10`). */
  count: MosaicColor;
  /** Brackets / parens `( ) [ ]`. */
  bracket: MosaicColor;
  /** Separators `,`. */
  comma: MosaicColor;
  /** Passthrough `0` / `>` and null `-`. */
  passthrough: MosaicColor;
  /** Default / unmatched ink. */
  base: MosaicColor;
};

/** One coherent dsl-tutorial look. Consumed by parent + every panel. */
export type DslTutorialTheme = {
  // ── Surfaces ──
  /** App canvas behind the chrome (deepest). */
  canvas: MosaicColor;
  /** Panel/card surface. */
  surface: MosaicColor;
  /** Slightly raised surface (header bar, pills, chips). */
  surfaceRaised: MosaicColor;
  /** Hairline border. */
  border: MosaicColor;
  /** Border opacity (0..1). */
  borderAlpha: number;

  // ── Text ──
  /** Dominant text (titles, values). */
  title: MosaicColor;
  /** Secondary text (labels). */
  label: MosaicColor;
  /** De-emphasized text (captions, ruler ticks). */
  muted: MosaicColor;

  // ── Accent / status ──
  /** Brand accent (active-tile highlight, caret, selection). */
  accent: MosaicColor;
  /** Accent wash (tinted highlight fill). */
  accentSoft: MosaicColor;
  /** The geometry CURSOR — the orange box that leads the parse at the live X/Y/W/H bounds. */
  cursor: MosaicColor;
  /** Git-style added / new value (green). */
  positive: MosaicColor;
  /** Git-style removed / old value (red). */
  negative: MosaicColor;
  /** Live status dot (parsing). */
  live: MosaicColor;

  // ── Wireframe canvas tiles ──
  /** Tile surface (the numbered wireframe cells — light even in dark mode). */
  tile: MosaicColor;
  /** Tile primary text (the order number). */
  tileText: MosaicColor;
  /** Tile secondary text (the WxH dimensions). */
  tileMuted: MosaicColor;
  /** Tile hairline border. */
  tileBorder: MosaicColor;
  /** Outline of the whole canvas Frame (the bounds all tiles paint into). */
  frameOutline: MosaicColor;

  // ── Shape ──
  /** Panel corner radius as a fraction of the shorter side (0..1). */
  cornerRadius: number;

  // ── Syntax ──
  syntax: DslSyntaxTheme;
};

/** Theme presets. `dark` is the canonical look; `light` is the day variant. */
export const DSL_TUTORIAL_PRESETS: Record<"light" | "dark", DslTutorialTheme> = {
  dark: {
    canvas: "#0A0E1A",
    surface: "#111726",
    surfaceRaised: "#1A2236",
    border: "#27314A",
    borderAlpha: 1,
    title: "#F2F5FB",
    label: "#AEB9D4",
    muted: "#697390",
    accent: "#7C5CFF",
    accentSoft: "#7C5CFF",
    cursor: "#FF8A3D",
    positive: "#3FD17A",
    negative: "#FF6B6B",
    live: "#3FD17A",
    tile: "#EEF1F8",
    tileText: "#161B2B",
    tileMuted: "#6B7488",
    tileBorder: "#C9D1E4",
    frameOutline: "#4A597C",
    cornerRadius: 0.06,
    syntax: {
      frame: "#E7ECF7",
      count: "#7C9CFF",
      bracket: "#C792EA",
      comma: "#5B6684",
      passthrough: "#F7A35C",
      base: "#AEB9D4",
    },
  },
  light: {
    canvas: "#EEF1F7",
    surface: "#FFFFFF",
    surfaceRaised: "#F4F6FB",
    border: "#D9DEEA",
    borderAlpha: 1,
    title: "#101728",
    label: "#3C4763",
    muted: "#8A94AC",
    accent: "#6D4AF0",
    accentSoft: "#6D4AF0",
    cursor: "#F97316",
    positive: "#16A34A",
    negative: "#DC2626",
    live: "#16A34A",
    tile: "#FFFFFF",
    tileText: "#1A2236",
    tileMuted: "#8A94AC",
    tileBorder: "#D9DEEA",
    frameOutline: "#A9B3CC",
    cornerRadius: 0.06,
    syntax: {
      frame: "#1E2638",
      count: "#2D5BD6",
      bracket: "#8B3FC9",
      comma: "#9AA3BA",
      passthrough: "#C2701B",
      base: "#3C4763",
    },
  },
};

/** Preset id union — the `preset` prop type. */
export type DslTutorialPreset = keyof typeof DSL_TUTORIAL_PRESETS;

/** Resolve a preset id to its theme (defaults to `light` — the wireframe look). */
export function dslTutorialTheme(preset?: DslTutorialPreset): DslTutorialTheme {
  return DSL_TUTORIAL_PRESETS[preset ?? "light"];
}

/**
 * Resolve a user color field to a concrete color: a cleared / "none" / blank
 * picker falls back to the default. A bare `value ?? fallback` keeps `""` (not
 * nullish), which renders the element invisible — so every color knob routes
 * through this.
 */
export function resolveColor(
  value: string | undefined | null,
  fallback: MosaicColor,
): MosaicColor {
  const v = (value ?? "").trim();
  return v && v.toLowerCase() !== "none" ? (v as MosaicColor) : fallback;
}
