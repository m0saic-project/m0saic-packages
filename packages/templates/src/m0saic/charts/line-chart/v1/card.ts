/**
 * ============================================================================
 * @m0saic/charts/line-chart — card base builder (the 3 background modes)
 * ============================================================================
 *
 * Builds the outermost surface source + any assets it needs:
 *   - "none"  → transparent (composites under whatever is below)
 *   - "solid"/"preset" → rounded color card + inner stroke
 *   - "image" → image surface (data-uri / file path) + rounding + stroke
 *
 * Pure builder (no template registration) — the public template stacks the
 * returned source as the base layer and merges the returned assets.
 * ============================================================================
 */

import { asAssetId } from "@m0saic/types";
import type { MosaicAsset, MosaicColor, MosaicMediaSource, MosaicSource } from "@m0saic/types";
import { makeColorTile, transparentSlot } from "@m0saic/template-utils";
import type { BackgroundMode, ResolvedBorder } from "./types";

export type CardBaseOpts = {
  mode: BackgroundMode;
  cardColor: MosaicColor;
  backgroundImage?: string;
  cornerRadius: number;
  border: ResolvedBorder;
};

export function buildCardBase(opts: CardBaseOpts): { source: MosaicSource; assets: Record<string, MosaicAsset> } {
  const rounding = { cornerStyle: "rounded" as const, borderRadius: opts.cornerRadius };
  const stroke = { position: "inner" as const, width: 0.002, color: opts.border.color, alpha: opts.border.alpha };

  if (opts.mode === "none") {
    return { source: transparentSlot(), assets: {} };
  }

  if (opts.mode === "image" && opts.backgroundImage) {
    const isData = opts.backgroundImage.startsWith("data:");
    const assets: Record<string, MosaicAsset> = {
      bg: isData
        ? { kind: "data-uri", uri: opts.backgroundImage, mediaType: "image" }
        : { kind: "file", path: opts.backgroundImage, mediaType: "image" },
    };
    const source: MosaicMediaSource = {
      type: "media",
      mediaType: "image",
      assetId: asAssetId("bg"),
      placement: { fit: "cover" },
      effects: { rounding, stroke },
    };
    return { source, assets };
  }

  // "solid" or "preset"
  return { source: makeColorTile(opts.cardColor, { effects: { rounding, stroke } }), assets: {} };
}
