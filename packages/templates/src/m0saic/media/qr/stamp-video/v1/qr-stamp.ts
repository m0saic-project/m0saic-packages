import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  LuminanceBucket,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  defineMosaicTemplate,
  definePropsSchema,
  makeErrorMosaic,
  qrToRenderable,
  registerTemplate,
} from "@m0saic/template-utils";
import {
  buildAdaptiveAlphaExpr,
  buildCornerStampM0,
  buildEntranceExpr,
  composeAlpha,
} from "./expressions";
import { buildGleamSweepXExpr, generateGleamBandPng } from "./gleamBand";

const BRAND_ORANGE: MosaicColor = "#f97316";

function variantBackgroundColor(
  variant: "light" | "dark" | "transparent",
  bgOpacity: number,
): MosaicColor | undefined {
  if (variant === "transparent") return undefined;
  const base = variant === "dark" ? "#000000" : "#ffffff";
  const clamped = Math.max(0, Math.min(1, bgOpacity));
  return (clamped >= 1 ? base : `${base}@${clamped}`) as MosaicColor;
}

/**
 * Adaptive M0saic QR watermark for video.
 *
 * Overlays a M0saic QR code in the bottom-right corner of an input video.
 * When `mode === "auto"` and luminance buckets are provided, the template
 * crossfades between a light-bg and dark-bg variant per the underlying
 * video's brightness — bright scenes get the light-bg variant (cohesive
 * tonal match) and dark scenes get the dark-bg variant. The orange QR
 * modules contrast against both backgrounds, so the QR stays scannable
 * either way.
 *
 * This is the engine-pure half of the free-tier watermark feature:
 * the template accepts pre-computed `luminanceBuckets` so the render
 * stays deterministic. The CLI runs the actual ffmpeg luminance probe
 * (see `@m0saic/core/probe/luminanceProbe`) and passes the buckets in.
 */

export type QrStampMode = "auto" | "light" | "dark" | "transparent";

export type QrStampVideoProps = {
  /**
   * Path to the base video file the QR will be stamped onto.
   * Required at render time; optional in the type so `defaultProps` doesn't
   * have to seed a fake placeholder. `render` throws if missing.
   */
  videoPath?: string;
  /** Text encoded into the QR (URL, plain string, or structured payload). */
  text?: string;
  /** Gutter between the QR and the bottom-right canvas edges, in pixels. */
  cornerInsetPx?: number;
  /** Stamp size as a percent of min(W, H). */
  stampSizePct?: number;
  /** Play a polished entrance animation (scale-bounce + fade-in). */
  entrance?: boolean;
  /** Entrance duration, ms. */
  entranceDurMs?: number;
  /**
   * Periodic diagonal shine sweep — premium production polish. Renders
   * a soft white diagonal band overlay with `blendMode: "screen"` that
   * sweeps across the QR every `gleamPeriodSec`. Matches the render-hero
   * M shimmer aesthetic. On by default.
   */
  gleam?: boolean;
  /** Time between gleam sweeps, in seconds (cycle period). */
  gleamPeriodSec?: number;
  /** Duration of each sweep in seconds — band traverses left-to-right over this time. Short = quick flash. */
  gleamSweepSec?: number;
  /** Band angle in degrees clockwise from vertical (0 = horizontal sweep, 20 = mild diagonal). */
  gleamAngleDeg?: number;
  /** Peak alpha of the band (0..1). 0.4 reads as a clear specular highlight against the new peaked-falloff gradient; 0.7+ overwhelms. */
  gleamPeakAlpha?: number;
  /** QR adaptation mode. "auto" requires `luminanceBuckets` to be provided. */
  mode?: QrStampMode;
  /** Pre-computed luminance series for mode === "auto" — the CLI hook fills this in. */
  luminanceBuckets?: LuminanceBucket[];
  /**
   * Auto-mode adaptive band, low end. Each bucket picks the dark-bg
   * variant when its avgLuma is at or below the midpoint of
   * `[adaptiveLowLuma, adaptiveHighLuma]`, otherwise the light-bg
   * variant. Both knobs stay for backward-compat; today the only
   * thing the band determines is the midpoint threshold.
   */
  adaptiveLowLuma?: number;
  /** Auto-mode adaptive band, high end. See {@link adaptiveLowLuma}. */
  adaptiveHighLuma?: number;
  /**
   * Crossfade duration in ms for auto-mode variant transitions at
   * scene boundaries. Smoothstep ramp centered on the boundary,
   * half-width each side. Default 400ms — short enough to feel
   * snappy, long enough to avoid a flicker.
   */
  crossfadeDurMs?: number;
  /**
   * Opacity of the QR's solid background, 0..1. Default 0.92 — subtle
   * bleed-through that softens the "sticker" look without compromising
   * scanability (the orange modules + center logo stay fully opaque).
   * Set to 1 for the classic opaque-sticker look. Ignored for
   * `mode: "transparent"`.
   */
  bgOpacity?: number;
};

