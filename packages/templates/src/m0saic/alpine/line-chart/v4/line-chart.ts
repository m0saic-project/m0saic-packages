import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/line-chart/v4 — Alpine Line Chart, every mark a real cell
 * ============================================================================
 *
 * v3's picture and props (soft area fill, rounded line, point markers, value
 * rail, category labels, hairline gridlines, left→right curtain draw-on) with
 * the plot rebuilt so its geometry describes the chart. In v3 every mark in the
 * plot (the gridlines, the axis, the area, the line, the halos, the dots and
 * the curtain) was a mask that filled the WHOLE plot cell: seven full-plot
 * frames stacked on one rect, so a wireframe of the chart was one empty box.
 *
 * v4 maps the value scale to pixels once and places each mark at its exact
 * rect (placeInsetPieces): every gridline and the axis a row band at its
 * value's row, every point a real halo and dot cell centred on its value
 * (each dot bound to its `values[i]`), the x-ticks column bands on their
 * points. Only the curve and its fill stay plot-filling masks (a curve has no
 * rect), with the curtain over them. The plot is its own child at exactly its
 * size (5-smooth, so its lattice composes); the tick labels sit centred on
 * their gridlines in the rail, the category labels under their points.
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
  withLayoutContract,
  placeInsetPieces,
  floorToSmooth,
  type InsetPiece,
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeErrorMosaic,
  makeIncompleteMosaic,
  easingExpr,
  bindProp,
  bindProps,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { niceNum } from "@m0saic/dsl-stdlib";

import type { Pt } from "../../../charts/_shared/line";
import {
  curvePolyline,
  polylineStrokePath,
  areaPolygonPath,
} from "../../../charts/line-chart/v1/geometry";

