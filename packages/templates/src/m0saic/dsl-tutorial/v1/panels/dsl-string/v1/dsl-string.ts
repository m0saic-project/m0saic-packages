/**
 * ============================================================================
 * @m0saic/dsl-tutorial/string/v1 — live DSL-string panel (internal)
 * ============================================================================
 *
 * Renders the m0 source string as a syntax-highlighted glyph strip with a
 * STEPPING caret that rides the active character (a soft wash behind the glyph +
 * an underline beneath it), a faint position ruler above, OR the narration
 * banner that reads out what the active symbol does — selected by `part`
 * ("strip" | "narration"), the same split-by-part idiom the chrome uses.
 *
 * Depth-safe: the glyph / caret / ruler cells are SIBLINGS in a colSplit (1:1
 * aligned, no overlay stacking); each glyph cell nests at most a wash under its
 * glyph (depth 2). The narration banner stacks one enable-gated line per distinct
 * narration — isolated in its own child document. Everything keys off the global
 * clock via the projection exprs (see pipeline/dslString.ts).
 *
 * Width-fitted (gate 33): a glyph column's font is bounded by the WIDEST glyph
 * in the string under the m0 glyph model (`>` is .86em; the old flat 1.6·cellW
 * cap let it overlap its neighbours and clip at the panel edges), and the
 * narration font fits its LONGEST line — portrait canvases used to run the
 * banner off the right edge. Narration is tagged for the parent's contract.
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
import { definePropsSchema, makeErrorMosaic, registerTemplate, tag } from "@m0saic/template-utils";

import type { Node } from "../../../_shared/node-kit";
import {
  EMPTY,
  paint,
  rowSplit,
  colSplit,
  overlay,
} from "../../../_shared/node-kit";
import { dslTutorialTheme } from "../../../theme/tokens";
import type { DslTutorialPreset, DslTutorialTheme } from "../../../theme/tokens";
import type { Glyph, SyntaxType, CaretStep } from "../../../pipeline/dslString";
import type { ChipVariant } from "../../../pipeline/inspector";
import { PROSE_EM, fitBudget, fitFontPx, fitLine, m0GlyphEm, textWidthPx, widestM0GlyphEm } from "../../../_shared/text-fit";

export type DslStringProps = {
  part?: "strip" | "narration";
  preset?: DslTutorialPreset;
  /** Classified glyphs of the m0 string (display order). */
  glyphs?: Glyph[];
  /** Per-glyph caret enable expr (filter context; "" = never lit). */
  caretEnable?: string[];
  /** Raw per-step caret timeline (drives the scrolling-window math). */
  caretSteps?: CaretStep[];
  /** Enable-gated narration lines (banner part). */
  narration?: ChipVariant[];
};

const propsSchema = definePropsSchema<DslStringProps>({
  part: {
    type: "string",
    required: false,
    description: 'Which part to render: "strip" (glyph strip + caret + ruler) or "narration".',
    meta: { constraints: { oneOf: ["strip", "narration"] } },
  },
  preset: { type: "string", required: false, description: "Theme preset." },
  glyphs: { type: "json", required: false, description: "Classified m0 glyphs." },
  caretEnable: { type: "json", required: false, description: "Per-glyph caret enable exprs." },
  caretSteps: { type: "json", required: false, description: "Raw per-step caret timeline (scroll math)." },
  narration: { type: "json", required: false, description: "Enable-gated narration lines." },
});

/** Target on-screen width per character (px) before the strip starts scrolling.
 *  cap = how many characters fit at this width → the hard visible-char limit. */
const TARGET_CHAR_PX = 18;

/** Fraction of a glyph column the widest glyph's modelled ink may fill. The strip
 *  spans the full panel width (pitch = W / n is fixed), so "characters closer
 *  together" = bigger glyphs whose ink eats the whitespace — but a glyph wider
 *  than its column overlaps its neighbours and, in the first/last column, CLIPS
 *  at the panel edge. So the font is bounded per string by its widest glyph
 *  (`cellW · GLYPH_FILL / widestEm`): a digit-heavy string still reaches
 *  ~1.4·cellW (tight, ~touching), a `>`-heavy one stays inside its columns. The
 *  glyph band is given most of the strip HEIGHT so the font can reach the cap. */
const GLYPH_FILL = 0.96;
/** Narration floor before lines ellipsize (px). */
const NARRATION_MIN_PX = 10;
/** Narration text spans the middle 94/100 of the band (see buildNarration). */
const NARRATION_TEXT_FRAC = 0.94;

