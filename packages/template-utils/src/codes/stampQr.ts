/**
 * `stampQrOnMedia` — reusable composer that brands a base mosaic
 * document with a corner QR stamp.
 *
 * The plain-English contract: "take this document (already a video or
 * image), drop a QR in the corner — pick a card colour smartly so it
 * tones with the underlying brightness, fade it in cleanly." That's
 * the same surface the free-tier post-render wrapper has run forever,
 * but exposed as a callable function instead of a template-only path.
 *
 * Two consumers (Phase 3 of the QR e2e):
 *   1. `QrStampCustom` registry template — wraps this with UI-friendly
 *      props so users can pick it from the templates panel.
 *   2. Programmatic external callers — anything that already has a
 *      `MosaicDocument` it wants to brand.
 *
 * # What it does
 *
 * Given a `baseDoc` whose m0 fills the canvas:
 *   - Wraps the base with `buildCornerStampM0` so a corner cell is
 *     reserved for the stamp.
 *   - Builds one or two in-house QR variants (`qrToRenderable`) per
 *     the resolved mode (light / dark / both for auto).
 *   - Each variant becomes a child `MosaicDocument` referenced by a
 *     `type: "mosaic"` source on the parent. No PNG raster.
 *   - Adaptive crossfade (auto mode) drives variant alpha via
 *     `buildAdaptiveAlphaExpr` consuming `luminanceBuckets`.
 *   - Optional entrance fade adds a `buildEntranceExpr` factor.
 *
 * # What it intentionally does NOT do (vs. `qr-stamp/video/v1`)
 *
 *   - No gleam shine — the polished video-stamp surface keeps that.
 *     This helper is the plain "drop a QR onto media" primitive.
 *   - No `bgOpacity` (background alpha suffix) — pass that via the
 *     wrapping template's `mode` mapping if needed; here we keep the
 *     surface tight.
 *
 * Pure(-ish): no I/O. The single side-effect surface is the renderer
 * that eventually consumes the returned document — `stampQrOnMedia`
 * itself just composes objects.
 */

