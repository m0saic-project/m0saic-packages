import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/charts/bar-graph/internal/bars-stack/v1
 * ============================================================================
 *
 * RESPONSIBILITY:
 *   Layout-only container that arranges N bars along the layout axis.
 *
 *   Owns:
 *     - Building the m0saic DSL string that splits space for N bars along
 *       axisConfig.layoutAxis
 *     - Instantiating N BarCell children via renderNestedTemplate
 *     - Forwarding per-bar props (fraction, color, label, index, highlight)
 *     - Applying gap spacing between bars (production strategy)
 *     - Resolving per-bar colors from barColor (single vs array)
 *
 * COMPOSITION:
 *   BarsStack sits inside PlotArea. For each bar i:
 *     - renderNestedTemplate("@m0saic/charts/bar-graph/internal/bar-cell/v1", barCellProps, ctx)
 *     - store child in children[`bar-${i}`]
 *   The M0 string is an N-way split along layoutAxis:
 *     - layoutAxis="x" → `N(bar-0,bar-1,...,bar-(N-1))` (horizontal split)
 *     - layoutAxis="y" → `N[bar-0,bar-1,...,bar-(N-1)]` (vertical split)
 *
 * GAP (CANONICAL NOTE):
 *   `gap` is in PIXELS (not fraction).
 *   Production implementation will decide the concrete strategy to realize
 *   gaps deterministically (e.g., via spacer tiles / weighted slots / or a
 *   standardized placement inset mechanism if available).
 *
 * WHAT NOT TO DO:
 *   - Do NOT own animation — BarFill only.
 *   - Do NOT compute fill fractions — receive `fractions[]` from parent.
 *   - Do NOT draw grid/baseline — PlotArea/Grid owns that.
 *   - Do NOT format numbers — Labels internal owns formatting.
 * ============================================================================
 */

import type { MosaicDocument, MosaicEngineContext, MosaicRenderableFile, MosaicTemplate } from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  renderNestedTemplate,
  makeErrorMosaic,
  gridCellInset,
} from "@m0saic/template-utils";
import { container } from "@m0saic/dsl-stdlib";
import type { BarsStackProps } from "../types";
import { DEFAULT_ANIM, DEFAULT_GAP, DEFAULT_TRACK, DEFAULT_VALUE_LABELS, DEFAULT_CORNER_RADIUS } from "../defaults";

export const BARS_STACK_TEMPLATE_ID = asTemplateId("@m0saic/charts/bar-graph/internal/bars-stack/v1");

const propsSchema = definePropsSchema<BarsStackProps>({
  axisConfig: {
    type: "group" as any,
    required: true,
    description: "Resolved axis configuration (layoutAxis determines split direction).",
  },

  values: {
    type: "number[]",
    required: true,
    description: "Raw data values (one per bar).",
  },

  fractions: {
    type: "number[]",
    required: true,
    description: "Domain-normalized [0..1] fill fractions for each bar.",
  },

  minValue: {
    type: "number",
    required: true,
    description: "Resolved domain min (for future label/tick formatting).",
  },

  maxValue: {
    type: "number",
    required: true,
    description: "Resolved domain max (for future label/tick formatting).",
  },

  barColor: {
    // `json` (permissive) represents the union string | string[]; the impl
    // resolves single vs per-bar array.
    type: "json" as never,
    required: true,
    description: "Bar color(s): single color or array (cycled per bar).",
  },

  gap: {
    type: "number",
    required: true,
    description: "Gap between bars in pixels.",
    meta: { constraints: { min: 0, max: 256 } },
  },

  barThickness: {
    type: "number",
    required: false,
    description: "Optional fixed bar thickness in pixels (otherwise auto).",
    meta: { control: { placeholder: "auto (from gap)" }, constraints: { min: 1, max: 4096 } },
  },

  highlightIndex: {
    type: "number",
    required: false,
    description: "Optional bar index to highlight.",
    meta: { control: { placeholder: "none" }, constraints: { min: 0 } },
  },

  track: {
    type: "group" as any,
    required: true,
    description: "Track display configuration.",
  },

  valueLabels: {
    type: "group" as any,
    required: true,
    description: "Value label display configuration.",
  },

  labels: {
    type: "string[]",
    required: false,
    description: "Optional category labels (index-aligned to values).",
  },

  anim: {
    type: "group" as any,
    required: true,
    description: "Animation configuration forwarded to BarCell/BarFill.",
  },

  cornerRadius: {
    type: "number",
    required: true,
    description: "Geometric radius fraction (0..1) forwarded to BarCell.",
    meta: { constraints: { min: 0, max: 1 } },
  },
});

