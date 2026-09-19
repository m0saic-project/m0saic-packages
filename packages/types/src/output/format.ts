// =============================================================================
// Output kind / containers
// =============================================================================

export type OutputKind = "video" | "image" | "audio";

/**
 * Container formats classified as video-family (multi-stream,
 * may carry audio).
 *
 * The list mirrors ffmpeg's commonly-used output muxers. Use the
 * `(string & {})` escape hatch on {@link MosaicOutputFormat.container}
 * for muxers not enumerated here — the type is permissive on purpose.
 *
 * **Engine support is the gating factor**, not this list. The engine's
 * `resolveOutputFormat` resolver in `@m0saic/core` defines which
 * containers are wired end-to-end (codec/pixelFormat compatibility,
 * audio routing, atom writing). Authoring a container the engine
 * doesn't yet support produces a structured `UNSUPPORTED_COMBINATION`
 * diagnostic at resolve time.
 *
 * Notes on common entries:
 * - `mp4` / `mov` / `m4v` — ISO Base Media variants; mp4 is the
 *   universal web default. `m4v` is Apple's mp4 alias commonly used
 *   for iTunes-compatible content.
 * - `webm` — VP8/VP9/AV1 + Opus/Vorbis; alpha-capable via `yuva*` pixfmts.
 * - `mkv` — Matroska; the most codec-permissive container.
 * - `avi` — legacy, broadly compatible; no modern codec features.
 * - `flv` / `f4v` — Adobe Flash; mostly historical but ffmpeg still
 *   muxes them.
 * - `ts` / `m2ts` / `mpg` — MPEG transport / program / system streams;
 *   broadcast and DVD/Blu-ray adjacent.
 * - `3gp` / `3g2` — mobile-targeted mp4 variants (smaller framerates,
 *   AMR audio).
 * - `wmv` / `asf` — Microsoft ASF container. Filenames typically `.wmv`;
 *   ffmpeg routes both to the `asf` muxer.
 * - `mxf` / `dv` / `nut` — professional / broadcast / interchange.
 */
export const VIDEO_CONTAINERS = [
  // Modern web / cross-platform
  "mp4",
  "webm",
  "mkv",
  "mov",
  // Apple-flavored mp4
  "m4v",
  // Legacy / broadly compatible
  "avi",
  "flv",
  // MPEG transport / system / program streams
  "ts",
  "m2ts",
  "mpg",
  // Mobile mp4 variants
  "3gp",
  "3g2",
  // Microsoft ASF (WMV is video-in-ASF)
  "wmv",
  "asf",
  // Adobe Flash
  "f4v",
  // Professional / broadcast / interchange
  "mxf",
  "dv",
  "nut",
] as const;
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number];

/**
 * Container formats classified as image-family (single-stream, no
 * audio; may carry multiple frames).
 *
 * **Engine support is the gating factor**, not this list — see
 * {@link VIDEO_CONTAINERS} for the disclaimer.
 *
 * Per-entry notes:
 *
 * - `png` — lossless, alpha-capable; single frame (default) or a
 *   numbered sequence via {@link MosaicOutputFormat.frameCount} =
 *   `"sequence"` (the engine substitutes a `%04d` pattern into the
 *   output filename).
 * - `jpeg` — lossy, no alpha; same single-frame / sequence behavior
 *   as `png`.
 * - `gif` — palette-based (max 256 colors), no audio stream. **GIF
 *   is animation-capable** despite its image-container classification,
 *   and m0saic treats it accordingly:
 *
 *   - **Input side**: animated GIFs come in as
 *     {@link MosaicMediaSource} with `mediaType: "video"` — ffmpeg
 *     decodes GIF as a video stream regardless of frame count, so the
 *     engine sees one frame or many frames through the same media
 *     pipeline.
 *   - **Output side**: the {@link MosaicOutputTarget} `"animated-gif"`
 *     pairs the `gif` encoder with `palettegen` + `paletteuse` filters
 *     automatically (palette quantization is a filtergraph concern,
 *     not a codec option). A single-frame GIF output uses the same
 *     encoder with `frameCount: 1`.
 *
 *   GIF stays in the image-container set because its container-level
 *   shape (no audio, palette encoding, single stream) is image-family;
 *   the animation lives in the frame count, not the container kind.
 * - `apng` — animated PNG; alpha-capable; same single-vs-sequence
 *   duality as gif but lossless.
 * - `webp` — modern compressed image; animation-capable; alpha-capable.
 * - `avif` — AV1-coded still / sequence; modern compression; alpha-capable.
 * - `tiff` — multi-page lossless; common for VFX/print pipelines.
 * - `bmp` — uncompressed bitmap; rarely useful but ffmpeg supports it.
 * - `ico` — Windows icon container; multi-resolution.
 */
