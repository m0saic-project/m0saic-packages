import type { MosaicColor, MosaicLavfiSource } from "@m0saic/types";
import { makeColorTile } from "@m0saic/template-utils";

/**
 * Paper-grid lattice for the wireframe family (the `grid-paper` preset /
 * `theme.paperGrid` knob).
 *
 * Until gate 29 the preset resolved `paperGrid: {enabled, stepFrac, alpha}`
 * and NOTHING drew it — the Layout page sold it as "Textbook — hand-drawn
 * paper grid" while it rendered as plain thumb-light. Audit-every-knob: a
 * knob that exists must be wired. The lattice is ONE extra source — a flat
 * ink tile masked to thin vertical + horizontal lines at the requested pitch,
 * blended at the requested alpha — appended as a full-canvas TOP overlay so
 * the graph-paper reads over the (opaque, rounded) thumb tiles. Interior
 * lines only: the canvas edge is the frame, not a rule.
 */

/** Default pitch as a fraction of the canvas's shorter side (16 rows @ 1080). */
export const PAPER_GRID_STEP_FRAC = 0.0625;
/** Default lattice ink alpha (matches the `grid-paper` preset). */
export const PAPER_GRID_ALPHA = 0.08;
/** Smallest pitch we draw — below this the lattice is noise, not paper. */
const MIN_STEP_PX = 8;

/**
 * SVG path of the lattice in a `w`×`h` box: interior rules every `stepPx`,
 * each `linePx` wide, as closed rects (non-zero fill; crossings simply
 * overlap). Deterministic, integer-snapped.
 */
export function paperGridPath(w: number, h: number, stepPx: number, linePx: number): string {
  const t = Math.max(1, Math.round(linePx));
  const step = Math.max(MIN_STEP_PX, Math.round(stepPx));
  const half = t / 2;
  const parts: string[] = [];
  for (let x = step; x < w - half; x += step) {
    const x0 = Math.round(x - half);
    parts.push(`M${x0} 0 h${t} v${h} h-${t} Z`);
  }
  for (let y = step; y < h - half; y += step) {
    const y0 = Math.round(y - half);
    parts.push(`M0 ${y0} h${w} v${t} h-${w} Z`);
  }
  return parts.join(" ");
}

/**
 * Append a full-canvas top overlay leaf to an m0 string: `X` → `X{1}`.
 *
 * A root that already carries an overlay (`A{B}`) cannot take a second one
 * (`A{B}{1}` is an OVERLAY_CHAIN error), so the leaf is nested into the
 * innermost root-overlay content instead: `A{B}` → `A{B{1}}`, `A{B{C}}` →
 * `A{B{C{1}}}`. Every overlay content is itself a valid root form (primitive
 * or split) spanning the parent rect, so the appended leaf always covers the
 * whole canvas and always paints LAST (document order = paint order).
 *
 * Input must be canonical-or-pretty m0 with no whitespace (what the props
 * schema validates); the caller re-validates via `toM0String`.
 */
export function appendTopOverlay(m0: string, leaf = "1"): string {
  let k = 0;
  while (k < m0.length && m0[m0.length - 1 - k] === "}") k++;
  const head = m0.slice(0, m0.length - k);
  return `${head}{${leaf}}${"}".repeat(k)}`;
}

/**
 * The lattice source: a flat `ink` tile masked to {@link paperGridPath},
 * blended at `alpha` via `overlay.alpha` (makeColorTile honours only
 * overlay / mask / placement / effects — opacity must ride the overlay).
 * `bounds` = the canvas, so the mask scales 1:1 when the leaf is the
 * full-canvas top overlay from {@link appendTopOverlay}.
 */
export function makePaperGridSource(opts: {
  width: number;
  height: number;
  ink: MosaicColor;
  stepFrac?: number;
  alpha?: number;
  linePx?: number;
}): MosaicLavfiSource {
  const w = Math.max(1, Math.round(opts.width));
  const h = Math.max(1, Math.round(opts.height));
  const minSide = Math.min(w, h);
  const stepFrac = opts.stepFrac ?? PAPER_GRID_STEP_FRAC;
  const stepPx = Math.max(MIN_STEP_PX, Math.round(minSide * stepFrac));
  const linePx = opts.linePx ?? Math.max(1, Math.round(minSide * 0.001));
  const alpha = Math.max(0, Math.min(1, opts.alpha ?? PAPER_GRID_ALPHA));
  return makeColorTile(opts.ink, {
    mask: {
      kind: "inline-mask",
      localPath: paperGridPath(w, h, stepPx, linePx),
      bounds: { x: 0, y: 0, width: w, height: h },
    },
    overlay: { alpha: String(alpha) },
  });
}
