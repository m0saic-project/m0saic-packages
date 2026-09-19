/**
 * Pure knobs + document builder for `@m0saic/media/blur-regions/v1`.
 *
 * No IO, no ffmpeg, no ctx — everything here is unit-testable in
 * isolation (highlights' `plan.ts` precedent). Region parsing/resolving
 * lives in `@m0saic/template-utils` (`parseRegionsValue` /
 * `resolveRegionsToPx` / `regionsToMaskPathD`) so the next
 * regions-consuming template reuses it; this module owns what is
 * blur-specific: knob clamping and the two-source document shape.
 *
 * The mechanism (zero engine changes): `m0 "F{F}"` — the base cell shows
 * the sharp video; ONE full-canvas overlay shows the SAME asset with the
 * effect applied to the whole frame, alpha-clipped to the drawn regions
 * by a multi-subpath `inline-mask`. The per-tile filter chain runs the
 * content effect BEFORE the mask (core `applyTileEffects`), so the full
 * frame blurs first and then clips — no crop-edge artifacts, and N
 * regions cost one mask + one effect pass.
 */

import type {
  MosaicAssetManifest,
  MosaicDocument,
  MosaicPipelineStep,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  placeInsetPieces,
  placeOptimizedPieces,
  regionsToCompositeMask,
  regionsToMaskPathD,
  slugifyAssetKeyFromPath,
  type ResolvedRegionMask,
} from "@m0saic/template-utils";

/** Hard cap on regions per invocation (mirrors the prop's jsonSchema). */
export const MAX_REGIONS = 50;

export type BlurRegionsMode = "blur" | "pixelate";

/**
 * How the regions become document structure:
 *  - `"inset"` (default) — REAL m0 geometry via `placeInsetPieces`: cells
 *    quantize outward to a divisor lattice (compact DSL even for
 *    precision-pinned hand-drawn rects) and per-source `placement.inset`
 *    recovers the exact bounds. The regions are visible/selectable in
 *    every geometry surface (DSL view, Layout, wireframe, structure).
 *  - `"exact"` — real m0 geometry via zero-drift `placeOptimizedPieces`
 *    (byte-identical to `placeRects`): exact cells, no insets, DSL
 *    length grows with the rects' pixel precision.
 *  - `"mask"` — no region geometry: ONE full-canvas overlay of the same
 *    media with the effect applied full-frame, alpha-clipped to the
 *    regions by a multi-subpath inline-mask. Cheapest render for many
 *    regions (one effect pass) and the softest region edges (the blur
 *    samples the surrounding sharp content before clipping), but the
 *    geometry is invisible to m0 surfaces.
 */
export type BlurRegionsGeometry = "inset" | "exact" | "mask";

/** Resolved knobs the document builder needs (validated once by the template). */
export type BlurRegionsKnobs = {
  mode: BlurRegionsMode;
  /** blur: gblur sigma px (1..200). pixelate: censor block px (2..128). */
  strength: number;
};

export const DEFAULT_STRENGTH = 24;
export const BLUR_SIGMA_MIN = 1;
export const BLUR_SIGMA_MAX = 200;
export const PIXELIZE_MIN = 2;
export const PIXELIZE_MAX = 128;

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** Resolve + clamp props to deterministic knobs. `mode` is validated
 * (not silently coerced) by render() BEFORE this runs. */
export function resolveBlurRegionsKnobs(props: {
  mode?: BlurRegionsMode;
  strength?: number;
}): BlurRegionsKnobs {
  const mode: BlurRegionsMode = props.mode === "pixelate" ? "pixelate" : "blur";
  const raw =
    props.strength != null && Number.isFinite(props.strength)
      ? Math.round(props.strength)
      : DEFAULT_STRENGTH;
  const strength =
    mode === "pixelate"
      ? clamp(raw, PIXELIZE_MIN, PIXELIZE_MAX)
      : clamp(raw, BLUR_SIGMA_MIN, BLUR_SIGMA_MAX);
  return { mode, strength };
}