import {
  alpineCard,
  EMPTY,
  textCell,
  tag,
  resolveColor,
  type Node,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { bBool, bStr, bFrac, bEnum, bNum, ALPINE_ANIM_FIELDS_BARE, ALPINE_ANIM_UNBOUND, ALPINE_THEME_UNBOUND, bindHeaderAddHandles, bindCardSurface } from "../../_shared/alpine-conventions";
import { addHandlesByLabel, sourcesOfTree } from "../../../_shared/canvas-handles";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Curve = "linear" | "smooth" | "stepped";
type DomainConfig = { minValue?: number; maxValue?: number };
type GridConfig = { show: boolean; count: number };
type AreaConfig = { show: boolean; opacity: number };
type PointsConfig = { show: boolean };
type AnimConfig = { reduceMotion: boolean; introFrac: number; ease: EaseName };

type AlpineLineChartV4Props = {
  values: number[];
  labels?: string[];
  title?: string;
  subtitle?: string;
  curve?: Curve;
  preset?: AlpinePreset;
  lineColor?: MosaicColor;
  grid?: GridConfig;
  area?: AreaConfig;
  points?: PointsConfig;
  domain?: DomainConfig;
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
  /** Small vertical ticks on the x-axis at each labeled data point (default true). */
  showTicks?: boolean;
  /** Dev-only layout contract: assert every x-axis tick sits on its data point's x. */
  debugLayout?: boolean;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_CURVE: Curve = "smooth";
const DEFAULT_GRID: GridConfig = { show: true, count: 4 };
const DEFAULT_AREA: AreaConfig = { show: true, opacity: 0.22 };
const DEFAULT_POINTS: PointsConfig = { show: true };
const DEFAULT_ANIM: AnimConfig = { introFrac: 0.7, ease: "easeOut", reduceMotion: false };

// ---------------------------------------------------------------------------
// Nice axis + formatting (same shape as v1)
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

const r2 = (v: number) => Math.round(v * 100) / 100;
/** A rectangle subpath in local coords (for gridlines / axis / thin rules). */
function rectLocal(x: number, y: number, w: number, h: number): string {
  return `M ${r2(x)} ${r2(y)} L ${r2(x + w)} ${r2(y)} L ${r2(x + w)} ${r2(y + h)} L ${r2(x)} ${r2(y + h)} Z`;
}
/** A circle as a many-sided polygon (survives temporal overlays; SVG arcs don't). */
function circlePolyLocal(cx: number, cy: number, rr: number, sides = 28): string {
  let d = "";
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    d += `${k === 0 ? "M" : "L"} ${r2(cx + Math.cos(a) * rr)} ${r2(cy + Math.sin(a) * rr)} `;
  }
  return d + "Z";
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineLineChartV4Props>({
  values: { type: "number[]", required: true, meta: { constraints: { minItems: 1 }, control: { flavor: "numberList" } } },
  labels: { type: "string[]", required: false },
  title: { type: "string", required: false },
  subtitle: { type: "string", required: false },
  curve: { type: "string", required: false, meta: { constraints: { oneOf: ["smooth", "linear", "stepped"] } } },
  preset: { type: "string", required: false, meta: { constraints: { oneOf: ["light", "dark"] } } },
  lineColor: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true, defaultColor: "#2563EB" } } },

  grid: {
    type: "group" as any, required: false,
    fields: { show: bBool(), count: bNum({ flavor: "slider", step: 1 }, { min: 2, max: 8 }) },
  } as any,
  area: {
    type: "group" as any, required: false,
    fields: { show: bBool(), opacity: bFrac() },
  } as any,
  points: {
    type: "group" as any, required: false,
    fields: { show: bBool() },
  } as any,
  showTicks: { type: "boolean", required: false },
  domain: {
    type: "group" as any, required: false,
    fields: {
      minValue: bNum(),
      maxValue: bNum(),
    },
  } as any,
  anim: {
    type: "group" as any, required: false,
    fields: { reduceMotion: ALPINE_ANIM_FIELDS_BARE.reduceMotion, introFrac: ALPINE_ANIM_FIELDS_BARE.introFrac, ease: bEnum(["easeOut", "smoothstep", "easeInOut", "linear"]) },
  } as any,
  theme: {
    type: "group" as any, required: false,
    fields: { slug: bStr(), preset: bStr(), namespace: bStr(), forceFetch: bBool() },
  } as any,
  debugLayout: { type: "boolean", required: false },
});

