/**
 * placeInsetPieces — the template-author front door to zero-drift laundered m0.
 *
 * The inset-recovery sibling of `placeOptimizedPieces`: same `{ rect, source }`
 * pieces, same source-mapping ritual, but instead of trading a drift budget it
 * wraps `@m0saic/dsl-stdlib`'s `placeInsetRects` — cells quantize OUTWARD to a
 * divisor lattice (bounded precision) and each piece's source gets a
 * `placement.inset` that paints it back on the EXACT input rect. Zero visual
 * drift; precision bounds at `basis` (default 120, the modern canvas-family
 * gcd).
 *
 * Prefer this over `placeOptimizedPieces` when the pieces are independent
 * painted leaves with transparent cell margins (chrome, text, masked tiles) —
 * the common case. Keep drift for: per-piece LOCKS mixed with collapsible
 * chrome, container rects, tiles that paint their whole cell, and wanted-snap
 * (pixel-aligned strokes). See handbook feasibility-precision-quantization §3c.
 *
 * Contract notes:
 *   - Sources must paint nothing outside their inset box (transparent margins);
 *     a cell-filling background would show the QUANTIZED cell. Text reveals /
 *     `overlay.*` ride along untouched (overlay ≠ placement).
 *   - A piece whose source ALREADY carries `placement.inset` throws — composing
 *     two insets is ambiguous. Bake the design inset into the rect instead (the
 *     rect is exact under recovery, so shrinking it costs nothing).
 *   - Hostile axes (prime cell dims) degrade to EXACT placement on that axis by
 *     default (`onHostile: "exact"`) — a runtime primitive must render at
 *     whatever canvas it is given; the result reports it via `hostile`. This is
 *     the same degradation `placeOptimizedPieces` has (its pitch falls to 1).
 *
 * @example
 * const { m0, sources } = placeInsetPieces({
 *   rootW: W, rootH: H,
 *   pieces: [
 *     { rect: { x: 0, y: 0, w: W, h: H, importance: 0 }, source: surface }, // lattice-aligned → untouched
 *     { rect: chipRect, source: chip },   // gets placement.inset, paints byte-exact
 *   ],
 * });
 * return { kind: "mosaic_document", m0, sources, ... };
 */

import type { M0String } from "@m0saic/dsl";
import type { MosaicSource } from "@m0saic/types";
import { placeInsetRects } from "@m0saic/dsl-stdlib";
import type { GeometryExpectation } from "../geometry-contract";

export interface InsetPiece {
  /** Pixel rect. `importance` sets paint z-order (higher on top), as `placeRects`. */
  rect: { x: number; y: number; w: number; h: number; importance?: number };
  /** The source painted at this rect. Must not already carry `placement.inset`. */
  source: MosaicSource;
}

export interface PlaceInsetPiecesOptions {
  /** Root canvas width. Positive integer. */
  rootW: number;
  /** Root canvas height. Positive integer. */
  rootH: number;
  /** Pieces to place (non-empty). */
  pieces: InsetPiece[];
  /** Target split basis per axis (max slot count). Default 120. */
  basis?: number;
  /** Coarseness floor per rect (fraction of its cell). Default 0.5. */
  minFill?: number;
  /** Claimant token for every placed cell. Default `"F"`. */
  claimant?: string;
  /**
   * Hostile-axis behavior. Default `"exact"` — a runtime template must render
   * at any canvas, so a prime-dim axis places exactly (reported via `hostile`)
   * instead of crashing the render. Pass `"throw"` for generation-time use.
   */
  onHostile?: "throw" | "exact";
}

export interface PlaceInsetPiecesResult {
  /** Composed m0 (layers chained as overlays), over the QUANTIZED cells. */
  m0: M0String;
  /**
   * Sources ordered to match the emitted m0's frames: layer-major, then by the
   * quantized cell's band-emission order (y, then x). Sources that needed
   * recovery are CLONES carrying `placement.inset`; lattice-aligned pieces pass
   * their source through untouched. Assign straight into the document's
   * `sources`.
   */
  sources: MosaicSource[];
  /** Lattice pitch chosen per axis (a divisor of the axis; 1 = exact). */
  pitch: { x: number; y: number };
  /** Realized split-basis bound per axis (precision floor). */
  basis: { x: number; y: number };
  /** True when the `minFill` guard forced a finer pitch on that axis. */
  clamped: { x: boolean; y: boolean };
  /** True when that axis was hostile and degraded to exact placement. */
  hostile: { x: boolean; y: boolean };
  /**
   * Geometry-contract expectations, index-matching `sources` (frame order). Each
   * declares the piece's EXACT intent `rect`, its recovery `inset` (so the
   * checker replays the engine floor math), the source's `maskBounds` when it
   * carries an inline-mask, and `tolerancePx: 0` — zero drift is the contract.
   * Pass straight to `withGeometryContract` (nearly free: no parse here; the
   * checker zips these to render frames by paint order). Cheap to build even
   * when the debug gate is off — it only reshapes data this call already has.
   */
  expectations: GeometryExpectation[];
}

