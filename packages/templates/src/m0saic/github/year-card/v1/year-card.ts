/**
 * ============================================================================
 * @m0saic/github/year-card/v1 — a developer's year on GitHub, on one card
 * ============================================================================
 *
 * The contribution calendar (7 weekday rows × 53 week columns, month labels
 * along the top, weekday labels down the side, a Less → More legend) with a
 * row of four numbers above it — commits, pull requests, stars, top language
 * — and the handle + year in the header. The vanity share every developer
 * posts; hand it a year of daily counts (365 numbers, or a comma string) and
 * the totals in the KPI tiles.
 *
 * Construction is the alpine heatmap's v2 move at calendar scale: the cell
 * matrix is one gutterless `grid(7×53)` — its precision is the cell COUNT,
 * not the canvas — and the inter-cell gap is applied AFTER composition by
 * lattice retargeting (`latticeCellInset` over the parsed cell rects), so
 * the cells are equal and the gaps exact at any canvas. The cells are plain
 * square tiles (no per-tile rounding mask — at 371 tiles that quadruples the
 * render) and the reveal is ONE curtain track, not 371 overlays. Chrome is the alpine
 * card kit, RATIO throughout. The weeks are placed by real calendar math
 * (UTC, deterministic): the first column is the week of January 1st, cells
 * outside the year paint the card colour.
 *
 * Determinism: the sample year is a fixed literal, no clock, no randomness.
 * ============================================================================
 */

