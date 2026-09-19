/**
 * ============================================================================
 * dsl-tutorial — width-aware text fitting (the CLI width model)
 * ============================================================================
 *
 * The engine's `drawtext` never shrinks a string: `placement.fit` only picks
 * the anchor, so a label whose ink is wider than its cell CLIPS at the cell
 * edge (portrait canvases turned "Animated Wireframe" into "Animated" and
 * every 4-digit inspector value into two digits). Every text the tutorial
 * paints therefore sizes its font from BOTH axes: the band height (the look)
 * AND the cell width under this model (the guarantee), ellipsizing only once
 * the floor is reached.
 *
 * Two models, both deliberately CONSERVATIVE (a fit here never clips on either
 * fallback face the CLI resolves — Helvetica / DejaVu Sans):
 *
 *  - {@link textEm} — prose / labels / numbers: the flat script-aware model the
 *    layout contract's `textFits` rule uses (`textEmUnits` × a per-site em), so
 *    the fit and the `debugLayout` check share one ruler.
 *  - {@link m0GlyphEm} — the m0 alphabet, per glyph: the DSL strip positions
 *    one glyph per column, so its font is bounded by the WIDEST glyph's ink
 *    (`>` .85em, brackets .65em) — a flat model would over-measure the
 *    comma-heavy string ~1.7× and shrink the strip for nothing.
 *
 * Pack-local on purpose (lifted from the wireframe family's gate-30 fit) so
 * the tutorial stays self-contained, like `node-kit.ts`.
 * ============================================================================
 */

import { textEmUnits, fitEmUnits } from "@m0saic/template-utils";

/** Em per Latin char for prose / labels (matches the alpine pack's contract em). */
export const PROSE_EM = 0.62;
/** Em per char for digit-heavy values (DejaVu digits set .636em — .62 under-measures). */
export const DIGIT_EM = 0.68;
/** Em per char for ALL-CAPS captions (Helvetica caps ~.7, DejaVu ~.75). */
export const CAPS_EM = 0.76;

/** Proportional slack a fit leaves inside its cell (side bearings). */
export const FIT_SLACK = 0.94;
/** Absolute slack (px) per fit — the engine's floor quantization can hand a
 *  leaf 1–2px less than its modelled share, and that loss is per split level,
 *  not proportional (a 28px chip realized 24px at 800×450). */
export const FIT_QUANT_PX = 2;

/** The width budget a string may fill inside a `cellPx`-wide cell. */
export function fitBudget(cellPx: number): number {
  return Math.max(1, cellPx * FIT_SLACK - FIT_QUANT_PX);
}

/** Modelled ink width (px) of `text` at `fontSize` under a flat em. */
export function textWidthPx(text: string, fontSize: number, em: number = PROSE_EM): number {
  return textEmUnits(text) * fontSize * em;
}

/** Em width of `text` under the flat model. */
export function textEm(text: string, em: number = PROSE_EM): number {
  return textEmUnits(text) * em;
}

/**
 * Per-glyph em width of the m0 alphabet on the CLI face. Stays ABOVE both
 * fallback faces (Helvetica comma .278 / paren .333 / bracket .278; DejaVu
 * comma .318 / paren .39 / bracket .39 / digit .636 / `>` .838 / brace .635).
 */
export function m0GlyphEm(ch: string): number {
  if (ch === ">") return 0.86;
  if (ch === "{" || ch === "}") return 0.66;
  if (ch === "F") return 0.62;
  if (ch >= "0" && ch <= "9") return 0.66;
  if (ch === "," || ch === "-" || ch === " ") return 0.42;
  if (ch === "(" || ch === ")" || ch === "[" || ch === "]") return 0.42;
  if (ch === "·") return 0.42;
  return textEmUnits(ch) * 0.72;
}

/** The widest glyph (em) in a string of m0 glyphs — bounds a per-column font. */
export function widestM0GlyphEm(glyphs: readonly string[]): number {
  let em = 0;
  for (const g of glyphs) em = Math.max(em, m0GlyphEm(g));
  return em || 0.62;
}

/**
 * The largest integer font size in `[minPx, maxPx]` whose modelled ink fits
 * `availW`. `maxPx` is the height-driven size the design wants; the width
 * model only ever shrinks it. Never returns below `minPx` (the caller then
 * ellipsizes — see {@link fitLine}).
 */
export function fitFontPx(
  text: string,
  availW: number,
  maxPx: number,
  minPx: number,
  em: number = PROSE_EM,
): number {
  const hi = Math.max(1, Math.round(maxPx));
  const lo = Math.max(1, Math.min(hi, Math.round(minPx)));
  const units = textEmUnits(text || " ");
  if (units <= 0 || availW <= 0) return lo;
  const byWidth = Math.floor(availW / (units * em));
  return Math.max(lo, Math.min(hi, byWidth));
}

/** The largest font in `[minPx, maxPx]` at which EVERY string fits its own width. */
export function fitFontPxAll(
  items: ReadonlyArray<{ text: string; availW: number; em?: number }>,
  maxPx: number,
  minPx: number,
): number {
  let font = Math.max(1, Math.round(maxPx));
  for (const it of items) font = Math.min(font, fitFontPx(it.text, it.availW, maxPx, minPx, it.em));
  return Math.max(Math.max(1, Math.round(minPx)), font);
}

/**
 * Fit one line into `availW`: shrink the font from `maxPx` down to `minPx`
 * under the model; if it still doesn't fit at the floor, END-ellipsize the
 * text to the em budget. The design's height-driven size is the ceiling.
 */
export function fitLine(
  text: string,
  availW: number,
  maxPx: number,
  minPx: number,
  em: number = PROSE_EM,
): { text: string; fontSize: number } {
  const fontSize = fitFontPx(text, availW, maxPx, minPx, em);
  if (textWidthPx(text, fontSize, em) <= availW) return { text, fontSize };
  const maxUnits = Math.max(1, availW / (fontSize * em));
  return { text: fitEmUnits(text, maxUnits), fontSize };
}
