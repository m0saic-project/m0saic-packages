/**
 * ============================================================================
 * @m0saic/charts/bar-graph/internal/plot-area/v1
 * ============================================================================
 *
 * PlotArea composes:
 *   - Grid (back)    → GLOBAL primitive: @m0saic/primitives/grid/v2
 *   - Bars (middle)  → provided by parent via `barsStackRef`
 *   - Baseline (top) → 1px-ish lavfi strip
 *
 * Layering (paint order):
 *   grid -> bars -> baseline
 *
 * Notes:
 * - Grid baseline edge is excluded from the grid primitive (baseline owned here).
 * - Chart convention:
 *   - horizontal gridlines use bottom-origin (y = H*(1-frac))
 *   - vertical gridlines use left-origin  (x = W*frac)
 * ============================================================================
 */

import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicSource,
  MosaicLavfiSource,
  MosaicTemplate,
} from "@m0saic/types";
import { toMosaicColor , asTemplateId } from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  makeErrorMosaic,
  renderNestedTemplate,
  buildOverlayStack,
  transparentSlot,
} from "@m0saic/template-utils";
import type { Dock, PlotAreaProps } from "../types";

const propsSchema = definePropsSchema<PlotAreaProps>({
  axisConfig: {
    type: "group",
    required: true,
    description: "Resolved axis configuration from orientation.",
  },
  grid: {
    type: "group",
    required: true,
    description: "Grid display configuration (show, count).",
  },
  baseline: {
    type: "group",
    required: true,
    description: "Baseline display configuration (show).",
  },
  valueAxis: {
    type: "group",
    required: true,
    description: "Value-axis (top for vertical bars / right for horizontal) display configuration.",
  },
  barsStackRef: {
    type: "string",
    required: true,
    description: "Child key for the BarsStack renderable (provided by parent).",
  },
});

/** Return the dock opposite the given edge. The value axis sits opposite the baseline. */
function oppositeEdge(edge: Dock): Dock {
  switch (edge) {
    case "top": return "bottom";
    case "bottom": return "top";
    case "left": return "right";
    case "right": return "left";
  }
}

export const PLOT_AREA_TEMPLATE_ID = asTemplateId("@m0saic/charts/bar-graph/internal/plot-area/v1");

// v1 constants (can be promoted into defaults.ts later)
const BASELINE_THICKNESS_FRAC = 0.002;
const BASELINE_COLOR = toMosaicColor("#ffffff", "PlotArea.BASELINE_COLOR");

/**
 * Canonical 1px-ish baseline strip for a given dock edge.
 * Uses fitMode:"content" + size exprs to keep thickness stable-ish.
 */
function baselineSourceForEdge(edge: Dock): MosaicLavfiSource {
  const t = BASELINE_THICKNESS_FRAC;
  const isHorizontal = edge === "top" || edge === "bottom";

  return {
    type: "lavfi",
    color: BASELINE_COLOR,
    fitMode: "content",
    size: isHorizontal
      ? { wExpr: "TW", hExpr: `max(1, TH*${t})` }
      : { wExpr: `max(1, TW*${t})`, hExpr: "TH" },
    placement: {
      fit: "contain",
      hAlign: edge === "left" ? "left" : edge === "right" ? "right" : "center",
      vAlign: edge === "top" ? "top" : edge === "bottom" ? "bottom" : "middle",
    },
  };
}

export const PlotArea: MosaicTemplate<PlotAreaProps> = {
  id: PLOT_AREA_TEMPLATE_ID,
  label: "Bar Graph — Plot Area (internal)",
  version: 1,
  internal: true,
  // Building block of the DEPRECATED @m0saic/charts/bar-graph/v1 composition —
  // superseded with it (v2 is a flat single document and needs none of these).
  deprecated: {
    reason: "Internal piece of the deprecated 5-deep bar-graph/v1 nested composition; bar-graph/v2 renders the same chart as one flat document.",
    replacement: asTemplateId("@m0saic/charts/bar-graph/v2"),
    since: "2026-09-16",
  },
  description: "Internal: data rectangle containing gridlines, baseline, and the bars stack.",
  capabilities: { tier: "core" },
  tags: ["data-viz", "bar-graph", "internal", "plot-area"],
  propsSchema,

  defaultProps: {
    axisConfig: {
      fillAxis: "y",
      layoutAxis: "x",
      labelDock: "bottom",
      valueDock: "top",
      gridDirection: "horizontal",
      baselineEdge: "bottom",
    },
    grid: { show: true, count: 5 },
    baseline: { show: true },
    valueAxis: { show: true },
    barsStackRef: "bars-stack",
  },

  async render(props: PlotAreaProps, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    if (!props.barsStackRef) {
      return makeErrorMosaic("barsStackRef is required", {
        title: `${this.id} props`,
        width: ctx.output.width,
        height: ctx.output.height,
      });
    }

    const sources: MosaicSource[] = [];
    const children: Record<string, MosaicRenderableFile> = {};

    // slot0: grid (back) — global primitive
    if (props.grid?.show) {
      const gridChildId = "grid";

      const direction = props.axisConfig?.gridDirection ?? "horizontal";
      const origin = direction === "horizontal" ? "bottom" : "left";

      children[gridChildId] = await renderNestedTemplate(
        "@m0saic/primitives/grid/v2",
        {
          // keep primitive API small + reusable
          direction,
          count: Math.max(0, Math.floor(props.grid?.count ?? 0)),
          excludeEdges: true, // baseline owned here
          origin,
          // Allow primitive defaults unless you explicitly want to pass styling from hero defaults.
          // If your resolved grid config contains color/opacity/thickness, map them here.
          ...(props.grid as any),
        },
        ctx,
      );

      sources.push({ type: "mosaic", ref: gridChildId });
    } else {
      sources.push(transparentSlot());
    }

    // slot1: bars (middle)
    sources.push({ type: "mosaic", ref: props.barsStackRef });

    // slot2: baseline (front, at the zero-line edge)
    if (props.baseline?.show) {
      sources.push(baselineSourceForEdge(props.axisConfig.baselineEdge));
    } else {
      sources.push(transparentSlot());
    }

    // slot3: value axis (front, at the max-value edge — top for vertical bars,
    // right for horizontal bars). Mirrors the baseline so the plot rect has
    // bounded reference lines on both sides of the data extent. Without this,
    // the first interior gridline visually reads as "top of plot", making the
    // gap structure feel uneven.
    if (props.valueAxis?.show) {
      sources.push(baselineSourceForEdge(oppositeEdge(props.axisConfig.baselineEdge)));
    } else {
      sources.push(transparentSlot());
    }

    return {
      kind: "mosaic_document",
      version: 1,
      sources,
      assets: {} as any,
      // grid(back) → bars → baseline → value-axis (front)
      m0: buildOverlayStack(sources.length),
      children: Object.keys(children).length ? children : undefined,
      durationMs: ctx.target.durationMs,
    } satisfies MosaicDocument;
  },
};

registerTemplate(PlotArea);