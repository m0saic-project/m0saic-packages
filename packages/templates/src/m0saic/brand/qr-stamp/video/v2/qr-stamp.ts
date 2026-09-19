import * as path from "node:path";

import type {
  LuminanceBucket,
  MosaicAssetManifest,
  MosaicDocument,
  MosaicEngineContext,
  MosaicOverlayExpr,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  buildCornerStampM0,
  buildEntranceExpr,
  composeAlpha,
  defineMosaicTemplate,
  definePropsSchema,
  makeErrorMosaic,
  registerTemplate,
} from "@m0saic/template-utils";
import {
  buildWindowsAlphaExpr,
  groupWindowsByVariant,
  pickVariantForWindow,
  planWindows,
  type QrVariant,
} from "./windows";

/**
 * Brand-mark QR stamp, v2.
 *
 * Composites the committed animated brand QR (`@m0saic/media/qr/animate/v1`,
 * pre-rendered to mp4 at 1222×1222) onto a base video, in one or more time
 * windows whose count + width come from a coverage tier keyed on the input
 * clip duration:
 *
 *   ≤   8s   →  90% visible — ONE retimed window from t=0
 *   ≤  20s   → 62.5% visible — one or more natural-speed windows
 *   ≤  60s   →   55% visible
 *   ≤   5m   →   32% visible
 *   >   5m   →   18% visible — many windows spread across the clip
 *
 * Those coverage tiers apply to clips of AT LEAST one full animation cycle
 * (`QR_ANIMATE_NATURAL_DUR_MS`). Shorter clips can't hold a windowed/retimed
 * animation long enough to be scannable, so they bypass windowing (see the
 * short-clip block in `render`): below ~2.5s the M-cutout mp4 is FROZEN on a
 * fully-assembled frame (a true static image); between that and one cycle it
 * plays at natural speed with NO fade-out (quick spawn + continuous M, held
 * to the clip end). Both reuse the committed mp4 — no live render.
 *
 * Per window, the variant (white-card "light" vs black-card "dark") is picked
 * from a per-region luminance probe so the CARD tones with the underlying
 * frame (cohesion, not contrast — the orange modules carry the contrast).
 *
 * Two patterns under one renderer:
 *
 *  - SHORT clips (single-window mode): one looping source whose playback is
 *    retimed (`playSpeed = naturalDur / windowDur`) so the animation fills
 *    the window; the window's alpha ramp fades the card out at its end.
 *
 *  - LONG clips (multi-window mode): up to TWO looping sources (one per
 *    used variant), each gated by an alpha expression that ramps in/out at
 *    every window boundary. Windows are slot-aligned to multiples of
 *    `qrNaturalDurMs` so each loop-cycle boundary lands exactly at the
 *    window's `startMs` — the user sees the animation play from frame 0
 *    every time.
 *
 * Window visibility is gated via `overlay.alpha` (not `overlay.enable`) so
 * the card itself fades in and out at boundaries — without that the engine
 * snap-cuts the opaque card on the last frame of each window.
 *
 * Engine-pure: probe + duration come in as props (`luminanceBuckets`,
 * `videoDurationMs`). The CLI / wrapper layer fills them in before invoking
 * the template (same pattern as v1).
 */

// Must match build-qr-rendered.cjs NATURAL_DUR_MS — the committed mp4s'
// natural duration. Changing this without re-rendering the assets breaks
// the slot-aligned loop trick in multi-window mode.
const QR_ANIMATE_NATURAL_DUR_MS = 7020;

// Per-window fade-in / fade-out at the alpha layer. ~400ms reads as
// premium without dragging on the appearance.
const WINDOW_FADE_IN_SEC = 0.4;
const WINDOW_FADE_OUT_SEC = 0.4;

