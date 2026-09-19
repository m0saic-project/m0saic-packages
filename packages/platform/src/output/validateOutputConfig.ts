/**
 * Pure validator for the user-set portion of an `MosaicOutput`.
 *
 * Lives in `@m0saic/platform` so it can run inside the web app (no
 * `@m0saic/core` dependency — that package is closed-moat per
 * CLAUDE.md §7.4). Same rules are usable by the CLI for pre-render
 * `--validate-only` checks once wired.
 *
 * Output is split into three buckets — `errors` block the render,
 * `warnings` surface yellow chips, `advice` is FYI-only. Each
 * diagnostic carries a `field` anchor so the UI can pin it next to
 * the offending row.
 *
 * Engine support is the gating factor for what actually renders; this
 * validator catches the failure modes that are CHEAPLY catchable at
 * the editor / CLI layer, before ffmpeg.
 */

import type {
  MosaicOutputFormat,
  MosaicAudioConfig,
  MosaicColorConfig,
} from "@m0saic/types";

// ─── Public surface ────────────────────────────────────────────────

export type OutputConfigFieldAnchor =
  | "target"
  | "alpha"
  | "container"
  | "videoCodec"
  | "pixelFormat"
  | "bitrate"
  | "crf"
  | "encoderPreset"
  | "encoderProfile"
  | "encoderLevel"
  | "gopSize"
  | "audio.mode"
  | "audio.codec"
  | "audio.bitrate"
  | "audio.sampleRate"
  | "audio.channelLayout"
  | "color.colorSpace"
  | "color.colorRange"
  | "color.colorPrimaries"
  | "color.colorTransfer";

export type OutputConfigDiagnostic = {
  /** Stable machine-readable code; lookup-friendly. */
  code: string;
  severity: "error" | "warning" | "advice";
  /** UI anchor — which row to highlight. Omitted for cross-field rules. */
  field?: OutputConfigFieldAnchor;
  message: string;
};

export type OutputConfigValidationInput = {
  target?: string | null;
  format?: MosaicOutputFormat | null;
  audio?: MosaicAudioConfig | null;
  color?: MosaicColorConfig | null;
  /** When true, the output expects an alpha channel (Make's checkbox). */
  alpha?: boolean;
  /** Optional size hint for level-vs-resolution checks. */
  size?: { width: number; height: number };
  /** Optional fps hint for level-vs-resolution checks. */
  fps?: number;
};

export type OutputConfigValidationResult = {
  errors: OutputConfigDiagnostic[];
  warnings: OutputConfigDiagnostic[];
  advice: OutputConfigDiagnostic[];
};

