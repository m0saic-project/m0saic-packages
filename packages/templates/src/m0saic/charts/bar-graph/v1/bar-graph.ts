import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/charts/bar-graph/v1 — Canonical Bar Graph (data-viz primitive)
 * ============================================================================
 *
 * RESPONSIBILITY:
 *   The PUBLIC top-level template for the canonical Level Bar Graph.
 *   This is the ONLY template consumers interact with directly.
 *
 *   Owns:
 *     1) DOMAIN COMPUTATION
 *        - Derive min/max from values[] (or honor explicit minValue/maxValue)
 *        - Normalize each value into a [0..1] fraction for bar fill
 *
 *     2) AXIS CONFIG RESOLUTION
 *        - Call resolveAxisConfig(orientation) once
 *        - Pass the resulting AxisConfig to every child template
 *
 *     3) CHILD COMPOSITION (top-down)
 *        - ChartFrame → PlotArea → BarsStack → BarCell[] → BarFill
 *        - Grid (via PlotArea)
 *        - Labels (global overlay on top)
 *
 *     4) SOURCE + OVERLAY WIRING
 *        - Build the top-level MosaicDocument with children map
 *        - Wire source refs to child renderables
 *
 *     5) PROPS SCHEMA & DEFAULTS
 *        - definePropsSchema for editors + validation
 *        - defaults + “resolve helpers” from defaults.ts
 *
 * HARD RULES:
 *   - Do NOT contain FFmpeg expressions — BarFill only.
 *   - Do NOT contain micro-layout logic — BarsStack + BarCell.
 *   - Do NOT duplicate orientation branching — resolve once → AxisConfig.
 *
 * CANONICAL UNITS:
 *   - gap is PIXELS
 *   - padding is PIXELS (resolved to {top,right,bottom,left})
 * ============================================================================
 */

import type { MosaicDocument, MosaicEngineContext, MosaicTemplate } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  registerTemplate,
  renderNestedTemplate,
  makeErrorMosaic,
} from "@m0saic/template-utils";

import type { BarGraphProps } from "./types";
import { resolveAxisConfig } from "./axis";
import { niceAxis } from "./format";
import {
  DEFAULT_ANIM,
  DEFAULT_BASELINE,
  DEFAULT_CORNER_RADIUS,
  DEFAULT_GAP,
  DEFAULT_GRID,
  DEFAULT_ORIENTATION,
  DEFAULT_PADDING,
  DEFAULT_PRESET,
  DEFAULT_TRACK,
  DEFAULT_VALUE_AXIS,
  DEFAULT_VALUE_LABELS,
  resolveAnim,
  resolveBaseline,
  resolveGrid,
  resolvePadding,
  resolveTrack,
  resolveValueAxis,
  resolveValueLabels,
} from "./defaults";

