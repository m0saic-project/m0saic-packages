/**
 * assertGeometry — throwing geometry check, the `assertTiming` sibling.
 *
 * For unit tests / CI. Use `withGeometryContract` (degrades to an error mosaic)
 * in shipped template code — a throw inside a nested cell kills the whole
 * composition render.
 */

import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { checkDocGeometry } from "./checkDocGeometry";
import type { GeometryExpectation } from "./types";

export type AssertGeometryOptions = {
  expectations: GeometryExpectation[];
  /** Default per-edge tolerance (px). See `checkDocGeometry`. */
  tolerancePx?: number;
};

export function assertGeometry(
  doc: MosaicDocument,
  ctx: MosaicEngineContext,
  templateId: string,
  opts: AssertGeometryOptions,
): void {
  const W = Math.max(1, Math.round(ctx.target.width));
  const H = Math.max(1, Math.round(ctx.target.height));
  const result = checkDocGeometry(doc, {
    canvasW: W,
    canvasH: H,
    expectations: opts.expectations,
    tolerancePx: opts.tolerancePx,
  });
  if (!result.ok) {
    const lines = result.violations.map((v) => `  • ${v.detail}`).join("\n");
    throw new Error(
      `${templateId}: geometry contract violated at ${W}×${H} ` +
        `(${result.violations.length} violation${result.violations.length === 1 ? "" : "s"}):\n${lines}`,
    );
  }
}
