import type {
  MosaicAssetManifest,
  MosaicCodeValue,
  MosaicColor,
  MosaicDocument,
  MosaicEffectProps,
  MosaicEngineContext,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { placeRects } from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  maskAtlasSource,
  measureText,
  placeInsetPieces,
  registerTemplate,
  textToPath,
  withGeometryContract,
  type GeometryExpectation,
  type InsetPiece,
} from "@m0saic/template-utils";

import { PAGE_SKELETON_CAPTURE_SNIPPET } from "./capture/capture-snippet-source";
import {
  DEFAULT_MAX_RECTS,
  layoutCapture,
  MAX_DEPTH_BUCKETS,
  projectOverlayLayerCount,
  type CanvasSkeletonRect,
  type PageSkeletonContainerMode,
  type PageSkeletonScaleMode,
} from "./layout";
import { SAMPLE_CAPTURE } from "./sample-capture";
import { parseCapture, type PageSkeletonRectKind } from "./schema";

const PAGE_SKELETON_ID = "@m0saic/web/page-skeleton/v1";

export type PageSkeletonAppearance = {
  /** Page/canvas background. */
  bg?: string;
  /** Structural skeleton fill. */
  fill?: string;
  /** Text-bar fill. */
  textFill?: string;
  /** Image/control fill. */
  imageFill?: string;
  /** Shape handling. */
  radiusMode?: "none" | "captured" | "uniform";
  /** Uniform radius used when radiusMode is "uniform". */
  uniformRadiusPx?: number;
};

export type PageSkeletonBehavior = {
  maxRects?: number;
  showTextLines?: boolean;
  showImages?: boolean;
  showControls?: boolean;
  showDividers?: boolean;
  scaleMode?: PageSkeletonScaleMode;
  containerMode?: PageSkeletonContainerMode;
  /** Emit exact DSL cells instead of quantized cells with recovery insets. */
  pureRects?: boolean;
};

export type PageSkeletonMotionMode = "shimmer" | "pulse";
export type PageSkeletonMotionDirection =
  | "horizontal"
  | "diagonal"
  | "vertical";

export type PageSkeletonMotion = {
  /** Loading motion applied when outputFormat is mp4. */
  mode?: PageSkeletonMotionMode;
  /** Direction of the travelling shimmer band. */
  direction?: PageSkeletonMotionDirection;
  /** Shimmer-band width as a fraction of the canvas axis. */
  bandWidth?: number;
  /** Resting opacity of animated skeleton rectangles. */
  minOpacity?: number;
};

export type PageSkeletonV1Props = {
  /** Exact browser-console script handed from the template to the user. */
  captureSnippet?: MosaicCodeValue;
  /** Browser-capture schema v1, provided as parsed JSON or a raw JSON string. */
  capture: unknown;
  /** Static PNG or animated MP4. */
  outputFormat?: "png" | "mp4";
  motion?: PageSkeletonMotion;
  appearance?: PageSkeletonAppearance;
  behavior?: PageSkeletonBehavior;
  /** P4 customization handshake; declared now so the public prop shape is stable. */
  overrides?: unknown;
  /** Run the zero-drift geometry contract and surface drop counts. */
  debug?: boolean;
  /** P4 index-label overlay; declared now so the public prop shape is stable. */
  debugIndices?: boolean;
};

export type PageSkeletonRectOverride = {
  i: number;
  hide?: boolean;
  fill?: string;
  shape?: "rect" | "rounded" | "pill" | "circle";
  radiusPx?: number;
};

