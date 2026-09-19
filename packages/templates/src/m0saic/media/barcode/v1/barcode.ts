/**
 * Brand Barcode v1 — scannable 1D barcode (Code 128 / EAN-13 / UPC-A).
 *
 * Default is a Code 128 "M0SAIC" tag; any string that fits the chosen
 * format works (printable ASCII for Code 128, 12/13 digits for EAN-13,
 * 11/12 digits for UPC-A — short forms auto-append the check digit).
 *
 * Fully in-house: no SVG, no `sharp`, no PNG raster. Each dark bar is its
 * own lavfi colour tile in the document's m0 — the engine paints them
 * directly. When `showHumanReadable` is on, the carved HRI splice points
 * are filled with `MosaicTextSource`s carrying the digit caption.
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTextSource,
} from "@m0saic/types";
import { toM0String, type BarcodeFormat } from "@m0saic/dsl-stdlib";
import {
  barcodeToRenderable,
  defineMosaicTemplate,
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  registerTemplate,
  solidBackground,
  bindProp,
} from "@m0saic/template-utils";

const BRAND_ORANGE: MosaicColor = "#f97316";
const BG_LIGHT: MosaicColor = "#ffffff";
const BG_DARK: MosaicColor = "#000000";

/** Pixel scale for the in-house bar layout (matches the dictionary generator). */
const PX_PER_MODULE = 4;
/** Bar region height in modules. Drives the rendered aspect ratio. */
const BAR_HEIGHT_MODULES = 40;
/** Default HRI band height as fraction of bar height. */
const HRI_HEIGHT_PCT = 0.15;

/**
 * Font stack for the HRI digit caption. The convention for printed product-
 * code barcodes is OCR-B (Optical Character Recognition B); m0saic doesn't
 * bundle that font, so we fall back to widely-available monospaces. The
 * stack survives even on systems where the first choice is missing — ffmpeg
 * + fontconfig resolves the first available name.
 */
const HRI_FONT_FAMILY = "OCR-B, OCR B, Inconsolata, Menlo, Consolas, Courier New, monospace";

type Props = {
  text?: string;
  format?: BarcodeFormat;
  mode?: "light" | "dark";
  transparentBackground?: boolean;
  showHumanReadable?: boolean;
};

const propsSchema = definePropsSchema<Props>({
  text: {
    type: "string",
    required: false,
    description:
      "Payload to encode. Code 128: printable ASCII. EAN-13: 12 or 13 digits. UPC-A: 11 or 12 digits.",
    meta: { ui: { label: "Payload" } },
  },
  format: {
    type: "string",
    required: false,
    description:
      "Symbology. Code 128 for general-purpose ASCII; EAN-13 / UPC-A for retail product codes.",
    meta: { ui: { label: "Symbology" }, constraints: { oneOf: ["code128", "ean13", "upca"] } },
  },
  mode: {
    type: "string",
    required: false,
    description: "Background colour mode.",
    meta: { ui: { label: "Background" }, constraints: { oneOf: ["light", "dark"] } },
  },
  transparentBackground: {
    type: "boolean",
    required: false,
    description:
      "When true, the canvas background is transparent (alpha) instead of solid light/dark.",
    meta: { ui: { label: "Transparent background" } },
  },
  showHumanReadable: {
    type: "boolean",
    required: false,
    description:
      "When true, carve a band under the bars and splice in the digit caption (the human-readable interpretation). When false, output is bars only.",
    meta: { ui: { label: "Human-readable caption" } },
  },
});

const DEFAULTS = {
  text: "M0SAIC",
  format: "code128" as BarcodeFormat,
  mode: "light" as "light" | "dark",
  transparentBackground: false,
  showHumanReadable: true,
} as const;

/**
 * Build a `MosaicTextSource` to splice into an HRI splice-point F. The
 * source paints `text` centered in its cell. `bg` matches the document
 * background so the HRI tile visually blends into the canvas; `undefined`
 * preserves alpha when the canvas is transparent.
 */
function buildHriTextSource(
  text: string,
  bg: MosaicColor | undefined,
  fontSize: number,
): MosaicTextSource {
  return {
    type: "text",
    ...(bg !== undefined ? { visual: { backgroundColor: bg } } : {}),
    layers: [
      {
        content: { kind: "literal", text },
        style: {
          fontSize,
          fontColor: BRAND_ORANGE,
          fontFamily: HRI_FONT_FAMILY,
        },
        // hAlign/vAlign only — an xExpr of "w/2" anchors the text's LEFT
        // edge at canvas center (drawtext semantics), which shoved every
        // caption right of center and ran long payloads off the canvas.
        placement: {
          hAlign: "center",
          vAlign: "middle",
        },
      },
    ],
  } as MosaicTextSource;
}

