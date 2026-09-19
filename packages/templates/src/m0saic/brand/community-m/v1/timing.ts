import type { MosaicEngineContext } from "@m0saic/types";
import { resolvePinnedDurationMs } from "@m0saic/template-utils";
import type { ResolvedProps } from "./props";

export type Timeline = {
  introVisibleMs: number; // hold + zoom + tile hold
  introHoldMs: number;
  zoomMs: number;
  tileHoldMs: number;
  revealMs: number;
  /** The original's slide aside (and back). */
  slideMs: number;
  /** The canvas pop at the top of the piece beat (inside pieceVisibleMs). */
  popMs: number;
  pieceVisibleMs: number;
  outroMs: number;
  closerMs: number;
  xfadeMs: number;
  totalMs: number;
  source: "natural" | "pinned";
};

const PIECE_MIN_MS = 500;

/**
 * Visible time per beat. The stitched pipeline equals `totalMs` exactly
 * (fades ride on the outgoing step). A pinned duration (`--durationMs` /
 * Make) is honoured by shrinking the piece window first, then scaling the
 * harness beats; below the floor the caller shows an error card.
 */
export function resolveTimeline(p: ResolvedProps, declaredPieceMs: number, ctx: MosaicEngineContext): { ok: true; timeline: Timeline } | { ok: false; error: string } {
  const r = (n: number) => Math.max(0, Math.round(n));
  let introHoldMs = r(p.introMs), zoomMs = r(p.zoomMs), tileHoldMs = r(p.holdMs), revealMs = r(p.revealMs), slideMs = r(p.slideMs), outroMs = r(p.outroMs), closerMs = r(p.closerMs);
  const xfadeMs = r(p.xfadeMs);
  let pieceVisibleMs = r(Math.min(declaredPieceMs, p.pieceMaxMs));
  // reveal + slide play twice: out to the canvas, and back to the M.
  const harness = () => introHoldMs + zoomMs + tileHoldMs + 2 * (revealMs + slideMs) + outroMs + closerMs;
  let source: Timeline["source"] = "natural";

  const pinned = resolvePinnedDurationMs(ctx);
  if (pinned !== undefined) {
    source = "pinned";
    const target = r(pinned);
    const minTotal = 1200 + PIECE_MIN_MS; // absolute floor: a few hundred ms per beat
    if (target < minTotal) return { ok: false, error: `pinned duration ${target} ms is too short (minimum ${minTotal} ms)` };
    if (target >= harness() + PIECE_MIN_MS) {
      pieceVisibleMs = Math.min(pieceVisibleMs, target - harness());
      if (harness() + pieceVisibleMs < target) pieceVisibleMs = target - harness(); // stretch the piece to fill
    } else {
      pieceVisibleMs = PIECE_MIN_MS;
      const k = (target - PIECE_MIN_MS) / harness();
      introHoldMs = r(introHoldMs * k); zoomMs = r(zoomMs * k); tileHoldMs = r(tileHoldMs * k);
      revealMs = r(revealMs * k); slideMs = r(slideMs * k); outroMs = r(outroMs * k); closerMs = r(closerMs * k);
      // absorb rounding into the outro so the total is exact (the reveal runs twice)
      outroMs += target - (harness() + pieceVisibleMs);
    }
  }
  const totalMs = harness() + pieceVisibleMs;
  return {
    ok: true,
    timeline: {
      introVisibleMs: introHoldMs + zoomMs + tileHoldMs, introHoldMs, zoomMs, tileHoldMs, revealMs, slideMs,
      popMs: Math.min(r(p.popMs), Math.floor(pieceVisibleMs / 2)),
      pieceVisibleMs, outroMs, closerMs,
      xfadeMs: Math.min(xfadeMs, Math.floor(Math.min(pieceVisibleMs, outroMs) / 2)),
      totalMs, source,
    },
  };
}
