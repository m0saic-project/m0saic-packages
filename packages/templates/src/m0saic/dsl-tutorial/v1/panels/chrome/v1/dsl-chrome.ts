/**
 * ============================================================================
 * @m0saic/dsl-tutorial/chrome/v1 — IDE chrome subtemplate (internal)
 * ============================================================================
 *
 * Renders the full-bleed header bar (traffic lights · title + Tutorial chip ·
 * Speed pill · counting Step pill) OR the bottom status bar (live dot · Parsing
 * · Tokens · Nodes), selected by the `part` prop. Rendered by the parent
 * orchestrator at its slot size, so it fills the header/status cell exactly.
 *
 * The Step pill number is a per-frame count-up: the parent passes a precomputed
 * drawtext `stepExpr` (from the shared timing model) so it advances on the same
 * global clock as every other panel — no local clock, fully deterministic.
 *
 * Every string is WIDTH-FITTED (gate 33): the bar's height picks the font the
 * design wants, the cell width under the CLI width model (`_shared/text-fit`)
 * caps it, and only the title ellipsizes at the floor. Below the floor the
 * status strip DROPS trailing metrics rather than clipping them. Each fitted
 * source is tagged for the parent's `debugLayout` contract (`textFits`).
 * ============================================================================
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicEngineContext,
  MosaicDocument,
  MosaicTemplate,
  MosaicTextSource,
  MosaicSource,
  MosaicColor,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { bindProp, definePropsSchema, registerTemplate, makeColorTile, tag } from "@m0saic/template-utils";

import type { Node } from "../../../_shared/node-kit";
import {
  EMPTY,
  paint,
  rowSplit,
  colSplit,
  overlay,
  textCell,
  colorTile,
} from "../../../_shared/node-kit";
import { HEADER_M_GLYPH, STATUS_M0_GLYPH } from "../../../_shared/brand-glyphs";
import { dslTutorialTheme } from "../../../theme/tokens";
import type { DslTutorialPreset, DslTutorialTheme } from "../../../theme/tokens";
import { PROSE_EM, DIGIT_EM, fitBudget, fitFontPxAll, fitLine, textWidthPx } from "../../../_shared/text-fit";

/** The m0saic brand orange — the logo silhouettes paint in it (brand-constant). */
const BRAND_ORANGE = "#EF7525";

/** A brand glyph (M / m0) as a single-colour silhouette: one makeColorTile clipped
 *  by the glyph's own (square) SVG paths. Must be placed in a SQUARE cell (see
 *  {@link squareCell}) so the square silhouette isn't stretched. */
function glyphLogo(
  glyph: { bounds: { x: number; y: number; width: number; height: number }; path: string },
  color: MosaicColor,
): Node {
  return paint(
    makeColorTile(color, {
      mask: { kind: "inline-mask", localPath: glyph.path, bounds: glyph.bounds },
    }) as MosaicSource,
  );
}

/** Centre `node` in a PERFECT SQUARE inside a `cellW × cellH` cell — pad the longer
 *  side so a square glyph keeps its shape (we own the geometry; never hand a logo a
 *  non-square box). */
function squareCell(node: Node, cellW: number, cellH: number): Node {
  if (cellW >= cellH) {
    const pad = Math.max(0, (cellW - cellH) / 2);
    return colSplit([{ weight: pad, node: EMPTY }, { weight: cellH, node }, { weight: pad, node: EMPTY }]);
  }
  const pad = Math.max(0, (cellH - cellW) / 2);
  return rowSplit([{ weight: pad, node: EMPTY }, { weight: cellW, node }, { weight: pad, node: EMPTY }]);
}

/** Static DSL metrics shown in the status info bar. All derived from the layout. */
export type DslChromeMetrics = {
  canvas?: string; // "1920×1080"
  chars?: number;
  frames?: number;
  passthroughs?: number;
  nulls?: number;
  groups?: number;
  precision?: string; // "9×2" (maxSplitX × maxSplitY)
  minFeasible?: string; // "9×2 px" (min feasible W × H)
};

export type DslChromeProps = {
  part?: "header" | "status";
  preset?: DslTutorialPreset;
  title?: string;
  speedLabel?: string;
  /** Drawtext expr for the live step NUMBER (eval:"frame"), bare — the pill
   *  wraps it in its own `Step  … / N` (or compact `… / N`) wording. */
  stepExpr?: string;
  stepTotal?: number;
  statusLabel?: string;
  metrics?: DslChromeMetrics;
  /** Draw a hairline divider under the header bar — set when the DSL-string strip
   *  below it is hidden, so the header doesn't blend into the canvas. */
  divider?: boolean;
};

