/**
 * Reusable factory for the canonical "QR eye" visual treatment.
 *
 * QR finder patterns ("eyes") have a classic 3-layer concentric structure
 * per ISO 18004: a 7×7 outer dark square enclosing a 5×5 light ring
 * enclosing a 3×3 dark center dot. This helper produces a tiny
 * `MosaicDocument` that paints exactly that shape inside whatever slot it
 * gets spliced into (typically a 7×7 finder frame in a parent QR template
 * via `replaceNodeByStableId`).
 *
 * Two style knobs control the visual:
 *   - `outerBorderRadius`: rounding of the outer dark square (and the inner
 *     light ring — they share the radius for visual continuity).
 *   - `innerDotBorderRadius`: rounding of the center dot.
 *
 * Defaults are square-corner (radius 0) for visual parity with the
 * traditional sharp-corner finder. Pass non-zero values for the
 * Instagram-style rounded eye (~`0.3` outer + `0.5` center is a good start).
 */

import { placeRect, toM0String } from "@m0saic/dsl-stdlib";
import type { MosaicColor, MosaicDocument, MosaicOverlayExpr } from "@m0saic/types";
import { makeColorTile } from "../sources/makeColorTile";

export type MakeQrEyeChildDocOptions = {
  /** Dark colour for the outer ring and center dot. */
  darkColor: MosaicColor;
  /** Light/background colour for the 5×5 ring sitting between outer and center. */
  backgroundColor: MosaicColor;
  /** Outer dark square corner radius (0..1). Default 0 (sharp). */
  outerBorderRadius?: number;
  /** Inner light ring corner radius (0..1). Default matches `outerBorderRadius` for visual continuity. */
  innerLightBorderRadius?: number;
  /** Center dot corner radius (0..1). Default 0 (sharp). 1.0 → circle (since it's square). */
  innerDotBorderRadius?: number;
  /** Optional overlay expression applied to the outer dark layer (e.g. per-eye animation alpha). */
  outerOverlay?: MosaicOverlayExpr;
  /** Optional overlay expression applied to the center dot. */
  centerOverlay?: MosaicOverlayExpr;
};

export function makeQrEyeChildDoc(opts: MakeQrEyeChildDocOptions): MosaicDocument {
  const outerBorderRadius = opts.outerBorderRadius ?? 0;
  const innerLightBorderRadius = opts.innerLightBorderRadius ?? outerBorderRadius;
  const innerDotBorderRadius = opts.innerDotBorderRadius ?? 0;

  // 3-layer composition in cell units (canvas = 7×7 within the spliced slot):
  //   L0: full-canvas F (outer dark, 7×7)
  //   L1: centered 5×5 F (inner light, inset 1 on each side)
  //   L2: centered 3×3 F (center dot, inset 2 on each side)
  const outerExpr = "F"; // bare F = full-canvas single frame
  const innerLightExpr = String(
    placeRect({ rootW: 7, rootH: 7, rectW: 5, rectH: 5 }).m0,
  );
  const centerExpr = String(
    placeRect({ rootW: 7, rootH: 7, rectW: 3, rectH: 3 }).m0,
  );

  // Chain: outer { innerLight { center } }
  const composedRaw = `${outerExpr}{${innerLightExpr}{${centerExpr}}}`;
  const m0 = toM0String(composedRaw, "makeQrEyeChildDoc");

  // Sources in document order: outer dark → inner light → center dot.
  const sources = [
    makeColorTile(opts.darkColor, {
      effects: { rounding: { borderRadius: outerBorderRadius, cornerStyle: "rounded" } },
      ...(opts.outerOverlay ? { overlay: opts.outerOverlay } : {}),
    }),
    makeColorTile(opts.backgroundColor, {
      effects: { rounding: { borderRadius: innerLightBorderRadius, cornerStyle: "rounded" } },
    }),
    makeColorTile(opts.darkColor, {
      effects: { rounding: { borderRadius: innerDotBorderRadius, cornerStyle: "rounded" } },
      ...(opts.centerOverlay ? { overlay: opts.centerOverlay } : {}),
    }),
  ];

  return {
    kind: "mosaic_document",
    version: 1,
    m0,
    assets: {},
    sources,
    // Canvas background matches the inner-light colour so the rounded
    // corners of the outer dark layer reveal the right colour, not
    // ffmpeg's default black base.
    backgroundColor: opts.backgroundColor,
  };
}
