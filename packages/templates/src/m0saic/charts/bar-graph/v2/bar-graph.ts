import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/charts/bar-graph/v2 — Canonical Bar Graph (tight-rect geometry)
 * ============================================================================
 *
 * SAME chart as v1, RIGHT cost structure. v1 was an early template: a deep
 * nested-template composition (ChartFrame → PlotArea → BarsStack → BarCell →
 * BarFill) where every bar was a FULL-PLOT-HEIGHT tile and the visible bar was
 * carved out by a transparent base + an overlay crop. Most of each bar tile was
 * empty pixels the engine still rasterized, and the five-deep template nesting
 * paid an overlay-composite tax per layer.
 *
 * v2 authors the whole chart as ONE flat MosaicDocument whose geometry lives in
 * the m0 string. Each bar is a TIGHT rect that hugs its FINAL height (max-Y
 * extent), anchored at the baseline via a per-column `[emptyTop, bar]` split:
 * the empty top is a light passthrough (no tile), the bar band is the only
 * painted cell. The grow-in animation is a single `color=` source with a
 * translation overlay that slides up to fill its own rect — no transparent base
 * tile (v1 only needed one because its tiles were oversized). The not-yet-filled
 * region simply reveals the card beneath. The reveal has two modes (`renderMode`,
 * see `RenderMode`): `premium` (default) fades the bar in over the slide (premium,
 * a per-pixel alpha geq); `light` keeps the slide opaque and enable-gates the
 * labels — no geq, cheap when nested into a longer timeline.
 *
 * Compactness (the donut/GCD lesson): geometry is expressed as PROPORTIONAL
 * structured splits whose weights `weightedSplit` GCD-reduces, and per-bar
 * height units are nudged to a shared divisor so the DSL count collapses instead
 * of expanding into per-pixel passthrough cells. Thin lines (baseline / value
 * axis) are full-cell overlay strips sized by expression + placement — one
 * source each, no split bands.
 *
 * Wins: tight rects read correctly in the render hero, the engine never
 * rasterizes pixels a bar can't occupy, and a single flat doc drops v1's nested
 * composite tax. v1's non-functional stubs (`track`, `highlightIndex`) are
 * dropped. (Gridlines + value-axis tick rail land in the next pass.)
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicSource,
  MosaicTextSource,
  MosaicTemplate,
  MosaicThemeTokens,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeErrorMosaic,
  buildGridlineSources,
  resolveThemeTokens,
  withLayoutContract,
  textEmUnits,
  fitEmUnits,
  tag,
  bindProp,
  bindProps,
  u01,
  type ThemeSourceConfig,
  latticeWeights,
} from "@m0saic/template-utils";
import { weightedSplit, niceNum } from "@m0saic/dsl-stdlib";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Public prop surface (self-contained; mirrors v1 minus the dropped stubs)
// ---------------------------------------------------------------------------

type Orientation = "vertical" | "horizontal";
type Preset = "neutral" | "dark" | "terminal" | "glass" | "paper";
type EaseName = "linear" | "smoothstep" | "easeInOut";
type ValueLabelFormat = "raw" | "percent" | "compact";

type ValueLabelsConfig = { show: boolean; format: ValueLabelFormat; decimals: number; suffix?: string };
type GridConfig = { show: boolean; count: number };
type ToggleConfig = { show: boolean };
/**
 * Reveal strategy (mirrors `charts/donut/v3`'s `renderMode`).
 * - `premium` (default): bars + value labels FADE in (time-varying `overlay.alpha`)
 *   over the grow slide — the premium look. The alpha compiles to a per-pixel geq
 *   that, per the cost model, has NO active window: nested in a long parent it is
 *   paid on every frame of the WHOLE clip (an outer `enable` hides it but can't skip
 *   the upstream geq). Fine standalone / for a short head clip; the caller opts into
 *   this cost.
 * - `light`: NO alpha — bars grow via the slide only, value labels reveal via a free
 *   `overlay.enable` gate (a crisp pop). Composable + cheap when nested (no geq;
 *   gated-off frames cost nothing). The nestable tier.
 * Both keep the grow slide; both are fully static under `reduceMotion`.
 */
type RenderMode = "premium" | "light";

type AnimConfig = {
  renderMode?: RenderMode;
  intro: { durationSec: number; delaySec: number; staggerSec: number; ease: EaseName };
  reduceMotion: boolean;
};

// Grouped prop sub-objects — each renders as one collapsible group in the Make
// panel (the Make form only nests via `type:"group"`, so related knobs live under
// a shared parent object rather than as loose top-level props).
type DomainConfig = { minValue?: number; maxValue?: number };
type LayoutConfig = { orientation?: Orientation; gap?: number; padding?: number; barThickness?: number; cornerRadius?: number };
type AppearanceConfig = { preset?: Preset; barColor?: MosaicColor | MosaicColor[] };
type TitlesConfig = { title?: string; subtitle?: string };

type BarGraphProps = {
  /** Numeric data driving the bars (required). */
  values: number[];
  /** Category labels, index-aligned to values. */
  labels?: string[];
  /** Axis domain overrides — auto-nice when unset. */
  domain?: DomainConfig;
  /** Bar geometry: orientation, gap, padding, thickness, corner radius. */
  layout?: LayoutConfig;
  /** Color scheme (preset) + bar fill color(s). */
  appearance?: AppearanceConfig;
  grid?: GridConfig;
  baseline?: ToggleConfig;
  valueAxis?: ToggleConfig;
  valueLabels?: ValueLabelsConfig;
  /** Chart title + subtitle. */
  titles?: TitlesConfig;
  /** Reveal mode (premium/light) + intro timing + reduceMotion. */
  anim?: AnimConfig;
  /**
   * Opt-in producer theming (mirrors line-chart/v1). The local `preset` selects
   * the fallback `Tokens` pack; `theme` layers a producer's published tokens over
   * it via `resolveThemeTokens`. `props.theme` (producer) wins over `appearance.preset`
   * (the resolver merges `published ← fallback`); explicit color props still win
   * over both. Absent → the preset pack renders byte-identically.
   */
  theme?: ThemeSourceConfig;
  /** Dev-only layout contract: assert bars equal-thickness + text fits its slot. */
  debugLayout?: boolean;
};

// ---------------------------------------------------------------------------
// Defaults (code-level defaults are ALSO surfaced in defaultProps so the Make
// fields show the value that's actually rendered).
// ---------------------------------------------------------------------------

const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ORIENTATION: Orientation = "vertical";
const DEFAULT_PRESET: Preset = "neutral";
const DEFAULT_GAP = 0.18; // gap as a fraction of bar width (slider, resolution-independent)
const DEFAULT_PADDING = 72;
const DEFAULT_CORNER_RADIUS = 0.15;
const DEFAULT_BAR_COLOR = "#f97316";
const DEFAULT_GRID: GridConfig = { show: true, count: 5 };
const DEFAULT_BASELINE: ToggleConfig = { show: true };
const DEFAULT_VALUE_AXIS: ToggleConfig = { show: true };
const DEFAULT_VALUE_LABELS: ValueLabelsConfig = { show: true, format: "compact", decimals: 0, suffix: "" };
const DEFAULT_ANIM: AnimConfig = {
  intro: { durationSec: 1.1, delaySec: 0.1, staggerSec: 0.06, ease: "smoothstep" },
  reduceMotion: false,
};