const propsSchema = definePropsSchema<DslChromeProps>({
  part: {
    type: "string",
    required: false,
    description: 'Which chrome bar to render: "header" or "status".',
    meta: { constraints: { oneOf: ["header", "status"] } },
  },
  preset: { type: "string", required: false, description: "Theme preset (light/dark)." },
  title: { type: "string", required: false, description: "Header title text." },
  speedLabel: { type: "string", required: false, description: "Speed pill text (e.g. 1.25x)." },
  stepExpr: {
    type: "string",
    required: false,
    description: "Drawtext expr for the live step number (bare — the pill adds its own `Step … / N` wording). Unset = a static `Step 1 / N`.",
    meta: { control: { placeholder: "static (the parent injects the live counter)" } },
  },
  stepTotal: { type: "number", required: false, description: "Total step count." },
  statusLabel: { type: "string", required: false, description: "Status label (e.g. Parsing)." },
  metrics: { type: "json", required: false, description: "DSL metrics for the status info bar." },
  divider: { type: "boolean", required: false, description: "Hairline divider under the header (when the DSL strip below is hidden)." },
});

/** An expr text cell (per-frame eval) — drives the counting step number. */
function exprTextCell(
  expr: string,
  fontSize: number,
  color: MosaicColor,
): MosaicTextSource {
  return {
    type: "text",
    renderMode: { kind: "video" },
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "expr", expr, eval: "frame" },
        style: { fontSize, fontColor: color },
        placement: { hAlign: "center", vAlign: "middle" } as never,
      },
    ],
  } as MosaicTextSource;
}

/** A rounded-rect control surface holding a content node (not a full oval). */
function pill(content: Node, theme: DslTutorialTheme, radius = 0.3): Node {
  return overlay([
    paint(colorTile(theme.surfaceRaised, {
      cornerRadius: radius,
      cornerStyle: "rounded",
      border: { color: theme.border, width: 0.004, alpha: theme.borderAlpha },
    })),
    content,
  ]);
}

/** Horizontal padding around a node (safe — never subdivides the thin height). */
function hpad(node: Node, left: number, mid: number, right: number): Node {
  return colSplit([
    { weight: left, node: EMPTY },
    { weight: mid, node },
    { weight: right, node: EMPTY },
  ]);
}

/** Fixed-size left text (NOT contain-fit, so values render at one consistent size
 *  across all metrics instead of each scaling to its own cell). */
function fixedText(text: string, font: number, color: MosaicColor): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: text || " " },
        style: { fontSize: font, fontColor: color },
        placement: { hAlign: "left", vAlign: "middle" } as never,
      },
    ],
  } as MosaicTextSource;
}

/** A thin vertical divider, vertically inset — separates the status label from the
 *  metric strip. */
function vDivider(theme: DslTutorialTheme): Node {
  return rowSplit([
    { weight: 3, node: EMPTY },
    { weight: 8, node: paint(colorTile(theme.border)) },
    { weight: 3, node: EMPTY },
  ]);
}

/** One status metric, EQUAL outer width across the strip: a muted `label` then its
 *  bright `value` at a fixed size. The label/value bands are sized to their CHAR
 *  COUNT (not a fixed split) so neither clips regardless of which is longer, and a
 *  trailing gap separates it from the next metric. */
function metricCell(label: string, value: string, theme: DslTutorialTheme, font: number): Node {
  return colSplit([
    { weight: metricLabelWeight(label), node: paint(tag(fixedText(label, font, theme.muted), "metric-label")) },
    { weight: 1, node: EMPTY },
    { weight: metricValueWeight(value), node: paint(tag(fixedText(value, font, theme.title), "metric-value")) },
    { weight: 3, node: EMPTY }, // trailing gap → separation from the next metric
  ]);
}

/** The label / value / gap weights of one metric cell (its colSplit basis). */
const metricLabelWeight = (label: string): number => Math.max(3, label.length);
const metricValueWeight = (value: string): number => Math.max(2, value.length);
const metricTotalWeight = (label: string, value: string): number =>
  metricLabelWeight(label) + 1 + metricValueWeight(value) + 3;

