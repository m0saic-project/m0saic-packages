/**
 * Helper-level deprecation registry for `@m0saic/template-utils`.
 *
 * The library-API sibling of `MosaicTemplate.deprecated` (`@m0saic/types`):
 * a deprecated helper KEEPS WORKING for its existing callers — deprecation is
 * an authoring hint, not a load-time gate — but new templates should reach
 * for the replacement. Two layers, kept in lockstep:
 *
 *   1. A `@deprecated` JSDoc tag on the export itself — that's what makes
 *      editors strike through every call site; a registry cannot do that.
 *   2. This registry — introspectable metadata (reason / replacement / since)
 *      for tooling: template audits, docs generation, periodic
 *      aged-out-deprecation sweeps.
 *
 * Adding an entry here without the `@deprecated` tag on the export (or vice
 * versa) is a bug — the unit test asserts every registered name still exists
 * on the package surface, and the tag carries a pointer back here.
 */

export type HelperDeprecation = {
  /** Why this helper is no longer the recommended pick. */
  reason: string;
  /** What to reach for instead — API name(s) plus when each fits. */
  replacement: string;
  /** ISO date (YYYY-MM-DD) the deprecation was declared. */
  since: string;
};

/**
 * Every deprecated `@m0saic/template-utils` export, keyed by export name.
 */
export const HELPER_DEPRECATIONS: Readonly<Record<string, HelperDeprecation>> = {
  gridCellInset: {
    reason:
      "Approximate, not pixel-exact: its half-gap fractions are computed against the IDEAL cell size (gridW/cols), but the engine floors frac × actualCellPx against the QUANTIZED cell the split actually produced — when the grid region doesn't divide evenly the gap wobbles ±1px per shared edge, and its plain n/cell fractions (no half-pixel centering) can floor-lose even on exactly-dividing cells. screencap_grid/v1 is the archived template-level reference for the failure.",
    replacement:
      "latticeCellInset — same compact gutterless grid() m0, but retargets each RAW parsed cell onto an authored integer lattice with half-pixel-centered fractions (exact gutters/margins at every canvas); or placeInsetPieces when the helper should own the whole layout (mixed bands, non-grid pieces, guaranteed z-order via importance).",
    since: "2026-07-21",
  },
};

/** Deprecation metadata for a template-utils export, or undefined if current. */
export function helperDeprecation(exportName: string): HelperDeprecation | undefined {
  return HELPER_DEPRECATIONS[exportName];
}

/** True when the named template-utils export is deprecated. */
export function isDeprecatedHelper(exportName: string): boolean {
  return exportName in HELPER_DEPRECATIONS;
}
