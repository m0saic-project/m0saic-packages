import type {
  MosaicDocument,
  MosaicTextSource,
  MosaicTextLayer,
  MosaicColor,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";

function asciiOnly(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "?");
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Placeholder mosaic for templates that aren't implemented yet.
 *
 * Unlike makeErrorMosaic, this does NOT mark engine.renderStatus = "error",
 * so validate-only passes and the pipeline can render a visible "STUB" card.
 * Replace with the real implementation when ready.
 */
export function makeStubMosaic(
  label: string,
  opts: {
    width: number;
    height: number;
    backgroundColor?: MosaicColor;
    textColor?: MosaicColor;
    note?: string;
  }
): MosaicDocument {
  const W = opts.width;
  const H = opts.height;

  const bg = opts.backgroundColor ?? "#202028";
  const fg = opts.textColor ?? "#a0a0b0";

  const titleFont = clamp(Math.round(W / 18), 18, 56);
  const subFont = clamp(Math.round(W / 36), 12, 26);

  const layers: MosaicTextLayer[] = [];

  layers.push({
    content: { kind: "literal", text: asciiOnly(`STUB: ${label}`) },
    style: { fontSize: titleFont, fontColor: fg } as any,
    placement: {
      hAlign: "center",
      vAlign: "center",
      xExpr: "w/2",
      yExpr: "h/2",
    } as any,
  });

  layers.push({
    content: {
      kind: "literal",
      text: asciiOnly(opts.note ?? "Template not yet implemented"),
    },
    style: { fontSize: subFont, fontColor: fg } as any,
    placement: {
      hAlign: "center",
      vAlign: "top",
      xExpr: "w/2",
      yExpr: `h/2 + ${Math.round(titleFont * 0.9)}`,
    } as any,
  });

  const src: MosaicTextSource = {
    type: "text",
    visual: { backgroundColor: bg },
    layers,
  };

  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as any,
    m0: toM0String("F", "makeStubMosaic"),
    sources: [src],
  };
}
