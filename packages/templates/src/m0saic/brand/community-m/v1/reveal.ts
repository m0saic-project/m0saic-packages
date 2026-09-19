import { centerFocus } from "@m0saic/template-utils";

/**
 * The reveal's alignment math. The founder's rule: the un-clipped original
 * must land EXACTLY where the tile's cover-crop sits once the camera is
 * parked, so the crossfade reads as the mask dissolving — the face never
 * moves. Everything here mirrors the engine byte for byte:
 *   - cover crop (`coverCrop.ts`): scale = max(tileW/imgW, tileH/imgH),
 *     crop offset = (scaled − tile) × focus;
 *   - camera (`applyCamera.ts`): content scaled by Z, window top-left =
 *     (box × (Z−1)) × focus, with `centerFocus` picking the focus that
 *     centres the tile (clamped at the stage edge, like the engine).
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type ImageSize = { width: number; height: number };

export type AlignOptions = {
  /** The tile in STAGE pixels (the camera's content box is the stage). */
  tile: Rect;
  stageW: number;
  stageH: number;
  zoom: number;
  image: ImageSize;
  focus: { x: number; y: number };
};

/** Where the tile's whole source image sits on the frame once the camera is parked at `zoom` (frame px, unrounded). */
export function alignedPhotoRect(o: AlignOptions): Rect {
  const Z = o.zoom;
  const fx = (o.tile.x + o.tile.width / 2) / o.stageW;
  const fy = (o.tile.y + o.tile.height / 2) / o.stageH;
  const cx = Z > 1 ? o.stageW * (Z - 1) * centerFocus(fx, Z) : 0;
  const cy = Z > 1 ? o.stageH * (Z - 1) * centerFocus(fy, Z) : 0;
  const s = Math.max(o.tile.width / o.image.width, o.tile.height / o.image.height);
  const sw = o.image.width * s;
  const sh = o.image.height * s;
  const ox = (sw - o.tile.width) * o.focus.x;
  const oy = (sh - o.tile.height) * o.focus.y;
  return { x: (o.tile.x - ox) * Z - cx, y: (o.tile.y - oy) * Z - cy, width: sw * Z, height: sh * Z };
}

/** Round a frame rect to whole pixels (even sides keep chroma happy). */
export function roundRect(r: Rect): Rect {
  const width = Math.max(2, Math.round(r.width / 2) * 2);
  const height = Math.max(2, Math.round(r.height / 2) * 2);
  return { x: Math.round(r.x), y: Math.round(r.y), width, height };
}

/**
 * The largest zoom ≤ `maxZoom` at which the whole original fits inside the
 * stage with `margin` px of air on every side (so the reveal can show all
 * of it without moving). Monotone in Z → bisection; never below `minZoom`.
 *
 * Kept for callers that only need the stage fit; the provenance pipeline
 * uses `zoomPartitionCap`, which adds the piece-beat partition.
 */
export function zoomFitCap(o: Omit<AlignOptions, "zoom"> & { maxZoom: number; minZoom?: number; margin: number }): number {
  const minZoom = o.minZoom ?? 1.02;
  const fits = (Z: number) => {
    const r = alignedPhotoRect({ ...o, zoom: Z });
    return r.x >= o.margin && r.y >= o.margin && r.x + r.width <= o.stageW - o.margin && r.y + r.height <= o.stageH - o.margin;
  };
  return largestZoom(fits, minZoom, o.maxZoom) ?? minZoom;
}

/**
 * THE PIECE-BEAT LAYOUT CONTRACT (founder, 2026-09-16): the parked original
 * and the contributor canvas can NEVER overlap. Not "usually" — the frame is
 * PARTITIONED on one axis, the piece gets exactly the remainder past a gap,
 * and the zoom is chosen up front so that remainder is at least the
 * legibility floor. There is no floor that can push the piece back under
 * the photo (the old `max(0.3·W, remainder)` did exactly that whenever the
 * parked photo was wide), and `assertPieceBeatDisjoint` re-checks the two
 * rects before anything is placed — an impossible layout is an error
 * mosaic, never a covered face. `reveal.test.ts` walks every tile × frame ×
 * image aspect × focus × piece aspect and proves the cap always finds an
 * axis.
 *
 *  - axis "x": photo parks at the left margin (pure horizontal slide — its
 *    height and y never change), the piece takes the width to the right.
 *  - axis "y": photo parks at the top margin (pure vertical slide — its x
 *    and width never change), the piece takes the height below. The axis
 *    that admits the LARGER zoom wins, so wide originals on wide frames
 *    stay side by side and only go vertical when that shows more of them.
 */
export type PieceAxis = "x" | "y";

export type PieceBeatBudget = {
  margin: number;
  gap: number;
  /** The piece's area on the partition axis is never smaller than this. */
  pieceMinW: number;
  pieceMinH: number;
  /** The parked photo may be at most this wide (axis x) / tall (axis y). */
  photoMaxW: number;
  photoMaxH: number;
};

/** Margins, gap and floors for a frame: everything the partition needs. */
export function pieceBeatBudget(frameW: number, frameH: number): PieceBeatBudget {
  const margin = Math.round(Math.min(frameW, frameH) * 0.045);
  const gap = margin;
  const pieceMinW = Math.round(frameW * 0.3);
  const pieceMinH = Math.round(frameH * 0.3);
  return {
    margin,
    gap,
    pieceMinW,
    pieceMinH,
    photoMaxW: frameW - 2 * margin - gap - pieceMinW,
    photoMaxH: frameH - 2 * margin - gap - pieceMinH,
  };
}

