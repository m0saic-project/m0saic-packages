/**
 * Quote-card geometry — every region of the card is a REAL m0 cell.
 *
 * The card's regions are computed as exact pixel rects, then composed into a
 * RATIO m0 via `placeInsetPieces`: cells quantize outward to a coarse lattice
 * and each source carries a `placement.inset` that recovers its EXACT rect
 * (zero drift) — so the m0 NESTS cleanly while placement stays pixel-exact. The
 * builder self-guards the engine's 0.49 inset cap (a thin cell like the ~7px
 * accent bar auto-escalates to a finer lattice), so nothing here fails to emit.
 * Structure, top to bottom:
 *
 *   margin
 *   [quote-mark band]            (decorative “ glyph, accent ink)
 *   quote block (flexible)       (wrapped multi-line svg text, block-centered)
 *   gap · accent bar · gap
 *   [attribution band]           ([circle avatar +] name / role)
 *   margin
 *
 * Margins and gaps are the null space between packed rects (the document
 * background shows through). Boundaries are exact pixel rects, rounded
 * independently, recovered losslessly through each source's inset.
 *
 * Text discipline: the svg glyph rasterizer has NO auto-wrap (long strings
 * clip), so the QUOTE is greedy word-wrapped here with `measureText` against
 * the SAME bundled font the rasterizer draws with — the largest font whose
 * wrapped block fits the quote box wins (binary search; wrap depth is
 * re-derived at every candidate size). Single lines (name / role) follow the
 * established shrink-to-fit-then-ellipsis discipline. Bold runs are measured
 * against the actual bold font file via `resolveFontFile`.
 */

import type { M0String } from "@m0saic/dsl";
import type { MosaicSource } from "@m0saic/types";
import {
  measureText,
  placeInsetPieces,
  resolveFontFile,
  type InsetPiece,
} from "@m0saic/template-utils";

export type QuoteRect = { x: number; y: number; w: number; h: number };

export type QuoteHAlign = "left" | "center";

/** One paintable cell, in DSL paint order (the engine binds sources in this order). */
export type QuoteCell =
  | { kind: "mark"; text: string; fontSize: number; hAlign: QuoteHAlign; rect: QuoteRect }
  | { kind: "quote"; text: string; fontSize: number; lines: number; hAlign: QuoteHAlign; rect: QuoteRect }
  | { kind: "accent-bar"; rect: QuoteRect }
  | { kind: "avatar"; rect: QuoteRect }
  | { kind: "name"; text: string; fontSize: number; hAlign: QuoteHAlign; rect: QuoteRect }
  | { kind: "role"; text: string; fontSize: number; hAlign: QuoteHAlign; rect: QuoteRect };

export type QuoteLayoutOptions = {
  W: number;
  H: number;
  /** The quote body (non-empty; caller validates). Wrapped here. */
  quote: string;
  /** Attribution name, or null = none. */
  attribution: string | null;
  /** Attribution second line (title / handle / source), or null = none. */
  role: string | null;
  /** Reserve a square avatar cell in the attribution band. */
  hasAvatar: boolean;
  /** Card composition: "center" (classic) or "left" (editorial). */
  align: QuoteHAlign;
  /** Show the decorative opening-quote glyph band. */
  quoteMark: boolean;
  /** Outer margin as a fraction of the canvas short edge. */
  marginFrac: number;
};

export type QuoteLayout = {
  m0: M0String;
  /** Sources in the m0's frame order, each carrying its recovery inset. */
  sources: MosaicSource[];
  /** Exact computed cell rects, in paint order. */
  cells: QuoteCell[];
};

/** Raised for inputs the geometry cannot honor (caller renders an error mosaic). */
export class QuoteLayoutError extends Error {}

const MIN_FONT_PX = 8;
const MIN_QUOTE_BOX_PX = 24;
/** measureText/textToPath default leading — svg mode is pinned to it. */
const LINE_HEIGHT = 1.25;
const MARK_GLYPH = "“"; // “

/** Coarse lattice basis — the precision floor for the composable (ratio) m0. */
const INSET_BASIS = 120;

/** Fallback source for callers that only need the geometry (e.g. tests). */
function stubSource(): MosaicSource {
  return { type: "lavfi", color: "#808080" } as unknown as MosaicSource;
}

