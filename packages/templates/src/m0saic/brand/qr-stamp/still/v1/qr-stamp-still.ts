import * as path from "node:path";

import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  buildCornerStampM0,
  defineMosaicTemplate,
  definePropsSchema,
  makeErrorMosaic,
  qrToRenderable,
  registerTemplate,
} from "@m0saic/template-utils";

// Prerendered static QR assets from `../assets/` (the brand pack owns
// the attribution binaries; they are BAKED from media/qr/animate/v1 by
// tools/build-qr-static-stills.cjs). These
// already include the URL strip beneath the QR (baked in by
// `tools/build-qr-static-stills.cjs` whenever the brand or url label
// changes), so wiring the still stamp through them keeps image
// outputs visually consistent with the animated mp4 stamp — same
// QR card, same URL strip, same aspect ratio. Live-generation via
// `qrToRenderable` is retained for paid-tier custom-URL flows where
// the bundled assets don't match the requested URL.
const QR_ANIMATE_ASSETS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "assets",
);

// When packaged inside an Electron `app.asar`, the assets folder
// lands at `<...>/app.asar/<...>/assets/`, which external tools
// (ffmpeg) can't read. electron-builder's `asarUnpack` writes a
// parallel `app.asar.unpacked/` directory; we translate so spawn
// consumers get a real disk path. No-op for CLI / non-Electron
// hosts where neither segment appears.
function unpackedAsarPath(p: string): string {
  const inAsar = `${path.sep}app.asar${path.sep}`;
  if (!p.includes(inAsar)) return p;
  return p.split(inAsar).join(`${path.sep}app.asar.unpacked${path.sep}`);
}

const VARIANT_STATIC_PATH: Record<"light" | "dark", string> = {
  light: unpackedAsarPath(
    path.join(QR_ANIMATE_ASSETS_DIR, "qr-animate.light.static.png"),
  ),
  dark: unpackedAsarPath(
    path.join(QR_ANIMATE_ASSETS_DIR, "qr-animate.dark.static.png"),
  ),
};

// Free-tier default URLs that authorize using the prerendered assets
// (which encode m0saic.io). Anything else falls back to live qr
// generation so the encoded URL actually matches what the user wants.
const FREE_TIER_URL_RE = /^https?:\/\/(?:www\.)?m0saic\.io\/?$/i;

/**
 * Adaptive M0saic QR watermark for still (image) outputs.
 *
 * Stills don't have a time axis, so there's no animation and no crossfade.
 * The CLI free-tier hook (or a manual caller) samples the overall luminance
 * of the bottom-right region once and passes it as `overallLumaForAuto`;
 * the template picks light-bg or dark-bg accordingly.
 *
 * The QR is composed as a nested {@link MosaicDocument} (under
 * `doc.children.qr`) rather than a PNG asset — the modules and the
 * background colour come from in-house `qrToRenderable`, so this template
 * no longer depends on `sharp` or `qrcode`.
 */

export type QrStampStillMode = "auto" | "light" | "dark" | "transparent";

export type QrStampStillProps = {
  /**
   * Path to the base image file to stamp.
   * Required at render time; optional in the type so `defaultProps` doesn't
   * have to seed a fake placeholder. `render` throws if missing.
   */
  imagePath?: string;
  /** Text encoded into the QR (URL, plain string, or structured payload). */
  text?: string;
  /** Padding from the bottom-right edge, in pixels. */
  cornerInsetPx?: number;
  /** Stamp size as a percent of min(W, H). */
  stampSizePct?: number;
  /** QR adaptation mode. */
  mode?: QrStampStillMode;
  /**
   * Region-average luma (0..255) for the bottom-right area. When `mode === "auto"`,
   * the template uses this value to pick the light-bg or dark-bg variant.
   * If `mode === "auto"` and no value is provided, the template falls back to
   * the light variant deterministically.
   */
  overallLumaForAuto?: number;
  /** Threshold; `overallLumaForAuto > autoThreshold` → light-bg variant. */
  autoThreshold?: number;
  /** Opacity of the QR's solid background, 0..1 (default 0.92). Ignored for `mode: "transparent"`. */
  bgOpacity?: number;
};

const BRAND_ORANGE: MosaicColor = "#f97316";

// Tunable defaults — kept in sync with the video stamp's defaults
// (see packages/templates/src/m0saic/brand/qr-stamp/video/v1/qr-stamp.ts).
const DEFAULTS = {
  text: "https://www.m0saic.io",
  cornerInsetPx: 24,
  // ⭐ 2026-09-08 — raised 18 → 26 (founder: the attribution stamp is the main
  // revenue-conversion surface, so it should read at a glance). Also fixes a
  // scannability floor: at 18% a 512x512 render gave 92px ≈ 3.2 px per QR
  // module, under the ~4 px practical scan threshold; 26% gives 133px ≈ 4.6.
  // NOTE: the basis is still min(W,H), so WIDE canvases stay under-served
  // (1920x400 → 104px ≈ 3.6/module even at 26%) — that is the separate,
  // still-open basis question, not something a bigger percentage fixes.
  stampSizePct: 26,
  mode: "auto" as QrStampStillMode,
  autoThreshold: 128,
  bgOpacity: 0.92,
};

