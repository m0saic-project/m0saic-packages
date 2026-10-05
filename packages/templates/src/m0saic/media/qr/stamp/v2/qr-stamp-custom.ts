/**
 * @m0saic/media/qr/stamp/v2 — "QR Stamp — Custom"
 *
 * The user-facing registry template that wraps `stampQrOnMedia` from
 * `@m0saic/template-utils`. Drops a QR onto an arbitrary image or
 * video the user supplies — same engine as the auto post-render
 * watermark, but exposed as a discoverable template in the panel.
 *
 * The "Image" / "Video" stamp templates that ship today are bespoke,
 * polished surfaces (still has light/dark pick, video has gleam +
 * adaptive crossfade with custom-tuned timing). This template is the
 * **primitive** — minimal knobs, sensible defaults, works against any
 * input media.
 */

import type {
  LuminanceBucket,
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  RegionPctRect,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import {
  bindProps,
  defineMosaicTemplate,
  definePropsSchema,
  determineMediaType,
  makeErrorMosaic,
  registerTemplate,
  solidBackground,
  stampQrOnMedia,
  styledQrModuleRadius,
  STYLED_QR_DEFAULTS,
  type StampQrAnimation,
  type StampQrLook,
  type StampQrMode,
  type StampQrPosition,
  type StyledQrModuleStyle,
  type PropBindingEntry,
} from "@m0saic/template-utils";
import { withAddHandles } from "../../../../_shared/canvas-handles";
import { markIncomplete, mediaStandInDocument } from "../../../../_shared/stand-in";
import { buildBrandMCenterDoc } from "../../_shared/brandMCenter";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../../_shared/onboarding-cover";

export type QrStampCustomV2Props = {
  /** Path to the image or video you want to brand. Required. */
  mediaPath?: string;
  /** Text encoded into the QR (URL, plain string, or structured payload). */
  text?: string;
  /** Corner placement for the stamp. */
  position?: StampQrPosition;
  /** Stamp size as % of min(canvasW, canvasH). */
  sizePct?: number;
  /** Margin between stamp and corner edges, % of min(canvasW, canvasH). */
  marginPct?: number;
  /** QR card mode — auto probes scene luminance to pick per-scene. */
  mode?: StampQrMode;
  /** Luminance-bucket override for auto mode. Omit to let the template
   *  probe the stamp corner itself via `ctx.analysis`. */
  luminanceBuckets?: LuminanceBucket[];
  /** Entrance animation. */
  animation?: StampQrAnimation;
  /** Module shape — circle dots (the branded default), roundedSquare, or square (the classic matrix). */
  moduleStyle?: StyledQrModuleStyle;
  /** What the carved centre holds: the m0saic M (the branded default), your own asset, or nothing (a plain code). */
  center?: QrStampCenter;
  /** Image or video for `center: "asset"` — contain-fit into the centre safe area. */
  centerAsset?: string;
};

export type QrStampCenter = "m" | "asset" | "off";

const DEFAULTS = {
  text: "https://www.m0saic.io",
  position: "br" as StampQrPosition,
  // The free-tier attribution stamp's size (brand/qr-stamp: qrSizePct 26, a
  // 24 px inset ≈ 2.2 % at 1080p) — one stamp size across the product
  // (founder, 2026-09-16). 26 % is also the scannability floor that stamp
  // moved to: at 18 % a 512² render put ~3.2 px on a module, under the ~4 px
  // practical threshold; and the branded code is a version-6+ carve now.
  sizePct: 26,
  marginPct: 2.2,
  mode: "auto" as StampQrMode,
  animation: "fade-in" as StampQrAnimation,
  // The QR Code template's look (founder, 2026-09-16): the stamp shipped
  // with the plain square matrix and read as a different product's code.
  moduleStyle: "circle" as StyledQrModuleStyle,
  center: "m" as QrStampCenter,
};

/** Child key of the drop slot a stand-in renders under the stamp. */
const STAND_IN_CHILD_KEY = "stand-in";

const propsSchema = definePropsSchema<QrStampCustomV2Props>({
  mediaPath: {
    type: "media",
    required: true,
    meta: { control: { picker: "file", accept: ["image", "video"] } },
  },
  text: {
    type: "string",
    required: false,
    meta: { control: { flavor: "url" } },
  },
  position: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["br", "bl", "tr", "tl"] } },
  },
  sizePct: {
    type: "number",
    required: false,
    meta: { constraints: { min: 1, max: 50 } },
  },
  marginPct: {
    type: "number",
    required: false,
    meta: { constraints: { min: 0, max: 25 } },
  },
  mode: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["light", "dark", "transparent", "auto"] },
    },
  },
  luminanceBuckets: {
    type: "json",
    required: false,
  },
  animation: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["none", "fade-in"] } },
  },
  moduleStyle: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["square", "roundedSquare", "circle"] } },
  },
  center: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["m", "asset", "off"] } },
  },
  centerAsset: {
    type: "media",
    required: false,
    meta: {
      ui: { visibleWhen: { prop: "center", equals: "asset" } },
      control: { picker: "file", accept: ["image", "video"] },
    },
  },
});