/** Font bound for one glyph per column: the widest glyph's ink fills at most
 *  `GLYPH_FILL` of the column. */
function glyphColumnFont(glyphChars: readonly string[], cellW: number): number {
  return (cellW * GLYPH_FILL) / widestM0GlyphEm(glyphChars);
}

/** Ruler labels (`0`, `5`, `10`, …, `·`) are m0-model digits: bound the ruler font
 *  the same way, by the widest label. */
function rulerFontBound(labels: readonly string[], cellW: number): number {
  let widest = 0.42;
  for (const l of labels) {
    let em = 0;
    for (const ch of l) em += m0GlyphEm(ch);
    widest = Math.max(widest, em);
  }
  return (cellW * GLYPH_FILL) / widest;
}

/** Fixed-strip vertical bands (ruler · gap · glyphs · caret), summing to BAND_TOTAL.
 *  The glyph band takes the lion's share so the font can grow tall enough to hit
 *  the GLYPH_FILL bound — that's what actually tightens the inter-character spacing. */
const RULER_BAND = 3;
const GAP_BAND = 1;
const GLYPH_BAND = 19;
const CARET_BAND = 1;
const BAND_TOTAL = RULER_BAND + GAP_BAND + GLYPH_BAND + CARET_BAND;
const f3 = (n: number): string => n.toFixed(3);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** ONE text source whose LAYERS are the strip's glyphs — each positioned at its
 *  column centre via `xExpr` and coloured by syntax type — so the whole strip is
 *  a single `drawtext` CHAIN (one input, one image) instead of N sibling text
 *  cells (the ~one-image-per-character breadth cost that made root:1 the render
 *  bottleneck). `cx` is the column centre in px. Commas are nudged toward the
 *  baseline: centre-aligned they read too high, since a comma's ink sits low in
 *  the em box. Static text → renders as one image (no per-frame work). */
function glyphStripSource(
  cells: { text: string; color: MosaicColor; cx: number }[],
  font: number,
): MosaicTextSource {
  const commaDrop = (font * 0.32).toFixed(1); // push ',' down toward the baseline
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: cells.map((c) => ({
      content: { kind: "literal", text: c.text.trim() === "" ? " " : c.text },
      style: { fontSize: font, fontColor: c.color },
      // Absolute per-glyph placement in the strip's own rect: centre horizontally
      // on the column (xExpr over text_w), vertically centred (yExpr over text_h);
      // commas drop toward the baseline so they read like real commas.
      placement: {
        xExpr: `${c.cx.toFixed(1)}-text_w/2`,
        yExpr: c.text === "," ? `(h-text_h)/2+${commaDrop}` : "(h-text_h)/2",
      } as never,
    })),
  } as MosaicTextSource;
}

/** ONE lavfi drawbox source for the caret machinery — a gated box per active
 *  glyph — collapsing N gated overlay cells into a single source + one overlay
 *  (the canvas cursor-track idiom). `box(i)` is the box rect in the track's own
 *  pixel space; `caretEnable[i]` gates it (commas inside the gte/lt exprs are
 *  backslash-escaped for the lavfi filtergraph parser). Returns null when no
 *  glyph is ever active, so the caller can drop the layer entirely. */
function caretTrackSource(
  caretEnable: string[],
  color: MosaicColor,
  alpha: number,
  box: (i: number) => { x: number; y: number; w: number; h: number },
): MosaicSource | null {
  const col = typeof color === "string" ? color : "#7C5CFF";
  const a = alpha.toFixed(2);
  const boxes: string[] = [];
  for (let i = 0; i < caretEnable.length; i++) {
    const en = caretEnable[i];
    if (!en) continue;
    const b = box(i);
    boxes.push(
      `drawbox=x=${Math.round(b.x)}:y=${Math.round(b.y)}:w=${Math.max(1, Math.round(b.w))}:` +
        `h=${Math.max(1, Math.round(b.h))}:color=${col}@${a}:t=fill:replace=1:enable=${en.replace(/,/g, "\\,")}`,
    );
  }
  if (boxes.length === 0) return null;
  return { type: "lavfi", lavfi: ["color=black@0", ...boxes].join(",") } as MosaicSource;
}

/** Dispatch: a short string fits on one screen (positioned glyph strip); a long
 *  one exceeds the char cap, so it PAGES — a window that follows the parse. */
function buildStrip(
  glyphs: Glyph[],
  caretEnable: string[],
  caretSteps: CaretStep[],
  theme: DslTutorialTheme,
  W: number,
  H: number,
): Node {
  const cap = Math.max(8, Math.floor(W / TARGET_CHAR_PX));
  return glyphs.length <= cap
    ? buildFixedStrip(glyphs, caretEnable, theme, W, H)
    : buildPagedStrip(glyphs, caretEnable, caretSteps, theme, W, H, cap);
}