// ─────────────────────────────────────────────────────────────────────
// Tunable defaults for the free-tier QR watermark.
//
// Most-tuned knobs (in order of how often we touch them):
//   stampSizePct   — size of the QR as a % of min(canvasW, canvasH).
//                    Bumped to 18 (~20% larger than 15) for better
//                    legibility on social-aspect deliverables. Floor
//                    is ~10 (scanner-friendly on phones); ceiling is
//                    ~24 before it starts to dominate the corner.
//   cornerInsetPx  — padding from the bottom-right edge in pixels.
//   entrance       — set to FALSE so the stamp is present from t=0.
//                    The earlier scale-bounce + fade-in was nice in
//                    isolation but felt fussy on short clips and
//                    made the stamp briefly invisible at the start.
//   bgOpacity      — solid-background variant's bleed-through. 0.92
//                    keeps the modules crisp without a sticker look.
// ─────────────────────────────────────────────────────────────────────
const DEFAULTS = {
  text: "https://www.m0saic.io",
  cornerInsetPx: 24,
  stampSizePct: 18,
  entrance: false,
  entranceDurMs: 400,
  gleam: true,
  gleamPeriodSec: 6,
  gleamSweepSec: 0.9,
  gleamAngleDeg: 20,
  gleamPeakAlpha: 0.4,
  mode: "auto" as QrStampMode,
  adaptiveLowLuma: 100,
  adaptiveHighLuma: 156,
  crossfadeDurMs: 400,
  bgOpacity: 0.92,
};

const propsSchema = definePropsSchema<QrStampVideoProps>({
  videoPath: {
    type: "media",
    required: true,
    description: "Path to the base video file to stamp.",
    meta: { control: { picker: "file", accept: ["video"] } },
  },
  text: {
    type: "string",
    required: false,
    description: "Text encoded into the QR — URL, plain string, or structured payload (default: https://www.m0saic.io).",
    meta: { control: { flavor: "url", placeholder: "https://www.m0saic.io" } },
  },
  cornerInsetPx: {
    type: "number",
    required: false,
    description: "Padding from the bottom-right edge, in pixels.",
    meta: { constraints: { min: 0, max: 500 } },
  },
  stampSizePct: {
    type: "number",
    required: false,
    description: "Stamp size as a percent of min(W, H).",
    meta: { constraints: { min: 1, max: 50 } },
  },
  entrance: {
    type: "boolean",
    required: false,
    description: "Play the entrance fade-in animation.",
  },
  entranceDurMs: {
    type: "number",
    required: false,
    description: "Entrance duration, ms.",
    meta: { constraints: { min: 0, max: 5000 } },
  },
  gleam: {
    type: "boolean",
    required: false,
    description:
      "Periodic diagonal shine sweep on the QR (screen-blend overlay) — premium polish, on by default.",
  },
  gleamPeriodSec: {
    type: "number",
    required: false,
    description: "Time between gleam sweeps, in seconds.",
    meta: { constraints: { min: 1, max: 60 } },
  },
  gleamSweepSec: {
    type: "number",
    required: false,
    description:
      "How long each sweep takes (seconds). Short = quick flash, long = lazier shine.",
    meta: { constraints: { min: 0.2, max: 10 } },
  },
  gleamAngleDeg: {
    type: "number",
    required: false,
    description: "Band angle in degrees (0 = vertical band, 20 = mild diagonal).",
    meta: { constraints: { min: 0, max: 60 } },
  },
  gleamPeakAlpha: {
    type: "number",
    required: false,
    description: "Peak alpha of the shine band (0..1).",
    meta: { constraints: { min: 0, max: 1 } },
  },
  mode: {
    type: "string",
    required: false,
    description: "QR adaptation mode.",
    meta: {
      constraints: { oneOf: ["auto", "light", "dark", "transparent"] },
    },
  },
  luminanceBuckets: {
    type: "json",
    required: false,
    description:
      "Pre-computed luminance buckets for mode=auto. The CLI free-tier hook fills this from a probe over the bottom-right region.",
  },
  adaptiveLowLuma: {
    type: "number",
    required: false,
    description:
      "Auto-mode adaptive band low end. Decision threshold is the midpoint of [low, high].",
    meta: { constraints: { min: 0, max: 255 } },
  },
  adaptiveHighLuma: {
    type: "number",
    required: false,
    description:
      "Auto-mode adaptive band high end. Decision threshold is the midpoint of [low, high].",
    meta: { constraints: { min: 0, max: 255 } },
  },
  crossfadeDurMs: {
    type: "number",
    required: false,
    description:
      "Smoothstep crossfade duration in ms between auto-mode variants at scene boundaries.",
    meta: { constraints: { min: 0, max: 2000 } },
  },
  bgOpacity: {
    type: "number",
    required: false,
    description:
      "Opacity of the QR's solid background, 0..1 (default 0.92). Lower = softer sticker.",
    meta: { constraints: { min: 0, max: 1 } },
  },
});

