/**
 * Color tagging for a {@link MosaicOutput}.
 *
 * These are codec-level properties; ffmpeg propagates them through the
 * encoder chain and most modern containers (mp4, mov, mkv, webm) write
 * them to color atoms. Defaults for `web-mp4` follow BT.709 +
 * limited (`tv`) range; HDR variants use BT.2020 + smpte2084 (PQ) or
 * arib-std-b67 (HLG).
 *
 * Fields are optional and ignored by the engine until wiring lands
 * (per plan §D9).
 */
export type MosaicColorConfig = {
  /**
   * YCbCr matrix. Maps to ffmpeg `-colorspace`.
   * Common values: `"bt709"`, `"bt2020nc"`, `"bt2020c"`, `"bt601"`.
   */
  colorSpace?: string;

  /**
   * Signal range. Maps to ffmpeg `-color_range`.
   * - `"limited"` / `"tv"` — Y in [16,235] (broadcast default).
   * - `"full"` / `"pc"` — Y in [0,255] (computer/JPEG range).
   */
  colorRange?: "limited" | "full" | "tv" | "pc";

  /**
   * Color gamut. Maps to ffmpeg `-color_primaries`.
   * Common values: `"bt709"`, `"bt2020"`, `"smpte170m"`, `"smpte432"`
   * (P3-D65).
   */
  colorPrimaries?: string;

  /**
   * Transfer characteristic (gamma curve). Maps to ffmpeg `-color_trc`.
   * Common values: `"bt709"`, `"smpte2084"` (PQ),
   * `"arib-std-b67"` (HLG), `"linear"`, `"iec61966-2-1"` (sRGB).
   */
  colorTransfer?: string;
};