export const IMAGE_CONTAINERS = [
  // Classic
  "png",
  "jpeg",
  "gif",
  // Modern animation-capable / compressed
  "apng",
  "webp",
  "avif",
  // Specialized
  "tiff",
  "bmp",
  "ico",
] as const;
export type ImageContainer = (typeof IMAGE_CONTAINERS)[number];

/**
 * Container formats classified as audio-family (single audio stream,
 * no video).
 *
 * **Engine support is the gating factor**, not this list — see
 * {@link VIDEO_CONTAINERS} for the disclaimer.
 *
 * Per-entry notes:
 *
 * - `mp3` — libmp3lame; universal. Lossy.
 * - `wav` / `flac` — uncompressed PCM / lossless FLAC. Studio masters.
 * - `aac` — raw AAC bitstream; often packaged in `m4a` instead.
 * - `m4a` — mp4 container holding AAC audio only; the iTunes default.
 * - `ogg` / `opus` — Xiph containers; opus is modern WebRTC-friendly,
 *   ogg is the broader Vorbis/Speex/FLAC envelope.
 * - `ac3` / `eac3` / `dts` — surround-sound interchange formats.
 * - `amr` — AMR-NB/AMR-WB voice codec; mobile / telephony.
 * - `caf` — Apple Core Audio File; multi-codec.
 */
export const AUDIO_CONTAINERS = [
  // Most common
  "mp3",
  "wav",
  "flac",
  "aac",
  "m4a",
  // Xiph
  "ogg",
  "opus",
  // Surround / pro
  "ac3",
  "eac3",
  "dts",
  // Mobile / Apple
  "amr",
  "caf",
] as const;
export type AudioContainer = (typeof AUDIO_CONTAINERS)[number];

export type OutputContainer = VideoContainer | ImageContainer | AudioContainer;

// =============================================================================
// Video codecs
// =============================================================================
/**
 * Video encoder names m0saic recognizes.
 *
 * Mirrors ffmpeg's encoder surface across software, vendor-hardware,
 * and OS-generic-hardware families. **Engine support is the gating
 * factor**; this list is documentation/autocomplete only.
 *
 * # Software vs. hardware
 *
 * Hardware encoders are typically **5–20× faster** than their software
 * counterparts:
 *
 * - NVENC (NVIDIA) — 10–20× on dedicated encode silicon (Turing+).
 * - VideoToolbox (Apple Silicon) — 5–10×; ProRes acceleration is
 *   especially strong on M-series chips with dedicated ProRes hardware.
 * - QSV (Intel Quick Sync) — 5–10× on iGPUs from Skylake forward;
 *   Arc/Xe adds AV1.
 * - AMF (AMD) — comparable to QSV; AV1 lands on RDNA 3+.
 * - VAAPI (Linux generic) — wraps whatever hardware backend is
 *   available (intel/amd/nvidia) under one API.
 *
 * The tradeoff is **quality-per-byte**. Software encoders (especially
 * libx264 with `slow`/`veryslow` presets, libx265, and SVT-AV1) still
 * win bitrate efficiency at a given visual quality. The gap has closed
 * for modern silicon (Ada-gen NVENC, Apple Silicon, RDNA 3) but exists.
 * Pick hardware for preview, social, high-throughput, or
 * battery-constrained workflows; pick software for archival masters
 * and tight bitrate budgets.
 *
 * # Pixel format constraints
 *
 * Hardware encoders typically require `nv12` or `yuv420p` input. The
 * engine inserts a `format=nv12` filter when necessary; users
 * generally don't need to set `pixelFormat` explicitly for hardware
 * targets. 10-bit is supported on newer hardware (HEVC/AV1 on Ada,
 * Apple Silicon, Arc) but not on older silicon — the engine validates
 * at resolve time.
 *
 * # Runtime availability
 *
 * Hardware encoders depend on the renderer's machine. The engine
 * probes availability at startup (or per-render) via
 * `ffmpeg -codecs` / `-hwaccels` and falls back to a software encoder
 * of the same codec family when unavailable, emitting a
 * `HARDWARE_ENCODER_FALLBACK` diagnostic so authors notice.
 *
 * # Decoding is a separate concern
 *
 * This list is for **output** encoding. Hardware decoders (the input
 * side — also potentially 5–20× faster, especially for 4K/8K input)
 * are auto-selected by ffmpeg based on input format. The engine can
 * additionally opt into `-hwaccel videotoolbox|cuda|qsv|vaapi` to keep
 * frames on the GPU end-to-end. Those are engine-internal flags, not
 * fields on this type.
 */
