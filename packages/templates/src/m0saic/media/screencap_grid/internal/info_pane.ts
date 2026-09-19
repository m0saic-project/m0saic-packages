import { asTemplateId } from "@m0saic/types";
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicTemplate,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { definePropsSchema, registerTemplate } from "@m0saic/template-utils";

// ---- PROPS ----

export type InfoPaneProps = {
  /** Primary title text (typically the filename). */
  title: string;
  /** Multi-line metadata text (duration, codecs, etc.). */
  metadata: string;
  /** Pixel height of the info pane tile (passed by parent for reference). */
  paneHeight: number;
  /** Horizontal alignment of the title + metadata text. Default "left". */
  align?: "left" | "center" | "right";
};

const propsSchema = definePropsSchema<InfoPaneProps>({
  title: {
    type: "string",
    required: true,
    description: "Primary title text (typically the filename).",
  },
  metadata: {
    type: "string",
    required: true,
    description: "Multi-line metadata text.",
  },
  paneHeight: {
    type: "number",
    required: true,
    description: "Pixel height of the info pane tile.",
  },
  align: {
    type: "string",
    required: false,
    description: "Horizontal alignment of the text.",
    meta: { constraints: { oneOf: ["left", "center", "right"] } },
  },
});

// ---- TEMPLATE ----

export const INFO_PANE_TEMPLATE_ID =
  asTemplateId("@m0saic/media/screencap_grid/internal/info_pane/v1");

/*
 * Typography limitations:
 *   FFmpeg drawtext does not support fontWeight or fontStyle (italic).
 *   Bold is simulated via a thin same-color border (borderWidth) that thickens
 *   each glyph. Italic is not achievable without a separate italic font file.
 *   Font sizes are derived from ctx.target.height (the full output height),
 *   NOT from paneHeight, so they remain stable regardless of how tall the
 *   info pane is. The pane is auto-sized from the content in the parent.
 */

export const InfoPane: MosaicTemplate<InfoPaneProps> = {
  id: INFO_PANE_TEMPLATE_ID,
  label: "Screencap Grid — Info Pane (internal)",
  version: 1,
  internal: true,
  description:
    "Internal subtemplate: renders the filename + metadata info pane for the screencap grid.",
  capabilities: { tier: "core" },
  tags: ["media", "screencap", "internal"],
  propsSchema,

  outputHints: {
    format: { kind: "image", container: "png" },
  },

  defaultProps: {
    align: "left",
    title: "",
    metadata: "",
    paneHeight: 130,
  },

  render(
    props: InfoPaneProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const { title, metadata } = props;
    const hAlign = props.align ?? "left";
    const targetH = ctx.target.height;

    // Font sizes scaled from the full output height for consistency across
    // pane sizes. Must match the formulas in screencap-grid.ts estimateInfoPaneHeight.
    const titleFontSize = Math.max(16, Math.min(48, Math.round(targetH * 0.022)));
    const metaFontSize = Math.max(9, Math.min(20, Math.round(targetH * 0.012)));

    // Thin same-color border to simulate bold (thickens each glyph slightly).
    const titleBorderWidth = Math.max(1, Math.round(titleFontSize * 0.02));

    // Pixel-based positioning so text fills the pane tightly. BOTH layers
    // must be pixel-anchored (yExpr): the engine resolves fractional padding
    // against the RASTER height, and this doc rasterizes at the full parent
    // canvas (the wrapper-stamped `size`), not at paneHeight — a fraction of
    // paneHeight would land the title below the metadata block. The pixel
    // values are exactly what estimateInfoPaneHeight budgets for the pane.
    const topPad = 6;
    const titleBlockH = Math.round(titleFontSize * 1.3);
    const gap = Math.round(titleFontSize * 0.35);
    const metaY = topPad + titleBlockH + gap;

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: toM0String("F", "InfoPane"),
      sources: [
          {
            type: "text",
            renderMode: { kind: "image" },
            layers: [
              // Layer 0: Title (filename) — large, bright white, faux-bold via border
              {
                content: { kind: "literal", text: title },
                style: {
                  fontSize: titleFontSize,
                  fontColor: "#ffffff" as const,
                  borderWidth: titleBorderWidth,
                  borderColor: "#ffffff" as const,
                },
                visual: { backgroundColor: "#0d0d0d" as const },
                placement: {
                  hAlign,
                  vAlign: "top" as const,
                  yExpr: `${topPad}`,
                  padding: { x: 0.015 },
                },
              },
              // Layer 1: Metadata (dense info lines) — smaller, muted gray
              {
                content: { kind: "literal", text: metadata },
                style: {
                  fontSize: metaFontSize,
                  fontColor: "#a0a0a0" as const,
                },
                visual: {},
                placement: {
                  hAlign,
                  vAlign: "top" as const,
                  yExpr: `${metaY}`,
                  padding: { x: 0.015 },
                },
              },
            ],
            editor: { owner: "template" },
          },
        ],
    };

    return Promise.resolve(doc);
  },
};

registerTemplate(InfoPane);