// Vertical quantization for bar heights. Per-bar height units are rounded to a
// multiple of HEIGHT_STEP so each column's `[empty, bar]` split GCD-collapses
// (Q and HEIGHT_STEP share factors) — the DSL count stays small.
const Q = 100;
const HEIGHT_STEP = 4;

// ---------------------------------------------------------------------------
// Theme tokens (one pack per preset — merges v1's frame + text + line tokens)
// ---------------------------------------------------------------------------

type Tokens = {
  bg: MosaicColor; card: MosaicColor; border: MosaicColor; borderAlpha: number;
  bar: MosaicColor; title: MosaicColor; subtitle: MosaicColor; category: MosaicColor;
  tick: MosaicColor; grid: MosaicColor; gridOpacity: number; axis: MosaicColor; axisOpacity: number;
};

function tokensFor(preset: Preset): Tokens {
  switch (preset) {
    case "dark":
      return { bg: "#0b0f14", card: "#0f172a", border: "#ffffff", borderAlpha: 0.10, bar: "#f97316",
        title: "#f1f5f9", subtitle: "#94a3b8", category: "#cbd5e1", tick: "#94a3b8",
        grid: "#ffffff", gridOpacity: 0.12, axis: "#ffffff", axisOpacity: 0.45 };
    case "terminal":
      return { bg: "#050505", card: "#0b0b0b", border: "#22c55e", borderAlpha: 0.18, bar: "#22c55e",
        title: "#22c55e", subtitle: "#15803d", category: "#22c55e", tick: "#15803d",
        grid: "#22c55e", gridOpacity: 0.12, axis: "#22c55e", axisOpacity: 0.4 };
    case "glass":
      return { bg: "#0b0f14", card: "#111827", border: "#ffffff", borderAlpha: 0.12, bar: "#60a5fa",
        title: "#f1f5f9", subtitle: "#cbd5e1", category: "#cbd5e1", tick: "#94a3b8",
        grid: "#ffffff", gridOpacity: 0.12, axis: "#ffffff", axisOpacity: 0.45 };
    case "paper":
      return { bg: "#f8fafc", card: "#ffffff", border: "#0f172a", borderAlpha: 0.10, bar: "#f97316",
        title: "#0f172a", subtitle: "#475569", category: "#334155", tick: "#64748b",
        grid: "#0f172a", gridOpacity: 0.10, axis: "#0f172a", axisOpacity: 0.4 };
    case "neutral":
    default:
      return { bg: "#0b0f14", card: "#0f172a", border: "#ffffff", borderAlpha: 0.10, bar: "#f97316",
        title: "#f1f5f9", subtitle: "#94a3b8", category: "#cbd5e1", tick: "#94a3b8",
        grid: "#ffffff", gridOpacity: 0.12, axis: "#ffffff", axisOpacity: 0.45 };
  }
}

/**
 * Map the selected preset's flat `Tokens` onto the 21-key `MosaicThemeTokens`
 * (the `resolveThemeTokens` fallback), mirroring line-chart/v1's
 * `localThemeFromPreset`. Keys bar-graph actually READS carry their exact preset
 * value verbatim (marked ✓ — so an unthemed render is byte-identical); the rest
 * are defensible locals never read. `borderAlpha` stays a local (no theme key for
 * a border opacity); `props.cornerRadius` owns the card radius (so `radius` is a
 * placeholder). Do NOT import the producer's resolver into the fallback — that
 * couples to a preset and risks drift breaking byte-identity.
 */
function localThemeFromTokens(tk: Tokens): MosaicThemeTokens {
  return {
    surfaceApp: tk.bg,        // ✓ canvas behind the card (doc backgroundColor)
    surface: tk.card,         // ✓ card surface
    surfaceRaised: tk.card,   // ✗
    surfaceInset: tk.bg,      // ✗
    border: tk.border,        // ✓ card inner stroke color
    borderStrong: tk.border,  // ✗
    textPrimary: tk.title,    // ✓ title + value labels
    textSecondary: tk.subtitle, // ✓ subtitle
    textMuted: tk.category,   // ✓ category (axis) labels
    eyebrow: tk.tick,         // ✓ tick-rail numbers
    accent: tk.bar,           // ✓ bar fill (== dataPalette[0])
    accentSoft: tk.bar,       // ✗
    accentGlow: tk.bar,       // ✗
    positive: "#16a34a",      // ✗ defensible local (unused)
    negative: "#dc2626",      // ✗ defensible local (unused)
    grid: tk.grid,            // ✓ gridlines
    gridAlpha: tk.gridOpacity, // ✓ gridline opacity
    axis: tk.axis,            // ✓ value-axis + baseline strips
    axisAlpha: tk.axisOpacity, // ✓ axis/baseline opacity
    radius: DEFAULT_CORNER_RADIUS, // ✗ (props.cornerRadius owns it)
    dataPalette: [tk.bar],    // ✓ bars (explicit barColor prop wins)
  };
}

// ---------------------------------------------------------------------------
// Pure helpers — domain (nice axis) + value formatting
// ---------------------------------------------------------------------------

type NiceAxis = { min: number; max: number; step: number; ticks: number[] };

function niceAxis(min: number, max: number, targetTicks: number): NiceAxis {
  if (max === min) return { min, max: max + 1, step: 1, ticks: [min, max + 1] };
  const range = Math.abs(max - min);
  const rawStep = range / Math.max(1, targetTicks - 1);
  const step = !Number.isFinite(rawStep) || rawStep <= 0 ? 1 : niceNum(rawStep, [1, 2, 2.5, 5]);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  const eps = step * 1e-6;
  for (let v = niceMin; v <= niceMax + eps; v += step) ticks.push(Number(v.toFixed(6)));
  return { min: niceMin, max: niceMax, step, ticks };
}

function formatCompact(n: number, decimals: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(decimals) + "T";
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(decimals) + "B";
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(decimals) + "M";
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(decimals) + "K";
  return sign + abs.toFixed(decimals);
}

function formatValue(value: number, cfg: ValueLabelsConfig, max: number): string {
  let base: string;
  switch (cfg.format) {
    case "raw": base = value.toFixed(cfg.decimals); break;
    case "percent": base = max === 0 ? (0).toFixed(cfg.decimals) + "%" : ((value / max) * 100).toFixed(cfg.decimals) + "%"; break;
    case "compact": default: base = formatCompact(value, cfg.decimals); break;
  }
  return cfg.suffix ? `${base}${cfg.suffix}` : base;
}

// ---------------------------------------------------------------------------
// Node combinators — build the m0 string and its sources together so source
// emission order always matches the DSL's DFS order. A `Node` is one cell's
// m0 plus the sources its painted leaves contribute (in order).
// ---------------------------------------------------------------------------

