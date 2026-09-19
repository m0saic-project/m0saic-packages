/**
 * Brand QR v1 — scannable QR encoding arbitrary text.
 *
 * Default is a m0saic URL; any string the QR encoder can carry works
 * (URLs, plain text, wifi credentials via `qrPayloadWifi`, vCard payloads
 * via `qrPayloadVCard`, etc.). The `url` flavor on the text prop opts
 * into the editor's URL UX (paste auto-prefix, open-in-browser) without
 * restricting the value.
 *
 * Fully in-house: no SVG, no `sharp`, no PNG raster. Each QR module is
 * its own lavfi colour tile in the document's m0 — the engine paints
 * them directly. Background fill comes from the document's
 * `backgroundColor` (omitted entirely for transparent mode so the
 * alpha channel survives).
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicColor,
  MosaicEngineContext,
  MosaicDocument,
  MosaicSource,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  defineMosaicTemplate,
  definePropsSchema,
  makeErrorMosaic,
  qrToRenderable,
  registerTemplate,
  solidBackground,
} from "@m0saic/template-utils";

const BRAND_ORANGE: MosaicColor = "#f97316";
const BG_LIGHT: MosaicColor = "#ffffff";
const BG_DARK: MosaicColor = "#000000";

type Props = {
  text?: string;
  mode?: "light" | "dark";
  transparentBackground?: boolean;
};

const propsSchema = definePropsSchema<Props>({
  text: {
    type: "string",
    required: false,
    description: "Text to encode (URL, plain string, or structured payload). Defaults to https://www.m0saic.io.",
    meta: { control: { flavor: "url", placeholder: "https://www.m0saic.io" } },
  },
  mode: {
    type: "string",
    required: false,
    description: "Color mode of the QR code",
    meta: { constraints: { oneOf: ["light", "dark"] } },
  },
  transparentBackground: {
    type: "boolean",
    required: false,
    description:
      "When true, light areas are transparent (alpha). When false, light/dark use solid background.",
  },
});

export const BrandQr = defineMosaicTemplate<Props>({
  id: asTemplateId("@m0saic/media/qr/basic/v1"),
  label: "Brand QR (v1, deprecated)",
  version: 1,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the QR module grid —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description:
    "Scannable QR encoding any text (URL, plain string, or structured payload). Orange modules on light, dark, or transparent backgrounds. The atomic QR.",
  deprecated: {
    reason:
      "Merged into QR Code (media/qr/code/v1) — its moduleStyle:\"square\" path is byte-identical to this template, and the unified card adds rounded/circle styles plus the carved centre asset. Kept as the plain-path reference.",
    replacement: asTemplateId("@m0saic/media/qr/code/v1"),
    since: "2026-07-21",
  },
  capabilities: { tier: "core" },
  tags: ["brand", "qr"],

  outputHints: {
    width: 1080,
    height: 1080,
    fps: 30,
    durationMs: 2000,
    note: "Square QR rendered as in-house m0 (no PNG raster).",
    format: {
      kind: "image",
      container: "png",
      pixelFormat: "rgba",
    },
  },

  propsSchema,
  defaultProps: {
    text: "https://www.m0saic.io",
    mode: "dark",
    // Default to a solid card. Transparent is opt-in (the user toggles
    // it on when they want alpha PNG for compositing). Defaulting to
    // false avoids the "blank canvas + orange modules" preview that
    // looked broken when alpha was implicit.
    transparentBackground: false,
  },

  async render(
    props: Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const text = props.text ?? (this.defaultProps!.text as string);
    const mode = props.mode ?? (this.defaultProps!.mode as "light" | "dark");
    const transparentBackground = props.transparentBackground ?? false;

    let renderable;
    try {
      renderable = qrToRenderable({
        text,
        moduleColor: BRAND_ORANGE,
        errorCorrectionLevel: "H",
      });
    } catch (err) {
      return makeErrorMosaic(
        `BrandQr: ${err instanceof Error ? err.message : String(err)}`,
        {
          title: "Brand QR (v1)",
          width: ctx.output.width,
          height: ctx.output.height,
        },
      );
    }

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(String(renderable.m0), "BrandQr"),
      sources: renderable.sources as MosaicSource[],
      assets: {} as MosaicDocument["assets"],
      // Engine-decided timing, not hardcoded. `outputHints` above still supply
      // 30 / 2000 as the DEFAULTS (they seed ctx.target when the caller asks
      // for nothing); authoring literals here additionally beat an EXPLICIT
      // ask, because `stampRenderableOutput` gives authored durationMs
      // precedence over the resolved target (gate 26). That rule is safe only
      // for templates that yield to user intent before authoring — a 5s
      // request was silently rendering as 2s.
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      // `solidBackground` forces the bg's alpha to opaque on alpha-bearing
      // output formats (our rgba PNG). Without it the engine's bgFill step
      // defaults to `@0.0` and silently turns the canvas transparent. See
      // `solidBackground` docs for the full engine branch reference.
      ...(transparentBackground
        ? {}
        : {
            backgroundColor: solidBackground(
              mode === "dark" ? BG_DARK : BG_LIGHT,
            ),
          }),
    };

    return doc;
  },
});

registerTemplate(BrandQr);
export default BrandQr;
/** @deprecated Use BrandQr */
export const QRCode = BrandQr;
