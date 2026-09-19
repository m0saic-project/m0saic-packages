/**
 * The m0saic M as RECTANGLES — the 26 axis-aligned rects of the canonical
 * 272×272 M (apps/mosaic/web/src/assets/M.svg), exactly as the app's
 * `MosaicMRectsSvg` component draws them. The 7 diagonal V-leg polygons are
 * not rects; they arrive with the full silhouette (`HEADER_M_GLYPH`), which
 * is how the M "resolves" after its rects have assembled.
 *
 * Mirrored as data (~1 KB): a public template package cannot import the app.
 * Coordinates are [x, y, w, h] in the 272 viewBox.
 */
export const M_VIEWBOX = 272;

export const M_RECTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.06, 0.01, 19.67, 48.11],
  [0, 55.96, 34.93, 48.11],
  [34.93, 111.93, 27.31, 48.11],
  [0, 111.93, 27.32, 48.11],
  [0, 167.91, 34.93, 48.11],
  [27.37, 223.89, 34.76, 48.11],
  [0.01, 223.89, 19.71, 48.11],
  [103.5, 111.93, 28.3, 48.11],
  [182.185, 55.96, 19.53, 48.13],
  [42.57, 55.96, 19.6, 19.72],
  [42.57, 83.53, 19.6, 20.53],
  [27.33, 0.01, 34.85, 48.11],
  [42.51, 167.91, 19.56, 19.72],
  [42.51, 195.49, 19.56, 20.53],
  [252.28, 223.88, 19.67, 48.11],
  [237.07, 167.93, 34.93, 48.11],
  [209.76, 111.95, 27.31, 48.11],
  [244.68, 111.95, 27.32, 48.11],
  [237.07, 55.97, 34.93, 48.11],
  [209.87, 0, 34.76, 48.11],
  [252.28, 0, 19.71, 48.11],
  [209.83, 196.32, 19.6, 19.72],
  [209.83, 167.93, 19.6, 20.53],
  [209.83, 223.88, 34.85, 48.11],
  [209.93, 84.36, 19.56, 19.72],
  [209.93, 55.97, 19.56, 20.53],
];

/** Bounding-box centres of the 7 V-leg polygons (for ordering only). */
export const M_POLY_CENTRES: ReadonlyArray<readonly [number, number]> = [
  [85.8, 25.75],
  [185.82, 25.73],
  [100.7, 80],
  [157, 80.06],
  [82.78, 130.1],
  [170, 136],
  [135.09, 185.26],
];