export const VIDEO_CODECS = [
  // ─── Software ──────────────────────────────────────────────
  "libx264",
  "libx265",
  "libopenh264",
  "libvpx-vp9",
  "libaom-av1",
  "libsvtav1",            // fast software AV1 (SVT)
  "prores_ks",            // ProRes (kostya)
  "prores_aw",            // ProRes (anatoliy)
  "mjpeg",
  // ─── Hardware: macOS / iOS (VideoToolbox) ──────────────────
  "h264_videotoolbox",
  "hevc_videotoolbox",
  "prores_videotoolbox",  // Apple Silicon ProRes hardware
  // ─── Hardware: NVIDIA (NVENC) ──────────────────────────────
  "h264_nvenc",
  "hevc_nvenc",
  "av1_nvenc",            // Ada (RTX 40+) and newer
  // ─── Hardware: Intel (Quick Sync Video) ────────────────────
  "h264_qsv",
  "hevc_qsv",
  "av1_qsv",              // Arc / Xe and newer
  "vp9_qsv",
  // ─── Hardware: AMD (AMF) ───────────────────────────────────
  "h264_amf",
  "hevc_amf",
  "av1_amf",              // RDNA 3+
  // ─── Hardware: Linux generic (VAAPI) ───────────────────────
  "h264_vaapi",
  "hevc_vaapi",
  "av1_vaapi",
  "vp9_vaapi",
  "mjpeg_vaapi",
] as const;
export type VideoCodec = (typeof VIDEO_CODECS)[number];

// =============================================================================
// Audio codecs
// =============================================================================

export const AUDIO_CODECS = [
  "aac",
  "libmp3lame",
  "libopus",
  "flac",
  "pcm_s16le",
  "pcm_s24le",
] as const;
export type AudioCodec = (typeof AUDIO_CODECS)[number];

// =============================================================================
// Pixel formats
// =============================================================================
// Validation of codec × pixelFormat compatibility happens in
// `@m0saic/core/output/resolveOutputFormat`. ProRes alpha is gated on
// profile 4 / 4444xq (profile 5), not just the pixel-format name.

export const PIXEL_FORMATS = [
  // 8-bit YUV (planar)
  "yuv420p",
  "yuvj420p",
  "yuv422p",
  "yuvj422p",
  "yuv444p",
  "yuvj444p",
  // 8-bit YUV + alpha
  "yuva420p",
  "yuva422p",
  "yuva444p",
  // 8-bit RGB
  "rgb24",
  "bgr24",
  "rgba",
  "argb",
  "bgra",
  "abgr",
  // Grayscale
  "gray",
  "ya8",
  // 10-bit YUV (planar) — software encoders (libx265, libvpx-vp9, libsvtav1)
  "yuv420p10le",
  "yuv422p10le",
  "yuv444p10le",
  "yuva444p10le",
  // 10-bit / 16-bit YUV (semi-planar) — hardware HDR paths
  // (NVENC HEVC/AV1, QSV HEVC/AV1, AMF HEVC/AV1, VideoToolbox HEVC).
  // p010le: Y plane + interleaved UV plane, 10-bit; the canonical
  //   hardware HEVC/AV1 input for HDR10 / Dolby Vision base layer / HLG.
  // p016le: same shape, 16-bit; used by VFX intermediates and scientific
  //   imaging pipelines.
  "p010le",
  "p016le",
  // Planar RGB
  "gbrp",
  "gbrp10le",
  // Palette (GIF)
  "pal8",
] as const;
export type PixelFormat = (typeof PIXEL_FORMATS)[number];

