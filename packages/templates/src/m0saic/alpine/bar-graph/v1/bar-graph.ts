import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/bar-graph/v1 — Alpine Bar Chart (friendly mobile-marketing)
 * ============================================================================
 *
 * The Alpine pack's horizontal bar chart. STANDALONE (not a re-skin of
 * `@m0saic/charts/bar-graph/v2`) — Alpine is its own brand flavor: a white
 * rounded card (via the shared `alpineCard` chrome), a left category rail,
 * friendly rounded blue bars that grow rightward from a left baseline, inline
 * value labels, hairline vertical gridlines, and a bottom value-tick band.
 * Geometry mirrors the construction-strategy hard rule — real m0 cells (tight
 * rects via row/col splits), no full-frame drawtext.
 *
 * This first version is STATIC (final-state bars). Intro animation is a planned
 * follow-up knob; the geometry here is the layout the animation will reveal.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicSource,
  MosaicTemplate,
  MosaicTextSource,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeErrorMosaic,
  buildGridlineSources,
  withLayoutContract,
  textEmUnits,
  u01,
  bindProp,
  bindProps,
  type ThemeSourceConfig,
  latticeWeights,
  quantizedSections,
} from "@m0saic/template-utils";
import { niceNum } from "@m0saic/dsl-stdlib";

