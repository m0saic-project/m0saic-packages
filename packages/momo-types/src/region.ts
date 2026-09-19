/**
 * Richer per-region annotation than today's `Record<string, string>` on
 * `M0AgentMeta.regions`. Lives under `CandidateContext.regionAnnotations`
 * so files that only need stableKey→label keep using the cheap shape and
 * upgrade in-place when they want roles or notes.
 */
export type RegionAnnotation = {
  /** Short human-readable name (same as today's bare `regions` value). */
  label: string;
  /**
   * Semantic role of the region: what it's FOR, not what it IS. Helps the
   * post-mortem template render meaningful overlays ("this is the CTA")
   * and gives the eventual layout-AI a teachable signal beyond geometry.
   */
  role?:
    | "title"
    | "body"
    | "media"
    | "caption"
    | "cta"
    | "ornament"
    | "negative-space"
    | "other";
  /** Optional free-form note about why this region matters. */
  note?: string;
};
