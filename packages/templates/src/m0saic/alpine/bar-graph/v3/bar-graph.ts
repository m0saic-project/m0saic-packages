import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/bar-graph/v3 — Alpine Bar Chart, axis-exact
 * ============================================================================
 * v2's look and props (the white rounded card, the header, rounded bars that
 * grow in, value labels, hairline gridlines, the tick labels, the category
 * labels), with its scale fixed. In v2 a bar ran short of its own axis: the
 * bars scaled into the plot MINUS the value-label headroom while the
 * gridlines and ticks spanned the whole plot (a bar of 80 on a 0..100 axis
 * read about 76), the tick labels sat on fixed 3:20 weights that drift off
 * their gridlines toward the ends, and every split went through the kit's
 * 120-slot lattice, so a bar top and a gridline of the same value could land
 * a few pixels apart.
 *
 * v3 maps the value scale to pixels ONCE and draws everything from it: a
 * gridline is the row of its value, a bar's top is the row of its value (a
 * bar of 60 sits exactly on the 60 line), a tick label is centred on its
 * line, a value label sits in a headroom above the scale (never inside it),
 * and the bars are equal to the pixel (one width, centred in equal bands).
 * Every element is a piece at its exact rect (placeInsetPieces); the plot is
 * its own child document at exactly its size, which clips the bars as they
 * grow in. The card's surface and header are the shared alpine card's.
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
  makeIncompleteMosaic,
  placeInsetPieces,
  floorToSmooth,
  type InsetPiece,
  withLayoutContract,
  textEmUnits,
  u01,
  bindProp,
  bindProps,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { niceNum } from "@m0saic/dsl-stdlib";

import {
  alpineCard,
  EMPTY,
  textCell,
  tag,
  resolveColor,
  type Node,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";
import { bBool, bStr, bFrac, bEnum, bNum, ALPINE_ANIM_FIELDS_BARE, ALPINE_ANIM_UNBOUND, ALPINE_THEME_UNBOUND, bindHeaderAddHandles, bindCardSurface } from "../../_shared/alpine-conventions";
import { addHandlesByLabel, sourcesOfTree } from "../../../_shared/canvas-handles";

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

type AlpineBarGraphV3Props = {
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

// ---------------------------------------------------------------------------
// Bar thickness
// ---------------------------------------------------------------------------
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

const propsSchema = definePropsSchema<AlpineBarGraphV3Props>({
  // ── Primary props — flat, always visible up top (declaration order = display order). ──
  values: { type: "number[]", required: true, meta: { constraints: { minItems: 1 }, control: { flavor: "numberList" } } },
  labels: { type: "string[]", required: false },
  title: { type: "string", required: false },
  subtitle: { type: "string", required: false },
  orientation: { type: "string", required: false, meta: { constraints: { oneOf: ["horizontal", "vertical"] } } },
  preset: { type: "string", required: false, meta: { constraints: { oneOf: ["light", "dark"] } } },
  barColor: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true, defaultColor: "#2563EB" } } },

  // ── Everything else grouped into collapsible sections (sliders live inside groups,
  //    not intermixed with the flat toggles/text above). ──
  bars: {
    type: "group" as any, required: false,
    fields: {
      thickness: bNum({ flavor: "slider", step: 0.05 }, { min: 0.1, max: 1 }),
      gap: bNum({ flavor: "slider", step: 0.05 }, { min: 0, max: 2 }),
      cornerRadius: bFrac(),
    },
  } as any,
  grid: {
    type: "group" as any, required: false,
    fields: { show: bBool(), count: bNum({ flavor: "slider", step: 1 }, { min: 1, max: 8 }) },
  } as any,
  valueLabels: {
    type: "group" as any, required: false,
    fields: {
      show: bBool(),
      format: bEnum(["compact", "raw", "percent"]),
      decimals: bNum(undefined, { min: 0, max: 6 }),
      suffix: bStr(),
    },
  } as any,
  domain: {
    type: "group" as any, required: false,
    fields: {
      minValue: bNum(),
      maxValue: bNum(),
    },
  } as any,
  anim: {
    type: "group" as any, required: false,
    fields: {
      renderMode: bEnum(["premium", "light"]),
      reduceMotion: ALPINE_ANIM_FIELDS_BARE.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS_BARE.introFrac,
      ease: bEnum(["smoothstep", "easeInOut", "linear"]),
    },
  } as any,
  theme: {
    type: "group" as any, required: false,
    fields: { slug: bStr(), preset: bStr(), namespace: bStr(), forceFetch: bBool() },
  } as any,
  // ── Debug — hidden by default; the sandbox / matrix / Make iteration flip it true. ──
  debugLayout: { type: "boolean", required: false },
});