type Node = { m0: string; sources: MosaicSource[] };
type Band = { weight: number; node: Node };

const EMPTY: Node = { m0: "-", sources: [] };
const paint = (source: MosaicSource): Node => ({ m0: "F", sources: [source] });

// Cap on a single split's cell count. weightedSplit expands a weight `w` into
// `w` cells, so coprime pixel weights (GCD 1) would expand to their pixel sum.
// Scaling down to a small basis before weightedSplit bounds the DSL count AND
// tends to introduce a shared factor that GCD-collapses it further.
const SPLIT_BASIS_CAP = 120;

/** Weighted split along an axis; drops zero/neg-weight bands, collapses singletons. */
function split(axis: "row" | "col", bands: Band[]): Node {
  const bs = bands.filter((b) => b.weight > 0);
  if (bs.length === 0) return EMPTY;
  if (bs.length === 1) return bs[0].node;
  const weights = bs.map((b) => Math.max(1, Math.round(b.weight)));
  // Basis on the 5-smooth lattice (latticeWeights, @m0saic/template-utils):
  // over the cap the bands are Hamilton-scaled to EXACTLY the cap (GCD ⇒ a
  // divisor of it); a rough pixel sum under the cap drifts ≤ 1 px onto the
  // nearest smooth basis; a symmetric inset or an item/gutter list is rewritten
  // as the same pattern on a smooth total (every item stays equal to its
  // siblings); smooth, tiny and equal-weight splits keep their basis.
  const m0 = String(weightedSplit(latticeWeights(weights, { cap: SPLIT_BASIS_CAP }), axis, { claimants: bs.map((b) => b.node.m0) }));
  return { m0, sources: bs.flatMap((b) => b.node.sources) };
}
const rowSplit = (bands: Band[]): Node => split("row", bands);
const colSplit = (bands: Band[]): Node => split("col", bands);

/** Overlay layers as nested overlays: base{l1{l2{…}}}. Sources concat in order. */
function overlay(layers: Node[]): Node {
  const ls = layers.filter((l) => l.sources.length > 0 || l.m0 !== "-");
  if (ls.length === 0) return EMPTY;
  if (ls.length === 1) return ls[0];
  let m0 = ls[ls.length - 1].m0;
  for (let i = ls.length - 2; i >= 0; i--) m0 = `${ls[i].m0}{${m0}}`;
  return { m0, sources: ls.flatMap((l) => l.sources) };
}

/** Wrap a node in empty margins so it occupies an inset rect of the parent. */
function insetNode(node: Node, top: number, right: number, bottom: number, left: number, W: number, H: number): Node {
  const mid = colSplit([{ weight: left, node: EMPTY }, { weight: W - left - right, node }, { weight: right, node: EMPTY }]);
  return rowSplit([{ weight: top, node: EMPTY }, { weight: H - top - bottom, node: mid }, { weight: bottom, node: EMPTY }]);
}

// ---------------------------------------------------------------------------
// Leaf sources
// ---------------------------------------------------------------------------

type HAlign = "left" | "center" | "right";
type VAlign = "top" | "middle" | "bottom";

function textCell(text: string, fontSize: number, color: MosaicColor, hAlign: HAlign = "center", vAlign: VAlign = "middle", padding?: { top?: number; right?: number; bottom?: number; left?: number }, overlay?: { startAtSec?: number; alpha?: string; enable?: string }): MosaicTextSource {
  const placement: any = { fit: "contain", hAlign, vAlign };
  if (padding) placement.padding = padding;
  const src: any = { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement }] };
  if (overlay) src.overlay = overlay;
  return src as MosaicTextSource;
}

function titleSubtitleCell(opts: { title?: string; subtitle?: string; titleFont: number; subFont: number; titleColor: MosaicColor; subColor: MosaicColor }): MosaicTextSource {
  const layers: any[] = [];
  if (opts.title) layers.push({ content: { kind: "literal", text: opts.title }, style: { fontSize: opts.titleFont, fontColor: opts.titleColor }, placement: { fit: "contain", hAlign: "center", vAlign: opts.subtitle ? "top" : "middle" } });
  if (opts.subtitle) layers.push({ content: { kind: "literal", text: opts.subtitle }, style: { fontSize: opts.subFont, fontColor: opts.subColor }, placement: { fit: "contain", hAlign: "center", vAlign: opts.title ? "bottom" : "middle" } });
  // Each layer binds its own prop; with both present Make opens the header
  // as a stacked Title / Subtitle form.
  const src = tag({ type: "text", visual: { backgroundColor: "black@0" }, layers } as MosaicTextSource, "chart-header");
  if (opts.title && opts.subtitle) return bindProps(src, [{ propKey: "titles.title", layer: 0 }, { propKey: "titles.subtitle", layer: 1 }]);
  return bindProp(src, opts.title ? "titles.title" : "titles.subtitle");
}

function easeExpr(ease: EaseName, u: string): string {
  if (ease === "linear") return u;
  return `(${u})*(${u})*(3-2*(${u}))`; // smoothstep / easeInOut
}

/**
 * One grow-in bar — a single `color=` source that slides in from the baseline
 * edge to fill its rect. ffmpeg `overlay` composites onto the full canvas (no
 * frame clip), so the still-growing tile WOULD spill past the baseline — the
 * PLOT is wrapped in a nested child doc whose cell-sized buffer clips that
 * overflow at the baseline (see `wrapAsChild`). The not-yet-filled region
 * reveals the card beneath. Static (reduceMotion) → a plain fill, no overlay.
 * The gap between bars is structural (empty bands), NOT a placement inset — the
 * grow overlay positions the tile in the full cell and would ignore an inset.
 *
 * The grow SLIDE (`x/yExpr`) is a free scalar position expression either way.
 * `fade` (renderMode `premium`) adds a time-varying `overlay.alpha` on top — a
 * softer reveal, but a per-pixel geq with no active window (see `RenderMode`);
 * `light` omits it (opaque grow), leaving the slide only.
 */
function barNode(color: MosaicColor, index: number, startAtSec: number, durSec: number, ease: EaseName, reduceMotion: boolean, fade: boolean, fillAxis: "x" | "y" = "y", insetFrac = 0): Node {
  // Half-gap carved INSIDE each equal band (gap-as-inset, the alpine-proven
  // rung 3/5): the tile paints only the bar's slice of its band, so bar
  // thickness = band × one shared fraction — equal everywhere the equal split
  // is. (The old "the grow overlay would ignore an inset" comment was wrong:
  // alpine/bar-graph/v1 ships grow+inset through the full production gate.)
  const placement = insetFrac > 0
    ? { placement: { inset: fillAxis === "y" ? { x: insetFrac } : { y: insetFrac } } }
    : {};
  // The bar itself binds `values[index]` — tall bars give up their value-label
  // band, so the bar is the double-click handle for the value.
  if (reduceMotion) return paint(bindProp(tag(makeColorTile(color, { ...placement }) as MosaicSource, "bar"), "values", index));
  const eased = easeExpr(ease, u01(durSec));
  let overlay;
  if (fade) {
    overlay = fillAxis === "y"
      ? { startAtSec, alpha: eased, yExpr: `h*(1-(${eased}))` }     // grow up + fade
      : { startAtSec, alpha: eased, xExpr: `-(w*(1-(${eased})))` }; // grow right + fade
  } else {
    overlay = fillAxis === "y"
      ? { startAtSec, yExpr: `h*(1-(${eased}))` }     // grow up (opaque)
      : { startAtSec, xExpr: `-(w*(1-(${eased})))` }; // grow right (opaque)
  }
  return paint(bindProp(tag(makeColorTile(color, { overlay, ...placement }) as MosaicSource, "bar"), "values", index));
}

