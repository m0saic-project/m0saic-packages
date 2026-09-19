/**
 * ============================================================================
 * @m0saic/charts/line-chart — Shared Types
 * ============================================================================
 *
 * Single source of truth for every TypeScript type shared across the
 * line-chart template family (public + all internals).
 *
 * RULE (mirrors bar-graph):
 *   - Public props (LineChartProps) are PERMISSIVE — unions, single-or-array,
 *     px shorthands. The top-level template resolves them.
 *   - Internals receive fully-RESOLVED types (no unions, fractions/px decided).
 *   - Keep types PURE — no runtime values. Type-only imports are erased at
 *     compile, so `import type` from template-utils (e.g. ThemeSourceConfig) is fine.
 * ============================================================================
 */

import type { MosaicColor } from "@m0saic/types";
import type { ThemeSourceConfig } from "@m0saic/template-utils";

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * The canonical line-chart look is LIGHT (white card, light grid, dark text,
 * blue line) — the default Chart.js baseline. `neutral` is therefore light,
 * unlike bar-graph's dark `neutral`. Dark variants are opt-in.
 */
export type LineChartPreset = "neutral" | "dark" | "terminal" | "glass" | "paper";

// ---------------------------------------------------------------------------
// Background mode
// ---------------------------------------------------------------------------

/** How the card surface behind the plot is painted. */
export type BackgroundMode = "preset" | "solid" | "image" | "none";

// ---------------------------------------------------------------------------
// Padding
// ---------------------------------------------------------------------------

export type Padding =
  | number
  | { top: number; right: number; bottom: number; left: number };

export type ResolvedPadding = { top: number; right: number; bottom: number; left: number };

// ---------------------------------------------------------------------------
// Axis config (public group → resolved)
// ---------------------------------------------------------------------------

export type AxisTickFormat = "raw" | "compact" | "percent";

/** Public per-axis config group (xAxis / yAxis). All fields optional. */
export type AxisConfigInput = {
  /** Draw the axis line itself. */
  show?: boolean;
  color?: MosaicColor;
  thickness?: number;

  /** Tick labels. */
  showLabels?: boolean;
  labelColor?: MosaicColor;
  fontSize?: number;
  format?: AxisTickFormat;
  decimals?: number;
  prefix?: string;
  suffix?: string;

  /** Tick marks (the little ticks on the axis line). */
  tickCount?: number;
  showTicks?: boolean;
  tickLength?: number;
  tickColor?: MosaicColor;

  /** x-label rotation in degrees (x axis only). */
  rotation?: number;

  /** Gridlines for this axis. */
  showGrid?: boolean;
  gridCount?: number;
  gridColor?: MosaicColor;
  gridOpacity?: number;
  gridDash?: LineStyle;
};

/** Fully-resolved per-axis config consumed by the renderer. */
export type ResolvedAxis = {
  show: boolean;
  color: MosaicColor;
  thickness: number;

  showLabels: boolean;
  labelColor: MosaicColor;
  fontSize: number;
  format: AxisTickFormat;
  decimals: number;
  prefix: string;
  suffix: string;

  tickCount: number;
  showTicks: boolean;
  tickLength: number;
  tickColor: MosaicColor;

  rotation: number;

  showGrid: boolean;
  gridCount: number;
  gridColor: MosaicColor;
  gridOpacity: number;
  gridDash: LineStyle;
};

// ---------------------------------------------------------------------------
// Line / points / area
// ---------------------------------------------------------------------------

export type LineStyle = "solid" | "dashed" | "dotted";
export type Curve = "linear" | "smooth" | "stepped";
export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";
export type PointShape = "circle" | "square" | "diamond";

export type AreaConfig = {
  show?: boolean;
  color?: MosaicColor;
  opacity?: number;
};

export type ResolvedArea = { show: boolean; color?: MosaicColor; opacity: number };

export type PointBorder = { color?: MosaicColor; width?: number };