export const Barcode = defineMosaicTemplate<Props>({
  id: asTemplateId("@m0saic/media/barcode/v1"),
  label: "Barcode",
  version: 1,
  // BITMAP drafting mode (handbook §3c): the split counts ARE Code 128 module widths —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description:
    "Scannable 1D barcode (Code 128, EAN-13, UPC-A). Orange bars on light, dark, or transparent backgrounds. Optional human-readable digit caption underneath.",
  capabilities: { tier: "core" },
  tags: ["media", "barcode", "designers", "marketers", "print", "label"],

  outputHints: {
    // Width × height chosen for a typical Code 128 payload at ~2.6:1 aspect.
    // The document's `size` field below carries the payload-exact dims so
    // bars stay square at render time; outputHints is just the engine target.
    width: 1080,
    height: 420,
    fps: 30,
    durationMs: 2000,
    note: "1D barcode rendered as in-house m0 (no PNG raster).",
    format: {
      kind: "image",
      container: "png",
      pixelFormat: "rgba",
    },
  },

  propsSchema,
  defaultProps: DEFAULTS,

  async render(
    props: Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const text = props.text ?? DEFAULTS.text;
    const format = props.format ?? DEFAULTS.format;
    const mode = props.mode ?? DEFAULTS.mode;
    const transparentBackground =
      props.transparentBackground ?? DEFAULTS.transparentBackground;
    const showHumanReadable =
      props.showHumanReadable ?? DEFAULTS.showHumanReadable;

    // `solidBackground` appends `@1.0` to force opaque output on alpha-
    // bearing formats (our `pixelFormat: "rgba"` PNG); see its docs for
    // why. `undefined` (transparent mode) passes through unchanged.
    const backgroundColor: MosaicColor | undefined = transparentBackground
      ? undefined
      : solidBackground(mode === "dark" ? BG_DARK : BG_LIGHT);

    let renderable;
    try {
      renderable = barcodeToRenderable({
        text,
        format,
        moduleColor: BRAND_ORANGE,
        moduleWidthPx: PX_PER_MODULE,
        heightPx: BAR_HEIGHT_MODULES * PX_PER_MODULE,
        humanReadable: showHumanReadable
          ? { mode: "carve", heightPct: HRI_HEIGHT_PCT }
          : { mode: "none" },
      });
    } catch (err) {
      return makeErrorMosaic(
        `Barcode: ${err instanceof Error ? err.message : String(err)}`,
        {
          title: "Brand Barcode (v1)",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }

    // ── Splice HRI text sources into the carved splice points ──
    // `barcodeToRenderable` lays out sources as [bars..., hri-carved...].
    // For each HRI frame with a stableKey (carve mode only), replace the
    // matching source with a MosaicTextSource carrying the digit caption.
    const sources: MosaicSource[] = [...(renderable.sources as MosaicSource[])];
    const numBars = renderable.channelByRole.bars?.frames.length ?? 0;

    if (showHumanReadable && renderable.humanReadableFrames.length > 0) {
      for (let i = 0; i < renderable.humanReadableFrames.length; i++) {
        const frame = renderable.humanReadableFrames[i];
        if (!frame.stableKey) continue;
        const sourceIndex = numBars + i;
        if (sourceIndex >= sources.length) continue;
        // Size font to roughly fill the HRI band's pixel height in the
        // renderable's canvas space. The engine scales tile contents when
        // mapping to the output canvas, so this stays proportional.
        const fontSize = Math.max(
          6,
          Math.round(frame.bounds.height * 0.75),
        );
        // The caption SHOWS the `text` prop — bind it so Make's double-click
        // edits the payload in place.
        sources[sourceIndex] = bindProp(
          buildHriTextSource(frame.text, backgroundColor, fontSize),
          "text",
        );
      }
    }

    // Solid modes ALSO paint the background as a real base tile: the resolver
    // child path (.mosaicx template_invocation) drops the child doc's
    // backgroundColor (candidate 2026-08-06-template-invocation-bg-drop), and a
    // barcode losing its quiet-zone ground is a SCANNABILITY inversion (orange
    // bars on black + white HRI patches). Transparent mode stays tile-free so
    // alpha survives. Prepended AFTER the HRI splice so splice indices hold.
    let m0Str = String(renderable.m0);
    if (backgroundColor !== undefined) {
      m0Str = `1{${m0Str}}`;
      sources.unshift(makeColorTile(backgroundColor));
    }

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(m0Str, "Barcode"),
      sources,
      assets: {} as MosaicDocument["assets"],
      // Engine-decided timing (same fix as media/qr/basic/v1). `outputHints`
      // above still supply 30 / 2000 as DEFAULTS; authoring the literals here
      // additionally beat an EXPLICIT ask, because stampRenderableOutput gives
      // authored durationMs precedence over the resolved target (gate 26).
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      // Pass the renderable's natural canvas size so bars stay square at
      // render time regardless of the engine target's aspect.
      size: { width: renderable.canvasW, height: renderable.canvasH },
      ...(backgroundColor !== undefined ? { backgroundColor } : {}),
    };
  },
});

registerTemplate(Barcode);
export default Barcode;
