import type { MosaicEngineContext, MosaicMediaKind } from "@m0saic/types";
import {
  ANIMATED_IMAGE_EXTENSIONS,
  STATIC_IMAGE_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS,
} from "@m0saic/types";

/**
 * Determines the media type (video/image) for a given clip path/URL.
 *
 * First checks the engine's media registry for metadata (which uses ffprobe
 * to detect if animated formats like GIF actually contain video streams).
 * Then falls back to inferring from file extension:
 * - Animated-capable formats (gif, webp, etc.) default to "video" since
 *   they may contain animation that behaves like video
 * - Static-only formats (jpg, png, etc.) default to "image"
 * - Known video formats default to "video"
 * - Unknown formats default to "video" as a safe fallback
 *
 * @param clip - The media file path or URL
 * @param ctx - The engine context containing media metadata registry
 * @returns The determined media kind ("video" or "image")
 */
export function determineMediaType(
  clip: string,
  ctx: MosaicEngineContext
): MosaicMediaKind {
  // Try to look up in media registry (keyed by AssetId in the post-manifest
  // world). ffprobe-detected animated GIFs/webp/etc. surface as "video"
  // in the metadata. We accept a plain string here for ergonomic callers
  // and cast through the brand.
  const metadata = (ctx.media as unknown as Record<string, typeof ctx.media[keyof typeof ctx.media]>)[clip];
  if (metadata?.kind && metadata.kind !== "unknown") {
    return metadata.kind;
  }

  // Fallback: infer from file extension
  const ext = clip.split(".").pop()?.toLowerCase();
  if (!ext) {
    return "video"; // Unknown format, default to video
  }

  // Animated-capable formats default to "video" since they may contain animation
  if ((ANIMATED_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    return "video";
  }

  // Static-only image formats default to "image"
  if ((STATIC_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    return "image";
  }

  // Known video formats
  if ((VIDEO_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    return "video";
  }

  // Unknown format, default to video (safe fallback)
  return "video";
}
