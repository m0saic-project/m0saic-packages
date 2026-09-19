import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/charts/line-chart/v1 — Canonical Line Chart (data-viz primitive)
 * ============================================================================
 *
 * The PUBLIC top-level template. The sibling of bar-graph/donut/stat-card and
 * the base every dashboard/report composes. Carries ample, well-organized
 * customization: multi-series data, full axis control, full line/point control,
 * and transparent / solid / image backgrounds.
 *
 * RESPONSIBILITY:
 *   1) Normalize values → number[][] (multi-series core).
 *   2) Resolve every public union → fully-resolved internal config.
 *   3) Domain + projection via the shared math core (charts/_shared).
 *   4) Render the unified chart SVG (one coordinate system).
 *   5) Fan out: plot-image (rasterize + reveal) → chart-frame (bg + card).
 *
 * HARD RULES (mirror bar-graph):
 *   - No FFmpeg expressions here — plot-image (the leaf) owns them.
 *   - No SVG drawing here — svg.ts owns it.
 *   - No sharp here — plot-image owns rasterization.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTemplate,
  MosaicThemeTokens,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  renderNestedTemplate,
  makeErrorMosaic,
  makeColorTile,
  buildOverlayStack,
  fadeInExpr,
  resolveThemeTokens,
  resolveDocFrames,
  textEmUnits,
  withLayoutContract,
} from "@m0saic/template-utils";
import { weightedSplit } from "@m0saic/dsl-stdlib";
import { formatAxisValue } from "./format";

import type { AxisConfigInput, LineChartFlat, LineChartProps, ResolvedAxis, ResolvedPadding, ResolvedSeriesStyle } from "./types";
import { buildLineChartModel, type LineChartModel, type SeriesInput } from "../../_shared/line";
import { project, linearScale } from "../../_shared/scale";
import { resolveBackground } from "./axis";
import { buildChromeSpec } from "./chrome-spec";
import { computeFrame } from "./frame";
import { buildLineSeriesSources } from "./line-series";
import { buildCardBase } from "./card";
import { chromeFade } from "./anim";
import {
  DEFAULT_CORNER_RADIUS,
  DEFAULT_POINT_RADIUS,
  DEFAULT_PRESET,
  DEFAULT_STROKE_WIDTH,
  PRESET_TOKENS,
  SERIES_PALETTE,
  resolveAnim,
  resolveAxis,
  resolveBorder,
  resolveLegend,
  resolvePadding,
  resolvePointBorder,
  resolveValueLabels,
  type LineChartPresetTokens,
} from "./defaults";
import { CHROME_TEMPLATE_ID } from "./chrome";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props schema (public)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Group sub-field builders — give each group prop rich, per-field controls in
// the Make panel (collapsible, collapsed-by-default) instead of a JSON box.
// Only WIRED fields are exposed; deferred knobs join as they get wired.
// ---------------------------------------------------------------------------
const fBool = (label: string, description = ""): any => ({ type: "boolean", required: false, description, meta: { ui: { label } } });
const fStr = (label: string, description = "", placeholder?: string): any => ({ type: "string", required: false, description, meta: { ui: { label }, ...(placeholder ? { control: { placeholder } } : {}) } });
const fColor = (label: string, description = "", placeholder?: string): any => ({ type: "string", required: false, description, meta: { control: { colorPicker: true, ...(placeholder ? { placeholder } : {}) }, constraints: { isColor: true }, ui: { label } } });
const fEnum = (label: string, oneOf: string[], description = ""): any => ({ type: "string", required: false, description, meta: { constraints: { oneOf }, ui: { label } } });
const fNum = (label: string, description = "", control?: any, constraints?: any): any => ({
  type: "number",
  required: false,
  description,
  meta: { ui: { label }, ...(control ? { control } : {}), ...(constraints ? { constraints } : {}) },
});
const fFrac = (label: string, description = "", placeholder?: string): any => fNum(label, description, { flavor: "slider", step: 0.05, ...(placeholder ? { placeholder } : {}) }, { min: 0, max: 1 });