/** The caller's centre asset as a child document: one cell, the media contain-fit, its own manifest. */
function assetCenterDoc(assetPath: string, ctx: MosaicEngineContext, cardColor: MosaicColor | undefined): MosaicDocument {
  const assetId = asAssetId("qr_stamp_center");
  const mediaType = determineMediaType(assetPath, ctx);
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "F" as never,
    assets: { [assetId]: { kind: "file", path: assetPath, mediaType } } as MosaicAssetManifest,
    sources: [{ type: "media", mediaType, assetId, placement: { fit: "contain" } } as MosaicSource],
    size: { width: STYLED_QR_DEFAULTS.centerWidth, height: STYLED_QR_DEFAULTS.centerHeight },
    ...(cardColor !== undefined ? { backgroundColor: solidBackground(cardColor) } : {}),
  };
}

/**
 * The stamp's QR look, from its knobs: the QR Code template's radii for the
 * modules and eyes, and the carved centre — the brand M (built per card
 * colour so its brick gaps tone with the card), the caller's own asset, or
 * none.
 */
function stampLook(moduleStyle: StyledQrModuleStyle, center: QrStampCenter, centerAsset: string | undefined, ctx: MosaicEngineContext): StampQrLook {
  const square = moduleStyle === "square";
  const docFor =
    center === "m"
      ? (cardColor: MosaicColor | undefined) =>
          buildBrandMCenterDoc({
            mColor: "#f97316" as never,
            bgColor: cardColor,
            width: STYLED_QR_DEFAULTS.centerWidth,
            height: STYLED_QR_DEFAULTS.centerHeight,
            label: "QrStampCustom",
          })
      : center === "asset" && centerAsset
        ? (cardColor: MosaicColor | undefined) => assetCenterDoc(centerAsset, ctx, cardColor)
        : null;
  return {
    moduleBorderRadius: styledQrModuleRadius(moduleStyle),
    eyeOuterBorderRadius: square ? 0 : STYLED_QR_DEFAULTS.eyeOuterBorderRadius,
    eyeInnerDotBorderRadius: square ? 0 : STYLED_QR_DEFAULTS.eyeInnerDotBorderRadius,
    ...(docFor
      ? {
          center: {
            width: STYLED_QR_DEFAULTS.centerWidth,
            height: STYLED_QR_DEFAULTS.centerHeight,
            paddingPct: STYLED_QR_DEFAULTS.centerPaddingPct,
            docFor,
          },
        }
      : {}),
  };
}

/**
 * Probe the stamp corner's luminance for `mode: "auto"` via
 * `ctx.analysis` (the engine-mediated on-demand probe). Undefined when
 * the host attached no analysis surface (design mode, no toolchain),
 * the media has no probed dims, or the probe fails — auto then
 * degrades to the light card, exactly the pre-probe behavior. A probe
 * must never kill a render.
 */
async function probeStampLuma(
  mediaPath: string,
  position: StampQrPosition,
  sizePct: number,
  marginPct: number,
  ctx: MosaicEngineContext,
): Promise<LuminanceBucket[] | undefined> {
  const analysis = ctx.analysis;
  if (!analysis) return undefined;
  const meta = ctx.media[asAssetId(mediaPath)];
  if (!meta || !(meta.width > 0) || !(meta.height > 0)) return undefined;
  if (meta.kind !== "video" && meta.kind !== "image") return undefined;

  // Stamp rect in OUTPUT canvas px. Naive corner math (side + margin off
  // min(W,H)) — the engine's quantized cell can drift a few px from this,
  // which the 10% over-sampling below absorbs; scene luminance doesn't
  // move at that scale.
  const W = ctx.output.width;
  const H = ctx.output.height;
  const minDim = Math.min(W, H);
  const side = (sizePct / 100) * minDim;
  const margin = (marginPct / 100) * minDim;
  const x = position === "br" || position === "tr" ? W - margin - side : margin;
  const y = position === "br" || position === "bl" ? H - margin - side : margin;

  // The base media is cover-fit into the canvas, but the probe samples
  // the input FILE — map the canvas-space rect through the centered
  // cover crop into the media's own pixel space.
  const s = Math.max(W / meta.width, H / meta.height);
  const cropX = (meta.width - W / s) / 2;
  const cropY = (meta.height - H / s) / 2;
  const rx = cropX + x / s;
  const ry = cropY + y / s;
  const rSide = side / s;

  // 10% total over-sampling per axis (same rationale as the watermark
  // probe): content just outside the card bleeds under it during fades.
  const xPct = Math.max(0, (rx - 0.05 * rSide) / meta.width);
  const yPct = Math.max(0, (ry - 0.05 * rSide) / meta.height);
  const region: RegionPctRect = {
    xPct,
    yPct,
    wPct: Math.min(1 - xPct, (1.1 * rSide) / meta.width),
    hPct: Math.min(1 - yPct, (1.1 * rSide) / meta.height),
  };
  try {
    const r = await analysis.regionLuminance(mediaPath, region, {
      bucketMs: 500,
      smoothingMs: meta.kind === "video" ? 1500 : 500,
    });
    return r.buckets.length > 0 ? r.buckets : undefined;
  } catch {
    return undefined;
  }
}