/** Per-side inset fraction that carves `gapRatio` (gap : bar thickness) out of
 *  an equal band: pitch = barW·(1+g) ⇒ half-gap each side = g/(2(1+g)). */
const gapInsetFrac = (gapRatio: number): number => gapRatio / (2 * (1 + gapRatio));

/** Thin full-cell overlay strip pinned to one edge (baseline / value-axis). */
function edgeStrip(color: MosaicColor, opacity: number, edge: "top" | "bottom" | "left" | "right"): MosaicLavfiSource {
  const horizontal = edge === "top" || edge === "bottom";
  return {
    type: "lavfi", color, fitMode: "content", visual: { opacity },
    size: horizontal ? { wExpr: "TW", hExpr: "max(1,TH*0.004)" } : { wExpr: "max(1,TW*0.004)", hExpr: "TH" },
    placement: { fit: "contain", hAlign: edge === "left" ? "left" : edge === "right" ? "right" : "center", vAlign: edge === "top" ? "top" : edge === "bottom" ? "bottom" : "middle" },
  };
}

/** Round to a multiple of `step` (>= step). */
const snap = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

/**
 * Left value-axis tick rail: M formatted numbers top→bottom, evenly spaced so
 * their centers line up (approximately) with the gridlines. Small tick bands
 * separated by large gaps — right-aligned with a touch of right padding so the
 * numbers sit just inside the plot's left edge.
 */
