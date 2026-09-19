/**
 * ============================================================================
 * @m0saic/charts/bar-graph — Shared Types
 * ============================================================================
 *
 * RESPONSIBILITY:
 *   Single source of truth for every TypeScript type shared across the
 *   bar-graph template family (public + all internals).
 *
 * WHAT LIVES HERE:
 *   - Orientation        — "vertical" | "horizontal" discriminant.
 *   - AxisConfig         — Resolved axis mapping produced by axis.ts.
 *                          fillAxis vs layoutAxis, label dock positions,
 *                          grid direction — everything orientation-dependent
 *                          flows through this single struct.
 *   - BarGraphProps      — Public props schema type for the top-level template.
 *   - Internal prop types for each child template (ChartFrameProps, etc.).
 *   - Animation contract types (intro timing, stagger, easing).
 *   - Style / theme token types.
 *
 * GUIDELINES:
 *   - Keep types PURE — no runtime code, no imports from template-utils.
 *   - Types consumed by only ONE internal template may still live here to
 *     avoid circular dependencies; locality is secondary to single-source.
 *   - When adding a new prop, add it to BarGraphProps AND to the relevant
 *     internal props type so the render chain can forward it.
 *   - MosaicColor must be imported from @m0saic/types for color props.
 *
 * CANONICAL DESIGN RULES (HERO TEMPLATE):
 *   - Vertical + Horizontal are the SAME template with an axis projection.
 *   - Orientation-dependent behavior must be expressed ONLY via AxisConfig.
 *   - Animation math must be centralized in BarFill (not scattered).
 * ============================================================================
 */

import type { MosaicColor } from "@m0saic/types";

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------

/** Discriminant for bar orientation. Drives the entire AxisConfig. */
export type Orientation = "vertical" | "horizontal";

// ---------------------------------------------------------------------------
// Dock + Padding primitives
// ---------------------------------------------------------------------------

/**
 * Canonical docking positions for labels and baselines.
 *
 * NOTE:
 *   We keep this generic (top/right/bottom/left) so future variants
 *   (e.g., labels on the right for vertical charts) don’t require type changes.
 */
export type Dock = "top" | "right" | "bottom" | "left";

/**
 * Public-friendly padding input.
 *
 * WHY:
 *   A single `padding: number` sounds nice, but production charts quickly
 *   need asymmetry (e.g., more bottom padding when category labels exist,
 *   more left padding in horizontal mode, etc.).
 *
 * RULE:
 *   - Public props allow `number` (shorthand) OR `{top,right,bottom,left}`.
 *   - Internals receive a fully-resolved object shape (ResolvedPadding).
 */
export type Padding =
  | number
  | { top: number; right: number; bottom: number; left: number };

/** Always the internal canonical form (no unions). */
export type ResolvedPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

// ---------------------------------------------------------------------------
// Axis Config (resolved from Orientation)
// ---------------------------------------------------------------------------

/**
 * AxisConfig is the SINGLE struct that every internal template receives to
 * know which physical axis plays which logical role.
 *
 * PRODUCTION BEHAVIOR:
 *   - fillAxis: "y" for vertical bars (bars grow upward), "x" for horizontal.
 *   - layoutAxis: the perpendicular axis along which bars are laid out.
 *   - labelDock: where category labels sit (usually bottom for vertical, left for horizontal).
 *   - valueDock: where value labels sit (usually top for vertical, right for horizontal).
 *   - gridDirection: orientation of grid lines (horizontal for vertical bars; vertical for horizontal bars).
 *   - baselineEdge: which edge of the plot area is the zero-line (bottom or left).
 *
 * DESIGN RULE:
 *   Everything orientation-dependent MUST be derived from this struct and
 *   not re-invented ad-hoc in each internal.
 */
export type AxisConfig = {
  fillAxis: "x" | "y";
  layoutAxis: "x" | "y";
  labelDock: Dock;
  valueDock: Dock;
  gridDirection: "horizontal" | "vertical";
  baselineEdge: Dock;
};

// ---------------------------------------------------------------------------
// Animation types
// ---------------------------------------------------------------------------

/**
 * Keep easing names conservative.
 *
 * WHY:
 *   FFmpeg expressions are powerful but not a full physics engine.
 *   Don’t promise `spring` until you actually ship a spring approximation
 *   that looks great and is stable.
 */
