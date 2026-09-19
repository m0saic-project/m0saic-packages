import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/heatmap/v1 — Alpine Heatmap (friendly mobile-marketing)
 * ============================================================================
 *
 * A matrix heatmap inside the Alpine white card: a grid of rounded cells, each
 * colored by its value on a single-hue intensity scale (a pale tint → the full
 * color). Row labels sit in a left gutter, optional column labels along the top,
 * and a "Less → More" legend at the bottom. Generalizes the GitHub contribution
 * calendar (7 weekday rows × N week columns) but works for any rows × cols data.
 *
 * Construction follows the donut / kpi-card model — every cell, label and legend
 * swatch is an ABSOLUTELY-PLACED tight rect packed full-canvas via `placeRects`
 * (SNAP_PX grid), so a clean grid never fights nested-split quantization and the
 * tile count stays a flat rows×cols. The colored cells are plain rounded
 * `makeColorTile`s (no inline-mask). Animation: cells fade in on a top-left→
 * bottom-right diagonal cascade; `anim.reduceMotion` → the static board.
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
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeErrorMosaic,
  fadeInExpr,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { placeRects } from "@m0saic/dsl-stdlib";

import {
  alpineCard,
  EMPTY,
  type Node,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate, revealFade, ALPINE_ANIM_FIELDS, fBool, fNum, fStr, fEnum } from "../../_shared/alpine-anim";

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