export function validateOutputConfig(
  input: OutputConfigValidationInput,
): OutputConfigValidationResult {
  const all: OutputConfigDiagnostic[] = [];

  const fmt = input.format ?? null;
  const aud = input.audio ?? null;
  const _col = input.color ?? null;

  const container = lower(fmt?.container);
  const videoCodec = lower(fmt?.videoCodec);
  const audioCodec = lower(aud?.codec ?? fmt?.audioCodec);
  const pixelFormat = lower(fmt?.pixelFormat);
  const crf = numericOrNull(fmt?.crf);
  const bitrate = stringOrNull(fmt?.bitrate);
  const encoderPreset = lower(fmt?.encoderPreset);
  const encoderProfile = lower(fmt?.encoderProfile);
  const encoderLevel = stringOrNull(fmt?.encoderLevel);
  const family = codecFamily(videoCodec);
  const hw = codecHardwareKind(videoCodec);
  const alpha = input.alpha === true;

  // ─── Errors ──────────────────────────────────────────────────────

  // ProRes only inside MOV.
  if (family === "prores" && container && container !== "mov") {
    all.push({
      code: "PRORES_REQUIRES_MOV",
      severity: "error",
      field: "container",
      message: `ProRes (${videoCodec}) only encodes inside the MOV container; got "${container}".`,
    });
  }

  // JPEG container cannot carry alpha.
  if (container === "jpeg" && alpha) {
    all.push({
      code: "JPEG_DOES_NOT_SUPPORT_ALPHA",
      severity: "error",
      field: "container",
      message: "JPEG has no alpha channel. Use PNG, WebP, AVIF, or APNG for transparent stills.",
    });
  }

  // JPEG uses -q:v (1..31), not -crf.
  if (container === "jpeg" && crf !== null) {
    all.push({
      code: "JPEG_USES_QUALITY_NOT_CRF",
      severity: "error",
      field: "crf",
      message: "JPEG uses the quality scale (1..31 via -q:v), not CRF. Clear the CRF field.",
    });
  }

  // Pixel-format / alpha pairing.
  if (alpha && pixelFormat && !PIXEL_FORMATS_WITH_ALPHA.has(pixelFormat)) {
    all.push({
      code: "PIXEL_FORMAT_LACKS_ALPHA",
      severity: "error",
      field: "pixelFormat",
      message: `Pixel format "${pixelFormat}" has no alpha channel. Use yuva420p, yuva422p, yuva444p, yuva444p10le, rgba, argb, bgra, abgr, ya8, or gbrp.`,
    });
  }

  // ProRes alpha gate: profiles 4444 / 4444xq only.
  if (
    family === "prores" &&
    alpha &&
    encoderProfile &&
    !PRORES_ALPHA_PROFILES.has(encoderProfile)
  ) {
    all.push({
      code: "PRORES_ALPHA_REQUIRES_4444",
      severity: "error",
      field: "encoderProfile",
      message: `ProRes alpha output requires profile "4444" or "4444xq"; got "${encoderProfile}".`,
    });
  }

  // WebM only carries Opus or Vorbis audio.
  if (container === "webm" && audioCodec && !WEBM_AUDIO_CODECS.has(audioCodec)) {
    all.push({
      code: "WEBM_AUDIO_CODEC_INCOMPAT",
      severity: "error",
      field: "audio.codec",
      message: `WebM only supports Opus or Vorbis audio; got "${audioCodec}".`,
    });
  }

  // Audio-only container with a video codec set.
  if (container && AUDIO_ONLY_CONTAINERS.has(container) && videoCodec) {
    all.push({
      code: "AUDIO_CONTAINER_NO_VIDEO",
      severity: "error",
      field: "videoCodec",
      message: `Container "${container}" carries audio only; videoCodec "${videoCodec}" cannot be muxed.`,
    });
  }

  // Container × codec sanity for the most common pairings. We don't
  // enumerate the full matrix — just the ones a non-expert is likely
  // to construct accidentally.
  if (container === "webm" && family && family !== "vp9" && family !== "av1") {
    all.push({
      code: "WEBM_VIDEO_CODEC_INCOMPAT",
      severity: "error",
      field: "videoCodec",
      message: `WebM only supports VP9 or AV1 video; got "${videoCodec}" (${family}).`,
    });
  }
  if (
    container === "mp4" &&
    family &&
    family !== "h264" &&
    family !== "hevc" &&
    family !== "av1" &&
    family !== "mjpeg"
  ) {
    all.push({
      code: "MP4_VIDEO_CODEC_INCOMPAT",
      severity: "error",
      field: "videoCodec",
      message: `MP4 supports H.264, HEVC, AV1, or MJPEG video; got "${videoCodec}" (${family}).`,
    });
  }

  // ─── Warnings ────────────────────────────────────────────────────

  // CRF=0 on x264/x265 — technically lossless, practically huge.
  if ((family === "h264" || family === "hevc") && crf === 0) {
    all.push({
      code: "LOSSLESS_CRF_HUGE_FILES",
      severity: "warning",
      field: "crf",
      message: "CRF 0 is mathematically lossless and produces enormous files. For visually-lossless quality use CRF 14–18 instead.",
    });
  }

  // Both bitrate and CRF set → CRF wins; user probably wants one or the other.
  if (bitrate && crf !== null) {
    all.push({
      code: "BITRATE_AND_CRF_BOTH_SET",
      severity: "warning",
      field: "bitrate",
      message: `Both bitrate ("${bitrate}") and CRF (${crf}) are set. CRF wins (quality-driven beats size-driven). Clear one for clarity.`,
    });
  }

  // Audio track off but audio fields set (Q2 tri-state: mode "off" = never
  // a track, so the codec/bitrate knobs are inert).
  if (aud?.mode === "off") {
    const stray: OutputConfigFieldAnchor[] = [];
    if (aud.codec) stray.push("audio.codec");
    if (aud.bitrate) stray.push("audio.bitrate");
    if (aud.sampleRate) stray.push("audio.sampleRate");
    if (aud.channelLayout) stray.push("audio.channelLayout");
    for (const f of stray) {
      all.push({
        code: "AUDIO_DISABLED_FIELD_IGNORED",
        severity: "warning",
        field: f,
        message: 'Audio track is off (mode "off"). This field will be ignored on render.',
      });
    }
  }

  // VP9 CRF out of inverted range.
  if (family === "vp9" && crf !== null && (crf < 0 || crf > 63)) {
    all.push({
      code: "VP9_CRF_OUT_OF_RANGE",
      severity: "warning",
      field: "crf",
      message: `VP9 CRF range is 0 (best) to 63 (worst); got ${crf}.`,
    });
  }

  // x264/x265 CRF out of supported range.
  if ((family === "h264" || family === "hevc") && crf !== null && (crf < 0 || crf > 51)) {
    all.push({
      code: "X264_X265_CRF_OUT_OF_RANGE",
      severity: "warning",
      field: "crf",
      message: `${family === "h264" ? "H.264" : "HEVC"} CRF range is 0 (lossless) to 51 (worst); got ${crf}.`,
    });
  }

  // Hardware encoders ignore software-style CRF. NVENC respects -cq but
  // not -crf; QSV / AMF / VAAPI use rate-control flags. Warn so the user
  // doesn't expect software-quality behavior.
  if (hw && hw !== "software" && crf !== null) {
    all.push({
      code: "HARDWARE_CRF_NOT_RESPECTED",
      severity: "warning",
      field: "crf",
      message: `Hardware encoder "${videoCodec}" does not consume software-style -crf. The engine may translate to a quality knob (e.g. NVENC -cq) but exact mapping varies; verify with a test render.`,
    });
  }

  // ─── Advice ──────────────────────────────────────────────────────

  // Opus efficiency curve.
  if (audioCodec && AUDIO_CODEC_FAMILY_OPUS.has(audioCodec)) {
    const kbps = parseBitrateKbps(aud?.bitrate);
    if (kbps !== null && kbps >= 256) {
      all.push({
        code: "OPUS_BITRATE_EXCESSIVE",
        severity: "advice",
        field: "audio.bitrate",
        message: `Opus is most efficient at 96–192 kbps; ${kbps} kbps offers little perceptible quality benefit and inflates file size.`,
      });
    }
  }

  // x264 ultrafast preset — quality cliff.
  if (videoCodec === "libx264" && encoderPreset === "ultrafast") {
    all.push({
      code: "ULTRAFAST_QUALITY_CLIFF",
      severity: "advice",
      field: "encoderPreset",
      message: "libx264 ultrafast disables most rate-distortion optimization. Expect ~2–3× larger files at the same CRF; consider 'veryfast' for a better speed/quality tradeoff.",
    });
  }

  // libaom-av1 is slow; nudge toward libsvtav1 or hardware.
  if (videoCodec === "libaom-av1") {
    all.push({
      code: "LIBAOM_AV1_SLOW",
      severity: "advice",
      field: "videoCodec",
      message: "libaom-av1 is the reference encoder and is slow at default speed. For authoring use libsvtav1; for previews use a hardware AV1 (av1_nvenc / av1_qsv / av1_amf).",
    });
  }

  // H.264 level-vs-resolution sanity. Level 3.1 caps at 1280×720@30; 4.0
  // caps at 1920×1080@30; 4.1 at 1920×1080 ≤62.5 Mb/s; 5.0 at 4K30 less
  // strictly than 5.1. We catch the common too-low picks.
  if (family === "h264" && encoderLevel && input.size && input.fps) {
    const lvl = parseFloat(encoderLevel);
    const px = input.size.width * input.size.height * input.fps;
    if (!Number.isNaN(lvl)) {
      const cap = H264_LEVEL_LUMA_SAMPLE_RATE.get(encoderLevel);
      if (cap !== undefined && px > cap) {
        all.push({
          code: "H264_LEVEL_TOO_LOW",
          severity: "warning",
          field: "encoderLevel",
          message: `H.264 level ${encoderLevel} caps luma samples at ${cap.toLocaleString()} per second; ${input.size.width}×${input.size.height}@${input.fps} needs ${px.toLocaleString()}. Pick a higher level.`,
        });
      }
    }
  }

  // ─── Sort + bucket ───────────────────────────────────────────────

  const errors = all.filter((d) => d.severity === "error");
  const warnings = all.filter((d) => d.severity === "warning");
  const advice = all.filter((d) => d.severity === "advice");
  return { errors, warnings, advice };
}