/** Nearest even integer ≥ 2 (yuv420p-safe dimensions; highlights precedent). */
export function evenRound(v: number): number {
  return Math.max(2, Math.round(v / 2) * 2);
}

/** Duration for image inputs — a single-frame render (watermark precedent). */
export const IMAGE_STILL_MS = 40;

/** Image container for a still input: jpeg in → jpeg out, else png
 * (watermark's `imageOutputFormat: "match"` behavior). */
export function stillContainer(inputPath: string): "png" | "jpeg" {
  return /\.jpe?g$/i.test(inputPath) ? "jpeg" : "png";
}

// (The pre-`placement.sourceRect` cover+camera window solve lived here —
// the engine primitive replaced it: a region cell now just declares the
// exact source rect it shows.)

/**
 * Build the document per the geometry strategy. Always: sharp base
 * (audio passes through on video) below, effect content above, audio
 * disabled on every effect copy so the track isn't doubled. Canvas
 * comes from the probed source; duration and fps live on the wrapping
 * pipeline step (see {@link buildBlurRegionsStep}).
 *
 * ZERO rects is the drawing base case — the user sees their media
 * untouched and draws on the preview — so it emits a single-cell `"F"`
 * document with only the base source regardless of strategy.
 */
export type BlurRegionRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional rect-local mask carved inside the region ("rect first,
   * mask second") — rides onto the cell's / composite mask's geometry. */
  mask?: ResolvedRegionMask;
};

export function buildBlurRegionsDocument(args: {
  inputPath: string;
  mediaType: "video" | "image";
  size: { width: number; height: number };
  /** Integer px rects already resolved into `size` space. */
  rectsPx: BlurRegionRect[];
  knobs: BlurRegionsKnobs;
  geometry: BlurRegionsGeometry;
}): MosaicDocument {
  const { inputPath, mediaType, size, rectsPx, knobs, geometry } = args;
  const isVideo = mediaType === "video";

  const assetId = asAssetId(slugifyAssetKeyFromPath(inputPath));
  const assets: MosaicAssetManifest = {
    [assetId]: { kind: "file", path: inputPath, mediaType },
  } as MosaicAssetManifest;

  const effectKnob =
    knobs.mode === "pixelate" ? { pixelize: knobs.strength } : { blur: knobs.strength };

  const base: MosaicSource = {
    type: "media",
    mediaType,
    assetId,
    // Cell aspect == source aspect up to even-rounding, so cover is an
    // exact fit (no visible crop). Audio left UNSET → passes through.
    placement: { fit: "cover" },
    editor: { owner: "template", label: "blur-regions:base" },
  };

  const docShell = {
    kind: "mosaic_document" as const,
    version: 1 as const,
    assets,
    size,
    backgroundColor: "#000000" as const,
  };

  if (rectsPx.length === 0) {
    return { ...docShell, m0: toM0String("F", "BlurRegions"), sources: [base] };
  }

  if (geometry === "mask") {
    // Regions WITHOUT their own mask stay plain subpaths (byte-identical
    // to the pre-mask-authoring output); regions WITH a rect-local mask
    // become placed `parts` in the same composite.
    const composite = regionsToCompositeMask(rectsPx);
    const overlay: MosaicSource = {
      type: "media",
      mediaType,
      assetId,
      placement: { fit: "cover" },
      ...(isVideo ? { audio: { enabled: false } } : {}),
      effects: effectKnob,
      mask: {
        kind: "inline-mask",
        localPath: composite.localPath,
        bounds: { x: 0, y: 0, width: size.width, height: size.height },
        ...(composite.parts ? { parts: composite.parts } : {}),
      },
      editor: { owner: "template", label: "blur-regions:regions" },
    };
    return { ...docShell, m0: toM0String("F{F}", "BlurRegions"), sources: [base, overlay] };
  }

  // Real-geometry strategies: every region is an m0 CELL whose source
  // shows the exact window of the media underneath it via
  // `placement.sourceRect` (canvas ≡ source dims here, so the cell rect
  // IS the source rect), with the effect applied to that window. Cover
  // fit of a same-sized window is a 1:1 pixel mapping. The pieces
  // helpers compose the layers and return frame-aligned sources.
  const regionSource = (rect: BlurRegionRect): MosaicSource => {
    return {
      type: "media",
      mediaType,
      assetId,
      placement: {
        fit: "cover",
        sourceRect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      },
      ...(isVideo ? { audio: { enabled: false } } : {}),
      effects: effectKnob,
      // Rect-local mask carves the cell: bounds = the AUTHORED rect (the
      // path's design space), so the engine rescales the shape onto the
      // cell's content box regardless of the resolved cell size.
      ...(rect.mask
        ? {
            mask: {
              kind: "inline-mask" as const,
              localPath: rect.mask.path ?? "",
              bounds: { x: 0, y: 0, width: rect.mask.bounds.w, height: rect.mask.bounds.h },
              ...(rect.mask.strokes ? { strokes: rect.mask.strokes } : {}),
            },
          }
        : {}),
      editor: { owner: "template", label: "blur-regions:region" },
    } as MosaicSource;
  };

  const pieces = [
    // Base: full-canvas, lattice-aligned → placed untouched, painted first.
    { rect: { x: 0, y: 0, w: size.width, h: size.height, importance: 0 }, source: base },
    ...rectsPx.map((rect, i) => ({
      rect: { ...rect, importance: i + 1 },
      source: regionSource(rect),
    })),
  ];

  const placed =
    geometry === "exact"
      ? // Zero drift ⇒ byte-identical to placeRects: exact cells, DSL
        // length grows with the rects' pixel precision.
        placeOptimizedPieces({ rootW: size.width, rootH: size.height, pieces })
      : // Default: compact lattice cells + per-source insets recovering
        // the exact bounds ("inset"). Hostile (prime) axes place exactly
        // instead of throwing — a runtime template renders any canvas.
        placeInsetPieces({
          rootW: size.width,
          rootH: size.height,
          pieces,
          onHostile: "exact",
        });

  return { ...docShell, m0: placed.m0, sources: placed.sources };
}

