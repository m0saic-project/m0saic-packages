import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/heatmap/v2 — Alpine Heatmap (friendly mobile-marketing)
 * ============================================================================
 *
 * A matrix heatmap inside the Alpine white card: a grid of rounded cells, each
 * colored by its value on a single-hue intensity scale (a pale tint → the full
 * color). Row labels sit in a left gutter, optional column labels along the top,
 * and a "Less → More" legend at the bottom. Generalizes the GitHub contribution
 * calendar (7 weekday rows × N week columns) but works for any rows × cols data.
 *
 * Construction (the v2 RATIO rebuild of v1's absolute placeRects packing): the
 * cell matrix is a clean gutterless `grid(rows×cols)` nested in the card's
 * ratio layout, so the template composes at any canvas. The inter-cell gap is
 * applied AFTER composition via lattice retargeting (`latticeCellInset` over
 * the RAW parsed cell rects — see `applyLatticeGapInsets`): equal cells, gaps
 * of exactly `gapPx`, immune to the ratio/letterbox/engine quantization stack.
 * The colored cells are plain rounded `makeColorTile`s (no inline-mask).
 * Animation: cells fade in on a top-left→bottom-right diagonal cascade;
 * `anim.reduceMotion` → the static board.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTextSource,
  MosaicTemplate,
} from "@m0saic/types";
import {
  withLayoutContract,
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeErrorMosaic,
  fadeInExpr,
  latticeCellInset,
  bindProp,
  bindProps,
  bindPropPath,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { grid } from "@m0saic/dsl-stdlib";
import { parseM0StringToRenderFrames, type M0String, type RenderFrame } from "@m0saic/dsl";

import {
  alpineCard,
  EMPTY,
  paint,
  rowSplit,
  colSplit,
  overlay,
  textCell,
  tag,
  type Node,
  type Band,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate, revealFade, ALPINE_ANIM_FIELDS, fBool, fNum, fStr, fEnum } from "../../_shared/alpine-anim";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** One row of the matrix: a label + its cell values (left→right). `values` may
 *  be a number[] (agent) or a CSV/space-separated string (the objectRows editor). */
type HeatRow = { label?: string; values: number[] | string };
/** Reveal cost/quality dial. "premium" (default): diagonal alpha-fade cascade —
 *  the softest look, but 1 per-pixel geq PER CELL, each paid on every frame of a
 *  nesting parent's whole timeline (the pack's heaviest geq load). "light": the
 *  same diagonal cascade via free enable-gate pops — no geq, composable. */
type RenderMode = "premium" | "light";
type AnimConfig = { renderMode: RenderMode; introFrac: number; easing: EaseName; reduceMotion: boolean };

type AlpineHeatmapV2Props = {
  // ── Primary props (flat — always visible up top) ──
  rows: HeatRow[];
  colLabels?: string[];
  title?: string;
  subtitle?: string;
  /** Full-intensity hue of the scale. Defaults to the theme primary. */
  color?: MosaicColor;
  preset?: AlpinePreset;
  /** Number of intensity buckets (incl. the empty one). GitHub uses 5. */
  levels?: number;
  showValues?: boolean;
  showLegend?: boolean;
  // ── Grouped props (collapsible sections) ──
  /** Scale/cell fine-tuning. */
  scale?: {
    /** Scale bounds. Default: min 0, max = the largest cell value. */
    min?: number;
    max?: number;
    /** Color of the lowest (zero) bucket. Defaults to a pale theme grey. */
    emptyColor?: MosaicColor;
    /** Cell corner radius fraction (0..1). */
    cellRadius?: number;
  };
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
  /** Dev-only layout contract: assert every cell + legend swatch rendered equal-size. */
  debugLayout?: boolean;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, easing: "easeOut", reduceMotion: false };
const DEFAULT_LEVELS = 5;
const MAX_ROWS = 14;
const MAX_COLS = 30;
const SNAP_PX = 4;
const EDGE_PAD = 1.5;

// Empty-bucket color per preset (GitHub's empty grey, retuned for the dark card).
const EMPTY_LIGHT: MosaicColor = "#EBEEF2";
const EMPTY_DARK: MosaicColor = "#1B2434";

// ---------------------------------------------------------------------------
// Color scale
// ---------------------------------------------------------------------------

function hexToRgb(hex: MosaicColor): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex));
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
function rgbToHex(r: number, g: number, b: number): MosaicColor {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}` as MosaicColor;
}
/** Linear RGB blend a→b at t∈[0,1]. */
function mix(a: MosaicColor, b: MosaicColor, t: number): MosaicColor {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const u = Math.max(0, Math.min(1, t));
  return rgbToHex(ar + (br - ar) * u, ag + (bg - ag) * u, ab + (bb - ab) * u);
}
function luminance(hex: MosaicColor): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function onColor(hex: MosaicColor, light: MosaicColor, dark: MosaicColor): MosaicColor {
  return luminance(hex) > 0.6 ? dark : light;
}

// ---------------------------------------------------------------------------
// Tight-cell placement + text helpers (mirrors donut / kpi-card)
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number; claimant: string; importance?: number };
type Piece = { rect: Rect; source: MosaicSource };
type BBox = { minX: number; minY: number; maxX: number; maxY: number };

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Snap a coordinate to the SNAP_PX lattice. Every rect edge lands on a multiple
 *  of SNAP_PX so placeRects' band decomposition stays low-precision and never
 *  collapses a filler band to a 0-size frame (the SPLIT_EXCEEDS_AXIS guard). */
const snapGrid = (v: number) => Math.round(v / SNAP_PX) * SNAP_PX;

/** Place a pre-computed pixel rect, snapping its edges to the SNAP_PX lattice. */
function rectPiece(W: number, H: number, x: number, y: number, w: number, h: number, source: MosaicSource, importance?: number): Piece {
  const x0 = clampInt(snapGrid(x), 0, W - SNAP_PX);
  const y0 = clampInt(snapGrid(y), 0, H - SNAP_PX);
  const x1 = clampInt(snapGrid(x + w), x0 + SNAP_PX, W);
  const y1 = clampInt(snapGrid(y + h), y0 + SNAP_PX, H);
  return { rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0, claimant: "F", importance }, source };
}

/** Place a text bbox snapped to the SNAP grid (labels / legend text). */
function placeText(W: number, H: number, bbox: BBox, source: MosaicSource, importance?: number): Piece {
  const snapDown = (v: number) => Math.floor((v - EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const snapUp = (v: number) => Math.ceil((v + EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const x = clampInt(snapDown(bbox.minX), 0, W - 1);
  const y = clampInt(snapDown(bbox.minY), 0, H - 1);
  const x2 = clampInt(snapUp(bbox.maxX), x + SNAP_PX, W);
  const y2 = clampInt(snapUp(bbox.maxY), y + SNAP_PX, H);
  return { rect: { x, y, w: x2 - x, h: y2 - y, claimant: "F", importance }, source };
}

function cellText(text: string, fontSize: number, color: MosaicColor, hAlign: "left" | "center" | "right" = "center"): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { hAlign, vAlign: "middle" } as any }] };
}
/** Compact a number for an in-cell label so it fits: 4500→"4.5K", 38000→"38K",
 *  1200000→"1.2M". Under 1000 stays exact. The cell color still uses the raw value. */
function compactNum(v: number): string {
  const n = Math.round(v);
  const abs = Math.abs(n);
  const fmt = (x: number, suf: string) => `${x.toFixed(1).replace(/\.0$/, "")}${suf}`;
  if (abs < 1000) return String(n);
  if (abs < 1e6) return fmt(n / 1e3, "K");
  if (abs < 1e9) return fmt(n / 1e6, "M");
  return fmt(n / 1e9, "B");
}
function textBBox(cxp: number, cyp: number, text: string, font: number, hAlign: "left" | "center" | "right"): BBox {
  const w = Math.max(font, text.length * font * 0.62 + font * 0.5);
  const h = font * 1.6;
  const minX = hAlign === "left" ? cxp : hAlign === "right" ? cxp - w : cxp - w / 2;
  return { minX, minY: cyp - h / 2, maxX: minX + w, maxY: cyp + h / 2 };
}

/** Normalize a row's values (number[] or CSV string) to a number[]. */
function parseValues(v: number[] | string | undefined): number[] {
  if (Array.isArray(v)) return v.map((n) => (Number.isFinite(n) ? Number(n) : 0));
  if (typeof v === "string") return v.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s !== "").map((s) => { const n = Number(s); return Number.isFinite(n) ? n : 0; });
  return [];
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineHeatmapV2Props>({
  // ── Primary props — flat, always visible up top (declaration order = display order). ──
  rows: { type: "array" as any, required: true, description: "Matrix rows. Each: an optional label + its cell values (left→right; number[] or a comma list).", meta: { control: { flavor: "objectRows", columns: [{ label: "Label", key: "label", kind: "text", placeholder: "Mon" }, { label: "Values", key: "values", kind: "text", placeholder: "3, 5, 1, 0, 8" }] }, ui: { label: "Rows", order: 1 } } },
  colLabels: { type: "string[]", required: false, description: "Column headers along the top (index-aligned to columns).", meta: { control: { placeholder: "W1" }, ui: { label: "Column Labels", order: 2 } } },
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., CONTRIBUTIONS" }, ui: { label: "Title", order: 3 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { ui: { label: "Subtitle", order: 4 } } },
  color: { type: "string", required: false, description: "Full-intensity hue of the scale. Defaults to the theme primary.", meta: { constraints: { isColor: true }, control: { placeholder: "theme primary", colorPicker: true, defaultColor: "#2563EB" }, ui: { label: "Scale color", order: 5 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 6 } } },
  levels: { type: "number", required: false, description: "Intensity buckets incl. empty (GitHub uses 5).", meta: { constraints: { min: 2, max: 9 }, ui: { label: "Levels", order: 7 } } },
  showValues: { type: "boolean", required: false, description: "Print each cell's value inside it.", meta: { ui: { label: "Show values", order: 8 } } },
  showLegend: { type: "boolean", required: false, description: "Show the Less→More legend.", meta: { ui: { label: "Show legend", order: 9 } } },

  // ── Everything else grouped into collapsible sections. ──
  scale: {
    type: "group" as any, required: false, description: "Scale bounds + cell fine-tuning (auto-fits when unset).",
    meta: { ui: { label: "Scale", order: 10, collapsedByDefault: true } },
    fields: {
      min: fNum("Min", "Scale minimum (default 0)."),
      max: fNum("Max", "Scale maximum (default = the largest value).", { placeholder: "largest cell value" }),
      emptyColor: { type: "string", required: false, description: "Color of the lowest (zero) bucket.", meta: { constraints: { isColor: true }, control: { placeholder: "theme lowest-bucket tone", colorPicker: true }, ui: { label: "Empty color" } } },
      cellRadius: fNum("Cell radius", "Cell corner radius (0..0.5).", { flavor: "slider", step: 0.05 }, { min: 0, max: 0.5 }),
    },
  } as any,
  anim: {
    type: "group" as any, required: false, description: "Reveal mode + diagonal cascade intro.",
    meta: { ui: { label: "Animation", order: 11, collapsedByDefault: true } },
    fields: {
      renderMode: fEnum("Render mode", ["premium", "light"], "\"premium\" (default): diagonal alpha-fade cascade — the softest look, but one per-pixel geq PER CELL, paid every frame of a nesting parent's whole timeline (the pack's heaviest geq load). \"light\": the same cascade via free enable-gate pops — no geq, composable, cheap when nested."),
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
      easing: ALPINE_ANIM_FIELDS.easing,
    },
  } as any,
  theme: {
    type: "group" as any, required: false, description: "Opt into a theme source. Uses the alpine preset by default; set a producer slug + namespace to pull shared design tokens. Explicit color props still win.",
    meta: { ui: { label: "Theme", order: 12, collapsedByDefault: true } },
    fields: { slug: fStr("Producer slug", "Producer template to seed tokens from (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"), preset: fStr("Preset", "Producer preset/variant (light | dark | high-contrast; producer-defined).", "producer default"), namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"), forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is populated.") },
  } as any,
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract view: renders the contract wireframe instead of the board — cells GREEN with the measured rule when all equal-size, offenders RED when not. Deterministic false default; production never sets it.", meta: { ui: { label: "Debug layout", order: 13 } } },
});

export const AlpineHeatmapV2: MosaicTemplate<AlpineHeatmapV2Props> = {
  id: asTemplateId("@m0saic/alpine/heatmap/v2"),
  label: "Alpine Heatmap",
  version: 2,
  description: "Alpine heatmap — friendly mobile-marketing card: a rows×cols grid of rounded cells colored on a single-hue intensity scale, with row/column labels and a Less→More legend. v2 rebuilds the geometry as a RATIO layout (clean grid() cells; gaps applied as lattice-retargeted source insets, exact at every canvas), so it composes anywhere without the coprime-pixel precision blowup. Generalizes the GitHub contribution calendar.",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "alpine", "heatmap", "matrix", "animated", "analysts", "developers", "activity", "calendar"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    debugLayout: false,
    theme: { forceFetch: false },
    rows: [
      { label: "Mon", values: [0, 2, 1, 4, 3, 5, 2, 6] },
      { label: "Tue", values: [1, 3, 2, 5, 4, 6, 3, 7] },
      { label: "Wed", values: [2, 4, 3, 6, 5, 8, 4, 9] },
      { label: "Thu", values: [1, 2, 4, 5, 7, 6, 5, 8] },
      { label: "Fri", values: [3, 5, 6, 8, 9, 7, 8, 10] },
      { label: "Sat", values: [0, 1, 0, 2, 1, 3, 1, 2] },
      { label: "Sun", values: [0, 0, 1, 1, 0, 2, 0, 1] },
    ],
    colLabels: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"],
    title: "CONTRIBUTIONS",
    subtitle: "Commits by day",
    preset: DEFAULT_PRESET,
    levels: DEFAULT_LEVELS,
    showLegend: true,
    showValues: false,
    scale: { min: 0, cellRadius: 0.25 },
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineHeatmapV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    // Keep each drawn row's ORIGINAL index into props.rows: the leaf bindings
    // (Make's double-click edit of rows[r].label / rows[r].values[c]) must
    // address the prop value, not the filtered / truncated draw order. A cell
    // leaf exists only when the row's values are a real array — a CSV-string
    // row has no per-cell leaf, so its cells stay unbound.
    const rawRows = (props.rows ?? [])
      .map((r, srcIndex) => ({ label: typeof r?.label === "string" ? r.label : "", values: parseValues(r?.values), srcIndex, cellLeaves: Array.isArray(r?.values) }))
      .filter((r) => r.values.length > 0)
      .slice(0, MAX_ROWS);
    if (rawRows.length === 0) {
      return makeErrorMosaic("rows[] must have at least one row with values", { title: `${this.id} props`, width: W, height: H });
    }
    const nCols = Math.min(MAX_COLS, Math.max(...rawRows.map((r) => r.values.length)));
    const nRows = rawRows.length;

    // Theming: the shared alpine theme (light default via the preset). A producer
    // overrides card/scale tokens through `props.theme`; explicit color props still
    // win. Unthemed → byte-identical to the sync `alpineTheme`.
    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const isDark = (props.preset ?? DEFAULT_PRESET) === "dark";
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";
    const showLegend = props.showLegend ?? true;
    const showValues = props.showValues ?? false;
    const levels = Math.max(2, Math.min(9, Math.round(props.levels ?? DEFAULT_LEVELS)));
    const scale = props.scale ?? {};

    const color = props.color && String(props.color).trim() && String(props.color).toLowerCase() !== "none" ? (props.color as MosaicColor) : theme.primary;
    const emptyColor = scale.emptyColor && String(scale.emptyColor).trim() && String(scale.emptyColor).toLowerCase() !== "none" ? (scale.emptyColor as MosaicColor) : (isDark ? EMPTY_DARK : EMPTY_LIGHT);
    const paleTint = mix(color, theme.card, 0.78); // bucket-1 (faintest non-empty)

    const allVals = rawRows.flatMap((r) => r.values);
    const dataMax = Math.max(...allVals);
    const min = Number.isFinite(scale.min as number) ? (scale.min as number) : 0;
    const max = Number.isFinite(scale.max as number) ? (scale.max as number) : Math.max(min + 1, dataMax);

    // value → bucket 0..levels-1. Bucket 0 = empty (≤ min); 1..levels-1 = tints.
    const bucketOf = (v: number): number => {
      if (v <= min) return 0;
      const frac = (v - min) / Math.max(1e-6, max - min);
      return Math.max(1, Math.min(levels - 1, 1 + Math.floor(frac * (levels - 1) * 0.99999)));
    };
    const bucketColor = (b: number): MosaicColor => {
      if (b <= 0) return emptyColor;
      if (levels <= 2) return color;
      return mix(paleTint, color, (b - 1) / (levels - 2));
    };

    const cellRadius = Math.max(0, Math.min(0.5, scale.cellRadius ?? 0.25));

    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    // ── Sub-band sizing inside the content rect ──
    const hasColLabels = !!(props.colLabels && props.colLabels.some((s) => s && s.trim()));
    const hasRowLabels = rawRows.some((r) => r.label && r.label.trim());

    const labelFont = Math.max(10, Math.round(H * 0.022));
    const legendFont = Math.max(9, Math.round(H * 0.02));
    const colLabelBand = hasColLabels ? Math.round(labelFont * 1.7) : 0;
    const legendBand = showLegend ? Math.round(legendFont * 2.2) : 0;
    // The label cell is only 5/6 of the gutter (a [5,1] split reserves the
    // last sixth as gap to the grid) — sized for the FULL gutter, labels past
    // ~5 chars overran the drawable cell (28-char stress labels by ~28px; the
    // text-fit tripwire's catch). Long labels get a ×6/5-compensated gutter;
    // short ones keep the original math so defaults stay byte-identical (the
    // grid's quantization lattice is sensitive to the gutter width).
    const longestRowLabel = Math.max(0, ...rawRows.map((r) => (r.label ?? "").length));
    const rowLabelPx = longestRowLabel * labelFont * 0.62;
    const rowLabelGutter = hasRowLabels
      ? (rowLabelPx > 3 * labelFont
          ? Math.round((rowLabelPx + labelFont * 0.5) * 6 / 5)
          : Math.round(rowLabelPx + labelFont * 0.8))
      : 0;

    const gridW = cr.w - rowLabelGutter;
    const gridH = cr.h - colLabelBand - legendBand;

    // Square cells filling the grid area. The inter-cell gap rides as a per-cell
    // SOURCE inset (lattice-retargeted after composition), NOT DSL gutters — so
    // the cell matrix stays a clean gutterless `grid(rows×cols)` whose precision
    // is the cell COUNT, not the canvas. The chrome (row/col labels, legend) is a
    // plain RATIO layout. Together the whole template composes at any canvas —
    // no coprime-pixel precision pin (the v2 rebuild of v1's absolute packing).
    const cell = Math.max(SNAP_PX, snapGrid(Math.min(gridW / nCols, gridH / nRows)));
    const gridPxW = nCols * cell;
    const gridPxH = nRows * cell;
    const gap = Math.max(SNAP_PX, snapGrid(cell * 0.14));
    const LBx = Math.max(0, Math.round((gridW - gridPxW) / 2)); // letterbox → square cells
    const LBy = Math.max(0, Math.round((gridH - gridPxH) / 2));

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const maxDiag = Math.max(1, nRows + nCols - 2);
    const fadeDur = Math.max(0.08, introT * 0.35);

    // Mode-aware per-cell reveal (staggered diagonal): premium = alpha fade (geq),
    // light = enable-gate pop (no geq), reduceMotion = static.
    const cellReveal = (startAtSec: number): Record<string, unknown> =>
      !animate ? {} : light ? { startAtSec, enable: `gte(t,${startAtSec.toFixed(3)})` } : { startAtSec, alpha: fadeInExpr(startAtSec, fadeDur) };

    // ── Cells: one colored tile per gutterless grid frame (row-major). The
    //    inter-cell gap is applied AFTER composition via lattice retargeting
    //    (see applyLatticeGapInsets below) — not here. ──
    const gridM0 = String(grid({ rows: nRows, cols: nCols }).m0);
    const cellSources: MosaicSource[] = [];
    const valueSources: MosaicSource[] = [];
    let hasValueText = false;
    for (let r = 0; r < nRows; r++) {
      const vals = rawRows[r].values;
      const { srcIndex: ri, cellLeaves } = rawRows[r];
      // One tile per cell — its color IS rows[ri].values[col], so the tile (and
      // the optional in-cell value text) binds that leaf. A ragged row's padded
      // empty cell keeps its leaf too (an ADD handle — Make pads the array).
      const bindCell = <T extends MosaicSource>(src: T, col: number): T =>
        cellLeaves ? bindPropPath(src, "rows", [ri, "values", col], "number") : src;
      for (let c = 0; c < nCols; c++) {
        const v = c < vals.length ? vals[c] : min; // ragged rows → empty cell
        const fill = bucketColor(bucketOf(v));
        const startAtSec = animate ? (introT - fadeDur) * ((r + c) / maxDiag) : 0;
        const rev = cellReveal(startAtSec);
        const tile = makeColorTile(fill, {
          effects: { rounding: { cornerStyle: "rounded", borderRadius: cellRadius } },
          ...(Object.keys(rev).length ? { overlay: rev } : {}),
        }) as MosaicSource;
        // "cell" tag = the layout contract's join key (equal-size relation —
        // the lattice's core promise, checked over all rows×cols tiles).
        (tile as MosaicSource & { editor?: { label?: string } }).editor = { label: "cell" };
        // An EMPTY cell (v ≤ min) is painted with `scale.emptyColor` LITERALLY
        // (bucketColor(0) returns it unblended) → the tile takes that color as a
        // SECOND entry beside its value leaf (Make opens value + color stacked; the
        // value stays primary). Non-empty cells are computed tints of `color` →
        // never a color handle.
        if (bucketOf(v) === 0) {
          bindProps(tile, [
            ...(cellLeaves ? [{ propKey: "rows", path: [ri, "values", c], kind: "number" as const }] : []),
            { propKey: "scale.emptyColor" },
          ]);
        } else {
          bindCell(tile, c);
        }
        cellSources.push(tile);
        // Value text (optional) rides a second grid overlaid on the cells.
        if (showValues && v > min) {
          hasValueText = true;
          const txt = compactNum(v);
          const vFont = Math.max(8, Math.round(cell * 0.34));
          const tColor = onColor(fill, "#FFFFFF", theme.title);
          const t = bindCell(tag(cellText(txt, vFont, tColor, "center") as MosaicSource, "cell-value"), c);
          valueSources.push(!animate ? t : light ? revealGate(t, startAtSec + fadeDur * 0.5) : revealFade(t, startAtSec + fadeDur * 0.5, fadeDur));
        } else {
          valueSources.push(cellText(" ", 8, "black@0", "center") as MosaicSource);
        }
      }
    }
    const cellsNode: Node = { m0: gridM0, sources: cellSources };
    const gridBody: Node = hasValueText ? overlay([cellsNode, { m0: gridM0, sources: valueSources }]) : cellsNode;

    // ── Labels TRAVEL WITH the grid: the letterbox pads go OUTSIDE the
    // [row-labels · grid] block and outside the [col-labels over grid] stack —
    // pinning the rails to the content rect while the aspect-kept grid centers
    // detached them by hundreds of px at extreme aspects (row labels ~750px
    // left of their rows at 1920×480; col labels ~240px above at 720×1280). ──
    const rowLabelCol: Node = hasRowLabels
      ? rowSplit(rawRows.map((rr) => ({
          weight: 1,
          // [label · pad] — right-aligned text needs breathing room before the cells.
          node: (rr.label ?? "").trim()
            ? colSplit([{ weight: 5, node: paint(bindPropPath(tag(cellText(rr.label ?? "", labelFont, theme.label, "right") as MosaicSource, "row-label"), "rows", [rr.srcIndex, "label"], "string")) }, { weight: 1, node: EMPTY }])
            : EMPTY,
        })))
      : EMPTY;
    const gridWithRail: Node = colSplit([
      ...(LBx > 0 ? [{ weight: LBx, node: EMPTY }] : []),
      ...(hasRowLabels ? [{ weight: rowLabelGutter, node: rowLabelCol }] : []),
      { weight: gridPxW, node: gridBody },
      ...(cr.w - LBx - rowLabelGutter - gridPxW > 0 ? [{ weight: cr.w - LBx - rowLabelGutter - gridPxW, node: EMPTY }] : []),
    ]);

    // ── Column labels: a band directly ABOVE the grid, sharing its x-offsets ──
    const colLabels = props.colLabels ?? [];
    // Width-cap to the column pitch: uncapped, 12-char stress labels needed
    // ~119px in ~101px columns (the text-fit tripwire's catch). Binds only
    // when the longest label would overflow — defaults render byte-identical.
    const longestCol = Math.max(1, ...colLabels.map((l) => (l ?? "").length));
    const colLabelFont = Math.max(9, Math.min(labelFont, Math.floor((gridPxW / nCols) * 0.94 / (longestCol * 0.62))));
    const colLabelBandNode: Node = hasColLabels
      ? colSplit([
          { weight: rowLabelGutter + LBx, node: EMPTY },
          { weight: gridPxW, node: colSplit(Array.from({ length: nCols }, (_, c) => {
            const lbl = colLabels[c];
            // The label cell displays `colLabels[c]` — bound for Make's double-click edit.
            return { weight: 1, node: lbl && lbl.trim() ? paint(bindProp(tag(cellText(lbl, colLabelFont, theme.muted, "center") as MosaicSource, "col-label"), "colLabels", c)) : EMPTY };
          })) },
          { weight: Math.max(1, cr.w - rowLabelGutter - LBx - gridPxW), node: EMPTY },
        ])
      : EMPTY;

    // ── Legend: "Less" [swatch ×levels] "More", right-aligned in its band ──
    let legendNode: Node = EMPTY;
    if (showLegend) {
      const swatch = Math.max(SNAP_PX * 2, Math.round(legendFont * 1.1));
      const sgap = Math.max(2, Math.round(swatch * 0.28));
      const lessW = Math.max(1, Math.round(textBBoxWidth("Less", legendFont)));
      const moreW = Math.max(1, Math.round(textBBoxWidth("More", legendFont)));
      const swatchesW = levels * (swatch + sgap);
      const stripW = lessW + sgap * 2 + swatchesW + sgap * 2 + moreW;
      // One EQUAL band per swatch, gap carved INSIDE via a placement inset —
      // the only construction that guarantees ≤1px spread (interleaved px
      // weights in a strip dominated by the leading remainder band spread the
      // little swatches up to 46%; q4 grain still left 25%).
      const q = (px: number) => Math.max(1, Math.round(px / 4));
      const bandPitch = swatch + sgap;
      const swInsetX = sgap / (2 * bandPitch);
      const swBands: Band[] = [];
      for (let b = 0; b < levels; b++) {
        const sw = makeColorTile(bucketColor(b), {
          effects: { rounding: { cornerStyle: "rounded", borderRadius: cellRadius } },
          placement: { inset: { x: swInsetX } },
        }) as MosaicSource;
        (sw as MosaicSource & { editor?: { label?: string } }).editor = { label: "legend-swatch" };
        // Only the two swatches whose fill IS a prop bind: the first paints
        // `scale.emptyColor`, the last the full-intensity `color` (the ONLY rect
        // that shows the hue itself — the cells are computed tints). The tints
        // between are derived → unbound.
        if (b === 0) bindProp(sw, "scale.emptyColor");
        else if (b === levels - 1) bindProp(sw, "color");
        swBands.push({ weight: 1, node: paint(sw) });
      }
      const strip: Node = colSplit([
        { weight: q(Math.max(1, cr.w - stripW)), node: EMPTY },
        { weight: q(lessW), node: paint(tag(cellText("Less", legendFont, theme.muted, "left") as MosaicSource, "legend-caption")) },
        { weight: q(sgap * 2), node: EMPTY },
        { weight: q(swatchesW), node: colSplit(swBands) },
        { weight: q(sgap * 2), node: EMPTY },
        { weight: q(moreW), node: paint(tag(cellText("More", legendFont, theme.muted, "left") as MosaicSource, "legend-caption")) },
      ]);
      const vpad = Math.max(0, Math.round((legendBand - swatch) / 2));
      legendNode = rowSplit([
        { weight: Math.max(1, vpad), node: EMPTY },
        { weight: swatch, node: strip },
        { weight: Math.max(1, legendBand - swatch - vpad), node: EMPTY },
      ]);
    }

    // ── Content stack: vertical letterbox OUTSIDE the [col-labels · grid]
    // unit so the label band hugs the grid top; legend stays pinned bottom. ──
    const bottomPad = Math.max(0, cr.h - legendBand - LBy - colLabelBand - gridPxH);
    const contentBands: Band[] = [];
    if (LBy > 0) contentBands.push({ weight: LBy, node: EMPTY });
    if (colLabelBand > 0) contentBands.push({ weight: colLabelBand, node: colLabelBandNode });
    contentBands.push({ weight: gridPxH, node: gridWithRail });
    if (bottomPad > 0) contentBands.push({ weight: bottomPad, node: EMPTY });
    if (legendBand > 0) contentBands.push({ weight: legendBand, node: legendNode });
    const root = card.compose(rowSplit(contentBands));

    // Exact inter-cell gaps, applied against the TRUTH: parse the composed m0
    // at the render canvas and retarget the raw cell rects onto an authored
    // lattice (see the helper doc).
    applyLatticeGapInsets({
      root,
      cellSources,
      valueSources: hasValueText ? valueSources : null,
      nRows,
      nCols,
      gapPx: gap,
      W,
      H,
    });

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

    // Dev tripwire: the lattice's core promise — every cell paints the same
    // size (all rows×cols tiles), legend swatches too. Falsy debugLayout
    // returns the doc untouched at zero cost.
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/heatmap/v2",
        relations: [
          ...(nRows * nCols >= 2 ? [{ label: "cell", equal: "size" as const, tolerance: 0.02, tolerancePx: 1 }] : []),
          ...(showLegend ? [{ label: "legend-swatch", equal: "size" as const, tolerance: 0.02, tolerancePx: 1 }] : []),
        ],
        // Text-fit tripwires (0.62em = the template's own textBBoxWidth model;
        // padPx 0 where the template already bakes its own slack into the box).
        constraints: [
          ...card.constraints,
          // hasValueText, not showValues: flat data (every v == min) paints no
          // value text at all — showValues alone would raise missing-label.
          ...(hasValueText ? [{ label: "cell-value", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
          ...(hasRowLabels ? [{ label: "row-label", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
          ...(hasColLabels ? [{ label: "col-label", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
          ...(showLegend ? [{ label: "legend-caption", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // template's own static default render, INLINED flat (gate-15/21 keeper).
  async renderCover(_props: AlpineHeatmapV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const hero = (await AlpineHeatmapV2.render(
      {
        ...(AlpineHeatmapV2.defaultProps as AlpineHeatmapV2Props),
        anim: { ...DEFAULT_ANIM, renderMode: "light", reduceMotion: true },
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "Heatmap",
        title: "A heatmap.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(hero), theme.borderStrong),
      heroAssets: hero.assets,
      children: (hero as { children?: Record<string, MosaicDocument> }).children,
    });
  },
};

function textBBoxWidth(text: string, font: number): number {
  return Math.max(font, text.length * font * 0.62 + font * 0.5);
}

/**
 * Exact inter-cell gaps via lattice retargeting (`latticeCellInset` — the
 * successor of the deprecated `gridCellInset`, whose ideal-cell fractions
 * wobbled ±1px against the quantized cells).
 *
 * The cell matrix reaches the pixels through THREE quantization layers — the
 * card's basis-capped ratio splits, the letterbox bands, and the engine's own
 * split rounding — so no up-front pixel math can know the real cell rects.
 * Instead: parse the COMPOSED m0 at the render canvas (the collage-solver
 * move), take each cell's RAW rect as truth, and retarget all of them onto an
 * authored integer lattice spanning the grid's own raw region — equal cells,
 * gaps of EXACTLY `gapPx` between every adjacent pair, full-bleed edges. Each
 * cell tile gets a half-pixel-centered `placement.inset` recovering its
 * target; the value texts ride the same inset so they center on the painted
 * cell, not the raw one.
 *
 * Degrades to a gapless grid when the region can't fit the lattice (sub-1px
 * units — canvases where the gap would be unreadable anyway) or when the
 * frame↔source binding doesn't line up (defensive; never kills the render).
 */
function applyLatticeGapInsets(args: {
  root: Node;
  cellSources: MosaicSource[];
  valueSources: MosaicSource[] | null;
  nRows: number;
  nCols: number;
  gapPx: number;
  W: number;
  H: number;
}): void {
  const { root, cellSources, valueSources, nRows, nCols, gapPx, W, H } = args;
  if (gapPx <= 0 || cellSources.length === 0) return;
  const N = nRows * nCols;

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

    // The grid's own raw region — the lattice spans exactly this box.
    const minX = Math.min(...raws.map((r) => r.x));
    const minY = Math.min(...raws.map((r) => r.y));
    const maxX = Math.max(...raws.map((r) => r.x + r.w));
    const maxY = Math.max(...raws.map((r) => r.y + r.h));

    const lat = latticeCellInset({
      cols: nCols,
      rows: nRows,
      canvasW: maxX - minX,
      canvasH: maxY - minY,
      gutterXPx: gapPx,
      gutterYPx: gapPx,
      marginPx: 0,
      cells: raws.map((r, k) => ({
        unit: { c0: k % nCols, r0: Math.floor(k / nCols), cs: 1, rs: 1 },
        raw: { x: r.x - minX, y: r.y - minY, w: r.w, h: r.h },
      })),
    });

    for (let k = 0; k < N; k++) {
      const box = lat.insetAt(k);
      if (!box) continue;
      (cellSources[k] as { placement?: unknown }).placement = { inset: box };
      if (valueSources) (valueSources[k] as { placement?: unknown }).placement = { inset: box };
    }
  } catch {
    // Degenerate lattice (tiny canvas) — render gapless rather than dying.
  }
}

registerTemplate(AlpineHeatmapV2);
