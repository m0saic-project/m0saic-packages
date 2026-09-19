import type { MosaicDocument } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";

export type LoadedPiece = { doc: MosaicDocument; declaredMs: number; size: { width: number; height: number } };

/** How far the canvas starts inside its box before the pop (1/POP_SCALE of its size). */
export const POP_SCALE = 1 / 0.84;

/**
 * The contributor canvas, ready to pop: a wrapper that declares POP_SCALE×
 * the fitted box and centres the piece (at its own declared size, contain-
 * fit to `fitW×fitH`) inside it. Placed into a `fitW×fitH` box, the wrapper
 * shows the piece at 84 %; a camera zoom 1 → POP_SCALE over `popMs`
 * magnifies it to exactly the box — a scale-in "pop" from the engine's
 * crop camera (which only ever magnifies). The wrapper's canvas colour
 * matches the frame's, so the air around the piece is invisible.
 */
export function popWrapperDoc(o: {
  fitW: number;
  fitH: number;
  fps: number;
  durationMs: number;
  piece: LoadedPiece;
  canvasColor: string;
}): MosaicDocument {
  const cw = Math.max(o.fitW + 2, Math.round((o.fitW * POP_SCALE) / 2) * 2);
  const ch = Math.max(o.fitH + 2, Math.round((o.fitH * POP_SCALE) / 2) * 2);
  // ONE cell + a symmetric inset, not a placeRect grid: centring by margins
  // costs a slot per pixel of margin (thousands), which drops the layout
  // under the planner's px-per-weight floor and squashes cells.
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String("1", "CommunityMV1-pop"),
    size: { width: cw, height: ch },
    fps: o.fps,
    durationMs: o.durationMs,
    backgroundColor: o.canvasColor as never,
    assets: {},
    children: { piece: { ...o.piece.doc, fps: o.fps, durationMs: o.durationMs } },
    sources: [{ type: "mosaic", ref: "piece", placement: { fit: "contain", inset: { x: (cw - o.fitW) / 2 / cw, y: (ch - o.fitH) / 2 / ch } } }],
  };
}
