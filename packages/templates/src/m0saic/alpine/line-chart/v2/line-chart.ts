import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/line-chart/v2 — Alpine Line Chart (RATIO rebuild)
 * ============================================================================
 *
 * Same picture as v1 — soft area fill, rounded line, point markers, value rail,
 * category labels, hairline gridlines, left→right curtain draw-on — but rebuilt
 * as a RATIO layout instead of absolute full-canvas `placeRects`.
 *
 * v1 packed every mark as a TIGHT cell-local inline-mask placed directly on the
 * full canvas via `placeRects`, so a single pixel coordinate system aligned them
 * — but that pinned precision to the canvas (audit: ABSOLUTE, slope 1.08). v2
 * keeps the single-coordinate-system idea but scopes it to a ratio-positioned
 * PLOT CELL: the gridlines, axis, area, line and markers are inline-masks that
 * FILL that cell with paths in PLOT-LOCAL coordinates, so they register exactly
 * (a mask's path is relative to its own cell) while the cell is a plain ratio
 * split → bounded precision. The value rail + category band are sibling ratio
 * cells whose label positions are inset to the SAME plot fractions, so ticks
 * line up with the gridlines and category labels line up with the points. The
 * curtain is one card-colored tile in the plot cell that slides off via `xExpr`.
 *
 * This is the "mask-in-a-cell" fix (see kpi-card/v2's sparkline) applied to a
 * full chart: connected curve geometry stays exact, yet nothing pins the canvas.
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
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeErrorMosaic,
  easingExpr,
  bindProp,
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
  paint,
  rowSplit,
  colSplit,
  overlay,
  insetNode,
  textCell,
  tag,
  resolveColor,
  type Node,
  type Band,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { ALPINE_ANIM_FIELDS, fBool, fNum, fFrac, fStr, fEnum } from "../../_shared/alpine-anim";
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

type AlpineLineChartV2Props = {
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

const propsSchema = definePropsSchema<AlpineLineChartV2Props>({
  values: { type: "number[]", required: true, description: "Numeric series driving the line (left→right).", meta: { constraints: { minItems: 1 }, control: { flavor: "numberList" }, ui: { label: "Values", order: 1 } } },
  labels: { type: "string[]", required: false, description: "Category labels (index-aligned to values) along the x-axis.", meta: { ui: { label: "Category Labels", order: 2, primary: true } } },
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., LINE CHART" }, ui: { label: "Title", order: 3 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { control: { placeholder: "e.g., Monthly Active Users" }, ui: { label: "Subtitle", order: 4 } } },
  curve: { type: "string", required: false, description: "Interpolation between points.", meta: { constraints: { oneOf: ["smooth", "linear", "stepped"] }, ui: { label: "Curve", order: 5 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 6 } } },
  lineColor: { type: "string", required: false, description: "Line + marker color. Defaults to the resolved theme primary.", meta: { constraints: { isColor: true }, control: { placeholder: "theme primary", colorPicker: true, defaultColor: "#2563EB" }, ui: { label: "Line Color", order: 7 } } },

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
  showTicks: { type: "boolean", required: false, description: "Small vertical ticks on the x-axis at each labeled data point (classic chart look). Default true.", meta: { ui: { label: "Axis ticks", order: 10 } } },
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
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract view: renders the contract wireframe instead of the chart — x-axis ticks GREEN when each sits on its data point's x, offenders RED. Deterministic false default; production never sets it.", meta: { ui: { label: "Debug layout", order: 13 } } },
});

export const AlpineLineChartV2: MosaicTemplate<AlpineLineChartV2Props> = {
  id: asTemplateId("@m0saic/alpine/line-chart/v2"),
  label: "Alpine Line Chart",
  version: 2,
  description: "Alpine line/area chart — friendly mobile-marketing card: soft area fill, rounded line, point markers, value rail, left→right draw-on. Standalone Alpine brand flavor. v2 rebuilds the geometry as a ratio layout (plot marks are masks filling a ratio plot cell in plot-local coords) so it composes at any canvas without the absolute-placement precision blowup.",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "alpine", "line-chart", "animated", "analysts", "developers", "trend", "dashboard"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000 },
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

  async render(props: AlpineLineChartV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    const values = (props.values ?? []).filter((v) => Number.isFinite(v));
    if (values.length === 0) {
      return makeErrorMosaic("values[] must be non-empty", { title: `${this.id} props`, width: W, height: H });
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

    // ── Card chrome → content rect ──
    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    const tickFont = Math.max(10, Math.round(H * 0.019));
    const catFont = Math.max(10, Math.round(H * 0.02));
    const hasTicks = grid.show;
    const tickRailWpx = hasTicks ? Math.max(Math.round(cr.w * 0.07), tickFont * 3) : Math.round(cr.w * 0.01);
    const catBandHpx = hasLabels ? Math.round(catFont * 2) : 0;

    // Mark sizing.
    const strokeW = Math.max(2, Math.round(Math.min(cr.w, cr.h) * 0.009));
    const markerR = Math.max(3, Math.round(strokeW * 1.5));
    const haloR = markerR + Math.max(1, Math.round(strokeW * 0.6));
    const topPadPx = Math.max(Math.round(H * 0.03), (points.show ? haloR : strokeW) + 3);

    // ── Plot cell px dims (the ratio cell the marks fill; used for plot-local coords) ──
    const plotW = Math.max(1, cr.w - tickRailWpx);
    const showTicks = props.showTicks !== false;
    const plotH = Math.max(1, cr.h - topPadPx - catBandHpx);
    if (plotW < 24 || plotH < 24) {
      return Promise.resolve(makeErrorMosaic("plot area too small", { title: `${this.id}`, width: W, height: H }));
    }

    // ── Data → PLOT-LOCAL px points. y inset by the marker halo so end markers stay
    //    inside the plot-cell mask bounds; x inset so first/last markers don't clip. ──
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

    // ── A plot-cell mask: fills the plot cell, path authored in plot-local coords ──
    const bounds = { x: 0, y: 0, width: plotW, height: plotH } as const;
    const plotMask = (color: MosaicColor, localPath: string, overlayObj?: Record<string, unknown>): MosaicSource =>
      makeColorTile(color, { mask: { kind: "inline-mask", localPath, bounds } as any, ...(overlayObj ? { overlay: overlayObj } : {}) }) as MosaicSource;

    const gw = Math.max(1, Math.round(H * 0.0016));
    const axisW = Math.max(1, Math.round(H * 0.0022));
    const op = Math.max(0, Math.min(1, area.opacity));

    // ── Plot overlay layers (all fill the plot cell; one shared coordinate system) ──
    const plotLayers: Node[] = [];
    // Gridlines — one mask, all rows (at the tick y's).
    if (grid.show && gridCount >= 1) {
      const gys = Array.from({ length: gridCount + 1 }, (_, k) => yAt(minValue + (k / gridCount) * (maxValue - minValue)));
      plotLayers.push(paint(plotMask(theme.grid, gys.map((gy) => rectLocal(0, gy - gw / 2, plotW, gw)).join(" "),
        theme.gridAlpha < 1 ? { alpha: `${theme.gridAlpha}` } : undefined)));
    }
    // Axis baseline — one mask.
    plotLayers.push(paint(plotMask(theme.axis, rectLocal(0, baselineY - axisW / 2, plotW, axisW),
      theme.axisAlpha < 1 ? { alpha: `${theme.axisAlpha}` } : undefined)));
    // Every mask painted with `lineColor` (area fill, line, marker dots) binds it —
    // Make's color picker on double-click (1:N; the halos are card-colored, the
    // grid / axis theme-colored → unbound). Values stay unbound: the marks are
    // combined masks, no per-value rect.
    // Area fill.
    if (area.show && hasLine) {
      plotLayers.push(paint(bindProp(plotMask(lineColor, areaPolygonPath(poly, baselineY), { alpha: `${op}` }), "lineColor")));
    }
    // Line.
    if (hasLine) {
      plotLayers.push(paint(bindProp(plotMask(lineColor, polylineStrokePath(poly, strokeW)), "lineColor")));
    }
    // Point markers — halos then dots (2 masks total, not 2 per point).
    if (points.show && pts.length > 0) {
      plotLayers.push(paint(plotMask(theme.card, pts.map((p) => circlePolyLocal(p.x, p.y, haloR)).join(" "))));
      plotLayers.push(paint(bindProp(plotMask(lineColor, pts.map((p) => circlePolyLocal(p.x, p.y, markerR)).join(" ")), "lineColor")));
    }
    // Curtain — one card-colored tile that slides right off the plot (left→right reveal).
    if (animate) {
      const reveal = easingExpr(anim.ease, `min(1,max(0,t/${introSec}))`);
      plotLayers.push(paint(makeColorTile(theme.card, { overlay: { xExpr: `(w)*(${reveal})` } }) as MosaicSource));
    }
    // Kept (decimated) label indices — computed early so the TICKS render at
    // exactly the labeled positions (a tick per data point broke the flat
    // tile-count invariant at high N, and served nothing: the ticks exist to
    // anchor the LABELS to their points).
    const keptIdx: number[] = [];
    if (hasLabels) {
      const baseSpacingK = N > 1 ? (plotW - 2 * xInset) / (N - 1) : plotW;
      const maxLabelCharsK = labels.reduce((m, l) => (l ? Math.max(m, l.length) : m), 0);
      const approxLabelWK = maxLabelCharsK * catFont * 0.72 + catFont; // 0.72em = CLI rasterizer width
      const labelStepK = Math.max(1, Math.ceil((approxLabelWK + catFont * 0.5) / Math.max(1, baseSpacingK)));
      for (let i = 0; i < N; i++) if (i % labelStepK === 0 && labels[i]) keptIdx.push(i);
    }

    // ── X-axis ticks: slim VERTICAL strokes hanging from the axis line
    //    INSIDE the plot (the founder-ruled classic look; the earlier separate
    //    band floated as horizontal dashes). One REAL rect per LABELED point,
    //    authored at the serializer's 120 basis (emitted = intended); the tile
    //    slims to ~3px via a SYMMETRIC x inset, which cannot move its center —
    //    so the contract's span-frac lock measures the true position. ──
    const TICK_BASIS = 120;
    const tickCenterU: number[] = [];
    const tickNodes: Node[] = [];
    if (showTicks && keptIdx.length >= 2) {
      const tickHpx = Math.max(6, Math.round(H * 0.012));
      const topU = Math.max(0, Math.min(TICK_BASIS - 2, Math.round(((baselineY + axisW / 2) / plotH) * TICK_BASIS)));
      const tickHU = Math.max(2, Math.round((tickHpx / plotH) * TICK_BASIS));
      const cellWpx = plotW / TICK_BASIS;
      const slimInsetX = Math.max(0, Math.min(0.45, (1 - 3 / Math.max(3, cellWpx)) / 2));
      for (const i of keptIdx) {
        const leftU = Math.max(0, Math.min(TICK_BASIS - 1, Math.round((xAt(i) / plotW) * TICK_BASIS - 0.5)));
        tickCenterU.push(leftU + 0.5);
        const tickTile = makeColorTile(theme.axis, {
          overlay: { alpha: `${theme.axisAlpha}` },
          ...(slimInsetX > 0 ? { placement: { inset: { x: slimInsetX } } } : {}),
        }) as MosaicSource;
        // "x-tick" tag = the layout contract's join key (span-frac position lock).
        (tickTile as MosaicSource & { editor?: { label?: string } }).editor = { label: "x-tick" };
        const col = colSplit([
          ...(leftU > 0 ? [{ weight: leftU, node: EMPTY }] : []),
          { weight: 1, node: paint(tickTile) },
          ...(TICK_BASIS - 1 - leftU > 0 ? [{ weight: TICK_BASIS - 1 - leftU, node: EMPTY }] : []),
        ]);
        tickNodes.push(rowSplit([
          ...(topU > 0 ? [{ weight: topU, node: EMPTY }] : []),
          { weight: tickHU, node: col },
          ...(TICK_BASIS - topU - tickHU > 0 ? [{ weight: TICK_BASIS - topU - tickHU, node: EMPTY }] : []),
        ]));
      }
    }

    for (const t of tickNodes) plotLayers.push(t);
    const plotCell = overlay(plotLayers);

    // ── Value rail (y ticks): each label inset to the SAME plot fraction as its
    //    gridline, so ticks line up with the lines. ──
    const railLabelH = Math.round(tickFont * 1.8);
    const tickRail: Node = hasTicks
      ? overlay(
          Array.from({ length: gridCount + 1 }, (_, k): Node => {
            const tv = minValue + (k / gridCount) * (maxValue - minValue);
            const cy = yAt(tv); // plot-local center (rail shares the plot cell's height)
            const top = Math.max(0, Math.min(plotH - railLabelH, Math.round(cy - railLabelH / 2)));
            return insetNode(paint(tag(textCell(formatCompact(tv), tickFont, theme.muted, "right"), "y-tick-label")),
              top, Math.round(tickRailWpx * 0.16), plotH - top - railLabelH, 0, tickRailWpx, plotH);
          }),
        )
      : EMPTY;

    // ── Category band (x labels): decimate so kept labels never overlap; each inset
    //    to its point's plot fraction so labels sit under the markers. ──
    let catBand: Node = EMPTY;
    if (hasLabels) {
      const baseSpacing = N > 1 ? (plotW - 2 * xInset) / (N - 1) : plotW;
      const maxLabelChars = labels.reduce((m, l) => (l ? Math.max(m, l.length) : m), 0);
      const approxLabelW = maxLabelChars * catFont * 0.72 + catFont; // 0.72em = CLI rasterizer width
      const labelStep = Math.max(1, Math.ceil((approxLabelW + catFont * 0.5) / Math.max(1, baseSpacing)));
      // Cells span the KEPT pitch (labelStep × spacing), NOT the per-point
      // spacing — the old cells passed the app's narrow rasterizer but the
      // CLI's wider metrics clipped "W11"→"N11" at 40 points (gate-8
      // founder catch: Make-vs-render diff).
      const colW = Math.max(catFont * 2, Math.round(baseSpacing * labelStep));
      const kept: Node[] = [];
      for (let i = 0; i < N; i++) {
        if (i % labelStep !== 0 || !labels[i]) continue;
        const cx = xAt(i); // plot-local (cat band shares the plot cell's width)
        // Interior labels center ON their point. EDGE labels align INWARD
        // (first left-aligned at the plot edge, last right-aligned) with a
        // full-width cell — the classic chart treatment: an edge-shrunk cell
        // kept the center on the point but left less room than the text
        // needs (the text-fit contract caught 25px cells for 40px labels);
        // the axis TICK carries the exact point anchor either way.
        const cellW = colW;
        const nearLeft = cx < cellW / 2;
        const nearRight = cx > plotW - cellW / 2;
        const left = nearLeft ? 0 : nearRight ? plotW - cellW : Math.max(0, Math.min(plotW - cellW, Math.round(cx - cellW / 2)));
        const align = nearLeft ? "left" as const : nearRight ? "right" as const : "center" as const;
        const labelSrc = textCell(labels[i], catFont, theme.label, align) as MosaicSource;
        // "x-label" tag = the layout contract's join key (text-fit lock).
        (labelSrc as MosaicSource & { editor?: { label?: string } }).editor = { label: "x-label" };
        // The kept label IS labels[i] → bound at its ORIGINAL index (decimation
        // skips indices, never renumbers them) so Make edits the right element.
        kept.push(insetNode(paint(bindProp(labelSrc, "labels", i)),
          0, plotW - left - cellW, 0, left, plotW, catBandHpx));
      }
      catBand = kept.length ? overlay(kept) : EMPTY;
    }

    // ── X-axis ticks: one REAL rect per data point, centered at xAt(i). The
    //    points themselves are mask-drawn (unmeasurable) — the ticks are the
    //    contract's measurable proxy for the whole x alignment. ──
    // ── Assemble: [topPad] / [tickRail | plotCell] / [catRail-gap | catBand] ──
    const wH = (px: number) => Math.max(1, Math.round((px / cr.h) * 100));
    const bodyNode: Node = hasTicks
      ? colSplit([
          { weight: Math.max(1, Math.round((tickRailWpx / cr.w) * 100)), node: tickRail },
          { weight: Math.max(1, 100 - Math.round((tickRailWpx / cr.w) * 100)), node: plotCell },
        ])
      : plotCell;
    const catRow: Node = hasLabels
      ? colSplit([
          { weight: Math.max(1, Math.round((tickRailWpx / cr.w) * 100)), node: EMPTY },
          { weight: Math.max(1, 100 - Math.round((tickRailWpx / cr.w) * 100)), node: catBand },
        ])
      : EMPTY;

    const contentBands: Band[] = [{ weight: wH(topPadPx), node: EMPTY }, { weight: wH(plotH), node: bodyNode }];
    if (catBandHpx > 0) contentBands.push({ weight: wH(catBandHpx), node: catRow });
    const content = rowSplit(contentBands);

    const root = card.compose(content);

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      sources: root.sources,
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
    const expectedTickFracs = tickCenterU.length >= 2
      ? tickCenterU.map((u) => (u - tickCenterU[0]) / Math.max(1e-6, tickCenterU[tickCenterU.length - 1] - tickCenterU[0]))
      : [];
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/line-chart/v2",
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
  async renderCover(_props: AlpineLineChartV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const hero = (await AlpineLineChartV2.render(
      {
        ...(AlpineLineChartV2.defaultProps as AlpineLineChartV2Props),
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

registerTemplate(AlpineLineChartV2);