export const AlpineLineChartV4: MosaicTemplate<AlpineLineChartV4Props> = {
  id: asTemplateId("@m0saic/alpine/line-chart/v4"),
  version: 4,
  capabilities: { tier: "core" },
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000, posterTimeMs: 1900 },
  bindings: { unbound: { ...ALPINE_THEME_UNBOUND, ...ALPINE_ANIM_UNBOUND } },
  propsSchema,

  defaultProps: {
    showTicks: true,
    debugLayout: false,
    theme: { forceFetch: false },
    values: [12, 19, 15, 25, 22, 30, 28, 36],
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"],
    title: "LINE CHART",
    subtitle: "Monthly Active Users",
    curve: DEFAULT_CURVE,
    preset: DEFAULT_PRESET,
    grid: DEFAULT_GRID,
    area: DEFAULT_AREA,
    points: DEFAULT_POINTS,
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineLineChartV4Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    const values = (props.values ?? []).filter((v) => Number.isFinite(v));
    if (values.length === 0) {
      return makeIncompleteMosaic("Add a value — one number per point on the line.", { title: "Line Chart", width: W, height: H });
    }

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

    // ── Card chrome → content rect: the shared alpine card's surface and header; the chart body rides above them as
    //    one full-canvas layer of exact pieces (placeInsetPieces), the plot its own child at exactly its size. ──
    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const C = card.contentRect;

    const tickFont = Math.max(10, Math.round(H * 0.019));
    const catFont = Math.max(10, Math.round(H * 0.02));
    const hasTicks = grid.show;
    const showTicks = props.showTicks !== false;
    const tickRailWpx = hasTicks ? Math.max(Math.round(C.w * 0.07), tickFont * 3) : Math.round(C.w * 0.01);
    const catBandHpx = hasLabels ? Math.round(catFont * 2) : 0;

    // Mark sizing (v3's).
    const strokeW = Math.max(2, Math.round(Math.min(C.w, C.h) * 0.009));
    const markerR = Math.max(3, Math.round(strokeW * 1.5));
    const haloR = markerR + Math.max(1, Math.round(strokeW * 0.6));
    const topPadPx = Math.max(Math.round(H * 0.03), (points.show ? haloR : strokeW) + 3);

    type Px = { x: number; y: number; w: number; h: number };
    // The plot is its own canvas (the child below): 5-smooth on both axes, so its pieces sit on a composable lattice;
    // the few pixels this gives up go above the plot (the height) and to its right (the width).
    const rawPlot: Px = { x: C.x + tickRailWpx, y: C.y + topPadPx, w: Math.max(1, C.w - tickRailWpx), h: Math.max(1, C.h - topPadPx - catBandHpx) };
    if (rawPlot.w < 24 || rawPlot.h < 24) {
      return Promise.resolve(makeErrorMosaic("plot area too small", { title: `${this.id}`, width: W, height: H }));
    }
    const plotW = floorToSmooth(rawPlot.w);
    const plotH = floorToSmooth(rawPlot.h);
    const plot: Px = { x: rawPlot.x, y: rawPlot.y + (rawPlot.h - plotH), w: plotW, h: plotH };

    // ── The scale, once: data → PLOT-LOCAL px (v3's insets: the end markers stay inside the plot). A gridline is the
    //    row of its value, rounded once; a point's centre is its value's exact position on the same scale. ──
    const marginY = points.show ? haloR + 1 : strokeW;
    const xInset = Math.min((points.show ? haloR : strokeW) + 2, plotW * 0.45);
    const xAt = (i: number) => (N === 1 ? plotW / 2 : xInset + (i / (N - 1)) * (plotW - 2 * xInset));
    const yAt = (v: number) => marginY + (1 - Math.max(0, Math.min(1, (v - minValue) / denom))) * (plotH - 2 * marginY);
    const pts: Pt[] = values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    const baselineY = yAt(minValue);
    const { poly: rawPoly } = curvePolyline(pts, curve);
    const poly: Pt[] = rawPoly.map((p) => ({ x: p.x, y: Math.max(marginY, Math.min(baselineY, p.y)) }));
    const hasLine = poly.length >= 2;

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introSec = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const animate = !anim.reduceMotion;

    const gw = Math.max(1, Math.round(H * 0.0016));
    const axisW = Math.max(1, Math.round(H * 0.0022));
    const op = Math.max(0, Math.min(1, area.opacity));

    // The x-ticks ride above the curtain (v3 drew them after it): they anchor the labels from the first frame.
    const Z = { grid: 0, area: 1, line: 2, axis: 3, halo: 4, dot: 5, curtain: 6, tick: 7 };
    const rootPieces: InsetPiece[] = [];
    const plotPieces: InsetPiece[] = [];
    const put = (list: InsetPiece[], r: Px, importance: number, source: MosaicSource): void => {
      const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
      if (w >= 1 && h >= 1) list.push({ rect: { x, y, w, h, importance }, source });
    };
    /**
     * A line as a BAND: the piece is the line plus `LINE_PAD` px either side, and the source draws the line itself at
     * its exact thickness, centred in the band. A one-pixel piece would force the placement lattice down to single
     * pixels on its axis, and a per-pixel lattice only parses at its own size.
     */
    const LINE_PAD = 5;
    const lineSource = (color: MosaicColor, opacity: number, axis: "row" | "col", thickness: number): MosaicSource => ({
      type: "lavfi", color, fitMode: "content", visual: { opacity },
      size: axis === "row" ? { wExpr: "TW", hExpr: String(thickness) } : { wExpr: String(thickness), hExpr: "TH" },
      placement: { fit: "contain", hAlign: "center", vAlign: "middle" },
    }) as unknown as MosaicSource;
    /** A row line `t` px thick centred on row `cy` (its first row cy - floor((t-1)/2)), spanning [x, x + w). */
    const rowLine = (list: InsetPiece[], cy: number, t: number, x: number, w: number, importance: number, color: MosaicColor, opacity: number): void =>
      put(list, { x, y: cy - Math.floor((t - 1) / 2) - LINE_PAD, w, h: t + 2 * LINE_PAD }, importance, lineSource(color, opacity, "row", t));
    /** A plot-filling mask (the curve, its fill): paths in plot-local coordinates. */
    const bounds = { x: 0, y: 0, width: plotW, height: plotH } as const;
    const plotMask = (color: MosaicColor, localPath: string, overlayObj?: Record<string, unknown>): MosaicSource =>
      makeColorTile(color, { mask: { kind: "inline-mask", localPath, bounds } as any, ...(overlayObj ? { overlay: overlayObj } : {}) }) as MosaicSource;
    const full: Px = { x: 0, y: 0, w: plotW, h: plotH };

    // Gridlines — one row band each, at the tick values' rows.
    if (grid.show && gridCount >= 1) {
      for (let k = 0; k <= gridCount; k++) {
        rowLine(plotPieces, Math.round(yAt(minValue + (k / gridCount) * (maxValue - minValue))), gw, 0, plotW, Z.grid, theme.grid, theme.gridAlpha);
      }
    }
    // Every mark painted with `lineColor` (area fill, line, dots) binds it — Make's colour picker on double-click.
    if (area.show && hasLine) {
      put(plotPieces, full, Z.area, bindProps(plotMask(lineColor, areaPolygonPath(poly, baselineY), { alpha: `${op}` }), [{ propKey: "lineColor" }, { propKey: "area.opacity" }]));
    }
    if (hasLine) put(plotPieces, full, Z.line, bindProp(plotMask(lineColor, polylineStrokePath(poly, strokeW)), "lineColor"));
    // Axis baseline — one row band.
    rowLine(plotPieces, Math.round(baselineY), axisW, 0, plotW, Z.axis, theme.axis, theme.axisAlpha);
    // Point markers — each a real cell: a card-coloured halo and the dot over it, centred on the point's exact place.
    // The dot IS values[i]'s visual → bound to it (and its colour to `lineColor`).
    if (points.show) {
      pts.forEach((p, i) => {
        const halo = makeColorTile(theme.card, { effects: { rounding: { cornerStyle: "pill" } } }) as MosaicSource;
        put(plotPieces, { x: p.x - haloR, y: p.y - haloR, w: 2 * haloR, h: 2 * haloR }, Z.halo, halo);
        const dot = makeColorTile(lineColor, { effects: { rounding: { cornerStyle: "pill" } } }) as MosaicSource;
        (dot as MosaicSource & { editor?: { label?: string } }).editor = { label: "point" };
        put(plotPieces, { x: p.x - markerR, y: p.y - markerR, w: 2 * markerR, h: 2 * markerR }, Z.dot, bindProps(dot, [{ propKey: "values", index: i }, { propKey: "lineColor" }]));
      });
    }

    // Kept (decimated) label indices (v3's): the ticks render at exactly the labelled positions.
    const keptIdx: number[] = [];
    if (hasLabels) {
      const baseSpacingK = N > 1 ? (plotW - 2 * xInset) / (N - 1) : plotW;
      const maxLabelCharsK = labels.reduce((m, l) => (l ? Math.max(m, l.length) : m), 0);
      const approxLabelWK = maxLabelCharsK * catFont * 0.72 + catFont; // 0.72em = CLI rasterizer width
      const labelStepK = Math.max(1, Math.ceil((approxLabelWK + catFont * 0.5) / Math.max(1, baseSpacingK)));
      for (let i = 0; i < N; i++) if (i % labelStepK === 0 && labels[i]) keptIdx.push(i);
    }

    // ── X-axis ticks: slim vertical strokes hanging from the axis inside the plot, one per labelled point, each a
    //    column band centred on its point's x (the band's source draws the 3 px stroke). ──
    const tickXs: number[] = [];
    if (showTicks && keptIdx.length >= 2) {
      const tickHpx = Math.max(6, Math.round(H * 0.012));
      const top = Math.round(baselineY + axisW / 2);
      const h = Math.max(1, Math.min(tickHpx, plotH - top));
      for (const i of keptIdx) {
        const cx = Math.round(xAt(i));
        tickXs.push(cx);
        const tickTile = { ...(lineSource(theme.axis, theme.axisAlpha, "col", 3) as object), editor: { label: "x-tick" } } as unknown as MosaicSource;
        put(plotPieces, { x: cx - 1 - LINE_PAD, y: top, w: 3 + 2 * LINE_PAD, h }, Z.tick, tickTile);
      }
    }

    // Curtain — one card-coloured tile over the plot that slides right off it (left→right reveal), clipped by the
    // plot child.
    if (animate) {
      const reveal = easingExpr(anim.ease, `min(1,max(0,t/${introSec}))`);
      put(plotPieces, full, Z.curtain, makeColorTile(theme.card, { overlay: { xExpr: `(w)*(${reveal})` } }) as MosaicSource);
    }

    // ── Value rail (y ticks): each label centred on its gridline's row. ──
    const railLabelH = Math.round(tickFont * 1.8);
    if (hasTicks) {
      for (let k = 0; k <= gridCount; k++) {
        const tv = minValue + (k / gridCount) * (maxValue - minValue);
        const cy = plot.y + Math.round(yAt(tv));
        const src = tag(textCell(formatCompact(tv), tickFont, theme.muted, "right"), "y-tick-label") as MosaicSource;
        put(rootPieces, { x: C.x, y: cy - railLabelH / 2, w: Math.round(tickRailWpx * 0.84), h: railLabelH }, 1, src);
      }
    }

    // ── Category band (x labels, v3's): decimated so kept labels never overlap; interior labels centred on their
    //    point, the edge labels aligned inward. ──
    if (hasLabels) {
      const baseSpacing = N > 1 ? (plotW - 2 * xInset) / (N - 1) : plotW;
      const maxLabelChars = labels.reduce((m, l) => (l ? Math.max(m, l.length) : m), 0);
      const approxLabelW = maxLabelChars * catFont * 0.72 + catFont;
      const labelStep = Math.max(1, Math.ceil((approxLabelW + catFont * 0.5) / Math.max(1, baseSpacing)));
      const cellW = Math.min(plotW, Math.max(catFont * 2, Math.round(baseSpacing * labelStep)));
      for (let i = 0; i < N; i++) {
        if (i % labelStep !== 0 || !labels[i]) continue;
        const cx = xAt(i);
        const nearLeft = cx < cellW / 2;
        const nearRight = cx > plotW - cellW / 2;
        const left = nearLeft ? 0 : nearRight ? plotW - cellW : Math.max(0, Math.min(plotW - cellW, Math.round(cx - cellW / 2)));
        const align = nearLeft ? "left" as const : nearRight ? "right" as const : "center" as const;
        const labelSrc = textCell(labels[i], catFont, theme.label, align) as MosaicSource;
        (labelSrc as MosaicSource & { editor?: { label?: string } }).editor = { label: "x-label" };
        // The kept label IS labels[i] → bound at its ORIGINAL index (decimation skips indices, never renumbers them).
        put(rootPieces, { x: plot.x + left, y: plot.y + plotH, w: cellW, h: catBandHpx }, 1, bindProp(labelSrc, "labels", i));
      }
    }

    // The plot as its own child document at exactly its size (it clips the curtain as it slides). Its ground is the
    // card's colour: a nested child renders opaque, so an unpainted ground would show black once the curtain is off.
    const placedPlot = placeInsetPieces({ rootW: plotW, rootH: plotH, pieces: plotPieces });
    const childDocs: Record<string, MosaicDocument> = {
      plot: {
        kind: "mosaic_document", version: 1, assets: {} as any,
        m0: placedPlot.m0 as any, sources: placedPlot.sources,
        size: { width: plotW, height: plotH }, fps: ctx.target.fps, durationMs: ctx.target.durationMs,
        backgroundColor: theme.card,
      } as MosaicDocument,
    };
    put(rootPieces, plot, 1, { type: "mosaic", ref: "plot" } as unknown as MosaicSource);
    const body = placeInsetPieces({ rootW: W, rootH: H, pieces: rootPieces });
    const bodyLayer: Node = { m0: String(body.m0), sources: body.sources as MosaicSource[] };
    const root = card.compose(EMPTY, bodyLayer);

    // ── v3: more handles on the rects v2 built. A y-axis tick shows the grid's
    //    density and the domain it spans. ──
    const all = sourcesOfTree(root.sources as MosaicSource[], childDocs);
    addHandlesByLabel(all, {
      "y-tick-label": [{ propKey: "grid.count" }, { propKey: "domain.minValue" }, { propKey: "domain.maxValue" }],
    });
    bindHeaderAddHandles(all, props, ["x-label", "y-tick-label"]);

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      // The card surface is a handle for `preset` (bindCardSurface) — a full-canvas
      // card that nothing binds is a dead click target (founder, 2026-10-01).
      sources: bindCardSurface(root.sources),
      children: childDocs,
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // Dev tripwire — the founder-ruled alignment guarantee: every x-tick sits
    // on its data point's x. GROUP-RELATIVE (span fractions of the tick row
    // itself): the ticks share their rail-offset weights with the plot cell,
    // so the group's origin is structurally aligned with the dots; the only
    // possible failure is a tick displaced WITHIN the band — exactly what the
    // frac lock catches, with no canvas-space origin model to drift.
    const expectedTickFracs = tickXs.length >= 2
      ? tickXs.map((x) => (x - tickXs[0]) / Math.max(1e-6, tickXs[tickXs.length - 1] - tickXs[0]))
      : [];
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/line-chart/v4",
        relations: [],
        // 0.06, not 0.02: with points/area OFF the contract's frames↔sources
        // zip mis-pairs boxes by up to ~0.04 of span at small canvases (the
        // measurement-channel candidate, the internal contract-frame-zip-misalignment
        // notes). The class this guards — a tick a full
        // spacing off its point — is ≥0.14 of span, still 2.3× the tolerance.
        constraints: [
          ...(expectedTickFracs.length
            ? [{ label: "x-tick", xCentersFrac: expectedTickFracs, centerToleranceFrac: 0.06 }]
            : []),
          // Text-fit tripwires: a kept category label, rail value, or header
          // that clips at the CLI's wider metrics reds the debug wireframe
          // (the Make-passes-render-breaks class, caught statically).
          ...card.constraints,
          ...(hasLabels && keptIdx.length > 0 ? [{ label: "x-label", textFits: {} }] : []),
          ...(hasTicks ? [{ label: "y-tick-label", textFits: { charWidthEm: 0.62 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },
  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // template's own static default render, INLINED flat (gate-15/21 keeper).
  async renderCover(_props: AlpineLineChartV4Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const hero = (await AlpineLineChartV4.render(
      {
        ...(AlpineLineChartV4.defaultProps as AlpineLineChartV4Props),
        anim: { ...DEFAULT_ANIM, reduceMotion: true },
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
      hero: (theme) => onboardingFrame(inlineHeroDoc(hero), theme.borderStrong),
      heroAssets: hero.assets,
      children: (hero as { children?: Record<string, MosaicDocument> }).children,
    });
  },
};

registerTemplate(AlpineLineChartV4);
