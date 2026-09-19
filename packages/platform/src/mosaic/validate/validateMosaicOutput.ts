import type { MosaicDiagnostic, MosaicOutput } from "@m0saic/types";
import {
  asDiagnosticCode,
  AUDIO_CONTAINERS,
  IMAGE_CONTAINERS,
  VIDEO_CONTAINERS,
} from "@m0saic/types";

/**
 * Per-output validation for a single `MosaicOutput` entry under
 * `MosaicDocument.outputs[<key>]`.
 *
 * # Field-level rules
 *
 *  - `INVALID_DURATION` — `durationMs` not a positive integer
 *  - `INVALID_FPS` — `fps` not an integer in (0, 240]
 *  - `EMPTY_BITRATE` — `format.bitrate` is the empty string
 *  - `EMPTY_PIXEL_FORMAT` — `format.pixelFormat` is the empty string
 *
 * # Container-kind matrix
 *
 * The container classifies into one of {video, image, audio} by
 * membership in `VIDEO_CONTAINERS` / `IMAGE_CONTAINERS` /
 * `AUDIO_CONTAINERS` (imported from `@m0saic/types`). Per-kind rules:
 *
 *  - **Audio containers** (`mp3`, `wav`, `flac`, `aac`, `m4a`, `ogg`,
 *    `opus`, `ac3`, `eac3`, `dts`, `amr`, `caf`):
 *    - non-empty `format.pixelFormat` → `PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER`
 *    - non-empty `format.videoCodec` → `VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER`
 *  - **Image containers** (`png`, `jpeg`, `gif`, `apng`, `webp`,
 *    `avif`, `tiff`, `bmp`, `ico`):
 *    - non-empty `format.videoCodec` → `VIDEO_CODEC_IGNORED_FOR_IMAGE_CONTAINER`
 *      (animated image-containers use their own encoder family + filter
 *      chain, not a video codec)
 *    - `output.audio` present → `AUDIO_IGNORED_FOR_IMAGE_CONTAINER`
 *
 * Called once per entry in `MosaicDocument.outputs` by
 * `validateMosaicDocument`. Phase 3d.3.
 */
export function validateMosaicOutput(
  output: MosaicOutput,
  key: string,
): MosaicDiagnostic[] {
  const diagnostics: MosaicDiagnostic[] = [];

  // ── durationMs ──────────────────────────────────────────────
  if (output.durationMs !== undefined) {
    const d = output.durationMs;
    const ok =
      typeof d === "number" &&
      Number.isFinite(d) &&
      Number.isInteger(d) &&
      d >= 1;
    if (!ok) {
      diagnostics.push({
        code: asDiagnosticCode("INVALID_DURATION"),
        message: `outputs[${JSON.stringify(key)}].durationMs must be a positive integer (got ${JSON.stringify(d)}).`,
        severity: "error",
      });
    }
  }

  // ── fps ─────────────────────────────────────────────────────
  if (output.fps !== undefined) {
    const f = output.fps;
    const ok =
      typeof f === "number" &&
      Number.isFinite(f) &&
      Number.isInteger(f) &&
      f >= 1 &&
      f <= 240;
    if (!ok) {
      diagnostics.push({
        code: asDiagnosticCode("INVALID_FPS"),
        message: `outputs[${JSON.stringify(key)}].fps must be an integer in [1, 240] (got ${JSON.stringify(f)}).`,
        severity: "error",
      });
    }
  }

  // ── format-field + container-kind matrix ────────────────────
  const format = output.format;
  if (format) {
    const container = format.container;
    const kind = classifyContainerKind(container);

    // Empty-string overrides are author bugs — defaults won't kick in
    // because the field is "set", but the value is meaningless.
    if (format.bitrate === "") {
      diagnostics.push({
        code: asDiagnosticCode("EMPTY_BITRATE"),
        message: `outputs[${JSON.stringify(key)}].format.bitrate is an empty string; omit the field to use the default instead.`,
        severity: "warning",
      });
    }
    if (format.pixelFormat === "") {
      diagnostics.push({
        code: asDiagnosticCode("EMPTY_PIXEL_FORMAT"),
        message: `outputs[${JSON.stringify(key)}].format.pixelFormat is an empty string; omit the field to use the default instead.`,
        severity: "warning",
      });
    }

    // Audio-container rules: pixel/video knobs are meaningless.
    if (kind === "audio") {
      if (format.pixelFormat !== undefined && format.pixelFormat !== "") {
        diagnostics.push({
          code: asDiagnosticCode("PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER"),
          message: `outputs[${JSON.stringify(key)}].format.pixelFormat is set (${JSON.stringify(format.pixelFormat)}) but container ${JSON.stringify(container)} is audio-only; pixel format is ignored.`,
          severity: "warning",
        });
      }
      if (format.videoCodec !== undefined && format.videoCodec !== "") {
        diagnostics.push({
          code: asDiagnosticCode("VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER"),
          message: `outputs[${JSON.stringify(key)}].format.videoCodec is set (${JSON.stringify(format.videoCodec)}) but container ${JSON.stringify(container)} is audio-only; video codec is ignored.`,
          severity: "warning",
        });
      }
    }

    // Image-container rules: video codec + audio config are meaningless.
    if (kind === "image") {
      if (format.videoCodec !== undefined && format.videoCodec !== "") {
        diagnostics.push({
          code: asDiagnosticCode("VIDEO_CODEC_IGNORED_FOR_IMAGE_CONTAINER"),
          message: `outputs[${JSON.stringify(key)}].format.videoCodec is set (${JSON.stringify(format.videoCodec)}) but container ${JSON.stringify(container)} is an image format; image containers use their own encoder family (not a video codec).`,
          severity: "warning",
        });
      }
      if (output.audio !== undefined) {
        diagnostics.push({
          code: asDiagnosticCode("AUDIO_IGNORED_FOR_IMAGE_CONTAINER"),
          message: `outputs[${JSON.stringify(key)}].audio is set but container ${JSON.stringify(container)} is an image format with no audio stream; audio config is ignored.`,
          severity: "warning",
        });
      }
    }
  }

  return diagnostics;
}

type ContainerKind = "video" | "image" | "audio" | "unknown";

/**
 * Classify a container value into its family by membership in the
 * type-side `AUDIO_CONTAINERS` / `IMAGE_CONTAINERS` / `VIDEO_CONTAINERS`
 * enumerations. Free-string values (via the `(string & {})` escape
 * hatch on `OutputContainer`) classify as `"unknown"` and skip the
 * container-kind matrix rules — they get a different diagnostic
 * elsewhere if they don't resolve in the engine's SUPPORTED table.
 */
function classifyContainerKind(container: string | undefined): ContainerKind {
  if (container === undefined) return "unknown";
  if ((AUDIO_CONTAINERS as readonly string[]).includes(container)) return "audio";
  if ((IMAGE_CONTAINERS as readonly string[]).includes(container)) return "image";
  if ((VIDEO_CONTAINERS as readonly string[]).includes(container)) return "video";
  return "unknown";
}
