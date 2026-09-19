import type { FfmpegNamedColor } from "./ffmpegNamedColors";

/** CSS-style hex colors that ffmpeg accepts: #rgb, #rrggbb, #rrggbbaa */
export type HexColor =
  | `#${string}`; // keep simple at type-level; runtime validator can be stricter if you want

/**
 * Alpha suffix used by ffmpeg color expressions.
 * Examples:
 *   "white@0.5"
 *   "#ff00ff@0.250"
 *
 * Note: we can't perfectly constrain 0..1 in TS, but we still get strong shape safety.
 */
export type AlphaSuffix = `@${number}`;

/**
 * Any color string we accept in m0saic configs.
 *
 * - "none" is special: means transparent (your runtime maps it to black@0.0)
 * - named colors must be from FfmpegNamedColor
 * - hex colors allowed
 * - optional alpha suffix allowed
 */
export type MosaicColor =
  | "none"
  | FfmpegNamedColor
  | HexColor
  | `${FfmpegNamedColor}${AlphaSuffix}`
  | `${HexColor}${AlphaSuffix}`
  | `none${AlphaSuffix}`;
