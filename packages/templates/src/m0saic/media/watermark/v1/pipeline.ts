/**
 * Per-input step builder for the watermark batch pipeline.
 *
 * The template ALWAYS returns an `emit: "multi"` pipeline (even for one
 * input): pipeline steps are the only vehicle where each output's
 * canvas tracks its input's probed dims (`step.file.size` wins; a plain
 * top-level doc plans at the CLI `--width/--height`).
 */

import * as path from "node:path";
import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicOutputFormat,
  MosaicPipelineStep,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import {
  bindProps,
  makeErrorMosaic,
  slugifyAssetKeyFromPath,
  stampOnMedia,
  withLayoutContract,
  type LayoutConstraint,
  type StampLayer,
  type StampPosition,
} from "@m0saic/template-utils";
import {
  resolveWatermarkRect,
  type LockupLayout,
  type WatermarkContentInfo,
} from "./geometry";
import { buildLockupChild, buildLogoChild, buildTextChild } from "./content";
import { buildPaddedInstanceChild, buildPagePatternChild, planPageGrid } from "./pageGrid";
import {
  buildAdaptiveLayerSpecs,
  type WatermarkArtwork,
  type WatermarkLumaEntry,
} from "./adaptive";

/** Fixed duration for image steps — a single-frame render. */
export const IMAGE_STEP_MS = 40;

/** Duration used for error-mosaic steps (input problems). */
export const ERROR_STEP_MS = 1000;

const ERROR_TITLE = "Watermark";

/** Resolved knobs a step needs (validated once by the template). */
export type WatermarkStepKnobs = {
  mode: "static" | "adaptive" | "page";
  content: "logo" | "text" | "lockup";
  /** Logo file path (content: "logo" | "lockup"). */
  image?: string;
  /** Dark-scene logo variant (adaptive auto). */
  imageDark?: string;
  /** Wordmark text (content: "text" | "lockup"). */
  text: string;
  textColor: MosaicColor;
  /** Wordmark color over bright regions (adaptive auto). */
  textColorOnLight: MosaicColor;
  lockupLayout: LockupLayout;
  position: StampPosition;
  sizeRatio: number;
  sizeBasis: "min" | "width" | "height";
  marginRatio: number;
  opacity: number;
  /** Normalized escape-hatch m0 (already string-validated; stamp modes only). */
  layoutM0: string | null;
  imageOutputFormat: "match" | "png" | "jpeg";
  /** Intrinsic aspect facts of the watermark artwork (resolved once). */
  contentInfo: WatermarkContentInfo;
  // adaptive knobs
  variant: "single" | "auto";
  windowing: "always" | "windows";
  fadeMs: number;
  crossfadeMs: number;
  lumaThreshold: number;
  minGapMs: number;
  coverageOverride?: number;
  /** Host-injected per-input luma probe results, keyed by raw input path. */
  lumaByInput?: Record<string, WatermarkLumaEntry>;
  // page-mode knobs
  angleDeg: number;
  tileGapRatio: number;
  stagger: boolean;
  maxTiles: number;
  /** Dev tripwire: run the layout contract on each step doc. */
  debugLayout: boolean;
};

function imageContainer(inputPath: string, pref: "match" | "png" | "jpeg"): "png" | "jpeg" {
  if (pref !== "match") return pref;
  const ext = path.extname(inputPath).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg" ? "jpeg" : "png";
}

function errorStep(stepName: string, label: string, message: string, ctx: MosaicEngineContext): MosaicPipelineStep {
  return {
    name: stepName,
    label,
    durationMs: ERROR_STEP_MS,
    file: makeErrorMosaic(message, {
      title: ERROR_TITLE,
      width: ctx.target.width,
      height: ctx.target.height,
    }),
  };
}

/**
 * Build one pipeline step: the input watermarked at its own dims, with
 * a per-step output format (video → mp4; image → png/jpeg per knob).
 * Input problems degrade to an error-mosaic step so one bad file never
 * kills a batch.
 */