type AlpineHeatmapProps = {
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

const propsSchema = definePropsSchema<AlpineHeatmapProps>({
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
});

export const AlpineHeatmap: MosaicTemplate<AlpineHeatmapProps> = {
  id: asTemplateId("@m0saic/alpine/heatmap/v1"),
  label: "Alpine Heatmap",
  version: 1,
  description: "Alpine heatmap — friendly mobile-marketing card: a rows×cols grid of rounded cells colored on a single-hue intensity scale, with row/column labels and a Less→More legend. Generalizes the GitHub contribution calendar. Standalone Alpine brand flavor.",
  capabilities: { tier: "core" },
  primitive: true,
  deprecated: {
    reason:
      "Absolute-placement antipattern: every cell/label/legend swatch is a tight rect packed full-canvas via placeRects on a per-pixel SNAP grid, so precision tracks the canvas — coprime cell pitches pin it to ~100% (30k+ node m0, seconds/canvas in the precision sweep). Kept as the canonical 'absolute grid' example. Use v2 — the SAME picture rebuilt as a RATIO layout: a gutterless grid() whose precision is the cell COUNT, with the inter-cell gap riding as a per-cell source inset (gridCellInset). Composes at any canvas; ~13× smaller m0, ~5× faster render.",
    replacement: asTemplateId("@m0saic/alpine/heatmap/v2"),
    since: "2026-07-09",
  },
  tags: ["alpine", "heatmap", "matrix", "data-viz"],
  outputHints: { width: 1280, height: 800, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
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

  async render(props: AlpineHeatmapProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    const rawRows = (props.rows ?? [])
      .map((r) => ({ label: typeof r?.label === "string" ? r.label : "", values: parseValues(r?.values) }))
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
    const rowLabelGutter = hasRowLabels ? Math.round((Math.max(...rawRows.map((r) => (r.label ?? "").length)) * labelFont * 0.62) + labelFont * 0.8) : 0;

    const gridX = cr.x + rowLabelGutter;
    const gridY = cr.y + colLabelBand;
    const gridW = cr.w - rowLabelGutter;
    const gridH = cr.h - colLabelBand - legendBand;

    // Square-ish cells on the SNAP_PX lattice: pitch + gap + offsets are all
    // multiples of SNAP_PX, so every cell edge and gap-band boundary is grid-aligned
    // → placeRects packs the grid without 0-size filler bands.
    const gap = Math.max(SNAP_PX, snapGrid(Math.min(gridW / nCols, gridH / nRows) * 0.12));
    const pitch = Math.max(SNAP_PX * 2, snapGrid(Math.min((gridW - gap) / nCols, (gridH - gap) / nRows)));
    const cellSize = pitch - gap;
    const usedW = nCols * pitch - gap;
    const usedH = nRows * pitch - gap;
    // Center the WHOLE [row-label gutter + grid] block in the content width (so a
    // square grid in a wide card sits centered, not shoved right of the gutter).
    const blockW = rowLabelGutter + usedW;
    const offX = snapGrid(cr.x + Math.max(0, (cr.w - blockW) / 2) + rowLabelGutter);
    const offY = snapGrid(gridY + Math.max(0, (gridH - usedH) / 2));

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const maxDiag = Math.max(1, nRows + nCols - 2);
    const fadeDur = Math.max(0.08, introT * 0.35);

    const cellX = (c: number) => offX + c * pitch;
    const cellY = (r: number) => offY + r * pitch;

    // Mode-aware reveal: premium = per-cell alpha fade (a geq); light = free
    // enable-gate pop (no geq); reduceMotion = static. Both keep the diagonal
    // top-left→bottom-right cascade via the staggered `startAtSec`. Premium is
    // byte-identical to the pre-audit `overlay.alpha`.
    const cellReveal = (startAtSec: number): Record<string, unknown> =>
      !animate ? {} : light ? { startAtSec, enable: `gte(t,${startAtSec.toFixed(3)})` } : { startAtSec, alpha: fadeInExpr(startAtSec, fadeDur) };
    const revealText = <T extends MosaicSource>(src: T, startSec: number, durSec: number): T =>
      !animate ? src : light ? revealGate(src, startSec) : revealFade(src, startSec, durSec);

    const pieces: Piece[] = [];

    // ── Cells ──
    for (let r = 0; r < nRows; r++) {
      const vals = rawRows[r].values;
      for (let c = 0; c < nCols; c++) {
        const v = c < vals.length ? vals[c] : min; // ragged rows → empty cell
        const b = bucketOf(v);
        const fill = bucketColor(b);
        const startAtSec = animate ? (introT - fadeDur) * ((r + c) / maxDiag) : 0;
        const rev = cellReveal(startAtSec);
        const tile = makeColorTile(fill, {
          effects: { rounding: { cornerStyle: "rounded", borderRadius: cellRadius } },
          ...(Object.keys(rev).length ? { overlay: rev } : {}),
        });
        const cp = rectPiece(W, H, cellX(c), cellY(r), cellSize, cellSize, tile, 0);
        pieces.push(cp);
        if (showValues && v > min) {
          // Compact-format (1.2M / 38K) so the label stays short, then size the font
          // LENGTH-AWARE to the cell width (the donut center-value trick): the text
          // is computed to fit, so it never overflows into a neighbor — no clipping.
          const txt = compactNum(v);
          const vFont = Math.max(8, Math.min(Math.round(cellSize * 0.42), Math.round((cellSize * 0.76) / Math.max(1, txt.length * 0.62))));
          const tColor = onColor(fill, "#FFFFFF", theme.title);
          const cx = cellX(c) + cellSize / 2, cy = cellY(r) + cellSize / 2;
          const tp = placeText(W, H, textBBox(cx, cy, txt, vFont, "center"),
            revealText(cellText(txt, vFont, tColor, "center"), startAtSec + fadeDur * 0.5, fadeDur), 1);
          pieces.push(tp);
        }
      }
    }

    // ── Row labels (left gutter, right-aligned against the grid) ──
    if (hasRowLabels) {
      for (let r = 0; r < nRows; r++) {
        const lbl = rawRows[r].label ?? "";
        if (!lbl.trim()) continue;
        const cy = cellY(r) + cellSize / 2;
        const rightX = offX - gap * 1.5;
        pieces.push(placeText(W, H, textBBox(rightX, cy, lbl, labelFont, "right"), cellText(lbl, labelFont, theme.label, "right"), 1));
      }
    }

    // ── Column labels (top band, centered over each column) ──
    if (hasColLabels) {
      const labels = props.colLabels ?? [];
      for (let c = 0; c < nCols; c++) {
        const lbl = labels[c];
        if (!lbl || !lbl.trim()) continue;
        const cx = cellX(c) + cellSize / 2;
        const cy = gridY - colLabelBand / 2;
        pieces.push(placeText(W, H, textBBox(cx, cy, lbl, labelFont, "center"), cellText(lbl, labelFont, theme.muted, "center"), 1));
      }
    }

    // ── Legend: "Less" [swatch ×levels] "More" — bottom-right under the grid ──
    if (showLegend) {
      const swatch = Math.max(SNAP_PX * 2, Math.round(legendFont * 1.1));
      const sgap = Math.max(2, Math.round(swatch * 0.28));
      const legendY = cr.y + cr.h - legendBand / 2;
      const swatchesW = levels * swatch + (levels - 1) * sgap;
      const lessW = Math.round(textBBoxWidth("Less", legendFont));
      const moreW = Math.round(textBBoxWidth("More", legendFont));
      const totalW = lessW + sgap * 2 + swatchesW + sgap * 2 + moreW;
      let lx = cr.x + cr.w - totalW; // right-aligned
      if (lx < cr.x) lx = cr.x;
      // "Less"
      pieces.push(placeText(W, H, textBBox(lx, legendY, "Less", legendFont, "left"), cellText("Less", legendFont, theme.muted, "left"), 1));
      lx += lessW + sgap * 2;
      for (let b = 0; b < levels; b++) {
        pieces.push(rectPiece(W, H, lx, Math.round(legendY - swatch / 2), swatch, swatch,
          makeColorTile(bucketColor(b), { effects: { rounding: { cornerStyle: "rounded", borderRadius: cellRadius } } }), 1));
        lx += swatch + (b < levels - 1 ? sgap : 0);
      }
      lx += sgap * 2;
      pieces.push(placeText(W, H, textBBox(lx, legendY, "More", legendFont, "left"), cellText("More", legendFont, theme.muted, "left"), 1));
    }

    // ── Pack full-canvas → one { m0, sources } ──
    const placed = placeRects({ rootW: W, rootH: H, rects: pieces.map((p) => p.rect) as any });
    const sources: MosaicSource[] = [];
    for (const layer of (placed as { layers: Array<{ rectIndices: number[] }> }).layers) {
      const ordered = [...layer.rectIndices].sort((a, b) => pieces[a].rect.y - pieces[b].rect.y || pieces[a].rect.x - pieces[b].rect.x);
      for (const idx of ordered) sources.push(pieces[idx].source);
    }
    const grid: Node = { m0: String((placed as { m0: string }).m0), sources };

    // The grid is FULL-CANVAS absolute geometry (cells positioned in canvas coords
    // within the content rect). Pass it as an extraLayer — NOT the scaled `content`
    // — so it is NOT re-quantized through insetNode's child cell (which would spread
    // the fractional remainder and make some cells wider than others). The header
    // rides the scaled content stack; the grid floats full-canvas on top.
    const root = card.compose(EMPTY, grid);

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

function textBBoxWidth(text: string, font: number): number {
  return Math.max(font, text.length * font * 0.62 + font * 0.5);
}

registerTemplate(AlpineHeatmap);
