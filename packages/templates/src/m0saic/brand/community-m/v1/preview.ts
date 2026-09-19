import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import { grid, toM0String, weightedSplit } from "@m0saic/dsl-stdlib";
import { keyframeExpr, svgLabel } from "@m0saic/template-utils";
import {
  PLACEHOLDER_ART_SIZE,
  placeholderArtFocus,
  placeholderArtUrl,
  type PlaceholderArtStyle,
} from "@m0saic/platform";
import type { CommunityMEntry } from "@m0saic/types";
import { asciiSafe } from "./caption";
import type { ClaimImage, MarkClaim } from "./mark";
import type { LoadedPiece } from "./piece";
import type { ImageSize } from "./reveal";

/**
 * DEV LEVERS — design the harness before the M fills up.
 *
 * The seed has ONE claim, so at defaults the video is a nearly-empty M with
 * one real photo. These knobs stand the rest of it up: open tiles get art
 * from the SAME bank the Community page previews with
 * (`@m0saic/platform` `placeholderArt`), any tile can be the subject (so the
 * crop maths gets exercised on wide, tall and diagonal tiles, not just the
 * root's V), and the contributor canvas can be a generated card instead of
 * a real `.mosaic` — so you can iterate on the harness without authoring
 * one.
 *
 * All of it is off by default and fully deterministic: same knobs, same
 * bytes. Nothing here reads the disk.
 */

export type PreviewPieceStyle = "off" | "lorem" | "card" | "bars" | "reel" | "grid";
export type PreviewPieceAspect = "16:9" | "1:1" | "9:16";

export type PreviewOptions = {
  /** How many tiles the M paints as claimed (0 = off, real claims only). */
  claims: number;
  style: PlaceholderArtStyle;
  seed: number;
  /** Share of a `mix` that is logos rather than faces. */
  logoShare: number;
  /** Tile index the video is about, overriding the resolved slot. */
  tile: number | null;
  piece: PreviewPieceStyle;
  pieceAspect: PreviewPieceAspect;
};

export type PreviewPhoto = { image: ClaimImage; size: ImageSize; focus: { x: number; y: number } };

/** One tile's stand-in, as a data-uri image the engine rasterizes (same path as the claimed edges). */
export function standInPhoto(tileIndex: number, o: Pick<PreviewOptions, "style" | "seed" | "logoShare">): PreviewPhoto {
  return {
    // The shared bank builds the data URL — one form, read by both the DOM
    // and the render engine's plain-SVG parser.
    image: { kind: "data-uri", uri: placeholderArtUrl(tileIndex, o.style, o.seed, o.logoShare) },
    size: { ...PLACEHOLDER_ART_SIZE },
    focus: placeholderArtFocus(tileIndex, o.style, o.seed, o.logoShare),
  };
}

function standInClaim(tileIndex: number, o: PreviewOptions): MarkClaim {
  const p = standInPhoto(tileIndex, o);
  return { image: p.image, focus: { ...p.focus, zoom: 1 } };
}

/**
 * Stand-ins for open tiles, dealt in the M's own claim order (so a
 * half-full preview scatters exactly the way the real M will fill). Real
 * claims are never overwritten; the subject tile is always included so
 * `previewTile` can point anywhere.
 */
export function simulatedClaims(entry: CommunityMEntry, real: ReadonlySet<number>, o: PreviewOptions): Map<number, MarkClaim> {
  const out = new Map<number, MarkClaim>();
  if (o.claims <= 0 && o.tile === null) return out;
  if (o.claims > 0) {
    let filled = real.size;
    for (const tileIndex of entry.claimOrder) {
      if (filled >= o.claims) break;
      if (real.has(tileIndex) || out.has(tileIndex)) continue;
      out.set(tileIndex, standInClaim(tileIndex, o));
      filled++;
    }
  }
  if (o.tile !== null && !real.has(o.tile) && !out.has(o.tile)) out.set(o.tile, standInClaim(o.tile, o));
  return out;
}