import { asTemplateId } from "@m0saic/types";
import { toM0String, grid } from "@m0saic/dsl-stdlib";
import { parseM0StringToRenderFrames, type M0String, type RenderFrame } from "@m0saic/dsl";
import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicSource, MosaicTemplate } from "@m0saic/types";
import {
  FAMILY_GCD,
  bindProp,
  curtainSource,
  definePropsSchema,
  fadeInExpr,
  fitEmUnits,
  isSmooth,
  latticeCellInset,
  makeColorTile,
  makeErrorMosaic,
  registerTemplate,
  tag,
  textEmUnits,
  withLayoutContract,
  type LayoutConstraint,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { EMPTY, alpineCard, colSplit, overlay, paint, rowSplit, textCell, type Node } from "../../../alpine/_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../../alpine/_shared/alpine-theme";
import { ALPINE_ANIM_FIELDS, fEnum } from "../../../alpine/_shared/alpine-anim";

type RenderMode = "premium" | "light";
type AnimConfig = { renderMode?: RenderMode; introFrac?: number; reduceMotion?: boolean };

export type YearCardProps = {
  /** GitHub handle, shown with the year in the header ("@qsbuilds · 2026 on GitHub"). */
  handle?: string;
  /** The calendar year. */
  year?: number;
  /** Daily contribution counts from January 1st (365/366 numbers, or one comma-separated string). Missing days are 0. */
  contributions: number[] | string;
  commits?: number;
  pullRequests?: number;
  stars?: number;
  topLanguage?: string;
  /** Show the four KPI tiles above the calendar. Default true. */
  showKpis?: boolean;
  preset?: AlpinePreset;
  anim?: AnimConfig;
  theme?: ThemeSourceConfig;
  debugLayout?: boolean;
};

const TEMPLATE_ID = "@m0saic/github/year-card/v1";
const WEEKS = 53;
const DAYS = 7;
const LEVELS = 5;
/** Light by default: the year unfolds week by week under ONE curtain track; premium fades every cell on the diagonal (371 overlays, ~40 s for a 3 s clip). */
const DEFAULT_ANIM: Required<AnimConfig> = { renderMode: "light", introFrac: 0.7, reduceMotion: false };
/** GitHub's calendar greens, light and dark. */
const GREENS: Record<AlpinePreset, MosaicColor[]> = {
  light: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"] as MosaicColor[],
  dark: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"] as MosaicColor[],
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS: Array<[number, string]> = [[1, "Mon"], [3, "Wed"], [5, "Fri"]];

/** A fixed sample year (2026): 905 contributions over 217 days, a two-week break in August. */
export const SAMPLE_CONTRIBUTIONS =
  "4,2,0,0,1,0,5,0,1,0,0,4,5,5,0,4,0,0,6,0,0,0,4,0,0,0,0,0,0,0,4,1,0,0,0,4,1,0,5,7,0,0,0,2,3,1,2,4,2,2,8,0,2,1,3,0,6,0,0,3,5,3,10,5,1,0,0,2,0,0,8,0,11,1,3,1,7,2,1,0,0,3,0,6,1,1,0,0,7,8,0,0,4,3,7,7,5,5,12,0,0,11,6,3,3,1,1,0,0,8,3,3,4,0,1,4,14,1,8,14,9,0,1,6,11,1,5,4,0,1,6,1,15,1,4,0,0,7,9,0,3,2,0,0,4,9,4,1,0,4,0,10,2,2,4,1,0,2,4,1,3,1,1,2,0,0,4,3,0,4,0,0,2,3,1,7,0,0,1,0,11,0,4,4,2,0,0,2,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,5,0,2,0,3,1,2,1,1,0,3,9,6,5,1,1,3,0,7,6,3,8,3,4,0,5,0,8,13,15,0,2,2,2,3,6,11,0,0,2,9,3,1,2,2,0,2,5,3,3,2,15,3,4,3,3,6,3,0,3,3,5,5,5,1,0,0,3,8,5,1,2,0,0,2,3,6,1,7,0,0,10,4,2,6,5,0,1,0,2,10,2,3,0,2,8,5,0,7,6,0,3,9,6,4,5,0,0,0,0,0,5,1,4,2,0,2,1,0,0,0,0,0,5,0,0,0,0,0,0,1,1,0,3,0,0,0,0,0,0,0,0,0,0,0,1,0,0";

const propsSchema = definePropsSchema<YearCardProps>({
  handle: { type: "string", required: false, description: "GitHub handle for the header.", meta: { control: { placeholder: "none" }, ui: { label: "Handle", order: 1, primary: true } } },
  year: { type: "number", required: false, description: "Calendar year (places the weeks and month labels).", meta: { constraints: { min: 2008, max: 2100 }, ui: { label: "Year", order: 2 } } },
  contributions: {
    type: "json",
    required: true,
    description: "Daily contribution counts from January 1st — an array of 365/366 numbers, or one comma-separated string. Missing days count as 0.",
    meta: { ui: { label: "Contributions", order: 3, primary: true, consumer: "agent" } },
  } as never,
  commits: { type: "number", required: false, description: "Commits this year (KPI tile).", meta: { control: { placeholder: "none" }, ui: { label: "Commits", order: 4 } } },
  pullRequests: { type: "number", required: false, description: "Pull requests this year (KPI tile).", meta: { control: { placeholder: "none" }, ui: { label: "Pull requests", order: 5 } } },
  stars: { type: "number", required: false, description: "Stars earned this year (KPI tile).", meta: { control: { placeholder: "none" }, ui: { label: "Stars", order: 6 } } },
  topLanguage: { type: "string", required: false, description: "Most-used language (KPI tile).", meta: { control: { placeholder: "none" }, ui: { label: "Top language", order: 7 } } },
  showKpis: { type: "boolean", required: false, description: "Show the four KPI tiles above the calendar.", meta: { ui: { label: "Show KPIs", order: 8 } } },
  preset: { type: "string", required: false, description: 'Alpine theme: "light" (default) or "dark" — the calendar greens follow.', meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 9 } } },
  anim: {
    type: "group",
    required: false,
    description: "Reveal: the calendar unfolds week by week (light) or fades in on the diagonal (premium). reduceMotion renders the final frame.",
    meta: { ui: { label: "Animation", order: 10, collapsedByDefault: true } },
    fields: {
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
      renderMode: fEnum("Render mode", ["premium", "light"], "light (default) = the year unfolds week by week under one curtain — free; premium = every cell fades in on the diagonal, ~10× the render time."),
    },
  } as never,
  theme: { type: "json", required: false, description: "Opt-in producer theme tokens.", meta: { ui: { label: "Theme", order: 11, collapsedByDefault: true, consumer: "agent" } } } as never,
  debugLayout: { type: "boolean", required: false, description: "Dev-only: overlay the layout contract.", meta: { ui: { label: "Debug layout", order: 12 } } },
});

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Daily counts from an array or a comma string; non-numbers → 0. */
export function parseContributions(v: number[] | string | undefined): number[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.trim().split(/[,\s]+/) : [];
  return raw.map((x) => {
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  });
}

