import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/primitives/grid/v1
 * ============================================================================
 *
 * A reusable gridline overlay primitive.
 *
 * Renders thin lavfi strips as an overlay paint stack:
 *   base (transparent) -> line1 -> line2 -> ... -> lineN
 *
 * - Does NOT own background fills.
 * - Does NOT render a baseline (callers can layer their own baseline above/below).
 * - Does NOT animate.
 * - Designed to be composed inside higher-level templates (charts, dashboards, frames).
 *
 * Counting semantics:
 * - `count` is the number of equal intervals across the axis.
 * - When `excludeEdges=true`, we render interior lines only:
 *     i = 1..count-1  => (count-1) lines
 * - When `excludeEdges=false`, we render edges too:
 *     i = 0..count    => (count+1) lines
 *
 * Axis / origin semantics:
 * - direction="horizontal" positions lines by Y fraction.
 * - direction="vertical"   positions lines by X fraction.
 * - origin controls how the fraction is interpreted:
 *     - for horizontal: "top" or "bottom"
 *     - for vertical:   "left" or "right"
 *
 * Implementation detail:
 * - Each line is generated as an intrinsic strip (fitMode="content") sized via TW/TH.
 * - Positioning uses tile-local overlay offsets (W/H) for deterministic placement.
 *
 * Why placeRects, not a "portable" weightedSplit (measured):
 * - For THIN LINES a placeRects grid is pixel-EXACT (~0px spread) at every
 *   size/count, while the interleaved gap/line weightedSplit ranges from fine
 *   (~0.5px) to CATASTROPHIC (count=6 @ 400px → ~67px; count=8 @ 333px → ~42px) —
 *   the basis sits ≈ the axis length and any mismatch spreads wildly. So there is
 *   no imperceptible-weightedSplit to fall back to here; placeRects strictly wins.
 *   (See `dsl-stdlib` `quantizationSpread` + its test for the matrix.) The general
 *   "weightedSplit when imperceptible, else placeRects" rule still pays off for
 *   REGION layouts with small natural bases — just not for thin-line grids.
 *
 * RESOLUTION-AWARE — pass a `slot` when exact alignment matters:
 * - The single-axis path computes ABSOLUTE pixel line positions from `ctx.target`
 *   (see `buildAxisSplitGrid`), rounding each boundary independently so gaps are
 *   exact at the rendered size. The emitted m0 is still a weighted-band split, so
 *   for EVEN divisions the lines stay uniform even if the grid is later scaled into
 *   a different-size cell (proportional bands scale uniformly — verified: bar-graph
 *   nests this with bare `ctx` and its gaps are uniform to ≤0.5px at odd canvases).
 * - Pass `renderNestedTemplate(..., ctx, { slot: { width, height } })` with the
 *   grid's REAL rendered px whenever the grid must align with SIBLING geometry at
 *   exact pixels, or line THICKNESS must be exact for the cell — compute at the
 *   slot, don't let the grid bake the parent-canvas dims and scale in.
 * - Canonical example: line-chart `chrome.ts` `renderGrid` passes
 *   `{ slot: { width: plotW, height: plotH } }` so its gridlines line up with the
 *   data layer's plot rect.
 * ============================================================================
 */