/**
 * Wrap the document in ONE pipeline step. A pipeline step is the only
 * vehicle where the output's canvas tracks the input's probed dims — a
 * plain returned document's `size` is overridden by an explicit CLI
 * `-w`/`-h` (or the app's Width/Height fields), which would misalign
 * the mask regions against the re-fitted content (watermark precedent,
 * its pipeline.ts header). Under a 1-output-step `emit:"multi"` the
 * planner collapses to the bare `-o` file and the per-step format is
 * inert — the user's `-o` extension wins (highlights single-range
 * precedent).
 */
export function buildBlurRegionsStep(args: {
  inputPath: string;
  stepBaseName: string;
  mediaType: "video" | "image";
  size: { width: number; height: number };
  /** Probed video duration; ignored for images (IMAGE_STILL_MS). */
  durationMs?: number;
  rectsPx: BlurRegionRect[];
  knobs: BlurRegionsKnobs;
  geometry: BlurRegionsGeometry;
}): MosaicPipelineStep {
  const isVideo = args.mediaType === "video";
  const doc = buildBlurRegionsDocument(args);
  return {
    name: args.stepBaseName,
    label: inputLabel(args.inputPath),
    durationMs: isVideo
      ? Math.max(1, Math.round(args.durationMs ?? 1))
      : IMAGE_STILL_MS,
    file: {
      ...doc,
      format: isVideo
        ? { kind: "video", container: "mp4" }
        : { kind: "image", container: stillContainer(args.inputPath) },
    },
  };
}

/** Input basename without directory or extension — the step label.
 * Local (not node:path) so the template stays web-bundle clean. */
export function inputLabel(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