// ─── Internal helpers ──────────────────────────────────────────────

function lower(v: string | undefined | null): string | null {
  return typeof v === "string" && v.length > 0 ? v.toLowerCase() : null;
}
function stringOrNull(v: string | undefined | null): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function numericOrNull(v: number | undefined | null): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Parse bitrate strings like "192k" / "4M" / "1500" into kbps. */
function parseBitrateKbps(s: string | undefined | null): number | null {
  if (typeof s !== "string" || s.length === 0) return null;
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "m") return n * 1000;
  if (unit === "k") return n;
  // bare number — assume bps, convert to kbps.
  return n / 1000;
}

/**
 * Mirror of `codecFamily` in `@m0saic/types/output/format.ts` (kept
 * local because that function is non-exported). Keep in sync.
 */
function codecFamily(
  codec: string | undefined | null,
): "h264" | "hevc" | "av1" | "vp9" | "prores" | "mjpeg" | null {
  if (!codec) return null;
  const c = codec.toLowerCase();
  if (c.includes("hevc") || c.includes("265")) return "hevc";
  if (c.includes("av1")) return "av1";
  if (c.includes("vp9")) return "vp9";
  if (c.includes("264")) return "h264";
  if (c.startsWith("prores")) return "prores";
  if (c.includes("mjpeg")) return "mjpeg";
  return null;
}