export const BarsStack: MosaicTemplate<BarsStackProps> = {
  id: BARS_STACK_TEMPLATE_ID,
  label: "Bar Graph — Bars Stack (internal)",
  version: 1,
  internal: true,
  // Building block of the DEPRECATED @m0saic/charts/bar-graph/v1 composition —
  // superseded with it (v2 is a flat single document and needs none of these).
  deprecated: {
    reason: "Internal piece of the deprecated 5-deep bar-graph/v1 nested composition; bar-graph/v2 renders the same chart as one flat document.",
    replacement: asTemplateId("@m0saic/charts/bar-graph/v2"),
    since: "2026-09-16",
  },
  description: "Internal: layout container that arranges N BarCell children along the layout axis.",
  capabilities: { tier: "core" },
  tags: ["data-viz", "bar-graph", "internal", "bars-stack"],
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
    values: [35, 60, 85, 45, 70],
    fractions: [0.41, 0.71, 1.0, 0.53, 0.82],
    minValue: 0,
    maxValue: 85,
    barColor: "#f97316",
    gap: DEFAULT_GAP,
    barThickness: undefined,
    highlightIndex: undefined,
    track: DEFAULT_TRACK,
    valueLabels: DEFAULT_VALUE_LABELS,
    labels: undefined,
    anim: DEFAULT_ANIM,
    cornerRadius: DEFAULT_CORNER_RADIUS,
  },

  async render(props: BarsStackProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const N = props.values.length;
  
    // ---- Validate aligned arrays ----
    if (N <= 0) {
      return makeErrorMosaic("BarsStack: values[] must be non-empty", {
        title: `${this.id}`,
        width: ctx.output.width,
        height: ctx.output.height,
      });
    }
    if (props.fractions.length !== N) {
      return makeErrorMosaic(
        `BarsStack: fractions[] length mismatch (values=${N}, fractions=${props.fractions.length})`,
        { title: `${this.id}`, width: ctx.output.width, height: ctx.output.height }
      );
    }
    if (props.labels && props.labels.length !== N) {
      return makeErrorMosaic(
        `BarsStack: labels[] length mismatch (values=${N}, labels=${props.labels.length})`,
        { title: `${this.id}`, width: ctx.output.width, height: ctx.output.height }
      );
    }
  
    // ---- Determine axis pixels (prefer tile rect if present) ----
    const rect = (ctx as any).rect ?? (ctx as any).tileRect ?? null;
    const tileW: number = rect?.width ?? ctx.output.width;
    const tileH: number = rect?.height ?? ctx.output.height;

    const layoutAxis = props.axisConfig.layoutAxis;
    const isX = layoutAxis !== "y"; // "x" (default) → bars in a row

    // Gap between bars via a per-bar inset on a gutterless N-cell split — no
    // spacer tokens (compact m0), pixel-exact gaps. Equal bar widths need an
    // outer margin on the LAYOUT axis; the CROSS axis gets no inset so each
    // bar keeps its full extent (height for vertical bars).
    const barInset = gridCellInset({
      rows: isX ? 1 : N,
      cols: isX ? N : 1,
      gridW: tileW,
      gridH: tileH,
      gapPx: props.gap,
      outerMargin: isX ? { x: true, y: false } : { x: false, y: true },
    });

    // ---- Build children + sources ----
    const children: Record<string, MosaicRenderableFile> = {};
    const sources: any[] = [];

    const barCellTemplateId = "@m0saic/charts/bar-graph/internal/bar-cell/v1";

    for (let i = 0; i < N; i++) {
      const childId = `bar-${i}`;

      // Resolve per-bar color (string | string[] pattern, runtime-safe)
      const bc: any = props.barColor as any;
      const color = Array.isArray(bc) && bc.length > 0 ? bc[i % bc.length] : (bc as string);

      const child = await renderNestedTemplate(
        barCellTemplateId,
        {
          axisConfig: props.axisConfig,
          value: props.values[i],
          fraction: props.fractions[i],
          label: props.labels ? props.labels[i] : undefined,
          index: i,
          highlighted: props.highlightIndex != null ? i === props.highlightIndex : false,
          color,
          barThickness: props.barThickness,
          track: props.track,
          valueLabels: props.valueLabels,
          anim: props.anim,
          cornerRadius: props.cornerRadius,
          minValue: props.minValue,
          maxValue: props.maxValue,
        } as any,
        ctx
      );

      children[childId] = child;

      const inset = barInset(isX ? 0 : i, isX ? i : 0);
      sources.push({
        type: "mosaic",
        ref: childId,
        ...(inset ? { placement: { inset } } : {}),
      });
    }

    // Gutterless N-cell split; the gap lives in each bar's inset (above).
    const containerAxis = isX ? "col" as const : "row" as const;
    const raw = container(Array.from({ length: N }, () => "1"), containerAxis);
  
    return {
      
      kind: "mosaic_document",
      version: 1,
      sources,
      assets: {} as any,
      m0: raw,
      fps: ctx.target.fps, durationMs: ctx.target.durationMs ,
      children,
    } as any;
  }
};

registerTemplate(BarsStack);