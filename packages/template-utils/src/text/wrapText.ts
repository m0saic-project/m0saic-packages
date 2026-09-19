import type { MosaicTextLayer } from "@m0saic/types";

/**
 * Greedy word-wrap by character count.
 *
 * The mosaic text renderer (FFmpeg `drawtext`) has no soft-wrap — long
 * strings render as one line and clip off the source's rect. Templates
 * that take user-typed strings need to pre-break them before handing
 * the text to a `MosaicTextSource`. This helper does the simplest
 * useful version of that: greedy fit on whitespace, never split a
 * word unless the single word is longer than `maxCharsPerLine`.
 *
 * `maxCharsPerLine` is a coarse approximation — character widths
 * vary with font and glyph. Callers tune it per font size against
 * their target rect (rule of thumb: `width / (fontSize * 0.55)`).
 */
export function wrapText(text: string, maxCharsPerLine: number): string[] {
  if (maxCharsPerLine <= 0) return [text];
  const trimmed = text.trim();
  if (trimmed === "") return [];
  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      // Word longer than the line cap: emit it standalone and let it overflow.
      // (Hard-splitting words breaks readability worse than mild clipping.)
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

export type MultilineTextOptions = {
  text: string;
  maxCharsPerLine: number;
  /** Pixel font size used for line-height computation. */
  fontSize: number;
  /** Line-height multiplier. Default 1.3. */
  lineHeightRatio?: number;
  /** Horizontal alignment for each line. Default "center". */
  hAlign?: "left" | "center" | "right";
};

/**
 * Build one {@link MosaicTextLayer} per wrapped line, vertically centered
 * as a block inside the source's rect.
 *
 * Each layer's `yExpr` places it relative to the rect's vertical center
 * using `text_h` (FFmpeg drawtext variable for rendered text height), so
 * the stack stays centered regardless of how many lines result. The
 * horizontal placement uses the requested `hAlign` (defaults to center).
 *
 * Returns `[]` when the input is empty after trim — callers should
 * check and either omit the source or supply a placeholder.
 */
export function multilineTextLayers(
  opts: MultilineTextOptions,
): MosaicTextLayer[] {
  const lines = wrapText(opts.text, opts.maxCharsPerLine);
  if (lines.length === 0) return [];
  const ratio = opts.lineHeightRatio ?? 1.3;
  const hAlign = opts.hAlign ?? "center";
  const lineHeight = Math.round(opts.fontSize * ratio);
  const n = lines.length;
  return lines.map((line, i) => {
    // Vertically center the stack: each line offset from rect center by
    // its index relative to the middle. `text_h` is per-line glyph height.
    const offset = i - (n - 1) / 2;
    const yExpr = `(h-text_h)/2 + (${offset}) * ${lineHeight}`;
    return {
      content: { kind: "literal", text: line },
      placement: { hAlign, vAlign: "middle", yExpr },
    };
  });
}