// Short-clip handling. Below one full animation cycle the windowed/retimed
// animation can't settle long enough to scan (a 2s clip would still be
// spawning when it ends) — bad for attribution. We drop the windowing:
//   < STATIC_MAX_MS  → a committed STATIC PNG (a fully-assembled M-cutout
//                      frame baked from the mp4, see tools/build-qr-static-
//                      stills.cjs) → a true still, opaque, held the whole clip.
//   else (< cycle)   → the committed mp4 at natural speed with NO fade-out →
//                      quick spawn + continuous M, held to the clip end.
// Both get a brief entrance fade so there's no hard pop at t=0. The PNG path
// is used for the static tier because an `image` source is an infinite still
// — it sidesteps the video freeze/clip filter path entirely (which mishandled
// alpha and left the QR half-transparent).
const STATIC_MAX_MS = 2500;
const SHORT_FADE_IN_SEC = 0.2;
const STATIC_FADE_IN_SEC = 0.15;

// Committed assets are siblings of this file's package, under
// `../assets/` (the brand pack owns the attribution binaries; baked
// from media/qr/animate/v1). `__dirname` resolves to dist/ at runtime
// (CommonJS build) and src/ under ts-jest — both have the assets after
// `npm run build -w @m0saic/templates` (copy-assets mirrors them).
const QR_ANIMATE_ASSETS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "assets",
);

// When the templates package is bundled inside a packaged Electron
// app's `app.asar`, paths constructed from `__dirname` point INTO the
// asar archive — which external tools like ffmpeg can't open ("Not a
// directory"). electron-builder's `asarUnpack` writes a parallel
// `app.asar.unpacked/` directory with the same files. Translate the
// path so spawn-based consumers (ffmpeg/ffprobe) get a real disk path.
// No-op for non-Electron consumers (the CLI) — neither path segment
// appears.
function unpackedAsarPath(p: string): string {
  const inAsar = `${path.sep}app.asar${path.sep}`;
  if (!p.includes(inAsar)) return p;
  return p.split(inAsar).join(`${path.sep}app.asar.unpacked${path.sep}`);
}

const VARIANT_ASSET_PATH: Record<QrVariant, string> = {
  light: unpackedAsarPath(path.join(QR_ANIMATE_ASSETS_DIR, "qr-animate.light.mp4")),
  dark: unpackedAsarPath(path.join(QR_ANIMATE_ASSETS_DIR, "qr-animate.dark.mp4")),
};

// Static stills baked from the mp4s (a fully-assembled frame), used by the
// short-clip static tier. Regenerated by tools/build-qr-static-stills.cjs.
const VARIANT_STATIC_PATH: Record<QrVariant, string> = {
  light: unpackedAsarPath(path.join(QR_ANIMATE_ASSETS_DIR, "qr-animate.light.static.png")),
  dark: unpackedAsarPath(path.join(QR_ANIMATE_ASSETS_DIR, "qr-animate.dark.static.png")),
};

export type QrStampVideoV2Props = {
  /** Path to the base video file the QR will be stamped onto. Required. */
  videoPath?: string;
  /**
   * Total duration of the input video, ms. The wrapper / orchestrator
   * probes this with ffprobe and passes it in. Falls back to
   * `ctx.target.durationMs` when omitted (useful for tests).
   */
  videoDurationMs?: number;
  /**
   * Pre-computed luminance probe of the QR's destination rect. Each window's
   * variant (light / dark) is picked from the average YAVG over its time
   * range. When empty, both windows default to "dark" (neutral threshold).
   */
  luminanceBuckets?: LuminanceBucket[];
  /** QR cell size as a percent of min(canvasW, canvasH). */
  qrSizePct?: number;
  /** Gutter from the bottom-right edge, px. */
  qrInsetPx?: number;
  /** Overall opacity of the stamped QR, 0..1. Softens the sticker look. */
  qrAlpha?: number;
  /**
   * Override the coverage tier. Fraction in [0, 1]. When omitted, the tier
   * is picked by `videoDurationMs`.
   */
  coverageOverride?: number;
  /**
   * Variant-pick threshold, 0..255. Region YAVG ≥ threshold → light variant.
   */
  variantLumaThreshold?: number;
  /**
   * Minimum gap between consecutive multi-window appearances, ms. The QR
   * fading out and immediately spawning again in the adjacent slot feels
   * twitchy; this forces breathing room between picks. When the requested
   * window count won't fit with the gap, planning falls back to one
   * retimed single-window playback that covers the same total visible
   * time. Default 3000ms.
   */
  minGapMs?: number;
};

