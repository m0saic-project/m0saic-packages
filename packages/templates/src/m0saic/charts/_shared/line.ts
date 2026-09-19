/**
 * ============================================================================
 * @m0saic/charts/_shared/line — line-series geometry + canonical SVG
 * ============================================================================
 *
 * Turns tabular data into line-chart geometry (the math), then into a clean,
 * canonical SVG (the rendering). Normalization is kept strictly separate from
 * drawing so the same projected geometry can drive either this SVG path or
 * m0saic engine sources.
 *
 * The visual baseline mirrors the default Chart.js line chart: white ground,
 * light grid, a single readable stroked line with round points, month labels,
 * readable y ticks, title + subtitle + a small series legend.
 * ============================================================================
 */

import { categoryCenters, formatTick, linearScale, project, type LinearScale } from "./scale";

export type Pt = { x: number; y: number };

export type SeriesInput = {
  /** Category labels along x (e.g. month names). */
  labels: string[];
  /** One or more y-series, index-aligned to `labels`. */
  series: { name: string; values: number[]; color?: string }[];
};

/** Normalize an array of records into label/series form (data normalization step). */
export function normalizeRecords(
  rows: Record<string, unknown>[],
  xKey: string,
  yKeys: { key: string; name?: string; color?: string }[],
): SeriesInput {
  return {
    labels: rows.map((r) => String(r[xKey])),
    series: yKeys.map((y) => ({
      name: y.name ?? y.key,
      color: y.color,
      values: rows.map((r) => Number(r[y.key])),
    })),
  };
}

export type ChartLayout = {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
};

export type LineChartModel = {
  layout: ChartLayout;
  scale: LinearScale;
  /** category x pixel centers */
  xs: number[];
  /** projected points per series */
  points: Pt[][];
  labels: string[];
  series: { name: string; values: number[]; color: string }[];
};

const DEFAULT_COLORS = ["#2563eb", "#16a34a", "#db2777", "#d97706", "#7c3aed"];

export type LayoutOptions = {
  width?: number;
  height?: number;
  /** plot insets (px). Defaults leave room for y labels (left) + title (top) + x labels (bottom). */
  padding?: { left?: number; right?: number; top?: number; bottom?: number };
  maxTicks?: number;
  beginAtZero?: boolean;
};

/** Build the full projected model from normalized series — the deterministic math core. */
export function buildLineChartModel(input: SeriesInput, opts: LayoutOptions = {}): LineChartModel {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const pad = opts.padding ?? {};
  const plot = {
    left: pad.left ?? 70,
    right: width - (pad.right ?? 24),
    top: pad.top ?? 120,
    bottom: height - (pad.bottom ?? 48),
  };

  const allValues = input.series.flatMap((s) => s.values);
  const dataMax = allValues.length ? Math.max(...allValues) : 1;
  const dataMin = allValues.length ? Math.min(...allValues) : 0;
  const scale = linearScale(dataMin, dataMax, { beginAtZero: opts.beginAtZero ?? true, maxTicks: opts.maxTicks ?? 11 });

  const xs = categoryCenters(input.labels.length, plot.left, plot.right, false);
  const series = input.series.map((s, i) => ({ name: s.name, values: s.values, color: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] }));
  const points = series.map((s) =>
    s.values.map((v, i) => ({ x: xs[i], y: project(v, scale.min, scale.max, plot.bottom, plot.top) })),
  );

  return { layout: { width, height, plot }, scale, xs, points, labels: input.labels, series };
}

// ---------------------------------------------------------------------------
// Path primitives (pure geometry → SVG path data)
// ---------------------------------------------------------------------------

const n = (v: number) => Math.round(v * 100) / 100;

