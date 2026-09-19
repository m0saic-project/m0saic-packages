import type { MosaicColorConfig } from "../output/color-config";

/**
 * Canonical color-tag presets for {@link MosaicColorConfig}.
 *
 * Each preset is a complete four-tag quad
 * (`colorSpace` + `colorRange` + `colorPrimaries` + `colorTransfer`)
 * sufficient to tag the resulting bitstream / container correctly for
 * the named delivery target. Players read these tags to decide
 * matrix, gamut, and gamma at decode time — getting the tag wrong
 * produces washed-out blacks, off-hue greens, or HDR content
 * displayed as SDR.
 *
 * Use the preset that matches your target; override individual fields
 * only when you know what you're doing.
 */

/**
 * BT.709 SDR web video — the default for `web-mp4`, `web-webm`, and
 * any other "regular" HD output. ~99% of MosaicOutput renders.
 *
 * Matches ffmpeg's `-colorspace bt709 -color_range tv
 * -color_primaries bt709 -color_trc bt709`.
 */
export const DEFAULT_SDR_WEB_COLOR_CONFIG: MosaicColorConfig = {
  colorSpace: "bt709",
  colorRange: "limited",
  colorPrimaries: "bt709",
  colorTransfer: "bt709",
};

/**
 * sRGB image output — for PNG / JPEG / WebP image rendering, where
 * full-range (0..255) values and the sRGB transfer curve are
 * standard.
 *
 * Most image viewers ignore tags, but writing them correctly avoids
 * trouble when the image gets re-encoded into a video pipeline.
 */
export const DEFAULT_SRGB_IMAGE_COLOR_CONFIG: MosaicColorConfig = {
  colorSpace: "bt709",
  colorRange: "full",
  colorPrimaries: "bt709",
  colorTransfer: "iec61966-2-1",
};

/**
 * HDR10 / PQ — wide-gamut HDR delivery using the SMPTE ST 2084
 * (PQ) transfer curve. Used by HDR10, Dolby Vision base layer,
 * Netflix HDR, Apple HDR.
 *
 * For real HDR delivery you also want mastering-display metadata
 * (max/min luminance, MaxCLL, MaxFALL) — those live outside this
 * preset and are additive when HDR mastering support lands.
 */
export const DEFAULT_HDR_PQ_COLOR_CONFIG: MosaicColorConfig = {
  colorSpace: "bt2020nc",
  colorRange: "limited",
  colorPrimaries: "bt2020",
  colorTransfer: "smpte2084",
};

/**
 * HDR HLG — wide-gamut HDR using the ARIB STD-B67 (HLG) transfer
 * curve. Used by broadcast HDR (BBC, NHK), YouTube HDR, and any
 * "backwards-compatible HDR" delivery where the same stream should
 * look reasonable on SDR displays.
 */
export const DEFAULT_HDR_HLG_COLOR_CONFIG: MosaicColorConfig = {
  colorSpace: "bt2020nc",
  colorRange: "limited",
  colorPrimaries: "bt2020",
  colorTransfer: "arib-std-b67",
};

/**
 * Linear-light scene-referred — uncommon, but useful for VFX
 * intermediates or when piping through a LUT-based color pipeline.
 * Range is `full`; transfer is linear (no gamma curve).
 */
export const DEFAULT_LINEAR_LIGHT_COLOR_CONFIG: MosaicColorConfig = {
  colorSpace: "bt709",
  colorRange: "full",
  colorPrimaries: "bt709",
  colorTransfer: "linear",
};

/**
 * Engine fallback when no `MosaicOutput.color` is set and the target
 * doesn't imply a different preset. BT.709 SDR is the safe default.
 */
export const DEFAULT_COLOR_CONFIG: MosaicColorConfig =
  DEFAULT_SDR_WEB_COLOR_CONFIG;