/** Header bar column weights (basis 113): lead · logo · gap · title · spacer · speed · gap · step · trail. */
const HEADER_COLS = { lead: 3, logo: 6, gap1: 4, title: 26, spacer: 33, speed: 14, gap2: 2, step: 22, trail: 3 };
const HEADER_TOTAL = Object.values(HEADER_COLS).reduce((a, b) => a + b, 0);
/** hpad(…, 1, 8, 1): a pill's text gets the middle 8/10 of the pill. */
const PILL_INNER_FRAC = 0.8;
const TITLE_MIN_PX = 11;
/** A long title ellipsizes once it would have to shrink below this fraction of
 *  the bar's design size — a title at the 11px floor under a 30px bar reads as
 *  a caption, not a title. */
const TITLE_MIN_OF_DESIGN = 0.7;
const PILL_MIN_PX = 9;
const METRIC_MIN_PX = 9;

/** The Step pill's prefix / suffix around the live number: the full form and the
 *  compact form a narrow pill degrades to (the number + total still read). */
const STEP_PREFIX = "Step  ";
const STEP_PREFIX_COMPACT = "";
const stepSuffix = (stepTotal: number): string => `  /  ${Math.max(1, Math.round(stepTotal))}`;

/** The widest string the counting Step pill ever shows (`Step  N / N`), in the
 *  full or compact form. */
export function stepPillModelText(stepTotal: number, compact = false): string {
  const n = String(Math.max(1, Math.round(stepTotal)));
  return `${compact ? STEP_PREFIX_COMPACT : STEP_PREFIX}${n} / ${n}`;
}

/** The Speed pill text, full (`Speed  1.0x`) or compact (`1.0x`). */
export function speedPillText(speedLabel: string, compact = false): string {
  return compact ? speedLabel : `Speed  ${speedLabel}`;
}

/**
 * The header pills' shared font + wording: both pills use ONE font; the full
 * wording is kept whenever it fits at or above the floor, else both degrade to
 * the compact wording (`1.0x` · `10 / 16`) so a tiny canvas never clips a pill.
 * Exported for the gate-33 locks.
 */
export function fitHeaderPills(
  speedLabel: string,
  stepTotal: number,
  W: number,
  fontMax: number,
): { font: number; compact: boolean } {
  const speedInnerW = fitBudget((HEADER_COLS.speed / HEADER_TOTAL) * W * PILL_INNER_FRAC);
  const stepInnerW = fitBudget((HEADER_COLS.step / HEADER_TOTAL) * W * PILL_INNER_FRAC);
  for (const compact of [false, true]) {
    const bands = [
      { text: speedPillText(speedLabel, compact), availW: speedInnerW, em: PROSE_EM },
      { text: stepPillModelText(stepTotal, compact), availW: stepInnerW, em: DIGIT_EM },
    ];
    const font = fitFontPxAll(bands, fontMax, PILL_MIN_PX);
    if (bands.every((b) => textWidthPx(b.text, font, b.em) <= b.availW)) return { font, compact };
  }
  return { font: PILL_MIN_PX, compact: true };
}

/**
 * Pick the status strip's metric set + font: EQUAL columns, one shared font
 * that fits the tightest label/value band under the width model. When even the
 * floor font can't fit, drop metrics from the TAIL (the least load-bearing
 * ones — precision / min-feasible go first) and retry with wider columns, so a
 * narrow canvas shows fewer whole metrics instead of eight clipped ones.
 */
export function fitStatusMetrics(
  items: ReadonlyArray<{ label: string; value: string }>,
  stripW: number,
  fontMax: number,
): { items: { label: string; value: string }[]; font: number; metricW: number } {
  let kept = items.slice();
  while (kept.length > 0) {
    const total = statusBasis(kept.length);
    const metricW = (STATUS_METRIC_W / total) * stripW;
    const bands = kept.flatMap((it) => {
      const basis = metricTotalWeight(it.label, it.value);
      return [
        { text: it.label, availW: fitBudget((metricLabelWeight(it.label) / basis) * metricW), em: PROSE_EM },
        { text: it.value, availW: fitBudget((metricValueWeight(it.value) / basis) * metricW), em: DIGIT_EM },
      ];
    });
    const font = fitFontPxAll(bands, fontMax, METRIC_MIN_PX);
    const fits = bands.every((b) => textWidthPx(b.text, font, b.em) <= b.availW);
    if (fits) return { items: kept, font, metricW };
    kept = kept.slice(0, -1);
  }
  return { items: [], font: Math.max(METRIC_MIN_PX, Math.round(fontMax)), metricW: 0 };
}