/** Mirror of `codecHardwareKind` in `@m0saic/types/output/format.ts`. */
function codecHardwareKind(
  codec: string | undefined | null,
): "nvenc" | "videotoolbox" | "qsv" | "amf" | "vaapi" | "software" | null {
  if (!codec) return null;
  const c = codec.toLowerCase();
  if (c.includes("nvenc")) return "nvenc";
  if (c.includes("videotoolbox")) return "videotoolbox";
  if (c.includes("qsv")) return "qsv";
  if (c.includes("amf")) return "amf";
  if (c.includes("vaapi")) return "vaapi";
  return "software";
}

const PIXEL_FORMATS_WITH_ALPHA = new Set<string>([
  "yuva420p",
  "yuva422p",
  "yuva444p",
  "yuva444p10le",
  "rgba",
  "argb",
  "bgra",
  "abgr",
  "ya8",
  "gbrp", // planar RGB; alpha via stream metadata
]);

const PRORES_ALPHA_PROFILES = new Set<string>(["4444", "4444xq", "4", "5"]);

const WEBM_AUDIO_CODECS = new Set<string>([
  "libopus",
  "opus",
  "libvorbis",
  "vorbis",
]);

const AUDIO_ONLY_CONTAINERS = new Set<string>([
  "mp3",
  "wav",
  "flac",
  "aac",
  "m4a",
  "ogg",
  "opus",
  "ac3",
  "eac3",
  "dts",
  "amr",
  "caf",
]);

const AUDIO_CODEC_FAMILY_OPUS = new Set<string>(["libopus", "opus"]);

/**
 * H.264 max luma sample rate per level (samples/sec). Picked from
 * the H.264 spec table — values for levels people commonly select.
 */
const H264_LEVEL_LUMA_SAMPLE_RATE = new Map<string, number>([
  ["1", 380_160],
  ["1b", 380_160],
  ["1.1", 768_000],
  ["1.2", 1_536_000],
  ["1.3", 3_041_280],
  ["2", 3_041_280],
  ["2.1", 5_068_800],
  ["2.2", 5_184_000],
  ["3", 10_368_000],
  ["3.1", 27_648_000],
  ["3.2", 55_296_000],
  ["4", 62_914_560],
  ["4.1", 62_914_560],
  ["4.2", 133_693_440],
  ["5", 150_994_944],
  ["5.1", 251_658_240],
  ["5.2", 530_841_600],
  ["6", 1_069_547_520],
  ["6.1", 2_139_095_040],
  ["6.2", 4_278_190_080],
]);