function variantsForMode(
  mode: QrStampMode,
): Array<"light" | "dark" | "transparent"> {
  if (mode === "auto") return ["light", "dark"];
  if (mode === "light") return ["light"];
  if (mode === "dark") return ["dark"];
  return ["transparent"];
}

export const QrStampVideo = defineMosaicTemplate<QrStampVideoProps>({
  id: asTemplateId("@m0saic/media/qr/stamp-video/v1"),
  label: "QR Stamp — Video (v1, deprecated)",
  version: 1,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the QR module grid —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description:
    "Brands a video with an adaptive QR. The card crossfades light↔dark with the scene's brightness so the QR tones with the underlying frame. Optional gleam shine + entrance fade.",
  deprecated: {
    reason:
      "Fully absorbed by QR Stamp (media/qr/stamp/v1), which shares the same stampQrOnMedia adaptive-crossfade engine and additionally handles images. The one exclusive here — the render-time gleam sweep — is retired by design: decoration belongs baked into the input media (seed it with another template), not computed in the stamp. Kept as the reference adaptive video stamp.",
    replacement: asTemplateId("@m0saic/media/qr/stamp/v1"),
    since: "2026-07-21",
  },
  capabilities: {
    tier: "capability",
    caps: { fs: { read: true, write: true, temp: true } },
  },
  tags: ["brand", "qr", "watermark", "free-tier", "adaptive"],

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
    props: QrStampVideoProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    if (!props.videoPath) {
      // Return a visible error mosaic rather than throwing. Same pattern as
      // subtitle-burn / other capability templates so the smoke test + any
      // mis-configured caller surface a clear "missing input" frame instead
      // of a stack trace.
      return makeErrorMosaic(
        "QrStampVideo: videoPath prop is required (the base video to stamp).",
        {
          title: "QR Stamp (Video)",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }

    const text = props.text ?? DEFAULTS.text;
    const cornerInsetPx = props.cornerInsetPx ?? DEFAULTS.cornerInsetPx;
    const stampSizePct = props.stampSizePct ?? DEFAULTS.stampSizePct;
    const entrance = props.entrance ?? DEFAULTS.entrance;
    const entranceDurMs = props.entranceDurMs ?? DEFAULTS.entranceDurMs;
    const gleam = props.gleam ?? DEFAULTS.gleam;
    const gleamPeriodSec = props.gleamPeriodSec ?? DEFAULTS.gleamPeriodSec;
    const gleamSweepSec = props.gleamSweepSec ?? DEFAULTS.gleamSweepSec;
    const gleamAngleDeg = props.gleamAngleDeg ?? DEFAULTS.gleamAngleDeg;
    const gleamPeakAlpha = props.gleamPeakAlpha ?? DEFAULTS.gleamPeakAlpha;
    const mode: QrStampMode = props.mode ?? DEFAULTS.mode;
    const luminanceBuckets = props.luminanceBuckets ?? [];
    const adaptiveLowLuma = props.adaptiveLowLuma ?? DEFAULTS.adaptiveLowLuma;
    const adaptiveHighLuma = props.adaptiveHighLuma ?? DEFAULTS.adaptiveHighLuma;
    const crossfadeDurMs = props.crossfadeDurMs ?? DEFAULTS.crossfadeDurMs;
    const bgOpacity = props.bgOpacity ?? DEFAULTS.bgOpacity;

    const canvasW = ctx.output.width;
    const canvasH = ctx.output.height;
    const stampSizePx = Math.max(
      64,
      Math.round(Math.min(canvasW, canvasH) * (stampSizePct / 100)),
    );

    // Build the m0 layout: base video + N nested bottom-right cells. The cell
    // is (stampSizePx + cornerInsetPx) on each side; the source's
    // placement.inset leaves the gutter visible as canvas-edge margin.
    // When gleam is on we reserve an extra overlay layer for the
    // screen-blend shine band that sits on top of the QR variants.
    const variants = variantsForMode(mode);
    const overlayCount = variants.length + (gleam ? 1 : 0);
    const layout = buildCornerStampM0({
      canvasW,
      canvasH,
      stampPx: stampSizePx,
      gutterPx: cornerInsetPx,
      overlayCount,
    });

    // Base video occupies the full canvas (outer F tile).
    const baseAssetId = asAssetId("qr_stamp_base");
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

    // Each variant becomes a self-contained child MosaicDocument: in-house
    // qrToM0 modules + a tinted background. No PNG raster, no sharp. The
    // parent references each child via a `type: "mosaic"` source, so the
    // existing adaptive-alpha and entrance expressions still attach to the
    // QR's slot in the parent's m0 without any change in semantics.
    const variantChildren: Record<string, MosaicDocument> = {};
    for (const v of variants) {
      let qr;
      try {
        qr = qrToRenderable({
          text,
          moduleColor: BRAND_ORANGE,
          errorCorrectionLevel: "H",
        });
      } catch (err) {
        return makeErrorMosaic(
          `QrStampVideo: ${err instanceof Error ? err.message : String(err)}`,
          {
            title: "QR Stamp (Video)",
            width: ctx.target.width,
            height: ctx.target.height,
          },
        );
      }

      const bgColor = variantBackgroundColor(v, bgOpacity);
      const childKey = `qr_stamp_${v}`;
      variantChildren[childKey] = {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String(String(qr.m0), `QrStampVideo-qr-${v}`),
        sources: qr.sources as MosaicSource[],
        assets: {} as MosaicAssetManifest,
        size: { width: qr.canvasW, height: qr.canvasH },
        ...(bgColor !== undefined ? { backgroundColor: bgColor } : {}),
      };

      // Compose alpha = entrance × adaptive (gleam is now its own
      // screen-blend overlay layer, not an alpha modulation).
      const factors: string[] = [];
      if (mode === "auto" && (v === "light" || v === "dark")) {
        factors.push(
          buildAdaptiveAlphaExpr(
            luminanceBuckets,
            v,
            adaptiveLowLuma,
            adaptiveHighLuma,
            crossfadeDurMs / 1000,
          ),
        );
      }
      if (entrance) {
        factors.push(buildEntranceExpr(0, entranceDurMs / 1000));
      }
      const alphaExpr =
        factors.length > 0 ? composeAlpha(...factors) : undefined;

      sources.push({
        type: "mosaic",
        ref: childKey,
        placement: {
          fit: "contain",
          hAlign: "left",
          vAlign: "top",
          inset: { right: layout.insetRight, bottom: layout.insetBottom },
        },
        ...(alphaExpr ? { overlay: { alpha: alphaExpr } } : {}),
      });
    }

    // Gleam shine band — diagonal white stripe swept across the QR.
    //
    // # Nested-mosaic clipping (the whole point of this structure)
    //
    // The gleam is wrapped in a nested mosaic doc rather than added
    // as a direct media source on the parent. ffmpeg's `overlay`
    // filter does NOT clip a layer to its destination rect — a
    // tilted band shifted by `xExpr` paints wherever its pixels
    // land, including outside the QR cell. The nested mosaic gives
    // us pixel-perfect clipping for free: the engine renders the
    // child mosaic into an intermediate framebuffer sized exactly
    // to the gleam-cell's bounds, so anything the inner overlay
    // tries to paint past that frame's edges literally doesn't
    // exist. The intermediate (which carries the gleam over a
    // transparent base) then gets composited onto the QR with
    // `blendMode: "screen"` — outside-band pixels are transparent
    // (no effect under screen), inside-band pixels brighten the
    // QR modules.
    //
    // Layout: inner doc m0 = "F{F}". Outer F holds the lavfi
    // transparent base; nested F holds the gleam image source with
    // the sweep xExpr. Both fill the inner canvas — no inset, no
    // positioning offset — because the inner canvas IS the gleam's
    // bounding box.
    const children: Record<string, MosaicDocument> = { ...variantChildren };
    if (gleam) {
      const { pngPath: gleamPngPath } = await generateGleamBandPng({
        sizePx: stampSizePx,
        workspaceDir: ctx.output.workspaceDir,
        angleDeg: gleamAngleDeg,
        peakAlpha: gleamPeakAlpha,
        outputName: "qr-stamp-gleam.png",
      });
      const sweepXExpr = buildGleamSweepXExpr(gleamPeriodSec, gleamSweepSec);
      // Active window per cycle: [0, sweepSec). Outside this window
      // mod(t,period) ≥ sweepSec so lt(mod(t,P),S) is false → enable=0
      // and the engine skips the overlay. With entrance, additionally
      // gate on t ≥ entrance end so the shine doesn't pop mid-fade-in.
      const periodFixed = gleamPeriodSec.toFixed(3);
      const sweepFixed = gleamSweepSec.toFixed(3);
      const sweepGate = `lt(mod(t,${periodFixed}),${sweepFixed})`;
      const enableExpr = entrance
        ? `gte(t,${(entranceDurMs / 1000).toFixed(3)})*${sweepGate}`
        : sweepGate;

      const gleamInnerAssetId = asAssetId("qr_stamp_gleam_inner");
      // Child doc — the gleam's self-contained universe. Two
      // sources: a transparent base that gives the overlay
      // something to composite onto, and the gleam image with the
      // sweep xExpr. Both fill the inner F.
      const gleamInnerDoc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String("F{F}", "QrStampGleamInner"),
        assets: {
          [gleamInnerAssetId]: {
            kind: "file",
            path: gleamPngPath,
            mediaType: "image",
          },
        },
        sources: [
          // Outer F: transparent base. Engine forces it to
          // inner-canvas dimensions automatically (fitMode default
          // "tile"). Provides the framebuffer the gleam overlays
          // onto.
          {
            type: "lavfi",
            color: "black@0",
          },
          // Inner F: the gleam, with overlay.xExpr driving the
          // sweep. Stays inside the inner canvas because the
          // framebuffer is finite — that's the clipping guarantee
          // this whole nested structure exists for.
          {
            type: "media",
            mediaType: "image",
            assetId: gleamInnerAssetId,
            placement: { fit: "contain" },
            overlay: {
              xExpr: sweepXExpr,
              enable: enableExpr,
            },
          },
        ],
      };
      children["qr_stamp_gleam"] = gleamInnerDoc;

      // Parent reference — placed in the same QR cell as the
      // variants, with screen blend to brighten the modules. The
      // enable gate is duplicated here so the engine can skip the
      // intermediate composite entirely outside the sweep window.
      sources.push({
        type: "mosaic",
        ref: "qr_stamp_gleam",
        placement: {
          fit: "contain",
          hAlign: "left",
          vAlign: "top",
          inset: { right: layout.insetRight, bottom: layout.insetBottom },
        },
        overlay: {
          blendMode: "screen",
          enable: enableExpr,
        },
      });
    }

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(layout.m0, "QrStampVideo"),
      assets,
      sources,
      ...(Object.keys(children).length > 0 ? { children } : {}),
    };
  },
});

registerTemplate(QrStampVideo);
export default QrStampVideo;