// ---------------------------------------------------------------------------
// Props Schema (public)
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<BarGraphProps>({
  values: {
    type: "number[]",
    required: true,
    description: "Numeric data values driving the chart bars.",
    meta: { constraints: { minItems: 1 }, ui: { label: "Values", order: 1 } },
  },

  orientation: {
    type: "string",
    required: false,
    description: "Bar orientation: vertical or horizontal.",
    meta: { constraints: { oneOf: ["vertical", "horizontal"] }, ui: { label: "Orientation", order: 2 } },
  },

  labels: {
    type: "string[]",
    required: false,
    description: "Optional category labels (index-aligned to values).",
    meta: { ui: { label: "Category Labels", order: 3 } },
  },

  title: {
    type: "string",
    required: false,
    description: "Chart title.",
    meta: { control: { placeholder: "e.g., Monthly Sales" }, ui: { label: "Title", order: 1 } },
  },

  subtitle: {
    type: "string",
    required: false,
    description: "Chart subtitle.",
    meta: { control: { placeholder: "e.g., Q4 2024" }, ui: { label: "Subtitle", order: 2 } },
  },

  minValue: {
    type: "number",
    required: false,
    description: "Explicit domain minimum (optional).",
    meta: { ui: { label: "Min Value", order: 4 } },
  },

  maxValue: {
    type: "number",
    required: false,
    description: "Explicit domain maximum (optional).",
    meta: { control: { placeholder: "data max" }, ui: { label: "Max Value", order: 5 } },
  },

  highlightIndex: {
    type: "number",
    required: false,
    description: "Optional bar index to highlight (neutral emphasis).",
    meta: { control: { placeholder: "none" }, constraints: { min: 0 }, ui: { label: "Highlight Index", order: 6 } },
  },

  // Layout (canonical: pixels)
  gap: {
    type: "number",
    required: false,
    description: "Gap between bars in pixels.",
    meta: { constraints: { min: 0, max: 256 }, ui: { label: "Gap (px)", order: 10 } },
  },

  padding: {
    // Public prop is currently `number` in your types.ts scaffold,
    // but defaults.ts resolves union → ResolvedPadding. If you later
    // want true per-side padding, make this a union.
    type: "number",
    required: false,
    description: "Outer padding in pixels (symmetric).",
    meta: { constraints: { min: 0, max: 512 }, ui: { label: "Padding (px)", order: 11 } },
  },

  barThickness: {
    type: "number",
    required: false,
    description: "Optional fixed bar thickness in pixels. If unset, bars share space evenly.",
    meta: { control: { placeholder: "auto (from gap)" }, constraints: { min: 1, max: 4096 }, ui: { label: "Bar Thickness (px)", order: 12 } },
  },

  cornerRadius: {
    type: "number",
    required: false,
    description: "Geometric radius fraction (0..1) for bars and container corners.",
    meta: { constraints: { min: 0, max: 1 }, ui: { label: "Corner Radius", order: 13 } },
  },

  // Appearance
  preset: {
    type: "string",
    required: false,
    description: "Theme preset.",
    meta: { constraints: { oneOf: ["neutral", "dark", "terminal", "glass", "paper"] }, ui: { label: "Preset", order: 20 } },
  },

  barColor: {
    // `json` (permissive) so the prop accepts a single color OR a per-bar color
    // array (the impl supports both); the editor still renders a color picker via
    // `constraints.isColor`.
    type: "json" as never,
    required: false,
    description: "Bar fill color — a single color, or an array of per-bar colors (cycled in bar order).",
    meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Bar Color", order: 21 } },
  },

  track: {
    type: "group" as any,
    required: false,
    description: "Track (background rail) configuration.",
    meta: { ui: { label: "Track", collapsedByDefault: true } },
  },

  grid: {
    type: "group" as any,
    required: false,
    description: "Grid configuration (show, count).",
    meta: { ui: { label: "Grid", collapsedByDefault: true } },
  },

  baseline: {
    type: "group" as any,
    required: false,
    description: "Baseline configuration (show).",
    meta: { ui: { label: "Baseline", collapsedByDefault: true } },
  },

  valueAxis: {
    type: "group" as any,
    required: false,
    description: "Value-axis line at the max-value side (top for vertical / right for horizontal).",
    meta: { ui: { label: "Value Axis", collapsedByDefault: true } },
  },

  valueLabels: {
    type: "group" as any,
    required: false,
    description: "Value label config (show/format/decimals).",
    meta: { ui: { label: "Value Labels", collapsedByDefault: true } },
  },

  anim: {
    type: "group" as any,
    required: false,
    description: "Animation config (intro timing, easing, reduceMotion).",
    meta: { ui: { label: "Animation", collapsedByDefault: true } },
  },
});

// ---------------------------------------------------------------------------
// Template Definition
// ---------------------------------------------------------------------------