export function buildWatermarkStep(args: {
  inputPath: string;
  stepName: string;
  knobs: WatermarkStepKnobs;
  ctx: MosaicEngineContext;
}): MosaicPipelineStep {
  const { inputPath, stepName, knobs, ctx } = args;
  const label = path.parse(inputPath).name;

  const meta = ctx.media[asAssetId(inputPath)];
  if (!meta || !(meta.width > 0) || !(meta.height > 0)) {
    return errorStep(stepName, label, `No probed dimensions for input: ${inputPath}`, ctx);
  }
  if (meta.kind !== "video" && meta.kind !== "image") {
    return errorStep(stepName, label, `Input is not an image or video (kind: ${meta.kind}): ${inputPath}`, ctx);
  }
  const isVideo = meta.kind === "video";
  if (isVideo && !(meta.durationMs != null && meta.durationMs > 0)) {
    return errorStep(stepName, label, `Video input has no probed duration: ${inputPath}`, ctx);
  }

  const canvasW = meta.width;
  const canvasH = meta.height;

  let step: MosaicPipelineStep;
  try {
    const baseAssetId = asAssetId(slugifyAssetKeyFromPath(inputPath));
    const baseAssets: MosaicAssetManifest = {
      [baseAssetId]: { kind: "file", path: inputPath, mediaType: meta.kind },
    } as MosaicAssetManifest;
    const baseSource: MosaicSource = {
      type: "media",
      mediaType: meta.kind,
      assetId: baseAssetId,
      // Canvas == input dims, so cover is an exact fit (no crop).
      placement: { fit: "cover" },
      editor: { owner: "template", label: "wm:base" },
    };

    let doc =
      knobs.mode === "page"
        ? buildPageDoc({ baseSource, baseAssets, canvasW, canvasH, knobs })
        : buildStampDoc({
            baseSource,
            baseAssets,
            canvasW,
            canvasH,
            knobs,
            isVideo,
            ...(isVideo ? { videoDurMs: meta.durationMs! } : {}),
            ...(knobs.lumaByInput?.[inputPath] ? { lumaEntry: knobs.lumaByInput[inputPath] } : {}),
          });

    if (knobs.debugLayout) {
      const constraints = debugConstraints(knobs);
      if (constraints.length > 0) {
        // The contract evaluates at ctx.target — shim it to this step's
        // own canvas so ratio invariants resolve against the real dims.
        const stepCtx = { ...ctx, target: { ...ctx.target, width: canvasW, height: canvasH } };
        doc = withLayoutContract(doc, stepCtx, {
          templateId: "@m0saic/media/watermark/v1",
          constraints,
          // Constraints target only the parent's own top-level geometry
          // (the stamp cell / pattern slot) — don't let a nested child's
          // flatten quirk collapse the check.
          flatten: false,
          debug: true,
        });
      }
    }

    const format: MosaicOutputFormat = isVideo
      ? { kind: "video", container: "mp4" }
      : { kind: "image", container: imageContainer(inputPath, knobs.imageOutputFormat) };

    step = {
      name: stepName,
      label,
      durationMs: isVideo ? Math.max(1, Math.round(meta.durationMs!)) : IMAGE_STEP_MS,
      file: { ...doc, format },
    };
  } catch (err) {
    return errorStep(
      stepName,
      label,
      `Watermark step failed for ${inputPath}: ${err instanceof Error ? err.message : String(err)}`,
      ctx,
    );
  }
  return step;
}

/**
 * Watermark artwork child at (w, h) for the resolved content.
 * `artwork` substitutes the adaptive variant's image/text color; absent
 * = the user's primary styling. `imageDark` may have a different aspect
 * than the logo — it contain-fits the same rect (letterboxed if so; the
 * rect always derives from the PRIMARY logo's probed aspect).
 */
