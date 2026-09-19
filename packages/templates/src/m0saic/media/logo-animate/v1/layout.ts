/**
 * Aspect-correct placement for `@m0saic/media/logo-animate/v1`
 * (`fit: "contain"`).
 *
 * The converted logo becomes a size-declared child mosaic; the parent
 * carves ONE centered rect at the logo's aspect via `placeRect`
 * (byte-exact at any canvas, null-tile margins — never `insetNode`,
 * which spreads quantization into the rect) and references the child
 * there. The remaining canvas is null tiles over the document
 * background.
 */

import { placeRect } from "@m0saic/dsl-stdlib";

export type ContainRect = { w: number; h: number };

/**
 * Largest integer rect with the logo's aspect that fits the output
 * canvas (centered by the caller via `placeRect`).
 */
export function computeContainRect(
  outW: number,
  outH: number,
  logoW: number,
  logoH: number,
): ContainRect {
  const safeLogoW = logoW > 0 ? logoW : 1;
  const safeLogoH = logoH > 0 ? logoH : 1;
  const scale = Math.min(outW / safeLogoW, outH / safeLogoH);
  return {
    w: Math.min(outW, Math.max(1, Math.round(safeLogoW * scale))),
    h: Math.min(outH, Math.max(1, Math.round(safeLogoH * scale))),
  };
}

export type ContainLayout = {
  /** Parent m0: exactly one rendered frame (the fit rect) + null margins. */
  m0: string;
  /** The carved fit rect (the child's declared size). */
  rect: ContainRect;
  /** True when the fit rect IS the canvas — nesting would be a no-op. */
  exactFit: boolean;
};

export function buildContainLayout(
  outW: number,
  outH: number,
  logoW: number,
  logoH: number,
): ContainLayout {
  const rect = computeContainRect(outW, outH, logoW, logoH);
  const placed = placeRect({
    rootW: outW,
    rootH: outH,
    rectW: rect.w,
    rectH: rect.h,
  });
  return {
    m0: String(placed.m0),
    rect,
    exactFit: rect.w === outW && rect.h === outH,
  };
}
