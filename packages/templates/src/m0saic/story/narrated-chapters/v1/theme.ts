/**
 * Pack theme for @m0saic/story — single dark preset, structured for
 * extension (mirrors hero/ffmpeg-pulse/_shared/pulse-theme.ts). All brand
 * colors flow from story.json's `brand` block; anything invalid falls back
 * to the preset so a hostile manifest can't push garbage at ffmpeg.
 */

import { isMosaicColor } from "@m0saic/types";
import type { MosaicColor } from "@m0saic/types";

import type { StoryDocument } from "./props";

export type StoryTheme = {
  // ── Surfaces ──────────────────────────────────────────────
  /** Canvas / letterbox fill (story.brand.backgroundColor). */
  canvas: MosaicColor;
  /** Card-scene panel wash — slightly lifted from the canvas. */
  card: MosaicColor;
  // ── Text ──────────────────────────────────────────────────
  /** Headline ink (story.brand.textColor). */
  ink: MosaicColor;
  /** Subtitle / kicker ink. */
  muted: MosaicColor;
  // ── Accent ────────────────────────────────────────────────
  /** Brand accent (story.brand.accentColor) — bars, kickers. */
  accent: MosaicColor;
};

export const STORY_PRESETS: Record<"dark", StoryTheme> = {
  dark: {
    canvas: "#0d0f12",
    card: "#14171c",
    ink: "#f4f6f8",
    muted: "#8b94a1",
    accent: "#2f6df6",
  },
};

export type StoryPreset = keyof typeof STORY_PRESETS;

export function storyTheme(preset?: StoryPreset): StoryTheme {
  return STORY_PRESETS[preset ?? "dark"];
}

/** Brand colors from the manifest, preset for anything absent or invalid. */
export function themeFromStory(story: StoryDocument): StoryTheme {
  const base = storyTheme();
  const brand = story.brand;
  return {
    ...base,
    canvas: asColor(brand?.backgroundColor, base.canvas),
    ink: asColor(brand?.textColor, base.ink),
    accent: asColor(brand?.accentColor, base.accent),
  };
}

function asColor(value: string | undefined, fallback: MosaicColor): MosaicColor {
  return isMosaicColor(value) ? value : fallback;
}