export const ChartsBarGraph: MosaicTemplate<BarGraphProps> = {
  id: asTemplateId("@m0saic/charts/bar-graph/v1"),
  label: "Bar Graph",
  version: 1,
  description: "Canonical bar graph data-viz primitive supporting vertical/horizontal, with first-class animation and presets.",
  capabilities: { tier: "core" },
  primitive: true, // foundational data-viz building block (composed by dashboards/reports)
  deprecated: {
    reason:
      "Early template: a 5-deep nested-template composition (ChartFrame → PlotArea → BarsStack → BarCell → BarFill) where every bar is a FULL-PLOT-HEIGHT tile carved by a transparent base + overlay crop — wasted pixels + per-layer composite tax, and it errors on the CLI render path once labels are added. Use v2 — same chart, flat single doc with tight baseline-anchored bar rects; ~2× fewer render steps and faster.",
    replacement: asTemplateId("@m0saic/charts/bar-graph/v2"),
    since: "2026-06-21",
  },
  tags: ["charts", "bar-graph", "chart", "data-viz"],
  outputHints: { width: 1920, height: 1080, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    minValue: 0,
    values: [35, 60, 85, 45, 70],
    orientation: DEFAULT_ORIENTATION,
    preset: DEFAULT_PRESET,
    gap: DEFAULT_GAP,
    padding: DEFAULT_PADDING.top, // symmetric public pad for now
    cornerRadius: DEFAULT_CORNER_RADIUS,
    track: DEFAULT_TRACK,
    grid: DEFAULT_GRID,
    baseline: DEFAULT_BASELINE,
    valueAxis: DEFAULT_VALUE_AXIS,
    valueLabels: DEFAULT_VALUE_LABELS,
    anim: DEFAULT_ANIM,
  },

  async render(props: BarGraphProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    // 1) Validate required data
    if (!props.values || props.values.length === 0) {
      return makeErrorMosaic("values[] must be non-empty", {
        title: `${this.id} props`,
        width: ctx.target.width,
        height: ctx.target.height,
      });
    }

    // 2) Resolve core props
    const orientation = props.orientation ?? DEFAULT_ORIENTATION;
    const axisConfig = resolveAxisConfig(orientation);

    const preset = (props.preset ?? DEFAULT_PRESET) as any;

    const gap = props.gap ?? DEFAULT_GAP;

    // Public padding is currently symmetric number; resolve to per-side pixels
    const padPx = resolvePadding(props.padding);

    // Convert px → fraction relative to THIS chart's canvas (ctx.target — the
    // slot when nested), not ctx.output (the top-level envelope), so padding is
    // correct when the chart is composed into a smaller cell.
    const padding = {
      top: padPx.top / ctx.target.height,
      bottom: padPx.bottom / ctx.target.height,
      left: padPx.left / ctx.target.width,
      right: padPx.right / ctx.target.width,
    };

    const cornerRadius = props.cornerRadius ?? DEFAULT_CORNER_RADIUS;

    const track = resolveTrack(props.track);
    const grid = resolveGrid(props.grid);
    const baseline = resolveBaseline(props.baseline);
    const valueAxis = resolveValueAxis(props.valueAxis);
    const valueLabels = resolveValueLabels(props.valueLabels);
    const anim = resolveAnim(props.anim);

    const values = props.values;

    // 3) Domain computation.
    //
    // When the caller passes minValue / maxValue EXPLICITLY we honor them
    // exactly — the chart shows the data on the user's chosen scale.
    //
    // When EITHER bound is auto-derived (the common case for the canonical
    // primitive), apply the "nice numbers" axis algorithm so axis ticks land
    // on round values (0/20/40/60/80/100) rather than exact domain fractions
    // (0/17/34/51/68/85). Bars are then scaled to the NICE max, so the data
    // sits below the top of the plot — matching standard chart convention
    // and visually distinguishing axis-scale numbers from per-bar values.
    const rawMin = props.minValue ?? 0;
    const rawMax = props.maxValue ?? Math.max(...values);
    const explicitDomain = props.minValue != null && props.maxValue != null;

    let minValue = rawMin;
    let maxValue = rawMax;
    let effectiveGridCount = grid.count;
    if (!explicitDomain) {
      const nice = niceAxis(rawMin, rawMax, grid.count + 1);
      minValue = nice.min;
      maxValue = nice.max;
      // Nice algorithm may shift the tick count slightly (e.g. asks for 6,
      // returns 5 or 7) — keep the grid in lockstep so gridlines align with
      // ticks.
      effectiveGridCount = Math.max(1, nice.ticks.length - 1);
    }

    // Production note: handle max==min gracefully (all values equal).
    const denom = maxValue - minValue;
    const fractions = values.map((v) => (denom === 0 ? 1 : (v - minValue) / denom));

    // Grid lines and tick rail must agree on count; the nice axis may have
    // adjusted it. Plot-area + labels both read this resolved count.
    const effectiveGrid = effectiveGridCount === grid.count
      ? grid
      : { ...grid, count: effectiveGridCount };

    // 4) Render the internal tree (top-down)
    //
    // NOTE:
    // - We render internal templates using renderNestedTemplate.
    // - Internals are referenced by ID; they are not exported publicly.
    //
    // Children refs for the final doc:
    const children: Record<string, any> = {};

    // BarsStack
    children["bars-stack"] = await renderNestedTemplate(
      "@m0saic/charts/bar-graph/internal/bars-stack/v1",
      {
        axisConfig,
        values,
        fractions,
        minValue,
        maxValue,
        barColor: props.barColor ?? "#f97316",
        gap,
        barThickness: props.barThickness,
        highlightIndex: props.highlightIndex,
        track,
        valueLabels,
        labels: props.labels,
        anim,
        cornerRadius,
      },
      ctx,
    );

    // PlotArea
    children["plot-area"] = await renderNestedTemplate(
      "@m0saic/charts/bar-graph/internal/plot-area/v1",
      {
        axisConfig,
        grid: effectiveGrid,
        baseline,
        valueAxis,
        barsStackRef: "bars-stack",
      },
      ctx,
    );

    // Labels (content layout) — composes title-band + plot-area-ref + label-band
    // + value-axis tick rail into the chart's m0 banded layout. Sits INSIDE
    // ChartFrame; not a sibling overlay.
    children["labels"] = await renderNestedTemplate(
      "@m0saic/charts/bar-graph/internal/labels/v1",
      {
        axisConfig,
        title: props.title,
        subtitle: props.subtitle,
        labels: props.labels,
        values,
        minValue,
        maxValue,
        padding,
        gap,
        preset,
        valueLabels,
        gridCount: effectiveGridCount,
        showValueTicks: effectiveGrid.show,
        plotAreaRef: "plot-area",
      },
      ctx,
    );

    // ChartFrame: card surface + content (labels) overlay inset by padding.
    // The `plotAreaRef` prop name is historical — it now references the
    // content composition (Labels), which itself embeds the plot area.
    children["chart-frame"] = await renderNestedTemplate(
      "@m0saic/charts/bar-graph/internal/chart-frame/v1",
      {
        padding,
        cornerRadius,
        preset,
        plotAreaRef: "labels",
      },
      ctx,
    );

    // 5) Top-level document is a single source: the chart-frame.
    return {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: toM0String("F", "BarGraph"),
      children,
      sources: [{ type: "mosaic", ref: "chart-frame" }],
    };
  },
};

registerTemplate(ChartsBarGraph);