/** The fits-in-one-screen strip: ruler + glyph rows each a SINGLE positioned text
 *  source; the caret wash + underline each a SINGLE gated lavfi track. So the
 *  whole strip is ~4 sources regardless of length — no per-character cells, no
 *  input-count chunking. */
function buildFixedStrip(
  glyphs: Glyph[],
  caretEnable: string[],
  theme: DslTutorialTheme,
  W: number,
  H: number,
): Node {
  const n = Math.max(1, glyphs.length);
  const cellW = W / n; // full width — the strip spans the entire panel
  const syntax = theme.syntax;
  const cx = (i: number): number => (i + 0.5) * cellW;

  // Vertical budget: a TALL glyph band so the characters render big and tight;
  // the widest glyph in the string bounds the font horizontally (no overlap, no
  // edge clip — see GLYPH_FILL).
  const glyphRowH = (GLYPH_BAND / BAND_TOTAL) * H;
  const caretRowH = (CARET_BAND / BAND_TOTAL) * H;
  const glyphChars = glyphs.map((g) => g.ch);
  const glyphFont = clamp(Math.min(glyphColumnFont(glyphChars, cellW), glyphRowH * 0.9), 9, 220);
  const rulerLabels = glyphs.map((_, i) => (i % 5 === 0 ? String(i) : "·"));
  const rulerFont = clamp(Math.min(cellW * 0.5, rulerFontBound(rulerLabels, cellW), H * 0.11), 7, 60);

  // Ruler: faint position gutter — index every 5th glyph, a dot otherwise.
  const rulerRow = paint(glyphStripSource(
    rulerLabels.map((text, i) => ({ text, color: theme.muted, cx: cx(i) })),
    rulerFont,
  ));

  // Glyph strip (one source) with the caret WASH behind it (one gated lavfi track).
  const glyphStrip = paint(glyphStripSource(
    glyphs.map((g, i) => ({ text: g.ch, color: syntax[g.type], cx: cx(i) })),
    glyphFont,
  ));
  const wash = caretTrackSource(caretEnable, theme.accent, 0.2, (i) => ({
    x: i * cellW, y: 0, w: cellW, h: glyphRowH,
  }));
  const glyphRow = wash ? overlay([paint(wash), glyphStrip]) : glyphStrip;

  // Caret underline: a short accent bar beneath the active glyph (one lavfi track).
  const underline = caretTrackSource(caretEnable, theme.accent, 1, (i) => {
    const bw = cellW * 0.6;
    const bh = Math.max(2, caretRowH * 0.4);
    return { x: i * cellW + (cellW - bw) / 2, y: (caretRowH - bh) / 2, w: bw, h: bh };
  });
  const caretRow = underline ? paint(underline) : EMPTY;

  // Ruler is FLUSH to the top of the panel rect (lines up with the inspector +
  // canvas tops); the glyph band dominates so the characters render big + tight.
  return rowSplit([
    { weight: RULER_BAND, node: rulerRow },
    { weight: GAP_BAND, node: EMPTY },
    { weight: GLYPH_BAND, node: glyphRow },
    { weight: CARET_BAND, node: caretRow },
  ]);
}

/** AND `enableExpr` into every source of a node (gates a whole sub-tree's
 *  visibility). Used to show/hide a full page of the strip on the global clock. */
function gateNode(node: Node, enableExpr: string): Node {
  for (const s of node.sources) {
    const o = ((s as { overlay?: { enable?: string } }).overlay ??= {});
    o.enable = o.enable ? `(${o.enable})*(${enableExpr})` : enableExpr;
  }
  return node;
}

/** One page of the strip: `cap` fixed slots (the slice fills the first, the rest
 *  pad empty so char width is uniform across pages), with global ruler indices. */
