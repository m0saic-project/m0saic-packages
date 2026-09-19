import { measureText } from "./textToPath";

/**
 * Measured text fitting for svg-rasterized text.
 *
 * The svg glyph rasterizer has NO auto-wrap and draws with the BUNDLED
 * deterministic font — so fitting is (a) mandatory for arbitrary copy and
 * (b) exact, because these helpers measure with the same font file the
 * rasterizer renders. Every fit uses a deliberately generous width budget
 * (default 72% of the box → ~28% total side margin): breathing room is good
 * typography, and it keeps blocks safe on hosts whose preview font runs
 * wider than the render font.
 *
 * Three entry points:
 *   - {@link wrapMeasured}  — greedy word-wrap at a KNOWN font size.
 *   - {@link fitSvgText}    — free copy: find the largest size whose wrapped
 *                             block fits a box (re-wraps at every size).
 *   - {@link fitSvgLines}   — FIXED lines (stat blocks, reports): the caller
 *                             owns the line breaks, only the size searches.
 */

/**
 * Greedy word-wrap measured against the bundled font: each line takes words
 * while it still fits `maxWidthPx` at `fontSize`. Never breaks a word (a
 * single over-long word gets its own line and the caller's size search
 * shrinks until it fits).
 */
export function wrapMeasured(
  text: string,
  fontSize: number,
  maxWidthPx: number,
): string[] {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (
      line.length === 0 ||
      measureText(candidate, { fontSize }).width <= maxWidthPx
    ) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * Default lower bound for every size search. Below this, copy on a normal
 * canvas stops being readable — but a SMALL canvas (a 640x360 preview whose
 * stage is 1300px wide on screen) reads fine well under it, which is what
 * `minPx` is for.
 */
export const DEFAULT_MIN_FIT_PX = 12;

export type FitSvgTextOptions = {
  /** Upper bound for the font size search (px). */
  maxPx: number;
  /** Lower bound for the search (px, default {@link DEFAULT_MIN_FIT_PX}).
   *  Lower it for small canvases, where the on-screen stage is many times
   *  the canvas width and 8px still reads. */
  minPx?: number;
  /** Maximum wrapped lines allowed. */
  maxLines: number;
  /** Fraction of `boxW` usable by glyphs (default 0.72). */
  widthFrac?: number;
  /** Fraction of `boxH` usable by the stacked block (default 0.66). */
  heightFrac?: number;
};

export type FitSvgTextResult = {
  /** The "\n"-joined block, ready for one svg text layer. */
  text: string;
  fontSize: number;
  lineCount: number;
};

/**
 * Fit free copy into a `boxW`×`boxH` pixel box: binary-search the largest
 * font size (12..maxPx) whose measured, wrapped block fits both axes.
 * Whitespace (including newlines) in the input is normalized — use
 * {@link fitSvgLines} when the line breaks are yours.
 */
export function fitSvgText(
  text: string,
  boxW: number,
  boxH: number,
  opts: FitSvgTextOptions,
): FitSvgTextResult {
  const clean = text.trim().replace(/\s+/g, " ");
  const usableW = boxW * (opts.widthFrac ?? 0.72);
  const usableH = boxH * (opts.heightFrac ?? 0.66);

  const attempt = (fontSize: number): FitSvgTextResult | undefined => {
    const lines = wrapMeasured(clean, fontSize, usableW);
    if (lines.length > opts.maxLines) return undefined;
    const block = lines.join("\n");
    const m = measureText(block, { fontSize });
    if (m.width > usableW || m.height > usableH) return undefined;
    return { text: block, fontSize, lineCount: lines.length };
  };

  const floorPx = Math.max(1, Math.round(opts.minPx ?? DEFAULT_MIN_FIT_PX));
  let lo = floorPx;
  let hi = Math.max(floorPx, Math.round(opts.maxPx));
  let best = attempt(lo);
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const fit = attempt(mid);
    if (fit) {
      best = fit;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Nothing fits even at the floor (a box too small for this copy). Emit it
  // WRAPPED at the floor anyway: a block that clips at the bottom is
  // recoverable, one long unwrapped line runs off BOTH edges and is not.
  // The rasterizer never soft-wraps, so returning raw text here guaranteed
  // horizontal overflow — the tutorial pages caught this at 640x360.
  if (best) return best;
  const floorLines = wrapMeasured(clean, floorPx, usableW);
  return {
    text: floorLines.join("\n"),
    fontSize: floorPx,
    lineCount: floorLines.length,
  };
}

/**
 * Fit PARAGRAPHS into a box: each paragraph word-wraps at the candidate
 * size (so long copy stays readable instead of shrinking into fine print),
 * paragraphs are separated by a blank line, and the whole block
 * binary-searches the largest font size that fits both axes.
 */
export function fitSvgParagraphs(
  paragraphs: string[],
  boxW: number,
  boxH: number,
  opts: {
    maxPx: number;
    /** See {@link DEFAULT_MIN_FIT_PX}. */
    minPx?: number;
    maxLinesPerParagraph?: number;
    widthFrac?: number;
    heightFrac?: number;
  },
): { text: string; fontSize: number } {
  const usableW = boxW * (opts.widthFrac ?? 0.72);
  const usableH = boxH * (opts.heightFrac ?? 0.9);
  const maxLines = opts.maxLinesPerParagraph ?? 6;

  const attempt = (fontSize: number): string | undefined => {
    const wrapped: string[] = [];
    for (const paragraph of paragraphs) {
      const lines = wrapMeasured(paragraph, fontSize, usableW);
      if (lines.length > maxLines) return undefined;
      wrapped.push(lines.join("\n"));
    }
    const block = wrapped.join("\n\n");
    const m = measureText(block, { fontSize });
    return m.width <= usableW && m.height <= usableH ? block : undefined;
  };

  const floorPx = Math.max(1, Math.round(opts.minPx ?? DEFAULT_MIN_FIT_PX));
  let lo = floorPx;
  let hi = Math.max(floorPx, Math.round(opts.maxPx));
  let best: { text: string; fontSize: number } | undefined;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const block = attempt(mid);
    if (block !== undefined) {
      best = { text: block, fontSize: mid };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best) return best;
  // Same rule as fitSvgText: wrap at the floor rather than handing back raw
  // paragraphs that will run off both edges.
  const floorBlock = paragraphs
    .map((paragraph) => wrapMeasured(paragraph, floorPx, usableW).join("\n"))
    .join("\n\n");
  return { text: floorBlock, fontSize: floorPx };
}

/**
 * Fit a FIXED set of lines (no re-wrapping — the caller owns the breaks,
 * e.g. a stat block or report card) into a box: binary-search the largest
 * font size whose widest line and stacked height both fit.
 */
export function fitSvgLines(
  lines: string[],
  boxW: number,
  boxH: number,
  opts: { maxPx: number; widthFrac?: number; heightFrac?: number },
): { text: string; fontSize: number } {
  const usableW = boxW * (opts.widthFrac ?? 0.72);
  const usableH = boxH * (opts.heightFrac ?? 0.72);
  const block = lines.join("\n");

  const fits = (fontSize: number): boolean => {
    const m = measureText(block, { fontSize });
    return m.width <= usableW && m.height <= usableH;
  };

  let lo = 12;
  let hi = Math.max(12, Math.round(opts.maxPx));
  let best = 12;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { text: block, fontSize: best };
}
