/**
 * Diagonal "gleam band" PNG — a soft white stripe at an angle on a
 * transparent canvas. The QR-stamp video template overlays this on
 * top of the QR with `blendMode: "screen"` and animates its
 * x-position so the band sweeps across the QR every `gleamPeriodSec` —
 * matching the production-feel shimmer used by the render-hero M.
 *
 * Generated inline per render via the shared resvg rasterizer. Cheap
 * (~30 ms on a tiny SVG) — orders of magnitude smaller than the
 * stamp wrap's re-encode pass, so prebuilding the PNG into a shipped
 * asset is not worth the build-step complexity.
 *
 * Pure procedural; deterministic given inputs.
 */

import * as fs from "fs";
import * as path from "path";

import { renderSvgToPngFile } from "../../../../_shared/svgRaster";
// Type-only import for the lazy `require()` below. `import type` is erased
// at compile time so the runtime lazy-load behavior is unchanged. The


export type GleamBandOpts = {
  /** Output PNG side length in pixels (square). Typically matches the QR's stampPx. */
  sizePx: number;
  /** Workspace directory the PNG is written into. */
  workspaceDir: string;
  /** Filename within workspaceDir. Defaults to "qr-stamp-gleam.png". */
  outputName?: string;
  /**
   * Band rotation angle in degrees clockwise from vertical. Positive
   * tilts the top of the band rightwards (the M render-hero shimmer
   * uses ~20°). Default 20.
   */
  angleDeg?: number;
  /**
   * Half-width of the bright stripe as a fraction of the inner gradient
   * bounding box (which is 3× the PNG side, since the inner rect is
   * oversized to give the rotation room). Default 0.018 — so the visible
   * stripe is roughly 11% of the PNG width: a tight specular line, not
   * a wash. The premium read comes from a thin bright peak with a soft
   * halo around it (see the 7-stop gradient in {@link buildGleamSvg}),
   * matching how a real reflection on glass would look — not a soft
   * full-bleed sweep, which is what the wider band reads as.
   */
  bandWidthFrac?: number;
  /**
   * Peak alpha at the band center (0..1). Default 0.4. Combined with
   * `blendMode: "screen"`, this is how bright the shine looks against
   * the orange QR modules. Lower than the previous 0.55 default
   * because the new peaked-falloff gradient concentrates more of the
   * brightness in a narrower core — same perceived "flash" intensity
   * with less white-out across the modules.
   */
  peakAlpha?: number;
};

const DEFAULTS = {
  outputName: "qr-stamp-gleam.png",
  angleDeg: 20,
  bandWidthFrac: 0.018,
  peakAlpha: 0.4,
};