/** Public line config (single value OR per-series array where noted). */
export type LineConfigInput = {
  lineColor?: MosaicColor | MosaicColor[];
  strokeWidth?: number | number[];
  lineStyle?: LineStyle;
  curve?: Curve;
  lineCap?: LineCap;
  lineJoin?: LineJoin;
  area?: AreaConfig;
};

export type PointsConfigInput = {
  showPoints?: boolean;
  pointRadius?: number;
  pointColor?: MosaicColor;
  pointShape?: PointShape;
  pointBorder?: PointBorder;
  highlightIndex?: number;
  highlightLast?: boolean;
};

/** Fully-resolved per-series style (the renderer iterates these). */
export type ResolvedSeriesStyle = {
  color: MosaicColor;
  strokeWidth: number;
  lineStyle: LineStyle;
  curve: Curve;
  lineCap: LineCap;
  lineJoin: LineJoin;
  area: ResolvedArea;
  showPoints: boolean;
  pointRadius: number;
  pointColor: MosaicColor;
  pointShape: PointShape;
  pointBorder: { color?: MosaicColor; width: number };
};

// ---------------------------------------------------------------------------
// Title / subtitle / legend
// ---------------------------------------------------------------------------

export type TextAlign = "left" | "center" | "right";

export type LegendPosition = "top" | "bottom";

export type LegendConfig = {
  show?: boolean;
  position?: LegendPosition;
  color?: MosaicColor;
  fontSize?: number;
};

export type ResolvedLegend = {
  show: boolean;
  position: LegendPosition;
  color: MosaicColor;
  fontSize: number;
};

// ---------------------------------------------------------------------------
// Value labels (per-point)
// ---------------------------------------------------------------------------

export type ValueLabelFormat = "raw" | "compact" | "percent";

export type ValueLabelsConfig = {
  show?: boolean;
  format?: ValueLabelFormat;
  decimals?: number;
  color?: MosaicColor;
  fontSize?: number;
};

export type ResolvedValueLabels = {
  show: boolean;
  format: ValueLabelFormat;
  decimals: number;
  color?: MosaicColor;
  fontSize: number;
};

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export type EaseName = "linear" | "smoothstep" | "easeInOut";

export type AnimIntroConfig = {
  durationSec: number;
  delaySec: number;
  staggerSec: number;
  ease: EaseName;
};

export type AnimConfig = {
  intro: AnimIntroConfig;
  reduceMotion: boolean;
};

// ---------------------------------------------------------------------------
// Border
// ---------------------------------------------------------------------------

export type BorderConfig = { color?: MosaicColor; alpha?: number };
export type ResolvedBorder = { color: MosaicColor; alpha: number };

// ---------------------------------------------------------------------------
// Public LineChartProps
// ---------------------------------------------------------------------------

/**
 * The canonical props interface for @m0saic/charts/line-chart/v1.
 *
 * Required:
 *   values — one series (number[]) OR many series (number[][]).
 *
 * Everything else is optional with defaults in defaults.ts.
 */
/**
 * FLAT internal prop shape — what the render pipeline (line-series / geometry /
 * card / frame …) consumes. The PUBLIC `LineChartProps` (below) groups these into
 * collapsible sections for the Make panel; `render` flattens grouped → flat once
 * up front (`flattenLineChartProps`), so the machinery stays flat + untouched.
 */
