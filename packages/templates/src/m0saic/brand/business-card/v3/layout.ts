/**
 * @m0saic/brand/business-card/v3 — the QR back's geometry (pure, exported for tests).
 *
 * The card itself is v1's: canvas, trim, safe area, front and poster back all
 * come from `../v1/layout` (frozen, imported, never copied). This file adds the
 * one face v1 never had — the back that is ONLY the code: a big QR on the
 * right, and on the left the title (one line, or two when that keeps the QR
 * bigger), the link as typed and an optional last line.
 *
 * The QR takes every pixel the text column does not need, between the poster
 * back's 1.05 in (the smallest the carved code is drawn at anywhere on the
 * card) and the full height of the safe area. A long link narrows the code;
 * it never prints truncated while the code can still give way — about 28
 * characters at the 8 pt floor (`m0saic.io/solutions/jewelry` is 27). Past
 * that the printed link ellipsizes; the code still encodes all of it.
 */

import { measureText, resolveFontFile } from "@m0saic/text";
import { coverFitField } from "@m0saic/template-utils";
import { MONO_FAMILY, SANS_FAMILY, fitLine, inToPx, ptToPx, type CardCanvas, type Rect, type TextLine } from "../v1/layout";

/** v1's line metrics — measureText's default leading, and the quantization slack on every text rect. */
const LINE_HEIGHT = 1.25;
const TEXT_PAD_X = 3;
/** MOO's 8 pt floor: the link and the last line print at it. */
const MIN_FONT_PT = 8;

export type QrBackLayout = {
  field: Rect[];
  /** The QR, a square cell (its own child canvas, quiet zone included). */
  qr: Rect;
  /** The title, one line or two, top to bottom. */
  title: TextLine[];
  url: TextLine;
  /** The last line under the link; null when empty. */
  line: TextLine | null;
};

export type QrBackCopy = { title: string; url: string; line: string };

function widthAt(text: string, fontSize: number, family: string, bold: boolean): number {
  const fontPath = resolveFontFile({ family, weight: bold ? "bold" : "normal" })?.path;
  return Math.ceil(measureText(text, { fontSize, fontPath }).width);
}

function line(text: string, x: number, y: number, boxW: number, maxFont: number, dpi: number, family: string, bold: boolean): TextLine {
  const fit = fitLine(text, Math.max(4, boxW - 2 * TEXT_PAD_X), maxFont, dpi, family, bold);
  const w = Math.min(boxW, fit.width + 2 * TEXT_PAD_X);
  const h = Math.round(fit.fontSize * LINE_HEIGHT) + 2;
  return { rect: { x, y, w: Math.max(1, w), h }, text: fit.text, fontSize: fit.fontSize, family, bold };
}

/**
 * The title as one line or two: the two-line split is the word break that
 * makes the wider line narrowest (ties keep the earlier break). One word
 * stays one line.
 */
export function splitTitle(text: string, fontSize: number): { lines: string[]; width: number } {
  const one = { lines: [text], width: widthAt(text, fontSize, SANS_FAMILY, true) };
  const words = text.split(/\s+/).filter(Boolean);
  let best: { lines: string[]; width: number } | null = null;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const width = Math.max(...lines.map((l) => widthAt(l, fontSize, SANS_FAMILY, true)));
    if (!best || width < best.width) best = { lines, width };
  }
  return best && best.width < one.width ? best : one;
}

export function buildQrBackLayout(c: CardCanvas, copy: QrBackCopy): QrBackLayout {
  const { dpi, safe } = c;
  const inset = inToPx(0.08, dpi);
  const x0 = safe.x + inset;
  const innerW = safe.w - 2 * inset;
  const innerH = safe.h - 2 * inset;
  const gap = inToPx(0.16, dpi);

  const qrMax = innerH;
  const qrMin = inToPx(1.05, dpi);
  // The front's name size; the link and the last line at the floor.
  const titleFont = inToPx(0.165, dpi);
  const monoFont = ptToPx(MIN_FONT_PT, dpi);

  // The column the biggest code leaves. The title takes one line when it fits
  // there, else the narrower of one line and the balanced two.
  const roomAtMax = innerW - gap - qrMax - 2 * TEXT_PAD_X;
  const single = { lines: [copy.title], width: widthAt(copy.title, titleFont, SANS_FAMILY, true) };
  const title = single.width <= roomAtMax ? single : splitTitle(copy.title, titleFont);
  const need = Math.max(
    title.width,
    widthAt(copy.url, monoFont, MONO_FAMILY, false),
    copy.line ? widthAt(copy.line, monoFont, MONO_FAMILY, false) : 0,
  ) + 2 * TEXT_PAD_X;
  const qrSide = Math.max(qrMin, Math.min(qrMax, innerW - gap - need));
  const colW = innerW - gap - qrSide;

  const titleLines = title.lines.map((t) => line(t, x0, 0, colW, titleFont, dpi, SANS_FAMILY, true));
  const url = line(copy.url, x0, 0, colW, monoFont, dpi, MONO_FAMILY, false);
  const last = copy.line ? line(copy.line, x0, 0, colW, monoFont, dpi, MONO_FAMILY, false) : null;

  const gapTitleUrl = inToPx(0.1, dpi);
  const gapLines = inToPx(0.025, dpi);
  const stackH = titleLines.reduce((a, l) => a + l.rect.h, 0) + gapTitleUrl + url.rect.h + (last ? gapLines + last.rect.h : 0);

  // The text stack and the code, each centred on the trim.
  let y = Math.round(c.trim.y + (c.trim.h - stackH) / 2);
  for (const l of titleLines) {
    l.rect.y = y;
    y += l.rect.h;
  }
  y += gapTitleUrl;
  url.rect.y = y;
  y += url.rect.h;
  if (last) last.rect.y = y + gapLines;

  const qr: Rect = { x: x0 + innerW - qrSide, y: Math.round(c.trim.y + (c.trim.h - qrSide) / 2), w: qrSide, h: qrSide };
  return { field: coverFitField(c.W, c.H, false), qr, title: titleLines, url, line: last };
}
