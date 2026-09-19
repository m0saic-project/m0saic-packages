/**
 * ============================================================================
 * @m0saic/charts/line-chart — native geometry (THIN RE-EXPORT)
 * ============================================================================
 *
 * The pure polyline kit that used to live here was hoisted verbatim to
 * `@m0saic/template-utils` (`src/geometry/polyline.ts`, 2026-08-18) so other
 * packs (mermaid edges) can reuse the math without a cross-pack template
 * import. This module re-exports the same names, so every in-pack import and
 * the chart's output stay byte-identical. New code should import from
 * `@m0saic/template-utils` directly.
 * ============================================================================
 */

export {
  ribbonQuadBBox,
  markerBBox,
  polylineStrokePath,
  polylineStrokeBBox,
  curvePolyline,
  buildDashMarks,
  dashMarkPath,
  dashMarkBBox,
  dashMarksBBox,
  areaBBox,
  local,
  rectPath,
  ribbonQuadPath,
  markerPath,
  areaPolygonPath,
  buildSweepSlivers,
  vertexFractions,
} from "@m0saic/template-utils";
export type { BBox, DashMark, Sliver, SweepOpts } from "@m0saic/template-utils";