function buildContentChild(
  knobs: WatermarkStepKnobs,
  w: number,
  h: number,
  artwork?: WatermarkArtwork,
) {
  const image = artwork?.image ?? knobs.image;
  const color = artwork?.textColor ?? knobs.textColor;
  if (knobs.content === "logo") {
    return buildLogoChild({ logoPath: image!, w, h });
  }
  if (knobs.content === "lockup") {
    return buildLockupChild({
      logoPath: image!,
      logoAspect: knobs.contentInfo.logoAspect!,
      text: knobs.text,
      textAspect: knobs.contentInfo.textAspect!,
      color,
      layout: knobs.lockupLayout,
      w,
      h,
    });
  }
  return buildTextChild({ text: knobs.text, color, w, h });
}

/** The colour prop that inks one stamp layer's wordmark. */
type WordmarkColorProp = "textColor" | "textColorOnLight";

/**
 * Bind the wordmark rect (the `wm:text` source of a content child) to the
 * `text` prop — Make's double-click → inline-edit handle — with the colour
 * prop that inks THIS layer (`textColor` for the primary artwork,
 * `textColorOnLight` for the adaptive on-light variant) stacked beside it.
 * Stamp path only: the corner/adaptive stamp shows the wordmark as ONE rect
 * per layer, while page mode scatters the same art across the whole canvas
 * (no single rect displays the prop). Logo-only content has no text rect →
 * nothing to bind.
 */
function bindWordmark(child: MosaicDocument, colorProp: WordmarkColorProp): MosaicDocument {
  for (const src of child.sources ?? []) {
    if ((src as { editor?: { label?: string } }).editor?.label === "wm:text") {
      bindProps(src, [{ propKey: "text" }, { propKey: colorProp }]);
    }
  }
  return child;
}

/** Static/adaptive stamp: one placed cell hosting 1..2 artwork layers. */
function buildStampDoc(args: {
  baseSource: MosaicSource;
  baseAssets: MosaicAssetManifest;
  canvasW: number;
  canvasH: number;
  knobs: WatermarkStepKnobs;
  isVideo: boolean;
  videoDurMs?: number;
  lumaEntry?: WatermarkLumaEntry;
}) {
  const { baseSource, baseAssets, canvasW, canvasH, knobs, isVideo, videoDurMs, lumaEntry } = args;
  const rect = resolveWatermarkRect(
    {
      position: knobs.position,
      sizeRatio: knobs.sizeRatio,
      sizeBasis: knobs.sizeBasis,
      marginRatio: knobs.marginRatio,
      layoutM0: knobs.layoutM0,
    },
    canvasW,
    canvasH,
    knobs.contentInfo.aspect,
  );

  let layers: StampLayer[];
  if (knobs.mode === "adaptive") {
    // The planner hands each layer's artwork back BY REFERENCE, so identity
    // tells which colour prop inks that layer's wordmark.
    const artworkPrimary: WatermarkArtwork = {
      ...(knobs.imageDark ?? knobs.image ? { image: knobs.imageDark ?? knobs.image } : {}),
      textColor: knobs.textColor,
    };
    const artworkOnLight: WatermarkArtwork = {
      ...(knobs.image ? { image: knobs.image } : {}),
      textColor: knobs.textColorOnLight,
    };
    const specs = buildAdaptiveLayerSpecs({
      isVideo,
      ...(videoDurMs !== undefined ? { videoDurMs } : {}),
      ...(lumaEntry !== undefined ? { entry: lumaEntry } : {}),
      knobs: {
        variant: knobs.variant,
        windowing: knobs.windowing,
        opacity: knobs.opacity,
        fadeMs: knobs.fadeMs,
        crossfadeMs: knobs.crossfadeMs,
        lumaThreshold: knobs.lumaThreshold,
        minGapMs: knobs.minGapMs,
        ...(knobs.coverageOverride !== undefined
          ? { coverageOverride: knobs.coverageOverride }
          : {}),
        artworkPrimary,
        artworkOnLight,
      },
    });
    layers = specs.map((spec) => ({
      child: bindWordmark(
        buildContentChild(knobs, rect.w, rect.h, spec.artwork),
        spec.artwork === artworkOnLight ? "textColorOnLight" : "textColor",
      ),
      key: spec.key,
      ...(spec.alphaExpr !== undefined ? { alphaExpr: spec.alphaExpr } : {}),
      ...(spec.opacity !== undefined ? { opacity: spec.opacity } : {}),
    }));
  } else {
    layers = [{ child: bindWordmark(buildContentChild(knobs, rect.w, rect.h), "textColor"), opacity: knobs.opacity, key: "wm" }];
  }
  if (layers.length === 0) {
    // Defensive — the planners always yield ≥1 window, but stampOnMedia
    // rejects empty layers; fall back to the static stamp.
    layers = [{ child: bindWordmark(buildContentChild(knobs, rect.w, rect.h), "textColor"), opacity: knobs.opacity, key: "wm" }];
  }

  return stampOnMedia({
    baseSource,
    baseAssets,
    canvasW,
    canvasH,
    rect,
    layers,
  });
}

