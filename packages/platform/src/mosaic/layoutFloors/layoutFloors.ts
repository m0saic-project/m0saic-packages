/**
 * Layout floors — the ONE computation behind "is this canvas below the
 * layout's safe minimum?", shared by the planner (a `LAYOUT_BELOW_SAFE_MIN`
 * diagnostic every headless render sees), the template conventions gate
 * (`safeMinimumCanvas` / `canvasEnvelope`), and the editor's floor chip.
 *
 * Two INDEPENDENT per-axis floors, both read off the FLATTENED m0
 * (see the internal feasibility-precision-quantization notes):
 *
 *  - feasibility — "won't error": the smallest canvas with no 0-size frame.
 *    Below it, the parser culls sub-pixel cells and content is MISSING.
 *  - precision   — "looks right": the smallest canvas where every split slot
 *    (passthrough / donation cells included) is ≥ 1px. Below it nothing is
 *    dropped, but quantization spread squashes cells.
 *
 * `safeMin` is their per-axis max — the number the editor shows. A prime
 * slot total (`1303[…]`, no GCD relief) pins it far above any canvas a
 * template author intended; the founder hit exactly that dragging a weight
 * slider on a 720p template (2026-09-06).
 */

import { computeFeasibility, getComplexityMetricsFast, validateM0String } from "@m0saic/dsl";
import type { MosaicDiagnostic } from "@m0saic/types";
import { asDiagnosticCode } from "@m0saic/types";

export type LayoutCanvas = { width: number; height: number };

export type LayoutFloors = {
  /** "Won't error" floor: `{ minWidthPx, minHeightPx }` of the m0. */
  feasibility: LayoutCanvas;
  /** "Looks right" floor: `{ maxSplitX, maxSplitY }` of the m0. */
  precision: LayoutCanvas;
  /** Per-axis max of the two — the smallest canvas that renders AND looks right. */
  safeMin: LayoutCanvas;
};

export type LayoutFloorCheck = {
  floors: LayoutFloors;
  canvas: LayoutCanvas;
  /** True when the canvas is below `safeMin` on at least one axis. */
  below: boolean;
  /** Which axes are below (`[]` when `below` is false). */
  axes: Array<"width" | "height">;
  /** True when the canvas is below the FEASIBILITY floor — cells are culled, not just squashed. */
  culls: boolean;
};

export const LAYOUT_BELOW_SAFE_MIN = "LAYOUT_BELOW_SAFE_MIN";

/** The floors of a (valid) m0, or null when the string is not valid m0. */
export function computeLayoutFloors(m0: string): LayoutFloors | null {
  const v = validateM0String(m0);
  if (!v.ok) return null;
  try {
    const f = computeFeasibility(m0);
    const p = getComplexityMetricsFast(m0).precision;
    const feasibility = { width: Math.max(1, f.minWidthPx), height: Math.max(1, f.minHeightPx) };
    const precision = { width: Math.max(1, p.maxSplitX), height: Math.max(1, p.maxSplitY) };
    return {
      feasibility,
      precision,
      safeMin: {
        width: Math.max(feasibility.width, precision.width),
        height: Math.max(feasibility.height, precision.height),
      },
    };
  } catch {
    return null;
  }
}

/** Compare a canvas against the m0's floors. Null when the m0 is invalid. */
export function checkLayoutFloors(m0: string, canvas: LayoutCanvas): LayoutFloorCheck | null {
  const floors = computeLayoutFloors(m0);
  if (!floors) return null;
  const axes: Array<"width" | "height"> = [];
  if (canvas.width < floors.safeMin.width) axes.push("width");
  if (canvas.height < floors.safeMin.height) axes.push("height");
  const culls = canvas.width < floors.feasibility.width || canvas.height < floors.feasibility.height;
  return { floors, canvas, below: axes.length > 0, axes, culls };
}

const dims = (c: LayoutCanvas): string => `${Math.round(c.width)}×${Math.round(c.height)}`;

/** The human line — the same wording the editor's floor chip uses. */
export function describeLayoutFloorCheck(check: LayoutFloorCheck): string {
  const { floors, canvas } = check;
  const consequence = check.culls
    ? "Some cells are too small to show at this size and are culled — content is missing."
    : "It still renders, but at this size cells can be squashed or dropped.";
  return (
    `Canvas ${dims(canvas)} is below the layout's safe minimum of ${dims(floors.safeMin)} ` +
    `(feasibility ${dims(floors.feasibility)}, precision ${dims(floors.precision)}). ${consequence} ` +
    `Render at ${dims(floors.safeMin)} or larger, or lower the layout's split density ` +
    `(bound weightedSplit totals with a precision budget).`
  );
}

/**
 * The planner's diagnostic for a canvas below the safe minimum, or null when
 * the canvas clears it (or the m0 is invalid — that is someone else's error).
 * Severity is always `"warning"`: the render proceeds (founder ruling: never
 * block a production render on a layout-quality signal).
 */
export function layoutFloorDiagnostic(m0: string, canvas: LayoutCanvas): MosaicDiagnostic | null {
  const check = checkLayoutFloors(m0, canvas);
  if (!check || !check.below) return null;
  return {
    code: asDiagnosticCode(LAYOUT_BELOW_SAFE_MIN),
    severity: "warning",
    message: describeLayoutFloorCheck(check),
  };
}