import {
  alpineCard,
  paint,
  EMPTY,
  rowSplit,
  colSplit,
  overlay,
  textCell,
  tag,
  resolveColor,
  type Node,
  type Band,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";
import { ALPINE_ANIM_FIELDS, fBool, fNum, fFrac, fStr, fEnum } from "../../_shared/alpine-anim";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type ValueLabelFormat = "raw" | "percent" | "compact";
type ValueLabelsConfig = { show: boolean; format: ValueLabelFormat; decimals: number; suffix?: string };
type GridConfig = { show: boolean; count: number };
type EaseName = "linear" | "smoothstep" | "easeInOut";
type Orientation = "vertical" | "horizontal";
/** Reveal cost/quality dial. "premium" (default): bars fade+grow in (a per-pixel
 *  geq per bar/label). "light": bars grow opaquely + labels enable-gate pop — no
 *  geq, composable, cheap when nested. */
type RenderMode = "premium" | "light";
type BarsConfig = {
  gap: number;
  cornerRadius: number;
  /** Bar thickness as a fraction of its band (0.1..1; 1 = bars touch). The
   *  DIRECT thickness dial — when set it wins over `gap` (the legacy inverse
   *  view: gap-to-bar ratio). Unset by default so existing docs are unchanged. */
  thickness?: number;
};
type DomainConfig = { minValue?: number; maxValue?: number };
type AnimConfig = {
  renderMode: RenderMode;
  /** Disable all motion — render the final static chart. */
  reduceMotion: boolean;
  /**
   * How much of the clip the intro animation occupies (0..1). The per-bar grow
   * duration + cascade stagger are DERIVED from this against the clip length, so
   * the whole cascade lands within `introFrac × clipDuration`. (Humans think in
   * "what % of the clip is the animation", not absolute milliseconds.)
   */
  introFrac: number;
  ease: EaseName;
};

type AlpineBarGraphProps = {
  // ── Primary props (flat — always visible up top) ──
  values: number[];
  labels?: string[];
  title?: string;
  subtitle?: string;
  orientation?: Orientation;
  preset?: AlpinePreset;
  barColor?: MosaicColor;
  // ── Grouped props (collapsible sections) ──
  /** Bar geometry: gap + cap rounding. */
  bars?: BarsConfig;
  grid?: GridConfig;
  valueLabels?: ValueLabelsConfig;
  /** Value-axis domain overrides — leave unset to auto-fit to nice round numbers. */
  domain?: DomainConfig;
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
  /** Dev-only layout contract: assert every bar rendered the same thickness. */
  debugLayout?: boolean;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ORIENTATION: Orientation = "horizontal";
const DEFAULT_GAP = 0.55;
const DEFAULT_BAR_RADIUS = 0.4;
const DEFAULT_GRID: GridConfig = { show: true, count: 3 };
const DEFAULT_VALUE_LABELS: ValueLabelsConfig = { show: true, format: "compact", decimals: 1, suffix: "" };
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, ease: "smoothstep", reduceMotion: false };

/** smoothstep / easeInOut share the cubic; linear is the identity. */
function easeExpr(ease: EaseName, u: string): string {
  return ease === "linear" ? u : `(${u})*(${u})*(3-2*(${u}))`;
}

// Horizontal quantization for bar widths (keeps the per-row split GCD-friendly).
const Q = 100;
const STEP = 2;
const snap = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

// ---------------------------------------------------------------------------
// Quantization-exact banding (handbook §3 — the fix for the squashed middle bar)
// ---------------------------------------------------------------------------
// The old banding interleaved fractional [bar, gap, …] weights; rescaled onto a
// unit basis, the engine's OUTSIDE-IN remainder distribution (edges first,
// center LAST) starved the CENTER band whenever the actual cell drifted from
// the computed span (observed 85/85/68/85/85 at 1280×800, gap 0.55 — a
// multi-unit band is exposed to ±(its unit count) px of drift). The fix keeps
// the split TRIVIAL — one EQUAL cell per bar, spread ≤1px per cell at any
// canvas by the outside-in rule — and carves the gap in the FIBER instead: a
// constant per-side `placement.inset` fraction on each bar tile (rung 3/5,
// gap-as-inset). Equal cells ±1px × one shared fraction ⇒ bar thickness can
// never diverge by more than 1px, under any ancestor drift.
const equalBands = (n: number, nodeFor: (i: number) => Node): Band[] =>
  Array.from({ length: n }, (_, i) => ({ weight: 1, node: nodeFor(i) }));

/** Per-side inset fraction that carves `gapRatio` (gap : bar thickness) out of
 *  an equal band: pitch = barH·(1+g) ⇒ half-gap each side = g/(2(1+g)). */
const gapInsetFrac = (gapRatio: number): number => gapRatio / (2 * (1 + gapRatio));

// ---------------------------------------------------------------------------
// Domain + value formatting (self-contained; same shape as charts/bar-graph/v2)
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
  const trim = (s: string) => s.replace(/\.0+$/, "");
  if (abs >= 1e12) return sign + trim((abs / 1e12).toFixed(decimals)) + "T";
  if (abs >= 1e9) return sign + trim((abs / 1e9).toFixed(decimals)) + "B";
  if (abs >= 1e6) return sign + trim((abs / 1e6).toFixed(decimals)) + "M";
  if (abs >= 1e3) return sign + trim((abs / 1e3).toFixed(decimals)) + "K";
  return sign + trim(abs.toFixed(decimals));
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

/** Thin full-cell overlay strip pinned to one edge (baseline / value-axis). */
function edgeStrip(color: MosaicColor, opacity: number, edge: "top" | "bottom" | "left" | "right"): MosaicLavfiSource {
  const horizontal = edge === "top" || edge === "bottom";
  return {
    type: "lavfi", color, fitMode: "content", visual: { opacity },
    size: horizontal ? { wExpr: "TW", hExpr: "max(1,TH*0.004)" } : { wExpr: "max(1,TW*0.004)", hExpr: "TH" },
    placement: { fit: "contain", hAlign: edge === "left" ? "left" : edge === "right" ? "right" : "center", vAlign: edge === "top" ? "top" : edge === "bottom" ? "bottom" : "middle" },
  } as MosaicLavfiSource;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineBarGraphProps>({
  // ── Primary props — flat, always visible up top (declaration order = display order). ──
  values: { type: "number[]", required: true, description: "Numeric data values driving the bars.", meta: { constraints: { minItems: 1 }, control: { flavor: "numberList" }, ui: { label: "Values", order: 1 } } },
  labels: { type: "string[]", required: false, description: "Category labels (index-aligned to values). Optional — clear for a value-only chart.", meta: { ui: { label: "Category Labels", order: 2, primary: true } } },
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., BAR CHART" }, ui: { label: "Title", order: 3 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { control: { placeholder: "e.g., Sales by Channel" }, ui: { label: "Subtitle", order: 4 } } },
  orientation: { type: "string", required: false, description: "Bar orientation: horizontal (bars grow right) or vertical (bars grow up).", meta: { constraints: { oneOf: ["horizontal", "vertical"] }, ui: { label: "Orientation", order: 5 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 6 } } },
  barColor: { type: "string", required: false, description: "Bar fill color. Defaults to the resolved theme primary.", meta: { constraints: { isColor: true }, control: { placeholder: "theme primary", colorPicker: true, defaultColor: "#2563EB" }, ui: { label: "Bar Color", order: 7 } } },

  // ── Everything else grouped into collapsible sections (sliders live inside groups,
  //    not intermixed with the flat toggles/text above). ──
  bars: {
    type: "group" as any, required: false, description: "Bar geometry: gap between bars + cap rounding.",
    meta: { ui: { label: "Bars", order: 8, collapsedByDefault: true } },
    fields: {
      thickness: fNum("Thickness", "Bar width (vertical) / height (horizontal) as a fraction of its band. 1 = bars touch. Overrides Gap when set.", { placeholder: "derived from Gap", flavor: "slider", step: 0.05 }, { min: 0.1, max: 1 }),
      gap: fNum("Gap", "Gap between bars as a fraction of bar thickness (legacy inverse of Thickness — ignored when Thickness is set).", { flavor: "slider", step: 0.05 }, { min: 0, max: 2 }),
      cornerRadius: fFrac("Bar rounding", "Bar cap rounding (0..1)."),
    },
  } as any,
  grid: {
    type: "group" as any, required: false, description: "Gridlines + value ticks behind the bars.",
    meta: { ui: { label: "Grid", order: 9, collapsedByDefault: true } },
    fields: { show: fBool("Show", "Draw gridlines + value ticks."), count: fNum("Tick count", "Number of gridline intervals.", { flavor: "slider", step: 1 }, { min: 1, max: 8 }) },
  } as any,
  valueLabels: {
    type: "group" as any, required: false, description: "Inline per-bar value labels.",
    meta: { ui: { label: "Value Labels", order: 10, collapsedByDefault: true } },
    fields: {
      show: fBool("Show", "Print each bar's value inline."),
      format: fEnum("Format", ["compact", "raw", "percent"], "compact = 1.2K; raw = as-is; percent = share of max."),
      decimals: fNum("Decimals", "Decimal places.", undefined, { min: 0, max: 6 }),
      suffix: fStr("Suffix", "Appended to each value (e.g. \"%\", \" MB\")."),
    },
  } as any,
  domain: {
    type: "group" as any, required: false, description: "Value-axis domain overrides — leave unset to auto-fit to nice round numbers.",
    meta: { ui: { label: "Domain", order: 11, collapsedByDefault: true } },
    fields: {
      minValue: fNum("Min Value", "Explicit domain minimum. Auto (0 / nice) when unset."),
      maxValue: fNum("Max Value", "Explicit domain maximum. Auto (nice max) when unset.", { placeholder: "data max" }),
    },
  } as any,
  anim: {
    type: "group" as any, required: false, description: "Reveal mode + grow-in intro.",
    meta: { ui: { label: "Animation", order: 12, collapsedByDefault: true } },
    fields: {
      renderMode: fEnum("Render mode", ["premium", "light"], "\"premium\" (default): bars fade + grow in — a per-pixel geq per bar/label. \"light\": bars grow opaquely + labels enable-gate pop — no geq, composable, cheap when nested."),
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
      ease: fEnum("Easing", ["smoothstep", "easeInOut", "linear"], "Grow-in easing curve."),
    },
  } as any,
  theme: {
    type: "group" as any, required: false, description: "Opt into a theme source. Uses the alpine preset by default; set a producer slug + namespace to pull shared design tokens. Explicit color props still win.",
    meta: { ui: { label: "Theme", order: 13, collapsedByDefault: true } },
    fields: { slug: fStr("Producer slug", "Producer template to seed tokens from (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"), preset: fStr("Preset", "Producer preset/variant (light | dark | high-contrast; producer-defined).", "producer default"), namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"), forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is populated.") },
  } as any,
  // ── Debug — hidden by default; the sandbox / matrix / Make iteration flip it true. ──
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract view: renders the contract wireframe instead of the chart — bars GREEN with the measured rule when every bar is the same thickness (equal height horizontal / equal width vertical), offenders RED with the violation when not. Deterministic default false; production never sets it.", meta: { ui: { label: "Debug layout", order: 14, collapsedByDefault: true } } },
});

export const AlpineBarGraph: MosaicTemplate<AlpineBarGraphProps> = {
  id: asTemplateId("@m0saic/alpine/bar-graph/v1"),
  label: "Alpine Bar Chart",
  version: 1,
  description: "Alpine horizontal bar chart — friendly mobile-marketing card: rounded bars, category rail, inline values, value ticks.",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "alpine", "bar-graph", "animated", "analysts", "developers", "dashboard", "report"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    domain: { minValue: 0 },
    debugLayout: false,
    theme: { forceFetch: false },
    values: [12400, 8700, 5600, 2100, 1200],
    labels: ["Email", "Twitter", "Reddit", "Hacker News", "Other"],
    title: "BAR CHART",
    subtitle: "Sales by Channel",
    orientation: DEFAULT_ORIENTATION,
    preset: DEFAULT_PRESET,
    // No `barColor` default: it falls through to the resolved theme primary so a
    // preset switch / producer theme recolors the bars. Unthemed light → the exact
    // former default (ALPINE_PRESETS.light.primary), so byte-identity holds.
    bars: { gap: DEFAULT_GAP, cornerRadius: DEFAULT_BAR_RADIUS },
    grid: DEFAULT_GRID,
    valueLabels: DEFAULT_VALUE_LABELS,
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineBarGraphProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    if (!Array.isArray(props.values) || props.values.length === 0) {
      return makeErrorMosaic("values[] must be non-empty", { title: `${this.id} props`, width: W, height: H });
    }

    // Theming: the shared alpine theme (light default via the preset). A producer
    // overrides bar/grid/text tokens through `props.theme`; explicit color props still
    // win. Unthemed → byte-identical to the sync `alpineTheme`.
    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const barColor: MosaicColor = resolveColor(props.barColor, theme.primary);
    const orientation: Orientation = props.orientation ?? DEFAULT_ORIENTATION;
    const bars = { gap: DEFAULT_GAP, cornerRadius: DEFAULT_BAR_RADIUS, ...(props.bars ?? {}) };
    const domain = props.domain ?? {};
    const gapRatio = Math.max(0, bars.gap);
    const barRadius = Math.max(0, Math.min(1, bars.cornerRadius));
    const grid = { ...DEFAULT_GRID, ...(props.grid ?? {}) };
    const valueLabels = { ...DEFAULT_VALUE_LABELS, ...(props.valueLabels ?? {}) };
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";

    const values = props.values;
    const N = values.length;
    const labels = props.labels ?? [];
    const hasLabels = labels.length > 0;

    // Resolve intro timing from introFrac (share of the clip the animation fills).
    // Derive per-bar grow duration + cascade stagger so the whole cascade lands
    // within `introFrac × clip`; the rest of the clip holds the final chart.
    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const introDelaySec = Math.min(0.15, introT * 0.08);
    const CASCADE = 0.45; // stagger : per-bar-duration ratio (cascade tightness)
    const introDurationSec = Math.max(0.05, (introT - introDelaySec) / (1 + CASCADE * Math.max(0, N - 1)));
    const introStaggerSec = CASCADE * introDurationSec;

    // ── Domain (nice axis when a bound is auto) ──
    const rawMin = domain.minValue ?? 0;
    const rawMax = domain.maxValue ?? Math.max(...values);
    const explicit = domain.minValue != null && domain.maxValue != null;
    let minValue = rawMin, maxValue = rawMax;
    let gridCount = Math.max(1, grid.count);
    if (!explicit) {
      const nice = niceAxis(rawMin, rawMax, grid.count + 1);
      minValue = nice.min; maxValue = nice.max;
      gridCount = Math.max(1, nice.ticks.length - 1);
    }
    const denom = maxValue - minValue;
    const fractions = values.map((v) => (denom === 0 ? 1 : Math.max(0, Math.min(1, (v - minValue) / denom))));

    // ── Card chrome (white rounded card + header) ──
    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const CW = card.contentRect.w;
    const CH = card.contentRect.h;

    // ── Fonts + bands ──
    const catFont = Math.max(11, Math.round(H * 0.022));
    const valueFont = Math.max(11, Math.round(H * 0.022));
    const tickFont = Math.max(10, Math.round(H * 0.018));

    const formatted = values.map((v) => formatValue(v, valueLabels, maxValue));
    const maxLabelChars = formatted.reduce((m, s) => Math.max(m, s.length), 0);
    const hasTicks = grid.show && gridCount >= 1;

    // One bar — a rounded tile that (unless reduceMotion) grows from its baseline
    // edge: an overlay translates it in (+ fades), clipped by the plot child doc.
    // fillAxis "x" = grow rightward (horizontal); "y" = grow up (vertical).
    // Half-gap carved INSIDE each equal band (gap-as-inset): the tile paints
    // only the bar's slice of its band, so bar thickness = band × one shared
    // fraction — equal everywhere the equal split is (±1px at any canvas).
    // Direct `thickness` wins; else derive from the legacy gap ratio.
    const thickInset = bars.thickness != null
      ? (1 - Math.max(0.05, Math.min(1, bars.thickness))) / 2
      : gapInsetFrac(gapRatio);
    // The bar IS values[index]'s visual → bound to `values[index]` (Make
    // double-click). Bound alongside the value label because a max-height
    // vertical bar drops its label band — the bar is the handle that always exists.
    // Its FILL is `barColor` → a SECOND entry on the same tile (Make opens a
    // stacked value + color form; the value first = the primary). Bound at the
    // theme default too — double-click is the handle to SET a color.
    const barTile = (color: MosaicColor, startAtSec: number, fillAxis: "x" | "y", index: number): Node => {
      const effects = { rounding: { cornerStyle: "rounded" as const, borderRadius: barRadius } };
      const placement = thickInset > 0
        ? { inset: fillAxis === "x" ? { y: thickInset } : { x: thickInset } }
        : undefined;
      const base = placement ? { effects, placement } : { effects };
      // "bar" tag = the layout contract's join key (equal-thickness relation).
      const tag = (src: MosaicSource): MosaicSource => {
        (src as MosaicSource & { editor?: { label?: string } }).editor = { label: "bar" };
        return src;
      };
      // tag REPLACES `editor` → bind after it.
      const bind = (src: MosaicSource): MosaicSource => bindProps(tag(src), [{ propKey: "values", index }, { propKey: "barColor" }]);
      if (anim.reduceMotion) return paint(bind(makeColorTile(color, base) as MosaicSource));
      const eased = easeExpr(anim.ease, u01(introDurationSec));
      // premium: fade (alpha, a geq) + grow slide. light: opaque grow slide only —
      // the slide IS the grow; the alpha was redundant fade sugar (no geq).
      const alphaPart = light ? {} : { alpha: eased };
      const ov = fillAxis === "y"
        ? { startAtSec, ...alphaPart, yExpr: `h*(1-(${eased}))` }
        : { startAtSec, ...alphaPart, xExpr: `-(w*(1-(${eased})))` };
      return paint(bind(makeColorTile(color, { ...base, overlay: ov }) as MosaicSource));
    };

    // Value label — premium fades in (alpha geq) over the back half of its bar's
    // growth so it lands as the bar arrives; light enable-gate pops it in at the same
    // moment (no geq). Alignment differs by orientation (inline vs above).
    const valueLabelNode = (text: string, index: number, startAtSec: number, hAlign: "left" | "center" | "right", vAlign: "top" | "middle" | "bottom", padding?: { top?: number; right?: number; bottom?: number; left?: number }): Node => {
      // Displays values[index] (formatted) → bound to `values[index]`.
      const src = bindProp(tag(textCell(text, valueFont, theme.label, hAlign, vAlign, padding) as MosaicTextSource, "value-label"), "values", index);
      if (!anim.reduceMotion) {
        const revealAt = startAtSec + introDurationSec * 0.45;
        (src as { overlay?: unknown }).overlay = light
          ? { startAtSec: revealAt, enable: `gte(t,${revealAt.toFixed(3)})` }
          : { startAtSec: revealAt, alpha: u01(Math.max(0.1, introDurationSec * 0.5)) };
      }
      return paint(src);
    };

    // Plot wrapped in a clipping child doc so the grow-in bars don't spill past
    // the axes (ffmpeg overlay composites onto the full canvas). Static skips it.
    const childDocs: Record<string, MosaicDocument> = {};
    const wrapAsChild = (key: string, node: Node): Node => {
      if (anim.reduceMotion) return node;
      childDocs[key] = {
        kind: "mosaic_document", version: 1, assets: {} as any,
        m0: node.m0 as any, sources: node.sources, fps: ctx.target.fps, durationMs: ctx.target.durationMs,
      } as MosaicDocument;
      return { m0: "F", sources: [{ type: "mosaic", ref: key } as unknown as MosaicSource] };
    };

    let content: Node;

    if (orientation === "vertical") {
      // ════ VERTICAL — bars grow UP; category labels on the x-axis (bottom),
      // value ticks on the y-axis (left), horizontal gridlines. ════
      const tickRailW = hasTicks ? Math.max(Math.round(CW * 0.08), tickFont * 3) : 0;
      const catBandH = hasLabels ? Math.round(catFont * 1.9) : 0;
      const plotW = CW - tickRailW;
      const plotH = CH - catBandH;
      if (plotW < 16 || plotH < 16) {
        return makeErrorMosaic("plot area too small", { title: `${this.id}`, width: W, height: H });
      }

      const labelUh = valueLabels.show ? snap((valueFont * 1.5 / plotH) * Q, STEP) : 0;
      // Breathing room between the value label and the bar top (vertical only).
      const labelGapUh = valueLabels.show ? snap((valueFont * 0.6 / plotH) * Q, STEP) : 0;
      const reserveUh = labelUh + labelGapUh;

      // One EQUAL column per bar — thickness survives ancestor drift (see
      // the gap-as-inset note above gapInsetFrac).
      const columnBands = (nodeFor: (i: number) => Node): Band[] => equalBands(N, nodeFor);

      const barColumn = (i: number): Node => {
        let h = snap(fractions[i] * (Q - reserveUh), STEP);
        h = Math.min(Q - reserveUh, Math.max(STEP, h));
        const topU = Q - h;
        const showLabel = labelUh > 0 && topU > reserveUh;
        const labU = showLabel ? labelUh : 0;
        const gapU = showLabel ? labelGapUh : 0;
        const startAtSec = introDelaySec + i * introStaggerSec;
        return rowSplit([
          { weight: topU - labU - gapU, node: EMPTY },
          ...(labU > 0 ? [{ weight: labU, node: valueLabelNode(formatted[i], i, startAtSec, "center", "bottom") }] : []),
          ...(gapU > 0 ? [{ weight: gapU, node: EMPTY }] : []),
          { weight: h, node: barTile(barColor, startAtSec, "y", i) },
        ]);
      };
      const barsNode = colSplit(columnBands(barColumn));

      const gridSources = grid.show && gridCount > 1
        ? buildGridlineSources({ direction: "horizontal", count: gridCount, excludeEdges: false, origin: "bottom", color: theme.grid, opacity: theme.gridAlpha, thicknessFrac: 0.002 }).slice(1)
        : [];
      const plotLayers: Node[] = [...gridSources.map((s) => paint(s)), barsNode];
      plotLayers.push(paint(edgeStrip(theme.axis, theme.axisAlpha, "bottom")));
      plotLayers.push(paint(edgeStrip(theme.axis, theme.axisAlpha, "left")));
      const plotRef = wrapAsChild("plot", overlay(plotLayers));

      // y tick rail (left): top = max → bottom = min.
      const tickRail: Node = hasTicks
        ? (() => {
            const M = gridCount + 1, TICK = 3, GAP = 20;
            const texts = Array.from({ length: M }, (_, i) => formatValue(maxValue - (i / gridCount) * (maxValue - minValue), valueLabels, maxValue));
            // Width-cap to the rail (the horizontal branch's bottom ticks and
            // both cat-label groups already cap; this rail was the last
            // uncapped text). Binds only at tiny canvases (360×640 defaults:
            // 3-char ticks @12px need 24.3px in a 24px rail).
            const longestT = Math.max(1, ...texts.map((t) => textEmUnits(t)));
            const tickFontV = Math.max(8, Math.min(tickFont, Math.floor((tickRailW - 2) / (longestT * 0.62))));
            const bands: Band[] = [];
            for (let i = 0; i < M; i++) {
              bands.push({ weight: TICK, node: paint(tag(textCell(texts[i], tickFontV, theme.muted, "right", "middle", { right: 0.18 }), "axis-tick")) });
              if (i < M - 1) bands.push({ weight: GAP, node: EMPTY });
            }
            return rowSplit(bands);
          })()
        : EMPTY;
      const bodyNode = tickRailW > 0 ? colSplit([{ weight: tickRailW, node: tickRail }, { weight: plotW, node: plotRef }]) : plotRef;

      // x category labels (bottom), aligned under the columns.
      const catLabels = hasLabels
        ? colSplit(columnBands((i) => {
            // Width-cap to the column pitch (mirrors the horizontal rail's cap):
            // uncapped, "Hacker News" @ 733×977 needs ~145px in a 117px column —
            // the text-fit tripwire's first real catch. Binds only when the
            // longest label would overflow; defaults render byte-identical.
            const longestCatV = Math.max(1, ...labels.map((l) => textEmUnits(l ?? "")));
            const catFontV = Math.max(9, Math.min(catFont, Math.floor((plotW / N * 0.94) / (longestCatV * 0.62))));
            return paint(bindProp(tag(textCell(labels[i] ?? "", catFontV, theme.label, "center", "middle"), "cat-label"), "labels", i));
          }))
        : EMPTY;
      const catBand = hasLabels && tickRailW > 0
        ? colSplit([{ weight: tickRailW, node: EMPTY }, { weight: plotW, node: catLabels }])
        : catLabels;

      content = rowSplit([
        { weight: plotH, node: bodyNode },
        { weight: catBandH, node: catBand },
      ]);
    } else {
      // ════ HORIZONTAL — bars grow RIGHT; category labels on the left rail,
      // value ticks on the bottom, vertical gridlines. ════
      const catRailW = hasLabels ? Math.max(Math.round(CW * 0.16), catFont * 5) : 0;
      // Width-cap the category font to the rail: labels clip ("ker News") at
      // narrow canvases (textCell is plain, not fit:contain). Binds only when
      // the longest label would overflow — defaults render byte-identical.
      const longestCat = Math.max(1, ...labels.map((l) => textEmUnits(l ?? "")));
      const catFontH = Math.max(9, Math.min(catFont, Math.floor((catRailW * 0.86) / (longestCat * 0.62))));
      const tickBandH = hasTicks ? Math.round(tickFont * 1.9) : 0;
      const plotW = CW - catRailW;
      const bodyH = CH - tickBandH;
      if (plotW < 16 || bodyH < 16) {
        return makeErrorMosaic("plot area too small", { title: `${this.id}`, width: W, height: H });
      }

      // Inline-label gutter sized GENEROUSLY to the widest value so it never clips.
      const labelPx = valueFont * 0.9 * (maxLabelChars + 2);
      const labelUw = valueLabels.show ? Math.min(38, snap((labelPx / plotW) * Q, STEP)) : 0;
      const barMaxU = Math.max(STEP * 2, Q - labelUw);

      // One EQUAL row per bar — thickness survives ancestor drift (see the
      // gap-as-inset note above gapInsetFrac).
      const rowBands = (nodeFor: (i: number) => Node): Band[] => equalBands(N, nodeFor);

      const barRow = (i: number): Node => {
        let w = snap(fractions[i] * barMaxU, STEP);
        w = Math.min(barMaxU, Math.max(STEP, w));
        const labW = labelUw;
        const restU = Q - w;
        const startAtSec = introDelaySec + i * introStaggerSec;
        return colSplit([
          { weight: w, node: barTile(barColor, startAtSec, "x", i) },
          ...(labW > 0 ? [{ weight: labW, node: valueLabelNode(formatted[i], i, startAtSec, "left", "middle", { left: 0.12 }) }] : []),
          { weight: Math.max(0, restU - labW), node: EMPTY },
        ]);
      };
      const barsNode = rowSplit(rowBands(barRow));

      const gridSources = grid.show && gridCount > 1
        ? buildGridlineSources({ direction: "vertical", count: gridCount, excludeEdges: false, origin: "left", color: theme.grid, opacity: theme.gridAlpha, thicknessFrac: 0.002 }).slice(1)
        : [];
      const plotLayers: Node[] = [...gridSources.map((s) => paint(s)), barsNode];
      plotLayers.push(paint(edgeStrip(theme.axis, theme.axisAlpha, "bottom")));
      plotLayers.push(paint(edgeStrip(theme.axis, theme.axisAlpha, "left")));
      const plotRef = wrapAsChild("plot", overlay(plotLayers));

      const catRail: Node = hasLabels
        ? rowSplit(rowBands((i) => paint(bindProp(tag(textCell(labels[i] ?? "", catFontH, theme.label, "right", "middle", { right: 0.14 }), "cat-label"), "labels", i))))
        : EMPTY;
      const bodyNode = catRailW > 0 ? colSplit([{ weight: catRailW, node: catRail }, { weight: plotW, node: plotRef }]) : plotRef;

      const tickBand: Node = hasTicks
        ? colSplit([
            ...(catRailW > 0 ? [{ weight: catRailW, node: EMPTY as Node }] : []),
            { weight: plotW, node: (() => {
              const M = gridCount + 1, GAP = 20;
              const texts: string[] = [];
              for (let i = 0; i < M; i++) texts.push(formatValue(minValue + (i / gridCount) * (maxValue - minValue), valueLabels, maxValue));
              // TICK=3 slivers garble at high counts on narrow canvases (count 8
              // at 733px → ~10px cells clipping "12K" to a digit). Widen the cell
              // just enough for the longest tick — and cap the font when even a
              // full-pitch cell can't hold it. TICK stays 3 whenever 3 fits, so
              // defaults render byte-identical.
              let f = tickFont;
              const longest = Math.max(1, ...texts.map((t) => textEmUnits(t)));
              const maxNeed = Math.floor(plotW / M);
              let need = Math.ceil(longest * 0.62 * f) + 2;
              if (need > maxNeed) { f = Math.max(8, Math.floor(maxNeed / (longest * 0.62))); need = Math.ceil(longest * 0.62 * f) + 2; }
              const cellPx3 = (plotW * 3) / (M * 3 + (M - 1) * GAP);
              const TICK = need <= cellPx3 ? 3 : Math.min(60, Math.ceil((need * (M - 1) * GAP) / Math.max(1, plotW - need * M)));
              const weights: number[] = [];
              for (let i = 0; i < M; i++) {
                weights.push(TICK);
                if (i < M - 1) weights.push(GAP);
              }
              // Cap the font against the tick cell the ENGINE will produce — the
              // kit rewrites the [tick, gap, …] weights onto the 5-smooth lattice
              // and the parser hands the remainder out outside-in — not the ideal
              // fraction: a hair narrower cell clipped a 33 px tick at 733×977.
              const tickPx = quantizedSections(plotW, latticeWeights(weights)).filter((_, i) => i % 2 === 0);
              const minTickPx = Math.max(1, Math.min(...tickPx));
              if (need > minTickPx) f = Math.max(8, Math.floor((minTickPx - 2) / (longest * 0.62)));
              const bands: Band[] = weights.map((weight, i) =>
                i % 2 === 0
                  ? { weight, node: paint(tag(textCell(texts[i / 2], f, theme.muted, "center", "top"), "axis-tick")) }
                  : { weight, node: EMPTY },
              );
              return colSplit(bands);
            })() },
          ])
        : EMPTY;

      content = rowSplit([
        { weight: bodyH, node: bodyNode },
        { weight: tickBandH, node: tickBand },
      ]);
    }

    const root = card.compose(content);

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      sources: root.sources,
      ...(Object.keys(childDocs).length ? { children: childDocs } : {}),
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // Dev tripwire: every bar must render the SAME thickness — height in
    // horizontal, width in vertical. Falsy debugLayout (default) returns the
    // doc untouched at zero cost; the relation needs ≥2 bars to be meaningful.
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/bar-graph/v1",
        // tolerancePx 1 = the equal split's quantization guarantee; the 2%
        // fraction catches real starvation on bars big enough for % to mean
        // anything. (A pure fraction false-reds thin bars: ±1px of 12px = 8%.)
        relations: N >= 2 ? [{ label: "bar", equal: orientation === "horizontal" ? "height" : "width", tolerance: 0.02, tolerancePx: 1 }] : [],
        // Text-fit tripwires (debug-only, like everything here): clipping text
        // reds the wireframe during stress. Numeric groups use the 0.62em
        // model the template's own caps are built on (digits run narrower than
        // the 0.72em mixed-glyph default); each entry is gated on its elements
        // existing (an unmatched label is a violation).
        constraints: [
          ...card.constraints,
          ...(valueLabels.show && N >= 1 ? [{ label: "value-label", textFits: { charWidthEm: 0.62 } }] : []),
          ...(hasLabels ? [{ label: "cat-label", textFits: { charWidthEm: 0.62 } }] : []),
          // padPx 0: the tick bands SIZE their cells to `need = text + 2px`,
          // so the default +2 contract pad double-counts slack and false-reds
          // when split quantization shaves 1px off the sized-to-fit cell.
          ...(hasTicks ? [{ label: "axis-tick", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme (chat pane +
  // real-material hero). The hero is this template's OWN default chart,
  // rendered static at the hero box and INLINED flat — rounded bar caps are
  // procedural masks (gate-15/21 keeper: never a nested child composite).
  async renderCover(
    _props: AlpineBarGraphProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const chart = (await AlpineBarGraph.render(
      {
        ...(AlpineBarGraph.defaultProps as AlpineBarGraphProps),
        anim: { renderMode: "light", introFrac: 0.7, ease: "smoothstep", reduceMotion: true },
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
      hero: (theme) => onboardingFrame(inlineHeroDoc(chart), theme.borderStrong),
      heroAssets: chart.assets,
    });
  },
};

registerTemplate(AlpineBarGraph);