/**
 * Page mode: the diagonal repeated pattern as ONE full-canvas nested
 * child (its own engine command — parent overlay depth stays 1), with
 * the pattern opacity applied once at the parent source.
 */
function buildPageDoc(args: {
  baseSource: MosaicSource;
  baseAssets: MosaicAssetManifest;
  canvasW: number;
  canvasH: number;
  knobs: WatermarkStepKnobs;
}) {
  const { baseSource, baseAssets, canvasW, canvasH, knobs } = args;
  const basisPx =
    knobs.sizeBasis === "width" ? canvasW : knobs.sizeBasis === "height" ? canvasH : Math.min(canvasW, canvasH);
  const contentW = Math.max(1, Math.round(knobs.sizeRatio * basisPx));
  const contentH = Math.max(1, Math.round(contentW / knobs.contentInfo.aspect));

  const plan = planPageGrid({
    canvasW,
    canvasH,
    contentW,
    contentH,
    angleDeg: knobs.angleDeg,
    tileGapRatio: knobs.tileGapRatio,
    stagger: knobs.stagger,
    maxTiles: knobs.maxTiles,
  });

  // The art is built at the (possibly clamped) plan content dims, then
  // padded to CELL dims as real geometry — the cell-sized nested child
  // is what keeps the rotation from clipping (see pageGrid.ts header).
  const art = buildContentChild(knobs, plan.contentW, plan.contentH);
  const instance = buildPaddedInstanceChild({ plan, art });
  const pattern = buildPagePatternChild({
    canvasW,
    canvasH,
    plan,
    angleDeg: knobs.angleDeg,
    instance,
  });

  return stampOnMedia({
    baseSource,
    baseAssets,
    canvasW,
    canvasH,
    rect: { x: 0, y: 0, w: canvasW, h: canvasH },
    layers: [{ child: pattern, opacity: knobs.opacity, key: "pattern" }],
  });
}

/**
 * Debug-mode layout-contract constraints per mode. Skipped for the m0
 * hatch (the cell aspect is user-chosen) and for adaptive mode (layer
 * labels vary with the variant plan — wm:light / wm:dark / wm:wm — and
 * an unmatched label would false-fire).
 */
function debugConstraints(knobs: WatermarkStepKnobs): LayoutConstraint[] {
  if (knobs.mode === "page") {
    return [{ label: "wm:pattern", minWidthFrac: 0.99, minHeightFrac: 0.99 }];
  }
  if (knobs.mode === "adaptive" || knobs.layoutM0) return [];
  return [{ label: "wm:wm", aspect: knobs.contentInfo.aspect, aspectTolerance: 0.06 }];
}
