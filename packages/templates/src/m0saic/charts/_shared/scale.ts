/**
 * @m0saic/charts/_shared/scale — re-export of the canonical scale math.
 *
 * The implementation lives in `@m0saic/dsl-stdlib` (builders/scale.ts) so the
 * whole m0saic ecosystem computes axes the same way (no drift). The chart/graph
 * templates import it from here for locality; this file is intentionally a thin
 * pass-through — do not fork the math.
 */
export {
  niceNum,
  linearScale,
  project,
  categoryCenters,
  formatTick,
  type LinearScale,
  type LinearScaleOptions,
} from "@m0saic/dsl-stdlib";