const STATUS_METRIC_W = 13; // equal width per metric
const STATUS_LOGO_W = 3;
const STATUS_PARSE_W = 7;
/** Status strip colSplit basis for `n` metrics: lead · logo · gap · Parsing · divider · gap · n metrics · trail. */
const statusBasis = (n: number): number => 1 + STATUS_LOGO_W + 2 + STATUS_PARSE_W + 1 + 1 + n * STATUS_METRIC_W + 1;

/** Vertically center bar content with safe top/bottom padding. */
function bar(content: Node): Node {
  return rowSplit([
    { weight: 2, node: EMPTY },
    { weight: 11, node: content },
    { weight: 2, node: EMPTY },
  ]);
}

export const DslChrome: MosaicTemplate<DslChromeProps> = {
  id: asTemplateId("@m0saic/dsl-tutorial/chrome/v1"),
  label: "DSL Tutorial — Chrome",
  version: 1,
  description: "Internal: IDE header / status bar chrome for the dsl-tutorial template.",
  capabilities: { tier: "core" },
  tags: ["developer", "dsl-tutorial", "internal", "chrome"],
  internal: true,
  outputHints: {
    width: 1600,
    height: 90,
    fps: 30,
    durationMs: 1000,
    note: "IDE chrome bar (header or status) for dsl-tutorial.",
  },
  propsSchema,
  // Complete defaults (the default-props contract): the parent injects every
  // value, but a knob's unset state must still read true in an editor.
  defaultProps: {
    part: "header",
    preset: "dark",
    title: "DSL Tutorial",
    speedLabel: "1.0x",
    stepTotal: 1,
    statusLabel: "Parsing",
    divider: false,
  },

  render(props: DslChromeProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const theme = dslTutorialTheme(props.preset);
    const W = ctx.target.width;
    const H = ctx.target.height;
    const part = props.part ?? "header";

    const fontMain = Math.max(12, Math.round(H * 0.30));
    const fontSmall = Math.max(10, Math.round(H * 0.24));
    // The bar() wrapper gives content the middle 11/15 of the bar height — that's
    // the logo cell's height, used to square it (see squareCell).
    const barContentH = (11 / 15) * H;

    let root: Node;

    if (part === "header") {
      // Title: the bar height picks the size; the title cell's width caps it
      // (portrait canvases used to clip "Animated Wireframe" to "Animated");
      // a title longer than the cell at the floor ellipsizes.
      const titleW = (HEADER_COLS.title / HEADER_TOTAL) * W;
      const titleMin = Math.max(TITLE_MIN_PX, Math.round(fontMain * TITLE_MIN_OF_DESIGN));
      const title = fitLine(props.title ?? "DSL Tutorial", fitBudget(titleW), fontMain, titleMin, PROSE_EM);
      // The header title SHOWS `title` — bind it (Make double-click edits the prop).
      const titleNode = paint(bindProp(tag(textCell(title.text, title.fontSize, theme.title, "left", "middle"), "header-title"), "title"));

      // Pills share ONE font: the larger of the two strings decides. The Step
      // pill counts per frame (an expr — nothing static to measure at check
      // time), so it is modelled at its WIDEST state, `Step  N / N`; a tiny
      // canvas degrades both pills to their compact wording (fitHeaderPills).
      const stepTotal = props.stepTotal ?? 1;
      const { font: pillFont, compact } = fitHeaderPills(props.speedLabel ?? "1x", stepTotal, W, fontSmall);
      const speedText = speedPillText(props.speedLabel ?? "1x", compact);
      const stepPrefix = compact ? STEP_PREFIX_COMPACT : STEP_PREFIX;
      const speedNode = pill(
        hpad(paint(bindProp(tag(textCell(speedText, pillFont, theme.label, "center", "middle"), "header-pill"), "speedLabel")), 1, 8, 1),
        theme,
      );
      // `stepExpr` is the BARE live-number expr; the pill wraps its own wording.
      const stepInner = props.stepExpr
        ? paint(exprTextCell(`${stepPrefix}${props.stepExpr}${stepSuffix(stepTotal)}`, pillFont, theme.title))
        : paint(tag(textCell(`${stepPrefix}1 / ${stepTotal}`, pillFont, theme.title, "center", "middle"), "header-pill"));
      const stepNode = pill(hpad(stepInner, 1, 8, 1), theme);

      // logo cell width = its weight / the colSplit total (113).
      const logoW = (HEADER_COLS.logo / HEADER_TOTAL) * W;
      root = bar(colSplit([
        { weight: HEADER_COLS.lead, node: EMPTY },
        { weight: HEADER_COLS.logo, node: squareCell(glyphLogo(HEADER_M_GLYPH, BRAND_ORANGE), logoW, barContentH) },
        { weight: HEADER_COLS.gap1, node: EMPTY },
        { weight: HEADER_COLS.title, node: titleNode },
        { weight: HEADER_COLS.spacer, node: EMPTY }, // flexible spacer (absorbed the removed Tutorial chip)
        { weight: HEADER_COLS.speed, node: speedNode },
        { weight: HEADER_COLS.gap2, node: EMPTY },
        { weight: HEADER_COLS.step, node: stepNode },
        { weight: HEADER_COLS.trail, node: EMPTY },
      ]));
      // Hairline divider under the header when the DSL strip below it is hidden, so
      // the header reads as chrome and doesn't blend into the canvas beneath it.
      if (props.divider) {
        root = rowSplit([
          { weight: 100, node: root },
          { weight: 3, node: paint(colorTile(theme.border)) },
        ]);
      }
    } else {
      // Status info bar: m0 logo · Parsing │ canvas · chars · frames · passthroughs ·
      // nulls · groups · precision · min-feasible. Metrics are EQUAL width (one fixed
      // weight each) so the strip reads as aligned columns; a vertical divider + tight
      // gap separate "Parsing" from the metric strip.
      const m = props.metrics ?? {};
      const items: { label: string; value: string }[] = [
        { label: "canvas", value: m.canvas ?? "—" },
        { label: "chars", value: String(m.chars ?? 0) },
        { label: "frames", value: String(m.frames ?? 0) },
        { label: "passthroughs", value: String(m.passthroughs ?? 0) },
        { label: "nulls", value: String(m.nulls ?? 0) },
        { label: "groups", value: String(m.groups ?? 0) },
        { label: "precision", value: m.precision ?? "—" },
        { label: "min feasible", value: m.minFeasible ?? "—" },
      ];
      // Metric font is a touch smaller than the label so the equal cells fit the
      // longest metric without clipping — and WIDTH-FITTED (gate 33): one shared
      // font that fits every label/value band; a narrow strip keeps fewer whole
      // metrics rather than eight clipped ones (see fitStatusMetrics).
      const metricFontMax = Math.max(METRIC_MIN_PX, Math.round(fontSmall * 0.82));
      const fitted = fitStatusMetrics(items, W, metricFontMax);
      const statusTotal = statusBasis(fitted.items.length);
      const m0LogoW = (STATUS_LOGO_W / statusTotal) * W;
      const parseW = (STATUS_PARSE_W / statusTotal) * W;
      const statusLabel = fitLine(props.statusLabel ?? "Parsing", fitBudget(parseW), fontSmall, METRIC_MIN_PX, PROSE_EM);
      const bands: { weight: number; node: Node }[] = [
        { weight: 1, node: EMPTY },
        { weight: STATUS_LOGO_W, node: squareCell(glyphLogo(STATUS_M0_GLYPH, BRAND_ORANGE), m0LogoW, barContentH) },
        { weight: 2, node: EMPTY },
        { weight: STATUS_PARSE_W, node: paint(tag(textCell(statusLabel.text, statusLabel.fontSize, theme.label, "left", "middle"), "status-label")) },
        { weight: 1, node: vDivider(theme) },
        { weight: 1, node: EMPTY }, // tight gap → metrics sit close to "Parsing"
      ];
      for (const it of fitted.items) bands.push({ weight: STATUS_METRIC_W, node: metricCell(it.label, it.value, theme, fitted.font) });
      bands.push({ weight: 1, node: EMPTY });
      root = bar(colSplit(bands));
    }

    // Logos are now mask silhouettes (no media asset to register).
    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as MosaicDocument["assets"],
      m0: toM0String(root.m0, "DslChrome"),
      sources: root.sources,
      backgroundColor: part === "header" ? theme.canvas : theme.surface,
    });
  },
};

registerTemplate(DslChrome);
