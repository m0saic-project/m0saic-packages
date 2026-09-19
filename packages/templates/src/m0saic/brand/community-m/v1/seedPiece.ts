import type { MosaicColor, MosaicDocument, MosaicOverlayExpr, MosaicSource } from "@m0saic/types";
import {
  HEADER_M_GLYPH,
  M_RECTS,
  assemblyTracks,
  brandGlyphTile,
  easingExpr,
  makeColorTile,
  markAssembly,
  placeInsetPieces,
  progressExpr,
  svgLabel,
  type InsetPiece,
} from "@m0saic/template-utils";

/**
 * The founder's piece for the root tile of Community M #001 — the seed
 * `ms/001/root/piece.mosaic`, the canvas that pops in beside the original
 * in the provenance video and the reference every contributor copies.
 *
 * "Mosaic itself — the first contribution": the M assembles from its own
 * 26 rectangles (dormant grey flying in and turning the accent, the
 * hello-world assembly); the 7 V-leg pieces drawbox cannot draw FADE in as
 * the last rects land (never a snap — the founder's note, 2026-09-16);
 * then the line rises in: one tile, forever.
 *
 * DATA ONLY, like any contributor's piece (`validateCommunityPiece`): a
 * colour surface, drawbox tracks, one masked colour tile, one svg text
 * layer. No media, no assets. Regenerate the committed file with
 * `node dist/m0saic/brand/community-m/v1/gen-seed-piece.js`; the test pins
 * the committed bytes to this builder so the two cannot drift.
 */

/** Square canvas — the same navy / accent / ink the harness renders at defaults. */
export const SEED_PIECE_SIDE = 1080;
export const SEED_PIECE_DURATION_MS = 4000;
export const SEED_PIECE_FPS = 30;
export const SEED_PIECE_LINE = "one tile, forever";

const CANVAS = "#0E1220" as MosaicColor;
const ACCENT = "#f97316" as MosaicColor;
const DORMANT = "#34343A" as MosaicColor;
const INK = "#F4F4F5" as MosaicColor;

/** The beats, in piece seconds (the harness pops the canvas in over its first ~0.45 s). */
export const SEED_PIECE_TIMELINE = {
  assembleStart: 0.4,
  assembleDur: 1.0,
  /** The V-legs fade in (smoothstep) while the last rects settle — starting
   *  before the assembly lands (1.4 s), so the M completes in one motion
   *  (founder, 2026-09-16: at 1.25 s the legs registered as late). */
  legsStart: 1.05,
  legsDur: 0.6,
  lineStart: 1.9,
  lineDur: 0.5,
} as const;

type Rect = { x: number; y: number; w: number; h: number };

/** Layout: the M over the line, centred, a hair above the middle. */
export function seedPieceLayout(S = SEED_PIECE_SIDE): { mark: Rect; line: Rect } {
  const side = Math.round(S * 0.54);
  const mark = { x: Math.round((S - side) / 2), y: Math.round(S * 0.139), w: side, h: side };
  const lineH = Math.round(S * 0.118);
  const line = { x: Math.round(S * 0.074), y: Math.round(S * 0.737), w: S - 2 * Math.round(S * 0.074), h: lineH };
  return { mark, line };
}

/** Bounding box of one absolute M/L/H/V/Z subpath of the silhouette (272-space). */
function subpathBBox(d: string): { x: number; y: number; w: number; h: number } {
  const tokens = d.match(/[MLHVZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  let cmd = "M", x = 0, y = 0, pending: number | null = null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mark = () => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const tok of tokens) {
    if (/^[MLHVZ]$/i.test(tok)) { cmd = tok.toUpperCase(); pending = null; continue; }
    const n = Number(tok);
    if (cmd === "H") { x = n; mark(); }
    else if (cmd === "V") { y = n; mark(); }
    else if (pending === null) pending = n;
    else { x = pending; y = n; pending = null; mark(); }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The 7 diagonal V-leg pieces of the brand M — every subpath of the
 * silhouette whose box is NOT one of the 26 rects the assembly draws (a
 * rect can be drawn with `L` segments, so the test is geometric).
 */
export function mLegPaths(): string[] {
  const isRect = (b: { x: number; y: number; w: number; h: number }) =>
    M_RECTS.some(([x, y, w, h]) => Math.abs(b.x - x) < 0.25 && Math.abs(b.y - y) < 0.25 && Math.abs(b.w - w) < 0.25 && Math.abs(b.h - h) < 0.25);
  return HEADER_M_GLYPH.path.split(/(?=M)/).map((d) => d.trim()).filter((d) => d && !isRect(subpathBBox(d)));
}

const r3 = (n: number): number => Number(n.toFixed(3));

function ramp(atSec: number, durSec: number): string {
  return easingExpr("easeOut", progressExpr(r3(atSec), Math.max(0.001, r3(durSec))));
}

/** Fade in place — a gentle smoothstep, no onset the eye reads as a pop. */
function fadeIn(atSec: number, durSec: number): MosaicOverlayExpr {
  return { alpha: easingExpr("smoothstep", progressExpr(r3(atSec), Math.max(0.001, r3(durSec)))), startAtSec: r3(atSec), window: { startSec: r3(atSec) } };
}

/** Rise in from `dyPx` below while fading up. */
function riseIn(atSec: number, durSec: number, dyPx: number): MosaicOverlayExpr {
  const p = ramp(atSec, durSec);
  return { alpha: p, yExpr: `(1-${p})*${dyPx}`, startAtSec: r3(atSec), window: { startSec: r3(atSec) } };
}

/** The seed piece as a document — pure; the same bytes every call. */
export function buildSeedPiece(): MosaicDocument {
  const S = SEED_PIECE_SIDE;
  const t = SEED_PIECE_TIMELINE;
  const { mark, line } = seedPieceLayout(S);
  const full = { x: 0, y: 0, w: S, h: S };

  const assembly = markAssembly({
    W: S,
    H: S,
    S,
    mark,
    startSec: t.assembleStart,
    durSec: t.assembleDur,
    fps: SEED_PIECE_FPS,
    fromColor: DORMANT,
    toColor: ACCENT,
  });
  const legs = { bounds: HEADER_M_GLYPH.bounds, path: mLegPaths().join(" ") };

  const pieces: InsetPiece[] = [
    { rect: { ...full, importance: 0 }, source: makeColorTile(CANVAS) as MosaicSource },
    ...assemblyTracks(assembly.boxes, ACCENT).map((source, i) => ({ rect: { ...full, importance: 1 + i }, source })),
    { rect: { ...mark, importance: 10 }, source: { ...brandGlyphTile(legs, ACCENT), overlay: fadeIn(t.legsStart, t.legsDur) } as MosaicSource },
    {
      rect: { ...line, importance: 11 },
      source: { ...svgLabel(SEED_PIECE_LINE, line.w, line.h, { color: INK, maxPx: Math.round(S * 0.07), maxLines: 1 }), overlay: riseIn(t.lineStart, t.lineDur, Math.round(S * 0.03)) } as MosaicSource,
    },
  ];
  const placed = placeInsetPieces({ rootW: S, rootH: S, pieces });
  return {
    kind: "mosaic_document",
    version: 1,
    m0: placed.m0,
    size: { width: S, height: S },
    fps: SEED_PIECE_FPS,
    durationMs: SEED_PIECE_DURATION_MS,
    backgroundColor: CANVAS as never,
    assets: {},
    sources: placed.sources,
  };
}

/** The committed file's exact text: 2-space JSON + trailing newline. */
export function seedPieceJson(): string {
  return JSON.stringify(buildSeedPiece(), null, 2) + "\n";
}