export type EaseName = "linear" | "smoothstep" | "easeInOut";

/**
 * Intro timing contract.
 *
 * IMPORTANT:
 *   Use SECONDS not MS.
 *   FFmpeg expressions, overlay.enable/startAtSec, and your existing template
 *   examples are all naturally expressed in seconds.
 */
export type AnimIntroConfig = {
  /** Total intro duration in seconds. */
  durationSec: number;
  /** Base delay before first bar starts (seconds). */
  delaySec: number;
  /** Per-bar stagger offset (seconds). */
  staggerSec: number;
  /** Easing function name. */
  ease: EaseName;
};

export type AnimConfig = {
  intro: AnimIntroConfig;
  /** If true, skip all motion and snap to final state. */
  reduceMotion: boolean;
};

// ---------------------------------------------------------------------------
// Value label formatting
// ---------------------------------------------------------------------------

export type ValueLabelFormat = "raw" | "percent" | "compact";

export type ValueLabelsConfig = {
  show: boolean;
  format: ValueLabelFormat;
  decimals: number;
  /** Optional unit appended to each formatted value, e.g. "s", "ms", "fps". */
  suffix?: string;
};

// ---------------------------------------------------------------------------
// Track / Grid / Baseline toggles
// ---------------------------------------------------------------------------

export type TrackConfig = {
  show: boolean;
};

export type GridConfig = {
  show: boolean;
  count: number;
};

export type BaselineConfig = {
  show: boolean;
};

// ---------------------------------------------------------------------------
// Presets (canonical theme set for the HERO template)
// ---------------------------------------------------------------------------

/**
 * Presets are intentionally a UNION.
 *
 * WHY:
 *   - Helps editors show a dropdown.
 *   - Prevents random strings from becoming “themes” accidentally.
 *   - Forces intentional design additions.
 */
export type BarGraphPreset = "neutral" | "dark" | "terminal" | "glass" | "paper";

// ---------------------------------------------------------------------------
// Public BarGraphProps (top-level template)
// ---------------------------------------------------------------------------

/**
 * The canonical props interface for @m0saic/charts/bar-graph/v1.
 *
 * Required:
 *   values — the numeric data array driving the chart.
 *
 * Everything else is optional with sensible defaults in defaults.ts.
 */
export type BarGraphProps = {
  // ---- Data (required) ----
  values: number[];

  // ---- Core optional ----
  orientation?: Orientation;
  labels?: string[];
  title?: string;
  subtitle?: string;
  minValue?: number;
  maxValue?: number;
  highlightIndex?: number;

  // ---- Layout ----
  gap?: number;

  /**
   * Padding shorthand or explicit edges.
   * Internals will receive ResolvedPadding.
   */
  padding?: Padding;

  /**
   * Optional fixed thickness of a bar in pixels.
   * If omitted, the stack decides thickness from available space.
   */
  barThickness?: number;

  /** Applied to bar corners and (optionally) chart container corners. */
  cornerRadius?: number;

  // ---- Style ----
  preset?: BarGraphPreset;

  /**
   * Single color or per-bar colors.
   * IMPORTANT: Use MosaicColor for consistency across the ecosystem.
   */
  barColor?: MosaicColor | MosaicColor[];

  track?: TrackConfig;
  grid?: GridConfig;
  baseline?: BaselineConfig;
  /**
   * Value-axis line: the reference line at the max-value side of the plot
   * (top for vertical bars, right for horizontal). Mirrors the baseline so
   * the data extent is bounded by reference lines on both sides.
   */
  valueAxis?: BaselineConfig;

  // ---- Value labels ----
  valueLabels?: ValueLabelsConfig;

  // ---- Animation ----
  anim?: AnimConfig;
};

// ---------------------------------------------------------------------------
// Internal template props
// ---------------------------------------------------------------------------

/**
 * Internal props use RESOLVED types and explicit responsibilities.
 *
 * RULE:
 *   Public unions (like Padding) must be resolved by the top-level template.
 *   Internals should be simple and predictable.
 */