/** Polyline path through points — straight segments (Chart.js tension:0 default). */
export function linePathD(points: Pt[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${n(p.x)} ${n(p.y)}`).join(" ");
}

/** Single path drawing a filled circle at each point (engine masks are fill-only). */
export function pointsPathD(points: Pt[], r: number): string {
  return points
    .map((p) => `M ${n(p.x - r)} ${n(p.y)} a ${r} ${r} 0 1 0 ${n(r * 2)} 0 a ${r} ${r} 0 1 0 ${n(-r * 2)} 0 Z`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Canonical SVG renderer
// ---------------------------------------------------------------------------

export type RenderOptions = {
  title?: string;
  subtitle?: string;
  showLegend?: boolean;
  background?: string; // default white
  gridColor?: string;
  axisTextColor?: string;
  strokeWidth?: number;
  pointRadius?: number;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";

/** Render the model to a clean, canonical line-chart SVG string. */
export function renderLineChartSvg(model: LineChartModel, ro: RenderOptions = {}): string {
  const { width: W, height: H, plot } = model.layout;
  const bg = ro.background ?? "#ffffff";
  const grid = ro.gridColor ?? "#eef2f7";
  const axisText = ro.axisTextColor ?? "#6b7280";
  const titleColor = "#111827";
  const sw = ro.strokeWidth ?? 2;
  const pr = ro.pointRadius ?? 3;
  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // grid: horizontal at each y tick, vertical at each category
  for (const t of model.scale.ticks) {
    const y = project(t, model.scale.min, model.scale.max, plot.bottom, plot.top);
    parts.push(`<line x1="${plot.left}" y1="${n(y)}" x2="${plot.right}" y2="${n(y)}" stroke="${grid}" stroke-width="1"/>`);
    parts.push(`<text x="${plot.left - 10}" y="${n(y + 4)}" font-family="${FONT}" font-size="13" fill="${axisText}" text-anchor="end">${esc(formatTick(t))}</text>`);
  }
  for (let i = 0; i < model.xs.length; i++) {
    const x = model.xs[i];
    parts.push(`<line x1="${n(x)}" y1="${plot.top}" x2="${n(x)}" y2="${plot.bottom}" stroke="${grid}" stroke-width="1"/>`);
    parts.push(`<text x="${n(x)}" y="${plot.bottom + 22}" font-family="${FONT}" font-size="13" fill="${axisText}" text-anchor="middle">${esc(model.labels[i])}</text>`);
  }
  // y axis baseline (slightly darker) for a clean canonical frame
  parts.push(`<line x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.bottom}" stroke="#d1d5db" stroke-width="1"/>`);
  parts.push(`<line x1="${plot.left}" y1="${plot.bottom}" x2="${plot.right}" y2="${plot.bottom}" stroke="#d1d5db" stroke-width="1"/>`);

  // series lines + points
  for (const s of model.series.map((s, i) => ({ ...s, points: model.points[i] }))) {
    parts.push(`<path d="${linePathD(s.points)}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`);
    parts.push(`<path d="${pointsPathD(s.points, pr)}" fill="${s.color}"/>`);
  }

  // title + subtitle
  if (ro.title) parts.push(`<text x="${W / 2}" y="40" font-family="${FONT}" font-size="22" font-weight="700" fill="${titleColor}" text-anchor="middle">${esc(ro.title)}</text>`);
  if (ro.subtitle) parts.push(`<text x="${W / 2}" y="64" font-family="${FONT}" font-size="13" fill="${axisText}" text-anchor="middle">${esc(ro.subtitle)}</text>`);

  // legend (single small chip per series, centered)
  if (ro.showLegend ?? true) {
    const items = model.series;
    const gap = 18, swatch = 22, textW = 70;
    const itemW = swatch + 6 + textW + gap;
    let lx = W / 2 - (items.length * itemW - gap) / 2;
    const ly = 92;
    for (const s of items) {
      parts.push(`<rect x="${n(lx)}" y="${ly - 9}" width="${swatch}" height="11" rx="2" fill="${s.color}"/>`);
      parts.push(`<text x="${n(lx + swatch + 6)}" y="${ly}" font-family="${FONT}" font-size="13" fill="#374151">${esc(s.name)}</text>`);
      lx += itemW;
    }
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

/** Convenience: records → canonical SVG in one call (the full deterministic pipeline). */
export function lineChartSvgFromRecords(
  rows: Record<string, unknown>[],
  xKey: string,
  yKeys: { key: string; name?: string; color?: string }[],
  layout: LayoutOptions = {},
  render: RenderOptions = {},
): { svg: string; model: LineChartModel } {
  const model = buildLineChartModel(normalizeRecords(rows, xKey, yKeys), layout);
  return { svg: renderLineChartSvg(model, render), model };
}
