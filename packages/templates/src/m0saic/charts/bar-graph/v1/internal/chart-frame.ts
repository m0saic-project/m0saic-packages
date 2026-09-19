import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/charts/bar-graph/internal/chart-frame/v1
 * ============================================================================
 *
 * RESPONSIBILITY:
 *   The outermost visual container (card surface) of the bar graph.
 *
 *   Owns:
 *     - Card surface fill (theme preset → tokens.card)
 *     - Rounded container mask + inner stroke
 *     - Outer padding for PlotArea via placement.inset (fractions of tile size)
 *     - Preset token resolution (preset → colors)
 *
 *   Does NOT own:
 *     - Canvas/background fill (tokens.bg is applied by the parent scene/template)
 *
 * COMPOSITION:
 *   ChartFrame receives a child ref (plotAreaRef) pointing to PlotArea.
 *   It composes:
 *     - base:  Card surface (rounded + stroke)
 *     - overlay: PlotArea (inset into card)
 *
 * NOTES:
 *   - All padding values are fractions of the tile size (0..1). No pixels.
 *   - Guardrails enforce that padding does not consume the entire plot rect.
 * ============================================================================
 */

import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicTemplate } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { definePropsSchema, registerTemplate, makeErrorMosaic } from "@m0saic/template-utils";
import type { ChartFrameProps } from "../types";

export const CHART_FRAME_TEMPLATE_ID = asTemplateId("@m0saic/charts/bar-graph/internal/chart-frame/v1");

// ---------------------------------------------------------------------------
// Preset tokens (local, for now)
// In production, move this to defaults.ts as PRESET_TOKENS and share everywhere.
// ---------------------------------------------------------------------------

type FrameTokens = {
  bg: MosaicColor;        // canvas background (owned by parent)
  card: MosaicColor;      // card surface background (owned by ChartFrame)
  border: MosaicColor;    // inner stroke color
  borderAlpha: number;
};

function tokensForPreset(preset: ChartFrameProps["preset"]): FrameTokens {
  switch (preset) {
    case "dark":
      return { bg: "#0b0f14", card: "#0f172a", border: "#ffffff", borderAlpha: 0.08 };
    case "terminal":
      return { bg: "#050505", card: "#0b0b0b", border: "#22c55e", borderAlpha: 0.18 };
    case "glass":
      return { bg: "#0b0f14", card: "#111827", border: "#ffffff", borderAlpha: 0.10 };
    case "paper":
      return { bg: "#f8fafc", card: "#ffffff", border: "#0f172a", borderAlpha: 0.10 };
    case "neutral":
    default:
      return { bg: "#0b0f14", card: "#0f172a", border: "#ffffff", borderAlpha: 0.08 };
  }
}

// ---------------------------------------------------------------------------
// Props schema
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<ChartFrameProps>({
  padding: {
    type: "group" as any,
    required: true,
    description: "Outer padding as fractions of tile size (0..1): {top,right,bottom,left}.",
  },
  cornerRadius: {
    type: "number",
    required: true,
    description: "Geometric radius fraction (0..1) for the container.",
    meta: { constraints: { min: 0, max: 1 } },
  },
  preset: {
    type: "string",
    required: true,
    description: "Theme preset name (neutral|dark|terminal|glass|paper).",
  },
  plotAreaRef: {
    type: "string",
    required: true,
    description: "Child renderable key for the inner PlotArea.",
  },
});

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const ChartFrame: MosaicTemplate<ChartFrameProps> = {
  id: CHART_FRAME_TEMPLATE_ID,
  label: "Bar Graph — Chart Frame (internal)",
  version: 1,
  internal: true,
  // Building block of the DEPRECATED @m0saic/charts/bar-graph/v1 composition —
  // superseded with it (v2 is a flat single document and needs none of these).
  deprecated: {
    reason: "Internal piece of the deprecated 5-deep bar-graph/v1 nested composition; bar-graph/v2 renders the same chart as one flat document.",
    replacement: asTemplateId("@m0saic/charts/bar-graph/v2"),
    since: "2026-09-16",
  },
  description: "Internal: rounded card surface + inset PlotArea, with preset token resolution.",
  capabilities: { tier: "core" },
  tags: ["data-viz", "bar-graph", "internal", "frame"],
  propsSchema,

  defaultProps: {
    padding: { top: 0.04, right: 0.04, bottom: 0.04, left: 0.04 },
    cornerRadius: 0.18,
    preset: "neutral",
    plotAreaRef: "plot-area",
  },

  async render(props: ChartFrameProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const tokens = tokensForPreset(props.preset);

    // If parent forgot to provide the child, make it obvious.
    if (!props.plotAreaRef) {
      return makeErrorMosaic("plotAreaRef is required", {
        title: `${this.id} props`,
        width: ctx.output.width,
        height: ctx.output.height,
      });
    }

    const p = props.padding;
    const sides = [p.top, p.right, p.bottom, p.left];
    const hasNegative = sides.some((v) => typeof v !== "number" || Number.isNaN(v) || v < 0);
    const consumesWidth = (p.left + p.right) >= 1;
    const consumesHeight = (p.top + p.bottom) >= 1;

    if (hasNegative || consumesWidth || consumesHeight) {
      return makeErrorMosaic(
        `Invalid padding. Expected fractions (0..1) and (left+right)<1, (top+bottom)<1. Got: ${JSON.stringify(props.padding)}`,
        { title: `${this.id} props`, width: ctx.output.width, height: ctx.output.height }
      );
    }

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: toM0String("F{F}", "ChartFrame"),
      children: {},
      sources: [
          // Card surface (base): owns rounding + stroke
          {
            type: "lavfi",
            color: tokens.card,
            effects: {
              rounding: { cornerStyle: "rounded", borderRadius: props.cornerRadius },
              stroke: {
                position: "inner",
                width: 0.002,
                color: tokens.border,
                alpha: tokens.borderAlpha + 0.02,
              },
            },
          },

          // PlotArea (overlay): inset into the card
          {
            type: "mosaic",
            ref: props.plotAreaRef,
            placement: { inset: props.padding },
          },
        ],
    };

    return doc;
  },
};

registerTemplate(ChartFrame);