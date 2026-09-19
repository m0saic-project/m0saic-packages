/**
 * Pure geometry → m0 builders for placing a single stamp (watermark,
 * badge, logo) on a base canvas.
 *
 * Generalizes the corner-only `buildCornerStampM0` (codes/
 * qrStampExpressions.ts) to all nine standard positions plus an exact
 * caller-supplied rect: the cell IS the stamp rect (margins are baked
 * into the rect's x/y by {@link resolveStampRect}), so edge-centered
 * and centered positions need no corner-gutter trick.
 *
 * All functions are deterministic and side-effect free. Layout math is
 * integer-final — `placeRect` throws on non-integer inputs.
 */

import type { M0String } from "@m0saic/dsl";
import { placeRect } from "@m0saic/dsl-stdlib";

// ── Types ─────────────────────────────────────────────────────

/** The nine standard stamp placements (corners, edge centers, center). */
export type StampPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** Exact stamp cell in canvas pixels (integers). */
export type StampRectPx = { x: number; y: number; w: number; h: number };

/** Options for {@link resolveStampRect}. */
export type ResolveStampRectOptions = {
  canvasW: number;
  canvasH: number;
  position: StampPosition;
  /** Stamp width as a fraction of the size basis. */
  sizeRatio: number;
  /** Which canvas dimension `sizeRatio` measures against. */
  sizeBasis: "min" | "width" | "height";
  /** Margin between stamp and canvas edges, fraction of min(W, H). */
  marginRatio: number;
  /** Intrinsic w/h of the stamp artwork; the rect preserves it. */
  contentAspect: number;
};

/** Options for {@link buildStampM0}. */
export type StampLayoutOptions = {
  canvasW: number;
  canvasH: number;
  /** Exact stamp cell. Callers compute it via {@link resolveStampRect} or the m0 escape hatch. */
  rect: StampRectPx;
  /** Number of nested overlay layers hosting the stamp (1 single variant, 2 light/dark). */
  overlayCount: number;
};

/** Result from {@link buildStampM0}. */
export type StampLayout = {
  /** Composed m0: `F{<cell>{<cell>…}}` with `overlayCount` layers. */
  m0: M0String;
  /** Placed cell dims (equal to the rect's). */
  cellW: number;
  cellH: number;
};

// ── Constants ─────────────────────────────────────────────────

/**
 * Floor for the stamp's computed width. Smaller than the QR stamp's 64
 * (a logo/wordmark stays legible below scannable-QR size); tiny
 * canvases clamp margins down rather than erroring.
 */
export const MIN_STAMP_PX = 24;

// ── resolveStampRect ──────────────────────────────────────────

/**
 * Clamp the margin so at least `MIN_STAMP_PX` (or the whole axis, when
 * even that doesn't fit) of usable room remains on the axis.
 */
function guardMargin(canvasPx: number, marginPx: number): number {
  const minRoom = Math.min(MIN_STAMP_PX, canvasPx);
  if (canvasPx - 2 * marginPx >= minRoom) return marginPx;
  return Math.max(0, Math.floor((canvasPx - minRoom) / 2));
}

/**
 * Resolve the exact stamp cell for a standard position.
 *
 * `sizeRatio` sets the stamp WIDTH along the chosen basis; height
 * follows `contentAspect`. When the aspect-derived height would exceed
 * the available vertical room, the rect shrinks to fit (aspect
 * preserved). Margins clamp down on tiny canvases instead of throwing —
 * a degenerate canvas still gets a watermark.
 */
export function resolveStampRect(opts: ResolveStampRectOptions): StampRectPx {
  const { canvasW, canvasH, position, sizeRatio, sizeBasis, marginRatio, contentAspect } = opts;
  if (!Number.isInteger(canvasW) || canvasW < 1) {
    throw new Error(`resolveStampRect: canvasW must be a positive integer, got ${canvasW}`);
  }
  if (!Number.isInteger(canvasH) || canvasH < 1) {
    throw new Error(`resolveStampRect: canvasH must be a positive integer, got ${canvasH}`);
  }
  if (!(sizeRatio > 0)) {
    throw new Error(`resolveStampRect: sizeRatio must be > 0, got ${sizeRatio}`);
  }
  if (!(contentAspect > 0) || !Number.isFinite(contentAspect)) {
    throw new Error(`resolveStampRect: contentAspect must be a positive finite number, got ${contentAspect}`);
  }
  if (!(marginRatio >= 0)) {
    throw new Error(`resolveStampRect: marginRatio must be >= 0, got ${marginRatio}`);
  }

  const min2 = Math.min(canvasW, canvasH);
  const basisPx = sizeBasis === "width" ? canvasW : sizeBasis === "height" ? canvasH : min2;

  let marginPx = Math.max(0, Math.round(marginRatio * min2));
  marginPx = Math.min(guardMargin(canvasW, marginPx), guardMargin(canvasH, marginPx));

  const availW = Math.max(1, canvasW - 2 * marginPx);
  const availH = Math.max(1, canvasH - 2 * marginPx);

  let w = Math.round(sizeRatio * basisPx);
  w = Math.max(Math.min(MIN_STAMP_PX, availW), Math.min(w, availW));
  let h = Math.max(1, Math.round(w / contentAspect));
  if (h > availH) {
    h = availH;
    w = Math.max(1, Math.min(availW, Math.round(h * contentAspect)));
  }

  const hGap = canvasW - w;
  const vGap = canvasH - h;
  const [hPos, vPos] = splitPosition(position);
  const x = hPos === "left" ? marginPx : hPos === "right" ? hGap - marginPx : Math.floor(hGap / 2);
  const y = vPos === "top" ? marginPx : vPos === "bottom" ? vGap - marginPx : Math.floor(vGap / 2);

  return { x: clampInt(x, 0, hGap), y: clampInt(y, 0, vGap), w, h };
}

function splitPosition(position: StampPosition): ["left" | "center" | "right", "top" | "center" | "bottom"] {
  switch (position) {
    case "top-left": return ["left", "top"];
    case "top-center": return ["center", "top"];
    case "top-right": return ["right", "top"];
    case "center-left": return ["left", "center"];
    case "center": return ["center", "center"];
    case "center-right": return ["right", "center"];
    case "bottom-left": return ["left", "bottom"];
    case "bottom-center": return ["center", "bottom"];
    case "bottom-right": return ["right", "bottom"];
    default: {
      const never: never = position;
      throw new Error(`resolveStampRect: unknown position ${String(never)}`);
    }
  }
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ── buildStampM0 ──────────────────────────────────────────────

/**
 * Build the stamp m0: outer `F` = base media (fills the canvas), plus
 * `overlayCount` nested overlay layers each carving the exact stamp
 * cell via `placeRect`'s x/y mode. Same nesting shape as
 * `buildCornerStampM0` — `F{cell{cell…}}` — but position-agnostic.
 */
export function buildStampM0(opts: StampLayoutOptions): StampLayout {
  const { canvasW, canvasH, rect, overlayCount } = opts;
  if (!Number.isInteger(overlayCount) || overlayCount < 1) {
    throw new Error(`buildStampM0: overlayCount must be a positive integer, got ${overlayCount}`);
  }
  const { m0: cellM0 } = placeRect({
    rootW: canvasW,
    rootH: canvasH,
    rectW: rect.w,
    rectH: rect.h,
    x: rect.x,
    y: rect.y,
  });
  const open = Array.from({ length: overlayCount }, () => `{${cellM0}`).join("");
  const close = "}".repeat(overlayCount);
  const m0 = `F${open}${close}` as M0String;
  return { m0, cellW: rect.w, cellH: rect.h };
}