import type {
    MosaicColor,
    MosaicDocument,
    MosaicEngineContext,
    MosaicLavfiSource,
    MosaicSource,
    MosaicTemplate,
  } from "@m0saic/types";
  import {
    definePropsSchema,
    registerTemplate,
    buildOverlayStack,
    buildGridlineSources,
    transparentSlot,
  } from "@m0saic/template-utils";
  import { placeRects } from "@m0saic/dsl-stdlib";
  
  export type PrimitiveGridDirection = "horizontal" | "vertical" | "both";
  export type PrimitiveGridOrigin = "top" | "bottom" | "left" | "right";
  
  export type PrimitiveGridProps = {
    show?: boolean;
  
    /** Number of equal intervals across the chosen axis. */
    count?: number;
  
    /** Which axes to draw. */
    direction?: PrimitiveGridDirection;
  
    /**
     * Fraction origin for placement.
     * - horizontal: "bottom" (chart-style) or "top" (screen-style)
     * - vertical:   "left" (screen-style) or "right"
     */
    origin?: PrimitiveGridOrigin;
  
    /** Exclude the outer boundary lines. Default true. */
    excludeEdges?: boolean;
  
    /** Line color (FFmpeg-compatible). */
    color?: MosaicColor;
  
    /** Constant opacity multiplier (0..1). */
    opacity?: number;
  
    /** Thickness as a fraction of the short side. Engine clamps to >= 1px. */
    thicknessFrac?: number;
  };
  
  const propsSchema = definePropsSchema<PrimitiveGridProps>({
    show: {
      type: "boolean",
      required: false,
      description: "Whether the grid renders. Default true.",
    },
    count: {
      type: "number",
      required: false,
      description: "Number of equal intervals across the axis. Default 5.",
    },
    direction: {
      type: "string" as any,
      required: false,
      description: 'Which axes to draw: "horizontal" | "vertical" | "both". Default "horizontal".',
    },
    origin: {
      type: "string" as any,
      required: false,
      description: 'Origin for fractions: "top" | "bottom" | "left" | "right". Default depends on direction.',
    },
    excludeEdges: {
      type: "boolean",
      required: false,
      description: "If true, do not render the outer boundary lines. Default true.",
    },
    color: {
      type: "string",
      required: false,
      description: "Line color (FFmpeg-compatible). Default #ffffff.",
      meta: { constraints: { isColor: true }, control: { colorPicker: true } },
    },
    opacity: {
      type: "number",
      required: false,
      description: "Line opacity multiplier (0..1). Default 0.12.",
    },
    thicknessFrac: {
      type: "number",
      required: false,
      description: "Line thickness fraction. Default 0.002.",
    },
  });
  
  export const PRIMITIVE_GRID_TEMPLATE_ID = asTemplateId("@m0saic/primitives/grid/v1");
  
  const DEFAULT_COLOR = "#ffffff";
  const DEFAULT_OPACITY = 0.12;
  const DEFAULT_THICKNESS_FRAC = 0.002;
  const DEFAULT_COUNT = 5;
  
  export const PrimitiveGrid: MosaicTemplate<PrimitiveGridProps> = {
    id: PRIMITIVE_GRID_TEMPLATE_ID,
    label: "Primitive — Grid",
    version: 1,
    internal: false,
    primitive: true, // reusable layout building block composed into other templates
    description:
      "Reusable gridline overlay primitive (horizontal/vertical/both) for composition into templates.",
    capabilities: { tier: "core" },
    deprecated: {
      reason:
        "The 'absolute → fine ratio' anti-pattern: the single-axis path computes each line's ABSOLUTE pixel position from ctx.target, then re-encodes them as a placeRects split whose basis ≈ the plot dimension in px. Renders exactly STANDALONE but the per-pixel basis does NOT nest — the engine re-divides it below 1px at certain canvases (e.g. 1024², 1000²) and the grid is SILENTLY DROPPED. Kept registered as a 'what not to do' reference. Use v2 — thin fixed-px strips at proportional overlay offsets (ratio positioning) that compose at any canvas.",
      replacement: asTemplateId("@m0saic/primitives/grid/v2"),
      since: "2026-07-07",
    },
    tags: ["primitive", "grid"],
    propsSchema,
  
    defaultProps: {
      show: true,
      count: DEFAULT_COUNT,
      direction: "horizontal",
      origin: "bottom",
      excludeEdges: true,
      color: DEFAULT_COLOR,
      opacity: DEFAULT_OPACITY,
      thicknessFrac: DEFAULT_THICKNESS_FRAC,
    },
  
    async render(
      props: PrimitiveGridProps,
      ctx: MosaicEngineContext,
    ): Promise<MosaicDocument> {
      const show = props.show !== false;
      const count = Math.max(0, Math.floor(props.count ?? DEFAULT_COUNT));

      if (!show || count <= 1) {
        return {
          kind: "mosaic_document",
          version: 1,
      assets: {} as any,
          m0: buildOverlayStack(1),
          sources: [transparentSlot()], durationMs: ctx.target.durationMs ,
        };
      }

      const direction: PrimitiveGridDirection = props.direction ?? "horizontal";

      const color = props.color ?? DEFAULT_COLOR;
      const opacity = props.opacity ?? DEFAULT_OPACITY;
      const thicknessFrac = props.thicknessFrac ?? DEFAULT_THICKNESS_FRAC;
      const excludeEdges = props.excludeEdges !== false;

      // ---- Single-axis fast path (row/col split) ------------------------
      //
      // The legacy implementation emits one lavfi-strip-overlay per line and
      // stacks them with buildOverlayStack(), which expands to a nested
      // overlay chain (F{F{F{...}}}) — every line costs one ffmpeg overlay
      // op. For N=5 grid lines that is N+1 nested overlays *just for the
      // grid*, multiplied across every chunk in the render plan.
      //
      // For "horizontal" / "vertical" we instead express the grid as a
      // single row/col split: thin line cells (weight 1) separated by
      // wide gap cells (weight derived from thicknessFrac), with spacer
      // tokens for the gaps. One composition op, N sources.
      //
      //   m0 vertical-bars horizontal-grid example (count=5, excludeEdges):
      //     row-split, weights [99,1,99,1,99,1,99,1,99]
      //     claimants            [ - , 1 , - , 1 , - , 1 , - , 1 , - ]
      //
      // "both" still walks the legacy overlay path — it's not on the chart
      // hot path today and the layout would be a nested split (out of scope
      // for this optimisation).
      if (direction === "horizontal" || direction === "vertical") {
        return buildAxisSplitGrid({
          direction,
          count,
          excludeEdges,
          color,
          opacity,
          thicknessFrac,
          ctx,
        });
      }

      // ---- Legacy overlay-stack path (only direction="both") ------------
      // direction is narrowed to "both" here; the single-axis fast path
      // already returned above. We render both axes by composing two
      // gridline sets with the legacy overlay-stack model.
      const origin = props.origin ?? "bottom";

      const lines: MosaicSource[] = [];

      const horizOrigin: "top" | "bottom" =
        origin === "top" ? "top" : "bottom";
      lines.push(
        ...buildGridlineSources({
          direction: "horizontal",
          count,
          excludeEdges,
          origin: horizOrigin,
          color,
          opacity,
          thicknessFrac,
        }),
      );

      const vertOrigin: "left" | "right" =
        origin === "right" ? "right" : "left";
      lines.push(
        ...buildGridlineSources({
          direction: "vertical",
          count,
          excludeEdges,
          origin: vertOrigin,
          color,
          opacity,
          thicknessFrac,
        }),
      );

      const sources: MosaicSource[] = [transparentSlot(), ...lines];

      return {
        kind: "mosaic_document",
        version: 1,
      sources,
      assets: {} as any,
        m0: buildOverlayStack(sources.length),
        durationMs: ctx.target.durationMs ,
      };
    },
  };