const DEFAULTS = {
  // ⭐ 2026-09-08 — raised 18 → 26 (founder: the attribution stamp is the main
  // revenue-conversion surface, so it should read at a glance). Also fixes a
  // scannability floor: at 18% a 512x512 render gave 92px ≈ 3.2 px per QR
  // module, under the ~4 px practical scan threshold; 26% gives 133px ≈ 4.6.
  // NOTE: the basis is still min(W,H), so WIDE canvases stay under-served
  // (1920x400 → 104px ≈ 3.6/module even at 26%) — that is the separate,
  // still-open basis question, not something a bigger percentage fixes.
  qrSizePct: 26,
  qrInsetPx: 24,
  qrAlpha: 0.92,
  variantLumaThreshold: 128,
};

const propsSchema = definePropsSchema<QrStampVideoV2Props>({
  videoPath: {
    type: "media",
    required: true,
    description: "Path to the base video file to stamp.",
    meta: { control: { picker: "file", accept: ["video"] } },
  },
  videoDurationMs: {
    meta: { control: { placeholder: "render length" } },
    type: "number",
    required: false,
    description:
      "Total duration of the input video, ms (filled by the wrapper).",
  },
  luminanceBuckets: {
    type: "json",
    required: false,
    description:
      "Pre-computed luminance buckets for the QR's destination rect.",
  },
  qrSizePct: {
    type: "number",
    required: false,
    description: "QR cell size as a percent of min(W, H).",
    meta: { constraints: { min: 1, max: 50 } },
  },
  qrInsetPx: {
    type: "number",
    required: false,
    description: "Padding from the bottom-right edge, px.",
    meta: { constraints: { min: 0, max: 500 } },
  },
  qrAlpha: {
    type: "number",
    required: false,
    description: "Overall opacity of the stamped QR, 0..1.",
    meta: { constraints: { min: 0, max: 1 } },
  },
  coverageOverride: {
    type: "number",
    required: false,
    description: "Override the coverage tier (0..1).",
    meta: { control: { placeholder: "auto" }, constraints: { min: 0, max: 1 } },
  },
  variantLumaThreshold: {
    type: "number",
    required: false,
    description: "YAVG threshold for the light/dark variant pick.",
    meta: { constraints: { min: 0, max: 255 } },
  },
  minGapMs: {
    type: "number",
    required: false,
    description:
      "Minimum gap between consecutive multi-window QR appearances, ms.",
    meta: { control: { placeholder: "auto" }, constraints: { min: 0, max: 60_000 } },
  },
});