export const QrStampCustomV2 = defineMosaicTemplate<QrStampCustomV2Props>({
  id: asTemplateId("@m0saic/media/qr/stamp/v2"),
  version: 2,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the QR module grid —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  capabilities: {
    tier: "capability",
    caps: { fs: { read: true, write: true, temp: true } },
  },

  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
    format: { kind: "video", container: "mp4" },
    // After the stamp's entrance fade.
    posterTimeMs: 1500,
  },

  propsSchema,
  bindings: {
    unbound: {
      luminanceBuckets: "luminance override (programmatic; auto mode probes the footage itself)",
      centerAsset: "centre = asset (the stamp carries it then)",
    },
  },
  defaultProps: DEFAULTS,

  async render(
    props: QrStampCustomV2Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const text = props.text ?? DEFAULTS.text;
    const position = props.position ?? DEFAULTS.position;
    const sizePctRaw = props.sizePct ?? DEFAULTS.sizePct;
    const marginPctRaw = props.marginPct ?? DEFAULTS.marginPct;
    const mode = props.mode ?? DEFAULTS.mode;
    const animation = props.animation ?? DEFAULTS.animation;
    const moduleStyle = props.moduleStyle ?? DEFAULTS.moduleStyle;
    const center = props.center ?? DEFAULTS.center;
    const centerAsset = props.centerAsset?.trim() || undefined;
    if (center === "asset" && !centerAsset) {
      return makeErrorMosaic(
        "QrStampCustom: Centre is 'asset' but no centre asset was given — pick an image or video, or switch Centre to 'm' / 'off'.",
        { title: "QR Stamp", width: ctx.target.width, height: ctx.target.height },
      );
    }

    // v2: THE SLOT BEFORE THE FOOTAGE. No media yet → the real stamp, where
    // it will sit, over a drop slot (v1: a "mediaPath is required" error card
    // — no rect, so nothing on the canvas could take the file). The slot is a
    // nested child; the root source that refs it is the drop target and
    // carries the `incomplete` marker hosts read.
    const mediaPath = props.mediaPath?.trim() || undefined;
    const slotDoc = mediaPath
      ? undefined
      : mediaStandInDocument({
          width: ctx.output.width,
          height: ctx.output.height,
          name: "QR Stamp",
          title: "Drop an image or video here",
          hint: "It comes back with this QR in its corner.",
          handles: [{ propKey: "mediaPath" }],
          fps: ctx.target.fps,
          durationMs: ctx.target.durationMs,
          nested: true,
        });

    const mediaType = mediaPath ? determineMediaType(mediaPath, ctx) : "image";
    const baseAssetId = asAssetId("qr_stamp_custom_base");
    const baseAssets: MosaicAssetManifest = mediaPath
      ? {
          [baseAssetId]: {
            kind: "file",
            path: mediaPath,
            mediaType,
          },
        }
      : ({} as MosaicAssetManifest);
    // The base is the handle for the media itself: a drop on it swaps the file.
    const baseSource: MosaicSource = mediaPath
      ? bindProps(
          {
            type: "media",
            mediaType,
            assetId: baseAssetId,
            placement: { fit: "cover" },
          } as MosaicSource,
          [{ propKey: "mediaPath" }],
        )
      : markIncomplete(
          bindProps({ type: "mosaic", ref: STAND_IN_CHILD_KEY } as MosaicSource, [{ propKey: "mediaPath" }]),
          "QR Stamp: drop the image or video to stamp",
        );
    // Build the minimal "base doc" that stampQrOnMedia composes around:
    // a single F tile carrying the user media at cover-fit.
    const baseDoc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      // Bare "F" — stampQrOnMedia wraps this as its outer base layer.
      m0: "F" as MosaicDocument["m0"],
      sources: [baseSource],
      assets: baseAssets,
      size: { width: ctx.output.width, height: ctx.output.height },
    };

    // Auto mode pulls its own luma evidence (lazily — only when needed
    // and not overridden by the prop). Everything else must skip the
    // probe entirely. (A stand-in has no footage to probe: auto falls back
    // to the light card, as a design preview does.)
    const luminanceBuckets =
      props.luminanceBuckets ??
      (mode === "auto" && mediaPath
        ? await probeStampLuma(mediaPath, position, sizePctRaw, marginPctRaw, ctx)
        : undefined);

    let stamped: MosaicDocument;
    try {
      stamped = stampQrOnMedia({
        baseDoc,
        text,
        position,
        sizePct: sizePctRaw / 100,
        marginPct: marginPctRaw / 100,
        // A stand-in has no footage to adapt to: "auto" would stack a light
        // and a dark card to cross-fade between on evidence that does not
        // exist — draw the one card auto falls back to.
        mode: !mediaPath && mode === "auto" ? "light" : mode,
        ...(luminanceBuckets ? { luminanceBuckets } : {}),
        animation,
        qr: stampLook(moduleStyle, center, centerAsset, ctx),
        canvasW: ctx.output.width,
        canvasH: ctx.output.height,
      });
    } catch (err) {
      return makeErrorMosaic(
        `QrStampCustom: ${err instanceof Error ? err.message : String(err)}`,
        {
          title: "QR Stamp",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }
    // The QR is ONE `mosaic` rect per variant on the parent (the module grid
    // lives inside the child) — bind that rect to `text` so Make's
    // double-click on the code edits the encoded URL (v1's binding), then the
    // stamp's own geometry (v2): its size and its margin — and the centre
    // asset when the centre is one. Modules stay unbound.
    const stampHandles: PropBindingEntry[] = [
      { propKey: "text" },
      { propKey: "sizePct" },
      { propKey: "marginPct" },
      ...(center === "asset" ? [{ propKey: "centerAsset" }] : []),
    ];
    for (const src of stamped.sources ?? []) {
      if (src === baseSource) continue;
      if (src.type === "mosaic") withAddHandles(src, stampHandles);
    }
    if (!slotDoc) return stamped;
    return {
      ...stamped,
      children: { ...((stamped as { children?: Record<string, MosaicDocument> }).children ?? {}), [STAND_IN_CHILD_KEY]: slotDoc },
      backgroundColor: slotDoc.backgroundColor,
      audio: { mode: "off" },
    } as MosaicDocument;
  },
});