// =============================================================================
// Encoder preset / profile / level constants
// =============================================================================
//
// Per-codec well-known values for `MosaicOutputFormat.encoderPreset`,
// `encoderProfile`, and `encoderLevel`. The fields themselves stay
// typed as `string` (codec-aware unions would be a step too far for
// JSON-loadable data), but these tuples let editors and validators
// surface codec-correct dropdowns + reject obvious mismatches like
// `videoCodec: "libvpx-vp9"` + `encoderPreset: "veryslow"` (VP9 uses
// realtime/good/best instead).
//
// **Engine support is the gating factor**. ffmpeg accepts more
// values than listed here for some codecs (e.g. x264 ignores unknown
// preset strings rather than failing). These are the values m0saic
// has verified pass through unchanged.

/**
 * x264 / x265 encoder presets — speed-vs-quality knob. Lower = faster
 * encode, larger file at same quality. Higher = slower encode,
 * smaller file at same quality.
 *
 * Both libx264 and libx265 accept the same list (libx265 ignores
 * `placebo` and `ultrafast` produces almost-uncompressed output).
 * Maps to ffmpeg `-preset`.
 */
export const X264_X265_ENCODER_PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
  "placebo",
] as const;
export type X264X265EncoderPreset = (typeof X264_X265_ENCODER_PRESETS)[number];

/**
 * VP9 encoder presets — sometimes called `-deadline` in ffmpeg CLI
 * notation. The Make page accepts this via `encoderPreset` and the
 * engine translates to the right ffmpeg flag for the codec.
 *
 *  - `realtime`: fastest, lowest quality. Live streaming / preview.
 *  - `good`:     balanced default.
 *  - `best`:     slowest, highest quality. Multi-pass authoring.
 */
export const VP9_ENCODER_PRESETS = ["realtime", "good", "best"] as const;
export type VP9EncoderPreset = (typeof VP9_ENCODER_PRESETS)[number];

/**
 * AV1 (libaom / libsvtav1) encoder presets are numeric `cpu-used`
 * values. Lower = slower + better; higher = faster + worse. Range
 * varies per encoder:
 *  - libaom-av1:   0 (best) .. 8 (fastest)
 *  - libsvtav1:    0 (best) .. 13 (fastest); typical "good" range 4–8
 *
 * The string form ("0".."13") is what `encoderPreset` carries — the
 * engine parses to integer and routes to the right ffmpeg flag.
 */
export const AV1_ENCODER_PRESETS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
] as const;
export type AV1EncoderPreset = (typeof AV1_ENCODER_PRESETS)[number];

/**
 * NVENC encoder presets (h264_nvenc, hevc_nvenc, av1_nvenc). NVIDIA
 * deprecated the named-preset surface in favor of `p1`–`p7`
 * (p1=fastest..p7=slowest) starting with the SDK 9 transition;
 * legacy named presets still parse for back-compat.
 *
 * Maps to ffmpeg `-preset` on NVENC encoders.
 */
export const NVENC_ENCODER_PRESETS = [
  "p1",
  "p2",
  "p3",
  "p4",
  "p5",
  "p6",
  "p7",
  // Legacy named presets (still accepted by current ffmpeg builds)
  "default",
  "slow",
  "medium",
  "fast",
  "hp",
  "hq",
  "bd",
  "ll",
  "llhq",
  "llhp",
  "lossless",
  "losslesshp",
] as const;
export type NVENCEncoderPreset = (typeof NVENC_ENCODER_PRESETS)[number];

/**
 * H.264 encoder profiles. Maps to ffmpeg `-profile:v` on libx264 +
 * H.264 hardware encoders. `high10` / `high422` / `high444` carry
 * higher bit depths; `baseline` is the broadest decoder coverage at
 * the cost of compression efficiency.
 */
export const H264_ENCODER_PROFILES = [
  "baseline",
  "main",
  "high",
  "high10",
  "high422",
  "high444",
] as const;
export type H264EncoderProfile = (typeof H264_ENCODER_PROFILES)[number];

