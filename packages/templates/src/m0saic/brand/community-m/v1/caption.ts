import type { MosaicSource } from "@m0saic/types";
import { svgLabel } from "@m0saic/template-utils";

/** The bundled svg font covers ASCII; fold everything else so text gates never trip. */
export function asciiSafe(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[–—·]/g, "-")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** One caption line fitted into a box (single line, shrinks to fit). */
export function captionSource(text: string, boxW: number, boxH: number, color: string): MosaicSource {
  return svgLabel(asciiSafe(text), boxW, boxH, { color: color as never, maxPx: Math.round(boxH * 0.55), maxLines: 1 });
}
