/**
 * ============================================================================
 * anim/camera — legibility-driven auto zoom + keyframed follow camera
 * ============================================================================
 *
 * The camera is ONE scale+crop applied by the engine to a finished composite
 * ({@link MosaicCamera} on `effects.camera`), so it is depth-independent: it
 * follows a target identically whether the canvas has 4 tiles or 400. All
 * motion compiles to keyframe expressions over global `t` (via
 * `keyframeExpr`), so the pan stays frame-synced with everything else keyed
 * off the same timeline.
 *
 * Perf note (R10): a CONSTANT zoom is cheap (static `eval=init` scale + free
 * crop). The pull-back's animated zoom forces a per-frame scale — spend it
 * only on a deliberate ending, not casual effect.
 *
 * Extracted from dsl-tutorial's canvas camera; the domain policies stayed in
 * the template's adapter (WHICH steps become targets, WHEN the camera
 * settles). What lives here is camera-feel policy: the legibility zoom rule
 * and the pull-back envelope (hold ~2s of full view at the end). Output at
 * the defaults is byte-identical to `buildCanvasCamera`, locked by
 * deep-parity goldens captured from the live code.
 * ============================================================================
 */

import type { MosaicCamera } from "@m0saic/types";
import { keyframeExpr, type Keyframe } from "./keyframes";

/** One camera target: a rect to center on, and when to be settled on it. */
export type CameraTarget = {
  /** Bounds in the SOURCE's own coordinate space (the space frameW/frameH describe). */
  rect: { x: number; y: number; width: number; height: number };
  /** Time (s) the camera should be SETTLED (centered) on this rect. */
  atSec: number;
};

/** Min on-screen dimension (px) for a rect's content to paint legibly. */
export const CAMERA_LEGIBLE_PX = 104;
/** Don't bother zooming for a sliver of legibility gain. */
export const CAMERA_MIN_WORTH_ZOOM = 1.05;
/** Cap auto-zoom so even a pathologically dense layout keeps some context. */
export const CAMERA_MAX_AUTO_ZOOM = 4;
/** End-hold length target (s) for the pull-back. */
export const CAMERA_HOLD_TARGET_SEC = 2.0;

/**
 * Pick a zoom from LEGIBILITY: if every rect already renders legibly at
 * fit-to-panel, don't zoom (return 1). Otherwise zoom just enough that the
 * SMALLEST rect reaches a legible on-screen size — the minimum zoom, which
 * keeps the most context visible while the camera pans.
 *
 * Never zooms past what FITS the biggest rect: at zoom z the viewport shows
 * frameW/z × frameH/z of the source, so a rect larger than that would clip
 * (and targets beside it would pan off-screen). A full-bleed rect therefore
 * pins the zoom to 1. Caller pre-filters to the rects that need legibility.
 *
 * @param cellW/cellH  the on-screen panel size the source is displayed in.
 */
export function autoZoomForLegibility(
  rects: { width: number; height: number }[],
  frameW: number,
  frameH: number,
  cellW: number,
  cellH: number,
  opts?: { legiblePx?: number; minWorthZoom?: number; maxZoom?: number },
): number {
  const legiblePx = opts?.legiblePx ?? CAMERA_LEGIBLE_PX;
  const minWorthZoom = opts?.minWorthZoom ?? CAMERA_MIN_WORTH_ZOOM;
  const maxZoom = opts?.maxZoom ?? CAMERA_MAX_AUTO_ZOOM;

  if (frameW <= 0 || frameH <= 0 || cellW <= 0 || cellH <= 0) return 1;
  if (rects.length === 0) return 1;

  let minTilePx = Infinity;
  let maxTileW = 0;
  let maxTileH = 0;
  for (const r of rects) {
    const pxW = (r.width / frameW) * cellW;
    const pxH = (r.height / frameH) * cellH;
    minTilePx = Math.min(minTilePx, pxW, pxH);
    maxTileW = Math.max(maxTileW, r.width);
    maxTileH = Math.max(maxTileH, r.height);
  }
  if (!(minTilePx > 0)) return 1;

  const fitZoom = Math.min(
    maxTileW > 0 ? frameW / maxTileW : Infinity,
    maxTileH > 0 ? frameH / maxTileH : Infinity,
  );
  const z = Math.min(legiblePx / minTilePx, fitZoom);
  if (z < minWorthZoom) return 1; // already legible (or a full-bleed rect) → no zoom
  return Math.min(maxZoom, z);
}

/**
 * The `focus` value (0..1) that CENTERS a source-fraction `f` (0..1) in a
 * `zoom`× crop window, clamped so the window never leaves the source.
 *
 * The crop window's center sits at fraction ((zoom-1)/zoom)·focus + 1/(2·zoom)
 * of the source; solving "= f" for focus gives the expression below. A rect at
 * the very edge can't be perfectly centered without showing past the source,
 * so the result clamps to [0,1] (the camera bumps against the edge instead).
 * Requires zoom > 1 (at zoom 1 there is no crop window to place).
 */
export function centerFocus(f: number, zoom: number): number {
  const v = (f * zoom - 0.5) / (zoom - 1);
  return Math.max(0, Math.min(1, v));
}

