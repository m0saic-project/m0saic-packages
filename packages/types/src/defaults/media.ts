/**
 * Image file extensions that can contain animation/sequences.
 * These formats may behave like video (have frames/time) and should
 * default to "video" mediaType when metadata is unavailable, since
 * ffprobe will detect animated versions as having video streams.
 */
export const ANIMATED_IMAGE_EXTENSIONS = [
  "gif",   // GIF (commonly animated; behaves like video with frames/time)
  "webp",  // WebP (can be animated)
  "avif",  // AVIF (can be animated)
  "apng",  // APNG (animated PNG)
] as const;

/**
 * Static-only image file extensions (lowercase, without dot).
 * These formats are always still images and never contain animation.
 *
 * Note: Some formats (e.g. HEIC/HEIF) technically support sequences,
 * but are overwhelmingly used as single-frame photos; we treat them
 * as static and rely on ffprobe when metadata is available.
 */
export const STATIC_IMAGE_EXTENSIONS = [
  "jpg",   // JPEG (most common photo format)
  "jpeg",  // JPEG (alternative extension)
  "jfif",  // JPEG File Interchange Format
  "png",   // PNG (lossless with transparency)
  "bmp",   // BMP (Windows bitmap, uncompressed)
  "tiff",  // TIFF (professional/archival format)
  "tif",   // TIFF (alternative extension)
  "ico",   // ICO (Windows icon format)
  "heic",  // HEIC (typically single-frame photos)
  "heif",  // HEIF (HEIC alternative extension)
  // "svg" intentionally excluded: vector format, handled separately
] as const;

/**
 * All image file extensions (static + animated-capable).
 * Used for inferring media type from file paths/URLs.
 */
export const IMAGE_FILE_EXTENSIONS = [
  ...STATIC_IMAGE_EXTENSIONS,
  ...ANIMATED_IMAGE_EXTENSIONS,
] as const;

/**
 * Common video file extensions (lowercase, without dot).
 * Used for inferring media type from file paths/URLs.
 */
export const VIDEO_FILE_EXTENSIONS = [
  "mp4",   // MP4 (most common, H.264/H.265)
  "webm",  // WebM (royalty-free, HTML5 video)
  "mov",   // MOV (Apple QuickTime format)
  "mkv",   // MKV (Matroska, open container)
  "avi",   // AVI (Microsoft format, various codecs)
  "m4v",   // M4V (iTunes video format)
  "ogv",   // OGV (Ogg Video, free format)
  "wmv",   // WMV (Windows Media Video)
  "flv",   // FLV (Flash Video, legacy web)
  "3gp",   // 3GP (mobile device format)
  "mpg",   // MPEG video
  "mpeg",  // MPEG video (alternative extension)
] as const;

/**
 * Canonical default output container (file extension, lowercase, no dot)
 * for each {@link MosaicOutputKind}.
 *
 * Used as the fallback when an output's `kind` is known but no explicit
 * container has been chosen. Centralising the pick keeps every surface
 * that has to invent a default filename in agreement:
 *
 *   • CLI: `--output` default + `getDefaultOutputFilenameFromFormat`
 *     (previously held a CLI-local `DEFAULT_VIDEO_OUTPUT_FILENAME =
 *     "out.mp4"` / `DEFAULT_IMAGE_OUTPUT_FILENAME = "out.png"` pair as a
 *     workaround for these constants being dropped during the type
 *     redesign; promotes those workarounds back into the canonical
 *     source of truth).
 *   • Electron save-dialog handler (`mosaic:pickSavePath` /
 *     `mosaic:defaultOutputPath`): picks the default extension when the
 *     web app passes `{ kind }` but not `{ container }`, and decides
 *     which extension filter to surface in the OS picker.
 *   • Make page: the auto-default-output-path effect and the
 *     "Choose…" button.
 *
 * Per-kind picks:
 *   • `"image"` → `"png"` — supports alpha, lossless, universally
 *     readable. Templates with `outputHints.format.kind === "image"`
 *     (e.g. Brand QR) save as `.png` by default.
 *   • `"video"` → `"mp4"` — H.264-in-MP4 is the most compatible
 *     deliverable. Templates targeting video are at least mp4-capable.
 */
export const DEFAULT_OUTPUT_CONTAINER_BY_KIND = {
  image: "png",
  video: "mp4",
} as const;

/**
 * The set of file extensions we'll show in the OS save dialog's filter
 * for a given output {@link MosaicOutputKind}. The picker lets the user
 * choose any extension in the list; we infer the actual container from
 * the chosen extension downstream.
 *
 * For `"image"` we include both static and animated-capable image
 * extensions — an "image" output from m0saic is rarely an animated
 * format in practice, but allowing the user to type `.gif` / `.webp`
 * isn't wrong.
 */
export const SAVE_DIALOG_EXTENSIONS_BY_KIND = {
  image: IMAGE_FILE_EXTENSIONS,
  video: VIDEO_FILE_EXTENSIONS,
} as const;
