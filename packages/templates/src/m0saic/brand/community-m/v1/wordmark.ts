import type { MosaicColor, MosaicDocument, MosaicSource } from "@m0saic/types";
import { WORDMARK_BOUNDS, WORDMARK_LETTER_PATHS, WORDMARK_ZERO_PATHS, makeColorTile, placeInsetPieces } from "@m0saic/template-utils";

/** The wordmark's height as a share of the caption row it sits in
 *  (0.7 → 0.82, founder 2026-09-16: "a tad larger"; the row still keeps
 *  ~9 % of air above and below it). */
export const WORDMARK_ROW_SHARE = 0.82;

export type WordmarkBox = { x: number; y: number; w: number; h: number };

/**
 * The wordmark's box inside a caption row: {@link WORDMARK_ROW_SHARE} of the
 * row tall at the wordmark's own 1213:283 aspect (whole px — the engine
 * scales mask bounds per axis, so the box must hold the aspect or the
 * letters smear), centred in the row.
 */
export function wordmarkBox(rowW: number, rowH: number): WordmarkBox {
  const aspect = WORDMARK_BOUNDS.width / WORDMARK_BOUNDS.height;
  let h = Math.max(1, Math.round(rowH * WORDMARK_ROW_SHARE));
  let w = Math.max(1, Math.round(h * aspect));
  if (w > rowW) {
    w = rowW;
    h = Math.max(1, Math.round(w / aspect));
  }
  return { x: Math.floor((rowW - w) / 2), y: Math.floor((rowH - h) / 2), w, h };
}

/** A single-colour silhouette clipped by SVG paths (one half of the wordmark). */
function pathTile(paths: readonly string[], color: string): MosaicSource {
  return makeColorTile(color as MosaicColor, {
    mask: { kind: "inline-mask", localPath: paths.join(" "), bounds: { x: 0, y: 0, width: WORDMARK_BOUNDS.width, height: WORDMARK_BOUNDS.height } },
  }) as MosaicSource;
}

/**
 * A caption row carrying the official m0saic wordmark — the letterforms in
 * the ink colour, the rect-built "0" in the accent — the same lockup the
 * business-card and hello-world templates paint. Laundered onto the lattice
 * with zero drift (`placeInsetPieces`): the two halves share one exact rect,
 * the zero painted over the letters.
 */
export function wordmarkRowDoc(o: { rowW: number; rowH: number; fps: number; durationMs: number; ink: string; accent: string; canvasColor: string }): MosaicDocument {
  const box = wordmarkBox(o.rowW, o.rowH);
  const placed = placeInsetPieces({
    rootW: o.rowW,
    rootH: o.rowH,
    pieces: [
      { rect: { ...box, importance: 0 }, source: pathTile(WORDMARK_LETTER_PATHS, o.ink) },
      { rect: { ...box, importance: 1 }, source: pathTile(WORDMARK_ZERO_PATHS, o.accent) },
    ],
  });
  return {
    kind: "mosaic_document",
    version: 1,
    m0: placed.m0,
    size: { width: o.rowW, height: o.rowH },
    fps: o.fps,
    durationMs: o.durationMs,
    backgroundColor: o.canvasColor as never,
    audio: { mode: "off" },
    assets: {},
    sources: placed.sources,
  };
}
