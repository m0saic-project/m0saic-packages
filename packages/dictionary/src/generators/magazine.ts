import type { M0String } from "@m0saic/dsl";
import { weightedSplit, strip } from "@m0saic/dsl-stdlib";

export type MagazineOptions = {
  /** Horizontal weight multiplier for the hero region. Default: 2. */
  heroWeight?: number;
  /** Horizontal weight multiplier for the sidebar column. Default: 1. */
  sidebarWeight?: number;
  /** Number of tiles stacked vertically in the sidebar. Default: 2. */
  sidebarCount?: number;
  /** Vertical weight multiplier for the top row (hero + sidebar). Default: 2. */
  topWeight?: number;
  /** Vertical weight multiplier for the bottom strip. Default: 1. */
  bottomWeight?: number;
  /** Number of equal columns in the bottom strip. Default: 3. */
  bottomCount?: number;
  /** Gutter ratio (0..1). Applied between all major sections. */
  gutter?: number;
  /**
   * Explicit base cell weight. Default: 50.
   * All region weights are expressed as multiples of this value.
   */
  cellWeightBase?: number;
};

export type MagazineResult = {
  m0: M0String;
  /** Total number of media tiles (hero + sidebar tiles + bottom tiles). */
  tileCount: number;
  /** X-axis total weight (based on top row). */
  totalX: number;
  /** Y-axis total weight. */
  totalY: number;
  /** Base cell weight. */
  cellW: number;
  /** Gutter weight in DSL units. */
  gutterW: number;
};

const DEFAULT_CELL_WEIGHT = 50;

/**
 * Build a magazine / editorial layout composed from stdlib primitives.
 *
 * The layout has two vertical zones:
 *
 * ```
 * ┌──────────────────┬────────┐
 * │                  │  side  │
 * │      HERO        ├────────┤
 * │                  │  side  │
 * ├────┬────┬────────┴────────┤
 * │ bt │ bt │       bt        │
 * └────┴────┴─────────────────┘
 * ```
 *
 * - **Top row**: a dominant hero tile beside a sidebar column of
 *   `sidebarCount` stacked tiles.
 * - **Bottom strip**: `bottomCount` equal columns.
 *
 * All proportions are controlled by weight multipliers applied to the
 * base `cellW`. Gutters are inserted between every section boundary
 * when `gutter > 0`.
 *
 * Internally uses {@link weightedTokens} and {@link container} — the
 * same primitives that power {@link grid} and the other stdlib builders.
 */
export function magazine(opts: MagazineOptions): MagazineResult {
  const {
    heroWeight = 2,
    sidebarWeight = 1,
    sidebarCount = 2,
    topWeight = 2,
    bottomWeight = 1,
    bottomCount = 3,
    gutter,
  } = opts;

  if (!Number.isInteger(sidebarCount) || sidebarCount < 1) {
    throw new Error(
      `magazine: sidebarCount must be a positive integer, got ${sidebarCount}`,
    );
  }
  if (!Number.isInteger(bottomCount) || bottomCount < 1) {
    throw new Error(
      `magazine: bottomCount must be a positive integer, got ${bottomCount}`,
    );
  }

  const cellW = opts.cellWeightBase ?? DEFAULT_CELL_WEIGHT;
  const hasGutter = gutter != null && gutter > 0;
  const gutterW = hasGutter ? Math.max(1, Math.round(cellW * gutter!)) : 0;

  // Scale weight multipliers to DSL weight units
  const heroW = Math.max(1, Math.round(heroWeight * cellW));
  const sidebarW = Math.max(1, Math.round(sidebarWeight * cellW));
  const topH = Math.max(1, Math.round(topWeight * cellW));
  const bottomH = Math.max(1, Math.round(bottomWeight * cellW));

  // --- Sidebar column: sidebarCount tiles stacked vertically ---
  const sidebarExpr = strip(sidebarCount, "row", {
    cellWeight: cellW,
    gutterWeight: gutterW,
  });

  // --- Top row: hero + sidebar ---
  const topWeights: number[] = [heroW];
  const topClaimants: string[] = ["1"];
  if (hasGutter) { topWeights.push(gutterW); topClaimants.push("-"); }
  topWeights.push(sidebarW); topClaimants.push(sidebarExpr as string);
  const topExpr = weightedSplit(topWeights, "col", { claimants: topClaimants });

  // --- Bottom strip: bottomCount equal columns ---
  const bottomExpr = strip(bottomCount, "col", {
    cellWeight: cellW,
    gutterWeight: gutterW,
  });

  // --- Outer vertical split: top + bottom ---
  const outerWeights: number[] = [topH];
  const outerClaimants: string[] = [topExpr as string];
  if (hasGutter) { outerWeights.push(gutterW); outerClaimants.push("-"); }
  outerWeights.push(bottomH); outerClaimants.push(bottomExpr as string);
  const m0 = weightedSplit(outerWeights, "row", { claimants: outerClaimants });

  const tileCount = 1 + sidebarCount + bottomCount;
  const totalX = heroW + sidebarW + (hasGutter ? gutterW : 0);
  const totalY = topH + bottomH + (hasGutter ? gutterW : 0);

  return { m0, tileCount, totalX, totalY, cellW, gutterW };
}