// Editor-only first-open cover — the template previously had NONE, so the
// default open rendered the mediaPath-required error card. The mosaic-
// branding BAND instead: a REAL film still (Big Buck Bunny, bundled) with
// the template's own corner stamp card composed on it via stampQrOnMedia
// (mode "light", animation "none" — deterministic, no luma probe).
QrStampCustomV2.renderCover = async function renderCover(
  _props: QrStampCustomV2Props,
  ctx: MosaicEngineContext,
): Promise<MosaicDocument> {
  const heroBox = brandedCoverHeroBox(ctx, "band");
  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  const unpackedAsar = (p: string) =>
    p.includes("/app.asar/")
      ? p.split("/app.asar/").join("/app.asar.unpacked/")
      : p.split("\\app.asar\\").join("\\app.asar.unpacked\\");
  const baseAssetId = asAssetId("qr-stamp-cover-frame");
  const heroAssets: MosaicAssetManifest = (isNode
    ? {
        [baseAssetId]: {
          kind: "file",
          path: unpackedAsar(`${__dirname}/../v1/assets/cover-frame.jpg`),
          mediaType: "image",
        },
      }
    : {}) as MosaicAssetManifest;
  const baseDoc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: "F" as MosaicDocument["m0"],
    sources: [
      isNode
        ? ({
            type: "media",
            mediaType: "image",
            assetId: baseAssetId,
            placement: { fit: "cover" },
          } as MosaicSource)
        : ({ type: "lavfi", color: "#21262d" } as unknown as MosaicSource),
    ],
    assets: heroAssets,
    size: { width: heroBox.width, height: heroBox.height },
  };
  const stamped = stampQrOnMedia({
    baseDoc,
    text: DEFAULTS.text,
    position: DEFAULTS.position,
    sizePct: DEFAULTS.sizePct / 100,
    marginPct: DEFAULTS.marginPct / 100,
    mode: "light",
    animation: "none",
    canvasW: heroBox.width,
    canvasH: heroBox.height,
  });

  return buildBrandedCover({
    ctx,
    variant: "band",
    copy: { productName: "QR Stamp", title: "A scannable corner stamp on your media." },
    hero: (theme) => onboardingFrame(inlineHeroDoc(stamped), theme.borderStrong),
    heroAssets: { ...heroAssets, ...(stamped.assets ?? {}) } as MosaicAssetManifest,
    children: (stamped as { children?: Record<string, MosaicDocument> }).children,
  });
};

registerTemplate(QrStampCustomV2);
export default QrStampCustomV2;
