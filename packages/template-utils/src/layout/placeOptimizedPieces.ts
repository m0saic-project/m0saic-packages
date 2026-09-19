/**
 * placeOptimizedPieces — the template-author front door to drift-optimized m0.
 *
 * Templates already build a list of `{ rect, source }` "pieces" and then run the
 * `placeRects` ritual: place the rects, then walk the emitted layers and push
 * each layer's sources back in band-emission order. This helper wraps that whole
 * ritual AND swaps `placeRects` for `@m0saic/dsl-stdlib`'s `placeOptimizedRects`,
 * so a template gets the LEANEST m0 for free — every author just attaches a
 * `drift` allowance to the pieces they already create:
 *
 *   - `drift: "exact"` (or `0`) — LOCK this piece to the pixel. Reach for it on
 *     animation-critical geometry (a segment of an arc/pie chain) that must not
 *     move. A locked piece whose edges are coprime with the canvas correctly
 *     pins that axis to full precision.
 *   - `drift: <px>` — allow each edge to move up to this many px.
 *   - omitted — ride the global `driftPercent` budget.
 *
 * With `driftPercent` = 0 and no per-piece drift, the output is byte-identical to
 * the manual `placeRects` path — optimization is strictly opt-in.
 *
 * @example
 * const { m0, sources } = placeOptimizedPieces({
 *   rootW: W, rootH: H, driftPercent: 0.5,
 *   pieces: [
 *     { rect: { x: 0, y: 0, w: W, h: H, importance: 0 }, source: surface },      // chrome
 *     { rect: arcRect, source: arc, drift: "exact" },                            // animated — locked
 *   ],
 * });
 * return { kind: "mosaic_document", m0, sources, ... };
 */

import type { M0String } from "@m0saic/dsl";
import type { MosaicSource } from "@m0saic/types";
import { placeOptimizedRects } from "@m0saic/dsl-stdlib";
import type { GeometryExpectation } from "../geometry-contract";

/** Per-piece drift allowance: `"exact"` locks it (0px), a number is max px per edge. */
export type DriftAllowance = number | "exact";

export interface OptimizablePiece {
  /** Pixel rect. `importance` sets paint z-order (higher on top), as `placeRects`. */
  rect: { x: number; y: number; w: number; h: number; importance?: number };
  /** The source painted at this rect. */
  source: MosaicSource;
  /** Drift allowance. Omit to use the global `driftPercent` budget. */
  drift?: DriftAllowance;
}

export interface PlaceOptimizedPiecesOptions {
  /** Root canvas width. Positive integer. */
  rootW: number;
  /** Root canvas height. Positive integer. */
  rootH: number;
  /** Pieces to place (non-empty). */
  pieces: OptimizablePiece[];
  /**
   * Default per-edge drift budget (% of the smaller canvas dim) for pieces
   * without an explicit `drift`. Default 0 → all exact → byte-identical to the
   * manual `placeRects` path. A 1px nudge on 1080 is ~0.09%.
   */
  driftPercent?: number;
  /** Claimant token for every placed cell. Default `"F"`. */
  claimant?: string;
}

export interface PlaceOptimizedPiecesResult {
  /** Composed m0 (layers chained as overlays). */
  m0: M0String;
  /**
   * Sources ordered to match the emitted m0's frames: layer-major, then by the
   * snapped rect's band-emission order (y, then x). Assign straight into the
   * document's `sources`.
   */
  sources: MosaicSource[];
  /** Achieved split basis per axis (precision floor). */
  basis: { x: number; y: number };
  /** Largest / total single-edge drift applied (px). */
  driftMaxPx: number;
  driftTotalPx: number;
  /**
   * Geometry-contract expectations, index-matching `sources` (frame order).
   * Intent is the SNAPPED rect (post-drift is the design truth — a locked piece
   * snaps to its original rect), asserted at `tolerancePx: 0`. No `inset` (drift
   * places exactly) and no `maskBounds` (drift MOVES edges, so a mask's aspect
   * legitimately shifts — asserting 1:1 there would false-fail). Pass straight
   * to `withGeometryContract`.
   */
  expectations: GeometryExpectation[];
}

/**
 * Place a list of `{ rect, source, drift }` pieces as drift-optimized m0 and
 * return the m0 + frame-aligned sources (ready for a `mosaic_document`).
 */
export function placeOptimizedPieces(opts: PlaceOptimizedPiecesOptions): PlaceOptimizedPiecesResult {
  const { rootW, rootH, pieces, driftPercent = 0, claimant = "F" } = opts;
  if (pieces.length === 0) {
    throw new Error("placeOptimizedPieces: pieces must be non-empty.");
  }

  const rects = pieces.map((p) => ({
    x: p.rect.x,
    y: p.rect.y,
    w: p.rect.w,
    h: p.rect.h,
    importance: p.rect.importance,
    claimant,
    // "exact" → 0 (locked); a number → its budget; undefined → default budget.
    driftPx: p.drift === "exact" ? 0 : p.drift,
  }));

  const placed = placeOptimizedRects({ rootW, rootH, rects, driftPercent });

  // Layer → source mapping (the placeRects ordering ritual): within each layer,
  // sort by the SNAPPED rect's (y, x) — the band-emission order the m0 uses.
  const sources: MosaicSource[] = [];
  const expectations: GeometryExpectation[] = [];
  for (const lyr of placed.layers) {
    const ordered = [...lyr.rectIndices].sort(
      (a, b) => placed.rects[a].y - placed.rects[b].y || placed.rects[a].x - placed.rects[b].x,
    );
    for (const idx of ordered) {
      const snapped = placed.rects[idx];
      expectations.push({
        rect: { x: snapped.x, y: snapped.y, w: snapped.w, h: snapped.h },
        tolerancePx: 0,
      });
      sources.push(pieces[idx].source);
    }
  }

  return {
    m0: placed.m0,
    sources,
    basis: placed.basis,
    driftMaxPx: placed.driftMaxPx,
    driftTotalPx: placed.driftTotalPx,
    expectations,
  };
}
