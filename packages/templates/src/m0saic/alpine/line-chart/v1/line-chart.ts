import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/line-chart/v1 — Alpine Line Chart (friendly mobile-marketing)
 * ============================================================================
 *
 * The Alpine pack's line/area chart. STANDALONE (not a re-skin of
 * `@m0saic/charts/line-chart/v1`) — Alpine is its own brand flavor: a white
 * rounded card (via the shared `alpineCard` chrome), a soft gradient-less area
 * fill under a friendly rounded line, point markers, a left value-tick rail,
 * bottom category labels, and hairline horizontal gridlines.
 *
 * Construction follows the donut's seam-free recipe: every mark (area, line,
 * markers, gridlines, axis, tick + category text) is a TIGHT cell-local
 * inline-mask placed DIRECTLY on the full canvas via `placeRects`, so a single
 * coordinate system aligns them all and the 4px snap grid never scales a path
 * (which is what broke the donut when a ring went through a child cell). It
 * reuses the pure path MATH from `charts/line-chart/v1/geometry` (shared geometry,
 * not a composed template) but owns its own chrome, palette, and animation.
 *
 * Intro animation: a left→right draw-on (the line reveals as a cascade of
 * collinear ribbon slivers), markers pop at their vertices, the area fades up.
 * `anim.reduceMotion` collapses to the static final chart (line = one mask).
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeErrorMosaic,
  easingExpr,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { placeRects, niceNum } from "@m0saic/dsl-stdlib";

import type { Pt } from "../../../charts/_shared/line";
import {
  curvePolyline,
  polylineStrokePath,
  polylineStrokeBBox,
  areaPolygonPath,
  areaBBox,
  markerBBox,
  local,
  type BBox,
} from "../../../charts/line-chart/v1/geometry";