// Tiny field helpers mirror screencap_grid/v2 and stay local to this pack.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fBool = (label: string, description = ""): any => ({
  type: "boolean",
  required: false,
  description,
  meta: { ui: { label } },
});
const fNum = (
  label: string,
  description = "",
  control?: any,
  constraints?: any,
): any => ({
  type: "number",
  required: false,
  description,
  meta: {
    ...(constraints ? { constraints } : {}),
    ...(control ? { control } : {}),
    ui: { label },
  },
});
const fEnum = (label: string, oneOf: string[], description = ""): any => ({
  type: "string",
  required: false,
  description,
  meta: { constraints: { oneOf }, ui: { label } },
});
const fColor = (label: string, description = ""): any => ({
  type: "string",
  required: false,
  description,
  meta: {
    constraints: { isColor: true },
    control: { colorPicker: true },
    ui: { label },
  },
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const propsSchema = definePropsSchema<PageSkeletonV1Props>({
  captureSnippet: {
    type: "code",
    required: false,
    description:
      "Copy this exact JavaScript into the browser console. It copies anonymous visible-page geometry as JSON for Page capture.",
    meta: {
      ui: { label: "Browser capture snippet", order: 1, primary: true },
    },
  },
  capture: {
    type: "json",
    required: true,
    description:
      "Anonymous geometry from the page-skeleton browser snippet. See packages/docs/web-page-skeleton/README.md for the capture workflow.",
    meta: {
      control: { flavor: "jsonModal" },
      ui: { label: "Page capture", order: 2, primary: true },
    },
  },
  outputFormat: {
    type: "string",
    required: false,
    description:
      "PNG keeps the editable still; MP4 animates the same rectangles as a looping loading skeleton.",
    meta: {
      constraints: { oneOf: ["png", "mp4"] },
      control: {
        options: [
          { value: "png", label: "Still PNG" },
          { value: "mp4", label: "Animated MP4" },
        ],
      },
      ui: { label: "Output", order: 3, primary: true },
    },
  },
  motion: {
    type: "group",
    required: false,
    description:
      "Looping loading motion used by Animated MP4 output. Geometry and source count stay unchanged.",
    meta: { ui: { label: "Motion", order: 4, collapsedByDefault: false } },
    fields: {
      mode: fEnum(
        "Mode",
        ["shimmer", "pulse"],
        "Shimmer scans a bright band across the page; pulse breathes all content together.",
      ),
      direction: fEnum(
        "Direction",
        ["horizontal", "diagonal", "vertical"],
        "Canvas direction used by the shimmer scan.",
      ),
      bandWidth: fNum(
        "Band width",
        "Width of the shimmer band as a fraction of the canvas axis.",
        { flavor: "slider", step: 0.01 },
        { min: 0.05, max: 1 },
      ),
      minOpacity: fNum(
        "Resting opacity",
        "Lowest skeleton opacity between shimmer passes or pulse peaks.",
        { flavor: "slider", step: 0.01 },
        { min: 0.1, max: 0.95 },
      ),
    },
  },
  appearance: {
    type: "group",
    required: false,
    description: "Page, per-kind skeleton colors, and corner treatment.",
    meta: { ui: { label: "Appearance", order: 5, collapsedByDefault: true } },
    fields: {
      bg: fColor("Background", "Canvas color behind the captured page geometry."),
      fill: fColor("Fill", "Skeleton rectangle fill."),
      textFill: fColor("Text fill", "Captured browser line-box fill."),
      imageFill: fColor("Image fill", "Image, video, avatar, and control fill."),
      radiusMode: fEnum(
        "Radius mode",
        ["none", "captured", "uniform"],
        "Use captured browser radii, square corners, or one uniform canvas-pixel radius.",
      ),
      uniformRadiusPx: fNum(
        "Uniform radius",
        "Canvas-pixel radius used by uniform mode.",
        { flavor: "slider", step: 1, unit: "px" },
        {
          min: 0,
          max: 256,
        },
      ),
    },
  },
  behavior: {
    type: "group",
    required: false,
    description: "Capture filtering, scaling, and containing-block behavior.",
    meta: { ui: { label: "Behavior", order: 6, collapsedByDefault: true } },
    fields: {
      maxRects: fNum(
        "Max rects",
        "Maximum retained capture rectangles and independently placed skeleton sources.",
        { flavor: "slider", step: 1 },
        { min: 1, max: 600 },
      ),
      showTextLines: fBool("Text lines", "Render captured browser line boxes."),
      showImages: fBool("Images", "Render image/replaced-element rectangles."),
      showControls: fBool("Controls", "Render form-control rectangles."),
      showDividers: fBool("Dividers", "Render thin divider rectangles."),
      scaleMode: fEnum(
        "Scale",
        ["fit", "fill", "stretch"],
        "fit letterboxes, fill crops, stretch scales each axis independently.",
      ),
      containerMode: fEnum(
        "Containers",
        ["keep", "drop"],
        "Keep large painted wrappers or prune wrappers containing several descendants.",
      ),
      pureRects: fBool(
        "Pure DSL rects",
        "Emit exact frame bounds with no placement insets. Easier for custom cell-local masks, at the cost of a larger m0 program.",
      ),
    },
  },
  overrides: {
    type: "json",
    required: false,
    description:
      'Array of {i, hide?, fill?, shape?: "rect"|"rounded"|"pill"|"circle", radiusPx?}. Indices refer to capture.rects[].',
    meta: {
      control: { flavor: "jsonModal" },
      ui: { label: "Rect overrides", order: 7 },
    },
  },
  debug: {
    type: "boolean",
    required: false,
    description:
      "Run the geometry contract and include capture filtering/drop counts in the document label.",
    meta: { ui: { label: "Debug geometry", order: 8, collapsedByDefault: true } },
  },
  debugIndices: {
    type: "boolean",
    required: false,
    description:
      "Programmatic diagnostic that overlays retained capture indices. Prefer Make canvas selection and the Structure panel for interactive editing.",
    meta: { ui: { label: "Show rect indices", order: 9, hidden: true } },
  },
});

// One step darker than the #e2 / #e8 / #d8 it shipped with: on the white page
// the lifted containers read as white and the cards as barely-there
// (founder, 2026-09-16: "a tad darker still"). Depth shading still lifts
// containers toward the page and darkens the top bucket from these.
const DEFAULT_APPEARANCE: Required<PageSkeletonAppearance> = {
  bg: "#ffffff",
  fill: "#d4d4d4",
  textFill: "#dadada",
  imageFill: "#c8c8c8",
  radiusMode: "captured",
  uniformRadiusPx: 8,
};

const DEFAULT_BEHAVIOR: Required<PageSkeletonBehavior> = {
  maxRects: DEFAULT_MAX_RECTS,
  showTextLines: true,
  showImages: true,
  showControls: true,
  showDividers: true,
  scaleMode: "fit",
  containerMode: "keep",
  pureRects: false,
};

const DEFAULT_MOTION: Required<PageSkeletonMotion> = {
  // Pulse = the whole skeleton breathes together — the default motion
  // (founder 2026-09-13: skeletons breathe in practice). Shimmer is the
  // scanning-band alternative.
  mode: "pulse",
  direction: "diagonal",
  bandWidth: 0.3,
  minOpacity: 0.68,
};

const OVERRIDE_SHAPES = new Set(["rect", "rounded", "pill", "circle"]);

/** Parse the jsonModal's object-or-string value and validate capture indices. */
export function parseRectOverrides(
  value: unknown,
  rectCount: number,
): Map<number, PageSkeletonRectOverride> {
  let parsed = value;
  if (typeof value === "string") {
    if (!value.trim()) return new Map();
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new Error(
        `overrides is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (parsed == null) return new Map();
  if (!Array.isArray(parsed)) {
    throw new Error("overrides must be an array");
  }

  const overrides = new Map<number, PageSkeletonRectOverride>();
  parsed.forEach((candidate, position) => {
    if (
      candidate == null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new Error(`overrides[${position}] must be an object`);
    }
    const item = candidate as Record<string, unknown>;
    if (!Number.isInteger(item.i) || (item.i as number) < 0) {
      throw new Error(`overrides[${position}].i must be a non-negative integer`);
    }
    const i = item.i as number;
    if (i >= rectCount) {
      throw new Error(
        `overrides[${position}].i ${i} is outside capture.rects[] (length ${rectCount})`,
      );
    }
    if (overrides.has(i)) {
      throw new Error(`overrides[${position}].i ${i} is duplicated`);
    }
    if (item.hide !== undefined && typeof item.hide !== "boolean") {
      throw new Error(`overrides[${position}].hide must be a boolean`);
    }
    if (
      item.fill !== undefined &&
      (typeof item.fill !== "string" || !item.fill.trim())
    ) {
      throw new Error(`overrides[${position}].fill must be a non-empty string`);
    }
    if (
      item.shape !== undefined &&
      (typeof item.shape !== "string" || !OVERRIDE_SHAPES.has(item.shape))
    ) {
      throw new Error(
        `overrides[${position}].shape must be rect, rounded, pill, or circle`,
      );
    }
    if (
      item.radiusPx !== undefined &&
      (typeof item.radiusPx !== "number" ||
        !Number.isFinite(item.radiusPx) ||
        item.radiusPx < 0)
    ) {
      throw new Error(`overrides[${position}].radiusPx must be a finite number ≥ 0`);
    }
    overrides.set(i, {
      i,
      ...(item.hide !== undefined ? { hide: item.hide as boolean } : {}),
      ...(item.fill !== undefined ? { fill: (item.fill as string).trim() } : {}),
      ...(item.shape !== undefined
        ? {
            shape: item.shape as PageSkeletonRectOverride["shape"],
          }
        : {}),
      ...(item.radiusPx !== undefined
        ? { radiusPx: item.radiusPx as number }
        : {}),
    });
  });
  return overrides;
}

function colorOr(value: string | undefined, fallback: string): MosaicColor {
  return (typeof value === "string" && value.trim() ? value.trim() : fallback) as MosaicColor;
}

type Rgb = { r: number; g: number; b: number };

function parseHexColor(value: string): Rgb | null {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

const hexByte = (value: number): string =>
  Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");

/** Blend two hex colors; non-hex editor values safely retain the base fill. */
export function blendHexColors(
  base: string,
  toward: string,
  towardWeight: number,
): MosaicColor {
  const a = parseHexColor(base);
  const b = parseHexColor(toward);
  if (!a || !b) return base as MosaicColor;
  const weight = Math.max(0, Math.min(1, towardWeight));
  return `#${hexByte(a.r + (b.r - a.r) * weight)}${hexByte(
    a.g + (b.g - a.g) * weight,
  )}${hexByte(a.b + (b.b - a.b) * weight)}` as MosaicColor;
}

/**
 * Keep the skeleton monochrome while making its paint order legible:
 * containers sit close to the page background; deeper rects step from a
 * light gray toward the authored fill, with the top bucket darkened slightly.
 */
export function shadedRectangleFill(
  rect: Pick<CanvasSkeletonRect, "zBucket" | "isSoftContainer">,
  fill: MosaicColor,
  bg: MosaicColor,
): MosaicColor {
  if (rect.isSoftContainer) return blendHexColors(fill, bg, 0.82);
  const depth = Math.max(0, Math.min(1, rect.zBucket / 5));
  const lifted = blendHexColors(fill, bg, 0.48 * (1 - depth));
  return blendHexColors(lifted, "#000000", 0.08 * depth);
}

function errorDocument(message: string, ctx: MosaicEngineContext): MosaicDocument {
  const width = Math.max(1, Math.round(ctx.target.width));
  const height = Math.max(1, Math.round(ctx.target.height));
  return {
    ...makeErrorMosaic(message, {
      width,
      height,
      title: "Page Skeleton",
      errorCode: "PAGE_SKELETON_CAPTURE",
    }),
    fps: ctx.target.fps,
    durationMs: ctx.target.durationMs,
    size: { width, height },
    format: { kind: "image", container: "png" },
  };
}

type ResolvedAppearance = Required<PageSkeletonAppearance>;

type PaintedSkeletonRect = {
  rect: CanvasSkeletonRect;
  fill: MosaicColor;
  radiusPx: number;
  /** Position of this rect's entry in the `overrides` array, when it has one
   *  — the leaf Make's double-click edits (`overrides[position].fill`). */
  overridePosition?: number;
};

export type PageSkeletonCompositionStats = {
  independentRects: number;
  debugLabels: number;
  projectedLayers: number;
};

export type PageSkeletonComposition = {
  pieces: InsetPiece[];
  stats: PageSkeletonCompositionStats;
};

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));
const exprNumber = (value: number): string =>
  String(Number(value.toFixed(4)));

export type ResolvedPageSkeletonMotion = Required<PageSkeletonMotion>;

export function resolvePageSkeletonMotion(
  value: PageSkeletonMotion | undefined,
): ResolvedPageSkeletonMotion {
  const motion = { ...DEFAULT_MOTION, ...(value ?? {}) };
  if (motion.mode !== "shimmer" && motion.mode !== "pulse") {
    throw new Error(`motion.mode must be shimmer or pulse (got "${motion.mode}")`);
  }
  if (
    motion.direction !== "horizontal" &&
    motion.direction !== "diagonal" &&
    motion.direction !== "vertical"
  ) {
    throw new Error(
      `motion.direction must be horizontal, diagonal, or vertical (got "${motion.direction}")`,
    );
  }
  if (
    !Number.isFinite(motion.bandWidth) ||
    motion.bandWidth < 0.05 ||
    motion.bandWidth > 1
  ) {
    throw new Error(
      `motion.bandWidth must be in [0.05, 1] (got ${motion.bandWidth})`,
    );
  }
  if (
    !Number.isFinite(motion.minOpacity) ||
    motion.minOpacity < 0.1 ||
    motion.minOpacity > 0.95
  ) {
    throw new Error(
      `motion.minOpacity must be in [0.1, 0.95] (got ${motion.minOpacity})`,
    );
  }
  return motion;
}

/** Canvas-space rank used by the travelling shimmer band. */
export function motionRankForRect(
  rect: Pick<CanvasSkeletonRect, "x" | "y" | "w" | "h">,
  canvas: { w: number; h: number },
  direction: PageSkeletonMotionDirection,
): number {
  const nx = clampUnit((rect.x + rect.w / 2) / Math.max(1, canvas.w));
  const ny = clampUnit((rect.y + rect.h / 2) / Math.max(1, canvas.h));
  if (direction === "horizontal") return nx;
  if (direction === "vertical") return ny;
  return clampUnit((nx + ny) / 2);
}

/**
 * A one-cycle native-fade color source. The output clip itself is the seamless
 * cycle: shimmer begins and ends at the resting color; pulse does the same.
 * Keeping motion inside the tile stream preserves grid lowering, avoiding the
 * deep per-cell overlay chain that animated `overlay.alpha` would create.
 */
export function buildPageSkeletonMotionLavfi(
  fill: MosaicColor,
  bg: MosaicColor,
  rank: number,
  motion: ResolvedPageSkeletonMotion,
  durationSec: number,
): string | null {
  const fillRgb = parseHexColor(String(fill));
  const bgRgb = parseHexColor(String(bg));
  if (!fillRgb || !bgRgb) return null;

  const restRgb: Rgb = {
    r: fillRgb.r + (bgRgb.r - fillRgb.r) * (1 - motion.minOpacity),
    g: fillRgb.g + (bgRgb.g - fillRgb.g) * (1 - motion.minOpacity),
    b: fillRgb.b + (bgRgb.b - fillRgb.b) * (1 - motion.minOpacity),
  };
  const ffmpegColor = (rgb: Rgb): string =>
    `0x${hexByte(rgb.r)}${hexByte(rgb.g)}${hexByte(rgb.b)}`;
  const fillColor = ffmpegColor(fillRgb);
  const restColor = ffmpegColor(restRgb);
  const duration = Math.max(0.1, durationSec);
  // Finish before the encoded clip's final frame so looping back to t=0 is
  // visually identical even though video containers omit the end endpoint.
  const activeDuration = duration * 0.9;

  if (motion.mode === "pulse") {
    // in THEN out is the only order ffmpeg composes: a fade-in outputs its
    // colour fully before its `st` (WAITING) and a fade-out holds it after
    // `st+d` (DONE), so out→in would blank the first half to the rest
    // colour. Consequence: frame 0 IS the rest colour — the poster time
    // (below) points at the peak so posters and the preview's rest frame
    // show the authored fill (founder, 2026-09-16: "too light").
    const half = exprNumber(activeDuration / 2);
    return (
      `color=c=${fillColor},` +
      `fade=t=in:st=0:d=${half}:color=${restColor},` +
      `fade=t=out:st=${half}:d=${half}:color=${restColor}`
    );
  }

  const normalizedRank = clampUnit(rank);
  const travel = 1 + motion.bandWidth;
  const halfBand = motion.bandWidth / 2;
  const fadeSec = Math.max(0.001, (activeDuration * halfBand) / travel);
  const fadeInStart = (activeDuration * normalizedRank) / travel;
  const fadeOutStart =
    (activeDuration * (normalizedRank + halfBand)) / travel;
  return (
    `color=c=${fillColor},` +
    `fade=t=in:st=${exprNumber(fadeInStart)}:d=${exprNumber(fadeSec)}:color=${restColor},` +
    `fade=t=out:st=${exprNumber(fadeOutStart)}:d=${exprNumber(fadeSec)}:color=${restColor}`
  );
}

/** Resolve the authored per-kind base fill before deterministic depth shading. */
export function baseFillForKind(
  kind: PageSkeletonRectKind,
  appearance: ResolvedAppearance,
): MosaicColor {
  if (kind === "text") return colorOr(appearance.textFill, DEFAULT_APPEARANCE.textFill);
  if (kind === "image" || kind === "control") {
    return colorOr(appearance.imageFill, DEFAULT_APPEARANCE.imageFill);
  }
  return colorOr(appearance.fill, DEFAULT_APPEARANCE.fill);
}

/** Radius in final canvas pixels for the selected appearance mode. */
export function effectiveRadiusPx(
  rect: Pick<CanvasSkeletonRect, "w" | "h" | "r">,
  appearance: Pick<ResolvedAppearance, "radiusMode" | "uniformRadiusPx">,
): number {
  const halfShort = Math.floor(Math.min(rect.w, rect.h) / 2);
  if (appearance.radiusMode === "none") return 0;
  const requested =
    appearance.radiusMode === "uniform"
      ? Math.round(
          Number.isFinite(appearance.uniformRadiusPx)
            ? appearance.uniformRadiusPx
            : DEFAULT_APPEARANCE.uniformRadiusPx,
        )
      : rect.r;
  return Math.max(0, Math.min(halfShort, requested));
}

/** Apply the only override that changes geometry: an inscribed centered circle. */
export function overriddenRectGeometry(
  rect: CanvasSkeletonRect,
  override: PageSkeletonRectOverride | undefined,
): CanvasSkeletonRect {
  if (override?.shape !== "circle") return rect;
  const size = Math.min(rect.w, rect.h);
  return {
    ...rect,
    x: rect.x + Math.floor((rect.w - size) / 2),
    y: rect.y + Math.floor((rect.h - size) / 2),
    w: size,
    h: size,
    r: Math.floor(size / 2),
  };
}

/** Resolve explicit override shape/radius on top of the appearance default. */
export function overriddenRadiusPx(
  rect: Pick<CanvasSkeletonRect, "w" | "h" | "r">,
  appearance: Pick<ResolvedAppearance, "radiusMode" | "uniformRadiusPx">,
  override: PageSkeletonRectOverride | undefined,
): number {
  const halfShort = Math.floor(Math.min(rect.w, rect.h) / 2);
  if (override?.shape === "rect") return 0;
  if (override?.shape === "pill" || override?.shape === "circle") return halfShort;
  if (override?.radiusPx !== undefined) {
    return Math.max(0, Math.min(halfShort, Math.round(override.radiusPx)));
  }
  return effectiveRadiusPx(rect, appearance);
}

/**
 * Map a pixel radius to the engine's normalized rounding contract. Near-half
 * radii become true pills/circles; every real structural tile carries an SVG
 * rounding effect, including radius zero, so Make can expose its radius knob.
 */
export function roundingForRect(
  rect: Pick<CanvasSkeletonRect, "w" | "h">,
  radiusPx: number,
): NonNullable<MosaicEffectProps["rounding"]> {
  const short = Math.min(rect.w, rect.h);
  const halfShort = Math.floor(short / 2);
  if (radiusPx > 0 && radiusPx >= halfShort - 1) {
    return { cornerStyle: "pill", rasterizer: "svg" };
  }
  return {
    cornerStyle: "rounded",
    borderRadius: clampUnit((2 * radiusPx) / short),
    rasterizer: "svg",
  };
}

function rectangleSource(
  painted: Pick<PaintedSkeletonRect, "rect" | "fill" | "radiusPx" | "overridePosition">,
  motionLavfi?: string | null,
): MosaicSource {
  const effects = {
    rounding: roundingForRect(painted.rect, painted.radiusPx),
  };
  const source: MosaicSource = motionLavfi
    ? { type: "lavfi", lavfi: motionLavfi, effects }
    : makeColorTile(painted.fill, { effects });
  return {
    ...source,
    editor: {
      owner: "user",
      label: `Capture rect ${painted.rect.i} · ${painted.rect.k}`,
      // `overrides` is a structured (json) prop, so a binding must name a LEAF
      // by path + kind (bindingsSound convention). The leaf this rect shows is
      // its own row's `fill`; a rect with no override row has no leaf to edit
      // and carries no binding. (A capture-index binding via `index` was
      // rejected by every host as kind-required — Make never offered it.)
      ...(painted.overridePosition !== undefined
        ? { binding: { propKey: "overrides", path: [painted.overridePosition, "fill"], kind: "color" as const } }
        : {}),
    },
  };
}

type AtlasRect = Pick<CanvasSkeletonRect, "x" | "y" | "w" | "h">;

function claimsFullCanvas(
  rect: AtlasRect,
  canvas: { w: number; h: number },
): boolean {
  return (
    rect.x === 0 &&
    rect.y === 0 &&
    rect.w === canvas.w &&
    rect.h === canvas.h
  );
}

function debugLabelColor(bg: MosaicColor): MosaicColor {
  const rgb = parseHexColor(String(bg));
  if (!rgb) return "#3f3f46";
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance >= 0.5 ? "#3f3f46" : "#f4f4f5";
}

function debugIndexPieces(
  painted: PaintedSkeletonRect[],
  bg: MosaicColor,
): InsetPiece[] {
  return painted.map(({ rect }) => {
    const digits = String(rect.i).length;
    const fitted = Math.floor(
      Math.min(16, rect.h * 0.72, rect.w / Math.max(1, digits * 0.62)),
    );
    const fontSize = Math.max(6, fitted);
    const metrics = measureText(String(rect.i), { fontSize });
    const w = Math.max(1, Math.min(rect.w, Math.ceil(metrics.width) + 2));
    const h = Math.max(1, Math.min(rect.h, Math.ceil(metrics.height) + 2));
    const x = rect.x + Math.floor((rect.w - w) / 2);
    const y = rect.y + Math.floor((rect.h - h) / 2);
    return {
      rect: {
        x,
        y,
        w,
        h,
        importance: MAX_DEPTH_BUCKETS,
      },
      source: maskAtlasSource(
        [
          textToPath(
            String(rect.i),
            {
              fontSize,
              hAlign: "center",
              vAlign: "middle",
              rect: { x: 0, y: 0, width: w, height: h },
            },
            { width: w, height: h },
          ),
        ],
        debugLabelColor(bg),
        { width: w, height: h },
      ),
    };
  });
}

/**
 * One retained capture rectangle becomes one real, independently selectable
 * source and one placement piece. `maxRects` is therefore a literal source
 * cap; normal skeleton output never hides multiple painted rects in an atlas.
 */
export function planSkeletonComposition(
  rects: CanvasSkeletonRect[],
  appearance: ResolvedAppearance,
  bg: MosaicColor,
  canvas: { w: number; h: number },
  customization: {
    overrides?: ReadonlyMap<number, PageSkeletonRectOverride>;
    debugIndices?: boolean;
    motion?: {
      config: ResolvedPageSkeletonMotion;
      durationSec: number;
    };
  } = {},
): PageSkeletonComposition {
  // Map insertion order == `overrides` array order (parseRectOverrides walks
  // the array and refuses duplicates), so a key's position IS its row index.
  const overrideOrder = [...(customization.overrides?.keys() ?? [])];
  const painted = rects.map((rect): PaintedSkeletonRect => {
    const override = customization.overrides?.get(rect.i);
    const geometry = overriddenRectGeometry(rect, override);
    const base = baseFillForKind(rect.k, appearance);
    return {
      rect: geometry,
      fill: override?.fill
        ? colorOr(override.fill, String(base))
        : shadedRectangleFill(geometry, base, bg),
      radiusPx: overriddenRadiusPx(geometry, appearance, override),
      ...(override ? { overridePosition: overrideOrder.indexOf(rect.i) } : {}),
    };
  });
  const basePieces: InsetPiece[] = painted.map((item) => ({
    rect: {
      x: item.rect.x,
      y: item.rect.y,
      w: item.rect.w,
      h: item.rect.h,
      importance: claimsFullCanvas(item.rect, canvas) ? -1 : item.rect.zBucket,
    },
    source: rectangleSource(
      item,
      customization.motion &&
        !item.rect.isSoftContainer &&
        !claimsFullCanvas(item.rect, canvas)
        ? buildPageSkeletonMotionLavfi(
            item.fill,
            bg,
            motionRankForRect(
              item.rect,
              canvas,
              customization.motion.config.direction,
            ),
            customization.motion.config,
            customization.motion.durationSec,
          )
        : undefined,
    ),
  }));
  const labelPieces =
    customization.debugIndices === true
      ? debugIndexPieces(painted, bg)
      : [];
  const pieces = [...basePieces, ...labelPieces];
  const nonBaseCanvasClaim = pieces.find(
    (piece) =>
      claimsFullCanvas(piece.rect, canvas) &&
      piece.rect.importance !== -1,
  );
  if (nonBaseCanvasClaim) {
    throw new Error(
      "page-skeleton composition produced a non-base piece that claims the full canvas",
    );
  }
  const projectedLayers = projectOverlayLayerCount(
    pieces.map((piece) => ({
      x: piece.rect.x,
      y: piece.rect.y,
      w: piece.rect.w,
      h: piece.rect.h,
      zBucket: piece.rect.importance ?? 0,
    })),
  );

  return {
    pieces,
    stats: {
      independentRects: painted.length,
      debugLabels: labelPieces.length,
      projectedLayers,
    },
  };
}

export type PageSkeletonPlacementResult = {
  m0: ReturnType<typeof placeRects>["m0"];
  sources: MosaicSource[];
  expectations: GeometryExpectation[];
};

function inlineMaskBounds(
  source: MosaicSource,
): { width: number; height: number } | null {
  const mask = (
    source as {
      mask?: {
        kind?: string;
        bounds?: { width: number; height: number };
      };
    }
  ).mask;
  return mask?.kind === "inline-mask" && mask.bounds
    ? { width: mask.bounds.width, height: mask.bounds.height }
    : null;
}

/**
 * Place the composed skeleton through either the efficient inset-recovery
 * path or exact pure DSL frames. Pure mode intentionally spends more m0 bytes
 * so source-local custom masks can treat the cell itself as their bounds.
 */
export function placeSkeletonPieces(options: {
  rootW: number;
  rootH: number;
  pieces: InsetPiece[];
  pureRects: boolean;
}): PageSkeletonPlacementResult {
  const { rootW, rootH, pieces, pureRects } = options;
  if (!pureRects) {
    const placed = placeInsetPieces({
      rootW,
      rootH,
      pieces,
      basis: 120,
      onHostile: "exact",
    });
    return {
      m0: placed.m0,
      sources: placed.sources,
      expectations: placed.expectations,
    };
  }

  for (let i = 0; i < pieces.length; i++) {
    const inset = (
      pieces[i].source as {
        placement?: { inset?: unknown };
      }
    ).placement?.inset;
    if (inset != null) {
      throw new Error(
        `pureRects cannot emit pieces[${i}] because its source already carries placement.inset`,
      );
    }
  }
  const placed = placeRects({
    rootW,
    rootH,
    rects: pieces.map((piece) => ({
      x: piece.rect.x,
      y: piece.rect.y,
      w: piece.rect.w,
      h: piece.rect.h,
      importance: piece.rect.importance,
      claimant: "F",
    })),
  });

  const sources: MosaicSource[] = [];
  const expectations: GeometryExpectation[] = [];
  for (const layer of placed.layers) {
    const ordered = [...layer.rectIndices].sort(
      (a, b) =>
        pieces[a].rect.y - pieces[b].rect.y ||
        pieces[a].rect.x - pieces[b].rect.x,
    );
    for (const index of ordered) {
      const piece = pieces[index];
      sources.push(piece.source);
      expectations.push({
        rect: {
          x: piece.rect.x,
          y: piece.rect.y,
          w: piece.rect.w,
          h: piece.rect.h,
        },
        inset: null,
        maskBounds: inlineMaskBounds(piece.source),
        tolerancePx: 0,
      });
    }
  }

  return { m0: placed.m0, sources, expectations };
}

export const PageSkeleton: MosaicTemplate<PageSkeletonV1Props> = {
  id: asTemplateId(PAGE_SKELETON_ID),
  label: "Page Skeleton",
  version: 1,
  description:
    "Turns anonymous browser geometry into an editable skeleton-loading still or looping shimmer/pulse video.",
  capabilities: { tier: "core" },
  tags: ["web", "skeleton", "loading", "capture", "wireframe", "animated", "designers", "developers", "landing-page", "mockup"],
  aspectRatio: { ideal: 1440 / 900, label: "16:10", mode: "none" },
  // Per-render deliverable: the reserved `outputFormat` prop drives Make and
  // CLI defaults. A static format hint would override MP4 with PNG.
  outputHints: {
    format: { kind: "video", container: "mp4" },
    width: 1440,
    height: 900,
    fps: 30,
    durationMs: 2400,
    // The pulse's PEAK: the fade-in completes at 0.45 × duration (the active
    // 90 % of the cycle, halved). Frame 0 is the faded rest colour, so the
    // poster and the Make scrubber's resting frame sit here, on the fill.
    posterTimeMs: 1080,
    note: "Animated MP4 by default — the skeleton breathes (pulse). Choose Output → Still PNG for the editable still.",
  },
  propsSchema,
  defaultProps: {
    captureSnippet: {
      language: "javascript",
      code: PAGE_SKELETON_CAPTURE_SNIPPET,
    },
    capture: SAMPLE_CAPTURE,
    outputFormat: "mp4",
    motion: DEFAULT_MOTION,
    appearance: DEFAULT_APPEARANCE,
    behavior: DEFAULT_BEHAVIOR,
    overrides: [],
    debug: false,
    debugIndices: false,
  },

  async render(
    props: PageSkeletonV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const width = Math.max(1, Math.round(ctx.target.width));
    const height = Math.max(1, Math.round(ctx.target.height));

    try {
      const outputFormat = props.outputFormat ?? "png";
      if (outputFormat !== "png" && outputFormat !== "mp4") {
        throw new Error(
          `outputFormat must be png or mp4 (got "${outputFormat}")`,
        );
      }
      const motion =
        outputFormat === "mp4"
          ? resolvePageSkeletonMotion(props.motion)
          : undefined;
      const capture = parseCapture(props.capture);
      const overrides = parseRectOverrides(props.overrides, capture.rects.length);
      const hiddenIndices = new Set(
        [...overrides.values()]
          .filter((override) => override.hide === true)
          .map((override) => override.i),
      );
      const appearance = { ...DEFAULT_APPEARANCE, ...(props.appearance ?? {}) };
      const behavior = { ...DEFAULT_BEHAVIOR, ...(props.behavior ?? {}) };
      const bg = colorOr(appearance.bg, DEFAULT_APPEARANCE.bg);
      const layout = layoutCapture(capture, {
        canvasW: width,
        canvasH: height,
        ...behavior,
        hiddenIndices,
      });

      if (layout.rects.length === 0) {
        return errorDocument(
          "capture contains no visible rectangles after filtering and scaling",
          ctx,
        );
      }

      const composition = planSkeletonComposition(
        layout.rects,
        appearance,
        bg,
        { w: width, h: height },
        {
          overrides,
          debugIndices: props.debugIndices === true,
          motion: motion
            ? {
                config: motion,
                durationSec: Math.max(0.1, ctx.target.durationMs / 1000),
              }
            : undefined,
        },
      );
      const placed = placeSkeletonPieces({
        rootW: width,
        rootH: height,
        pieces: composition.pieces,
        pureRects: behavior.pureRects === true,
      });
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        assets: {} as MosaicAssetManifest,
        m0: placed.m0,
        sources: placed.sources,
        backgroundColor: bg,
        fps: ctx.target.fps,
        durationMs: ctx.target.durationMs,
        size: { width, height },
        format:
          outputFormat === "mp4"
            ? { kind: "video", container: "mp4" }
            : { kind: "image", container: "png" },
        ...(outputFormat === "mp4" ? { audio: { mode: "off" } } : {}),
        ...(props.debug
          ? {
              editor: {
                label:
                  `Page Skeleton · ${layout.stats.output} rects · ` +
                  `filtered ${layout.stats.filtered} · capped ${layout.stats.capped} · ` +
                  `pruned ${layout.stats.pruned} · degenerate ${layout.stats.degenerate} · ` +
                  `${composition.stats.independentRects} independent sources · ` +
                  `${composition.stats.debugLabels} debug labels · ` +
                  `${composition.stats.projectedLayers} projected layers · ` +
                  `${behavior.pureRects ? "pure DSL rects" : "inset recovery"} · ` +
                  `${
                    motion
                      ? `${motion.mode} ${motion.direction} ${ctx.target.durationMs}ms loop`
                      : "still"
                  }`,
              },
            }
          : {}),
      };

      return withGeometryContract(doc, ctx, {
        templateId: PAGE_SKELETON_ID,
        expectations: placed.expectations,
        debug: props.debug === true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorDocument(message, ctx);
    }
  },
};

registerTemplate(PageSkeleton);
export default PageSkeleton;