// ---------------------------------------------------------------------------
// Single-axis split helper
// ---------------------------------------------------------------------------

type AxisSplitOpts = {
  direction: "horizontal" | "vertical";
  count: number;
  excludeEdges: boolean;
  color: MosaicColor;
  opacity: number;
  thicknessFrac: number;
  ctx: MosaicEngineContext;
};

function buildAxisSplitGrid(opts: AxisSplitOpts): MosaicDocument {
  const { direction, count, excludeEdges, color, opacity, thicknessFrac, ctx } = opts;

  // QUANTIZATION-FREE gridlines: instead of one interleaved [gap,line,gap,…]
  // split (a small weight basis that doesn't divide the axis → the remainder
  // spreads and lines drift), compute each line's ABSOLUTE pixel position by
  // even division, then `placeRects` a thin rect at each. The placeRects band
  // weights are pixels that sum to the axis length, so the render is exact —
  // lines are uniformly spaced at any resolution / cell count.
  // (Resolution-dependent by design: uses the slot's `ctx.target` dims.)
  const W = Math.max(1, Math.round(ctx.target.width));
  const H = Math.max(1, Math.round(ctx.target.height));
  const horizontal = direction === "horizontal";
  const axisLen = horizontal ? H : W; // lines are spaced along this axis
  const span = horizontal ? W : H; //    lines span the cross axis fully
  const th = Math.max(1, Math.round(thicknessFrac * Math.min(W, H)));

  // Line indices at even-division boundaries. excludeEdges → interior only
  // (1..count-1); else include the 0 and count edges.
  const lo = excludeEdges ? 1 : 0;
  const hi = excludeEdges ? count - 1 : count;
  const rects: { x: number; y: number; w: number; h: number; claimant: string }[] = [];
  for (let i = lo; i <= hi; i++) {
    const pos = Math.max(0, Math.min(axisLen - th, Math.round((i / count) * axisLen) - Math.floor(th / 2)));
    rects.push(horizontal ? { x: 0, y: pos, w: span, h: th, claimant: "1" } : { x: pos, y: 0, w: th, h: span, claimant: "1" });
  }

  if (rects.length === 0) {
    return {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: buildOverlayStack(1),
      sources: [transparentSlot()],
      durationMs: ctx.target.durationMs,
    };
  }

  const placed = placeRects({ rootW: W, rootH: H, rects });
  // One lavfi line per placed rect — all identical, so emission order is moot.
  const sources: MosaicLavfiSource[] = rects.map(() => ({
    type: "lavfi",
    color,
    fitMode: "tile",
    visual: opacity == null ? undefined : { opacity },
  }));

  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as any,
    m0: String(placed.m0) as any,
    sources,
    durationMs: ctx.target.durationMs,
  } as MosaicDocument;
}
  
  registerTemplate(PrimitiveGrid);