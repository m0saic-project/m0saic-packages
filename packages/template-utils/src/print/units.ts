/** Physical-unit helpers shared by print-production templates. */

/** Exact number of millimetres in one international inch. */
export const MM_PER_INCH = 25.4;

/** Convert millimetres to the nearest device pixel at `dpi`. */
export function mmToPx(mm: number, dpi: number): number {
  if (!Number.isFinite(mm) || !Number.isFinite(dpi) || dpi <= 0) {
    throw new Error("mmToPx: mm must be finite and dpi must be positive");
  }
  return Math.round((mm / MM_PER_INCH) * dpi);
}

/** Convert device pixels back to millimetres at `dpi`. */
export function pxToMm(px: number, dpi: number): number {
  if (!Number.isFinite(px) || !Number.isFinite(dpi) || dpi <= 0) {
    throw new Error("pxToMm: px must be finite and dpi must be positive");
  }
  return (px / dpi) * MM_PER_INCH;
}

/**
 * Convert a physical span using cumulative endpoints. Adjacent spans that
 * share the same millimetre boundary therefore share the same pixel boundary,
 * eliminating independently-rounded seams at every DPI.
 */
export function mmSpanToPx(startMm: number, endMm: number, dpi: number): number {
  if (endMm < startMm) {
    throw new Error("mmSpanToPx: endMm must be greater than or equal to startMm");
  }
  return mmToPx(endMm, dpi) - mmToPx(startMm, dpi);
}