/**
 * "tile 20 - claim 1 of 32 - preview stand-in - mixed, unclaimed" — the real
 * line's shape (`tileLine`), with the award number the lever was set by;
 * without a claim number (the resolved slot, or the root) just the tile.
 */
export function previewTileLine(tileIndex: number, style: PlaceholderArtStyle, claimNo: number | null = null, capacity = 32): string {
  const which = claimNo === null ? "" : ` - claim ${claimNo} of ${capacity}`;
  return `tile ${tileIndex}${which} - preview stand-in - ${style === "logos" ? "logo" : style === "faces" ? "avatar" : "mixed"}, unclaimed`;
}

const PIECE_SIZES: Record<PreviewPieceAspect, ImageSize> = {
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

/** Stand-in canvas duration — long enough to read, short enough to iterate. */
export const PREVIEW_PIECE_MS = 4000;
/** The moving samples need room to actually move. */
export const PREVIEW_PIECE_LONG_MS = 6000;

const LOREM_BODY =
  "Consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

/** Sample palette — the accent plus four that sit beside it without fighting. */
const PALETTE = ["#f97316", "#38bdf8", "#a78bfa", "#34d399", "#fbbf24"];

/** One beat of the `reel` sample: an eyebrow over a headline, on its own. */
function beatCard(
  W: number,
  H: number,
  o: { fps: number; canvasColor: string; accentColor: string; textColor: string },
  eyebrow: string,
  headline: string,
  index: number,
): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: weightedSplit([2, 5], "row", { precision: 7 }),
    size: { width: W, height: H },
    fps: o.fps,
    durationMs: PREVIEW_PIECE_LONG_MS,
    backgroundColor: (index % 2 === 0 ? o.canvasColor : "#141a26") as never,
    audio: { mode: "off" },
    assets: {},
    sources: [
      svgLabel(asciiSafe(eyebrow), W, Math.round((H * 2) / 7), { color: o.accentColor as never, maxPx: Math.round(H * 0.07), maxLines: 1 }),
      svgLabel(asciiSafe(headline), W, Math.round((H * 5) / 7), { color: o.textColor as never, maxPx: Math.round(H * 0.16), maxLines: 2 }),
    ],
  };
}

/**
 * A generated contributor canvas: something designed-looking in the piece
 * beat while the real one does not exist yet. Declares its own size (the
 * aspect knob covers the portrait case the harness has to survive) and
 * carries no assets, so it costs nothing to render.
 */
