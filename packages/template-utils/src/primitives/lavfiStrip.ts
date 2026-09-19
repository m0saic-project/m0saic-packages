import type { MosaicLavfiSource, MosaicOverlayExpr, MosaicColor } from "@m0saic/types";

export type LavfiStripOrientation = "horizontal" | "vertical";

export type LavfiStripOpts = {
  orientation: LavfiStripOrientation;

  /**
   * Thickness as a fraction of the tile's relevant axis.
   * Engine will quantize to >= 1px via `max(1, TW*frac)` / `max(1, TH*frac)`.
   */
  thicknessFrac: number;

  /** Color for the strip (solid fill). */
  color: MosaicColor;

  /** Optional constant opacity multiplier (0..1). */
  opacity?: number;

  /**
   * Overlay offsets applied when compositing the strip onto its parent.
   * These are tile-local expressions (W/H).
   *
   * Note: your engine comment says "offsets, not absolute positions".
   * This helper simply forwards the expressions.
   */
  overlay?: Pick<MosaicOverlayExpr, "xExpr" | "yExpr" | "enable" | "alpha" | "blendMode" | "startAtSec">;

  /**
   * If true, generate a strip sized to the *tile* ("tile" fitMode).
   * For strips we almost always want "content" so the strip has intrinsic thickness.
   */
  fitMode?: "tile" | "content";
};

/**
 * Build a thin solid lavfi strip (horizontal or vertical) sized in "px-ish"
 * terms via size expressions.
 *
 * This is the base primitive for:
 * - baselines
 * - gridlines
 * - separators
 * - highlight rules
 */
export function lavfiStrip(opts: LavfiStripOpts): MosaicLavfiSource {
  const {
    orientation,
    thicknessFrac,
    color,
    opacity,
    overlay,
    fitMode = "content",
  } = opts;

  const t = thicknessFrac;

  const size =
    orientation === "horizontal"
      ? {
          wExpr: "TW",
          hExpr: `max(1, TH*${t})`,
        }
      : {
          wExpr: `max(1, TW*${t})`,
          hExpr: "TH",
        };

  const src: MosaicLavfiSource = {
    type: "lavfi",
    color,
    fitMode,
    size,
    // keep it unscaled; overlay does the positioning
    placement: {
      fit: "contain",
      hAlign: "left",
      vAlign: "top",
    },
    visual: opacity == null ? undefined : { opacity },
    overlay: overlay && Object.keys(overlay).length ? { ...overlay } : undefined,
  };

  return src;
}