export const QrStampVideoV2 = defineMosaicTemplate<QrStampVideoV2Props>({
  id: asTemplateId("@m0saic/brand/qr-stamp/video/v2"),
  label: "QR Brand Attribution — Video",
  version: 2,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the baked brand QR —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description:
    "The official m0saic attribution stamp for VIDEO deliverables — the exact template the free tier runs on every rendered video. Plays the committed qr-animate brand mark in one or more time windows scaled to clip duration; each window's light/dark card is picked from a region luminance probe. Exists solely for that hook; to stamp your own media, use QR Stamp.",
  capabilities: {
    tier: "capability",
    caps: { fs: { read: true, write: true, temp: true } },
  },
  // INTERNAL, not deprecated (re-flagged 2026-07-21; was mis-filed as
  // `deprecated` since 2026-05-23): this is a LIVE product surface — the
  // post-render free-tier watermark hook (`@m0saic/product/postRenderWrapper`)
  // depends on this template's pre-baked-mp4 + windowed visibility coverage
  // for every video deliverable. `internal: true` removes it from user
  // discovery (its pre-baked animation mp4s offer no live param control);
  // direct user invocations should pick `QR Stamp` (the primitive)
  // or `Brand QR — Carve` (centre asset, no stamp).
  internal: true,
  tags: ["brand", "qr", "watermark", "free-tier", "animated", "internal"],

  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 10000,
    format: { kind: "video", container: "mp4" },
  },

  propsSchema,
  defaultProps: DEFAULTS,

  async render(
    props: QrStampVideoV2Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    if (!props.videoPath) {
      return makeErrorMosaic(
        "QrStampVideoV2: videoPath prop is required (the base video to stamp).",
        {
          title: "QR Brand Attribution — Video",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }

    const videoDurMs =
      props.videoDurationMs ?? ctx.target.durationMs ?? undefined;
    if (videoDurMs == null || !Number.isFinite(videoDurMs) || videoDurMs <= 0) {
      return makeErrorMosaic(
        "QrStampVideoV2: videoDurationMs is required (the wrapper probes this via ffprobe).",
        {
          title: "QR Brand Attribution — Video",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }

    const qrSizePct = props.qrSizePct ?? DEFAULTS.qrSizePct;
    const qrInsetPx = props.qrInsetPx ?? DEFAULTS.qrInsetPx;
    const qrAlpha = props.qrAlpha ?? DEFAULTS.qrAlpha;
    const variantThreshold =
      props.variantLumaThreshold ?? DEFAULTS.variantLumaThreshold;

    const canvasW = ctx.output.width;
    const canvasH = ctx.output.height;
    const stampSizePx = Math.max(
      64,
      Math.round(Math.min(canvasW, canvasH) * (qrSizePct / 100)),
    );

    // ── Short-clip handling (below one full animation cycle) ──────
    // Brand attribution must be SCANNABLE, so below one cycle we drop the
    // windowed/retimed animation:
    //   < STATIC_MAX_MS → a committed STATIC PNG (assembled M-cutout frame) as
    //                     an `image` source: a true still, opaque, held the
    //                     whole clip (no pixelate, no M motion).
    //   else            → the committed mp4 at natural speed with NO fade-out:
    //                     quick spawn + continuous M, held to the clip end.
    if (videoDurMs < QR_ANIMATE_NATURAL_DUR_MS) {
      const variant = pickVariantForWindow(
        props.luminanceBuckets ?? [],
        0,
        videoDurMs,
        variantThreshold,
      );
      const isStatic = videoDurMs < STATIC_MAX_MS;

      const layout = buildCornerStampM0({
        canvasW,
        canvasH,
        stampPx: stampSizePx,
        gutterPx: qrInsetPx,
        overlayCount: 1,
      });

      const baseAssetId = asAssetId("qr_stamp_v2_base");
      const qrAssetId = asAssetId(`qr_stamp_v2_${variant}`);

      // Brief entrance fade held at peak (= qrAlpha). NEVER a fade-out — the
      // QR must stay up until the clip ends for attribution.
      const overlay: MosaicOverlayExpr = {
        alpha: composeAlpha(
          buildEntranceExpr(0, isStatic ? STATIC_FADE_IN_SEC : SHORT_FADE_IN_SEC),
          qrAlpha.toFixed(4),
        ),
      };

      const qrSource: MosaicSource = isStatic
        ? {
            // Static still — an `image` source is an infinite, opaque frame.
            type: "media",
            mediaType: "image",
            assetId: qrAssetId,
            placement: {
              fit: "contain",
              hAlign: "left",
              vAlign: "top",
              inset: { right: layout.insetRight, bottom: layout.insetBottom },
            },
            overlay,
          }
        : {
            // Continuous — play the mp4 from t=0 at natural speed (quick spawn
            // + the M keeps animating). The clip is shorter than the mp4's
            // fade-out, so none shows.
            type: "media",
            mediaType: "video",
            assetId: qrAssetId,
            placement: {
              fit: "contain",
              hAlign: "left",
              vAlign: "top",
              inset: { right: layout.insetRight, bottom: layout.insetBottom },
            },
            playback: {
              clipDurationMs: QR_ANIMATE_NATURAL_DUR_MS,
              playSpeed: 1.0,
              loopMode: "loop",
            },
            overlay,
          };

      return {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String(
          layout.m0,
          isStatic ? "QrStampVideoV2-static" : "QrStampVideoV2-short",
        ),
        assets: {
          [baseAssetId]: {
            kind: "file",
            path: props.videoPath,
            mediaType: "video",
          },
          [qrAssetId]: {
            kind: "file",
            path: isStatic ? VARIANT_STATIC_PATH[variant] : VARIANT_ASSET_PATH[variant],
            mediaType: isStatic ? "image" : "video",
          },
        },
        sources: [
          {
            type: "media",
            mediaType: "video",
            assetId: baseAssetId,
            placement: { fit: "cover" },
          },
          qrSource,
        ],
      };
    }

    const plan = planWindows({
      videoDurMs,
      qrNaturalDurMs: QR_ANIMATE_NATURAL_DUR_MS,
      luminanceBuckets: props.luminanceBuckets ?? [],
      coverageOverride: props.coverageOverride,
      variantThreshold,
      ...(props.minGapMs !== undefined ? { minGapMs: props.minGapMs } : {}),
    });

    const grouped = groupWindowsByVariant(plan.windows);
    const usedVariants: QrVariant[] = (["light", "dark"] as QrVariant[]).filter(
      (v) => grouped[v].length > 0,
    );
    if (usedVariants.length === 0) {
      // planWindows guarantees ≥ 1 window, so this is truly unreachable.
      // Surface explicitly rather than silently shipping a non-stamped video.
      throw new Error(
        "QrStampVideoV2: planWindows returned no windows — should be unreachable",
      );
    }

    const layout = buildCornerStampM0({
      canvasW,
      canvasH,
      stampPx: stampSizePx,
      gutterPx: qrInsetPx,
      overlayCount: usedVariants.length,
    });

    const baseAssetId = asAssetId("qr_stamp_v2_base");
    const assets: MosaicAssetManifest = {
      [baseAssetId]: {
        kind: "file",
        path: props.videoPath,
        mediaType: "video",
      },
    };
    const sources: MosaicSource[] = [
      {
        type: "media",
        mediaType: "video",
        assetId: baseAssetId,
        placement: { fit: "cover" },
      },
    ];

    for (const v of usedVariants) {
      const variantWindows = grouped[v];
      const alphaExpr = buildWindowsAlphaExpr(variantWindows, {
        peakAlpha: qrAlpha,
        fadeInSec: WINDOW_FADE_IN_SEC,
        fadeOutSec: WINDOW_FADE_OUT_SEC,
      });
      if (!alphaExpr) continue; // unreachable — variantWindows is non-empty here

      const variantAssetId = asAssetId(`qr_stamp_v2_${v}`);
      assets[variantAssetId] = {
        kind: "file",
        path: VARIANT_ASSET_PATH[v],
        mediaType: "video",
      };

      // Single alpha expression handles both window gating AND the
      // ramped fade-in / fade-out at every boundary. We deliberately do
      // NOT set `enable` here — the engine collapses enable+alpha into a
      // single multiplied expression, and overlapping the two would
      // produce a hard-cut on top of the ramp.
      const overlay: MosaicOverlayExpr = {
        alpha: alphaExpr,
      };

      sources.push({
        type: "media",
        mediaType: "video",
        assetId: variantAssetId,
        placement: {
          fit: "contain",
          hAlign: "left",
          vAlign: "top",
          inset: { right: layout.insetRight, bottom: layout.insetBottom },
        },
        playback: {
          loopMode: "loop",
          // Force loop period = naturalDur on the source's local timeline.
          // With playSpeed=1.0 (multi-window mode), the loop period on the
          // OUTPUT timeline is also naturalDur, so every window slot
          // (which is a multiple of naturalDur) lands on frame 0.
          // With playSpeed<1 (single-window mode), the source plays slower;
          // the single window starts at t=0 and ends with the (only) loop
          // cycle still in its first iteration.
          clipDurationMs: QR_ANIMATE_NATURAL_DUR_MS,
          playSpeed: plan.playbackSpeed,
        },
        overlay,
      });
    }

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(layout.m0, "QrStampVideoV2"),
      assets,
      sources,
    };
  },
});

registerTemplate(QrStampVideoV2);
export default QrStampVideoV2;