/**
 * HEVC (H.265) encoder profiles. Maps to ffmpeg `-profile:v` on
 * libx265 + HEVC hardware encoders. `main10` is the canonical
 * 10-bit profile; `main12` is the canonical 12-bit profile.
 *
 * `main-intra` / `main10-intra` are intra-only variants for editing
 * pipelines (mezzanines, NLE proxies); typical authoring uses
 * `main` or `main10`.
 */
export const HEVC_ENCODER_PROFILES = [
  "main",
  "main10",
  "main12",
  "main-intra",
  "main10-intra",
  "main-stillpicture",
  "main444-8",
  "main444-10",
  "main444-12",
] as const;
export type HEVCEncoderProfile = (typeof HEVC_ENCODER_PROFILES)[number];

/**
 * ProRes (prores_ks / prores_aw) encoder profiles. Numeric form
 * (0–5) and string form both work in ffmpeg; the string form is
 * what the editor surfaces because it's self-documenting.
 *
 *   0 / "proxy"     ~ 45 Mb/s @ 1080p — preview / proxy.
 *   1 / "lt"        ~ 102 Mb/s @ 1080p — broadcast lt mezzanine.
 *   2 / "standard"  ~ 147 Mb/s @ 1080p — 4:2:2 std.
 *   3 / "hq"        ~ 220 Mb/s @ 1080p — 4:2:2 hq.
 *   4 / "4444"      — 4:4:4:4 with alpha; ~ 330 Mb/s @ 1080p.
 *   5 / "4444xq"    — 4:4:4:4 with alpha at quintile bitrate; ~ 500 Mb/s @ 1080p.
 */
export const PRORES_ENCODER_PROFILES = [
  "proxy",
  "lt",
  "standard",
  "hq",
  "4444",
  "4444xq",
] as const;
export type ProResEncoderProfile = (typeof PRORES_ENCODER_PROFILES)[number];

/**
 * H.264 encoder levels. Constrain max bitrate + frame size +
 * frame-rate combinations. Maps to ffmpeg `-level`.
 *
 * Common picks:
 *  - `"3.1"`: SD/720p web (≤14 Mb/s, ≤30fps@720p)
 *  - `"4.0"`: 1080p30 (≤25 Mb/s)
 *  - `"4.1"`: Blu-ray master (≤62.5 Mb/s)
 *  - `"5.1"`: 4K30 (≤300 Mb/s)
 *  - `"5.2"`: 4K60 (≤300 Mb/s sustained)
 *  - `"6.0"`/`"6.1"`/`"6.2"`: 8K, ≤480 / ≤960 Mb/s.
 *
 * Picking too low a level for the resolution/bitrate is one of the
 * most common encode failures — the C.1 validator will flag this.
 */
export const H264_ENCODER_LEVELS = [
  "1",
  "1b",
  "1.1",
  "1.2",
  "1.3",
  "2",
  "2.1",
  "2.2",
  "3",
  "3.1",
  "3.2",
  "4",
  "4.1",
  "4.2",
  "5",
  "5.1",
  "5.2",
  "6",
  "6.1",
  "6.2",
] as const;
export type H264EncoderLevel = (typeof H264_ENCODER_LEVELS)[number];

/**
 * HEVC (H.265) encoder levels. Same structure as H.264 levels but
 * different bitrate / resolution constraints (HEVC supports ~2× the
 * pixel rate of H.264 at the same level due to better compression).
 * Maps to ffmpeg `-level`.
 */
export const HEVC_ENCODER_LEVELS = [
  "1",
  "2",
  "2.1",
  "3",
  "3.1",
  "4",
  "4.1",
  "5",
  "5.1",
  "5.2",
  "6",
  "6.1",
  "6.2",
] as const;
export type HEVCEncoderLevel = (typeof HEVC_ENCODER_LEVELS)[number];

/**
 * Codec-family classification used by the codec→options helpers
 * below. Recognizes both bare family names (`"h264"`, `"hevc"`,
 * `"av1"`, `"vp9"`, `"prores"`) AND prefixed/suffixed encoder
 * implementations (`"libx264"`, `"h264_nvenc"`, `"h264_videotoolbox"`,
 * `"libsvtav1"`, `"libvpx-vp9"`, etc.).
 *
 * The `*265*` / `*hevc*` check runs BEFORE `*264*` because
 * `"libx265"` contains the substring "26" → "265" wins via the
 * hevc bucket, and there's no overlap risk going the other way.
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

/**
 * Hardware-encoder backend classification. NVENC has a canonical
 * preset surface (`p1`..`p7` + legacy names); other hardware
 * backends (VideoToolbox, QSV, AMF, VAAPI) don't have a clean
 * `-preset` mapping — the preset picker falls back to free-text
 * for those (the user can still pass through codec-specific
 * strings via the escape hatch).
 */
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

