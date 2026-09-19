/**
 * Adaptive-mode layer assembly: which artwork variant(s) the stamp
 * shows, and the alpha expression that drives each.
 *
 * Variant vocabulary (cohesion mapping, same as the QR stamp):
 *   - "light" artwork = made FOR bright regions → `image` + `textColorOnLight`
 *   - primary artwork = made FOR dark regions  → `imageDark ?? image` + `textColor`
 *     (the user's explicitly-chosen styling — white text by default)
 *
 * Degradation rule: `variant: "auto"` needs luma evidence. With no
 * probe data (host prep skipped / unavailable), auto degrades to
 * "single" — the user's explicit styling with no evidence-free flip.
 * (This intentionally differs from `buildAdaptiveAlphaExpr`'s
 * empty-buckets behavior, which would pin the LIGHT variant on.)
 *
 * Pure math — no IO, no engine types beyond LuminanceBucket.
 */

import type { LuminanceBucket, MosaicColor, MosaicEngineContext } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import {
  buildAdaptiveAlphaExpr,
  buildEntranceExpr,
  buildWindowsAlphaExpr,
  composeAlpha,
  groupWindowsByVariant,
  planStampWindows,
} from "@m0saic/template-utils";
import { resolveWatermarkProbeRegion } from "./geometry";
import type { WatermarkV1Props } from "./watermark";

/** One appearance slot for windowed mode — the watermark artwork is
 *  static, so the slot width is a taste constant, not a clip length. */
export const WATERMARK_SLOT_MS = 4000;

/** Crossfade band for always-on adaptive (same as the QR stamp v1). */
export const ADAPTIVE_LOW_LUMA = 100;
export const ADAPTIVE_HIGH_LUMA = 156;

/** Per-input luma probe result (pulled via `ctx.analysis`, or injected via the `lumaByInput` prop override). */
export type WatermarkLumaEntry = {
  buckets: LuminanceBucket[];
  overallAvgLuma: number;
  durationMs: number;
};

/**
 * Pull the per-input region-luminance analysis through `ctx.analysis`
 * (the engine-mediated on-demand probe). Undefined when the host
 * attached no analysis surface (design mode, no toolchain) or every
 * probe failed — adaptive `auto` then degrades to single-variant.
 * Per-input failures drop that input's entry; a probe must never kill
 * a render.
 */