export type CalendarLayout = {
  /** Days in the year (365 / 366). */
  days: number;
  /** Weekday (0 = Sunday) of January 1st — the row the first cell lands in. */
  firstDow: number;
  /** For each month, the week column its first day falls in. */
  monthCols: Array<{ label: string; col: number }>;
};

/** Calendar geometry for `year` — UTC math, no clock. */
export function calendarLayout(year: number): CalendarLayout {
  const jan1 = Date.UTC(year, 0, 1);
  const days = Math.round((Date.UTC(year + 1, 0, 1) - jan1) / 86400000);
  const firstDow = new Date(jan1).getUTCDay();
  const monthCols = MONTHS.map((label, m) => {
    const dayIndex = Math.round((Date.UTC(year, m, 1) - jan1) / 86400000);
    return { label, col: Math.floor((dayIndex + firstDow) / DAYS) };
  });
  return { days, firstDow, monthCols };
}

/** GitHub-style buckets: 0 for none, then four quartiles of the year's max. */
export function bucketOf(v: number, max: number): number {
  if (v <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(LEVELS - 1, 1 + Math.floor((v / max) * (LEVELS - 1) * 0.99999)));
}

/** Longest run of consecutive active days. */
export function longestStreak(counts: number[]): number {
  let run = 0, best = 0;
  for (const v of counts) {
    run = v > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

export function fmtCount(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US");
}

/**
 * `n` equal tiles separated by `n − 1` equal gutters of ~`gapFrac` of the row,
 * as weights whose total is 5-smooth (≤ 120, the lattice). Rounding each band
 * to a percent on its own (`wOf`) sums to 100 ± a few — 4×24 + 3×2 = 102 → a
 * 51 = 3·17 basis — and `latticeWeights` cannot rewrite an item/gutter list
 * onto a smooth total without making the tiles unequal, so the basis is
 * chosen here, exactly: the smooth total whose gutter is nearest `gapFrac`.
 */
export function smoothTileRow(n: number, gapFrac: number): { tile: number; gap: number; total: number } {
  if (n <= 1) return { tile: 1, gap: 0, total: 1 };
  let best: { tile: number; gap: number; total: number; err: number } | null = null;
  for (let total = FAMILY_GCD; total >= 2 * n - 1; total--) {
    if (!isSmooth(total)) continue;
    const g0 = Math.round(total * gapFrac);
    for (const gap of [g0, g0 - 1, g0 + 1]) {
      if (gap < 1) continue;
      const rest = total - gap * (n - 1);
      if (rest % n !== 0) continue;
      const tile = rest / n;
      if (tile <= gap) continue;
      const err = Math.abs(gap / total - gapFrac);
      if (!best || err < best.err) best = { tile, gap, total, err };
    }
  }
  if (!best) return { tile: 1, gap: 0, total: n };
  return { tile: best.tile, gap: best.gap, total: best.total };
}

function roundTile(c: MosaicColor, radius: number): MosaicSource {
  return makeColorTile(c, { effects: { rounding: { cornerStyle: "rounded", borderRadius: radius } } }) as MosaicSource;
}
function capFont(px: number, text: string, boxPx: number, min: number): number {
  return Math.max(min, Math.min(px, Math.floor((boxPx * 0.94 - 2) / (Math.max(1, textEmUnits(text)) * 0.72))));
}

/** A KPI tile: big value over a small label, on the theme's grid surface. */
function kpiTile(value: string, label: string, theme: { grid: MosaicColor; title: MosaicColor; muted: MosaicColor }, w: number, h: number, key: string, propKey: string): Node {
  const big = capFont(Math.round(h * 0.42), value, w, 12);
  const small = capFont(Math.round(h * 0.16), label, w, 8);
  const stack = rowSplit([
    { weight: 10, node: EMPTY },
    // The value IS the prop → Make's double-click edits it in place.
    { weight: 50, node: paint(bindProp(tag(textCell(value, big, theme.title, "center", "bottom"), `kpi-${key}-value`), propKey)) },
    { weight: 26, node: paint(tag(textCell(label, small, theme.muted, "center", "top"), `kpi-${key}-label`)) },
    { weight: 14, node: EMPTY },
  ]);
  return overlay([paint(tag(roundTile(theme.grid, 0.12), `kpi-${key}-tile`)), stack]);
}

/**
 * Exact inter-cell gaps via lattice retargeting — the alpine heatmap v2 move
 * (copied: `_shared` and shipped templates are frozen). Parse the composed m0
 * at the render canvas, take each cell's RAW rect as truth, retarget all of
 * them onto an integer lattice spanning the grid's region — equal cells, gaps
 * of exactly `gapPx` — and hand every cell tile a `placement.inset`.
 * Degrades to a gapless grid (never dies) when the lattice cannot fit.
 */
function applyLatticeGapInsets(root: Node, cellSources: MosaicSource[], gapPx: number, W: number, H: number): void {
  const N = cellSources.length;
  if (gapPx <= 0 || N === 0) return;
  try {
    const iCells = root.sources.indexOf(cellSources[0]);
    if (iCells < 0 || root.sources[iCells + N - 1] !== cellSources[N - 1]) return;
    const frames = parseM0StringToRenderFrames(root.m0 as M0String, W, H);
    const byLogical: RenderFrame[] = [];
    for (const f of frames) byLogical[f.logicalIndex] = f;
    const raws: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (let k = 0; k < N; k++) {
      const f = byLogical[iCells + k];
      if (!f || f.width < 1 || f.height < 1) return;
      raws.push({ x: f.x, y: f.y, w: f.width, h: f.height });
    }
    const minX = Math.min(...raws.map((r) => r.x)), minY = Math.min(...raws.map((r) => r.y));
    const maxX = Math.max(...raws.map((r) => r.x + r.w)), maxY = Math.max(...raws.map((r) => r.y + r.h));
    const lat = latticeCellInset({
      cols: WEEKS,
      rows: DAYS,
      canvasW: maxX - minX,
      canvasH: maxY - minY,
      gutterXPx: gapPx,
      gutterYPx: gapPx,
      marginPx: 0,
      cells: raws.map((r, k) => ({ unit: { c0: k % WEEKS, r0: Math.floor(k / WEEKS), cs: 1, rs: 1 }, raw: { x: r.x - minX, y: r.y - minY, w: r.w, h: r.h } })),
    });
    for (let k = 0; k < N; k++) {
      const box = lat.insetAt(k);
      if (box) (cellSources[k] as { placement?: unknown }).placement = { inset: box };
    }
  } catch {
    // Degenerate lattice (tiny canvas) — render gapless rather than dying.
  }
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const YearCardV1: MosaicTemplate<YearCardProps> = {
  id: asTemplateId(TEMPLATE_ID),
  label: "GitHub Year Card",
  version: 1,
  description:
    "A developer's year on GitHub on one card: the 7×53 contribution calendar with month and weekday labels and a Less→More legend, four KPI tiles (commits, pull requests, stars, top language) and the handle + year in the header. Gutterless grid with lattice-exact gaps; composes at any canvas.",
  capabilities: { tier: "core" },
  tags: ["github", "contributions", "calendar", "heatmap", "year", "developers", "vanity", "share", "alpine", "animated"],
  aspectRatio: { ideal: 16 / 9, min: 1.3, max: 2.4, mode: "warn" },
  // The calendar's 53 week columns are content cardinality (GitHub's own
  // grid: a year spans up to 53 ISO weeks), not a layout basis — declared,
  // like the convention's own example. The gaps live in the fiber
  // (latticeCellInset), so the grid itself stays a clean 7×53.
  lattice: { allow: [{ count: WEEKS, reason: "the contribution calendar's 53 week columns — a year spans up to 53 ISO weeks (content cardinality, GitHub's own grid)" }] },
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 720, fps: 30, durationMs: 3000 },
  propsSchema,
  defaultProps: {
    handle: "@qsbuilds",
    year: 2026,
    contributions: SAMPLE_CONTRIBUTIONS,
    commits: 1102,
    pullRequests: 96,
    stars: 412,
    topLanguage: "TypeScript",
    showKpis: true,
    preset: "light",
    anim: { ...DEFAULT_ANIM },
    debugLayout: false,
  },

  async render(props: YearCardProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const fail = (message: string): MosaicDocument => makeErrorMosaic(message, { title: "GitHub Year Card", width: W, height: H });

    const counts = parseContributions(props.contributions);
    if (counts.length === 0) return fail("year-card needs contributions (365 daily counts, or a comma string)");
    const year = Number.isFinite(props.year) && props.year! >= 2008 && props.year! <= 2100 ? Math.round(props.year!) : 2026;
    const cal = calendarLayout(year);
    const daily = Array.from({ length: cal.days }, (_, i) => counts[i] ?? 0);
    const total = daily.reduce((a, b) => a + b, 0);
    const max = Math.max(0, ...daily);
    const streak = longestStreak(daily);

    const preset: AlpinePreset = props.preset === "dark" ? "dark" : "light";
    const theme = await resolveAlpineTheme(preset, ctx, props.theme);
    const greens = GREENS[preset];
    const anim: Required<AnimConfig> = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const light = anim.renderMode === "light";
    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 3000) / 1000);
    const introSec = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const fadeDur = Math.max(0.08, introSec * 0.3);
    const showKpis = props.showKpis !== false;

    const handle = (props.handle ?? "").trim();
    const title = handle ? `${handle} · ${year} on GitHub` : `${year} on GitHub`;
    const subtitle = `${fmtCount(total)} contributions · longest streak ${streak} ${streak === 1 ? "day" : "days"}`;

    // ── chrome ──
    // The title shows the handle (+ the year); the subtitle is derived.
    const card = alpineCard({ theme, W, H, title, subtitle, headerBinding: handle ? { title: "handle" } : false });
    const content = card.contentRect;
    const wOf = (px: number, ref: number) => Math.max(1, Math.round((px / ref) * 100));

    // ── geometry ──
    const kpiH = showKpis ? Math.round(content.h * 0.24) : 0;
    const kpiGap = showKpis ? Math.round(content.h * 0.06) : 0;
    const monthH = Math.round(content.h * 0.07);
    const legendH = Math.round(content.h * 0.08);
    const legendGap = Math.round(content.h * 0.03);
    const dayLabelW = Math.round(content.w * 0.045);
    const calAreaW = content.w - dayLabelW;
    const calAreaH = Math.max(1, content.h - kpiH - kpiGap - monthH - legendH - legendGap);
    // Square cells that fit the area on both axes; the grid is letterboxed inside it.
    const cell = Math.max(4, Math.floor(Math.min(calAreaW / WEEKS, calAreaH / DAYS)));
    const gridW = cell * WEEKS, gridH = cell * DAYS;
    const gap = Math.max(1, Math.round(cell * 0.2));
    const lbX = Math.max(0, Math.round((calAreaW - gridW) / 2));
    const labelFont = Math.max(8, Math.round(H * 0.019));

    // ── KPI row ──
    const kpis = [
      { key: "commits", prop: "commits", value: props.commits, label: "commits" },
      { key: "prs", prop: "pullRequests", value: props.pullRequests, label: "pull requests" },
      { key: "stars", prop: "stars", value: props.stars, label: "stars earned" },
      { key: "lang", prop: "topLanguage", value: props.topLanguage, label: "top language" },
    ].filter((k) => k.value != null && k.value !== "" && (typeof k.value !== "number" || Number.isFinite(k.value)));
    let kpiRow: Node = EMPTY;
    if (showKpis && kpis.length > 0) {
      // Tiles + 2 % gutters on a smooth basis (not per-band percents — see smoothTileRow).
      const row = smoothTileRow(kpis.length, 0.02);
      const tileW = Math.max(1, Math.round((content.w * row.tile) / row.total));
      const bands: Array<{ weight: number; node: Node }> = [];
      kpis.forEach((k, i) => {
        if (i > 0) bands.push({ weight: row.gap, node: EMPTY });
        const value = typeof k.value === "number" ? fmtCount(k.value) : String(k.value).trim();
        bands.push({ weight: row.tile, node: kpiTile(value, k.label, theme, tileW, kpiH, k.key, k.prop) });
      });
      kpiRow = colSplit(bands);
    }

    // ── month labels: one band per month, weighted by its week span ──
    const monthBands: Array<{ weight: number; node: Node }> = [];
    if (cal.monthCols[0].col > 0) monthBands.push({ weight: cal.monthCols[0].col, node: EMPTY });
    cal.monthCols.forEach((m, i) => {
      const next = cal.monthCols[i + 1]?.col ?? WEEKS;
      const span = Math.max(1, next - m.col);
      const spanPx = span * cell;
      monthBands.push({ weight: span, node: paint(tag(textCell(m.label, capFont(labelFont, m.label, spanPx, 7), theme.muted, "left", "bottom"), "month-label")) });
    });
    const monthRow = colSplit([
      { weight: wOf(dayLabelW + lbX, content.w), node: EMPTY },
      { weight: wOf(gridW, content.w), node: colSplit(monthBands) },
      ...(calAreaW - gridW - lbX > 0 ? [{ weight: wOf(calAreaW - gridW - lbX, content.w), node: EMPTY }] : []),
    ]);

    // ── weekday labels: 7 rows, Mon / Wed / Fri ──
    const dayRows = Array.from({ length: DAYS }, (_, d) => {
      const lbl = WEEKDAY_LABELS.find(([row]) => row === d)?.[1];
      return { weight: 1, node: lbl ? paint(tag(textCell(lbl, capFont(labelFont, lbl, dayLabelW, 7), theme.muted, "left", "middle"), "day-label")) : EMPTY };
    });
    const dayCol = rowSplit(dayRows);

    // ── the cells: one tile per gutterless grid frame (row-major over 7×53) ──
    const gridM0 = String(grid({ rows: DAYS, cols: WEEKS }).m0);
    const cellSources: MosaicSource[] = [];
    const maxDiag = Math.max(1, DAYS + WEEKS - 2);
    for (let r = 0; r < DAYS; r++) {
      for (let c = 0; c < WEEKS; c++) {
        const dayIndex = c * DAYS + r - cal.firstDow;
        const inYear = dayIndex >= 0 && dayIndex < cal.days;
        const fill = inYear ? greens[bucketOf(daily[dayIndex], max)] : theme.card;
        // premium = a per-cell alpha fade on the diagonal (371 overlays keep
        // the tiles off the xstack sheet: ~40 s for a 3 s clip). light (the
        // default) leaves every cell STATIC and reveals them with ONE curtain
        // track below — the year unfolds left to right, zero per-cell cost.
        const at = animate && !light ? (introSec - fadeDur) * ((r + c) / maxDiag) : 0;
        const rev = animate && !light ? { startAtSec: at, alpha: fadeInExpr(at, fadeDur) } : {};
        // Plain square tiles on purpose: a rounding effect is an inline mask per
        // tile, and 371 of them quadruple the render (37 s → 9 s for the still).
        const tile = makeColorTile(fill, {
          ...(Object.keys(rev).length ? { overlay: rev } : {}),
        }) as MosaicSource;
        (tile as MosaicSource & { editor?: { label?: string } }).editor = { label: inYear ? "cell" : "cell-outside" };
        cellSources.push(tile);
      }
    }
    const cellsNode: Node = { m0: gridM0, sources: cellSources };
    // The light reveal: one hide-coloured box per week column, gated to drop
    // in run order across the intro (the hello-world field wipe, per week).
    let gridNode: Node = cellsNode;
    if (animate && light) {
      const boxes = Array.from({ length: WEEKS }, (_, c) => ({
        x: c * cell,
        y: 0,
        w: cell,
        h: gridH,
        revealAtSec: Number((introSec * ((c + 1) / WEEKS)).toFixed(3)),
      }));
      const curtain = curtainSource(boxes, theme.card);
      if (curtain) gridNode = overlay([cellsNode, paint(tag(curtain as MosaicSource, "calendar-curtain"))]);
    }

    const calendarRow = colSplit([
      { weight: wOf(dayLabelW, content.w), node: dayCol },
      ...(lbX > 0 ? [{ weight: wOf(lbX, content.w), node: EMPTY }] : []),
      { weight: wOf(gridW, content.w), node: gridNode },
      ...(calAreaW - gridW - lbX > 0 ? [{ weight: wOf(calAreaW - gridW - lbX, content.w), node: EMPTY }] : []),
    ]);

    // ── legend: Less · five swatches · More, right-aligned under the grid ──
    const sw = Math.max(6, Math.round(legendH * 0.4));
    const legendTextW = Math.round(content.w * 0.05);
    const swatchBands: Array<{ weight: number; node: Node }> = [];
    greens.forEach((g, i) => {
      if (i > 0) swatchBands.push({ weight: Math.max(1, Math.round(sw * 0.3)), node: EMPTY });
      swatchBands.push({ weight: sw, node: rowSplit([{ weight: 1, node: EMPTY }, { weight: 1, node: paint(tag(roundTile(g, 0.25), "legend-swatch")) }, { weight: 1, node: EMPTY }]) });
    });
    const swatchesW = sw * greens.length + Math.round(sw * 0.3) * (greens.length - 1);
    const legendW = legendTextW * 2 + swatchesW + Math.round(sw * 0.8) * 2;
    const legend = colSplit([
      { weight: legendTextW, node: paint(tag(textCell("Less", capFont(labelFont, "Less", legendTextW, 7), theme.muted, "right", "middle"), "legend-less")) },
      { weight: Math.round(sw * 0.8), node: EMPTY },
      { weight: swatchesW, node: colSplit(swatchBands) },
      { weight: Math.round(sw * 0.8), node: EMPTY },
      { weight: legendTextW, node: paint(tag(textCell("More", capFont(labelFont, "More", legendTextW, 7), theme.muted, "left", "middle"), "legend-more")) },
    ]);
    const legendRow = colSplit([
      { weight: wOf(Math.max(1, content.w - legendW), content.w), node: EMPTY },
      { weight: wOf(legendW, content.w), node: legend },
    ]);

    // ── stack ──
    const bands: Array<{ weight: number; node: Node }> = [];
    if (showKpis && kpis.length > 0) {
      bands.push({ weight: wOf(kpiH, content.h), node: kpiRow });
      bands.push({ weight: wOf(kpiGap, content.h), node: EMPTY });
    } else if (kpiH + kpiGap > 0) {
      bands.push({ weight: wOf(kpiH + kpiGap, content.h), node: EMPTY });
    }
    // The grid is usually width-bound, so the calendar area has vertical
    // slack: a little above the month labels, the rest under the grid.
    const slack = Math.max(0, calAreaH - gridH);
    const monthGap = Math.min(slack, Math.max(2, Math.round(content.h * 0.018)));
    const slackTop = Math.round((slack - monthGap) * 0.3);
    if (slackTop > 0) bands.push({ weight: wOf(slackTop, content.h), node: EMPTY });
    bands.push({ weight: wOf(monthH, content.h), node: monthRow });
    if (monthGap > 0) bands.push({ weight: wOf(monthGap, content.h), node: EMPTY });
    bands.push({ weight: wOf(gridH, content.h), node: calendarRow });
    if (slack - monthGap - slackTop > 0) bands.push({ weight: wOf(slack - monthGap - slackTop, content.h), node: EMPTY });
    bands.push({ weight: wOf(legendGap, content.h), node: EMPTY });
    bands.push({ weight: wOf(legendH, content.h), node: legendRow });
    const root = card.compose(rowSplit(bands));

    // Exact gaps between the calendar cells, against the composed truth.
    applyLatticeGapInsets(root, cellSources, gap, W, H);

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {},
      m0: toM0String(root.m0, "YearCardV1"),
      sources: root.sources,
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      size: { width: W, height: H },
      editor: { label: `GitHub Year Card · ${title}` },
    } as MosaicDocument;

    const constraints: LayoutConstraint[] = [
      ...card.constraints,
      { label: "month-label", textFits: {} },
      { label: "day-label", textFits: {} },
      { label: "legend-less", textFits: {} },
      { label: "legend-more", textFits: {} },
      ...kpis.map((k): LayoutConstraint => ({ label: `kpi-${k.key}-value`, textFits: {} })),
    ];
    return withLayoutContract(doc, ctx, {
      templateId: TEMPLATE_ID,
      constraints,
      relations: [{ label: "cell", equal: "size", tolerance: 0.02, tolerancePx: 1 }],
      debug: props.debugLayout === true,
    });
  },
};

registerTemplate(YearCardV1);
export default YearCardV1;