/** Bold font file for exact bold-width measuring (bundled Roboto-Bold). */
function boldFontPath(): string | undefined {
  return resolveFontFile({ weight: "bold" })?.path;
}

type MeasureStyle = { fontPath?: string };

function widthAt(text: string, fontSize: number, style: MeasureStyle): number {
  return measureText(text, { fontSize, fontPath: style.fontPath }).width;
}

/** Largest fontSize ≤ `maxFont` whose rendered width fits `boxW` (linear scaling). */
function fitFontToWidth(text: string, boxW: number, maxFont: number, style: MeasureStyle): number {
  const w = widthAt(text, 100, style);
  if (!(w > 0)) return maxFont;
  return Math.max(MIN_FONT_PX, Math.min(maxFont, Math.floor((100 * boxW) / w)));
}

/** Shrink-to-fit a single line; ellipsis-truncate only when even the min font overflows. */
function fitSingleLine(
  text: string,
  boxW: number,
  maxFont: number,
  style: MeasureStyle,
): { text: string; fontSize: number } {
  const usableW = Math.floor(boxW * 0.98);
  const fontSize = fitFontToWidth(text, usableW, maxFont, style);
  if (widthAt(text, fontSize, style) <= usableW) return { text, fontSize };
  let lo = 1;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid).trimEnd()}…`;
    if (widthAt(candidate, MIN_FONT_PX, style) <= usableW) lo = mid;
    else hi = mid - 1;
  }
  return { text: `${text.slice(0, lo).trimEnd()}…`, fontSize: MIN_FONT_PX };
}

/**
 * Greedy word-wrap at `fontSize` against the real font. Words wider than the
 * box hard-break by character (URLs, hashtags). Returns null when even a
 * single glyph cannot fit — the caller's font search treats that as "does
 * not fit at this size".
 */
export function wrapQuoteLines(text: string, fontSize: number, maxW: number): string[] | null {
  const width = (s: string) => measureText(s, { fontSize }).width;
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.length > 0) out.push(cur);
    cur = "";
  };
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    const joined = cur.length > 0 ? `${cur} ${word}` : word;
    if (width(joined) <= maxW) {
      cur = joined;
      continue;
    }
    flush();
    if (width(word) <= maxW) {
      cur = word;
      continue;
    }
    let rest = word;
    while (width(rest) > maxW) {
      let lo = 1;
      const max = rest.length - 1;
      if (max < 1 || width(rest.slice(0, 1)) > maxW) return null;
      let hi = max;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (width(rest.slice(0, mid)) <= maxW) lo = mid;
        else hi = mid - 1;
      }
      out.push(rest.slice(0, lo));
      rest = rest.slice(lo);
    }
    cur = rest;
  }
  flush();
  return out.length > 0 ? out : null;
}

/**
 * Fit the quote into its box: binary-search the largest font whose greedy
 * wrap fits both axes (wrap depth is re-derived per candidate size — fit is
 * monotone in font size). Below the floor, keep as many floor-size lines as
 * fit and ellipsis the last one.
 */
export function fitQuoteBlock(
  text: string,
  boxW: number,
  boxH: number,
  maxFont: number,
): { text: string; fontSize: number; lines: number } {
  const usableW = Math.floor(boxW * 0.98);
  const tryAt = (f: number): string | null => {
    const lines = wrapQuoteLines(text, f, usableW);
    if (!lines) return null;
    const joined = lines.join("\n");
    const m = measureText(joined, { fontSize: f, lineHeight: LINE_HEIGHT });
    return m.height <= boxH && m.width <= usableW ? joined : null;
  };

  let best: { fontSize: number; joined: string } | null = null;
  let lo = MIN_FONT_PX;
  let hi = Math.max(MIN_FONT_PX, maxFont);
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const joined = tryAt(mid);
    if (joined != null) {
      best = { fontSize: mid, joined };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best) return { text: best.joined, fontSize: best.fontSize, lines: best.joined.split("\n").length };

  // Even the floor overflows vertically — truncate lines, ellipsis the last.
  const lines = wrapQuoteLines(text, MIN_FONT_PX, usableW);
  if (!lines)
    throw new QuoteLayoutError(`the quote box (${boxW}×${boxH}px) is too narrow to fit any text — enlarge the canvas`);
  const em = measureText("Ag", { fontSize: MIN_FONT_PX });
  const lineStep = MIN_FONT_PX * LINE_HEIGHT;
  const maxLines = Math.max(1, Math.floor((boxH - (em.ascent + em.descent)) / lineStep) + 1);
  const kept = lines.slice(0, Math.min(maxLines, lines.length));
  const last = kept[kept.length - 1];
  const fitted = fitSingleLine(`${last}…`, usableW, MIN_FONT_PX, {});
  kept[kept.length - 1] = fitted.text.endsWith("…") ? fitted.text : `${fitted.text}…`;
  const joined = kept.join("\n");
  return { text: joined, fontSize: MIN_FONT_PX, lines: kept.length };
}

export function buildQuoteCardLayout(
  opts: QuoteLayoutOptions,
  sourceForCell: (cell: QuoteCell) => MosaicSource = stubSource,
): QuoteLayout {
  const { W, H, align, quoteMark, hasAvatar } = opts;
  const quote = opts.quote.trim();
  if (quote.length === 0) throw new QuoteLayoutError("the quote must not be empty");
  const nameText = (opts.attribution ?? "").trim();
  const roleText = (opts.role ?? "").trim();
  const hasName = nameText.length > 0;
  const hasRole = roleText.length > 0;
  const hasAttrib = hasAvatar || hasName || hasRole;

  const S = Math.min(W, H);
  const margin = Math.max(0, Math.round(opts.marginFrac * S));
  const interiorW = W - 2 * margin;
  if (interiorW < MIN_QUOTE_BOX_PX)
    throw new QuoteLayoutError(`canvas ${W}×${H} is too narrow at this margin — the card interior collapses`);

  const bold = { fontPath: boldFontPath() };
  const regular: MeasureStyle = {};

  // ── fixed bands (heights) ──
  const markH = quoteMark ? Math.round(S * 0.11) : 0;
  const g1 = quoteMark ? Math.round(S * 0.01) : 0;
  const accentH = Math.max(3, Math.round(S * 0.007));
  const g2 = Math.round(S * 0.045);
  const g3 = hasAttrib ? Math.round(S * 0.04) : 0;

  // Attribution text fits against the width it will actually get.
  const avatarSide = hasAvatar ? Math.round(S * 0.115) : 0;
  const gapAv = hasAvatar ? Math.round(S * 0.025) : 0;
  const availTextW = interiorW - avatarSide - gapAv;
  if (hasAttrib && (hasName || hasRole) && availTextW < MIN_QUOTE_BOX_PX)
    throw new QuoteLayoutError(`canvas ${W}×${H} leaves no room for the attribution next to the avatar`);

  const nameFit = hasName
    ? fitSingleLine(nameText, availTextW, Math.max(MIN_FONT_PX, Math.round(S * 0.032)), bold)
    : null;
  const roleFit = hasRole
    ? fitSingleLine(roleText, availTextW, Math.max(MIN_FONT_PX, Math.round(S * 0.025)), regular)
    : null;
  const blockH = (text: string, fontSize: number, style: MeasureStyle): number => {
    const m = measureText(text, { fontSize, fontPath: style.fontPath });
    return Math.ceil(m.ascent + m.descent) + 2;
  };
  const nameH = nameFit ? blockH(nameFit.text, nameFit.fontSize, bold) : 0;
  const roleH = roleFit ? blockH(roleFit.text, roleFit.fontSize, regular) : 0;
  const lineGap = nameFit && roleFit ? Math.round(S * 0.008) : 0;
  const textBlockH = nameH + lineGap + roleH;
  const attribH = hasAttrib ? Math.max(avatarSide, textBlockH) : 0;

  // ── quote box = whatever is left ──
  const quoteH = H - 2 * margin - markH - g1 - g2 - accentH - g3 - attribH;
  if (quoteH < MIN_QUOTE_BOX_PX)
    throw new QuoteLayoutError(
      `canvas ${W}×${H} is too small for a quote card at these settings — the quote box collapses to ${quoteH}px`,
    );
  const maxQuoteFont = Math.max(MIN_FONT_PX, Math.floor(S * 0.088));
  const quoteFit = fitQuoteBlock(quote, interiorW, quoteH, maxQuoteFont);

  const cells: QuoteCell[] = [];
  let y = margin;

  // ── decorative opening-quote glyph ──
  if (quoteMark) {
    const em = measureText(MARK_GLYPH, { fontSize: 100, fontPath: bold.fontPath });
    const blockRatio = (em.ascent + em.descent) / 100;
    const markFont = Math.max(MIN_FONT_PX, Math.floor((markH * 0.98) / blockRatio));
    const markW = Math.min(
      interiorW,
      Math.max(1, Math.ceil(widthAt(MARK_GLYPH, markFont, bold) * 1.15)),
    );
    const lead = align === "center" ? Math.floor((interiorW - markW) / 2) : 0;
    cells.push({
      kind: "mark",
      text: MARK_GLYPH,
      fontSize: markFont,
      hAlign: align,
      rect: { x: margin + lead, y, w: markW, h: markH },
    });
    y += markH + g1;
  }

  // ── quote block (full interior width; the text block centers vertically) ──
  cells.push({
    kind: "quote",
    text: quoteFit.text,
    fontSize: quoteFit.fontSize,
    lines: quoteFit.lines,
    hAlign: align,
    rect: { x: margin, y, w: interiorW, h: quoteH },
  });
  y += quoteH + g2;

  // ── accent bar ──
  const barW = Math.min(interiorW, Math.max(8, Math.round(interiorW * 0.14)));
  const barLead = align === "center" ? Math.floor((interiorW - barW) / 2) : 0;
  cells.push({ kind: "accent-bar", rect: { x: margin + barLead, y, w: barW, h: accentH } });
  y += accentH;

  // ── attribution band ──
  if (hasAttrib) {
    y += g3;

    const nameW = nameFit
      ? Math.min(availTextW, Math.ceil(widthAt(nameFit.text, nameFit.fontSize, bold) * 1.06) + 2)
      : 0;
    const roleW = roleFit
      ? Math.min(availTextW, Math.ceil(widthAt(roleFit.text, roleFit.fontSize, regular) * 1.06) + 2)
      : 0;
    const textColW = Math.max(nameW, roleW);
    const gapEff = hasAvatar && textColW > 0 ? gapAv : 0;
    const blockW = avatarSide + gapEff + textColW;
    const lead = align === "center" ? Math.floor((interiorW - blockW) / 2) : 0;

    if (hasAvatar) {
      const padAv = Math.floor((attribH - avatarSide) / 2);
      cells.push({ kind: "avatar", rect: { x: margin + lead, y: y + padAv, w: avatarSide, h: avatarSide } });
    }

    if (textColW > 0) {
      const padT = Math.floor((attribH - textBlockH) / 2);
      const textX = margin + lead + avatarSide + gapEff;
      // Beside an avatar the column is left-composed; standalone it follows `align`.
      const textAlign: QuoteHAlign = hasAvatar ? "left" : align;
      let ty = y + padT;
      if (nameFit) {
        cells.push({
          kind: "name",
          text: nameFit.text,
          fontSize: nameFit.fontSize,
          hAlign: textAlign,
          rect: { x: textX, y: ty, w: textColW, h: nameH },
        });
        ty += nameH;
      }
      if (nameFit && roleFit) ty += lineGap;
      if (roleFit) {
        cells.push({
          kind: "role",
          text: roleFit.text,
          fontSize: roleFit.fontSize,
          hAlign: textAlign,
          rect: { x: textX, y: ty, w: textColW, h: roleH },
        });
      }
    }
    y += attribH;
  }

  // ── compose: RATIO m0 — cells quantize outward to a coarse lattice and each
  //    source carries a recovery inset that paints it on its EXACT rect.
  //    Bounded precision (basis ≤ INSET_BASIS), zero drift, nests cleanly.
  //    Margins/gaps are the null space between packed rects (doc background).
  const pieces: InsetPiece[] = cells.map((c) => ({
    rect: { x: c.rect.x, y: c.rect.y, w: c.rect.w, h: c.rect.h, importance: c.kind === "avatar" ? 0 : 1 },
    source: sourceForCell(c),
  }));
  const placed = placeInsetPieces({ rootW: W, rootH: H, pieces, basis: INSET_BASIS });
  if (placed.sources.length !== cells.length)
    throw new QuoteLayoutError(
      `placed ${placed.sources.length} sources for ${cells.length} cells (internal ordering bug)`,
    );

  return { m0: placed.m0, sources: placed.sources, cells };
}
