/**
 * The brand M as a QR centre — shared by every QR surface that carves one
 * (the QR Code template, the user QR stamp). Lifted verbatim from
 * `media/qr/code/v1/qr-code.ts` on 2026-09-16 so the stamp draws the SAME
 * centre the code does, from the same construction.
 */

import type { MosaicAssetManifest, MosaicColor, MosaicDocument, MosaicSource, MosaicSourceMask } from "@m0saic/types";
import { registry as dictionaryRegistry, getSourceOrderStableKeys } from "@m0saic/dictionary";
import { toM0String } from "@m0saic/dsl-stdlib";
import { makeColorTile, solidBackground } from "@m0saic/template-utils";

/** Brand M dictionary entry (rect-with-masks) — the default centre visual. */
export const BRAND_M_DICT_ID = "brand/m-33";

/**
 * The default centre child: the m0saic M built from `brand/m-33` — colour
 * tiles masked into the M's rect silhouettes (the same construction the
 * attribution stamp carves in, minus its loading-shimmer overlays). Masks
 * are inlined from the dictionary so the emitted document is self-contained.
 * The default 272×272 safe-area cell sits above m-33's 266×266 feasibility
 * floor. Static flatten scales the child INTO the parent canvas, so it
 * needs ~1080px+ output for the scaled cell to stay above the floor;
 * renders are unaffected (the child renders at its declared size).
 */
export function buildBrandMCenterDoc(opts: {
  mColor: MosaicColor;
  /** Card colour behind the M's brick gaps; undefined (transparent mode) leaves them clear. */
  bgColor: MosaicColor | undefined;
  width: number;
  height: number;
  /** The m0 label (`toM0String`) — names the caller in the document. */
  label?: string;
}): MosaicDocument {
  const entry = dictionaryRegistry.byId[BRAND_M_DICT_ID];
  if (!entry) {
    throw new Error(
      `${opts.label ?? "QrCode"}: dictionary entry "${BRAND_M_DICT_ID}" not found; required for the default centre M.`,
    );
  }
  const sourceKeys = getSourceOrderStableKeys(entry);
  const masks = entry.masks ?? {};
  const sources: MosaicSource[] = Array.from({ length: entry.sourceCount }, (_, i) => {
    const m = masks[sourceKeys[i]];
    const mask: MosaicSourceMask | undefined = m
      ? { kind: "inline-mask", localPath: m.localPath, bounds: m.bounds }
      : undefined;
    return makeColorTile(opts.mColor, mask ? { mask } : {});
  });
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(entry.m0, `${opts.label ?? "QrCode"}-centerM`),
    sources,
    assets: {} as MosaicAssetManifest,
    size: { width: opts.width, height: opts.height },
    ...(opts.bgColor !== undefined
      ? { backgroundColor: solidBackground(opts.bgColor) }
      : {}),
  };
}
