import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { equalSplit } from "@m0saic/dsl-stdlib";
import { multilineTextLayers } from "@m0saic/template-utils";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * A centered, word-wrapped text tile on a solid background (image-rasterized).
 * The mosaic text renderer has no soft-wrap, so long lines are pre-broken into
 * one layer per line via `multilineTextLayers` to avoid clipping off the cell.
 */
function textTile(text: string, fontSize: number, bg: string, cellWidth: number) {
  // Coarse chars-per-line for this cell at this font size (see wrapText docs).
  const maxChars = Math.max(8, Math.floor(cellWidth / (fontSize * 0.55)));
  return {
    type: "text" as const,
    style: { fontSize, fontColor: "#ffffff", fontFamily: "Arial" },
    layers: multilineTextLayers({ text, maxCharsPerLine: maxChars, fontSize }),
    visual: { backgroundColor: bg },
    renderMode: { kind: "image" as const },
  };
}

/**
 * The runner's own render output — a small two-row card (title + detail). Used
 * both for the post-run confirmation and the preview/lite stand-in. Text wraps
 * to the canvas width so long instruction lines never clip.
 */
export function buildConfirmationDoc(opts: {
  titleLine: string;
  subLine: string;
  ctx: MosaicEngineContext;
}): MosaicDocument {
  const { ctx } = opts;
  const W = ctx.target.width;
  const titleFont = clamp(Math.round(W / 26), 28, 80);
  const subFont = clamp(Math.round(W / 46), 18, 44);
  return {
    kind: "mosaic_document",
    version: 1,
    m0: equalSplit(2, "row"),
    assets: {},
    fps: ctx.target.fps,
    durationMs: ctx.target.durationMs,
    size: { width: ctx.target.width, height: ctx.target.height },
    sources: [
      textTile(opts.titleLine, titleFont, "#0b1020", W),
      textTile(opts.subLine, subFont, "#11162a", W),
    ],
  } as MosaicDocument;
}