function buildPageStrip(
  slice: Glyph[],
  sliceCaret: string[],
  startIndex: number,
  cap: number,
  theme: DslTutorialTheme,
  W: number,
  H: number,
): Node {
  const cellW = W / cap; // fixed cap slots → uniform char width across pages
  const syntax = theme.syntax;
  const cx = (j: number): number => (j + 0.5) * cellW;
  const glyphChars = slice.map((g) => g.ch);
  const glyphFont = clamp(Math.min(cellW * 0.82, glyphColumnFont(glyphChars, cellW), H * 0.34), 9, 220);
  const rulerLabels = slice.map((_, j) => ((startIndex + j) % 5 === 0 ? String(startIndex + j) : "·"));
  const rulerFont = clamp(Math.min(cellW * 0.5, rulerFontBound(rulerLabels, cellW), H * 0.12), 7, 60);
  // Band heights within this page's rowSplit (weights 4/1/13/3/3 → sum 24).
  const glyphRowH = (13 / 24) * H;
  const caretRowH = (3 / 24) * H;

  // Only the filled slots get a layer; the rest of the page pads empty.
  const rulerRow = paint(glyphStripSource(
    rulerLabels.map((text, j) => ({ text, color: theme.muted, cx: cx(j) })),
    rulerFont,
  ));
  const glyphStrip = paint(glyphStripSource(
    slice.map((g, j) => ({ text: g.ch, color: syntax[g.type], cx: cx(j) })),
    glyphFont,
  ));
  const wash = caretTrackSource(sliceCaret, theme.accent, 0.2, (j) => ({
    x: j * cellW, y: 0, w: cellW, h: glyphRowH,
  }));
  const glyphRow = wash ? overlay([paint(wash), glyphStrip]) : glyphStrip;
  const underline = caretTrackSource(sliceCaret, theme.accent, 1, (j) => {
    const bw = cellW * 0.6;
    const bh = Math.max(2, caretRowH * 0.4);
    return { x: j * cellW + (cellW - bw) / 2, y: (caretRowH - bh) / 2, w: bw, h: bh };
  });
  const caretRow = underline ? paint(underline) : EMPTY;

  // Ruler is FLUSH to the top of the panel rect (lines up with the inspector +
  // canvas tops); the bottom keeps a small pad under the caret.
  return rowSplit([
    { weight: 4, node: rulerRow },
    { weight: 1, node: EMPTY },
    { weight: 13, node: glyphRow },
    { weight: 3, node: caretRow },
    { weight: 3, node: EMPTY },
  ]);
}

/** The long-string strip: a WINDOW of `cap` characters that follows the parse.
 *
 *  Smooth pixel-scroll isn't available crisply with the engine's text primitives
 *  (drawtext rasterizes only to its cell width — content positioned beyond it is
 *  never drawn, so a source-level `overlay.xExpr` scroll reveals blank; per-layer
 *  `xExpr` is static; the camera upscales rasterized pixels → blur). So the
 *  window PAGES: the string is cut into `cap`-char pages, each a crisp fixed
 *  strip, stacked as enable-gated layers — only the page holding the caret shows,
 *  and it advances as the parse crosses a page boundary. Depth = page count
 *  (fine for hundreds of chars; thousands would need a different mechanism). */
function buildPagedStrip(
  glyphs: Glyph[],
  caretEnable: string[],
  caretSteps: CaretStep[],
  theme: DslTutorialTheme,
  W: number,
  H: number,
  cap: number,
): Node {
  const total = glyphs.length;
  const pages = Math.ceil(total / cap);

  // Per-page visibility: the union of step windows whose caret sits on that page.
  const pageWin: { a: number; b: number }[][] = Array.from({ length: pages }, () => []);
  for (const s of caretSteps) {
    const p = Math.floor(s.charIndex / cap);
    if (p < 0 || p >= pages) continue;
    const list = pageWin[p];
    const last = list[list.length - 1];
    if (last && Math.abs(last.b - s.startSec) < 1e-6) last.b = s.endSec;
    else list.push({ a: s.startSec, b: s.endSec });
  }
  // Page 0 shows from t=0 (covers the lead before step 1, so the strip isn't blank).
  if (pageWin[0].length > 0) pageWin[0][0].a = 0;
  const pageEnable = pageWin.map((list) =>
    list.length ? list.map((r) => `(gte(t,${f3(r.a)})*lt(t,${f3(r.b)}))`).join("+") : "0",
  );

  const pageNodes = Array.from({ length: pages }, (_v, p) => {
    const start = p * cap;
    const end = Math.min(total, start + cap);
    const node = buildPageStrip(
      glyphs.slice(start, end),
      caretEnable.slice(start, end),
      start,
      cap,
      theme,
      W,
      H,
    );
    return gateNode(node, pageEnable[p]);
  });

  return overlay(pageNodes);
}

/** ONE narration font for every line: the band height picks it, the LONGEST line
 *  under the width model caps it; lines that still overflow at the floor
 *  end-ellipsize. Exported for the gate-33 locks. */
