/**
 * ============================================================================
 * dsl-tutorial — geometry cursor projection
 * ============================================================================
 *
 * The cursor is the thin orange box that sits at the current X/Y/W/H bounds and
 * LEADS the parse: it jumps + resizes the instant the geometry changes (a split
 * shrinks it to the first child, a comma slides it to the next sibling, a close
 * grows it back to the parent), and the cell then emits into it.
 *
 * The cursor SNAPS per step — it never interpolates between two positions — so
 * it's modelled as a list of enable-GATED rects, one per distinct position, each
 * lit for its time window. The canvas panel draws each as a thin inline-mask
 * RING (depth-cheap, reuses the split-overlay machinery); only one is ever
 * visible at a time. This replaces the old per-frame `geq` expression: `geq`
 * re-evaluates per PIXEL per FRAME (multiplying render cost by pixels×frames) to
 * solve a continuous-motion problem the cursor doesn't have. We already compute
 * every cursor rect in `buildSteps` — baking them as rects is just emitting what
 * we know, and it's near-free at render time.
 *
 * Rects are FRACTIONS (0..1) of the canvas; the canvas panel multiplies by its
 * own pixel dims, so they're resolution-independent (the panel renders at a slot
 * size that differs from the parse size).
 *
 * Consecutive steps that don't move the cursor collapse into one rect (its
 * window spans both) — fewer overlay layers, which keeps dense layouts further
 * from the ~25 overlay-depth mask-drop ceiling.
 * ============================================================================
 */

import type { Step } from "./buildSteps";
import type { Timing } from "./timing";

/** One cursor position, lit for `[activeStartSec, activeEndSec)`. */
export type CursorRect = {
  /** Bounds as fractions (0..1) of the whole canvas. */
  xFrac: number;
  yFrac: number;
  wFrac: number;
  hFrac: number;
  activeStartSec: number;
  activeEndSec: number;
};

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/**
 * Build the enable-gated cursor rects from the step cursor rects. One entry per
 * DISTINCT position; each spans from its first step's start to the next distinct
 * position's start (the last runs to the end of the timeline). Deterministic.
 */
export function buildCursorRects(
  steps: Step[],
  timing: Timing,
  parseW: number,
  parseH: number,
): CursorRect[] {
  if (steps.length === 0 || parseW <= 0 || parseH <= 0) return [];

  // Collapse consecutive identical positions into one window.
  const runs: { x: number; y: number; w: number; h: number; start: number }[] = [];
  for (const s of steps) {
    const x = s.rect.x / parseW;
    const y = s.rect.y / parseH;
    const w = s.rect.width / parseW;
    const h = s.rect.height / parseH;
    const last = runs[runs.length - 1];
    if (last && near(last.x, x) && near(last.y, y) && near(last.w, w) && near(last.h, h)) {
      continue; // same position — its window extends through this step
    }
    runs.push({ x, y, w, h, start: timing.stepStartSec(s.index) });
  }

  const endSec = timing.durationMs / 1000;
  return runs.map((r, i) => ({
    xFrac: r.x,
    yFrac: r.y,
    wFrac: r.w,
    hFrac: r.h,
    activeStartSec: r.start,
    activeEndSec: i + 1 < runs.length ? runs[i + 1].start : endSec,
  }));
}