function buildGleamSvg(opts: {
  sizePx: number;
  angleDeg: number;
  bandWidthFrac: number;
  peakAlpha: number;
}): string {
  const { sizePx, angleDeg, bandWidthFrac, peakAlpha } = opts;
  const half = bandWidthFrac;
  const mid = 0.5;
  // Peaked falloff: thin bright core at the center, soft halo around
  // it. This is the visual difference between "premium specular
  // highlight on glass" and "PowerPoint shine transition." The
  // previous gradient was a 3-stop linear triangle (0 → peak → 0
  // straight ramp) — which reads as a wide soft wash, not a real
  // reflection. The shape we want is closer to a Lorentzian peak:
  // nearly invisible at the band edges, a soft halo through the
  // middle, then a sharp bright crest right at the center.
  //
  // Six interior stops give us:
  //   - Band-edge anchor at alpha 0 (outer 100% of bandWidthFrac)
  //   - Halo shoulder at alpha = peakAlpha * 0.18 (at 60% inset)
  //   - Inner shoulder at alpha = peakAlpha * 0.5 (at 30% inset)
  //   - Crest at alpha = peakAlpha (center)
  //   - Mirror on the right side
  //
  // The two-step shoulder (0 → 0.18 → 0.5 → 1.0 normalized) makes
  // the alpha curve steepen as you approach the center. Linear
  // interpolation between these stops approximates the shape of a
  // real specular reflection without needing an SVG <filter>.
  const shoulderOffsetOuter = (mid - half) * 100;         // alpha 0
  const shoulderOffsetMid = (mid - half * 0.6) * 100;     // alpha 0.18*peak
  const shoulderOffsetInner = (mid - half * 0.3) * 100;   // alpha 0.5*peak
  const peakOffset = mid * 100;                           // alpha peak
  const shoulderOffsetInnerR = (mid + half * 0.3) * 100;
  const shoulderOffsetMidR = (mid + half * 0.6) * 100;
  const shoulderOffsetOuterR = (mid + half) * 100;
  const haloAlpha = peakAlpha * 0.18;
  const midAlpha = peakAlpha * 0.5;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sizePx} ${sizePx}">
  <defs>
    <linearGradient id="gleam" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="white" stop-opacity="0"/>
      <stop offset="${shoulderOffsetOuter.toFixed(3)}%" stop-color="white" stop-opacity="0"/>
      <stop offset="${shoulderOffsetMid.toFixed(3)}%" stop-color="white" stop-opacity="${haloAlpha.toFixed(3)}"/>
      <stop offset="${shoulderOffsetInner.toFixed(3)}%" stop-color="white" stop-opacity="${midAlpha.toFixed(3)}"/>
      <stop offset="${peakOffset.toFixed(3)}%" stop-color="white" stop-opacity="${peakAlpha.toFixed(3)}"/>
      <stop offset="${shoulderOffsetInnerR.toFixed(3)}%" stop-color="white" stop-opacity="${midAlpha.toFixed(3)}"/>
      <stop offset="${shoulderOffsetMidR.toFixed(3)}%" stop-color="white" stop-opacity="${haloAlpha.toFixed(3)}"/>
      <stop offset="${shoulderOffsetOuterR.toFixed(3)}%" stop-color="white" stop-opacity="0"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g transform="rotate(${angleDeg.toFixed(2)} ${sizePx / 2} ${sizePx / 2})">
    <rect x="${-sizePx}" y="${-sizePx}" width="${sizePx * 3}" height="${sizePx * 3}" fill="url(#gleam)"/>
  </g>