import type {
  LuminanceBucket,
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicSource,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { qrToRenderable } from "./qrToRenderable";
import { buildStyledQrDoc, type StyledQrCenter } from "./styledQr";
import {
  buildAdaptiveAlphaExpr,
  buildCornerStampM0,
  buildEntranceExpr,
  composeAlpha,
} from "./qrStampExpressions";

const BRAND_ORANGE: MosaicColor = "#f97316";

export type StampQrPosition = "br" | "bl" | "tr" | "tl";
export type StampQrMode = "light" | "dark" | "transparent" | "auto";

export type StampQrAnimation = "none" | "fade-in";

/**
 * The stamp's QR look. Omitted = the plain matrix (square modules, square
 * eyes, no centre — the shape every programmatic caller has had). Set it to
 * draw the branded code the QR Code template draws: rounded modules, the
 * three-layer rounded eyes, and an optional carved centre. The centre is
 * a factory because the card colour differs per variant (light / dark /
 * transparent) and the centre must tone with it.
 */
export type StampQrLook = {
  /** Module corner radius (0..1). 1 = circle dots. */
  moduleBorderRadius?: number;
  /** Outer eye corner radius (0..1). */
  eyeOuterBorderRadius?: number;
  /** Inner eye dot corner radius (0..1). */
  eyeInnerDotBorderRadius?: number;
  /** Carved centre: its size + the document for a given card colour (undefined = transparent card). */
  center?: Omit<StyledQrCenter, "doc"> & { docFor: (cardColor: MosaicColor | undefined) => MosaicDocument };
};

export type StampQrOptions = {
  /**
   * The base document that gets branded. Its m0 should fill the
   * canvas — the helper wraps it with `F{<corner-cell>}` so its
   * single outer F is the base layer.
   */
  baseDoc: MosaicDocument;
  /** Text to encode into the QR (URL, plain string, structured payload, etc.). */
  text: string;
  /**
   * Corner to place the stamp in. Currently `"br"` is the only
   * positioned mode actually realized in m0 layout (matches the
   * existing video stamp). Other corners reserved for future
   * generalization; pass them today and they'll fall back to `"br"`.
   */
  position?: StampQrPosition;
  /** Stamp size as a fraction of `min(canvasW, canvasH)`. Default 0.18. */
  sizePct?: number;
  /** Margin between stamp and corner edges, fraction of `min(canvasW, canvasH)`. Default 0.022. */
  marginPct?: number;
  /**
   * QR card mode. `"auto"` uses `luminanceBuckets` to pick light vs
   * dark per scene; `"transparent"` skips the card entirely.
   */
  mode?: StampQrMode;
  /**
   * Pre-computed luminance buckets for `mode: "auto"`. Required when
   * mode === "auto"; ignored otherwise. The CLI free-tier hook fills
   * this from `probeRegionLuminance` over the bottom-right region.
   */
  luminanceBuckets?: LuminanceBucket[];
  /** Auto-mode adaptive band low end (luma 0..255). */
  adaptiveLowLuma?: number;
  /** Auto-mode adaptive band high end (luma 0..255). */
  adaptiveHighLuma?: number;
  /** Smoothstep crossfade duration in ms at scene boundaries (auto mode). */
  crossfadeDurMs?: number;
  /** Optional entrance animation for the stamp. Default `"fade-in"`. */
  animation?: StampQrAnimation;
  /** The QR look. Omitted = the plain matrix (see {@link StampQrLook}). */
  qr?: StampQrLook;
  /** Entrance duration in ms (when `animation === "fade-in"`). Default 400. */
  entranceDurMs?: number;
  /**
   * Output canvas dims used to size the corner cell. When omitted,
   * defaults to `baseDoc.size` if set, else 1920×1080. Pass these
   * when the caller knows the target render dims (typical: the
   * engine context's `ctx.output`).
   */
  canvasW?: number;
  canvasH?: number;
};

const DEFAULTS = {
  position: "br" as StampQrPosition,
  sizePct: 0.18,
  marginPct: 0.022,
  mode: "auto" as StampQrMode,
  adaptiveLowLuma: 100,
  adaptiveHighLuma: 156,
  crossfadeDurMs: 400,
  animation: "fade-in" as StampQrAnimation,
  entranceDurMs: 400,
  canvasW: 1920,
  canvasH: 1080,
};

function variantsForMode(
  mode: StampQrMode,
): Array<"light" | "dark" | "transparent"> {
  if (mode === "auto") return ["light", "dark"];
  if (mode === "light") return ["light"];
  if (mode === "dark") return ["dark"];
  return ["transparent"];
}

function backgroundFor(
  variant: "light" | "dark" | "transparent",
): MosaicColor | undefined {
  if (variant === "transparent") return undefined;
  return variant === "dark" ? "#000000" : "#ffffff";
}

/**
 * Compose a corner QR stamp onto `baseDoc`. Returns a new
 * `MosaicDocument` — `baseDoc` is left untouched (the helper does not
 * mutate inputs). The returned doc carries the original base's m0 as
 * its outer `F` slot, plus one nested-mosaic child per QR variant.
 *
 * Source order in the returned doc:
 *   [0]       = baseDoc collapsed into a single media/lavfi source
 *               (preserved verbatim from `baseDoc.sources` when possible)
 *   [1..N]    = one `type: "mosaic"` source per QR variant, each
 *               referencing a child registered in `doc.children`.
 */
export function stampQrOnMedia(opts: StampQrOptions): MosaicDocument {
  if (!opts.baseDoc) {
    throw new Error("stampQrOnMedia: `baseDoc` is required");
  }
  if (!opts.text || !opts.text.trim()) {
    throw new Error("stampQrOnMedia: `text` is required (non-empty string)");
  }

  const canvasW = opts.canvasW ?? opts.baseDoc.size?.width ?? DEFAULTS.canvasW;
  const canvasH = opts.canvasH ?? opts.baseDoc.size?.height ?? DEFAULTS.canvasH;
  const sizePct = opts.sizePct ?? DEFAULTS.sizePct;
  const marginPct = opts.marginPct ?? DEFAULTS.marginPct;
  const mode = opts.mode ?? DEFAULTS.mode;
  const luminanceBuckets = opts.luminanceBuckets ?? [];
  const adaptiveLowLuma = opts.adaptiveLowLuma ?? DEFAULTS.adaptiveLowLuma;
  const adaptiveHighLuma = opts.adaptiveHighLuma ?? DEFAULTS.adaptiveHighLuma;
  const crossfadeDurMs = opts.crossfadeDurMs ?? DEFAULTS.crossfadeDurMs;
  const animation = opts.animation ?? DEFAULTS.animation;
  const entranceDurMs = opts.entranceDurMs ?? DEFAULTS.entranceDurMs;

  const stampPx = Math.max(
    64,
    Math.round(Math.min(canvasW, canvasH) * sizePct),
  );
  const gutterPx = Math.max(
    0,
    Math.round(Math.min(canvasW, canvasH) * marginPct),
  );

  const variants = variantsForMode(mode);
  const layout = buildCornerStampM0({
    canvasW,
    canvasH,
    stampPx,
    gutterPx,
    overlayCount: variants.length,
    corner: opts.position ?? DEFAULTS.position,
  });

  // The base doc's outer F is its existing m0; we re-host its source
  // array as our sources[0]. For simple base docs (m0 === "1" or "F"
  // with a single source), this works as-is. For richer base docs
  // we'd need flatten/nest semantics — but the typical caller passes a
  // single-tile doc (image / video / pre-rendered mosaic).
  const baseSources = opts.baseDoc.sources ?? [];
  if (baseSources.length === 0) {
    throw new Error("stampQrOnMedia: `baseDoc.sources` must be non-empty");
  }
  const baseSource = baseSources[0];

  const sources: MosaicSource[] = [baseSource];
  const children: Record<string, MosaicDocument> = {};
  const assets: MosaicAssetManifest = { ...(opts.baseDoc.assets ?? {}) };

  for (const v of variants) {
    const childKey = `qr_stamp_${v}`;
    const bgColor = backgroundFor(v);
    if (opts.qr) {
      // The branded look — the same construction as the QR Code template.
      const look = opts.qr;
      const styled = buildStyledQrDoc({
        text: opts.text,
        moduleColor: BRAND_ORANGE,
        backgroundColor: bgColor,
        moduleBorderRadius: look.moduleBorderRadius,
        eyeOuterBorderRadius: look.eyeOuterBorderRadius,
        eyeInnerDotBorderRadius: look.eyeInnerDotBorderRadius,
        ...(look.center
          ? { center: { width: look.center.width, height: look.center.height, paddingPct: look.center.paddingPct, doc: look.center.docFor(bgColor) } }
          : {}),
        label: `stampQrOnMedia-${v}`,
      });
      children[childKey] = styled.doc;
    } else {
      const qr = qrToRenderable({
        text: opts.text,
        moduleColor: BRAND_ORANGE,
        errorCorrectionLevel: "H",
      });
      children[childKey] = {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String(String(qr.m0), `stampQrOnMedia-${v}`),
        sources: qr.sources as MosaicSource[],
        assets: {} as MosaicAssetManifest,
        size: { width: qr.canvasW, height: qr.canvasH },
        ...(bgColor !== undefined ? { backgroundColor: bgColor } : {}),
      };
    }

    const alphaFactors: string[] = [];
    if (mode === "auto" && (v === "light" || v === "dark")) {
      alphaFactors.push(
        buildAdaptiveAlphaExpr(
          luminanceBuckets,
          v,
          adaptiveLowLuma,
          adaptiveHighLuma,
          crossfadeDurMs / 1000,
        ),
      );
    }
    if (animation === "fade-in") {
      alphaFactors.push(buildEntranceExpr(0, entranceDurMs / 1000));
    }
    const alphaExpr =
      alphaFactors.length > 0 ? composeAlpha(...alphaFactors) : undefined;

    sources.push({
      type: "mosaic",
      ref: childKey,
      // Corner-aware: byte-identical to the old literal for "br".
      placement: { fit: "contain", ...layout.contentPlacement },
      ...(alphaExpr ? { overlay: { alpha: alphaExpr } } : {}),
    });
  }

  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(layout.m0, "stampQrOnMedia"),
    sources,
    assets,
    children,
    size: { width: canvasW, height: canvasH },
  };
}
