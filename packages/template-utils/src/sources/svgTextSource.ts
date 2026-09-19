import type { MosaicColor, MosaicSource } from "@m0saic/types";

import { fitSvgText } from "../text/fitText";

/**
 * Svg-rasterized static text sources.
 *
 * `rasterizer: "svg"` draws glyphs from the BUNDLED deterministic font and
 * bakes them to geometry — identical output in the app preview and the CLI,
 * no drawtext spawn, no system-font dependence. Two things every caller
 * must know:
 *
 *   1. Svg text carries NO background of its own (it bakes to a masked
 *      color tile). Pair it with a `makeColorTile` base underneath — same
 *      cell via an attached `{...}` overlay, or a separate layer.
 *   2. Nothing soft-wraps. Fit copy with the measured helpers in
 *      `text/fitText` (or use {@link svgLabel}, which fits for you).
 *
 * Keep copy ASCII: the bundled glyph font is lean, and exotic codepoints
 * (like U+2192) render as tofu.
 */

export type SvgTextLayerSpec = {
  /** Literal text; "\n" separates pre-fitted lines. */
  text: string;
  fontSize: number;
  color: MosaicColor;
  vAlign?: "top" | "middle" | "bottom";
  padding?: { bottom?: number; top?: number };
};

/** A multi-layer svg text source (each layer centers horizontally). */
export function svgTextSource(layers: SvgTextLayerSpec[]): MosaicSource {
  return {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    layers: layers.map((layer) => ({
      content: { kind: "literal", text: layer.text },
      style: { fontSize: layer.fontSize, fontColor: layer.color },
      placement: {
        hAlign: "center" as const,
        vAlign: layer.vAlign ?? ("middle" as const),
        ...(layer.padding ? { padding: layer.padding } : {}),
      },
    })),
  } as unknown as MosaicSource;
}

/**
 * A pre-fitted single-layer label for a KNOWN pixel box — the one-liner for
 * captioning a tile or a canvas. The box is whatever cell this source will
 * fill (compute it from `ctx.target` and your own split weights).
 */
export function svgLabel(
  text: string,
  boxW: number,
  boxH: number,
  opts?: {
    color?: MosaicColor;
    maxPx?: number;
    maxLines?: number;
    vAlign?: "top" | "middle" | "bottom";
    padding?: { bottom?: number; top?: number };
  },
): MosaicSource {
  const fit = fitSvgText(text, boxW, boxH, {
    maxPx: opts?.maxPx ?? Math.round(boxH * 0.5),
    maxLines: opts?.maxLines ?? 2,
  });
  return svgTextSource([
    {
      text: fit.text,
      fontSize: fit.fontSize,
      color: opts?.color ?? ("#ffffff" as MosaicColor),
      vAlign: opts?.vAlign,
      padding: opts?.padding,
    },
  ]);
}