</svg>`.trim();
}

export async function generateGleamBandPng(
  opts: GleamBandOpts,
): Promise<{ pngPath: string }> {
  const outputName = opts.outputName ?? DEFAULTS.outputName;
  const angleDeg = opts.angleDeg ?? DEFAULTS.angleDeg;
  const bandWidthFrac = opts.bandWidthFrac ?? DEFAULTS.bandWidthFrac;
  const peakAlpha = opts.peakAlpha ?? DEFAULTS.peakAlpha;
  const sizePx = Math.max(16, Math.round(opts.sizePx));

  const svg = buildGleamSvg({ sizePx, angleDeg, bandWidthFrac, peakAlpha });
  fs.mkdirSync(opts.workspaceDir, { recursive: true });
  const pngPath = path.join(opts.workspaceDir, outputName);

  // High-quality rasterization with a bumped density. The band has soft
  // gradient edges so antialiasing matters more than the QR's hard
  // module edges — render at 2× and downsample for a clean falloff.
  const density = Math.max(72, Math.round((72 * sizePx * 2) / sizePx));
  // The SVG's viewBox is 0 0 sizePx sizePx, so fitting the width to sizePx is
  // exactly 1:1 — resvg antialiases analytically, so the old
  // render-at-density-then-lanczos-downscale step is unnecessary.
  await renderSvgToPngFile(svg, pngPath, sizePx);

  return { pngPath };
}

/**
 * Build the ffmpeg overlay xExpr for a periodic gleam sweep.
 *
 * The band PNG is the same natural size as the QR (so `w` in the
 * expression equals the band layer's width, which equals the QR's
 * width). The sweep traverses the band from offscreen-left to
 * offscreen-right over `sweepSec`, then the enable-gate on the
 * overlay (set in qr-stamp.ts) hides the layer for the remaining
 * `periodSec - sweepSec` — periodic rather than continuous.
 *
 * # Eased traversal
 *
 * The previous formula was linear (`min(1, mod(t,p)/sweep)`) — the
 * band moved at constant velocity then snapped park at +0.35w. The
 * constant velocity + hard park is what reads as "PowerPoint shine
 * transition." Real reflections accelerate from rest, blow through
 * the middle, decelerate at the other side — a cosine ease curve.
 *
 *   x_offset(t) = -X + X * (1 - cos(PI * t_norm))
 *
 *   where X = 0.7 * w
 *   and   t_norm = clamp(mod(t, periodSec) / sweepSec, 0, 1)
 *
 * Endpoint check:
 *   t_norm = 0    → cos(0)  =  1  → x = -X + X*(1-1)  = -X    (offscreen left)
 *   t_norm = 0.5  → cos(PI/2) = 0 → x = -X + X*(1-0)  =  0    (centered)
 *   t_norm = 1    → cos(PI) = -1  → x = -X + X*(1-(-1)) = +X  (offscreen right)
 *
 * Velocity (derivative of x w.r.t. t_norm):
 *   v = X * PI * sin(PI * t_norm)
 *   sin(0) = sin(PI) = 0 → v = 0 at the endpoints (smooth start / stop)
 *   sin(PI/2) = 1        → v = X*PI at center (peak speed)
 *
 * # Why X = 0.7w (offscreen entry / exit is safe)
 *
 * `overlay.xExpr` is an OFFSET on the destination — ffmpeg's overlay
 * filter does NOT clip the layer to its destination rect. For a
 * naive flat composition that would mean any sweep wider than the
 * band's footprint paints onto surrounding canvas content.
 *
 * BUT — the gleam in qr-stamp.ts is wrapped in a **nested mosaic**
 * (see `children["qr_stamp_gleam"]`), so the engine renders the
 * sweep into an intermediate framebuffer sized exactly to the QR
 * cell. The framebuffer's finite extent does the clipping for us:
 * any pixels the band tries to paint past the QR's bounds simply
 * have no buffer to land in. That makes ±0.7w safe — the band can
 * enter from fully offscreen-left and exit fully offscreen-right
 * without leaking onto canvas content.
 *
 * At 20° tilt + bandWidthFrac=0.018, the band's full horizontal
 * footprint is ~80% of sizePx (tilt's `sin(20°)` component dominates).
 * X=0.7 plus that half-footprint (~0.4) means the band is fully
 * offscreen at both extremes — clean enter, clean exit, no visible
 * pop at the enable-gate boundary.
 *
 * # Footgun if you copy this pattern elsewhere
 *
 * The ±0.7w range is ONLY safe because of the nested-mosaic wrap.
 * If you remove the nested mosaic and use a flat overlay, the band
 * will bleed onto surrounding content at the sweep extremes. See
 * the internal nested-mosaic-clip-pattern notes for the
 * general pattern.
 */
export function buildGleamSweepXExpr(
  periodSec: number,
  sweepSec: number,
): string {
  const p = periodSec > 0 ? periodSec : 6;
  const s = sweepSec > 0 ? sweepSec : 0.9;
  // `min(1, mod(t,p)/s)` clamps t_norm into [0, 1] across the sweep
  // window. After the sweep ends the enable-gate hides the layer
  // anyway, but the clamp keeps cos(PI*t_norm) well-defined even if
  // the gate is bypassed in a future caller.
  const tNorm = `min(1,mod(t,${p.toFixed(3)})/${s.toFixed(3)})`;
  return `(-0.7*w)+(0.7*w)*(1-cos(PI*${tNorm}))`;
}