export async function probeLumaByInput(
  props: WatermarkV1Props,
  inputs: string[],
  ctx: Pick<MosaicEngineContext, "media" | "analysis">,
): Promise<Record<string, WatermarkLumaEntry> | undefined> {
  const analysis = ctx.analysis;
  if (!analysis) return undefined;

  // Logo dims for the region math (content "logo"/"lockup") — the image
  // prop is media-typed, so the host registry has probed it.
  const logoMeta = props.image ? ctx.media[asAssetId(props.image)] : undefined;
  const logoDims =
    logoMeta && logoMeta.width > 0 && logoMeta.height > 0
      ? { width: logoMeta.width, height: logoMeta.height }
      : undefined;

  const out: Record<string, WatermarkLumaEntry> = {};
  for (const inputPath of inputs) {
    const meta = ctx.media[asAssetId(inputPath)];
    if (!meta || !(meta.width > 0) || !(meta.height > 0)) continue;
    if (meta.kind !== "video" && meta.kind !== "image") continue;
    try {
      const region = resolveWatermarkProbeRegion(props, meta.width, meta.height, logoDims);
      const r = await analysis.regionLuminance(inputPath, region, {
        bucketMs: 500,
        smoothingMs: meta.kind === "video" ? 1500 : 500,
      });
      out[inputPath] = {
        buckets: r.buckets,
        overallAvgLuma: r.overallAvgLuma,
        durationMs: r.durationMs,
      };
    } catch {
      // Per-input degrade: this step falls back to single-variant.
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Per-variant artwork substitution the content builders consume. */
export type WatermarkArtwork = {
  image?: string;
  textColor: MosaicColor;
};

/** One stamp layer to emit: artwork + its alpha realization. */
export type AdaptiveLayerSpec = {
  /** stampOnMedia children key / editor label suffix. */
  key: "wm" | "light" | "dark";
  artwork: WatermarkArtwork;
  /** Time-varying overlay.alpha (never paired with enable — it hard-cuts the ramp). */
  alphaExpr?: string;
  /** Constant fast path (image steps). */
  opacity?: number;
};

export type AdaptiveKnobs = {
  variant: "single" | "auto";
  windowing: "always" | "windows";
  opacity: number;
  fadeMs: number;
  crossfadeMs: number;
  lumaThreshold: number;
  minGapMs: number;
  coverageOverride?: number;
  /** `imageDark ?? image` + `textColor` (the user's primary styling). */
  artworkPrimary: WatermarkArtwork;
  /** `image` + `textColorOnLight` (for bright regions). */
  artworkOnLight: WatermarkArtwork;
};

/**
 * Assemble the adaptive layers for one step.
 *
 * Video: windows mode plans slot-aligned appearances (coverage tiers,
 * gap constraint) with per-window variant picks; always mode keeps the
 * stamp on with an entrance fade and (auto) a per-scene crossfade
 * between the two artworks. Image: no time axis — one constant layer,
 * variant picked once from the overall region luma.
 */
export function buildAdaptiveLayerSpecs(args: {
  isVideo: boolean;
  /** Probed input duration (video steps). */
  videoDurMs?: number;
  entry?: WatermarkLumaEntry;
  knobs: AdaptiveKnobs;
}): AdaptiveLayerSpec[] {
  const { isVideo, videoDurMs, entry, knobs } = args;
  const buckets = entry?.buckets ?? [];
  const hasLuma = entry != null && (buckets.length > 0 || entry.overallAvgLuma != null);
  // Auto needs evidence; degrade to the user's explicit styling without it.
  const effectiveVariant = knobs.variant === "auto" && hasLuma ? "auto" : "single";
  const opacityStr = knobs.opacity.toFixed(4);

  // ── Image steps: one constant layer, variant picked once ──────────
  if (!isVideo) {
    const artwork =
      effectiveVariant === "auto" && entry!.overallAvgLuma >= knobs.lumaThreshold
        ? knobs.artworkOnLight
        : knobs.artworkPrimary;
    return [{ key: "wm", artwork, opacity: knobs.opacity }];
  }

  const durMs = Math.max(1, Math.round(videoDurMs ?? 0));
  const fadeSec = knobs.fadeMs / 1000;

  // ── Windowed appearances ───────────────────────────────────────────
  if (knobs.windowing === "windows") {
    const plan = planStampWindows({
      videoDurMs: durMs,
      slotDurMs: WATERMARK_SLOT_MS,
      luminanceBuckets: buckets,
      variantThreshold: knobs.lumaThreshold,
      minGapMs: knobs.minGapMs,
      ...(knobs.coverageOverride !== undefined
        ? { coverageOverride: knobs.coverageOverride }
        : {}),
    });
    if (effectiveVariant === "single") {
      const alpha = buildWindowsAlphaExpr(plan.windows, {
        peakAlpha: knobs.opacity,
        fadeInSec: fadeSec,
        fadeOutSec: fadeSec,
      });
      return alpha ? [{ key: "wm", artwork: knobs.artworkPrimary, alphaExpr: alpha }] : [];
    }
    const groups = groupWindowsByVariant(plan.windows);
    const specs: AdaptiveLayerSpec[] = [];
    for (const [variant, windows] of [
      ["light", groups.light],
      ["dark", groups.dark],
    ] as const) {
      const alpha = buildWindowsAlphaExpr(windows, {
        peakAlpha: knobs.opacity,
        fadeInSec: fadeSec,
        fadeOutSec: fadeSec,
      });
      if (!alpha) continue;
      specs.push({
        key: variant,
        artwork: variant === "light" ? knobs.artworkOnLight : knobs.artworkPrimary,
        alphaExpr: alpha,
      });
    }
    return specs;
  }

  // ── Always-on ──────────────────────────────────────────────────────
  const entrance = buildEntranceExpr(0, fadeSec);
  if (effectiveVariant === "single") {
    return [
      { key: "wm", artwork: knobs.artworkPrimary, alphaExpr: composeAlpha(entrance, opacityStr) },
    ];
  }
  const crossfadeSec = knobs.crossfadeMs / 1000;
  return [
    {
      key: "light",
      artwork: knobs.artworkOnLight,
      alphaExpr: composeAlpha(
        buildAdaptiveAlphaExpr(buckets, "light", ADAPTIVE_LOW_LUMA, ADAPTIVE_HIGH_LUMA, crossfadeSec),
        entrance,
        opacityStr,
      ),
    },
    {
      key: "dark",
      artwork: knobs.artworkPrimary,
      alphaExpr: composeAlpha(
        buildAdaptiveAlphaExpr(buckets, "dark", ADAPTIVE_LOW_LUMA, ADAPTIVE_HIGH_LUMA, crossfadeSec),
        entrance,
        opacityStr,
      ),
    },
  ];
}