export function fitNarrationLines(
  labels: readonly string[],
  W: number,
  H: number,
): { texts: string[]; fontSize: number } {
  const maxPx = clamp(Math.round(H * 0.34), 12, 60);
  const availW = fitBudget(W * NARRATION_TEXT_FRAC);
  let fontSize = maxPx;
  for (const l of labels) fontSize = Math.min(fontSize, fitFontPx(l, availW, maxPx, NARRATION_MIN_PX, PROSE_EM));
  const texts = labels.map((l) =>
    textWidthPx(l, fontSize, PROSE_EM) <= availW ? l : fitLine(l, availW, fontSize, fontSize, PROSE_EM).text,
  );
  return { texts, fontSize };
}

/** The narration banner — one enable-gated line lit at a time.
 *
 *  COLLAPSE: all N narration lines live as enable-gated LAYERS of ONE text
 *  source, NOT as N stacked overlay sources. The engine renders enable-gated
 *  text layers as a single `drawtext` CHAIN on one input (see
 *  buildTextRenderCommand) — so the banner costs one text render + one overlay
 *  regardless of line count, instead of N inputs + N full-band overlay
 *  composites. The old `overlay(lines)` form was the ~24s root:2 bottleneck on a
 *  dense walk; only one layer is ever visible at a time, so stacking them at the
 *  same placement is free. */
function buildNarration(narration: ChipVariant[], theme: DslTutorialTheme, W: number, H: number): Node {
  const variants = narration ?? [];
  const lines = fitNarrationLines(variants.map((v) => v.label || " "), W, H);
  const textStack: Node = variants.length
    ? paint(tag({
        type: "text",
        // VIDEO render: the per-layer `enable=between(t,…)` gates each drawtext
        // per FRAME, so the source must be time-varying (a static image would
        // freeze every layer at t=0). One .mov carries the whole gated chain.
        renderMode: { kind: "video" },
        visual: { backgroundColor: "black@0" },
        layers: variants.map((v, i) => ({
          content: { kind: "literal", text: lines.texts[i] },
          style: { fontSize: lines.fontSize, fontColor: theme.label },
          placement: { fit: "contain", hAlign: "left", vAlign: "middle" } as never,
          overlay: { enable: v.enableExpr },
        })),
      } as MosaicTextSource, "narration"))
    : EMPTY;
  // No bullet marker — the narration text spans the full width of the band.
  const row = colSplit([
    { weight: 3, node: EMPTY },
    { weight: 94, node: textStack },
    { weight: 3, node: EMPTY },
  ]);
  // Flush to the top of the band (consistent with the strip + inspector tops).
  return rowSplit([
    { weight: 5, node: row },
    { weight: 1, node: EMPTY },
  ]);
}

export const DslString: MosaicTemplate<DslStringProps> = {
  id: asTemplateId("@m0saic/dsl-tutorial/string/v1"),
  label: "DSL Tutorial — String",
  version: 1,
  description:
    "Internal: live syntax-highlighted m0 string with a stepping caret + ruler, or the narration banner, for dsl-tutorial.",
  capabilities: { tier: "core" },
  tags: ["developer", "dsl-tutorial", "internal", "string"],
  internal: true,
  outputHints: { width: 1280, height: 150, fps: 30, durationMs: 12000, note: "Live DSL string strip / narration banner." },
  propsSchema,
  defaultProps: { part: "strip", preset: "dark" },

  render(props: DslStringProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const theme = dslTutorialTheme(props.preset);
    const W = ctx.target.width;
    const H = ctx.target.height;
    const part = props.part ?? "strip";

    // Internal template: glyphs / narration are injected by the dsl-tutorial
    // parent. Invoked standalone with neither → the strip would emit text
    // sources with EMPTY layers[] (a plan-validation error). Render the
    // usage-card placeholder instead, same pattern as screencap_grid.
    const hasContent =
      part === "narration"
        ? (props.narration ?? []).length > 0
        : (props.glyphs ?? []).length > 0;
    if (!hasContent) {
      return Promise.resolve(
        makeErrorMosaic(
          `${part === "narration" ? "narration[]" : "glyphs[]"} is required — injected by the dsl-tutorial parent template`,
          { title: `${this.id} props`, width: Math.max(1, Math.round(W)), height: Math.max(1, Math.round(H)) },
        ),
      );
    }

    const root =
      part === "narration"
        ? buildNarration(props.narration ?? [], theme, W, H)
        : buildStrip(props.glyphs ?? [], props.caretEnable ?? [], props.caretSteps ?? [], theme, W, H);

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0: toM0String(root.m0, "DslString"),
      sources: root.sources,
      backgroundColor: theme.surface,
    });
  },
};

registerTemplate(DslString);
