import type { MosaicCamera } from "@m0saic/types";
import { centerFocus, keyframeExpr } from "@m0saic/template-utils";

/** Auto-zoom is capped here: past it the M is upscaled past its native pixels. */
export const AUTO_ZOOM_MAX = 4;
export const AUTO_ZOOM_MIN = 1.2;

/**
 * Zoom so the tile fills ~`fill` of the frame's TIGHTER axis (the tile's
 * aspect decides which), clamped to [1.2, 4]. `tile` is in stage pixels.
 */
export function autoZoomForTile(tile: { width: number; height: number }, stageW: number, stageH: number, fill = 0.55): number {
  const zx = stageW / (tile.width / fill);
  const zy = stageH / (tile.height / fill);
  return Math.max(AUTO_ZOOM_MIN, Math.min(AUTO_ZOOM_MAX, Math.min(zx, zy)));
}

/**
 * A dolly from the whole M into one tile: zoom keyframes 1 → Z between
 * `startSec` and `endSec`, focus fixed on the tile's centre so the move
 * lands exactly centred at Z. Two keys — nowhere near the expression parse
 * cliff. `hold` (default) keeps Z afterwards; with `reverse` the move runs
 * Z → 1 (the outro).
 */
export function zoomToTileCamera(o: {
  tile: { x: number; y: number; width: number; height: number };
  stageW: number;
  stageH: number;
  zoom: number;
  startSec: number;
  endSec: number;
  reverse?: boolean;
}): MosaicCamera {
  const Z = o.zoom;
  const fx = (o.tile.x + o.tile.width / 2) / o.stageW;
  const fy = (o.tile.y + o.tile.height / 2) / o.stageH;
  const from = o.reverse ? Z : 1;
  const to = o.reverse ? 1 : Z;
  return {
    zoom: keyframeExpr([{ t: o.startSec, v: from }, { t: o.endSec, v: to }]),
    focusX: centerFocus(fx, Z),
    focusY: centerFocus(fy, Z),
  };
}

/** A fixed camera parked on the tile at Z (the reveal step's backdrop). */
export function parkedCamera(o: { tile: { x: number; y: number; width: number; height: number }; stageW: number; stageH: number; zoom: number }): MosaicCamera {
  const fx = (o.tile.x + o.tile.width / 2) / o.stageW;
  const fy = (o.tile.y + o.tile.height / 2) / o.stageH;
  return { zoom: o.zoom, focusX: centerFocus(fx, o.zoom), focusY: centerFocus(fy, o.zoom) };
}
