import type { AssetId, MosaicAssetManifest, MosaicDocument, MosaicSource } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { makeColorTile } from "@m0saic/template-utils";
import { M_NATIVE, markGeometry } from "./geometry";

/** Claimed-edge stroke width in 272-space (matches the app painter). */
export const CLAIMED_EDGE_WIDTH = 1.2;

/**
 * One SVG with every claimed tile's outline — the D14 "claimed = orange
 * edge" rule as a single overlay. Rect tiles use the dictionary frame;
 * diagonal tiles use their mask path at its design-space bounds. Delivered
 * as a data-URI media asset: the engine rasterizes SVG media to PNG before
 * ffmpeg sees it, so one source paints all the edges and the mark's 33
 * tiles stay on the grid sheet (no per-tile overlay chain).
 */
export function claimedEdgesSvg(claimedTiles: Iterable<number>, accent: string, sidePx: number): string {
  const geo = markGeometry();
  const parts: string[] = [];
  for (const tile of claimedTiles) {
    const s = geo.tileToSource[tile];
    const r = geo.sourceRects[s];
    const mask = geo.maskFor(s);
    if (mask && mask.kind === "inline-mask") {
      parts.push(`<path d="${mask.localPath}" transform="translate(${mask.bounds.x} ${mask.bounds.y})" fill="none" stroke="${accent}" stroke-width="${CLAIMED_EDGE_WIDTH}" stroke-linejoin="round"/>`);
    } else {
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="${accent}" stroke-width="${CLAIMED_EDGE_WIDTH}" stroke-linejoin="round"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sidePx}" height="${sidePx}" viewBox="0 0 ${M_NATIVE} ${M_NATIVE}">${parts.join("")}</svg>`;
}

/**
 * A claimed tile's picture: a file on disk (the node reader), a URL the host
 * serves (the browser — the web app publishes the bundled seed's tiles), or
 * an inline SVG (a preview stand-in).
 */
export type ClaimImage =
  | { kind: "file"; path: string }
  | { kind: "url"; url: string }
  | { kind: "data-uri"; uri: string };

/** The document asset for a claim's picture — one mapping, both consumers. */
export function claimImageAsset(image: ClaimImage): MosaicAssetManifest[AssetId] {
  if (image.kind === "file") return { kind: "file", path: image.path, mediaType: "image" };
  if (image.kind === "url") return { kind: "url", url: image.url, mediaType: "image" };
  return { kind: "data-uri", uri: image.uri, mediaType: "image" };
}

export type MarkClaim = { image: ClaimImage; focus?: { x: number; y: number; zoom: number } };

export type MarkDocOptions = {
  /** Square side — MUST be k·272 (masks are authored in tile space; any other side stretches them). */
  side: number;
  fps: number;
  durationMs: number;
  /** Tile index → claimed image (cover-fit into the tile, focus-placed). */
  claims: ReadonlyMap<number, MarkClaim>;
  dormantColor: string;
  canvasColor: string;
  /** Accent for a reserved root (so the tip reads as special even when empty). */
  accentColor: string;
  rootReserved: boolean;
  /** Optional: dim every tile except this one (spotlight) via overlay alpha keyframes. */
  spotlight?: { tileIndex: number; alphaExpr: string };
};

/**
 * The Community M as a document: the dictionary m0 as-is, one source per
 * tile in SOURCE order — a claimed tile is its image, cover-fit and masked
 * to the tile; an open tile is a dormant colour tile. The doc declares its
 * own square size so nesting it never resizes the mark (child-size law).
 */
export function buildMarkDoc(o: MarkDocOptions): MosaicDocument {
  if (o.side % 272 !== 0) throw new Error(`mark side must be a multiple of 272 (got ${o.side})`);
  const tiles = buildTilesDoc(o);
  const edgesId = asAssetId("claimed_edges");
  const svg = claimedEdgesSvg(o.claims.keys(), o.accentColor, o.side);
  return {
    kind: "mosaic_document",
    version: 1,
    // base = the M's 33 tiles (nested, own size); overlay = one edge layer.
    m0: toM0String("1{1}", "CommunityMV1-mark"),
    size: { width: o.side, height: o.side },
    fps: o.fps,
    durationMs: o.durationMs,
    backgroundColor: o.canvasColor as never,
    audio: { mode: "off" },
    // URL-encoded, not base64, and with NO `;utf8` parameter: no `Buffer`
    // (browser-safe), and the engine's plain-SVG data-URI parser only accepts
    // `;key=value` params — see core `parsePlainSvgDataUri`.
    assets: { [edgesId]: { kind: "data-uri", uri: `data:image/svg+xml,${encodeURIComponent(svg)}`, mediaType: "image" } },
    children: { tiles },
    sources: [
      { type: "mosaic", ref: "tiles" },
      { type: "media", mediaType: "image", assetId: edgesId, placement: { fit: "contain" } },
    ],
  };
}

/** The 33 tiles alone — the dictionary m0 as-is, one source per tile in SOURCE order. */
export function buildTilesDoc(o: MarkDocOptions): MosaicDocument {
  const geo = markGeometry();
  const assets: MosaicAssetManifest = {};
  const sources: MosaicSource[] = geo.keys.map((_k, s) => {
    const tile = geo.sourceToTile[s];
    const claim = o.claims.get(tile);
    const mask = geo.maskFor(s);
    const overlay = o.spotlight && o.spotlight.tileIndex !== tile ? { alpha: o.spotlight.alphaExpr } : undefined;
    if (claim) {
      const id = asAssetId(`tile_${tile}`);
      assets[id] = claimImageAsset(claim.image);
      const f = claim.focus ?? { x: 0.5, y: 0.5, zoom: 1 };
      return {
        type: "media",
        mediaType: "image",
        assetId: id,
        placement: { fit: "cover", focusX: f.x, focusY: f.y },
        ...(mask ? { mask } : {}),
        ...(overlay ? { overlay } : {}),
      } as MosaicSource;
    }
    const isRoot = tile === 32;
    const color = isRoot && o.rootReserved ? o.accentColor : o.dormantColor;
    return makeColorTile(color as never, { ...(mask ? { mask } : {}), ...(overlay ? { overlay } : {}) });
  });
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(geo.m0, "CommunityMV1-tiles"),
    size: { width: o.side, height: o.side },
    fps: o.fps,
    durationMs: o.durationMs,
    backgroundColor: o.canvasColor as never,
    audio: { mode: "off" },
    assets,
    sources,
  };
}

/**
 * The brand logo for the closer: the same M, every tile in one colour (the
 * app's orange mark). No claims, no edges — the company mark, not the
 * community record.
 */
export function buildLogoDoc(o: { side: number; fps: number; durationMs: number; color: string; canvasColor: string }): MosaicDocument {
  return buildTilesDoc({
    side: o.side,
    fps: o.fps,
    durationMs: o.durationMs,
    claims: new Map(),
    dormantColor: o.color,
    canvasColor: o.canvasColor,
    accentColor: o.color,
    rootReserved: false,
  });
}