/** Props for @m0saic/charts/bar-graph/internal/chart-frame/v1 */
export type ChartFrameProps = {
  padding: ResolvedPadding;
  cornerRadius: number;
  preset: BarGraphPreset;

  /** Child renderable ref key for the inner plot area. */
  plotAreaRef: string;
};

/** Props for @m0saic/charts/bar-graph/internal/plot-area/v1 */
export type PlotAreaProps = {
  axisConfig: AxisConfig;
  grid: GridConfig;
  baseline: BaselineConfig;
  /** Value-axis line opposite the baseline (top for vertical, right for horizontal). */
  valueAxis: BaselineConfig;

  /** Child renderable ref key for the bars stack. */
  barsStackRef: string;
};

/** Props for @m0saic/charts/bar-graph/internal/bars-stack/v1 */
export type BarsStackProps = {
  axisConfig: AxisConfig;

  // ---- Data ----
  values: number[];

  /**
   * Domain-normalized [0..1] fractions for each bar.
   * Computed ONCE by the top-level template to ensure canonical behavior.
   */
  fractions: number[];

  /**
   * Explicit domain values used for label formatting / tick logic later.
   * Keeping these here prevents “recomputing domain in multiple places”.
   */
  minValue: number;
  maxValue: number;

  // ---- Layout / style ----
  barColor: MosaicColor | MosaicColor[];
  gap: number;
  barThickness?: number;
  highlightIndex?: number;

  track: TrackConfig;
  valueLabels: ValueLabelsConfig;
  labels?: string[];

  anim: AnimConfig;
  cornerRadius: number;
};

/** Props for @m0saic/charts/bar-graph/internal/bar-cell/v1 */
export type BarCellProps = {
  axisConfig: AxisConfig;

  // ---- Data ----
  fraction: number; // [0..1]
  value: number;
  label?: string;

  // Domain bounds — needed for "percent" value-label formatting so each cell
  // can format its own value without reaching back up the chain.
  minValue: number;
  maxValue: number;

  // ---- Styling ----
  color: MosaicColor;
  cornerRadius: number;

  // ---- Identity / state ----
  index: number;
  highlighted: boolean;

  // ---- UI ----
  track: TrackConfig;
  valueLabels: ValueLabelsConfig;

  // ---- Animation ----
  anim: AnimConfig;
};

/**
 * Props for @m0saic/charts/bar-graph/internal/bar-fill/v1
 *
 * CANONICAL RULE:
 *   This template is the ONLY place that owns FFmpeg math for fill animation.
 *   Everyone else gets a “fill fraction” contract and composes around it.
 */
export type BarFillProps = {
  axisConfig: AxisConfig;
  fraction: number;
  color: MosaicColor;
  index: number;
  anim: AnimConfig;
  cornerRadius: number;
};

/** Props for @m0saic/charts/bar-graph/internal/grid/v1 */
export type GridProps = {
  axisConfig: AxisConfig;
  grid: GridConfig;
  baseline: BaselineConfig;
};

/** Props for @m0saic/charts/bar-graph/internal/labels/v1 */
export type LabelsProps = {
  axisConfig: AxisConfig;
  title?: string;
  subtitle?: string;
  labels?: string[];

  values: number[];
  minValue: number;
  maxValue: number;

  /**
   * Canvas-relative padding fractions; here, the {top, right, bottom, left}
   * fractions drive the relative WEIGHTS of the title band, label band,
   * and (for horizontal) left-rail band in the banded m0 layout.
   * They are NOT used as inset values — m0 carries the layout.
   */
  padding: ResolvedPadding;

  /** Pixel gap between bars (forwarded for symmetry / future use). */
  gap: number;

  /** Theme preset; drives label text color so it stays legible across presets. */
  preset: BarGraphPreset;

  valueLabels: ValueLabelsConfig;

  /**
   * Grid count — used to size the tick-rail. The tick rail emits
   * (gridCount + 1) tick labels at evenly-spaced positions from the
   * baseline (value=minValue) to the value-axis (value=maxValue).
   */
  gridCount: number;

  /**
   * Whether to render the value-axis tick numbers. When true the body
   * row gains a tick rail (left side for vertical, bottom for horizontal).
   */
  showValueTicks: boolean;

  /**
   * Child renderable key for the plot area (BarsStack + grid + baseline).
   * Labels references this in its plot-band slot.
   */
  plotAreaRef: string;
};