import {
  alpineCard,
  EMPTY,
  textCell,
  resolveColor,
  type Node,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { ALPINE_ANIM_FIELDS, fBool, fNum, fFrac, fStr, fEnum } from "../../_shared/alpine-anim";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Curve = "linear" | "smooth" | "stepped";
type DomainConfig = { minValue?: number; maxValue?: number };
type GridConfig = { show: boolean; count: number };
type AreaConfig = { show: boolean; opacity: number };
type PointsConfig = { show: boolean };
type AnimConfig = {
  /** Skip motion; render the final static chart. */
  reduceMotion: boolean;
  /** Share of the clip the draw-on occupies (0..1); the rest holds the final chart. */
  introFrac: number;
  ease: EaseName;
};

type AlpineLineChartProps = {
  // ── Primary props (flat — always visible up top) ──
  values: number[];
  labels?: string[];
  title?: string;
  subtitle?: string;
  curve?: Curve;
  preset?: AlpinePreset;
  lineColor?: MosaicColor;
  // ── Grouped props (collapsible sections; declaration order = display order) ──
  grid?: GridConfig;
  area?: AreaConfig;
  points?: PointsConfig;
  /** Value-axis domain overrides — leave unset to auto-fit to nice round numbers. */
  domain?: DomainConfig;
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_CURVE: Curve = "smooth";
const DEFAULT_GRID: GridConfig = { show: true, count: 4 };
const DEFAULT_AREA: AreaConfig = { show: true, opacity: 0.14 };
const DEFAULT_POINTS: PointsConfig = { show: true };
const DEFAULT_ANIM: AnimConfig = { introFrac: 0.7, ease: "easeOut", reduceMotion: false };

// Full-canvas tight-cell packing (mirrors the donut).
const SNAP_PX = 4;
const EDGE_PAD = 1.5;

// ---------------------------------------------------------------------------
// Nice axis (self-contained; same shape as the bar-graph)
// ---------------------------------------------------------------------------

type NiceAxis = { min: number; max: number; step: number; ticks: number[] };

function niceAxis(min: number, max: number, targetTicks: number): NiceAxis {
  if (max === min) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    return { min: min - pad, max: max + pad, step: pad, ticks: [min - pad, min, max + pad] };
  }
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

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const trim = (s: string) => s.replace(/\.0+$/, "");
  if (abs >= 1e9) return sign + trim((abs / 1e9).toFixed(1)) + "B";
  if (abs >= 1e6) return sign + trim((abs / 1e6).toFixed(1)) + "M";
  if (abs >= 1e3) return sign + trim((abs / 1e3).toFixed(1)) + "K";
  if (abs >= 100) return sign + Math.round(abs).toString();
  return sign + trim(abs.toFixed(abs < 10 ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Tight-cell placement (full-canvas → no scaling → GCD-aligned, no seams)
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number; claimant: string; importance?: number };
type Piece = { rect: Rect; source: MosaicSource };

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function placePiece(
  W: number,
  H: number,
  bbox: BBox,
  importance: number,
  makeSource: (cellW: number, cellH: number, ox: number, oy: number) => MosaicSource,
): Piece {
  const snapDown = (v: number) => Math.floor((v - EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const snapUp = (v: number) => Math.ceil((v + EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const x = clampInt(snapDown(bbox.minX), 0, W - 1);
  const y = clampInt(snapDown(bbox.minY), 0, H - 1);
  const x2 = clampInt(snapUp(bbox.maxX), x + SNAP_PX, W);
  const y2 = clampInt(snapUp(bbox.maxY), y + SNAP_PX, H);
  return { rect: { x, y, w: x2 - x, h: y2 - y, claimant: "F", importance }, source: makeSource(x2 - x, y2 - y, x, y) };
}

/** A masked color tile placed at its tight bbox; `localPath` is built in cell-local px. */
function maskPiece(
  W: number,
  H: number,
  bbox: BBox,
  importance: number,
  color: MosaicColor,
  localPath: (ox: number, oy: number) => string,
  opts: { overlay?: Record<string, unknown> } = {},
): Piece {
  // NOTE: makeColorTile honors only overlay/mask/placement/effects — opacity must
  // ride on overlay.alpha, never `visual` (which it silently drops).
  return placePiece(W, H, bbox, importance, (cw, ch, ox, oy) =>
    makeColorTile(color, {
      mask: { kind: "inline-mask", localPath: localPath(ox, oy), bounds: { x: 0, y: 0, width: cw, height: ch } } as any,
      ...(opts.overlay ? { overlay: opts.overlay } : {}),
    }),
  );
}

/** One placeRects overlay layer: a single (non-chained) m0 band-expression plus
 *  the sources for its cells, ordered to match the m0's frame enumeration. */
type PackedLayer = { m0: string; sources: MosaicSource[] };

/** Pack a piece list full-canvas and return its INDIVIDUAL layers (placeRects'
 *  per-layer m0 is a single split, never a `{}` chain — so the caller can nest
 *  layers from several packNode calls into one overlay without illegal chains).
 *  Source order follows placeRects' frame order: per band (y asc), per rect (x asc). */
function packLayers(W: number, H: number, pieces: Piece[]): PackedLayer[] {
  if (pieces.length === 0) return [];
  const placed = placeRects({ rootW: W, rootH: H, rects: pieces.map((p) => p.rect) as any });
  return (placed as { layers: Array<{ rectIndices: number[]; m0: unknown }> }).layers.map((layer) => {
    const ordered = [...layer.rectIndices].sort((a, b) => pieces[a].rect.y - pieces[b].rect.y || pieces[a].rect.x - pieces[b].rect.x);
    return { m0: String(layer.m0), sources: ordered.map((i) => pieces[i].source) };
  });
}

/** Nest a bottom→top list of (non-chained) layers into one overlay Node:
 *  L0{L1{…{Ln}}}, sources concatenated in the same layer order (= frame order). */
function chainLayers(layers: PackedLayer[]): Node {
  if (layers.length === 0) return EMPTY;
  let m0 = layers[layers.length - 1].m0;
  for (let i = layers.length - 2; i >= 0; i--) m0 = `${layers[i].m0}{${m0}}`;
  return { m0, sources: layers.flatMap((l) => l.sources) };
}

function textBBox(cxp: number, cyp: number, text: string, font: number): BBox {
  // Generous cell so `textCell`'s fit:contain has room to lay the glyphs out
  // crisply (too-tight cells rasterize small text as tofu).
  const w = Math.max(font * 1.5, text.length * font * 0.78 + font);
  const h = font * 1.7;
  return { minX: cxp - w / 2, minY: cyp - h / 2, maxX: cxp + w / 2, maxY: cyp + h / 2 };
}

function textPiece(W: number, H: number, importance: number, cxp: number, cyp: number, text: string, font: number, color: MosaicColor, hAlign: "left" | "center" | "right", overlay?: Record<string, unknown>): Piece {
  return placePiece(W, H, textBBox(cxp, cyp, text, font), importance, () => {
    // Use the pack's proven text cell (fit:contain, transparent bg) — same helper
    // the donut legend uses, so small labels render crisp, not as tofu.
    const src = textCell(text, font, color, hAlign, "middle") as MosaicSource;
    if (overlay) (src as { overlay?: unknown }).overlay = overlay;
    return src;
  });
}

function unionBBox(boxes: BBox[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
function rectLocal(x: number, y: number, w: number, h: number): string {
  return `M ${r2(x)} ${r2(y)} L ${r2(x + w)} ${r2(y)} L ${r2(x + w)} ${r2(y + h)} L ${r2(x)} ${r2(y + h)} Z`;
}

// A circle as a many-sided POLYGON (M L … Z). The engine's mask rasterizer
// renders SVG arcs (`markerPath(...,"circle")`) only on the static path; under a
// temporal `overlay` it drops the arc and fills the bbox (a square). Polygon
// masks survive overlays (the line/area prove it), so animated markers use this.
function circlePolyLocal(cx: number, cy: number, r: number, sides = 28): string {
  let d = "";
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    d += `${k === 0 ? "M" : "L"} ${r2(x)} ${r2(y)} `;
  }
  return d + "Z";
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineLineChartProps>({
  // ── Primary props — flat, always visible up top (declaration order = display order). ──
  values: { type: "number[]", required: true, description: "Numeric series driving the line (left→right).", meta: { constraints: { minItems: 1 }, control: { flavor: "numberList" }, ui: { label: "Values", order: 1 } } },
  labels: { type: "string[]", required: false, description: "Category labels (index-aligned to values) along the x-axis.", meta: { ui: { label: "Category Labels", order: 2, primary: true } } },
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., LINE CHART" }, ui: { label: "Title", order: 3 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { control: { placeholder: "e.g., Monthly Active Users" }, ui: { label: "Subtitle", order: 4 } } },
  curve: { type: "string", required: false, description: "Interpolation between points.", meta: { constraints: { oneOf: ["smooth", "linear", "stepped"] }, ui: { label: "Curve", order: 5 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 6 } } },
  lineColor: { type: "string", required: false, description: "Line + marker color. Defaults to the resolved theme primary.", meta: { constraints: { isColor: true }, control: { placeholder: "theme primary", colorPicker: true, defaultColor: "#2563EB" }, ui: { label: "Line Color", order: 7 } } },

  // ── Everything else grouped into collapsible sections. ──
  grid: {
    type: "group" as any, required: false, description: "Gridlines + value ticks behind the line.",
    meta: { ui: { label: "Grid", order: 8, collapsedByDefault: true } },
    fields: { show: fBool("Show", "Draw horizontal gridlines + value ticks."), count: fNum("Tick count", "Number of horizontal gridlines/ticks.", { flavor: "slider", step: 1 }, { min: 2, max: 8 }) },
  } as any,
  area: {
    type: "group" as any, required: false, description: "Soft area fill under the line.",
    meta: { ui: { label: "Area", order: 9, collapsedByDefault: true } },
    fields: { show: fBool("Show", "Fill under the line."), opacity: fFrac("Opacity", "Area fill opacity (0..1).") },
  } as any,
  points: {
    type: "group" as any, required: false, description: "Point markers at each data vertex.",
    meta: { ui: { label: "Points", order: 10, collapsedByDefault: true } },
    fields: { show: fBool("Show", "Draw a dot at each data vertex.") },
  } as any,
  domain: {
    type: "group" as any, required: false, description: "Value-axis domain overrides — leave unset to auto-fit to nice round numbers.",
    meta: { ui: { label: "Domain", order: 11, collapsedByDefault: true } },
    fields: {
      minValue: fNum("Min Value", "Explicit domain minimum. Auto-derived when unset.", { placeholder: "data min" }),
      maxValue: fNum("Max Value", "Explicit domain maximum. Auto-derived when unset.", { placeholder: "data max" }),
    },
  } as any,
  anim: {
    type: "group" as any, required: false, description: "Left→right draw-on intro.",
    meta: { ui: { label: "Animation", order: 12, collapsedByDefault: true } },
    fields: { reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion, introFrac: ALPINE_ANIM_FIELDS.introFrac, ease: fEnum("Easing", ["easeOut", "smoothstep", "easeInOut", "linear"], "Intro draw-on easing curve.") },
  } as any,
  theme: {
    type: "group" as any, required: false, description: "Opt into a theme source. Uses the alpine preset by default; set a producer slug + namespace to pull shared design tokens. Explicit color props still win.",
    meta: { ui: { label: "Theme", order: 13, collapsedByDefault: true } },
    fields: { slug: fStr("Producer slug", "Producer template to seed tokens from (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"), preset: fStr("Preset", "Producer preset/variant (light | dark | high-contrast; producer-defined).", "producer default"), namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"), forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is populated.") },
  } as any,
});

export const AlpineLineChart: MosaicTemplate<AlpineLineChartProps> = {
  id: asTemplateId("@m0saic/alpine/line-chart/v1"),
  label: "Alpine Line Chart",
  version: 1,
  description: "Alpine line/area chart — friendly mobile-marketing card: soft area fill, rounded line, point markers, value rail, left→right draw-on. Standalone Alpine brand flavor.",
  capabilities: { tier: "core" },
  primitive: true,
  deprecated: {
    reason:
      "Absolute-placement antipattern: every mark (gridlines, axis, area, line, markers, labels) is a tight cell-local inline-mask placed DIRECTLY on the full canvas via placeRects, so a single coordinate system aligns them — but precision tracks the canvas (audit: ABSOLUTE, slope 1.08) and it pins its parent when nested. Use v2 — the SAME single-coordinate-system idea scoped to a RATIO plot cell: the marks are masks that fill that cell in plot-local coords (so they still register exactly), while the cell is a ratio split → bounded precision. Composes at any canvas.",
    replacement: asTemplateId("@m0saic/alpine/line-chart/v2"),
    since: "2026-07-09",
  },
  tags: ["alpine", "line-chart", "chart", "data-viz"],
  outputHints: { width: 1280, height: 800, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    theme: { forceFetch: false },
    values: [12, 19, 15, 25, 22, 30, 28, 36],
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"],
    title: "LINE CHART",
    subtitle: "Monthly Active Users",
    curve: DEFAULT_CURVE,
    preset: DEFAULT_PRESET,
    // No `lineColor` default: it falls through to the resolved theme primary so a
    // preset switch / producer theme recolors the line. Unthemed light → the exact
    // former default (ALPINE_PRESETS.light.primary), so byte-identity holds.
    grid: DEFAULT_GRID,
    area: DEFAULT_AREA,
    points: DEFAULT_POINTS,
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineLineChartProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    const values = (props.values ?? []).filter((v) => Number.isFinite(v));
    if (values.length === 0) {
      return makeErrorMosaic("values[] must be non-empty", { title: `${this.id} props`, width: W, height: H });
    }

    // Theming: the shared alpine theme (light default via the preset). A producer
    // overrides card/line/grid tokens through `props.theme`; explicit color props
    // still win downstream. Unthemed → byte-identical to the sync `alpineTheme`.
    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const lineColor: MosaicColor = resolveColor(props.lineColor, theme.primary);
    const curve: Curve = props.curve ?? DEFAULT_CURVE;
    const grid = { ...DEFAULT_GRID, ...(props.grid ?? {}) };
    const area = { ...DEFAULT_AREA, ...(props.area ?? {}) };
    const points = { ...DEFAULT_POINTS, ...(props.points ?? {}) };
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const labels = props.labels ?? [];
    const hasLabels = labels.length > 0;

    const N = values.length;

    // ── Domain (nice axis unless both bounds explicit) ──
    const domain = props.domain ?? {};
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const explicit = domain.minValue != null && domain.maxValue != null;
    let minValue: number, maxValue: number, gridCount: number;
    if (explicit) {
      minValue = domain.minValue!; maxValue = domain.maxValue!;
      gridCount = Math.max(1, grid.count);
    } else {
      const nice = niceAxis(domain.minValue ?? dataMin, domain.maxValue ?? dataMax, grid.count + 1);
      minValue = nice.min; maxValue = nice.max;
      gridCount = Math.max(1, nice.ticks.length - 1);
    }
    const denom = maxValue - minValue || 1;

    // ── Card chrome → plot rect ──
    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    const tickFont = Math.max(10, Math.round(H * 0.019));
    const catFont = Math.max(10, Math.round(H * 0.02));
    const hasTicks = grid.show;
    const tickRailW = hasTicks ? Math.max(Math.round(cr.w * 0.07), tickFont * 3) : Math.round(cr.w * 0.01);
    const catBandH = hasLabels ? Math.round(catFont * 2) : 0;

    // Mark sizing (needed before the plot inset so the end markers get breathing
    // room). strokeW/markerR scale with the plot's short side.
    const strokeW = Math.max(2, Math.round(Math.min(cr.w, cr.h) * 0.009));
    const markerR = Math.max(3, Math.round(strokeW * 1.5));
    const haloR = markerR + Math.max(1, Math.round(strokeW * 0.6));
    // Inset the data x-range and the top so the first/last/peak markers (and their
    // halos) sit fully inside the plot — otherwise edge markers poke out past the
    // curtain at t=0 (left) and clip against the card at the final state (right/top).
    const edgePad = (points.show ? haloR : strokeW) + 3;
    const topPad = Math.max(Math.round(H * 0.03), edgePad);

    const plotX = cr.x + tickRailW;
    const plotY = cr.y + topPad;
    const plotW = cr.x + cr.w - plotX;
    const plotH = cr.y + cr.h - catBandH - plotY;
    if (plotW < 24 || plotH < 24) {
      return Promise.resolve(makeErrorMosaic("plot area too small", { title: `${this.id}`, width: W, height: H }));
    }

    // ── Data → canvas px points (x inset by edgePad so end markers don't clip) ──
    const xInset = Math.min(edgePad, plotW * 0.45);
    const xAt = (i: number) => (N === 1 ? plotX + plotW / 2 : plotX + xInset + (i / (N - 1)) * (plotW - 2 * xInset));
    const yAt = (v: number) => plotY + (1 - Math.max(0, Math.min(1, (v - minValue) / denom))) * plotH;
    const points2: Pt[] = values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    const baselineY = plotY + plotH;
    // Smooth (Catmull-Rom) interpolation can OVERSHOOT past the data — a sharp drop
    // to the axis floor (e.g. a run of 0s) makes the spline dip BELOW the baseline,
    // reading as fake-negative data. Clamp the flattened polyline to the plot's
    // vertical bounds so neither under- nor over-shoot escapes the axes.
    const { poly: rawPoly } = curvePolyline(points2, curve);
    const poly: Pt[] = rawPoly.map((p) => ({ x: p.x, y: Math.max(plotY, Math.min(baselineY, p.y)) }));

    // ── Intro timing ──
    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introSec = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const animate = !anim.reduceMotion;

    const hasLine = poly.length >= 2;

    // ── Reveal strategy: CURTAIN WIPE ──
    // The chart marks (gridlines, area, line, markers, labels) are built STATIC —
    // exactly the reduceMotion layout, which packs cleanly and renders crisp. The
    // intro is ONE card-colored rectangle covering the plot that slides left→right
    // off the plot, uncovering the chart as it goes.
    //
    // Why not a per-segment line draw-on? That needs many overlapping ribbon
    // slivers; each spills to its own placeRects overlay layer, and past ~25 nested
    // overlay layers this engine starts dropping inline-masks (circle markers
    // collapse to their square bbox; text rasterizes to tofu). The curtain adds
    // exactly ONE overlay layer over the proven-clean static chart — no depth blow-up,
    // and a clean premium left→right wipe that reveals every mark together.
    const chartPieces: Piece[] = [];

    // Every same-color mark group is drawn as ONE multi-subpath mask, not one tile
    // per mark. This keeps the tile count flat as the data grows (N points add 0
    // tiles, not 2N+ ) — the desktop render executor expands each tile to its own
    // ffmpeg scaling pass, and a per-point tile explosion exhausted it ("Failed
    // initializing scaling graph: Resource temporarily unavailable").
    const gw = Math.max(1, Math.round(H * 0.0016));
    const axisW = Math.max(1, Math.round(H * 0.0022));
    const op = Math.max(0, Math.min(1, area.opacity));

    // ── Gridlines (one mask, all rows) + axis baseline (one mask) ──
    if (grid.show && gridCount >= 1) {
      const gys = Array.from({ length: gridCount + 1 }, (_, k) => yAt(minValue + (k / gridCount) * (maxValue - minValue)));
      const gbox = unionBBox(gys.map((gy) => ({ minX: plotX, maxX: plotX + plotW, minY: gy - gw / 2, maxY: gy + gw / 2 })));
      chartPieces.push(maskPiece(W, H, gbox, 0, theme.grid,
        (ox, oy) => gys.map((gy) => rectLocal(plotX - ox, gy - oy - gw / 2, plotW, gw)).join(" "),
        theme.gridAlpha < 1 ? { overlay: { alpha: `${theme.gridAlpha}` } } : {}));
    }
    chartPieces.push(maskPiece(W, H, { minX: plotX, maxX: plotX + plotW, minY: baselineY - axisW / 2, maxY: baselineY + axisW / 2 }, 1, theme.axis,
      (ox, oy) => rectLocal(plotX - ox, baselineY - oy - axisW / 2, plotW, axisW),
      theme.axisAlpha < 1 ? { overlay: { alpha: `${theme.axisAlpha}` } } : {}));

    // ── Area fill — soft translucent wash (opacity rides on overlay.alpha; makeColorTile ignores `visual`). ──
    if (area.show && hasLine) {
      const localPts = (ox: number, oy: number) => poly.map((p) => local(p, ox, oy));
      chartPieces.push(maskPiece(W, H, areaBBox(poly, baselineY), 2, lineColor,
        (ox, oy) => areaPolygonPath(localPts(ox, oy), baselineY - oy),
        { overlay: { alpha: `${op}` } }));
    }

    // ── Line — one tight mask of the whole (curve-flattened) polyline ──
    if (hasLine) {
      chartPieces.push(maskPiece(W, H, polylineStrokeBBox(poly, strokeW), 3, lineColor,
        (ox, oy) => polylineStrokePath(poly.map((p) => local(p, ox, oy)), strokeW)));
    }

    // ── Point markers — ALL halos as one mask, ALL dots as one mask (2 tiles total,
    //    not 2 per point); dots paint above halos for the stroked-marker look. ──
    if (points.show && points2.length > 0) {
      chartPieces.push(maskPiece(W, H, unionBBox(points2.map((p) => markerBBox(p, haloR))), 4, theme.card,
        (ox, oy) => points2.map((p) => circlePolyLocal(p.x - ox, p.y - oy, haloR)).join(" ")));
      chartPieces.push(maskPiece(W, H, unionBBox(points2.map((p) => markerBBox(p, markerR))), 5, lineColor,
        (ox, oy) => points2.map((p) => circlePolyLocal(p.x - ox, p.y - oy, markerR)).join(" ")));
    }

    // ── Y tick labels + X category labels — their OWN pack ──
    // Text cells that OVERLAP each other corrupt placeRects' per-band cursor walk
    // (it assumes non-overlapping rects), which renders labels as tofu boxes AND
    // can break sibling layers (the curtain stopped covering). Two guards: (1) keep
    // labels in their own pack so a label collision can't corrupt the chart marks;
    // (2) DECIMATE x-labels — show every k-th so the kept labels never overlap.
    const labelPieces: Piece[] = [];
    if (hasTicks) {
      for (let k = 0; k <= gridCount; k++) {
        const gv = minValue + (k / gridCount) * (maxValue - minValue);
        const gy = yAt(gv);
        labelPieces.push(textPiece(W, H, 0, cr.x + tickRailW * 0.5, gy, formatCompact(gv), tickFont, theme.muted, "center"));
      }
    }
    if (hasLabels) {
      const cy = baselineY + catBandH * 0.5;
      // Decimate so kept labels don't collide: step = ceil(widest label / spacing).
      const baseSpacing = N > 1 ? (plotW - 2 * xInset) / (N - 1) : plotW;
      const maxLabelChars = labels.reduce((m, l) => (l ? Math.max(m, l.length) : m), 0);
      const approxLabelW = maxLabelChars * catFont * 0.62 + catFont;
      const labelStep = Math.max(1, Math.ceil((approxLabelW + catFont * 0.5) / Math.max(1, baseSpacing)));
      for (let i = 0; i < N; i++) {
        if (i % labelStep !== 0) continue;
        if (!labels[i]) continue;
        labelPieces.push(textPiece(W, H, 0, xAt(i), cy, labels[i], catFont, theme.label, "center"));
      }
    }

    // ── Curtain: one plot-sized card-colored rect that slides right to reveal ──
    const curtainLayers: PackedLayer[] = [];
    if (animate) {
      // x-offset grows 0 → plotW over the intro (eased), sliding the cover off the
      // plot to the right; its trailing edge is the wipe line. The label rail/band
      // sit outside the plot rect, so they're never covered (always legible).
      // Pad the curtain UP by the marker halo (into the empty headroom) so a peak
      // marker at the top edge is fully covered at t=0; pad DOWN only a hair (to
      // cover the axis line) so the curtain never clips the x-label band beneath it.
      const cy = clampInt(plotY - (haloR + 3), 0, H - 1);
      const chh = clampInt(baselineY + strokeW + 2 - cy, 1, H - cy);
      // Slide the cover from x=0 (covers the plot) to x=+plotW (off to the right).
      const reveal = easingExpr(anim.ease, `min(1,max(0,t/${introSec}))`);
      const xExpr = `(${plotW})*(${reveal})`;
      const curtain: Piece = {
        rect: { x: plotX, y: cy, w: plotW, h: chh, claimant: "F", importance: 0 },
        source: makeColorTile(theme.card, { overlay: { xExpr } }),
      };
      curtainLayers.push(...packLayers(W, H, [curtain]));
    }

    // The static chart packs cleanly (it's the reduceMotion layout); labels pack
    // separately (decimated → non-overlapping); the curtain adds one overlay on top.
    const plotNode = chainLayers([
      ...packLayers(W, H, chartPieces),
      ...packLayers(W, H, labelPieces),
      ...curtainLayers,
    ]);
    const root = card.compose(EMPTY, plotNode);

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      sources: root.sources,
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument);
  },
};

registerTemplate(AlpineLineChart);