function tickRailNode(labels: string[], fontSize: number, color: MosaicColor, axis: "row" | "col", tickWeight = 3): Node {
  // axis "row" = vertical rail (left of plot): right-aligned, small right pad.
  // axis "col" = horizontal rail (below plot): centered, pinned to the top edge.
  const mk = (t: string): Node => axis === "row"
    ? paint(tag(textCell(t, fontSize, color, "right", "middle", { right: 0.18 }), "axis-tick"))
    : paint(tag(textCell(t, fontSize, color, "center", "top"), "axis-tick"));
  const M = labels.length;
  if (M <= 1) return mk(labels[0] ?? "");
  const GAP = 20;
  const bands: Band[] = [];
  for (let i = 0; i < M; i++) {
    bands.push({ weight: tickWeight, node: mk(labels[i]) });
    if (i < M - 1) bands.push({ weight: GAP, node: EMPTY });
  }
  return split(axis, bands);
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

// Schema-field helpers for grouped sub-fields (mirrors the theme-consumer chart pack).
const fBool = (label: string, description = ""): any => ({ type: "boolean", required: false, description, meta: { ui: { label } } });
const fStr = (label: string, description = "", placeholder?: string): any => ({ type: "string", required: false, description, meta: { ui: { label }, ...(placeholder ? { control: { placeholder } } : {}) } });
const fNum = (label: string, description = "", control?: any, constraints?: any): any => ({ type: "number", required: false, description, meta: { ...(constraints ? { constraints } : {}), ...(control ? { control } : {}), ui: { label } } });
const fFrac = (label: string, description = "", placeholder?: string): any => fNum(label, description, { flavor: "slider", step: 0.01, ...(placeholder ? { placeholder } : {}) }, { min: 0, max: 1 });
const fEnum = (label: string, options: string[], description = ""): any => ({ type: "string", required: false, description, meta: { constraints: { oneOf: options }, ui: { label } } });

const propsSchema = definePropsSchema<BarGraphProps>({
  // Primary data — always visible up top.
  values: { type: "number[]", required: true, description: "Numeric data values driving the chart bars.", meta: { constraints: { minItems: 1 }, control: { flavor: "numberList" }, ui: { label: "Values", order: 1 } } },
  labels: { type: "string[]", required: false, description: "Category labels (index-aligned to values).", meta: { ui: { label: "Category Labels", order: 2, primary: true } } },

  // Everything else grouped into collapsible sections (declaration order = display order).
  domain: {
    type: "group" as any, required: false, description: "Value-axis domain overrides — leave unset to auto-fit to nice round numbers.",
    meta: { ui: { label: "Domain", order: 3, collapsedByDefault: true } },
    fields: {
      minValue: fNum("Min Value", "Explicit domain minimum. Auto (0 / nice) when unset."),
      maxValue: fNum("Max Value", "Explicit domain maximum. Auto (nice max) when unset.", { placeholder: "data max" }),
    },
  } as any,
  layout: {
    type: "group" as any, required: false, description: "Bar geometry: orientation, spacing, thickness, corner radius.",
    meta: { ui: { label: "Layout", order: 4, collapsedByDefault: true } },
    fields: {
      orientation: fEnum("Orientation", ["vertical", "horizontal"], "Vertical bars grow up; horizontal bars grow right."),
      gap: fFrac("Gap", "Gap between bars as a fraction of bar width (0 = flush, 1 = gap as wide as a bar)."),
      padding: fNum("Padding (px)", "Outer padding in pixels (symmetric).", undefined, { min: 0, max: 512 }),
      barThickness: fNum("Bar Thickness (px)", "Optional fixed bar thickness in px. Bars share space evenly when unset.", { placeholder: "auto (from gap)" }, { min: 1, max: 4096 }),
      cornerRadius: fFrac("Corner Radius", "Card corner-radius fraction (0..1)."),
    },
  } as any,
  appearance: {
    type: "group" as any, required: false, description: "Color scheme (preset) + bar fill color(s).",
    meta: { ui: { label: "Appearance", order: 5, collapsedByDefault: true } },
    fields: {
      preset: fEnum("Preset", ["neutral", "dark", "terminal", "glass", "paper"], "Built-in color scheme (card / bars / text / grid / axis)."),
      barColor: { type: "json" as never, required: false, description: "Bar fill — a single color, or an array of per-bar colors (cycled in bar order).", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Bar Color" } } },
    },
  } as any,
  grid: {
    type: "group" as any, required: false, description: "Gridlines behind the bars.",
    meta: { ui: { label: "Grid", order: 6, collapsedByDefault: true } },
    fields: { show: fBool("Show", "Draw gridlines."), count: fNum("Count", "Number of gridline intervals.", undefined, { min: 1, max: 20 }) },
  } as any,
  baseline: {
    type: "group" as any, required: false, description: "Baseline rule at the bars' anchor edge.",
    meta: { ui: { label: "Baseline", order: 7, collapsedByDefault: true } },
    fields: { show: fBool("Show", "Draw the baseline rule.") },
  } as any,
  valueAxis: {
    type: "group" as any, required: false, description: "Value-axis rule at the max-value side.",
    meta: { ui: { label: "Value Axis", order: 8, collapsedByDefault: true } },
    fields: { show: fBool("Show", "Draw the value-axis rule.") },
  } as any,
  valueLabels: {
    type: "group" as any, required: false, description: "Per-bar value labels.",
    meta: { ui: { label: "Value Labels", order: 9, collapsedByDefault: true } },
    fields: {
      show: fBool("Show", "Print each bar's value."),
      format: fEnum("Format", ["raw", "percent", "compact"], "raw = as-is; percent = share of max; compact = 1.2k."),
      decimals: fNum("Decimals", "Decimal places.", undefined, { min: 0, max: 6 }),
      suffix: fStr("Suffix", "Appended to each value (e.g. \"%\", \" MB\")."),
    },
  } as any,
  titles: {
    type: "group" as any, required: false, description: "Chart title + subtitle.",
    meta: { ui: { label: "Titles", order: 10, collapsedByDefault: true } },
    fields: {
      title: { type: "string", required: false, description: "Chart title.", meta: { control: { placeholder: "e.g., Monthly Sales" }, ui: { label: "Title" } } },
      subtitle: { type: "string", required: false, description: "Chart subtitle.", meta: { control: { placeholder: "e.g., Q4 2024" }, ui: { label: "Subtitle" } } },
    },
  } as any,
  anim: {
    type: "group" as any, required: false, description: "Reveal mode + intro animation.",
    meta: { ui: { label: "Animation", order: 11, collapsedByDefault: true } },
    fields: {
      renderMode: fEnum("Render Mode", ["premium", "light"], "\"premium\" (default): bars + labels fade in — premium, but the alpha is a per-pixel geq paid on every frame of a nesting parent's whole timeline. \"light\": opaque grow + enable-gated label pop — no geq, composable, cheap when nested."),
      reduceMotion: fBool("Reduce Motion", "Skip motion; render the final static frame."),
      intro: {
        type: "group", required: false, description: "Intro grow-in timing.",
        meta: { ui: { label: "Intro", collapsedByDefault: true } },
        fields: {
          durationSec: fNum("Duration (s)", "Per-bar grow duration."),
          delaySec: fNum("Delay (s)", "Delay before the first bar starts."),
          staggerSec: fNum("Stagger (s)", "Gap between consecutive bars' start times."),
          ease: fEnum("Ease", ["linear", "smoothstep", "easeInOut"], "Grow-in easing curve."),
        },
      },
    },
  } as any,
  theme: {
    type: "group" as any,
    required: false,
    description: "Opt into a theme source. Uses the local preset palette by default; set a producer slug + namespace to pull shared design tokens (self-seeds when nothing is upstream). Explicit color props still win.",
    meta: { ui: { label: "Theme", order: 12, collapsedByDefault: true } },
    fields: {
      slug: fStr("Producer slug", "Producer template to seed tokens from when the namespace isn't already on ctx (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"),
      preset: fStr("Preset", "Producer preset/variant to request (e.g. light | dark | high-contrast for @m0saic/theming/v1; producer-defined).", "producer default"),
      namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"),
      forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is already populated."),
    },
  } as any,
  debugLayout: { type: "boolean", required: false, description: "Dev-only: draw the layout contract (bars equal-thickness, text fits its slot) instead of the chart.", meta: { ui: { label: "Debug layout", order: 13 } } },
});

export const ChartsBarGraphV2: MosaicTemplate<BarGraphProps> = {
  id: asTemplateId("@m0saic/charts/bar-graph/v2"),
  label: "Bar Graph",
  version: 2,
  description: "Canonical bar graph data-viz primitive (tight-rect geometry): vertical/horizontal, labels, presets, intro animation.",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "bar-graph", "animated", "analysts", "marketers", "report"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1920, height: 1080, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    domain: { minValue: 0 },
    debugLayout: false,
    theme: { forceFetch: false },
    values: [35, 60, 85, 45, 70],
    labels: ["Jan", "Feb", "Mar", "Apr", "May"],
    layout: { orientation: DEFAULT_ORIENTATION, gap: DEFAULT_GAP, padding: DEFAULT_PADDING, barThickness: undefined, cornerRadius: DEFAULT_CORNER_RADIUS },
    appearance: { preset: DEFAULT_PRESET, barColor: DEFAULT_BAR_COLOR },
    grid: DEFAULT_GRID,
    baseline: DEFAULT_BASELINE,
    valueAxis: DEFAULT_VALUE_AXIS,
    valueLabels: DEFAULT_VALUE_LABELS,
    anim: { renderMode: DEFAULT_RENDER_MODE, ...DEFAULT_ANIM },
  },

  async render(props: BarGraphProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    if (!Array.isArray(props.values) || props.values.length === 0) {
      return Promise.resolve(makeErrorMosaic("values[] must be non-empty", { title: `${this.id} props`, width: W, height: H }));
    }
    // Grouped prop sub-objects → locals (the Make panel nests these as collapsible groups).
    const layout: LayoutConfig = props.layout ?? {};
    const appearance: AppearanceConfig = props.appearance ?? {};
    const domainCfg: DomainConfig = props.domain ?? {};
    const titles: TitlesConfig = props.titles ?? {};

    const orientation = layout.orientation ?? DEFAULT_ORIENTATION;

    const tokens = tokensFor(appearance.preset ?? DEFAULT_PRESET);
    // Theming: the preset pack is the fallback; a producer's published tokens
    // (ctx.upstreamData["theme"] / seeded from theme.slug) override per-key.
    // Unthemed → returns the fallback unchanged (byte-identical). `borderAlpha`
    // has no theme key, so it stays read off `tokens`.
    const theme = await resolveThemeTokens(localThemeFromTokens(tokens), ctx, props.theme);
    const gapRatio = Math.max(0, layout.gap ?? DEFAULT_GAP); // fraction of bar width
    const pad = layout.padding ?? DEFAULT_PADDING;
    const cornerRadius = layout.cornerRadius ?? DEFAULT_CORNER_RADIUS;
    const baseline = { ...DEFAULT_BASELINE, ...(props.baseline ?? {}) };
    const valueAxis = { ...DEFAULT_VALUE_AXIS, ...(props.valueAxis ?? {}) };
    const grid = { ...DEFAULT_GRID, ...(props.grid ?? {}) };
    const valueLabels = { ...DEFAULT_VALUE_LABELS, ...(props.valueLabels ?? {}) };
    const anim = { intro: { ...DEFAULT_ANIM.intro, ...(props.anim?.intro ?? {}) }, reduceMotion: props.anim?.reduceMotion ?? false };
    // Reveal strategy: `premium` (default) fades bars + labels via `overlay.alpha`
    // (premium, geq — see `RenderMode`); `light` omits the alpha (opaque grow +
    // enable-gated label pop — composable, cheap when nested).
    const fade = (props.anim?.renderMode ?? DEFAULT_RENDER_MODE) === "premium";
    const values = props.values;
    const N = values.length;

    const palette: MosaicColor[] = Array.isArray(appearance.barColor)
      ? (appearance.barColor.length ? (appearance.barColor as MosaicColor[]) : theme.dataPalette)
      : [(appearance.barColor as MosaicColor) ?? theme.dataPalette[0]];
    const barColorAt = (i: number): MosaicColor => palette[i % palette.length];

    // ── Domain (nice axis when a bound is auto) ──
    const rawMin = domainCfg.minValue ?? 0;
    const rawMax = domainCfg.maxValue ?? Math.max(...values);
    const explicit = domainCfg.minValue != null && domainCfg.maxValue != null;
    let minValue = rawMin, maxValue = rawMax;
    let gridCount = Math.max(1, grid.count);
    if (!explicit) {
      const nice = niceAxis(rawMin, rawMax, grid.count + 1);
      minValue = nice.min; maxValue = nice.max;
      // Keep gridlines + tick rail in lockstep with the nice tick count so they
      // land on round numbers (0/20/40/…) rather than raw domain fractions.
      gridCount = Math.max(1, nice.ticks.length - 1);
    }
    const denom = maxValue - minValue;
    const fractions = values.map((v) => (denom === 0 ? 1 : Math.max(0, Math.min(1, (v - minValue) / denom))));

    const contentW = W - 2 * pad;
    const contentH = H - 2 * pad;
    if (contentW < 16 || contentH < 16) {
      return Promise.resolve(makeErrorMosaic("padding consumes the whole canvas", { title: `${this.id}`, width: W, height: H }));
    }

    // ── Fonts + bands (pixels; outer split weights GCD-reduce) ──
    // Header fonts WIDTH-CAP to the content (0.72em all-caps-ish, script-aware
    // textEmUnits): the center-aligned header clipped BOTH edges at hostile
    // canvases ("КАЗАТЕЛИ КОМАН", gate-14 baseline). Binds only on overflow.
    const capHdr = (px: number, text: string | undefined, min: number): number =>
      Math.max(min, Math.min(px, Math.floor((contentW * 0.96) / (Math.max(1, textEmUnits(text ?? "")) * 0.72))));
    const titleFont = capHdr(Math.max(12, Math.round(H * 0.046)), titles.title, 12);
    const subFont = capHdr(Math.max(10, Math.round(H * 0.022)), titles.subtitle, 10);
    const catFont = Math.max(10, Math.round(H * 0.018));
    const valueFont = Math.max(10, Math.round(H * 0.02));
    const tickFont = Math.max(9, Math.round(H * 0.016));

    const hasTitle = !!(titles.title && titles.title.trim());
    const hasSubtitle = !!(titles.subtitle && titles.subtitle.trim());
    const hasTitleBand = hasTitle || hasSubtitle;
    const titleBandH = hasTitleBand ? Math.round((hasSubtitle ? titleFont * 1.2 + subFont * 1.5 : titleFont * 1.5) + H * 0.012) : 0;
    const hasLabels = !!(props.labels && props.labels.length > 0);
    const catBandH = hasLabels ? Math.round(catFont * 1.9) : 0;

    // Script-aware longest strings (shared by both orientations' caps).
    const longestCatU = hasLabels ? Math.max(1, ...props.labels!.map((l) => textEmUnits(l ?? ""))) : 1;
    const longestValU = Math.max(1, ...values.map((v) => textEmUnits(formatValue(v, valueLabels, maxValue))));
    let anyValueLabel = false;

    const titleNode: Node = hasTitleBand
      ? paint(titleSubtitleCell({ title: hasTitle ? titles.title : undefined, subtitle: hasSubtitle ? titles.subtitle : undefined, titleFont, subFont, titleColor: theme.textPrimary, subColor: theme.textSecondary }))
      : EMPTY;

    let contentNode: Node;

    // The plot is wrapped in a nested child doc so its cell-sized buffer CLIPS
    // the grow-in bars at the plot edges (ffmpeg overlay otherwise composites
    // onto the full canvas, so a translating bar would spill past the baseline).
    // One child for the whole plot — far less nesting than v1's per-bar docs.
    const childDocs: Record<string, MosaicDocument> = {};
    const wrapAsChild = (key: string, node: Node): Node => {
      childDocs[key] = {
        kind: "mosaic_document", version: 1, assets: {} as any,
        m0: node.m0 as any, sources: node.sources, fps: ctx.target.fps, durationMs: ctx.target.durationMs,
      } as MosaicDocument;
      return { m0: "F", sources: [{ type: "mosaic", ref: key } as unknown as MosaicSource] };
    };

    if (orientation === "vertical") {
    const plotH = contentH - titleBandH - catBandH;
    if (plotH < 8) {
      return Promise.resolve(makeErrorMosaic("plot area too small after bands", { title: `${this.id}`, width: W, height: H }));
    }

    // Tick rail reserves a left column; the plot (bars + gridlines) takes the rest.
    const hasTicks = grid.show && gridCount >= 1;
    const tickRailW = hasTicks ? Math.max(Math.round(contentW * 0.06), tickFont * 3) : 0;
    const plotW = contentW - tickRailW;
    if (plotW < 4) {
      return Promise.resolve(makeErrorMosaic("plot area too narrow after the tick rail", { title: `${this.id}`, width: W, height: H }));
    }

    // ── Bars: one EQUAL band per bar, half-gap carved INSIDE via a shared
    // placement.inset on the tile (gap-as-inset). The old interleaved
    // [margin, bar, gap, …] px stack let the engine's outside-in remainder
    // spread bar widths up to 50% (18 vs 36px at 360×640 — the equal-width
    // tripwire's catch, the same class alpine/bar-graph/v1 fixed). ──
    const cellW = plotW / N;
    const insetXV = layout.barThickness != null
      ? Math.max(0, (1 - Math.min(1, layout.barThickness / cellW)) / 2)
      : gapInsetFrac(gapRatio);
    const barWpx = cellW * (1 - 2 * insetXV);
    const gapPx = cellW - barWpx;
    // Caps to the column pitch (script-aware): uncapped labels shredded at
    // high N ("ry|ry|ry…", gate-14 baseline). Floor-bound cats ellipsize.
    const catFontV = hasLabels ? Math.max(9, Math.min(catFont, Math.floor(((barWpx + gapPx) * 0.94) / (longestCatU * 0.62)))) : catFont;
    const fitCatV = (t: string): string => fitEmUnits(t, Math.max(2, ((barWpx + gapPx) * 0.94) / (catFontV * 0.62)));
    const valueFontV = Math.max(9, Math.min(valueFont, Math.floor(((barWpx + gapPx) * 0.9) / (longestValU * 0.62))));
    const labelU = valueLabels.show ? snap((valueFontV * 1.4 / plotH) * Q, HEIGHT_STEP) : 0;

    const columnBands = (nodeFor: (i: number) => Node): Band[] =>
      Array.from({ length: N }, (_, i): Band => ({ weight: 1, node: nodeFor(i) }));

    const barColumn = (i: number): Node => {
      let h = snap(fractions[i] * Q, HEIGHT_STEP);
      h = Math.min(Q - HEIGHT_STEP, Math.max(HEIGHT_STEP, h));
      const barStart = anim.intro.delaySec + i * anim.intro.staggerSec;
      const dur = anim.intro.durationSec;
      // Value label reveal at the bar's half-growth mark: `premium` fades it in
      // over the back half (lands as the bar arrives, not floating from t=0);
      // `light` enable-gates it to pop at that same moment (no alpha geq).
      const labelOverlay = anim.reduceMotion
        ? undefined
        : fade
          ? { startAtSec: barStart + dur * 0.5, alpha: u01(Math.max(0.1, dur * 0.5)) } // premium: fade in
          : { enable: `gte(t,${(barStart + dur * 0.5).toFixed(3)})` };                 // light: enable-gate pop
      // Column top → optional value-label band → bar. The label sits just above
      // the bar's final top; tall bars give up the label band so the bar wins.
      const topU = Q - h;
      const labU = labelU > 0 && topU > labelU ? labelU : 0;
      if (labU > 0) anyValueLabel = true;
      return rowSplit([
        { weight: topU - labU, node: EMPTY },
        ...(labU > 0 ? [{ weight: labU, node: paint(bindProp(tag(textCell(formatValue(values[i], valueLabels, maxValue), valueFontV, theme.textPrimary, "center", "bottom", undefined, labelOverlay), "value-label"), "values", i)) }] : []),
        { weight: h, node: barNode(barColorAt(i), i, barStart, dur, anim.intro.ease, anim.reduceMotion, fade, "y", insetXV) },
      ]);
    };
    const barsNode = colSplit(columnBands(barColumn));

    // ── Plot = gridlines (back) → bars → value-axis + baseline edge strips ──
    // Each gridline is its OWN overlay layer (flattened into one nested chain,
    // not pre-stacked — a pre-stacked `F{F{…}}` used as an overlay base would
    // form an illegal overlay chain `A{B}{C}`).
    // Gridlines include the MAX edge (top) as a normal line but skip the zero
    // edge (bottom) — the baseline covers it. `.slice(1)` drops the i=0 (bottom)
    // line that excludeEdges:false emits first.
    const gridSources = grid.show && gridCount > 1
      ? buildGridlineSources({ direction: "horizontal", count: gridCount, excludeEdges: false, origin: "bottom", color: theme.grid, opacity: theme.gridAlpha, thicknessFrac: 0.0025 }).slice(1)
      : [];
    const plotLayers: Node[] = [...gridSources.map((s) => paint(s)), barsNode];
    // Conventional L-axes: value axis along the tick edge (left), baseline at zero (bottom).
    if (valueAxis.show) plotLayers.push(paint(edgeStrip(theme.axis, theme.axisAlpha, "left")));
    if (baseline.show) plotLayers.push(paint(edgeStrip(theme.axis, theme.axisAlpha, "bottom")));
    const plotNode = overlay(plotLayers);

    // ── Tick rail (M = gridCount+1 values, top = max → bottom = min) ──
    const tickLabelsV = Array.from({ length: gridCount + 1 }, (_v, i) => formatValue(maxValue - (i / gridCount) * (maxValue - minValue), valueLabels, maxValue));
    const longestTickUV = Math.max(1, ...tickLabelsV.map((t) => textEmUnits(t)));
    const tickFontV = Math.max(8, Math.min(tickFont, Math.floor((tickRailW * 0.78) / (longestTickUV * 0.62))));
    const tickRail: Node = hasTicks
      ? tickRailNode(tickLabelsV, tickFontV, theme.eyebrow, "row")
      : EMPTY;

    // Body row: [tick rail | plot]. The plot is a clipping child doc.
    const plotRef = wrapAsChild("plot", plotNode);
    const bodyNode = tickRailW > 0 ? colSplit([{ weight: tickRailW, node: tickRail }, { weight: plotW, node: plotRef }]) : plotRef;

    // ── Category labels (offset under the plot, same column bands as bars) ──
    const catLabels = hasLabels
      ? colSplit(columnBands((i) => paint(bindProp(tag(textCell(fitCatV(props.labels![i] ?? ""), catFontV, theme.textMuted, "center", "middle"), "cat-label"), "labels", i))))
      : EMPTY;
    const catNode = hasLabels && tickRailW > 0
      ? colSplit([{ weight: tickRailW, node: EMPTY }, { weight: plotW, node: catLabels }])
      : catLabels;

    // ── Content bands: title / body / category ──
    contentNode = rowSplit([
      { weight: titleBandH, node: titleNode },
      { weight: plotH, node: bodyNode },
      { weight: catBandH, node: catNode },
    ]);

    } else {
    // ════════════════════ HORIZONTAL ════════════════════
    // Bars grow rightward from a left baseline, stacked top→bottom. Category
    // labels sit in a left rail; value ticks run along the bottom; gridlines
    // are vertical. Mirrors the vertical layout with x/y roles swapped.
    const hasTicksH = grid.show && gridCount >= 1;
    const tickBandH = hasTicksH ? Math.round(tickFont * 1.8) : 0;
    const catRailW = hasLabels ? Math.max(Math.round(contentW * 0.10), catFont * 4) : 0;
    const bodyH = contentH - titleBandH - tickBandH;
    const plotW = contentW - catRailW;
    if (bodyH < 8 || plotW < 8) {
      return Promise.resolve(makeErrorMosaic("plot area too small after bands", { title: `${this.id}`, width: W, height: H }));
    }

    // One EQUAL band per bar, half-gap carved inside (gap-as-inset — see the
    // vertical branch for why the interleaved px stack was replaced).
    const cellH = bodyH / N;
    const insetYH = layout.barThickness != null
      ? Math.max(0, (1 - Math.min(1, layout.barThickness / cellH)) / 2)
      : gapInsetFrac(gapRatio);
    const barHpx = cellH * (1 - 2 * insetYH);
    const gapHpx = cellH - barHpx;
    // Cat rail cap (script-aware, 0.86 of the rail) + a value-label gutter
    // sized to the LONGEST formatted value (the old flat 2.4em band clipped
    // anything past ~4 chars). Floor-bound cats ellipsize.
    const catFontH = hasLabels ? Math.max(9, Math.min(catFont, Math.floor((catRailW * 0.86) / (longestCatU * 0.62)))) : catFont;
    const fitCatH = (t: string): string => fitEmUnits(t, Math.max(2, (catRailW * 0.86) / (catFontH * 0.62)));
    const labelUw = valueLabels.show ? Math.min(40, snap(((valueFont * (longestValU * 0.62 + 0.8)) / plotW) * Q, HEIGHT_STEP)) : 0;

    const rowBands = (nodeFor: (i: number) => Node): Band[] =>
      Array.from({ length: N }, (_, i): Band => ({ weight: 1, node: nodeFor(i) }));

    const barRow = (i: number): Node => {
      let w = snap(fractions[i] * Q, HEIGHT_STEP);
      w = Math.min(Q - HEIGHT_STEP, Math.max(HEIGHT_STEP, w));
      const barStart = anim.intro.delaySec + i * anim.intro.staggerSec;
      const dur = anim.intro.durationSec;
      const labelOverlay = anim.reduceMotion
        ? undefined
        : fade
          ? { startAtSec: barStart + dur * 0.5, alpha: u01(Math.max(0.1, dur * 0.5)) } // premium: fade in
          : { enable: `gte(t,${(barStart + dur * 0.5).toFixed(3)})` };                 // light: enable-gate pop
      // Bar (grows right) → optional value label just past its end → empty rest.
      const restU = Q - w;
      const labW = labelUw > 0 && restU > labelUw ? labelUw : 0;
      if (labW > 0) anyValueLabel = true;
      return colSplit([
        { weight: w, node: barNode(barColorAt(i), i, barStart, dur, anim.intro.ease, anim.reduceMotion, fade, "x", insetYH) },
        ...(labW > 0 ? [{ weight: labW, node: paint(bindProp(tag(textCell(formatValue(values[i], valueLabels, maxValue), valueFont, theme.textPrimary, "left", "middle", { left: 0.15 }, labelOverlay), "value-label"), "values", i)) }] : []),
        { weight: restU - labW, node: EMPTY },
      ]);
    };
    const barsNode = rowSplit(rowBands(barRow));

    // Vertical gridlines: include the MAX edge (right) as a normal line, skip the
    // zero edge (left) which the baseline covers (`.slice(1)` drops the i=0 line).
    const gridSources = grid.show && gridCount > 1
      ? buildGridlineSources({ direction: "vertical", count: gridCount, excludeEdges: false, origin: "left", color: theme.grid, opacity: theme.gridAlpha, thicknessFrac: 0.0025 }).slice(1)
      : [];
    const plotLayers: Node[] = [...gridSources.map((s) => paint(s)), barsNode];
    // Conventional L-axes: value axis along the tick edge (bottom), baseline at zero (left).
    if (valueAxis.show) plotLayers.push(paint(edgeStrip(theme.axis, theme.axisAlpha, "bottom")));
    if (baseline.show) plotLayers.push(paint(edgeStrip(theme.axis, theme.axisAlpha, "left")));
    const plotNode = overlay(plotLayers);

    // Category rail (left): one label per bar row, aligned to the bar rows.
    const catRail: Node = hasLabels
      ? rowSplit(rowBands((i) => paint(bindProp(tag(textCell(fitCatH(props.labels![i] ?? ""), catFontH, theme.textMuted, "right", "middle", { right: 0.12 }), "cat-label"), "labels", i))))
      : EMPTY;
    const plotRef = wrapAsChild("plot", plotNode);
    const bodyNode = catRailW > 0 ? colSplit([{ weight: catRailW, node: catRail }, { weight: plotW, node: plotRef }]) : plotRef;

    // Tick band (bottom): values min (left) → max (right), aligned under the plot.
    const tickLabelsH = Array.from({ length: gridCount + 1 }, (_v, i) => formatValue(minValue + (i / gridCount) * (maxValue - minValue), valueLabels, maxValue));
    const longestTickUH = Math.max(1, ...tickLabelsH.map((t) => textEmUnits(t)));
    // The 3-unit tick slivers garble at narrow canvases (6px cells for 10px
    // text at 480 wide) — widen the cell just enough for the longest tick,
    // capping the font only when even a full-pitch cell can't hold it (the
    // alpine bar-graph block, ported).
    const MH = gridCount + 1;
    let tickFontH = tickFont;
    const maxNeedH = Math.floor(plotW / MH);
    let needH = Math.ceil(longestTickUH * 0.62 * tickFontH) + 2;
    if (needH > maxNeedH) { tickFontH = Math.max(8, Math.floor(maxNeedH / (longestTickUH * 0.62))); needH = Math.ceil(longestTickUH * 0.62 * tickFontH) + 2; }
    const cellPx3H = (plotW * 3) / (MH * 3 + (MH - 1) * 20);
    const TICKH = needH <= cellPx3H ? 3 : Math.min(60, Math.ceil((needH * (MH - 1) * 20) / Math.max(1, plotW - needH * MH)));
    const tickRail: Node = hasTicksH
      ? tickRailNode(tickLabelsH, tickFontH, theme.eyebrow, "col", TICKH)
      : EMPTY;
    const tickBandNode = hasTicksH && catRailW > 0 ? colSplit([{ weight: catRailW, node: EMPTY }, { weight: plotW, node: tickRail }]) : tickRail;

    contentNode = rowSplit([
      { weight: titleBandH, node: titleNode },
      { weight: bodyH, node: bodyNode },
      { weight: tickBandH, node: tickBandNode },
    ]);
    }

    // ── Card surface (full canvas; rounded corners reveal theme.surfaceApp) ──
    const cardNode = paint(makeColorTile(theme.surface, {
      effects: {
        rounding: { cornerStyle: "rounded", borderRadius: cornerRadius },
        stroke: { position: "inner", width: 0.002, color: theme.border, alpha: tokens.borderAlpha },
      },
    }));

    const root = overlay([cardNode, insetNode(contentNode, pad, pad, pad, pad, W, H)]);

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      sources: root.sources,
      ...(Object.keys(childDocs).length ? { children: childDocs } : {}),
      backgroundColor: theme.surfaceApp,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // Dev tripwire (the alpine bar-graph pattern, ported to the canonical
    // template): every bar the same thickness, every text group fits its slot
    // at the CLI's metrics. No expr text → full coverage. Falsy debugLayout
    // (default) returns the doc untouched at zero cost.
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/charts/bar-graph/v2",
        relations: N >= 2 ? [{ label: "bar", equal: orientation === "vertical" ? "width" : "height", tolerance: 0.02, tolerancePx: 1 }] : [],
        constraints: [
          ...(hasTitleBand ? [{ label: "chart-header", textFits: { charWidthEm: 0.72 } }] : []),
          ...(hasLabels ? [{ label: "cat-label", textFits: { charWidthEm: 0.62 } }] : []),
          // anyValueLabel, not valueLabels.show: max-tall bars legitimately
          // drop their label band (an unmatched label is a violation).
          ...(anyValueLabel ? [{ label: "value-label", textFits: { charWidthEm: 0.62 } }] : []),
          // padPx 0: the tick bands are sized-to-fit slivers.
          ...(grid.show && gridCount >= 1 ? [{ label: "axis-tick", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // template's own static default render, INLINED flat (gate-15/21 keeper).
  async renderCover(_props: BarGraphProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const hero = (await ChartsBarGraphV2.render(
      {
        ...(ChartsBarGraphV2.defaultProps as BarGraphProps),
        anim: { ...(ChartsBarGraphV2.defaultProps as BarGraphProps).anim, reduceMotion: true } as AnimConfig,
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "Bar Graph",
        title: "A bar chart.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(hero), theme.borderStrong),
      heroAssets: hero.assets,
      children: (hero as { children?: Record<string, MosaicDocument> }).children,
    });
  },
};

registerTemplate(ChartsBarGraphV2);
