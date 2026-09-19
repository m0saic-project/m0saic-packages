import type {
  MosaicColor,
  MosaicEffectProps,
  MosaicLavfiSource,
  MosaicOverlayExpr,
  MosaicPlacementProps,
  MosaicSourceMask,
} from "@m0saic/types";

/**
 * Shared factory for the canonical "solid-colour tile" source.
 *
 * Returns a {@link MosaicLavfiSource} that paints `color` into its cell
 * via ffmpeg's `color=` generator. The lavfi route is the recommended
 * convention for solid-fill tiles across all templates:
 *
 * - it's a valid {@link MosaicRefSource} target for top-level (same-doc,
 *   `descendPath === 0`) ref mirroring — see the v1 caveat in
 *   the internal rendering-model-contract notes;
 * - `color=` is essentially free in ffmpeg, so per-cell instances do
 *   not require an "intermediate to share" — refs at nested depth
 *   buy zero performance over N independent lavfi sources;
 * - it composes cleanly with the standard {@link MosaicOverlayExpr}
 *   primitives (alpha / enable / xExpr / yExpr / startAtSec) so
 *   templates can drive per-tile timing without subclassing.
 *
 * Several brand templates still ship a local `makeSolidColorTile`
 * helper that returns a {@link MosaicTextSource} with empty literal
 * text + `visual.backgroundColor`. Those are kept for golden-stability
 * and will migrate over time; **new templates should prefer this
 * helper** so the convention stays consistent.
 *
 * @example minimal
 * ```ts
 * makeColorTile("#050314");
 * ```
 *
 * @example with per-tile fade-in
 * ```ts
 * makeColorTile(color, {
 *   overlay: {
 *     alpha: `min(1,max(0,(t-${start})/${dur}))`,
 *   },
 * });
 * ```
 *
 * @example with mask
 * ```ts
 * makeColorTile(color, { mask: { kind: "image", assetId } });
 * ```
 */
export function makeColorTile(
  color: MosaicColor,
  opts?: {
    /** Full overlay expression bundle (alpha / enable / window / xExpr / yExpr / startAtSec / blendMode). */
    overlay?: MosaicOverlayExpr;
    /** Optional clip-mask for non-rect tiles. */
    mask?: MosaicSourceMask;
    /** Optional cell placement override (fit / align / inset). Rarely needed for tile primitives. */
    placement?: MosaicPlacementProps;
    /** Optional visual effects (rounding, stroke, dropShadow, etc.). */
    effects?: MosaicEffectProps;
  },
): MosaicLavfiSource {
  const overlay = opts?.overlay;
  // Every field of MosaicOverlayExpr must appear here. A field missing from
  // this list is dropped SILENTLY — the caller gets a tile with no overlay
  // and no error. `window` was missing until 2026-08-16, which meant the
  // typed `overlay.window {startSec,endSec}` lifetime that the perf rules
  // recommend was discarded by the very helper templates build tiles with,
  // leaving the source with the unbounded lifetime the rule exists to avoid.
  const hasOverlay =
    !!overlay &&
    (overlay.alpha !== undefined ||
      overlay.enable !== undefined ||
      overlay.window !== undefined ||
      overlay.xExpr !== undefined ||
      overlay.yExpr !== undefined ||
      overlay.startAtSec !== undefined ||
      overlay.blendMode !== undefined);

  return {
    type: "lavfi",
    color,
    ...(hasOverlay ? { overlay } : {}),
    ...(opts?.mask ? { mask: opts.mask } : {}),
    ...(opts?.placement ? { placement: opts.placement } : {}),
    ...(opts?.effects ? { effects: opts.effects } : {}),
  };
}
