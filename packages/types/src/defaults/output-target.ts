/**
 * Per-target default knob matrix for {@link MosaicOutputTarget}.
 *
 * Each target maps to a concrete `(format, audio, color)` triple — the
 * exact values the engine substitutes when the user picks the target
 * and doesn't override individual fields. Surfacing these as data (vs.
 * burying them in core's `resolveOutputFormat`) lets the editor preview
 * what'll render, the validator pre-check before invoking ffmpeg, and
 * authors fork a target into Custom mode with the defaults pre-filled.
 *
 * **Engine support is the gating factor.** This table is the *intent* —
 * the engine may layer additional behavior (e.g. `web-mp4` also gets
 * `-movflags +faststart` for progressive playback, GIF gets a
 * `palettegen`/`paletteuse` filter chain). Those engine-only behaviors
 * don't appear here because they aren't expressible on the user-facing
 * `MosaicOutputFormat` shape.
 *
 * Authors override individual fields on `MosaicOutput.format` / `.audio`
 * / `.color` — unset fields keep the preset value. The engine
 * substitutes a compatible codec automatically when an explicit codec
 * conflicts with the target's container, emitting
 * `AUDIO_CODEC_SUBSTITUTED` / similar diagnostics.
 */

import type { MosaicAudioConfig } from "../output/audio-config";
import type { MosaicColorConfig } from "../output/color-config";
import type { MosaicOutputFormat } from "../output/format";
import type { MosaicOutputTarget } from "../output/target";
import {
  DEFAULT_AUDIO_CONFIG,
  DEFAULT_WEBM_AUDIO_CONFIG,
  DEFAULT_NO_AUDIO_CONFIG,
} from "./audio";

export type MosaicOutputTargetDefaults = {
  format: MosaicOutputFormat;
  audio: MosaicAudioConfig;
  color: MosaicColorConfig;
};

/**
 * BT.709 color tagging — the broadcast/web HD standard. Applied to
 * every video target by default. HDR targets (when added) would carry
 * `bt2020nc` + `smpte2084`/`arib-std-b67` instead.
 */
const REC709: MosaicColorConfig = {
  colorSpace: "bt709",
  colorRange: "limited",
  colorPrimaries: "bt709",
  colorTransfer: "bt709",
};

/** Empty color tagging — applied to image / audio targets. */
const NO_COLOR: MosaicColorConfig = {};

/**
 * Lossless 24-bit PCM stereo at 48 kHz. Pairs with alpha-mov / ProRes
 * 4444 because the surrounding pipeline is mastering-grade and a lossy
 * AAC stream would be incongruous.
 */
const PCM_S24_STEREO_48K: MosaicAudioConfig = {
  mode: "auto",
  codec: "pcm_s24le",
  sampleRate: 48000,
  channelLayout: "stereo",
};

/** MP3 audio-target preset: libmp3lame 192k 44.1 kHz stereo (CD-standard). */
const AUDIO_MP3_DEFAULT: MosaicAudioConfig = {
  mode: "auto",
  codec: "libmp3lame",
  bitrate: "192k",
  sampleRate: 44100,
  channelLayout: "stereo",
};

/** WAV audio-target preset: PCM 16-bit 48 kHz stereo (broadcast-standard). */
const AUDIO_WAV_DEFAULT: MosaicAudioConfig = {
  mode: "auto",
  codec: "pcm_s16le",
  sampleRate: 48000,
  channelLayout: "stereo",
};

export const MOSAIC_OUTPUT_TARGET_DEFAULTS: Record<
  MosaicOutputTarget,
  MosaicOutputTargetDefaults
> = {
  // ── web-mp4 — universal video web target ──────────────────────
  "web-mp4": {
    format: {
      kind: "video",
      container: "mp4",
      videoCodec: "libx264",
      pixelFormat: "yuv420p",
      crf: 23,
      encoderPreset: "medium",
      encoderProfile: "high",
      encoderLevel: "4.0",
    },
    audio: DEFAULT_AUDIO_CONFIG,
    color: REC709,
  },

  // ── web-webm — VP9 + Opus alternative ─────────────────────────
  // VP9 CRF is INVERTED (0 best, 63 worst). 32 ≈ libx264 CRF 23
  // perceptual quality.
  "web-webm": {
    format: {
      kind: "video",
      container: "webm",
      videoCodec: "libvpx-vp9",
      pixelFormat: "yuv420p",
      crf: 32,
      encoderPreset: "good",
    },
    audio: DEFAULT_WEBM_AUDIO_CONFIG,
    color: REC709,
  },

  // ── alpha-mov — ProRes 4444 with alpha + lossless audio ──────
  "alpha-mov": {
    format: {
      kind: "video",
      container: "mov",
      videoCodec: "prores_ks",
      pixelFormat: "yuva444p10le",
      encoderProfile: "4444",
    },
    audio: PCM_S24_STEREO_48K,
    color: REC709,
  },

  // ── image-png — lossless single-frame still ───────────────────
  // `rgba` keeps the alpha channel; the engine drops it if the
  // source doesn't carry transparency.
  "image-png": {
    format: {
      kind: "image",
      container: "png",
      frameCount: 1,
      pixelFormat: "rgba",
    },
    audio: DEFAULT_NO_AUDIO_CONFIG,
    color: NO_COLOR,
  },

  // ── image-jpeg — lossy single-frame still ─────────────────────
  // yuvj420p is the full-range variant ffmpeg's mjpeg encoder uses.
  "image-jpeg": {
    format: {
      kind: "image",
      container: "jpeg",
      frameCount: 1,
      pixelFormat: "yuvj420p",
    },
    audio: DEFAULT_NO_AUDIO_CONFIG,
    color: NO_COLOR,
  },

  // ── animated-gif — palette-quantized animation ───────────────
  // pal8 is the GIF native pixel format; the engine layers a
  // palettegen + paletteuse filter chain ahead of the encoder.
  "animated-gif": {
    format: {
      kind: "image",
      container: "gif",
      pixelFormat: "pal8",
    },
    audio: DEFAULT_NO_AUDIO_CONFIG,
    color: NO_COLOR,
  },

  // ── audio-mp3 — universal compressed audio ────────────────────
  "audio-mp3": {
    format: {
      kind: "audio",
      container: "mp3",
    },
    audio: AUDIO_MP3_DEFAULT,
    color: NO_COLOR,
  },

  // ── audio-wav — lossless 16-bit PCM ──────────────────────────
  "audio-wav": {
    format: {
      kind: "audio",
      container: "wav",
    },
    audio: AUDIO_WAV_DEFAULT,
    color: NO_COLOR,
  },
};

/**
 * Lookup helper. Returns the target's defaults, or undefined if `t`
 * isn't a recognized target. Falling back to the default target
 * (web-mp4) is the engine's job — this function deliberately does NOT
 * substitute so callers can detect "unknown target" explicitly.
 */
export function getOutputTargetDefaults(
  t: string | null | undefined,
): MosaicOutputTargetDefaults | undefined {
  if (!t) return undefined;
  return (MOSAIC_OUTPUT_TARGET_DEFAULTS as Record<string, MosaicOutputTargetDefaults>)[t];
}