/**
 * Codec family helpers — given a video codec name (bare family or
 * any encoder implementation), report which preset / profile /
 * level constant tuple applies. UI dropdowns + validators use these
 * to surface codec-correct options.
 *
 * Returns `null` when the codec is unknown OR doesn't support that
 * field (e.g. ProRes has no preset surface; VideoToolbox H.264 has
 * no `-preset` flag; mjpeg has no profile/level/preset). Callers
 * fall back to a free-text input when null so the user can still
 * pass through codec-specific strings.
 */
export function getEncoderPresetsForCodec(
  codec: string | undefined | null,
): readonly string[] | null {
  if (!codec) return null;
  // NVENC family always gets the NVENC preset surface regardless of
  // which codec it implements (h264_nvenc / hevc_nvenc / av1_nvenc).
  const hw = codecHardwareKind(codec);
  if (hw === "nvenc") return NVENC_ENCODER_PRESETS;
  // Other hardware backends don't have a canonical preset surface —
  // free-text only. The user can pass through implementation-specific
  // flags via the escape hatch.
  if (hw && hw !== "software") return null;
  // Software encoders dispatch by codec family.
  const family = codecFamily(codec);
  if (family === "h264" || family === "hevc")
    return X264_X265_ENCODER_PRESETS;
  if (family === "vp9") return VP9_ENCODER_PRESETS;
  if (family === "av1") return AV1_ENCODER_PRESETS;
  // ProRes, mjpeg, unknown families → free-text.
  return null;
}

export function getEncoderProfilesForCodec(
  codec: string | undefined | null,
): readonly string[] | null {
  if (!codec) return null;
  const family = codecFamily(codec);
  if (family === "h264") return H264_ENCODER_PROFILES;
  if (family === "hevc") return HEVC_ENCODER_PROFILES;
  if (family === "prores") return PRORES_ENCODER_PROFILES;
  return null;
}

export function getEncoderLevelsForCodec(
  codec: string | undefined | null,
): readonly string[] | null {
  if (!codec) return null;
  const family = codecFamily(codec);
  if (family === "h264") return H264_ENCODER_LEVELS;
  if (family === "hevc") return HEVC_ENCODER_LEVELS;
  return null;
}

// =============================================================================
// New flat MosaicOutputFormat (canonical going forward)
// =============================================================================
//
// Flat envelope with optional fields. Replaces the discriminated-union
// `OutputFormatRequest` pattern below (kept for compat). Validation of
// container × codec × pixelFormat triples is the engine's job, not the
// type's.
//
// Notable design choices:
// - `hasAlpha` is intentionally omitted: alpha presence is encoded in the
//   pixel-format name (`yuva*`, `rgba`, `argb`, `bgra`). ProRes is the
//   one exception (profile 0–3 cannot carry alpha even when pixfmt
//   suggests it); validate via codec+profile+pixelFormat triple.
// - String escape hatches (`| (string & {})`) on codec / container /
//   pixelFormat let new ffmpeg encoders be authored without a type-shape
//   bump.
// - `encoderOptions` is the escape hatch for codec-specific flags
//   (`-x264-params keyint=300:aq-mode=2`, `-x265-params crf=20`, etc.).
//   The engine flattens this per-codec at wiring time.
// - VP9 CRF is inverted relative to x264/x265/AV1 (higher = worse).
//   Document this in template-authoring guides; the engine does not
//   normalize.

/**
 * Output format knobs for a {@link MosaicOutput}.
 *
 * All fields optional. Engine resolves missing fields against:
 *   1. The {@link MosaicOutput.target} preset, if set.
 *   2. The hardcoded defaults in `@m0saic/core/defaults.ts`.
 *
 * Engine wiring of many fields is deferred per plan §D9 — fields the
 * engine cannot yet honor are silently ignored.
 */
