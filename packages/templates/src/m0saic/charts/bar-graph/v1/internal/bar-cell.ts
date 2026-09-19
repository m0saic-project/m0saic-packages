import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/charts/bar-graph/internal/bar-cell/v1
 * ============================================================================
 *
 * RESPONSIBILITY:
 *   Represents ONE bar in the chart.
 *
 *   BarCell owns the per-bar *micro-composition* (track + fill + labels),
 *   but it does NOT own any FFmpeg animation math.
 *
 *   Owns:
 *     - Track (background rail behind the fill)
 *     - Instantiating BarFill (animated colored fill) via renderNestedTemplate
 *     - (Production) Delegating labels to internal/labels/v1 OR composing
 *       label overlays in a consistent way
 *     - Highlight state visuals (neutral emphasis: outline/glow/lift)
 *     - Per-bar cornerRadius consistency across track + fill
 *
 * Does NOT own:
 *   - Animation math / expressions (BarFill owns ALL FFmpeg expressions)
 *   - Multi-bar layout (BarsStack positions BarCell instances)
 *   - Domain normalization (parent computes `fraction`)
 *   - Orientation branching (consume AxisConfig; do not check orientation)
 *
 * COMPOSITION (canonical layering):
 *   Base layer: Track (static)
 *   Overlay 1:  Fill  (BarFill child)
 *   Overlay 2+: Labels / highlight accents (production)
 *
 * Recommended m0saic:
 *   - Minimal: "F{F}" (track with fill overlay)
 *   - If labels are handled here: "F{F{F}}" (track + fill + labels overlay)
 *
 * ORIENTATION HANDLING:
 *   BarCell should NOT re-interpret vertical vs horizontal.
 *   It only needs AxisConfig for label docking rules (valueDock/labelDock).
 *   Fill direction is entirely handled by BarFill using axisConfig.fillAxis.
 *
 * PRODUCTION BEHAVIOR (eventual):
 *   render(props, ctx) → MosaicDocument:
 *     1) Build track source if track.show (static rail)
 *     2) renderNestedTemplate(bar-fill/v1, fillProps, ctx)
 *     3) If labels enabled: delegate to internal/labels/v1 for consistent typography
 *     4) Compose overlay layers (track → fill → labels/highlight)
 *     5) If highlighted: add neutral emphasis overlay (not error styling)
 *     6) Return document
 * ============================================================================
 */

import type { MosaicDocument, MosaicEngineContext, MosaicRenderableFile, MosaicSource, MosaicTemplate, MosaicTextSource } from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  renderNestedTemplate,
} from "@m0saic/template-utils";
import { weightedSplit } from "@m0saic/dsl-stdlib";
import type { BarCellProps } from "../types";
import { DEFAULT_ANIM, DEFAULT_TRACK, DEFAULT_VALUE_LABELS, DEFAULT_CORNER_RADIUS } from "../defaults";
import { formatValue } from "../format";

export const BAR_CELL_TEMPLATE_ID = asTemplateId("@m0saic/charts/bar-graph/internal/bar-cell/v1");

/**
 * Props schema note:
 *   Nested object validation (axisConfig/anim/valueLabels/track) may be shallow
 *   depending on your schema system. That’s fine for scaffold; production can
 *   tighten validation later if desired.
 */
const propsSchema = definePropsSchema<BarCellProps>({
  axisConfig: {
    type: "group" as any,
    required: true,
    description: "Resolved axis configuration (docks + fillAxis info).",
  },
  fraction: {
    type: "number",
    required: true,
    description: "Domain-normalized fill fraction (0..1).",
    meta: { constraints: { min: 0, max: 1 } },
  },
  value: {
    type: "number",
    required: true,
    description: "Raw numeric value for this bar (label formatting).",
  },
  label: {
    meta: { control: { placeholder: "none" } },
    type: "string",
    required: false,
    description: "Optional category label for this bar.",
  },
  minValue: {
    type: "number",
    required: true,
    description: "Resolved domain min (for percent value-label formatting).",
  },
  maxValue: {
    type: "number",
    required: true,
    description: "Resolved domain max (for percent value-label formatting).",
  },
  color: {
    type: "string",
    required: true,
    description: "Resolved per-bar fill color.",
    meta: { constraints: { isColor: true }, control: { colorPicker: true } },
  },
  index: {
    type: "number",
    required: true,
    description: "Zero-based bar index (used for stagger timing).",
    meta: { constraints: { min: 0 } },
  },
  highlighted: {
    type: "boolean",
    required: true,
    description: "Whether this bar is highlighted (neutral emphasis).",
  },
  track: {
    type: "group" as any,
    required: true,
    description: "Track display configuration (show/hide).",
  },
  valueLabels: {
    type: "group" as any,
    required: true,
    description: "Value label display configuration (show/format/decimals).",
  },
  anim: {
    type: "group" as any,
    required: true,
    description: "Animation configuration forwarded to BarFill.",
  },
  cornerRadius: {
    type: "number",
    required: true,
    description: "Geometric radius fraction (0..1) shared by track + fill.",
    meta: { constraints: { min: 0, max: 1 } },
  },
});