/** Which axis a photo of this size can share the frame on; null = neither (the cap prevents this). */
export function pieceAxisFor(photo: ImageSize, b: PieceBeatBudget): PieceAxis | null {
  const x = photo.width <= b.photoMaxW;
  const y = photo.height <= b.photoMaxH;
  if (x && y) return photo.width / b.photoMaxW <= photo.height / b.photoMaxH ? "x" : "y";
  if (x) return "x";
  if (y) return "y";
  return null;
}

/** Largest Z in [minZoom, maxZoom] with pred(Z) true; pred must be monotone (true below some Z, false above). */
function largestZoom(pred: (z: number) => boolean, minZoom: number, maxZoom: number): number | null {
  if (pred(maxZoom)) return maxZoom;
  if (!pred(minZoom)) return null;
  let lo = minZoom, hi = maxZoom;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (pred(mid)) lo = mid; else hi = mid;
  }
  return Math.floor(lo * 1000) / 1000;
}

/**
 * The zoom for the whole reveal → piece → return arc: the largest Z ≤
 * `maxZoom` at which the original (a) fits inside the stage with `margin`
 * of air (the reveal shows all of it without moving) AND (b) leaves the
 * piece its floor on SOME axis. Every photo dimension grows with Z, so both
 * are monotone and the largest Z on the better axis is the answer. When the
 * stage fit alone is impossible even at `minZoom` (a very tall original in
 * a small tile) it is tolerated exactly as before — the original overflows
 * the frame edge — but the partition is never given up: the pinned
 * dimension is bounded by the tile, so an axis always exists.
 */
export function zoomPartitionCap(
  o: Omit<AlignOptions, "zoom"> & { frameW: number; frameH: number; maxZoom: number; minZoom?: number; margin: number },
): number {
  const minZoom = o.minZoom ?? 1.02;
  const b = pieceBeatBudget(o.frameW, o.frameH);
  const rectAt = (Z: number) => alignedPhotoRect({ ...o, zoom: Z });
  const fitsStage = (r: Rect) => r.x >= o.margin && r.y >= o.margin && r.x + r.width <= o.stageW - o.margin && r.y + r.height <= o.stageH - o.margin;
  const onX = (r: Rect) => r.width <= b.photoMaxW;
  const onY = (r: Rect) => r.height <= b.photoMaxH;
  const best = (extra: (r: Rect) => boolean): number | null => {
    const zx = largestZoom((Z) => { const r = rectAt(Z); return extra(r) && onX(r); }, minZoom, o.maxZoom);
    const zy = largestZoom((Z) => { const r = rectAt(Z); return extra(r) && onY(r); }, minZoom, o.maxZoom);
    if (zx === null && zy === null) return null;
    return Math.max(zx ?? -Infinity, zy ?? -Infinity);
  };
  return best(fitsStage) ?? best(() => true) ?? minZoom;
}

export type PieceBeatLayout = {
  axis: PieceAxis;
  /** The photo during the piece beat: same size as `photo`, moved to the margin on `axis`. */
  parked: Rect;
  parkedX: number;
  parkedY: number;
  /** parked − photo: the slide (one of them is always 0). */
  dx: number;
  dy: number;
  pieceRect: Rect;
  gap: number;
};

/** Throws unless the two rects are separated by at least `gap` on the partition axis. */
export function assertPieceBeatDisjoint(axis: PieceAxis, parked: Rect, piece: Rect, gap: number): void {
  const ok = axis === "x" ? piece.x >= parked.x + parked.width + gap : piece.y >= parked.y + parked.height + gap;
  if (!ok) {
    throw new Error(
      `community-m: piece-beat layout contract violated on axis ${axis} — parked photo ${JSON.stringify(parked)} vs piece ${JSON.stringify(piece)} (gap ${gap}). This is a bug in the zoom cap, not the inputs.`,
    );
  }
}

/**
 * The piece beat's geometry. The photo keeps its size; the piece is
 * contain-fit into the remainder on the chosen axis. Throws when neither
 * axis has room — which `zoomPartitionCap` makes unreachable; the throw is
 * the contract, not a code path.
 */
export function pieceBeatLayout(o: { frameW: number; frameH: number; photo: Rect; piece: ImageSize }): PieceBeatLayout {
  const b = pieceBeatBudget(o.frameW, o.frameH);
  const axis = pieceAxisFor(o.photo, b);
  if (axis === null) {
    throw new Error(
      `community-m: the parked original (${o.photo.width}×${o.photo.height}) leaves the contributor canvas no room on a ${o.frameW}×${o.frameH} frame (needs width ≤ ${b.photoMaxW} or height ≤ ${b.photoMaxH}); the zoom cap must run first.`,
    );
  }
  const parked: Rect = axis === "x" ? { ...o.photo, x: b.margin } : { ...o.photo, y: b.margin };
  // The remainder past the gap — by construction on the far side of the photo.
  const area: Rect =
    axis === "x"
      ? { x: parked.x + parked.width + b.gap, y: b.margin, width: o.frameW - b.margin - (parked.x + parked.width + b.gap), height: o.frameH - 2 * b.margin }
      : { x: b.margin, y: parked.y + parked.height + b.gap, width: o.frameW - 2 * b.margin, height: o.frameH - b.margin - (parked.y + parked.height + b.gap) };
  const scale = Math.min(area.width / o.piece.width, area.height / o.piece.height);
  const width = Math.max(2, Math.floor((o.piece.width * scale) / 2) * 2);
  const height = Math.max(2, Math.floor((o.piece.height * scale) / 2) * 2);
  const pieceRect: Rect = {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
  assertPieceBeatDisjoint(axis, parked, pieceRect, b.gap);
  return { axis, parked, parkedX: parked.x, parkedY: parked.y, dx: parked.x - o.photo.x, dy: parked.y - o.photo.y, pieceRect, gap: b.gap };
}
