/**
 * Barcode v2 — scannable 1D barcode (Code 128 / EAN-13 / UPC-A), held to the
 * 0.3.1 template conventions. Renders exactly what v1 renders; what changed:
 *
 *  - `canvasFill`: the quiet zone is `document.backgroundColor`, not a
 *    full-canvas base tile — in Make a base tile is a click target over
 *    every bar. The engine still ignores a NESTED document's own background,
 *    and a barcode that loses its ground stops scanning, so a parent that
 *    composes this one into a cell passes the hidden compose-time flag
 *    `useNestedBackgroundColor: true` and gets v1's base tile back.
 *  - The PAYLOAD is a handle on the whole symbol: every bar and the caption
 *    bind `text`, so double-clicking the barcode anywhere edits what it
 *    encodes — also with the caption off, where v1 offered nothing.
 *  - An empty payload is an input the card waits on (`makeIncompleteMosaic`).
 *  - What DESCRIBES it (label, description, tags, prop copy) lives in
 *    `barcode.catalog.json` beside this file.
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
  bindProp,
  defineMosaicTemplate,
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  makeIncompleteMosaic,
  registerTemplate,
  solidBackground,
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

export type BarcodeV2Props = {
  text?: string;
  format?: BarcodeFormat;
  mode?: "light" | "dark";
  transparentBackground?: boolean;
  showHumanReadable?: boolean;
  /** Compose-time (hidden): also paint the ground as a full-frame tile, for a parent that nests this barcode. */
  useNestedBackgroundColor?: boolean;
};

// What each value IS. How Make presents it is the catalog sidecar's —
// barcode.catalog.json.
const propsSchema = definePropsSchema<BarcodeV2Props>({
  text: { type: "string", required: false },
  format: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["code128", "ean13", "upca"] } },
  },
  mode: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["light", "dark"] } },
  },
  transparentBackground: { type: "boolean", required: false },
  showHumanReadable: { type: "boolean", required: false },
  useNestedBackgroundColor: {
    type: "boolean",
    required: false,
    // A flag a composing parent sets programmatically, never a human knob.
    meta: { ui: { hidden: true } },
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
        // edge at canvas center (drawtext semantics).
        placement: {
          hAlign: "center",
          vAlign: "middle",
        },
      },
    ],
  } as MosaicTextSource;
}

export const BarcodeV2 = defineMosaicTemplate<BarcodeV2Props>({
  id: asTemplateId("@m0saic/media/barcode/v2"),
  version: 2,
  // BITMAP drafting mode (handbook §3c): the split counts ARE Code 128 module widths —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  capabilities: { tier: "core" },

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

  async render(props: BarcodeV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const text = props.text ?? DEFAULTS.text;
    const format = props.format ?? DEFAULTS.format;
    const mode = props.mode ?? DEFAULTS.mode;
    const transparentBackground = props.transparentBackground ?? DEFAULTS.transparentBackground;
    const showHumanReadable = props.showHumanReadable ?? DEFAULTS.showHumanReadable;

    if (text.trim().length === 0) {
      return makeIncompleteMosaic("Type what the barcode encodes — letters and digits for Code 128, digits for EAN-13 / UPC-A.", {
        title: "Barcode",
        width: ctx.target.width,
        height: ctx.target.height,
      });
    }

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
      return makeErrorMosaic(`Barcode: ${err instanceof Error ? err.message : String(err)}`, {
        title: "Barcode",
        width: ctx.target.width,
        height: ctx.target.height,
      });
    }

    // `barcodeToRenderable` lays out sources as [bars..., hri-carved...].
    // Every BAR shows the payload, so each carries its handle: a double-click
    // anywhere on the symbol edits what it encodes.
    const numBars = renderable.channelByRole.bars?.frames.length ?? 0;
    const sources: MosaicSource[] = (renderable.sources as MosaicSource[]).map((src, i) =>
      i < numBars ? bindProp(src, "text") : src,
    );

    // ── Splice HRI text sources into the carved splice points ──
    // For each HRI frame with a stableKey (carve mode only), replace the
    // matching source with a MosaicTextSource carrying the digit caption.
    if (showHumanReadable && renderable.humanReadableFrames.length > 0) {
      for (let i = 0; i < renderable.humanReadableFrames.length; i++) {
        const frame = renderable.humanReadableFrames[i];
        if (!frame.stableKey) continue;
        const sourceIndex = numBars + i;
        if (sourceIndex >= sources.length) continue;
        // Size font to roughly fill the HRI band's pixel height in the
        // renderable's canvas space. The engine scales tile contents when
        // mapping to the output canvas, so this stays proportional.
        const fontSize = Math.max(6, Math.round(frame.bounds.height * 0.75));
        sources[sourceIndex] = bindProp(buildHriTextSource(frame.text, backgroundColor, fontSize), "text");
      }
    }

    // Compose-time only: a NESTED document's backgroundColor is ignored by
    // the engine, so a parent that nests this barcode asks for v1's base tile
    // (one `1{…}` wrap; frame 0 is the ground). A standalone render keeps the
    // ground on the document, with no rect over the bars.
    let m0Str = String(renderable.m0);
    if (props.useNestedBackgroundColor === true && backgroundColor !== undefined) {
      m0Str = `1{${m0Str}}`;
      sources.unshift(makeColorTile(backgroundColor));
    }

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(m0Str, "Barcode"),
      sources,
      assets: {} as MosaicDocument["assets"],
      // Engine-decided timing (same fix as media/qr/basic/v1).
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      // Pass the renderable's natural canvas size so bars stay square at
      // render time regardless of the engine target's aspect.
      size: { width: renderable.canvasW, height: renderable.canvasH },
      ...(backgroundColor !== undefined ? { backgroundColor } : {}),
    };
  },
});

registerTemplate(BarcodeV2);
export default BarcodeV2;
