import type { MosaicBoxFrac } from "@m0saic/types";

export type GridCellInsetOptions = {
  /** Grid row count. */
  rows: number;
  /** Grid column count. */
  cols: number;
  /**
   * Pixel footprint the grid occupies. Used to convert `gapPx` into per-axis
   * cell-relative fractions so the gap is equal in PIXELS on both axes (a
   * single fraction would be uneven whenever cellW ≠ cellH).
   */
  gridW: number;
  gridH: number;
  /** Gap between adjacent cells, in pixels. */
  gapPx: number;
  /**
   * Add a half-gap inset on the grid's OUTER edges too. Default `false`
   * (full-bleed: gaps appear only BETWEEN cells, so the grid runs edge to
   * edge). Set `true` to keep every cell the exact same size — required when
   * cell size is semantically meaningful (e.g. bar widths in a bar chart) — at
   * the cost of a half-gap margin around the grid.
   *
   * Per-axis form `{ x, y }` lets you mix: e.g. a single row of bars wants
   * `{ x: true, y: false }` — equal bar widths (outer margin on the layout
   * axis) AND full bar height (no inset on the cross axis).
   *
   * Trade-off: in full-bleed mode the outer cells are inset on fewer sides, so
   * they're up to `gapPx/2` larger than interior cells (invisible at small
   * gaps for image tiles, but wrong for bars).
   */
  outerMargin?: boolean | { x?: boolean; y?: boolean };
  /**
   * Keep NO top gap on the first row — e.g. a grid that hugs a header above
   * it. Default `false`.
   */
  skipFirstRowTop?: boolean;
};

/**
 * Per-cell inset resolver for a **gutterless** `rows × cols` grid.
 *
 * The inter-cell gap is realized as a render-time inset on each cell rather
 * than DSL gutters: pixel-exact, nudges 1px at a time, and adds zero DSL
 * tokens (keeping the layout string compact). Each cell is inset by half the
 * gap on the edges it SHARES with a neighbor, so adjacent cells end up `gapPx`
 * apart, with axis-equal pixel gaps. Outer edges get no inset unless
 * `outerMargin` is set.
 *
 * Returns a resolver `(row, col) => inset | undefined`; `undefined` means the
 * cell needs no inset (so callers can omit `placement.inset` entirely).
 *
 * @deprecated Approximate, not pixel-exact — do not use in NEW templates
 * (existing callers keep working; see `HELPER_DEPRECATIONS` in
 * `../deprecation.ts` for the registry entry). Fractions are computed against
 * the IDEAL cell size (`gridW / cols`), but the engine floors
 * `frac × actualCellPx` against the QUANTIZED cell the split actually
 * produced — when the grid region doesn't divide evenly (e.g. a grid under a
 * content-driven header), the same fraction recovers 1px on one row and 0px
 * on the next, so the gap wobbles by ±1px per shared edge. Plain `n / cell`
 * fractions can also floor-lose on exactly-dividing cells (the
 * half-pixel-centering problem `placeInsetRects` documents). Reach for
 * `latticeCellInset` instead (same compact gutterless `grid()` m0, exact
 * gutters via retargeted half-pixel-centered insets over the RAW parsed
 * cells), or `placeInsetPieces` when the helper should own the whole layout —
 * see `media/screencap_grid/v2` (v1 is the archived reference for this exact
 * pitfall).
 *
 * @example
 * const inset = gridCellInset({ rows, cols, gridW, gridH, gapPx: 2 });
 * for (let i = 0; i < rows * cols; i++) {
 *   const box = inset(Math.floor(i / cols), i % cols);
 *   sources.push({ type: "media", assetId,
 *     placement: { fit: "cover", ...(box ? { inset: box } : {}) } });
 * }
 */
export function gridCellInset(
  opts: GridCellInsetOptions,
): (row: number, col: number) => MosaicBoxFrac | undefined {
  const {
    rows,
    cols,
    gridW,
    gridH,
    gapPx,
    outerMargin = false,
    skipFirstRowTop = false,
  } = opts;

  const cellWpx = cols > 0 ? gridW / cols : 0;
  const cellHpx = rows > 0 ? gridH / rows : 0;
  // Half the gap, expressed as a fraction of the cell on each axis.
  const halfX = cellWpx > 0 ? gapPx / 2 / cellWpx : 0;
  const halfY = cellHpx > 0 ? gapPx / 2 / cellHpx : 0;
  const noGap = gapPx <= 0 || cellWpx <= 0 || cellHpx <= 0;
  const omX = typeof outerMargin === "object" ? !!outerMargin.x : !!outerMargin;
  const omY = typeof outerMargin === "object" ? !!outerMargin.y : !!outerMargin;

  return (row, col) => {
    if (noGap) return undefined;
    const onTopEdge = row <= 0;
    const onBottomEdge = row >= rows - 1;
    const onLeftEdge = col <= 0;
    const onRightEdge = col >= cols - 1;

    let top = onTopEdge ? (omY ? halfY : 0) : halfY;
    const bottom = onBottomEdge ? (omY ? halfY : 0) : halfY;
    const left = onLeftEdge ? (omX ? halfX : 0) : halfX;
    const right = onRightEdge ? (omX ? halfX : 0) : halfX;
    if (skipFirstRowTop && onTopEdge) top = 0;

    if (top === 0 && right === 0 && bottom === 0 && left === 0) return undefined;
    return { top, right, bottom, left };
  };
}