export type MosaicOutputFormat = {
  /**
   * Output stream kind. Drives encoder selection when ambiguous.
   * Required when the container alone doesn't disambiguate (e.g.,
   * `.mkv` could be video or audio).
   */
  kind?: OutputKind;

  /**
   * Container format. Accepts strings outside the typed unions to
   * allow future containers without a type-shape bump.
   * Maps to ffmpeg `-f` (when extension doesn't auto-detect).
   */
  container?: OutputContainer | (string & {});

  /**
   * Video encoder name. Maps to ffmpeg `-c:v`.
   * Accepts strings outside {@link VideoCodec} for future codecs and
   * platform-specific hardware encoders.
   */
  videoCodec?: VideoCodec | (string & {});

  /**
   * Audio encoder name. Maps to ffmpeg `-c:a`. Audio-only targets and
   * video targets with embedded audio both honor this. (Also surfaced
   * on {@link MosaicAudioConfig.codec}; either location is honored,
   * with audio.codec winning if both are set.)
   */
  audioCodec?: AudioCodec | (string & {});

  /**
   * Pixel format. Maps to ffmpeg `-pix_fmt`.
   * Codec compatibility validated at resolve time.
   */
  pixelFormat?: PixelFormat | (string & {});

  /**
   * For image outputs:
   * - `1`         — single still (maps to `-frames:v 1`).
   * - `"sequence"` — numbered sequence (engine substitutes a `%04d`
   *                  pattern into the output filename).
   */
  frameCount?: 1 | "sequence";

  /**
   * Target bitrate in ffmpeg notation (e.g. `"4M"`, `"1500k"`).
   * Maps to ffmpeg `-b:v`. Conflicts with {@link crf}: when both are
   * set, the engine prefers `crf` (quality-driven beats size-driven).
   */
  bitrate?: string;

  /**
   * Constant Rate Factor (quality target).
   *
   * **VP9 CRF is inverted** (`0` best, `63` worst) — opposite of
   * x264/x265/AV1 (`0` lossless, `~18–23` good, `51` worst). The
   * engine does not normalize; pass raw values appropriate to the
   * selected `videoCodec`.
   *
   * Maps to ffmpeg `-crf`.
   */
  crf?: number;

  /**
   * Encoder speed/quality preset. x264/x265 values: `"ultrafast"`,
   * `"superfast"`, `"veryfast"`, `"faster"`, `"fast"`, `"medium"`,
   * `"slow"`, `"slower"`, `"veryslow"`, `"placebo"`. VP9 maps to
   * `"realtime"`, `"good"`, `"best"` via `-deadline`.
   *
   * Maps to ffmpeg `-preset` (codec-aware).
   */
  encoderPreset?: string;

  /**
   * Encoder profile. x264: `"baseline"`, `"main"`, `"high"`,
   * `"high10"`, `"high422"`, `"high444"`. ProRes (prores_ks): `"proxy"`,
   * `"lt"`, `"standard"`, `"hq"`, `"4444"`, `"4444xq"` (or integer
   * 0–5 as a string).
   *
   * Maps to ffmpeg `-profile:v`.
   */
  encoderProfile?: string;

  /**
   * Encoder level constraint (e.g. H.264 `"3.1"`, `"4.0"`, `"5.1"`).
   * Maps to ffmpeg `-level`.
   */
  encoderLevel?: string;

  /**
   * Maximum GOP size (keyframe interval) in frames.
   * Maps to ffmpeg `-g`.
   *
   * For finer keyframe control (min interval, scene-cut threshold)
   * use {@link encoderOptions} with codec-specific keys.
   */
  gopSize?: number;

  /**
   * Escape hatch for codec-specific tuning flags that don't fit into
   * top-level fields. Engine routes per-codec:
   *
   * - libx264:    flattened to `-x264-params key=val:...`
   * - libx265:    flattened to `-x265-params key=val:...`
   * - libvpx-vp9: passed as `-cpu-used`, `-deadline`, etc. individually
   * - libaom-av1: passed as `-cpu-used`, `-tile-columns`, etc.
   * - aac:        passed as `-aac-coder`, `-cutoff`, etc.
   * - libopus:    passed as `-vbr`, `-compression_level`, etc.
   *
   * Document supported keys in template/CLI guides; the type is
   * intentionally permissive.
   */
  encoderOptions?: Record<string, string | number>;
};
