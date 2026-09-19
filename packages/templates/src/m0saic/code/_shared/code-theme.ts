/** Shared editor/chrome and syntax colors for the code template family. */

import type { MosaicColor } from "@m0saic/types";

export const CODE_TOKEN_KINDS = [
  "keyword",
  "string",
  "comment",
  "number",
  "fnCall",
  "ident",
  "operator",
  "punct",
  "plain",
] as const;

export type CodeTokenKind = (typeof CODE_TOKEN_KINDS)[number];
export type CodeSyntaxTheme = Record<CodeTokenKind, MosaicColor>;

export interface CodeTheme {
  /** Page behind the editor card. */
  canvas: MosaicColor;
  /** Code-area surface. */
  editor: MosaicColor;
  /** Static title-bar surface. */
  titleBar: MosaicColor;
  border: MosaicColor;
  title: MosaicColor;
  gutter: MosaicColor;
  lineNumber: MosaicColor;
  trafficClose: MosaicColor;
  trafficMinimize: MosaicColor;
  trafficMaximize: MosaicColor;
  syntax: CodeSyntaxTheme;
}

export const CODE_THEME_PRESET_KEYS = [
  "dark",
  "light",
  "merge-conflict",
  "rubber-duck",
] as const;

export type CodeThemePreset = (typeof CODE_THEME_PRESET_KEYS)[number];

/** Stable built-ins: the canonical pair plus two developer-minded dark variants. */
export const CODE_THEME_PRESETS: Record<CodeThemePreset, CodeTheme> = {
  dark: {
    canvas: "#080B14",
    editor: "#011627",
    titleBar: "#0B2942",
    border: "#1D3B53",
    title: "#D6DEEB",
    gutter: "#011627",
    lineNumber: "#5F7E97",
    trafficClose: "#FF5F57",
    trafficMinimize: "#FFBD2E",
    trafficMaximize: "#28C840",
    syntax: {
      keyword: "#C792EA",
      string: "#ECC48D",
      comment: "#637777",
      number: "#F78C6C",
      fnCall: "#82AAFF",
      ident: "#D6DEEB",
      operator: "#7FDBCA",
      punct: "#89DDFF",
      plain: "#D6DEEB",
    },
  },
  light: {
    canvas: "#E9EEF5",
    editor: "#FBFBFB",
    titleBar: "#F0F2F5",
    border: "#D8DEE9",
    title: "#243447",
    gutter: "#F4F6F8",
    lineNumber: "#90A4AE",
    trafficClose: "#FF5F57",
    trafficMinimize: "#FFBD2E",
    trafficMaximize: "#28C840",
    syntax: {
      keyword: "#7C3AED",
      string: "#A15C00",
      comment: "#6B7C85",
      number: "#C2410C",
      fnCall: "#2563EB",
      ident: "#243447",
      operator: "#047D75",
      punct: "#52606D",
      plain: "#243447",
    },
  },
  "merge-conflict": {
    canvas: "#0B0D10",
    editor: "#15181E",
    titleBar: "#20242C",
    border: "#3B414D",
    title: "#F4F1EC",
    gutter: "#11141A",
    lineNumber: "#737B8C",
    trafficClose: "#FF5F57",
    trafficMinimize: "#FFBD2E",
    trafficMaximize: "#28C840",
    syntax: {
      keyword: "#FF6B81",
      string: "#A9DC76",
      comment: "#6C7486",
      number: "#FFD166",
      fnCall: "#73D2DE",
      ident: "#F4F1EC",
      operator: "#AB9DF2",
      punct: "#FC9867",
      plain: "#F4F1EC",
    },
  },
  "rubber-duck": {
    canvas: "#070A16",
    editor: "#10162B",
    titleBar: "#171F3A",
    border: "#2A3762",
    title: "#FFF4B8",
    gutter: "#0D1327",
    lineNumber: "#63739B",
    trafficClose: "#FF5F57",
    trafficMinimize: "#FFBD2E",
    trafficMaximize: "#28C840",
    syntax: {
      keyword: "#FFD166",
      string: "#7BDFF2",
      comment: "#63739B",
      number: "#FF8FAB",
      fnCall: "#B8F2A1",
      ident: "#F5F7FF",
      operator: "#CDB4DB",
      punct: "#89C2D9",
      plain: "#F5F7FF",
    },
  },
};

export function codeTheme(preset?: CodeThemePreset): CodeTheme {
  return CODE_THEME_PRESETS[preset ?? "dark"];
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

/** Resolve a color picker value to the strict hex format the SVG rasterizer accepts. */
export function resolveCodeColor(
  value: string | null | undefined,
  fallback: MosaicColor,
): MosaicColor {
  const normalized = (value ?? "").trim();
  if (normalized.length === 0 || normalized.toLowerCase() === "none") {
    return fallback;
  }
  if (!HEX_COLOR_RE.test(normalized)) {
    throw new Error(
      `Code theme colors must be #RRGGBB or #RRGGBBAA, got ${JSON.stringify(value)}`,
    );
  }
  return normalized.toUpperCase() as MosaicColor;
}

/** Explicit per-token overrides win; cleared fields retain the preset color. */
export function resolveCodeSyntaxTheme(
  base: CodeTheme,
  overrides: Partial<Record<CodeTokenKind, string | null | undefined>> = {},
): CodeSyntaxTheme {
  return Object.fromEntries(
    CODE_TOKEN_KINDS.map((kind) => [
      kind,
      resolveCodeColor(overrides[kind], base.syntax[kind]),
    ]),
  ) as CodeSyntaxTheme;
}
