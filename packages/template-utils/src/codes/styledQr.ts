/**
 * `buildStyledQrDoc` — the branded QR as one document: rounded data modules,
 * the three-layer rounded finder eyes, and an optional carved centre that
 * a caller-supplied child fills (the brand M, a logo, a clip).
 *
 * This is the QR Code template's styled path (`media/qr/code/v1`) lifted
 * into the shared layer so every QR surface — the standalone code, the user
 * QR stamp, anything that composes a QR into a bigger document — draws the
 * SAME look from the same construction, instead of each re-deriving it and
 * drifting (the stamp shipped with square modules and square eyes for
 * exactly that reason; founder, 2026-09-16: "make it look like the QR Code
 * template").
 *
 * Pure: no dictionary, no files. The centre is passed in as a finished
 * document so this layer never needs `@m0saic/dictionary` (public packages
 * must not pull the brand entries in through template-utils).
 */

import type { MosaicAssetManifest, MosaicColor, MosaicDocument, MosaicSource } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { makeColorTile } from "../sources/makeColorTile";
import { solidBackground } from "../sources/solidBackground";
import { qrToRenderable } from "./qrToRenderable";

/** Min version forced when a centre is carved (ECC H headroom after the cut). */
export const STYLED_QR_CUTOUT_MIN_VERSION = 6;
/** The key the centre child is registered under in the returned document. */
export const STYLED_QR_CENTER_KEY = "center";

/** The branded defaults — the QR Code template's, verbatim. */
export const STYLED_QR_DEFAULTS = {
  moduleBorderRadius: 1.0,
  eyeOuterBorderRadius: 0.3,
  eyeInnerDotBorderRadius: 0.5,
  centerWidth: 272,
  centerHeight: 272,
  centerPaddingPct: 8,
} as const;

export type StyledQrModuleStyle = "square" | "roundedSquare" | "circle";

/** The module corner radius a named style means (0..1 of the cell). */
export function styledQrModuleRadius(style: StyledQrModuleStyle): number {
  if (style === "circle") return 1.0;
  if (style === "roundedSquare") return 0.3;
  return 0;
}

export type StyledQrCenter = {
  /** Safe-area size in QR canvas pixels. */
  width: number;
  height: number;
  /** Padding between modules and the centre frame, % of the larger dimension. */
  paddingPct?: number;
  /** The document that fills the safe area (contain-fit). */
  doc: MosaicDocument;
};

export type StyledQrOptions = {
  text: string;
  moduleColor: MosaicColor;
  /**
   * The card colour. Omit for a transparent code (the eyes' light ring
   * then paints `eyeBackground`, which defaults to white).
   */
  backgroundColor?: MosaicColor;
  /** Used for the eyes' light ring when `backgroundColor` is omitted. */
  eyeBackground?: MosaicColor;
  /** Module corner radius (0..1). Default 1 (circle). */
  moduleBorderRadius?: number;
  /** Outer eye corner radius (0..1). Default 0.3. */
  eyeOuterBorderRadius?: number;
  /** Inner eye dot corner radius (0..1). Default 0.5 (circle). */
  eyeInnerDotBorderRadius?: number;
  /** Carved centre. Forces version ≥ 6. */
  center?: StyledQrCenter;
  /** Force a QR version (1–40); a centre floors it at 6. */
  version?: number;
  /** ECC level. Default "H" (the branded surfaces all carve or round). */
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  /** The m0 label stamped on the document (`toM0String`). */
  label?: string;
};

export type StyledQrDoc = {
  doc: MosaicDocument;
  canvasW: number;
  canvasH: number;
  /** How many leading sources are data modules (then the eye block, then the centre splice). */
  dataCellEnd: number;
};

/**
 * Build the styled QR document. Source order, as `qrToRenderable` lays it
 * out: `[0..dataCellEnd)` data modules (re-styled with the module radius),
 * then three pre-styled eye layers per finder, then — with a centre — the
 * safe-area splice, which becomes a `type: "mosaic"` reference to the
 * centre child. Throws on an unencodable payload (fail fast; callers wrap
 * in their own error mosaic).
 */
export function buildStyledQrDoc(o: StyledQrOptions): StyledQrDoc {
  const moduleBorderRadius = o.moduleBorderRadius ?? STYLED_QR_DEFAULTS.moduleBorderRadius;
  const eyeOuterBorderRadius = o.eyeOuterBorderRadius ?? STYLED_QR_DEFAULTS.eyeOuterBorderRadius;
  const eyeInnerDotBorderRadius = o.eyeInnerDotBorderRadius ?? STYLED_QR_DEFAULTS.eyeInnerDotBorderRadius;
  const hasCenter = !!o.center;
  const resolvedVersion =
    o.version && o.version > 0 ? o.version : hasCenter ? STYLED_QR_CUTOUT_MIN_VERSION : undefined;
  // The eyes channel needs a concrete colour for its light layers even on a
  // transparent card.
  const eyeBackground: MosaicColor = o.backgroundColor ?? o.eyeBackground ?? ("#ffffff" as MosaicColor);

  const qr = qrToRenderable({
    text: o.text,
    moduleColor: o.moduleColor,
    errorCorrectionLevel: o.errorCorrectionLevel ?? "H",
    backgroundColor: eyeBackground,
    eyes: {
      darkColor: o.moduleColor,
      outerBorderRadius: eyeOuterBorderRadius,
      innerLightBorderRadius: eyeOuterBorderRadius,
      innerDotBorderRadius: eyeInnerDotBorderRadius,
    },
    ...(resolvedVersion ? { version: resolvedVersion } : {}),
    ...(o.center
      ? {
          safeArea: {
            width: o.center.width,
            height: o.center.height,
            paddingPct: o.center.paddingPct ?? STYLED_QR_DEFAULTS.centerPaddingPct,
          },
        }
      : {}),
  });
  if (qr.sources.length === 0) {
    throw new Error("buildStyledQrDoc: composed QR has no renderable frames.");
  }

  const eyeBlockCount = (qr.channelByRole.eyes?.frames.length ?? 0) * 3;
  const safeAreaCount = hasCenter && qr.safeAreaStableKey ? 1 : 0;
  const dataCellEnd = qr.sources.length - eyeBlockCount - safeAreaCount;

  const sources: MosaicSource[] = qr.sources.map((src, i) => {
    if (i < dataCellEnd) {
      return makeColorTile(o.moduleColor, {
        effects: { rounding: { borderRadius: moduleBorderRadius, cornerStyle: "rounded" } },
      });
    }
    if (i >= qr.sources.length - safeAreaCount) {
      return { type: "mosaic", ref: STYLED_QR_CENTER_KEY, placement: { fit: "contain" } } satisfies MosaicSource;
    }
    return src as MosaicSource;
  });

  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(String(qr.m0), o.label ?? "StyledQr"),
    sources,
    assets: {} as MosaicAssetManifest,
    ...(o.center && safeAreaCount ? { children: { [STYLED_QR_CENTER_KEY]: o.center.doc } } : {}),
    size: { width: qr.canvasW, height: qr.canvasH },
    // `solidBackground` keeps the card opaque on alpha outputs (a plain hex
    // is transparent in a nested render — the engine's bgFill rule).
    ...(o.backgroundColor !== undefined ? { backgroundColor: solidBackground(o.backgroundColor) } : {}),
  };
  return { doc, canvasW: qr.canvasW, canvasH: qr.canvasH, dataCellEnd };
}