const Y_AXIS_FIELDS: any = {
  show: fBool("Axis line"),
  color: fColor("Axis color", "", "theme axis"),
  showLabels: fBool("Show labels"),
  labelColor: fColor("Label color", "", "theme text"),
  fontSize: fNum("Label size (px)"),
  format: fEnum("Format", ["raw", "compact", "percent"]),
  decimals: fNum("Decimals"),
  prefix: fStr("Prefix", "", "none"),
  suffix: fStr("Suffix", "", "none"),
  tickCount: fNum("Tick count", "", { placeholder: "auto" }),
  showTicks: fBool("Tick marks"),
  tickLength: fNum("Tick length (px)"),
  tickColor: fColor("Tick color", "", "theme axis"),
  showGrid: fBool("Gridlines"),
  gridColor: fColor("Grid color", "", "theme grid"),
  gridOpacity: fFrac("Grid opacity"),
};
const X_AXIS_FIELDS: any = {
  show: fBool("Axis line"),
  color: fColor("Axis color", "", "theme axis"),
  showLabels: fBool("Show labels"),
  labelColor: fColor("Label color", "", "theme text"),
  fontSize: fNum("Label size (px)"),
  showTicks: fBool("Tick marks"),
  tickLength: fNum("Tick length (px)"),
  tickColor: fColor("Tick color", "", "theme axis"),
  showGrid: fBool("Gridlines"),
  gridColor: fColor("Grid color", "", "theme grid"),
  gridOpacity: fFrac("Grid opacity"),
};

