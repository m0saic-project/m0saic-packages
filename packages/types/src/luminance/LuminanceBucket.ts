/**
 * Time-bucketed average luminance for a region of a video.
 *
 * Produced by the engine's luminance probe and consumed by adaptive-overlay
 * templates that interpolate between light/dark asset variants based on the
 * underlying video's brightness in the overlay region.
 *
 * `avgLuma` is the smoothed average Y-channel value (0..255) across the
 * bucket window. Callers apply their own threshold / interpolation policy —
 * e.g. a simple `avgLuma > 128` split, or a continuous mix between two
 * variants weighted by `avgLuma`. Buckets cover the clip end-to-end with
 * no gaps.
 */
export type LuminanceBucket = {
  /** Inclusive ms offset from start of clip. */
  startMs: number;
  /** Exclusive ms offset from start of clip; endMs > startMs. */
  endMs: number;
  /** Smoothed average luminance of the region over this bucket, 0..255. */
  avgLuma: number;
};

/**
 * Rectangular region of a video expressed as fractions of (width, height).
 * Used by the luminance probe so callers can describe the overlay area
 * resolution-independently.
 */
export type RegionPctRect = {
  /** Left edge, fraction of width [0..1]. */
  xPct: number;
  /** Top edge, fraction of height [0..1]. */
  yPct: number;
  /** Width, fraction of width (0..1]. */
  wPct: number;
  /** Height, fraction of height (0..1]. */
  hPct: number;
};