export type LineChartFlat = {
  // ---- Data (required) ----
  /** One series, or many (multi-series core). */
  values: number[] | number[][];

  // ---- Domain ----
  seriesLabels?: string[];
  labels?: string[];
  xValues?: number[];
  minValue?: number;
  maxValue?: number;
  minX?: number;
  maxX?: number;

  // ---- Background (transparent / solid / image) ----
  preset?: LineChartPreset;
  backgroundColor?: MosaicColor | "none";
  backgroundImage?: string;
  cornerRadius?: number;
  border?: BorderConfig;
  padding?: Padding;

  // ---- Axes ----
  xAxis?: AxisConfigInput;
  yAxis?: AxisConfigInput;

  // ---- Line (single OR per-series) ----
  lineColor?: MosaicColor | MosaicColor[];
  strokeWidth?: number | number[];
  lineStyle?: LineStyle;
  curve?: Curve;
  lineCap?: LineCap;
  lineJoin?: LineJoin;
  area?: AreaConfig;

  // ---- Points ----
  showPoints?: boolean;
  pointRadius?: number;
  pointColor?: MosaicColor;
  pointShape?: PointShape;
  pointBorder?: PointBorder;
  highlightIndex?: number;
  highlightLast?: boolean;

  // ---- Title / legend / value labels ----
  title?: string;
  subtitle?: string;
  titleColor?: MosaicColor;
  titleSize?: number;
  titleAlign?: TextAlign;
  legend?: LegendConfig;
  valueLabels?: ValueLabelsConfig;

  // ---- Animation ----
  anim?: AnimConfig;
  reduceMotion?: boolean;
  debugLayout?: boolean;

  // ---- Theming (opt-in) ----
  theme?: ThemeSourceConfig;
};

/**
 * PUBLIC props — grouped into collapsible sections (flat props first would still
 * read as a wall; the Make panel only nests via `type:"group"`). Data stays up
 * top (values / series / x-labels); everything else lives under a labeled group.
 * `render` maps this onto `LineChartFlat` via `flattenLineChartProps`.
 */
export type LineChartProps = {
  /** One series, or many (multi-series core). Required. */
  values: number[] | number[][];
  /** Legend names (index-aligned to series). */
  seriesLabels?: string[];
  /** Categorical x tick labels. */
  labels?: string[];
  /** Axis domain overrides + explicit numeric x values. */
  domain?: { xValues?: number[]; minValue?: number; maxValue?: number; minX?: number; maxX?: number };
  /** Line stroke (single or per-series) + area fill. */
  line?: { lineColor?: MosaicColor | MosaicColor[]; strokeWidth?: number | number[]; lineStyle?: LineStyle; curve?: Curve; lineCap?: LineCap; lineJoin?: LineJoin; area?: AreaConfig };
  /** Vertex markers + highlight. */
  points?: { showPoints?: boolean; pointRadius?: number; pointColor?: MosaicColor; pointShape?: PointShape; pointBorder?: PointBorder; highlightIndex?: number; highlightLast?: boolean };
  /** X + Y axis lines, labels, grid, ticks. */
  axes?: { xAxis?: AxisConfigInput; yAxis?: AxisConfigInput };
  /** Color scheme (preset) + card surface. */
  appearance?: { preset?: LineChartPreset; backgroundColor?: MosaicColor | "none"; backgroundImage?: string; cornerRadius?: number; padding?: Padding; border?: BorderConfig };
  /** Chart title + subtitle. */
  titles?: { title?: string; subtitle?: string; titleColor?: MosaicColor; titleSize?: number; titleAlign?: TextAlign };
  legend?: LegendConfig;
  valueLabels?: ValueLabelsConfig;
  /** Intro draw-on animation (+ reduceMotion). */
  anim?: AnimConfig;
  /** Dev-only: draw the layout contract instead of the chart. */
  debugLayout?: boolean;
  /**
   * Opt into a theme SOURCE. Omit → reads the default "theme" namespace off ctx
   * and falls back to the resolved preset's tokens (auto-themes as a child,
   * byte-identical standalone). Provide a `slug` to self-seed from a producer.
   */
  theme?: ThemeSourceConfig;
};

// ---------------------------------------------------------------------------
// Internal template props
// ---------------------------------------------------------------------------

// Internal-template props (ChromeProps) live next to their template in
// chrome.ts; the data layer + card surface are plain builders, not nested
// templates, so they need no prop types here.
