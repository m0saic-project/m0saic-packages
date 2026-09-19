/**
 * Target platforms a template is designed for.
 *
 * This metadata is used by UIs and tooling to filter or highlight
 * templates based on the current output context (e.g. desktop hero,
 * mobile story, square grid).
 *
 * - "desktop"         — landscape layouts, typically 16:9 or wider
 * - "mobile"          — portrait layouts, typically 9:16
 * - "tablet"          — intermediate layouts
 * - "square"          — 1:1 or similar aspect ratios
 * - "virtual-reality" — immersive 3D or 360° content
 */
export type MosaicPlatform =
  | "desktop"
  | "mobile"
  | "tablet"
  | "square"
  | "virtual-reality";

  /**
 * Specific VR output formats supported by m0saic templates.
 *
 * VR is separated from MosaicPlatform because it has multiple
 * mutually incompatible subformats (SBS, 360°, etc.) that
 * cannot be inferred from the high-level platform alone.
 */
export type MosaicVRType =
  | "sbs" // Side-by-side stereoscopic -> 2(1,1)
  | "top-bottom" // Over-under stereoscopic -> 2[1,1]
  | "360" // Equirectangular 360°
  | "180" // 180° hemispherical
  | "mono"; // Mono equirectangular

  /**
 * A free-form identifier describing which distribution channels
 * a template is intended for.
 *
 * This type is intentionally open: community templates and private
 * integrations can specify arbitrary channel IDs without requiring
 * changes to the core m0saic type system.
 *
 * Official templates typically use the curated list in
 * KNOWN_MOSAIC_CHANNELS, but third-party templates are free to
 * define their own values.
 *
 * Examples:
 *   channels: ["tiktok", "instagram"]
 *   channels: ["youtube", "twitch"]
 *   channels: ["my-private-editor"]
 */
export type MosaicChannelId = string;

/**
 * Curated set of well-known distribution channels used by official
 * m0saic templates.
 *
 * These values are a convenience for UIs (filters, presets) and
 * documentation. Community templates are not limited to this list
 * and may use arbitrary MosaicChannelId strings.
 */
export const KNOWN_MOSAIC_CHANNELS = [
  "tiktok",
  "instagram",
  "youtube",
  "twitch",
  "patreon",
] as const;

/**
 * Narrow type of the curated, built-in channel IDs.
 *
 * This is useful when you want to refer specifically to the known
 * set, e.g. for switch statements or channel-specific presets, while
 * keeping MosaicChannelId open for community extensions.
 */
export type KnownMosaicChannel = (typeof KNOWN_MOSAIC_CHANNELS)[number];

export type MosaicAspectRatio = {
  /**
   * Ideal aspect ratio (width / height), e.g. 16/9, 9/16, 1, 12/1, etc.
   */
  ideal: number;

  /**
   * Soft lower / upper bounds.
   * If omitted, treat as "no bound" on that side.
   */
  min?: number;
  max?: number;

  /**
   * How strict the engine / UI should be about deviations.
   * - "none": purely informational
   * - "warn": show warnings when outside [min, max]
   * - "error": reject renders outside [min, max]
   */
  mode?: "none" | "warn" | "error";

  /** Optional UI label, e.g. "16:9" */
  label?: `${number}:${number}` | string; 
};