/** The final pull-back-to-full-view-and-hold envelope. */
export type FollowCameraPullBack = {
  /** Timeline end (s). */
  endSec: number;
  /** Never start the pull-back before this (the last target's APPEAR time). */
  earliestStartSec: number;
  /** Preferred pull-back start (e.g. last settle + half a dwell). */
  settleOutSec: number;
  /** End-hold length target (s). Default {@link CAMERA_HOLD_TARGET_SEC}. */
  holdTargetSec?: number;
};

/**
 * Resolve the pull-back envelope to its two moments: when the camera STARTS
 * leaving (`outStartSec` — the 0.6s lead keeps the ease from feeling abrupt)
 * and when the full view ARRIVES (`zoomEndSec` — at least a 0.3s ease).
 * `active` is false when the tail is too short for any pull-back (the camera
 * holds its zoom to the end). ONE copy of this math exists — `followCamera`
 * uses it internally, and visual consumers (camera debuggers, UI timeline
 * bands) read the same numbers here.
 */
export function resolvePullBackEnvelope(pullBack: FollowCameraPullBack): {
  outStartSec: number;
  zoomEndSec: number;
  active: boolean;
} {
  const endT = pullBack.endSec;
  const holdTarget = pullBack.holdTargetSec ?? CAMERA_HOLD_TARGET_SEC;
  const outStartSec = Math.max(
    pullBack.earliestStartSec,
    Math.min(pullBack.settleOutSec, endT - holdTarget - 0.6),
  );
  const zoomEndSec = Math.min(endT, Math.max(outStartSec + 0.3, endT - holdTarget));
  return { outStartSec, zoomEndSec, active: endT > outStartSec + 1e-3 };
}

/**
 * The crop-window rect (source px) the camera shows for RESOLVED focus
 * values at a given zoom — the executable inverse of {@link centerFocus}:
 * window = frameW/zoom × frameH/zoom, top-left = focus·(frame − window).
 * What a camera debugger draws, and what a UI would show as the viewport.
 */
export function cameraViewportRect(
  focusX: number,
  focusY: number,
  zoom: number,
  frameW: number,
  frameH: number,
): { x: number; y: number; width: number; height: number } {
  const w = frameW / zoom;
  const h = frameH / zoom;
  return { x: focusX * (frameW - w), y: focusY * (frameH - h), width: w, height: h };
}

/**
 * Keyframed follow camera: eases focusX/focusY between per-target settle
 * keyframes (compiled via `keyframeExpr` — flat gated sums, parser-safe at
 * any target count), with an optional final pull-back that eases zoom → 1
 * and focus → center, then HOLDS the full view to the end.
 *
 * Pull-back envelope (camera-feel policy, one copy lives here): the hold
 * targets ~`holdTargetSec` seconds; the pull-back starts at
 * `max(earliestStartSec, min(settleOutSec, endSec - hold - 0.6))` (the 0.6s
 * lead keeps the ease from feeling abrupt) and the zoom-out takes at least
 * 0.3s. On very short tails this reproduces dsl-tutorial's shipped behavior
 * verbatim — the hold/center keys can land BEFORE the final settle key,
 * briefly overlapping gates (preserved for byte-parity; see the F2 Phase 2
 * report).
 *
 * Returns `undefined` when zoom ≤ 1 / no targets / degenerate frame. Without
 * `pullBack`, the zoom stays the constant number and only the focus animates.
 * Targets must be in settle-time order (sort before calling). Output IS the
 * wired engine primitive ({@link MosaicCamera}).
 */
export function followCamera(
  targets: CameraTarget[],
  frameW: number,
  frameH: number,
  zoom: number,
  pullBack?: FollowCameraPullBack,
): MosaicCamera | undefined {
  if (!(zoom > 1) || frameW <= 0 || frameH <= 0) return undefined;
  if (targets.length === 0) return undefined;

  const xs: Keyframe[] = [];
  const ys: Keyframe[] = [];
  for (const tg of targets) {
    const fx = (tg.rect.x + tg.rect.width / 2) / frameW;
    const fy = (tg.rect.y + tg.rect.height / 2) / frameH;
    xs.push({ t: tg.atSec, v: centerFocus(fx, zoom) });
    ys.push({ t: tg.atSec, v: centerFocus(fy, zoom) });
  }

  if (!pullBack) {
    return { zoom, focusX: keyframeExpr(xs), focusY: keyframeExpr(ys) };
  }

  const { outStartSec: outStart, zoomEndSec: zoomEndT, active } = resolvePullBackEnvelope(pullBack);
  if (active) {
    xs.push({ t: outStart, v: xs[xs.length - 1].v }); // hold the last focus, then…
    ys.push({ t: outStart, v: ys[ys.length - 1].v });
    xs.push({ t: zoomEndT, v: 0.5 }); // …pan to center by zoomEndT; the compiler
    ys.push({ t: zoomEndT, v: 0.5 }); //    then tail-HOLDS center to endSec
  }

  // Zoom holds through the walk, eases to 1 by zoomEndT, then the last
  // keyframe's value (1) tail-holds through the end hold. No tail → hold zoom.
  const zoomExpr =
    active
      ? keyframeExpr([
          { t: outStart, v: zoom },
          { t: zoomEndT, v: 1 },
        ])
      : keyframeExpr([{ t: outStart, v: zoom }]);

  return { zoom: zoomExpr, focusX: keyframeExpr(xs), focusY: keyframeExpr(ys) };
}
