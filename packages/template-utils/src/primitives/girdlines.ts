import type { MosaicLavfiSource, MosaicColor } from "@m0saic/types";
import { lavfiStrip } from "./lavfiStrip";

export type GridlineDirection = "horizontal" | "vertical";

/**
 * Coordinate origin for line placement.
 *
 * For charts:
 * - horizontal gridlines usually want origin="bottom" (0 at baseline)
 * - vertical gridlines usually want origin="left"
 */
export type GridlineOrigin = "top" | "bottom" | "left" | "right";

export type GridlineSetOpts = {
  direction: GridlineDirection;

  /**
   * Total band count.
   * Interior lines = count - 1 when excludeEdges=true.
   */
  count: number;

  /** Default true: omit the outer edges (0 and 1). */
  excludeEdges?: boolean;

  /** Visual style */
  color: MosaicColor;
  opacity: number;
  thicknessFrac: number;

  /**
   * Placement convention.
   * - For horizontal: origin should be "bottom" or "top"
   * - For vertical: origin should be "left" or "right"
   */
  origin?: GridlineOrigin;

  /**
   * Optional extra offset expressions applied in addition to computed x/y.
   * Useful if you want to nudge gridlines by a tiny amount.
   */
  offsetXExpr?: string;
  offsetYExpr?: string;
};

/**
 * Build a list of lavfi strip sources representing evenly spaced gridlines.
 *
 * Returns ONLY the line sources (no base/transparent slot).
 * Caller decides layering model (overlay-chain DSL, paint slots, etc).
 */
export function buildGridlineSources(opts: GridlineSetOpts): MosaicLavfiSource[] {
  const {
    direction,
    count,
    excludeEdges = true,
    color,
    opacity,
    thicknessFrac,
    origin,
    offsetXExpr,
    offsetYExpr,
  } = opts;

  const n = Math.max(0, Math.floor(count));
  if (n <= 1) return [];

  const lines: MosaicLavfiSource[] = [];

  // i range:
  // - excludeEdges: 1..n-1
  // - includeEdges: 0..n
  const start = excludeEdges ? 1 : 0;
  const end = excludeEdges ? n - 1 : n;

  for (let i = start; i <= end; i++) {
    const frac = i / n; // 0..1

    if (direction === "horizontal") {
      const o: GridlineOrigin = origin ?? "bottom";
      const yExprBase =
        o === "bottom" ? `H*${1 - frac}` : `H*${frac}`;

      const yExpr =
        offsetYExpr != null ? `(${yExprBase})+(${offsetYExpr})` : yExprBase;

      const xExpr =
        offsetXExpr != null ? `(${offsetXExpr})` : "0";

      lines.push(
        lavfiStrip({
          orientation: "horizontal",
          thicknessFrac,
          color,
          opacity,
          overlay: { xExpr, yExpr },
        }),
      );
    } else {
      const o: GridlineOrigin = origin ?? "left";
      const xExprBase =
        o === "right" ? `W*${1 - frac}` : `W*${frac}`;

      const xExpr =
        offsetXExpr != null ? `(${xExprBase})+(${offsetXExpr})` : xExprBase;

      const yExpr =
        offsetYExpr != null ? `(${offsetYExpr})` : "0";

      lines.push(
        lavfiStrip({
          orientation: "vertical",
          thicknessFrac,
          color,
          opacity,
          overlay: { xExpr, yExpr },
        }),
      );
    }
  }

  return lines;
}