/** Pull `{width,height}` off a source's inline-mask `bounds`, if any. */
function extractMaskBounds(source: MosaicSource): { width: number; height: number } | null {
  const mask = (source as { mask?: { kind?: string; bounds?: { width: number; height: number } } }).mask;
  if (mask && mask.kind === "inline-mask" && mask.bounds) {
    return { width: mask.bounds.width, height: mask.bounds.height };
  }
  return null;
}

/**
 * Place `{ rect, source }` pieces as zero-drift laundered m0 and return the m0
 * + frame-aligned sources with recovery insets wired in (ready for a
 * `mosaic_document`).
 */
export function placeInsetPieces(opts: PlaceInsetPiecesOptions): PlaceInsetPiecesResult {
  const { rootW, rootH, pieces, basis, minFill, claimant = "F", onHostile = "exact" } = opts;
  if (pieces.length === 0) {
    throw new Error("placeInsetPieces: pieces must be non-empty.");
  }
  for (let i = 0; i < pieces.length; i++) {
    const placement = (pieces[i].source as { placement?: { inset?: unknown } }).placement;
    if (placement?.inset != null) {
      throw new Error(
        `placeInsetPieces: pieces[${i}].source already carries placement.inset — ` +
          `composing two insets is ambiguous. Bake the design inset into the rect ` +
          `instead (the rect paints exactly under recovery, so shrinking it is free).`,
      );
    }
  }

  const placed = placeInsetRects({
    rootW,
    rootH,
    basis,
    minFill,
    onHostile,
    rects: pieces.map((p) => ({
      x: p.rect.x,
      y: p.rect.y,
      w: p.rect.w,
      h: p.rect.h,
      importance: p.rect.importance,
      claimant,
    })),
  });

  // Layer → source mapping (the placeRects ordering ritual): within each layer,
  // sort by the QUANTIZED cell's (y, x) — the band-emission order the m0 uses.
  // Wire each recovery inset onto a CLONE of the piece's source (sources may be
  // shared objects; never mutate the caller's). The engine honors source-level
  // placement.inset on color tiles, media, and text sources alike (text-LAYER
  // placement ignores inset; the SOURCE-level one is forwarded — the known
  // gotcha), and applies inset BEFORE fit/padding/mask math, so masks authored
  // against the rect's dims scale 1:1 into the recovered box.
  const sources: MosaicSource[] = [];
  const expectations: GeometryExpectation[] = [];
  for (const lyr of placed.layers) {
    const ordered = [...lyr.rectIndices].sort(
      (a, b) => placed.cells[a].y - placed.cells[b].y || placed.cells[a].x - placed.cells[b].x,
    );
    for (const idx of ordered) {
      const piece = pieces[idx];
      const inset = placed.insets[idx];
      // Expectation (frame-ordered, index-matches `sources`): the EXACT intent
      // rect + the recovery inset + any inline-mask bounds; tolerance 0.
      expectations.push({
        rect: { x: piece.rect.x, y: piece.rect.y, w: piece.rect.w, h: piece.rect.h },
        inset: inset ?? null,
        maskBounds: extractMaskBounds(piece.source),
        tolerancePx: 0,
      });
      if (!inset) {
        sources.push(piece.source);
        continue;
      }
      const existing = (piece.source as { placement?: Record<string, unknown> }).placement;
      sources.push({
        ...(piece.source as object),
        placement: { ...(existing ?? {}), inset },
      } as MosaicSource);
    }
  }

  return {
    m0: placed.m0,
    sources,
    pitch: placed.pitch,
    basis: placed.basis,
    clamped: placed.clamped,
    hostile: placed.hostile,
    expectations,
  };
}