const propsSchema = definePropsSchema<QrStampStillProps>({
  imagePath: {
    type: "media",
    required: true,
    description: "Path to the base image file to stamp.",
    meta: { control: { picker: "file", accept: ["image"] } },
  },
  text: {
    type: "string",
    required: false,
    description: "Text encoded into the QR — URL, plain string, or structured payload (default: https://www.m0saic.io).",
    meta: { control: { flavor: "url", placeholder: "https://www.m0saic.io" } },
  },
  cornerInsetPx: {
    type: "number",
    required: false,
    description: "Padding from the bottom-right edge, in pixels.",
    meta: { constraints: { min: 0, max: 500 } },
  },
  stampSizePct: {
    type: "number",
    required: false,
    description: "Stamp size as a percent of min(W, H).",
    meta: { constraints: { min: 1, max: 50 } },
  },
  mode: {
    type: "string",
    required: false,
    description: "QR adaptation mode.",
    meta: {
      constraints: { oneOf: ["auto", "light", "dark", "transparent"] },
    },
  },
  overallLumaForAuto: {
    type: "number",
    required: false,
    description:
      "Region-average luma (0..255) for auto mode; the CLI free-tier hook fills this from a single ffmpeg signalstats sample.",
    meta: { control: { placeholder: "measured from the frame" }, constraints: { min: 0, max: 255 } },
  },
  autoThreshold: {
    type: "number",
    required: false,
    description: "Threshold; overallLumaForAuto above this → light-bg variant.",
    meta: { constraints: { min: 0, max: 255 } },
  },
  bgOpacity: {
    type: "number",
    required: false,
    description:
      "Opacity of the QR's solid background, 0..1 (default 0.92). Lower = softer sticker.",
    meta: { constraints: { min: 0, max: 1 } },
  },
});

function resolveStillVariant(
  mode: QrStampStillMode,
  overallLumaForAuto: number | undefined,
  autoThreshold: number,
): "light" | "dark" | "transparent" {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  if (mode === "transparent") return "transparent";
  // auto: if a sample exists, use it; otherwise fall back to light
  // deterministically. Light variant (white card + orange modules)
  // matches the majority of user content and reads premium; dark
  // sticker-y look is opt-in via mode: "dark".
  if (typeof overallLumaForAuto === "number") {
    return overallLumaForAuto > autoThreshold ? "light" : "dark";
  }
  return "light";
}

function variantBackgroundColor(
  variant: "light" | "dark" | "transparent",
  bgOpacity: number,
): MosaicColor | undefined {
  if (variant === "transparent") return undefined;
  const base = variant === "dark" ? "#000000" : "#ffffff";
  const clamped = Math.max(0, Math.min(1, bgOpacity));
  if (clamped >= 1) return base as MosaicColor;
  // Encode alpha as the 8-char hex form (#RRGGBBAA) rather than the
  // `<color>@<alpha>` suffix. The engine's color-filter builder appends
  // its own `@0.0` to whatever it receives for the `c=` argument, which
  // turns a `#000000@0.92` input into the malformed `#000000@0.92@0.0`
  // that ffmpeg rejects ("Invalid alpha value specifier"). The 8-char
  // hex form sidesteps that — it's a valid HexColor with no @-suffix,
  // and ffmpeg parses RGBA hex natively.
  const alphaByte = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
  return `${base}${alphaByte}` as MosaicColor;
}

