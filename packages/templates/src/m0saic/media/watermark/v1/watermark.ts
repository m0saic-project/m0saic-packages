/**
 * @m0saic/media/watermark/v1 — "Watermark"
 *
 * The canonical user-facing watermark: stamp your logo or wordmark onto
 * any image or video. Nine standard positions or an exact m0-rect
 * escape hatch, ratio-true sizing, opacity control, and an N-inputs →
 * N-outputs folder batch flow (mixed image + video folders).
 *
 * Modes:
 *   - "static"   — baked in, always visible (this phase).
 *   - "adaptive" — luma-aware light/dark variant + animated time
 *                  windows, parity with the free-tier QR stamp (P3).
 *   - "page"     — diagonal repeated logo/wordmark across the whole
 *                  page (P2).
 *
 * Distinct from `@m0saic/forensic/watermark/video/v1` (the invisible
 * steganographic watermark) — this one is meant to be seen.
 *
 * Note: on the free tier, the post-render hook adds the m0saic QR at
 * bottom-right on top of the deliverable — pick a different corner to
 * avoid overlap.
 */

import type {
  MosaicColor,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicPipelineStep,
  MosaicRenderableFile,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import {
  buildStepNames,
  defineMosaicTemplate,
  definePropsSchema,
  makeErrorMosaic,
  registerTemplate,
  type StampPosition,
} from "@m0saic/template-utils";
import {
  WATERMARK_DEFAULTS,
  normalizeLayoutM0,
  resolveContentInfo,
  validateLayoutM0,
  watermarkNeedsLumaProbe,
  type WatermarkContentInfo,
} from "./geometry";
import { probeLumaByInput, type WatermarkLumaEntry } from "./adaptive";
import { buildWatermarkStep, type WatermarkStepKnobs } from "./pipeline";

// ---- PROPS ----

export type WatermarkMode = "static" | "adaptive" | "page";
export type WatermarkContent = "logo" | "text" | "lockup";

export type WatermarkV1Props = {
  /** Inputs to watermark — a folder, one or more files, or drag-and-drop. One output per input. */
  sourceIds?: string[];
  /** Watermark mode. "adaptive" and "page" land in later phases. */
  mode?: WatermarkMode;
  /** What the watermark shows. "lockup" lands in a later phase. */
  content?: WatermarkContent;
  /** Logo image file (PNG with alpha recommended). */
  image?: string;
  /** Dark-background logo variant (adaptive mode; later phase). */
  imageDark?: string;
  /** Wordmark text (content: "text"). */
  text?: string;
  /** Wordmark color. */
  textColor?: string;
  /** Wordmark color over bright regions (adaptive mode; later phase). */
  textColorOnLight?: string;
  /** Lockup arrangement (content: "lockup"). */
  lockupLayout?: "text-below" | "text-right";
  /** Standard placement. */
  position?: StampPosition;
  /** Watermark width as a fraction of the size basis. */
  sizeRatio?: number;
  /** Which canvas dimension sizeRatio measures against. */
  sizeBasis?: "min" | "width" | "height";
  /** Margin from the canvas edges, fraction of min(W, H). */
  marginRatio?: number;
  /** Watermark opacity. */
  opacity?: number;
  /** Escape hatch: an m0 layout resolving to exactly ONE frame — the watermark cell. Overrides position/size/margin. */
  layoutM0?: string;
  /** Adaptive variant pick: follow scene luminance or always use the primary artwork. */
  variant?: "single" | "auto";
  /** Adaptive visibility: always on (entrance fade) or timed appearance windows. */
  windowing?: "always" | "windows";
  /** Windowed mode: override the duration-based coverage tier (fraction 0..1). */
  coverageOverride?: number;
  /** Fade in/out duration at window boundaries / entrance, ms. */
  fadeMs?: number;
  /** Light↔dark crossfade duration at scene changes (always-on auto), ms. */
  crossfadeMs?: number;
  /** Region luma (0..255) at/above which a scene counts as bright. */
  lumaThreshold?: number;
  /** Minimum gap between windowed appearances, ms. */
  minGapMs?: number;
  /** Override hatch: per-input luma results (normally pulled via ctx.analysis). */
  lumaByInput?: Record<string, WatermarkLumaEntry>;
  /** Page mode: rotation angle, degrees clockwise. */
  angleDeg?: number;
  /** Page mode: gap between instances, fraction of min(W, H). */
  tileGapRatio?: number;
  /** Page mode: offset alternate rows by half the pitch. */
  stagger?: boolean;
  /** Page mode: hard instance budget. */
  maxTiles?: number;
  /** Image outputs: match the input's container, or force png/jpeg. */
  imageOutputFormat?: "match" | "png" | "jpeg";
  /** Dev tripwire: run the layout contract on each step doc. */
  debugLayout?: boolean;
};

const propsSchema = definePropsSchema<WatermarkV1Props>({
  sourceIds: {
    type: "media[]",
    required: true,
    description:
      "Media to watermark — pick a folder, one or more files, or drag-and-drop. One watermarked output per input.",
    meta: {
      ui: { label: "Source(s)", order: 1 },
      control: { multiple: true, picker: "folder", accept: ["image", "video"] },
    },
  },
  mode: {
    type: "string",
    required: false,
    description: 'Watermark mode. "static" bakes it in; "adaptive" and "page" land in later phases.',
    meta: {
      constraints: { oneOf: ["static", "adaptive", "page"] },
      ui: { label: "Mode", order: 1 },
    },
  },
  content: {
    type: "string",
    required: false,
    description: 'What the watermark shows: your logo image, a text wordmark, or both ("lockup", later phase).',
    meta: {
      constraints: { oneOf: ["logo", "text", "lockup"] },
      ui: { label: "Content", order: 2 },
    },
  },
  image: {
    type: "media",
    required: false,
    description: "Logo image file — PNG with transparency recommended.",
    meta: {
      control: { picker: "file", accept: ["image"] },
      ui: { label: "Logo", order: 3, primary: true },
    },
  },
  text: {
    type: "string",
    required: false,
    description: "Wordmark text (your brand or URL).",
    meta: {
      control: { placeholder: "yourbrand.com" },
      ui: { label: "Text", order: 4 },
    },
  },
  textColor: {
    type: "string",
    required: false,
    description: "Wordmark color.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true },
      ui: { label: "Text Color", order: 5 },
    },
  },
  imageDark: {
    type: "media",
    required: false,
    description: "Dark-background logo variant, crossfaded in over dark scenes (adaptive mode; later phase).",
    meta: {
      control: { picker: "file", accept: ["image"] },
      ui: { label: "Logo (dark)", order: 1, visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  textColorOnLight: {
    type: "string",
    required: false,
    description: "Wordmark color over bright regions (adaptive mode; later phase).",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true },
      ui: { label: "Text Color (on light)", order: 2, visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  variant: {
    type: "string",
    required: false,
    description:
      '"auto" follows scene luminance (bright scenes get the on-light artwork, dark scenes your primary styling); "single" always uses the primary artwork. Auto degrades to single when no luma probe is available.',
    meta: {
      constraints: { oneOf: ["single", "auto"] },
      ui: { label: "Variant", order: 3, visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  windowing: {
    type: "string",
    required: false,
    description:
      '"always" keeps the watermark on (entrance fade); "windows" fades it in and out over timed appearances whose count scales with clip duration.',
    meta: {
      constraints: { oneOf: ["always", "windows"] },
      ui: { label: "Windowing", order: 4, visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  coverageOverride: {
    type: "number",
    required: false,
    description: "Windowed mode: fraction of the clip the watermark is on-screen (overrides the duration tier).",
    meta: {
      constraints: { min: 0, max: 1 },
      control: { placeholder: "auto", flavor: "slider", step: 0.05 },
      ui: { label: "Coverage", order: 5, visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  fadeMs: {
    type: "number",
    required: false,
    description: "Fade in/out duration at entrance and window boundaries, ms.",
    meta: {
      constraints: { min: 0, max: 5000 },
      ui: { label: "Fade (ms)", order: 6, visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  crossfadeMs: {
    type: "number",
    required: false,
    description: "Light↔dark crossfade duration at scene brightness changes (always-on auto), ms.",
    meta: {
      constraints: { min: 0, max: 5000 },
      ui: { label: "Crossfade (ms)", order: 7, visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  lumaThreshold: {
    type: "number",
    required: false,
    description: "Region luma (0..255) at/above which a scene counts as bright.",
    meta: {
      constraints: { min: 0, max: 255 },
      control: { flavor: "slider", step: 1 },
      ui: { label: "Luma Threshold", order: 8, visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  minGapMs: {
    type: "number",
    required: false,
    description: "Minimum gap between windowed appearances, ms.",
    meta: {
      constraints: { min: 0, max: 60000 },
      ui: { label: "Min Gap (ms)", order: 9, visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  lumaByInput: {
    type: "json",
    required: false,
    description:
      "Override hatch: per-input region-luminance results. Normally the template pulls these itself via ctx.analysis — set this only to bypass the probe (agents, tests).",
    meta: {
      ui: { label: "Luma By Input", hidden: true, consumer: "agent" },
    },
  },
  lockupLayout: {
    type: "string",
    required: false,
    description: "Lockup arrangement: wordmark beside the logo or beneath it.",
    meta: {
      constraints: { oneOf: ["text-right", "text-below"] },
      ui: { label: "Lockup Layout", order: 7, visibleWhen: { prop: "content", equals: "lockup" } },
    },
  },
  angleDeg: {
    type: "number",
    required: false,
    description: "Pattern rotation angle, degrees clockwise (negative = up-slope).",
    meta: {
      constraints: { min: -90, max: 90 },
      control: { flavor: "slider", step: 5 },
      ui: { label: "Angle", order: 1, visibleWhen: { prop: "mode", equals: "page" } },
    },
  },
  tileGapRatio: {
    type: "number",
    required: false,
    description: "Gap between pattern instances, fraction of min(width, height).",
    meta: {
      constraints: { min: 0.01, max: 0.5 },
      control: { flavor: "slider", step: 0.01 },
      ui: { label: "Tile Gap", order: 2, visibleWhen: { prop: "mode", equals: "page" } },
    },
  },
  stagger: {
    type: "boolean",
    required: false,
    description: "Offset alternate pattern rows by half the pitch (brick layout).",
    meta: {
      ui: { label: "Stagger", order: 3, visibleWhen: { prop: "mode", equals: "page" } },
    },
  },
  maxTiles: {
    type: "number",
    required: false,
    description: "Hard cap on pattern instances (the gap grows to satisfy it).",
    meta: {
      constraints: { min: 1, max: 24 },
      control: { flavor: "slider", step: 1 },
      ui: { label: "Max Tiles", order: 4, visibleWhen: { prop: "mode", equals: "page" } },
    },
  },
  debugLayout: {
    type: "boolean",
    required: false,
    description: "Dev: verify the watermark's layout contract and render a violation card instead of a broken layout.",
    meta: {
      ui: { label: "Debug Layout", order: 1 },
    },
  },
  opacity: {
    type: "number",
    required: false,
    description: "Watermark opacity.",
    meta: {
      constraints: { min: 0.05, max: 1 },
      control: { flavor: "slider", step: 0.05 },
      ui: { label: "Opacity", order: 6 },
    },
  },
  position: {
    type: "string",
    required: false,
    description: "Standard placement on the canvas.",
    meta: {
      constraints: {
        oneOf: [
          "top-left",
          "top-center",
          "top-right",
          "center-left",
          "center",
          "center-right",
          "bottom-left",
          "bottom-center",
          "bottom-right",
        ],
      },
      ui: { label: "Position", order: 1 },
    },
  },
  sizeRatio: {
    type: "number",
    required: false,
    description: "Watermark width as a fraction of the size basis — match it to your brand assets.",
    meta: {
      constraints: { min: 0.02, max: 0.9 },
      control: { flavor: "slider", step: 0.01 },
      ui: { label: "Size", order: 2 },
    },
  },
  sizeBasis: {
    type: "string",
    required: false,
    description: "Which canvas dimension the size ratio measures against.",
    meta: {
      constraints: { oneOf: ["min", "width", "height"] },
      ui: { label: "Size Basis", order: 3 },
    },
  },
  marginRatio: {
    type: "number",
    required: false,
    description: "Margin from the canvas edges, as a fraction of min(width, height).",
    meta: {
      constraints: { min: 0, max: 0.25 },
      control: { flavor: "slider", step: 0.002 },
      ui: { label: "Margin", order: 4 },
    },
  },
  layoutM0: {
    type: "m0",
    required: false,
    description:
      "Escape hatch: an m0 layout resolving to exactly ONE frame — the watermark is placed in that rect (content keeps its aspect, contain-fit). Overrides Position/Size/Margin.",
    meta: {
      control: { placeholder: "e.g. 4(-,-,-,2[-,F])" },
      ui: { label: "Layout (m0)", order: 1 },
    },
  },
  imageOutputFormat: {
    type: "string",
    required: false,
    description: "Image outputs: match each input's container (jpg stays jpeg, else png), or force one.",
    meta: {
      constraints: { oneOf: ["match", "png", "jpeg"] },
      ui: { label: "Image Format", order: 1 },
    },
  },
});

const DEFAULTS: Omit<WatermarkV1Props, "sourceIds"> = {
  mode: WATERMARK_DEFAULTS.mode,
  content: WATERMARK_DEFAULTS.content,
  text: WATERMARK_DEFAULTS.text,
  textColor: WATERMARK_DEFAULTS.textColor,
  textColorOnLight: WATERMARK_DEFAULTS.textColorOnLight,
  lockupLayout: WATERMARK_DEFAULTS.lockupLayout,
  position: WATERMARK_DEFAULTS.position,
  sizeRatio: WATERMARK_DEFAULTS.sizeRatio,
  sizeBasis: WATERMARK_DEFAULTS.sizeBasis,
  marginRatio: WATERMARK_DEFAULTS.marginRatio,
  opacity: WATERMARK_DEFAULTS.opacity,
  variant: WATERMARK_DEFAULTS.variant,
  windowing: WATERMARK_DEFAULTS.windowing,
  fadeMs: WATERMARK_DEFAULTS.fadeMs,
  crossfadeMs: WATERMARK_DEFAULTS.crossfadeMs,
  lumaThreshold: WATERMARK_DEFAULTS.lumaThreshold,
  minGapMs: WATERMARK_DEFAULTS.minGapMs,
  angleDeg: WATERMARK_DEFAULTS.angleDeg,
  tileGapRatio: WATERMARK_DEFAULTS.tileGapRatio,
  stagger: WATERMARK_DEFAULTS.stagger,
  maxTiles: WATERMARK_DEFAULTS.maxTiles,
  imageOutputFormat: WATERMARK_DEFAULTS.imageOutputFormat,
  debugLayout: WATERMARK_DEFAULTS.debugLayout,
};

// ---- TEMPLATE ----

const ERROR_TITLE = "Watermark";

export const WatermarkV1 = defineMosaicTemplate<WatermarkV1Props>({
  id: asTemplateId("@m0saic/media/watermark/v1"),
  label: "Watermark",
  version: 1,
  description:
    "Stamp your logo or wordmark onto any image or video — 9 positions or an exact m0 rect, ratio-true sizing, opacity control. Point it at a folder for one watermarked output per input. (Free tier adds the m0saic QR at bottom-right — pick a different corner to avoid overlap.)",
  capabilities: { tier: "core" },
  tags: ["media", "watermark", "brand", "batch", "creators", "marketers", "animated", "logo", "overlay", "video"],

  // No `format` hint on purpose: outputs are MIXED (mp4 for video
  // inputs, png/jpeg for images). A template-level container hint wins
  // over the user's output extension in `resolveOutputFormat` and
  // rejects `-o out.png`; leaving it unset lets the extension drive the
  // top-level format while each pipeline step declares its own.
  outputHints: {
    format: { kind: "video", container: "mp4" },
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 10000,
  },

  propsSchema,
  defaultProps: DEFAULTS,

  async render(
    props: WatermarkV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicRenderableFile> {
    const fail = (message: string) =>
      makeErrorMosaic(message, {
        title: ERROR_TITLE,
        width: ctx.target.width,
        height: ctx.target.height,
      });

    const mode = props.mode ?? DEFAULTS.mode!;
    if (mode !== "static" && mode !== "adaptive" && mode !== "page") {
      return fail(`Watermark mode "${mode}" is not recognized — use "static", "adaptive", or "page".`);
    }
    const content = props.content ?? DEFAULTS.content!;
    if (content !== "logo" && content !== "text" && content !== "lockup") {
      return fail(`Watermark content "${content}" is not recognized — use "logo", "text", or "lockup".`);
    }

    const inputs = props.sourceIds ?? [];
    if (inputs.length === 0) {
      return fail('Missing required "Source(s)": pick a folder, one or more files, or drag-and-drop.');
    }

    // Canvas-independent validation happens ONCE (a bad layout string or
    // missing logo fails the whole render with a clear message); per-input
    // problems degrade to per-step error mosaics inside the pipeline.
    const layoutM0 = normalizeLayoutM0(props.layoutM0);
    let contentInfo: WatermarkContentInfo;
    try {
      if (layoutM0) validateLayoutM0(layoutM0);
      contentInfo = resolveContentInfo(props, ctx);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    const knobs: WatermarkStepKnobs = {
      mode,
      content,
      ...(props.image !== undefined ? { image: props.image } : {}),
      ...(props.imageDark !== undefined ? { imageDark: props.imageDark } : {}),
      text: (props.text ?? DEFAULTS.text!).trim(),
      // isColor-constrained props; brand once here.
      textColor: (props.textColor ?? DEFAULTS.textColor!) as MosaicColor,
      textColorOnLight: (props.textColorOnLight ?? DEFAULTS.textColorOnLight!) as MosaicColor,
      lockupLayout: props.lockupLayout ?? DEFAULTS.lockupLayout!,
      position: props.position ?? DEFAULTS.position!,
      sizeRatio: props.sizeRatio ?? DEFAULTS.sizeRatio!,
      sizeBasis: props.sizeBasis ?? DEFAULTS.sizeBasis!,
      marginRatio: props.marginRatio ?? DEFAULTS.marginRatio!,
      opacity: props.opacity ?? DEFAULTS.opacity!,
      layoutM0,
      imageOutputFormat: props.imageOutputFormat ?? DEFAULTS.imageOutputFormat!,
      contentInfo,
      variant: props.variant ?? DEFAULTS.variant!,
      windowing: props.windowing ?? DEFAULTS.windowing!,
      fadeMs: props.fadeMs ?? DEFAULTS.fadeMs!,
      crossfadeMs: props.crossfadeMs ?? DEFAULTS.crossfadeMs!,
      lumaThreshold: props.lumaThreshold ?? DEFAULTS.lumaThreshold!,
      minGapMs: props.minGapMs ?? DEFAULTS.minGapMs!,
      ...(props.coverageOverride !== undefined ? { coverageOverride: props.coverageOverride } : {}),
      angleDeg: props.angleDeg ?? DEFAULTS.angleDeg!,
      tileGapRatio: props.tileGapRatio ?? DEFAULTS.tileGapRatio!,
      stagger: props.stagger ?? DEFAULTS.stagger!,
      maxTiles: props.maxTiles ?? DEFAULTS.maxTiles!,
      debugLayout: props.debugLayout ?? DEFAULTS.debugLayout!,
    };

    // Adaptive auto pulls the region-luminance analysis through
    // ctx.analysis (engine-mediated, absent in design mode / without a
    // toolchain → auto degrades to single). The `lumaByInput` prop is
    // the override hatch (agents, tests) and wins when set.
    if (mode === "adaptive" && watermarkNeedsLumaProbe(props)) {
      if (props.lumaByInput !== undefined) {
        knobs.lumaByInput = props.lumaByInput;
      } else {
        const probed = await probeLumaByInput(props, inputs, ctx);
        if (probed) knobs.lumaByInput = probed;
      }
    }

    // Always a pipeline, even for one input: pipeline steps are the only
    // vehicle where each output's canvas tracks its input's probed dims.
    const stepNames = buildStepNames(inputs);
    const steps: MosaicPipelineStep[] = inputs.map((inputPath, i) =>
      buildWatermarkStep({ inputPath, stepName: stepNames[i], knobs, ctx }),
    );

    const pipeline: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      steps,
    };
    return pipeline;
  },
});

registerTemplate(WatermarkV1);
export default WatermarkV1;