const propsSchema = definePropsSchema<LineChartProps>({
  values: {
    type: "json" as never,
    required: true,
    description: "Numeric data — one series (number[]) or many (number[][]).",
    meta: { constraints: { minItems: 1 }, control: { flavor: "numberSeries" }, ui: { label: "Values", order: 1 } },
  },
  seriesLabels: { type: "string[]", required: false, description: "Legend names (index-aligned to series).", meta: { ui: { label: "Series Labels", order: 2, primary: true } } },
  labels: { type: "string[]", required: false, description: "Categorical x tick labels.", meta: { ui: { label: "X Labels", order: 3, primary: true } } },

  domain: {
    type: "group" as any, required: false, description: "X/Y axis domain overrides + explicit numeric x values.",
    meta: { ui: { label: "Domain", order: 4, collapsedByDefault: true } },
    fields: {
      xValues: { type: "json" as never, required: false, description: "Numeric x values (even-spaced in v1).", meta: { control: { flavor: "numberList" }, ui: { label: "X Values" } } },
      minValue: fNum("Min Value", "Explicit y-domain minimum.", { placeholder: "data min" }),
      maxValue: fNum("Max Value", "Explicit y-domain maximum.", { placeholder: "data max" }),
      minX: fNum("Min X", "Explicit x-domain minimum (numeric x).", { placeholder: "first category" }),
      maxX: fNum("Max X", "Explicit x-domain maximum (numeric x).", { placeholder: "last category" }),
    },
  } as any,
  line: {
    type: "group" as any, required: false, description: "Line stroke (single or per-series) + area fill.",
    meta: { ui: { label: "Line", order: 5, collapsedByDefault: true } },
    fields: {
      lineColor: { type: "json" as never, required: false, description: "Line color — single or per-series array.", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Line Color" } } },
      strokeWidth: { type: "json" as never, required: false, description: "Stroke width — single or per-series array.", meta: { ui: { label: "Stroke Width" } } },
      lineStyle: fEnum("Line Style", ["solid", "dashed", "dotted"]),
      curve: fEnum("Curve", ["linear", "smooth", "stepped"]),
      lineCap: fEnum("Line Cap", ["butt", "round", "square"]),
      lineJoin: fEnum("Line Join", ["miter", "round", "bevel"]),
      area: { type: "group", required: false, description: "Area fill under the line.", meta: { ui: { label: "Area", collapsedByDefault: true } }, fields: { show: fBool("Show area"), color: fColor("Color", "", "series color"), opacity: fFrac("Opacity") } },
    },
  } as any,
  points: {
    type: "group" as any, required: false, description: "Vertex markers + highlight.",
    meta: { ui: { label: "Points", order: 6, collapsedByDefault: true } },
    fields: {
      showPoints: fBool("Show Points", "Draw markers at vertices."),
      pointRadius: fNum("Point Radius", "Marker radius (px).", undefined, { min: 0, max: 64 }),
      pointColor: fColor("Point Color", "Marker color (default = line color).", "series color"),
      pointShape: fEnum("Point Shape", ["circle", "square", "diamond"]),
      pointBorder: { type: "group", required: false, description: "Marker border.", meta: { ui: { label: "Point Border", collapsedByDefault: true } }, fields: { color: fColor("Color", "", "none"), width: fNum("Width (px)") } },
      highlightIndex: fNum("Highlight Index", "Index to emphasize (larger marker).", { placeholder: "none" }, { min: 0 }),
      highlightLast: fBool("Highlight Last", "Emphasize the last point."),
    },
  } as any,
  axes: {
    type: "group" as any, required: false, description: "X + Y axis lines, labels, grid, ticks.",
    meta: { ui: { label: "Axes", order: 7, collapsedByDefault: true } },
    fields: {
      xAxis: { type: "group", required: false, description: "X axis (line / labels / grid).", meta: { ui: { label: "X Axis", collapsedByDefault: true } }, fields: X_AXIS_FIELDS },
      yAxis: { type: "group", required: false, description: "Y axis (line / labels / grid / ticks).", meta: { ui: { label: "Y Axis", collapsedByDefault: true } }, fields: Y_AXIS_FIELDS },
    },
  } as any,
  appearance: {
    type: "group" as any, required: false, description: "Color scheme (preset) + card surface.",
    meta: { ui: { label: "Appearance", order: 8, collapsedByDefault: true } },
    fields: {
      preset: fEnum("Preset", ["neutral", "dark", "terminal", "glass", "paper"], "Built-in color scheme (card / line / axes / text)."),
      backgroundColor: { type: "string", required: false, description: 'Solid background color, or "none" for transparent.', meta: { constraints: { isColor: true }, control: { placeholder: "preset background", colorPicker: true }, ui: { label: "Background" } } },
      backgroundImage: fStr("Background Image", "Background image (asset ref / data-URI).", "none"),
      cornerRadius: fFrac("Corner Radius", "Card corner radius (0..1)."),
      padding: { type: "json" as never, required: false, description: "Plot insets (px) — number or {top,right,bottom,left}.", meta: { ui: { label: "Padding (px)" } } },
      border: { type: "group", required: false, description: "Card inner stroke.", meta: { ui: { label: "Border", collapsedByDefault: true } }, fields: { color: fColor("Color", "", "theme border"), alpha: fFrac("Alpha", "", "theme border alpha") } },
    },
  } as any,
  titles: {
    type: "group" as any, required: false, description: "Chart title + subtitle.",
    meta: { ui: { label: "Titles", order: 9, collapsedByDefault: true } },
    fields: {
      title: { type: "string", required: false, description: "Chart title.", meta: { control: { placeholder: "e.g., Monthly renders" }, ui: { label: "Title" } } },
      subtitle: fStr("Subtitle", "Chart subtitle."),
      titleColor: fColor("Title Color", "Title color.", "theme text"),
      titleSize: fNum("Title Size", "Title font size (px)."),
      titleAlign: fEnum("Title Align", ["left", "center", "right"]),
    },
  } as any,
  legend: { type: "group" as any, required: false, description: "Legend.", meta: { ui: { label: "Legend", order: 10, collapsedByDefault: true } }, fields: { show: fBool("Show"), position: fEnum("Position", ["top", "bottom"]), color: fColor("Color", "", "theme text"), fontSize: fNum("Font size (px)") } } as any,
  valueLabels: { type: "group" as any, required: false, description: "Per-point value labels.", meta: { ui: { label: "Value Labels", order: 11, collapsedByDefault: true } }, fields: { show: fBool("Show"), format: fEnum("Format", ["raw", "compact", "percent"]), decimals: fNum("Decimals"), color: fColor("Color", "", "theme text"), fontSize: fNum("Font size (px)") } } as any,
  debugLayout: { type: "boolean", required: false, description: "Dev-only: draw the layout contract (title / labels / legend fit their cells) instead of the chart.", meta: { ui: { label: "Debug layout", order: 14 } } },
  anim: {
    type: "group" as any,
    required: false,
    description: "Intro draw-on animation.",
    meta: { ui: { label: "Animation", order: 12, collapsedByDefault: true } },
    fields: {
      reduceMotion: fBool("Reduce motion", "Skip motion; snap to final."),
      intro: {
        type: "group",
        required: false,
        description: "Draw-on timing.",
        meta: { ui: { label: "Intro", collapsedByDefault: true } },
        fields: {
          durationSec: fNum("Duration (s)"),
          delaySec: fNum("Delay (s)"),
          staggerSec: fNum("Stagger (s)"),
          ease: fEnum("Ease", ["linear", "smoothstep", "easeInOut"]),
        },
      },
    },
  } as any,

  theme: {
    type: "group" as any,
    required: false,
    description: "Opt into a theme source. Reads the resolved preset's tokens by default; set a producer slug + namespace to pull shared design tokens (self-seeds when nothing is upstream).",
    meta: { ui: { label: "Theme", order: 13, collapsedByDefault: true } },
    fields: {
      slug: fStr("Producer slug", "Producer template to seed tokens from when the namespace isn't already on ctx (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"),
      preset: fStr("Preset", "Producer preset/variant to request (e.g. light | dark | high-contrast for @m0saic/theming/v1; producer-defined).", "producer default"),
      namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"),
      forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is already populated."),
    },
  } as any,
});

/**
 * Map the grouped public props onto the flat internal shape the render pipeline
 * consumes. Grouping is a Make-panel UX concern (collapsible sections); the
 * machinery stays flat. `reduceMotion` folds in from `anim.reduceMotion`.
 */
function flattenLineChartProps(p: LineChartProps): LineChartFlat {
  return {
    values: p.values,
    seriesLabels: p.seriesLabels,
    labels: p.labels,
    xValues: p.domain?.xValues,
    minValue: p.domain?.minValue,
    maxValue: p.domain?.maxValue,
    minX: p.domain?.minX,
    maxX: p.domain?.maxX,
    preset: p.appearance?.preset,
    backgroundColor: p.appearance?.backgroundColor,
    backgroundImage: p.appearance?.backgroundImage,
    cornerRadius: p.appearance?.cornerRadius,
    border: p.appearance?.border,
    padding: p.appearance?.padding,
    xAxis: p.axes?.xAxis,
    yAxis: p.axes?.yAxis,
    lineColor: p.line?.lineColor,
    strokeWidth: p.line?.strokeWidth,
    lineStyle: p.line?.lineStyle,
    curve: p.line?.curve,
    lineCap: p.line?.lineCap,
    lineJoin: p.line?.lineJoin,
    area: p.line?.area,
    showPoints: p.points?.showPoints,
    pointRadius: p.points?.pointRadius,
    pointColor: p.points?.pointColor,
    pointShape: p.points?.pointShape,
    pointBorder: p.points?.pointBorder,
    highlightIndex: p.points?.highlightIndex,
    highlightLast: p.points?.highlightLast,
    title: p.titles?.title,
    subtitle: p.titles?.subtitle,
    titleColor: p.titles?.titleColor,
    titleSize: p.titles?.titleSize,
    titleAlign: p.titles?.titleAlign,
    legend: p.legend,
    valueLabels: p.valueLabels,
    anim: p.anim,
    reduceMotion: p.anim?.reduceMotion,
    theme: p.theme,
    debugLayout: p.debugLayout,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a single series into number[][]. */
function normalizeValues(values: number[] | number[][]): number[][] {
  if (values.length === 0) return [];
  return Array.isArray(values[0]) ? (values as number[][]) : [values as number[]];
}

function resolveSeriesColors(count: number, lineColor: LineChartFlat["lineColor"], theme: MosaicThemeTokens): MosaicColor[] {
  const dp = theme.dataPalette;
  const out: MosaicColor[] = [];
  for (let i = 0; i < count; i++) {
    // series 0 = the accent (brand); series i≥1 = the categorical ramp. `i % len`
    // (NOT i-1) so series 1 lands on dataPalette[1] — skipping index 0, which is
    // the brand the accent already occupies. Reproduces the pre-theming
    // SERIES_PALETTE[i] exactly (byte-identity) and never collides 0 with 1.
    out.push(i === 0 ? theme.accent : dp[i % dp.length]);
  }
  if (Array.isArray(lineColor)) {
    for (let i = 0; i < count; i++) out[i] = lineColor[i % lineColor.length];
  } else if (typeof lineColor === "string") {
    out[0] = lineColor;
  }
  return out;
}

function resolveStrokeWidths(count: number, sw: LineChartFlat["strokeWidth"]): number[] {
  const out: number[] = new Array(count).fill(DEFAULT_STROKE_WIDTH);
  if (Array.isArray(sw)) for (let i = 0; i < count; i++) out[i] = sw[i % sw.length];
  else if (typeof sw === "number") for (let i = 0; i < count; i++) out[i] = sw;
  return out;
}

/**
 * Build the deterministic theme fallback from the resolved preset tokens. The
 * keys line-chart READS carry the preset's exact hexes (→ byte-identity when
 * un-themed); the rest are defensible locals it never reads (✗). Deliberately
 * does NOT import the producer's resolveTheme — coupling the fallback to a
 * producer preset risks a drift that breaks byte-identity.
 */
function localThemeFromPreset(tk: LineChartPresetTokens): MosaicThemeTokens {
  return {
    surfaceApp: tk.bg, //          ✓ canvas behind the card
    surface: tk.card, //           ✓ card surface
    surfaceRaised: tk.card, //     ✗
    surfaceInset: tk.bg, //        ✗
    border: tk.border, //          ✓ card inner stroke
    borderStrong: tk.axis, //      ✗
    textPrimary: tk.title, //      ✓ title
    textSecondary: tk.axisText, // ✓ subtitle / axis labels / legend
    textMuted: tk.axisText, //     ✗
    eyebrow: tk.axisText, //       ✗
    accent: tk.line, //            ✓ series 0 / line
    accentSoft: tk.line, //        ✗
    accentGlow: tk.line, //        ✗
    positive: "#16a34a", //        ✗ defensible local
    negative: "#dc2626", //        ✗ defensible local
    grid: tk.grid, //              ✓ gridlines
    gridAlpha: 1, //               ✗ (axis gridOpacity owns alpha)
    axis: tk.axis, //              ✓ axis line + ticks
    axisAlpha: 1, //               ✗
    radius: DEFAULT_CORNER_RADIUS, // ✗ (props.cornerRadius owns it)
    dataPalette: SERIES_PALETTE, //   ✓ series ≥ 1
  };
}

/** Overlay theme colors onto a resolved axis, preserving explicit-prop-wins. */
function themeAxis(ax: ResolvedAxis, raw: AxisConfigInput | undefined, theme: MosaicThemeTokens): ResolvedAxis {
  return {
    ...ax,
    color: raw?.color ?? theme.axis,
    tickColor: raw?.tickColor ?? theme.axis,
    labelColor: raw?.labelColor ?? theme.textSecondary,
    gridColor: raw?.gridColor ?? theme.grid,
  };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const ChartsLineChart: MosaicTemplate<LineChartProps> = {
  id: asTemplateId("@m0saic/charts/line-chart/v1"),
  label: "Line Chart",
  version: 1,
  description: "Canonical line-chart data-viz primitive: multi-series, full axis/line/point control, transparent/solid/image backgrounds.",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "line-chart", "animated", "analysts", "marketers", "trend"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 720, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    valueLabels: { show: false, format: "compact", decimals: 0, fontSize: 12 },
    anim: { reduceMotion: false, intro: { durationSec: 1.1, delaySec: 0.1, staggerSec: 0.12, ease: "smoothstep" } },
    legend: { show: true, position: "top", fontSize: 13 },
    axes: { xAxis: { show: true, showLabels: true, fontSize: 13, showTicks: false, tickLength: 4, showGrid: false, gridOpacity: 1 }, yAxis: { show: true, showLabels: true, fontSize: 13, showTicks: false, tickLength: 4, showGrid: true, gridOpacity: 1, format: "raw", decimals: 0 } },
    debugLayout: false,
    theme: { forceFetch: false },
    values: [1200, 1900, 2600, 4100, 6300, 9800],
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    seriesLabels: ["Renders"],
    titles: { titleAlign: "center", titleSize: 22, title: "m0saic render growth", subtitle: "Mocked monthly renders generated by m0saic users." },
    appearance: { cornerRadius: 0.04, preset: "neutral" },
    // Shaded underside ON by default (founder, 2026-09-16): the area fill is the
    // chart's signature look; the bare line is the opt-out (`line.area.show: false`).
    // 0.22 = the Alpine line chart's weight — at 0.12 the shade vanished on the
    // gallery card beside it (founder, same day).
    line: { area: { show: true, opacity: 0.22 }, lineJoin: "round", lineCap: "round", lineStyle: "solid", curve: "linear" },
    points: { highlightLast: false, pointBorder: { width: 0 }, pointShape: "circle", pointRadius: 3, showPoints: true },
  },

  async render(rawProps: LineChartProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    // Public props are grouped for the Make panel; flatten to the internal shape
    // once up front so the render pipeline (below) stays flat + untouched.
    const props = flattenLineChartProps(rawProps);
    // 1) Validate
    const seriesValues = normalizeValues(props.values ?? []);
    if (seriesValues.length === 0 || seriesValues.every((s) => s.length === 0)) {
      return makeErrorMosaic("values must be a non-empty number[] or number[][]", {
        title: `${this.id} props`,
        width: ctx.target.width,
        height: ctx.target.height,
      });
    }
    if (seriesValues.some((s) => s.some((v) => typeof v !== "number" || !Number.isFinite(v)))) {
      return makeErrorMosaic("values must be finite numbers (no NaN / blank entries)", {
        title: `${this.id} props`,
        width: ctx.target.width,
        height: ctx.target.height,
      });
    }

    const W = ctx.target.width;
    const H = ctx.target.height;
    const preset = props.preset ?? DEFAULT_PRESET;
    const tk = PRESET_TOKENS[preset];

    // Theme: the resolved preset's tokens are the deterministic fallback; a
    // producer upstream (or props.theme.slug) overlays per-key. Un-themed →
    // byte-identical to the preset. (F4 U-C1 — line-chart's first consumer.)
    const theme = await resolveThemeTokens(localThemeFromPreset(tk), ctx, props.theme);

    // 2) Resolve config
    //
    // GEOMETRY IS THE SOURCE OF TRUTH. We quantize the requested plot insets to
    // the bounded-basis frame weights (frame.ts), then DERIVE the plot rect from
    // those weights and feed THAT to the model — so the animated data layer (the
    // one part that can't be m0 geometry) lands exactly on the geometry cells at
    // every resolution.
    // Explicit prop wins; else the theme token (== the preset token when un-themed).
    const xAxis = themeAxis(resolveAxis(props.xAxis, "x", preset), props.xAxis, theme);
    const yAxis = themeAxis(resolveAxis(props.yAxis, "y", preset), props.yAxis, theme);

    const legend = { ...resolveLegend(props.legend, preset), color: props.legend?.color ?? theme.textSecondary };

    const reqPad0 = resolvePadding(props.padding);
    // Default y tick count scales with the plot height (chart.js autoskip
    // spirit): 11 ticks overlap below ~500px of plot. Explicit tickCount wins.
    const plotH0 = Math.max(1, H - reqPad0.top - reqPad0.bottom);
    const autoTicks = Math.max(3, Math.min(11, Math.floor(plotH0 / 48) + 1));
    // AUTO Y-GUTTER: the default 72px left pad clips long formatted ticks
    // ("$9,850,000 USD"). When padding isn't explicit, probe the tick labels
    // (scale ticks depend on data + domain only, not padding) and widen the
    // gutter to the longest one, capped at 30% of the canvas. Explicit padding
    // is respected as-is (the chrome-spec font cap is the backstop there).
    let reqPad = reqPad0;
    if (props.padding == null && yAxis.showLabels) {
      const probeInput: SeriesInput = {
        labels: ["a"],
        series: normalizeValues(props.values ?? []).map((vals, i) => ({ name: String(i), values: vals, color: "#000" as MosaicColor })),
      };
      const probeModel = applyExplicitDomain(
        buildLineChartModel(probeInput, {
          width: W,
          height: H,
          padding: { left: reqPad0.left, right: reqPad0.right, top: reqPad0.top, bottom: reqPad0.bottom },
          beginAtZero: props.minValue == null,
          maxTicks: yAxis.tickCount > 0 ? yAxis.tickCount : autoTicks,
        }),
        props.minValue,
        props.maxValue,
      );
      const tickTexts = probeModel.scale.ticks.map((v) => formatAxisValue(v, yAxis.format, yAxis.decimals, probeModel.scale.max, yAxis.prefix, yAxis.suffix));
      const maxUnits = Math.max(1, ...tickTexts.map((t) => textEmUnits(t)));
      const tickPad = yAxis.showTicks ? yAxis.tickLength : 0;
      const need = Math.ceil((maxUnits * 0.62 * yAxis.fontSize) / 0.84) + tickPad + 8;
      reqPad = { ...reqPad0, left: Math.min(Math.max(reqPad0.left, need), Math.round(W * 0.3)) };
    }
    // Bottom-positioned legend: reserve a footer band inside the x-gutter row.
    const LEGEND_BAND_PX = 36;
    const legendBottom = legend.show && legend.position === "bottom" && seriesValues.length > 0;
    if (legendBottom) reqPad = { ...reqPad, bottom: reqPad.bottom + LEGEND_BAND_PX };
    const frame = computeFrame(W, H, reqPad);
    const pad: ResolvedPadding = {
      left: frame.plot.left,
      top: frame.plot.top,
      right: W - frame.plot.right,
      bottom: H - frame.plot.bottom,
    };
    const border = { ...resolveBorder(props.border, preset), color: props.border?.color ?? theme.border };
    const anim = resolveAnim(props.anim, props.reduceMotion);
    const bg0 = resolveBackground({ preset, backgroundColor: props.backgroundColor, backgroundImage: props.backgroundImage });
    // preset (no explicit bg) → the themed surface; solid/image/none keep their own.
    const bg = bg0.mode === "preset" ? { ...bg0, cardColor: theme.surface, canvasColor: theme.surfaceApp } : bg0;

    const n = seriesValues.length;
    const colors = resolveSeriesColors(n, props.lineColor, theme);
    const strokeWidths = resolveStrokeWidths(n, props.strokeWidth);

    // Category labels: explicit, else from xValues, else 1..k.
    // `cats` = the longest series (x-positions derive from the label count, so
    // it must cover every data point — otherwise a point with no x is NaN).
    const cats = Math.max(1, ...seriesValues.map((s) => s.length));
    let labels =
      props.labels ??
      (props.xValues ? props.xValues.map((v) => String(v)) : Array.from({ length: cats }, (_, i) => String(i + 1)));
    // Reconcile the label count to the data point count so every point gets an
    // x-position. Adding a value without a matching label (or vice-versa) must
    // not break the render — pad with 1-based indices, or truncate the extras.
    if (labels.length < cats) {
      labels = [...labels, ...Array.from({ length: cats - labels.length }, (_, i) => String(labels.length + i + 1))];
    } else if (labels.length > cats) {
      labels = labels.slice(0, cats);
    }
    const seriesNames = props.seriesLabels ?? colors.map((_, i) => `Series ${i + 1}`);

    // 3) Domain + projection (shared math core)
    const input: SeriesInput = {
      labels,
      series: seriesValues.map((vals, i) => ({ name: seriesNames[i] ?? `Series ${i + 1}`, values: vals, color: colors[i] })),
    };
    let model: LineChartModel = buildLineChartModel(input, {
      width: W,
      height: H,
      padding: { left: pad.left, right: pad.right, top: pad.top, bottom: pad.bottom },
      beginAtZero: props.minValue == null,
      maxTicks: yAxis.tickCount > 0 ? yAxis.tickCount : autoTicks,
    });
    model = applyExplicitDomain(model, props.minValue, props.maxValue);

    // 4) Per-series resolved style
    const area = props.area ?? {};
    const pointBorder = resolvePointBorder(props.pointBorder);
    const highlightIndex = props.highlightLast ? cats - 1 : props.highlightIndex ?? -1;
    const styles: ResolvedSeriesStyle[] = colors.map((color, i) => ({
      color,
      strokeWidth: strokeWidths[i],
      lineStyle: props.lineStyle ?? "solid",
      curve: props.curve ?? "linear",
      lineCap: props.lineCap ?? "round",
      lineJoin: props.lineJoin ?? "round",
      area: { show: area.show ?? false, color: area.color, opacity: area.opacity ?? 0.15 },
      showPoints: props.showPoints ?? true,
      pointRadius: props.pointRadius ?? DEFAULT_POINT_RADIUS,
      pointColor: props.pointColor ?? color,
      pointShape: props.pointShape ?? "circle",
      pointBorder,
    }));

    // 5) Native composition (no sharp). Flat overlay stack, all on one timeline:
    //      card (base) → chrome (grid/axes/text, quick group fade) → data (draw-on)
    //
    // The chrome is a child mosaic faded as a group (a mosaic-ref overlay alpha,
    // which the engine animates reliably). The data sources are flat in the
    // parent so every sliver/point reveal stays on the same global `t`.
    const spec = buildChromeSpec(model, frame, {
      xAxis,
      yAxis,
      series: styles,
      title: props.title,
      subtitle: props.subtitle,
      titleColor: props.titleColor ?? theme.textPrimary,
      titleSize: props.titleSize ?? 22,
      titleAlign: props.titleAlign ?? "center",
      subtitleColor: theme.textSecondary,
      legend,
      ...(legendBottom ? { legendBandPx: LEGEND_BAND_PX } : {}),
    });

    const children: Record<string, any> = {};
    children["chrome"] = await renderNestedTemplate(CHROME_TEMPLATE_ID, { spec }, ctx);

    const card = buildCardBase({
      mode: bg.mode,
      cardColor: bg.cardColor,
      backgroundImage: bg.backgroundImage,
      cornerRadius: props.cornerRadius ?? DEFAULT_CORNER_RADIUS,
      border,
    });

    const fade = chromeFade(anim);
    const chromeSource: MosaicSource = {
      type: "mosaic",
      ref: "chrome",
      ...(anim.reduceMotion ? {} : { overlay: { startAtSec: fade.startSec, alpha: fadeInExpr(fade.startSec, fade.durSec) } }),
    };

    const valueLabels = resolveValueLabels(props.valueLabels);
    const data = buildLineSeriesSources(model, styles, anim, {
      highlightIndex,
      valueLabels,
      plotBg: { mode: bg.mode, color: bg.cardColor },
      // Make inline edit: every value label DISPLAYS one `values` leaf. The
      // parent names the prop + its shape — `normalizeValues` wraps a flat
      // number[] into [[…]], so the series count alone can't tell `[j]` from
      // `[0, j]`; probe the raw prop the same way it does. `editor` only —
      // the m0 is untouched.
      valuesBinding: { propKey: "values", nested: Array.isArray((props.values ?? [])[0]) },
    });

    // Compose: canvas tile (when a canvas color exists) → card → chrome
    // (real-geometry frame) → data (the animated line/area/points). The data
    // layer is REAL GEOMETRY too — each piece is its own bounding-box cell (see
    // line-series.ts), NOT a full-canvas overlay — so nothing swallows clicks
    // on the chrome/title beneath it.
    //
    // The canvas color is ALSO painted as a real base tile: the resolver child
    // path (.mosaicx template_invocation) drops the child doc's backgroundColor
    // (candidate 2026-08-06-template-invocation-bg-drop), so relying on
    // doc.backgroundColor alone renders BLACK canvas + corner notches through
    // the CLI/jobs path. "none"/image keep their transparent canvas.
    const canvasTile = bg.canvasColor ? makeColorTile(bg.canvasColor as MosaicColor) : null;
    let m0: string;
    let sources: MosaicSource[];
    if (data) {
      m0 = canvasTile ? `1{1{1{${data.m0}}}}` : `1{1{${data.m0}}}`;
      sources = canvasTile ? [canvasTile, card.source, chromeSource, ...data.sources] : [card.source, chromeSource, ...data.sources];
    } else {
      m0 = String(buildOverlayStack(canvasTile ? 3 : 2));
      sources = canvasTile ? [canvasTile, card.source, chromeSource] : [card.source, chromeSource];
    }

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: card.assets as any,
      m0: m0 as any,
      children,
      sources,
      backgroundColor: bg.canvasColor as MosaicColor | undefined,
    } as MosaicDocument;

    // Dev tripwire: every text group fits its cell at the CLI's glyph metrics.
    // All text is literal (the reveal is enable/alpha gating, never expr text),
    // so the contract covers every group unconditionally. Chrome text lives in
    // the nested chrome child — checkLayout's auto-flatten resolves through it.
    return withLayoutContract(doc, ctx, {
      templateId: "@m0saic/charts/line-chart/v1",
      relations: [],
      constraints: [
        ...(props.title ? [{ label: "chart-title", textFits: { charWidthEm: 0.66 } }] : []),
        ...(props.subtitle ? [{ label: "chart-subtitle", textFits: { charWidthEm: 0.62 } }] : []),
        ...(legend.show && n > 0 ? [{ label: "legend-label", textFits: { charWidthEm: 0.62 } }] : []),
        ...(yAxis.showLabels ? [{ label: "y-tick", textFits: { charWidthEm: 0.62 } }] : []),
        ...(xAxis.showLabels && (props.labels?.length ?? cats) > 0 ? [{ label: "x-label", textFits: { charWidthEm: 0.62 } }] : []),
        ...(valueLabels.show ? [{ label: "value-label", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
      ],
      debug: props.debugLayout === true,
    });
  },

  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // static default chart INLINED flat, its nested chrome child carried.
  async renderCover(_props: LineChartProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const chart = (await ChartsLineChart.render(
      {
        ...(ChartsLineChart.defaultProps as LineChartProps),
        anim: { ...((ChartsLineChart.defaultProps as LineChartProps).anim ?? {}), reduceMotion: true } as LineChartProps["anim"],
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "Line Chart",
        title: "A line chart.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(chart), theme.borderStrong),
      heroAssets: chart.assets,
      children: (chart as { children?: Record<string, MosaicDocument> }).children,
    });
  },
};

/**
 * Honor an explicit y-domain (minValue/maxValue). buildLineChartModel derives a
 * nice domain from the data; when the caller pins either bound we override the
 * scale and re-project every point so the chart shows the user's chosen range.
 */
function applyExplicitDomain(model: LineChartModel, minValue?: number, maxValue?: number): LineChartModel {
  if (minValue == null && maxValue == null) return model;
  const min = minValue ?? model.scale.min;
  const max = maxValue ?? model.scale.max;
  if (max <= min) return model;
  const scale = linearScale(min, max, { beginAtZero: false, maxTicks: model.scale.ticks.length || 11 });
  // Project against the NICED tick bounds, not the exact pinned values: the
  // y-gutter lays tick labels on an EVEN grid, so forcing min/max while the
  // ticks stay niced mislabeled the axis (pinned -50..80 drew "100" at the
  // 80 position). The pinned range stays fully contained; the axis may extend
  // to the next nice tick — the beginAtZero-style behavior.
  const ticks = scale.ticks.length ? scale.ticks : [min, max];
  const lo = Math.min(ticks[0], min);
  const hi = Math.max(ticks[ticks.length - 1], max);
  const niced = { ...scale, min: lo, max: hi };
  const { plot } = model.layout;
  const points = model.series.map((s) => s.values.map((v, i) => ({ x: model.xs[i], y: project(v, lo, hi, plot.bottom, plot.top) })));
  return { ...model, scale: niced, points };
}

registerTemplate(ChartsLineChart);