export function previewPiece(o: {
  style: Exclude<PreviewPieceStyle, "off">;
  aspect: PreviewPieceAspect;
  fps: number;
  canvasColor: string;
  accentColor: string;
  textColor: string;
}): LoadedPiece {
  const size = PIECE_SIZES[o.aspect];
  const { width: W, height: H } = size;
  const text = (s: string, rows: number, total: number, color: string, weight = 0.6): MosaicSource =>
    svgLabel(asciiSafe(s), W, Math.round((H * rows) / total), { color: color as never, maxPx: Math.round(((H * rows) / total) * weight), maxLines: rows > 2 ? 3 : 1 });

  let m0: string;
  let sources: MosaicSource[];
  let children: Record<string, MosaicDocument> | undefined;
  const long = o.style === "reel" || o.style === "grid";
  const durationMs = long ? PREVIEW_PIECE_LONG_MS : PREVIEW_PIECE_MS;
  const end = durationMs / 1000;

  if (o.style === "bars") {
    // A flat colour band — a busy, wordless canvas to read the harness against.
    m0 = weightedSplit([1, 1, 1, 1, 1], "col");
    sources = PALETTE.map((c) => ({ type: "lavfi", color: c }) as MosaicSource);
  } else if (o.style === "card") {
    // A stat card: label, a big number, a sublabel.
    m0 = weightedSplit([3, 6, 3], "row", { precision: 12 });
    sources = [
      text("CONTRIBUTORS", 3, 12, o.accentColor, 0.35),
      text("1,284", 6, 12, o.textColor, 0.8),
      text("+12% since last month", 3, 12, o.textColor, 0.3),
    ];
  } else if (o.style === "reel") {
    // Three beats in one canvas — the point of this sample is that a piece
    // is a VIDEO, not a poster: each beat is its own nested card that fades
    // in, holds and hands over. Complexity is welcome here.
    const beats: [string, string][] = [
      ["THE CLAIM", "One tile, forever"],
      ["THE WORK", "Your template, accepted"],
      ["THE MARK", "You are in the M"],
    ];
    const span = end / beats.length;
    children = {};
    sources = [{ type: "lavfi", color: o.canvasColor } as MosaicSource];
    beats.forEach(([eyebrow, headline], i) => {
      const ref = `beat${i}`;
      children![ref] = beatCard(W, H, o, eyebrow, headline, i);
      const t0 = i * span;
      const fade = Math.min(0.45, span * 0.3);
      const keys = [{ t: t0, v: 0 }, { t: t0 + fade, v: 1 }];
      // Every beat but the last hands over; the last one holds to the end.
      if (i < beats.length - 1) keys.push({ t: t0 + span - fade, v: 1 }, { t: t0 + span, v: 0 });
      sources.push({ type: "mosaic", ref, overlay: { alpha: keyframeExpr(keys) } } as MosaicSource);
    });
    m0 = toM0String("1{1{1{1}}}", "CommunityMV1-preview-reel");
  } else if (o.style === "grid") {
    // A canvas that BUILDS itself: twelve cells landing on a stagger, then
    // the line that names what was built. Density and rhythm, no assets.
    // The cells are a CHILD so the parent has exactly two frames — a base
    // and one overlay. (Cells + caption as siblings would make the caption
    // the thirteenth cell; m0 counts frames, not intentions.)
    const g = grid({ rows: 3, cols: 4 });
    const cells = 12;
    const build = end * 0.6;
    children = {
      cells: {
        kind: "mosaic_document",
        version: 1,
        m0: g.m0,
        size: { width: W, height: H },
        fps: o.fps,
        durationMs,
        backgroundColor: o.canvasColor as never,
        audio: { mode: "off" },
        assets: {},
        sources: Array.from({ length: cells }, (_, i) => {
          const t0 = (i / cells) * build;
          return {
            type: "lavfi",
            color: PALETTE[i % PALETTE.length],
            overlay: { alpha: keyframeExpr([{ t: t0, v: 0 }, { t: t0 + 0.35, v: 1 }]) },
          } as MosaicSource;
        }),
      },
    };
    sources = [
      { type: "mosaic", ref: "cells" } as MosaicSource,
      // The line lands once the grid is up.
      {
        ...svgLabel(asciiSafe("thirty-three tiles, one mark"), W, Math.round(H * 0.2), {
          color: o.textColor as never,
          maxPx: Math.round(H * 0.11),
          maxLines: 2,
        }),
        placement: { fit: "contain", inset: { x: 0.06, y: 0.4 } },
        overlay: { alpha: keyframeExpr([{ t: build, v: 0 }, { t: build + 0.5, v: 1 }]) },
      } as MosaicSource,
    ];
    m0 = toM0String("1{1}", "CommunityMV1-preview-grid");
  } else {
    // Lorem: eyebrow, headline, body, footer — the shape of most cards.
    m0 = weightedSplit([2, 4, 4, 2], "row", { precision: 12 });
    sources = [
      text("LOREM IPSUM", 2, 12, o.accentColor, 0.45),
      text("Dolor sit amet, consectetur", 4, 12, o.textColor, 0.42),
      text(LOREM_BODY, 4, 12, o.textColor, 0.22),
      text("your canvas goes here", 2, 12, o.accentColor, 0.35),
    ];
  }

  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(m0, "CommunityMV1-preview-piece"),
    size,
    fps: o.fps,
    durationMs,
    backgroundColor: o.canvasColor as never,
    audio: { mode: "off" },
    assets: {},
    ...(children ? { children } : {}),
    sources,
  };
  return { doc, declaredMs: durationMs, size };
}