export const AlpineBarGraphV3: MosaicTemplate<AlpineBarGraphV3Props> = {
  id: asTemplateId("@m0saic/alpine/bar-graph/v3"),
  version: 3,
  capabilities: { tier: "core" },
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000, posterTimeMs: 1900 },
  bindings: {
    unbound: {
      ...ALPINE_THEME_UNBOUND,
      ...ALPINE_ANIM_UNBOUND,
      // The inverse view of `bars.thickness`, which the bars carry.
      "bars.gap": "geometry",
    },
  },
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

  async render(props: AlpineBarGraphV3Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    if (!Array.isArray(props.values) || props.values.length === 0) {
      return makeIncompleteMosaic("Add a value — one number per bar.", { title: "Bar Chart", width: W, height: H });
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
    const span = maxValue - minValue;

    // ── Card chrome (white rounded card + header): the shared alpine card's own surface and header; the chart body
    //    rides above them as one full-canvas layer of exact pieces. ──
    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const C = card.contentRect;

    // ── Fonts ──
    const catFont = Math.max(11, Math.round(H * 0.022));
    const valueFont = Math.max(11, Math.round(H * 0.022));
    const tickFont = Math.max(10, Math.round(H * 0.018));

    const formatted = values.map((v) => formatValue(v, valueLabels, maxValue));
    const maxLabelChars = formatted.reduce((m, s) => Math.max(m, s.length), 0);
    const hasTicks = grid.show && gridCount >= 1;
    /** The scale's values, min first: tick k is `minValue + k/gridCount` of the span. */
    const tickValues = Array.from({ length: gridCount + 1 }, (_, k) => minValue + (k / gridCount) * span);
    const tickTexts = tickValues.map((v) => formatValue(v, valueLabels, maxValue));

    // ── The scale, once ──
    /** A value's distance from the baseline on a scale `len` px long, rounded ONCE: a bar's top and the gridline of
     *  the same value are the same pixel row (column). */
    const along = (v: number, len: number): number => Math.round((span === 0 ? 1 : Math.max(0, Math.min(1, (v - minValue) / span))) * len);
    /** `n` equal bands over `len` px: the n+1 edges, each rounded on its own (neighbours share an edge). */
    const bandEdges = (n: number, len: number): number[] => Array.from({ length: n + 1 }, (_, i) => Math.round((i * len) / n));
    // A bar's share of its band: the direct `thickness` wins, else the one the gap ratio implies.
    const thickness = bars.thickness != null ? Math.max(0.05, Math.min(1, bars.thickness)) : 1 - 2 * gapInsetFrac(gapRatio);

    type Px = { x: number; y: number; w: number; h: number };
    const Z = { grid: 0, bar: 1, axis: 2, label: 3 };
    const rootPieces: InsetPiece[] = [];
    const plotPieces: InsetPiece[] = [];
    const put = (list: InsetPiece[], r: Px, importance: number, source: MosaicSource): void => {
      const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
      if (w >= 1 && h >= 1) list.push({ rect: { x, y, w, h, importance }, source });
    };
    /**
     * A line (gridline, axis) as a BAND: the piece is the line plus `LINE_PAD` px either side, and the source draws the
     * line itself at its exact thickness, centred in the band (or pinned to one edge for an axis), as v2's edge strips
     * do. A one-pixel piece would force the placement lattice down to single pixels on its axis, and a per-pixel
     * lattice only parses at its own size: a plot drawn scaled into a smaller cell (nested, or flattened by Make)
     * could not be read there.
     */
    const LINE_PAD = 5;
    const lineSource = (color: MosaicColor, opacity: number, axis: "row" | "col", thickness: number, align: "center" | "start" | "end"): MosaicSource => ({
      type: "lavfi", color, fitMode: "content", visual: { opacity },
      size: axis === "row" ? { wExpr: "TW", hExpr: String(thickness) } : { wExpr: String(thickness), hExpr: "TH" },
      placement: axis === "row"
        ? { fit: "contain", hAlign: "center", vAlign: align === "center" ? "middle" : align === "start" ? "top" : "bottom" }
        : { fit: "contain", vAlign: "middle", hAlign: align === "center" ? "center" : align === "start" ? "left" : "right" },
    }) as unknown as MosaicSource;
    /** A row line `t` px thick whose first row is `y`, spanning [x, x + w): the band around it. */
    const rowLine = (list: InsetPiece[], y: number, t: number, x: number, w: number, color: MosaicColor, opacity: number): void =>
      put(list, { x, y: y - LINE_PAD, w, h: t + 2 * LINE_PAD }, Z.grid, lineSource(color, opacity, "row", t, "center"));
    /** A column line `t` px thick whose first column is `x`, spanning [y, y + h). */
    const colLine = (list: InsetPiece[], x: number, t: number, y: number, h: number, color: MosaicColor, opacity: number): void =>
      put(list, { x: x - LINE_PAD, y, w: t + 2 * LINE_PAD, h }, Z.grid, lineSource(color, opacity, "col", t, "center"));
    /** The axes, each pinned to the plot's edge: the baseline along the bottom, the value axis up the left (v2's strips). */
    const putAxes = (list: InsetPiece[], r: Px): void => {
      const b = Math.max(1, Math.round(r.h * 0.004));
      const l = Math.max(1, Math.round(r.w * 0.004));
      put(list, { x: 0, y: r.h - b - 2 * LINE_PAD, w: r.w, h: b + 2 * LINE_PAD }, Z.axis, lineSource(theme.axis, theme.axisAlpha, "row", b, "end"));
      put(list, { x: 0, y: 0, w: l + 2 * LINE_PAD, h: r.h }, Z.axis, lineSource(theme.axis, theme.axisAlpha, "col", l, "start"));
    };

    // One bar — a rounded tile that (unless reduceMotion) grows from its baseline edge: an overlay translates it in
    // (+ fades), clipped by the plot child doc. fillAxis "x" = grow rightward (horizontal); "y" = grow up (vertical).
    // The bar IS values[index]'s visual → bound to `values[index]` (Make double-click), and its FILL is `barColor`
    // → a SECOND entry on the same tile (Make opens a stacked value + color form; the value first = the primary).
    const barTile = (color: MosaicColor, startAtSec: number, fillAxis: "x" | "y", index: number): MosaicSource => {
      const effects = { rounding: { cornerStyle: "rounded" as const, borderRadius: barRadius } };
      // "bar" tag = the layout contract's join key (equal-thickness relation). tag REPLACES `editor` → bind after it.
      const tagged = (src: MosaicSource): MosaicSource => {
        (src as MosaicSource & { editor?: { label?: string } }).editor = { label: "bar" };
        return bindProps(src, [{ propKey: "values", index }, { propKey: "barColor" }]);
      };
      if (anim.reduceMotion) return tagged(makeColorTile(color, { effects }) as MosaicSource);
      const eased = easeExpr(anim.ease, u01(introDurationSec));
      // premium: fade (alpha, a geq) + grow slide. light: opaque grow slide only — the slide IS the grow.
      const alphaPart = light ? {} : { alpha: eased };
      const ov = fillAxis === "y"
        ? { startAtSec, ...alphaPart, yExpr: `h*(1-(${eased}))` }
        : { startAtSec, ...alphaPart, xExpr: `-(w*(1-(${eased})))` };
      return tagged(makeColorTile(color, { effects, overlay: ov }) as MosaicSource);
    };

    // Value label — premium fades in (alpha geq) over the back half of its bar's growth so it lands as the bar
    // arrives; light enable-gate pops it in at the same moment (no geq). Displays values[index] → bound to it.
    const valueLabelSource = (text: string, index: number, startAtSec: number, hAlign: "left" | "center" | "right", vAlign: "top" | "middle" | "bottom", padding?: { top?: number; right?: number; bottom?: number; left?: number }): MosaicSource => {
      const src = bindProp(tag(textCell(text, valueFont, theme.label, hAlign, vAlign, padding) as MosaicTextSource, "value-label"), "values", index);
      if (!anim.reduceMotion) {
        const revealAt = startAtSec + introDurationSec * 0.45;
        (src as { overlay?: unknown }).overlay = light
          ? { startAtSec: revealAt, enable: `gte(t,${revealAt.toFixed(3)})` }
          : { startAtSec: revealAt, alpha: u01(Math.max(0.1, introDurationSec * 0.5)) };
      }
      return src as MosaicSource;
    };
    const tickSource = (text: string, font: number, hAlign: "center" | "right", vAlign: "middle" | "top", padding?: { right?: number }): MosaicSource =>
      tag(textCell(text, font, theme.muted, hAlign, vAlign, padding), "axis-tick") as MosaicSource;
    const catSource = (i: number, font: number, hAlign: "center" | "right", padding?: { right?: number }): MosaicSource =>
      bindProp(tag(textCell(labels[i] ?? "", font, theme.label, hAlign, "middle", padding), "cat-label"), "labels", i) as MosaicSource;

    /** The plot is its own canvas (the child below): 5-smooth on both axes, so its pieces sit on a composable
     *  lattice. The few pixels this gives up go above the plot (the height) and to its right (the width). */
    const smoothPlot = (r: Px): Px => {
      const w = floorToSmooth(r.w);
      const h = floorToSmooth(r.h);
      return { x: r.x, y: r.y + (r.h - h), w, h };
    };
    let plot: Px;

    if (orientation === "vertical") {
      // ════ VERTICAL — bars grow UP; category labels under the plot, value ticks on the left rail, horizontal
      // gridlines. ════
      const tickH = hasTicks ? Math.round(tickFont * 1.6) : 0;
      const tickRailW = hasTicks ? Math.max(Math.round(C.w * 0.08), tickFont * 3) : 0;
      const catBandH = hasLabels ? Math.round(catFont * 1.9) : 0;
      // Under the plot: the category band, and at least half a tick label (the 0 tick is centred on the baseline).
      const below = Math.max(catBandH, Math.ceil(tickH / 2));
      plot = { x: C.x + tickRailW, y: C.y, w: C.w - tickRailW, h: C.h - below };
      if (plot.w < 16 || plot.h < 16) {
        return makeErrorMosaic("plot area too small", { title: `${this.id}`, width: W, height: H });
      }
      plot = smoothPlot(plot);
      const labelH = valueLabels.show ? Math.round(valueFont * 1.5) : 0;
      const labelGap = valueLabels.show ? Math.round(valueFont * 0.6) : 0;
      // The headroom ABOVE the scale: the tallest bar's value label, and half the top tick label.
      const head = Math.min(plot.h - 8, Math.max(labelH + labelGap, Math.ceil(tickH / 2), LINE_PAD + 2));
      const V = plot.h - head;
      /** Plot-local row of a value's line: the baseline is row plot.h, the scale's top row is `head`. */
      const rowOf = (v: number): number => plot.h - along(v, V);

      const gridT = Math.max(1, Math.round(plot.h * 0.002));
      if (grid.show && gridCount > 1) {
        for (let k = 1; k <= gridCount; k++) rowLine(plotPieces, rowOf(tickValues[k]) - Math.floor((gridT - 1) / 2), gridT, 0, plot.w, theme.grid, theme.gridAlpha);
      }
      // Bars: one width, centred in N equal bands; the top on the value's row.
      const edges = bandEdges(N, plot.w);
      const barW = Math.max(1, Math.round((plot.w / N) * thickness));
      for (let i = 0; i < N; i++) {
        const startAtSec = introDelaySec + i * introStaggerSec;
        const top = Math.min(plot.h - 1, rowOf(values[i]));
        const x = Math.round((edges[i] + edges[i + 1]) / 2 - barW / 2);
        put(plotPieces, { x, y: top, w: barW, h: plot.h - top }, Z.bar, barTile(barColor, startAtSec, "y", i));
        if (valueLabels.show) put(plotPieces, { x: edges[i], y: top - labelGap - labelH, w: edges[i + 1] - edges[i], h: labelH }, Z.label, valueLabelSource(formatted[i], i, startAtSec, "center", "bottom"));
      }
      putAxes(plotPieces, plot);

      // The tick rail: each tick label centred on its line, top = max.
      if (hasTicks) {
        const longestT = Math.max(1, ...tickTexts.map((t) => textEmUnits(t)));
        const tickFontV = Math.max(8, Math.min(tickFont, Math.floor((tickRailW - 2) / (longestT * 0.62))));
        tickValues.forEach((v, k) => {
          const centre = plot.y + rowOf(v);
          put(rootPieces, { x: C.x, y: centre - tickH / 2, w: tickRailW, h: tickH }, 1, tickSource(tickTexts[k], tickFontV, "right", "middle", { right: 0.18 }));
        });
      }
      // The category labels under the columns, capped to the column pitch.
      if (hasLabels) {
        const longestCatV = Math.max(1, ...labels.map((l) => textEmUnits(l ?? "")));
        const catFontV = Math.max(9, Math.min(catFont, Math.floor(((plot.w / N) * 0.94) / (longestCatV * 0.62))));
        for (let i = 0; i < N; i++) put(rootPieces, { x: plot.x + edges[i], y: plot.y + plot.h, w: edges[i + 1] - edges[i], h: catBandH }, 1, catSource(i, catFontV, "center"));
      }
    } else {
      // ════ HORIZONTAL — bars grow RIGHT; category labels on the left rail, value ticks under the plot, vertical
      // gridlines. ════
      const catRailW = hasLabels ? Math.max(Math.round(C.w * 0.16), catFont * 5) : 0;
      // Width-cap the category font to the rail (textCell is plain, not fit:contain).
      const longestCat = Math.max(1, ...labels.map((l) => textEmUnits(l ?? "")));
      const catFontH = Math.max(9, Math.min(catFont, Math.floor((catRailW * 0.86) / (longestCat * 0.62))));
      const tickBandH = hasTicks ? Math.round(tickFont * 1.9) : 0;
      plot = { x: C.x + catRailW, y: C.y, w: C.w - catRailW, h: C.h - tickBandH };
      if (plot.w < 16 || plot.h < 16) {
        return makeErrorMosaic("plot area too small", { title: `${this.id}`, width: W, height: H });
      }
      plot = smoothPlot(plot);
      // Ticks are centred on their lines: a tick cell as wide as its longest text, the font capped to the pitch.
      const longestT = Math.max(1, ...tickTexts.map((t) => textEmUnits(t)));
      // The gutter right of the scale: the widest value label, and half the last tick label.
      const labelPx = valueLabels.show ? Math.min(plot.w * 0.38, valueFont * 0.9 * (maxLabelChars + 2)) : 0;
      let tickF = tickFont;
      let tickW = hasTicks ? Math.ceil(longestT * 0.62 * tickF) + 2 : 0;
      const tail = Math.max(Math.round(labelPx), Math.ceil(tickW / 2), LINE_PAD + 2);
      const V = plot.w - tail;
      if (hasTicks && gridCount >= 1 && tickW > V / gridCount) {
        tickF = Math.max(8, Math.floor((V / gridCount - 2) / (longestT * 0.62)));
        tickW = Math.ceil(longestT * 0.62 * tickF) + 2;
      }
      /** Plot-local column of a value's line: the axis is column 0, the scale's end is column V. */
      const colOf = (v: number): number => along(v, V);

      const gridT = Math.max(1, Math.round(plot.w * 0.002));
      if (grid.show && gridCount > 1) {
        // The line runs through a bar's last column (a bar of the value spans [0, colOf)), as in vertical it runs
        // through the bar's top row.
        for (let k = 1; k <= gridCount; k++) colLine(plotPieces, colOf(tickValues[k]) - 1 - Math.floor((gridT - 1) / 2), gridT, 0, plot.h, theme.grid, theme.gridAlpha);
      }
      const edges = bandEdges(N, plot.h);
      const barH = Math.max(1, Math.round((plot.h / N) * thickness));
      for (let i = 0; i < N; i++) {
        const startAtSec = introDelaySec + i * introStaggerSec;
        const w = Math.max(1, colOf(values[i]));
        const y = Math.round((edges[i] + edges[i + 1]) / 2 - barH / 2);
        put(plotPieces, { x: 0, y, w, h: barH }, Z.bar, barTile(barColor, startAtSec, "x", i));
        if (valueLabels.show) put(plotPieces, { x: w, y: edges[i], w: Math.min(Math.round(labelPx), plot.w - w), h: edges[i + 1] - edges[i] }, Z.label, valueLabelSource(formatted[i], i, startAtSec, "left", "middle", { left: 0.12 }));
      }
      putAxes(plotPieces, plot);

      // The tick band under the plot: each label centred on its line (min at the axis).
      if (hasTicks) {
        tickValues.forEach((v, k) => {
          const centre = plot.x + colOf(v);
          const x = Math.max(0, Math.min(W - tickW, centre - tickW / 2));
          put(rootPieces, { x, y: plot.y + plot.h, w: tickW, h: tickBandH }, 1, tickSource(tickTexts[k], tickF, "center", "top"));
        });
      }
      if (hasLabels) {
        for (let i = 0; i < N; i++) put(rootPieces, { x: C.x, y: plot.y + edges[i], w: catRailW, h: edges[i + 1] - edges[i] }, 1, catSource(i, catFontH, "right", { right: 0.14 }));
      }
    }

    // The plot as its own child document at exactly its size (it clips the bars as they grow in); static skips it.
    const childDocs: Record<string, MosaicDocument> = {};
    if (anim.reduceMotion) {
      for (const p of plotPieces) rootPieces.push({ ...p, rect: { ...p.rect, x: p.rect.x + plot.x, y: p.rect.y + plot.y, importance: 1 + (p.rect.importance ?? 0) } });
    } else {
      const placedPlot = placeInsetPieces({ rootW: plot.w, rootH: plot.h, pieces: plotPieces });
      childDocs.plot = {
        kind: "mosaic_document", version: 1, assets: {} as any,
        m0: placedPlot.m0 as any, sources: placedPlot.sources,
        size: { width: plot.w, height: plot.h }, fps: ctx.target.fps, durationMs: ctx.target.durationMs,
      } as MosaicDocument;
      put(rootPieces, plot, 1, { type: "mosaic", ref: "plot" } as unknown as MosaicSource);
    }
    const body = placeInsetPieces({ rootW: W, rootH: H, pieces: rootPieces });
    const bodyLayer: Node = { m0: String(body.m0), sources: body.sources as MosaicSource[] };
    const root = card.compose(EMPTY, bodyLayer);

    // ── v2: more handles on the rects v1 built (a post-pass by tag, so the
    //    builders above stay byte-identical). A bar also shows its rounding and
    //    thickness; a value label its suffix and precision; an axis tick the
    //    grid's density and the domain it spans. ──
    const all = sourcesOfTree(root.sources as MosaicSource[], childDocs);
    addHandlesByLabel(all, {
      bar: [{ propKey: "bars.cornerRadius" }, { propKey: "bars.thickness" }],
      "value-label": [{ propKey: "valueLabels.suffix" }, { propKey: "valueLabels.decimals" }],
      "axis-tick": [{ propKey: "grid.count" }, { propKey: "domain.minValue" }, { propKey: "domain.maxValue" }],
    });
    bindHeaderAddHandles(all, props, ["cat-label", "bar"]);

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      // The card surface is a handle for `preset` (bindCardSurface) — a full-canvas
      // card that nothing binds is a dead click target (founder, 2026-10-01).
      sources: bindCardSurface(root.sources),
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
        templateId: "@m0saic/alpine/bar-graph/v3",
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
    _props: AlpineBarGraphV3Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const chart = (await AlpineBarGraphV3.render(
      {
        ...(AlpineBarGraphV3.defaultProps as AlpineBarGraphV3Props),
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

registerTemplate(AlpineBarGraphV3);