export const BarCell: MosaicTemplate<BarCellProps> = {
  id: BAR_CELL_TEMPLATE_ID,
  label: "Bar Graph — Bar Cell (internal)",
  version: 1,
  internal: true,
  // Building block of the DEPRECATED @m0saic/charts/bar-graph/v1 composition —
  // superseded with it (v2 is a flat single document and needs none of these).
  deprecated: {
    reason: "Internal piece of the deprecated 5-deep bar-graph/v1 nested composition; bar-graph/v2 renders the same chart as one flat document.",
    replacement: asTemplateId("@m0saic/charts/bar-graph/v2"),
    since: "2026-09-16",
  },
  description: "Internal: composes track + BarFill + optional labels for a single bar.",
  capabilities: { tier: "core" },
  tags: ["data-viz", "bar-graph", "internal", "bar-cell"],
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
    fraction: 0.5,
    value: 50,
    label: undefined,
    minValue: 0,
    maxValue: 100,
    color: "#f97316",
    index: 0,
    highlighted: false,
    track: DEFAULT_TRACK,
    valueLabels: DEFAULT_VALUE_LABELS,
    anim: DEFAULT_ANIM,
    cornerRadius: DEFAULT_CORNER_RADIUS,
  },

  async render(props: BarCellProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const children: Record<string, MosaicRenderableFile> = {};

    children["fill"] = await renderNestedTemplate(
      "@m0saic/charts/bar-graph/internal/bar-fill/v1",
      {
        axisConfig: props.axisConfig,
        fraction: props.fraction,
        color: props.color,
        index: props.index,
        anim: props.anim,
        cornerRadius: props.cornerRadius,
      } as any,
      ctx
    );

    // m0-shaped layout: the cell is a banded split that reserves a slot for
    // the value label so the bar never overlaps it. No animation tracking is
    // needed — the bar grows inside its own band, the label sits in its own.
    //
    //   vertical:   row split [label-band, fill-band] (weights 3 : 17)
    //   horizontal: col split [fill-band, label-band] (weights 17 : 3)
    //   no-label:   just the fill ("1")
    //
    // Per-bar mode means the bar's maximum visible extent is the fill band,
    // not the full cell. That's fine: BarsStack sets the same cell size for
    // every bar, so all bars share the same fill-band scale.
    const isVertical = props.axisConfig.fillAxis === "y";
    const fillRef: MosaicSource = { type: "mosaic", ref: "fill" };

    if (!props.valueLabels.show) {
      return {
        kind: "mosaic_document",
        version: 1,
        sources: [fillRef],
        assets: {} as any,
        m0: "1" as any,
        fps: ctx.target.fps,
        durationMs: ctx.target.durationMs,
        children,
      } as MosaicDocument;
    }

    const text = formatValue(
      props.value,
      props.valueLabels.format,
      props.valueLabels.decimals,
      { max: props.maxValue },
      props.valueLabels.suffix,
    );

    // Per-bar value labels are the "data" — sized larger and brighter than
    // the axis tick numbers so the two roles are visually distinct (axis
    // ticks read as scale; bar labels read as values).
    const fontSize = Math.max(12, Math.round(ctx.output.height * 0.024));
    const valueLabel: MosaicTextSource = {
      type: "text",
      visual: { backgroundColor: "black@0" },
      layers: [
        {
          content: { kind: "literal", text },
          style: { fontSize, fontColor: "#ffffff" },
          placement: { fit: "contain", hAlign: "center", vAlign: "middle" },
        },
      ],
    };

    // Source order matches m0 slot order:
    //   vertical (row): label slot first (top), then fill slot (bottom)
    //   horizontal (col): fill slot first (left), then label slot (right)
    const sources: MosaicSource[] = isVertical
      ? [valueLabel, fillRef]
      : [fillRef, valueLabel];

    const m0 = isVertical
      ? (weightedSplit([3, 17], "row") as unknown as string)
      : (weightedSplit([17, 3], "col") as unknown as string);

    return {
      kind: "mosaic_document",
      version: 1,
      sources,
      assets: {} as any,
      m0: m0 as any,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      children,
    } as MosaicDocument;
  }
};

registerTemplate(BarCell);