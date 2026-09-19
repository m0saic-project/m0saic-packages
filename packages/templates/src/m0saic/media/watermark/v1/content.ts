/**
 * Watermark artwork child-document builders.
 *
 * Each builder returns a self-contained, hermetic `MosaicDocument`
 * sized to the stamp rect (children MUST declare `size` — a size-less
 * nested child renders at parent tile size and stretches). The child
 * renders at exactly the cell size, so no oversized raster work.
 */

import type { MosaicAssetManifest, MosaicColor, MosaicDocument, MosaicSource } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { placeRects, toM0String } from "@m0saic/dsl-stdlib";
import { measureText } from "@m0saic/template-utils";
import {
  LOCKUP_GAP,
  LOCKUP_LOGO_BAND,
  LOCKUP_TEXT_BAND,
  LOCKUP_TEXT_TO_LOGO,
  REF_FONT_PX,
  TEXT_WIDTH_PAD,
  type LockupLayout,
} from "./geometry";

/** Logo child: the user's image at contain-fit on a transparent canvas. */
export function buildLogoChild(opts: { logoPath: string; w: number; h: number }): MosaicDocument {
  const { logoPath, w, h } = opts;
  const logoAssetId = asAssetId("wm_logo");
  const assets: MosaicAssetManifest = {
    [logoAssetId]: { kind: "file", path: logoPath, mediaType: "image" },
  } as MosaicAssetManifest;
  const sources: MosaicSource[] = [
    {
      type: "media",
      mediaType: "image",
      assetId: logoAssetId,
      placement: { fit: "contain" },
      editor: { owner: "template", label: "wm:logo" },
    },
  ];
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "F" as MosaicDocument["m0"],
    sources,
    assets,
    size: { width: w, height: h },
  };
}

/**
 * SVG-glyph text source, font fit-to-box: measured at
 * {@link REF_FONT_PX} and scaled so the padded width and block height
 * both fit the (w, h) box. Deterministic bundled font, no drawtext
 * spawn (W5). Shared by the text child and the lockup child.
 */
export function makeSvgTextSource(opts: {
  text: string;
  color: MosaicColor;
  w: number;
  h: number;
}): MosaicSource {
  const { text, color, w, h } = opts;
  const m = measureText(text, { fontSize: REF_FONT_PX });
  if (!(m.width > 0) || !(m.height > 0)) {
    throw new Error("Watermark text measures to an empty box — provide non-empty text.");
  }
  const scale = Math.min(w / (m.width * TEXT_WIDTH_PAD), h / m.height);
  const fontSize = Math.max(4, Math.floor(REF_FONT_PX * scale));
  return {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    layers: [
      {
        content: { kind: "literal", text },
        style: { fontSize, fontColor: color },
        // placement defaults center the block (hAlign "center", vAlign "middle")
      },
    ],
    editor: { owner: "template", label: "wm:text" },
  };
}

/**
 * Text child: the wordmark as SVG glyph outlines on a transparent
 * canvas.
 */
export function buildTextChild(opts: {
  text: string;
  color: MosaicColor;
  w: number;
  h: number;
}): MosaicDocument {
  const { text, color, w, h } = opts;
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "F" as MosaicDocument["m0"],
    sources: [makeSvgTextSource({ text, color, w, h })],
    assets: {} as MosaicAssetManifest,
    size: { width: w, height: h },
  };
}

// ── Lockup (logo + wordmark) ──────────────────────────────────

/**
 * Lockup child: logo + wordmark in one transparent canvas.
 * `text-right`: logo at full height, text at {@link LOCKUP_TEXT_TO_LOGO}
 * of it, vertically centered after a {@link LOCKUP_GAP} gap.
 * `text-below`: logo in the top {@link LOCKUP_LOGO_BAND} band, text in
 * the bottom {@link LOCKUP_TEXT_BAND} band, both horizontally centered.
 * Contain-fit + fit-to-box text absorb the integer rounding.
 */
export function buildLockupChild(opts: {
  logoPath: string;
  logoAspect: number;
  text: string;
  textAspect: number;
  color: MosaicColor;
  layout: LockupLayout;
  w: number;
  h: number;
}): MosaicDocument {
  const { logoPath, logoAspect, text, textAspect, color, layout, w, h } = opts;
  if (!(w > 0) || !(h > 0)) {
    throw new Error(`buildLockupChild: dims must be positive, got ${w}x${h}`);
  }

  let logoRect: { x: number; y: number; w: number; h: number };
  let textRect: { x: number; y: number; w: number; h: number };
  if (layout === "text-below") {
    const logoH = clampInt(Math.round(h * LOCKUP_LOGO_BAND), 1, h);
    const logoW = clampInt(Math.round(logoH * logoAspect), 1, w);
    const textH = clampInt(Math.round(h * LOCKUP_TEXT_BAND), 1, h - logoH || 1);
    const textW = clampInt(Math.round(textH * textAspect), 1, w);
    logoRect = { x: Math.floor((w - logoW) / 2), y: 0, w: logoW, h: logoH };
    textRect = { x: Math.floor((w - textW) / 2), y: h - textH, w: textW, h: textH };
  } else {
    const logoW = clampInt(Math.round(h * logoAspect), 1, w);
    const gap = Math.round(h * LOCKUP_GAP);
    const textH = clampInt(Math.round(h * LOCKUP_TEXT_TO_LOGO), 1, h);
    const textW = clampInt(Math.round(textH * textAspect), 1, Math.max(1, w - logoW - gap));
    logoRect = { x: 0, y: 0, w: logoW, h };
    textRect = {
      x: Math.min(logoW + gap, w - textW),
      y: Math.floor((h - textH) / 2),
      w: textW,
      h: textH,
    };
  }

  const placed = placeRects({
    rootW: w,
    rootH: h,
    rects: [logoRect, textRect].map((r) => ({ ...r, claimant: "F" })),
  });

  const logoAssetId = asAssetId("wm_logo");
  const pieces: MosaicSource[] = [
    {
      type: "media",
      mediaType: "image",
      assetId: logoAssetId,
      placement: { fit: "contain" },
      editor: { owner: "template", label: "wm:logo" },
    },
    makeSvgTextSource({ text, color, w: textRect.w, h: textRect.h }),
  ];
  const rects = [logoRect, textRect];
  const sources: MosaicSource[] = [];
  for (const layer of placed.layers) {
    const ordered = [...layer.rectIndices].sort(
      (a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x,
    );
    for (const idx of ordered) sources.push(pieces[idx]);
  }

  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(String(placed.m0), "WatermarkLockup"),
    sources,
    assets: {
      [logoAssetId]: { kind: "file", path: logoPath, mediaType: "image" },
    } as MosaicAssetManifest,
    size: { width: w, height: h },
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
