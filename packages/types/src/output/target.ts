/**
 * High-level named output target presets.
 *
 * Each target resolves to concrete container / codec / pixelFormat / audio
 * defaults at engine-wiring time. The per-field fields on
 * {@link MosaicOutputFormat}, {@link MosaicAudioConfig}, and
 * {@link MosaicColorConfig} are escape hatches that override the preset on
 * a field-by-field basis.
 *
 * Engine wiring of preset resolution lives in `@m0saic/core`
 * (`resolveOutputFormat`); the type-shape package only carries the enum.
 *
 * Notable preset behaviors (documented for authors; engine implements):
 *
 * - `web-mp4`: H.264 + MP4 + yuv420p + AAC; `-movflags +faststart` for
 *   progressive HTTP playback.
 * - `web-webm`: VP9 + WebM + yuv420p + Opus. **VP9 CRF is inverted**
 *   relative to x264/x265/AV1 — higher CRF means worse quality (0–63).
 * - `alpha-mov`: ProRes 4444 (profile 4) + MOV + yuva444p10le + PCM 24-bit.
 *   Preserves alpha.
 * - `image-png`: PNG single frame (use `format.frameCount: "sequence"` for
 *   a numbered sequence).
 * - `image-jpeg`: JPEG single frame.
 * - `animated-gif`: GIF; the engine auto-applies `palettegen` + `paletteuse`
 *   filters to quantize colors to the 256-color palette.
 * - `audio-mp3`: libmp3lame; no video stream.
 * - `audio-wav`: PCM 16-bit; no video stream.
 */
export type MosaicOutputTarget =
  | "web-mp4"
  | "web-webm"
  | "alpha-mov"
  | "image-png"
  | "image-jpeg"
  | "animated-gif"
  | "audio-mp3"
  | "audio-wav";

/** Tuple of all known target names. Useful for editor pickers and runtime checks. */
export const MOSAIC_OUTPUT_TARGETS = [
  "web-mp4",
  "web-webm",
  "alpha-mov",
  "image-png",
  "image-jpeg",
  "animated-gif",
  "audio-mp3",
  "audio-wav",
] as const satisfies readonly MosaicOutputTarget[];

/** Runtime type guard for {@link MosaicOutputTarget}. */
export const isMosaicOutputTarget = (v: unknown): v is MosaicOutputTarget =>
  typeof v === "string" &&
  (MOSAIC_OUTPUT_TARGETS as readonly string[]).includes(v);

/**
 * Engine fallback when no {@link MosaicOutput.target} is set and CLI
 * flags don't pick one. `web-mp4` is the "regular HD video" default
 * that covers the vast majority of renders.
 *
 * Also the recommended initial selection for editor target-picker
 * dropdowns.
 */
export const DEFAULT_OUTPUT_TARGET: MosaicOutputTarget = "web-mp4";