export const QrStampStill = defineMosaicTemplate<QrStampStillProps>({
  id: asTemplateId("@m0saic/brand/qr-stamp/still/v1"),
  label: "QR Brand Attribution — Image",
  version: 1,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the baked brand QR —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description:
    "The official m0saic attribution stamp for IMAGE deliverables — the exact template the free tier runs on every rendered image. Stamps the m0saic QR card (light or dark, picked by a one-shot brightness probe of the corner region) in the bottom-right corner. Exists solely for that hook; to stamp your own media, use QR Stamp.",
  capabilities: { tier: "core" },
  // INTERNAL (2026-07-21): a product surface — the post-render free-tier
  // watermark hook (`@m0saic/product/postRenderWrapper`) stamps every image
  // deliverable through this template (baked brand-QR assets keep image
  // outputs visually consistent with the animated video stamp). Removed from
  // user discovery; direct invocations should pick `QR Stamp — Custom`.
  internal: true,
  tags: ["brand", "qr", "watermark", "free-tier", "still", "internal"],

  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 2000,
    format: { kind: "image", container: "png", pixelFormat: "rgba" },
  },

  propsSchema,
  defaultProps: DEFAULTS,

  async render(
    props: QrStampStillProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    if (!props.imagePath) {
      return makeErrorMosaic(
        "QrStampStill: imagePath prop is required (the base image to stamp).",
        {
          title: "QR Brand Attribution — Image",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }

    const text = props.text ?? DEFAULTS.text;
    const cornerInsetPx = props.cornerInsetPx ?? DEFAULTS.cornerInsetPx;
    const stampSizePct = props.stampSizePct ?? DEFAULTS.stampSizePct;
    const mode: QrStampStillMode = props.mode ?? DEFAULTS.mode;
    const autoThreshold = props.autoThreshold ?? DEFAULTS.autoThreshold;
    const bgOpacity = props.bgOpacity ?? DEFAULTS.bgOpacity;

    const variant = resolveStillVariant(
      mode,
      props.overallLumaForAuto,
      autoThreshold,
    );

    const canvasW = ctx.output.width;
    const canvasH = ctx.output.height;
    const stampSizePx = Math.max(
      64,
      Math.round(Math.min(canvasW, canvasH) * (stampSizePct / 100)),
    );
    const layout = buildCornerStampM0({
      canvasW,
      canvasH,
      stampPx: stampSizePx,
      gutterPx: cornerInsetPx,
      overlayCount: 1,
    });

    // Free-tier path: use the prerendered static PNG (which has the
    // URL strip baked in by tools/build-qr-static-stills.cjs) when
    // the requested text matches the bundled-asset URL AND the user
    // hasn't asked for a transparent QR card (the transparent variant
    // doesn't have a prerendered PNG; it falls back to live-gen).
    const useBundledStatic =
      variant !== "transparent" && FREE_TIER_URL_RE.test(text);

    const baseAssetId = asAssetId("qr_stamp_still_base");

    if (useBundledStatic) {
      // Prerendered branch — single image asset (QR + URL strip)
      // composited at the corner. No nested child doc needed; the
      // PNG already paints the card backdrop, the QR modules, the
      // M logo, AND the URL strip beneath in one shot.
      const qrAssetId = asAssetId(`qr_stamp_still_${variant}`);
      const assets: MosaicAssetManifest = {
        [baseAssetId]: {
          kind: "file",
          path: props.imagePath,
          mediaType: "image",
        },
        [qrAssetId]: {
          kind: "file",
          path: VARIANT_STATIC_PATH[variant],
          mediaType: "image",
        },
      };
      const sources: MosaicSource[] = [
        {
          type: "media",
          mediaType: "image",
          assetId: baseAssetId,
          placement: { fit: "cover" },
        },
        {
          type: "media",
          mediaType: "image",
          assetId: qrAssetId,
          placement: {
            fit: "contain",
            hAlign: "left",
            vAlign: "top",
            inset: { right: layout.insetRight, bottom: layout.insetBottom },
          },
        },
      ];
      return {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String(layout.m0, "QrStampStill"),
        assets,
        sources,
      };
    }

    // ── Live-gen branch: build the QR as a self-contained nested document ──
    // Used when the requested text doesn't match the bundled default
    // (paid-tier custom text) or when the user asked for `mode: "transparent"`.
    // No URL strip — the QR alone, drawn live from the requested text.
    let qr;
    try {
      qr = qrToRenderable({
        text,
        moduleColor: BRAND_ORANGE,
        errorCorrectionLevel: "H",
      });
    } catch (err) {
      return makeErrorMosaic(
        `QrStampStill: ${err instanceof Error ? err.message : String(err)}`,
        {
          title: "QR Brand Attribution — Image",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }

    const qrBackground = variantBackgroundColor(variant, bgOpacity);
    const qrChild: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(String(qr.m0), `QrStampStill-qr-${variant}`),
      sources: qr.sources as MosaicSource[],
      assets: {} as MosaicAssetManifest,
      size: { width: qr.canvasW, height: qr.canvasH },
      ...(qrBackground !== undefined ? { backgroundColor: qrBackground } : {}),
    };

    // ── Parent: base image + QR nested-mosaic source ──
    const assets: MosaicAssetManifest = {
      [baseAssetId]: {
        kind: "file",
        path: props.imagePath,
        mediaType: "image",
      },
    };
    const sources: MosaicSource[] = [
      {
        type: "media",
        mediaType: "image",
        assetId: baseAssetId,
        placement: { fit: "cover" },
      },
      {
        type: "mosaic",
        ref: "qr",
        placement: {
          fit: "contain",
          hAlign: "left",
          vAlign: "top",
          inset: { right: layout.insetRight, bottom: layout.insetBottom },
        },
      },
    ];

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(layout.m0, "QrStampStill"),
      assets,
      sources,
      children: { qr: qrChild },
    };
  },
});

registerTemplate(QrStampStill);
export default QrStampStill;
export { resolveStillVariant };
