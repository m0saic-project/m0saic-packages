/**
 * @m0saic/media/watermark/v2 — "Watermark"
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
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicPipelineStep,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import {
  buildStepNames,
  defineMosaicTemplate,
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  registerTemplate,
  tag,
  type PropBindingEntry,
  type StampPosition,
} from "@m0saic/template-utils";
import { addHandlesByLabel, labelOf, sourcesOfTree } from "../../../_shared/canvas-handles";
import { STAND_IN_TILE_ALT, markIncomplete, mediaStandInDocument } from "../../../_shared/stand-in";
import {
  WATERMARK_DEFAULTS,
  normalizeLayoutM0,
  resolveContentInfo,
  validateLayoutM0,
  watermarkNeedsLumaProbe,
  type WatermarkContentInfo,
} from "../v1/geometry";
import { probeLumaByInput, type WatermarkLumaEntry } from "../v1/adaptive";
import { buildWatermarkStep, type WatermarkStepKnobs } from "../v1/pipeline";

// ---- PROPS ----

export type WatermarkMode = "static" | "adaptive" | "page";
export type WatermarkContent = "logo" | "text" | "lockup";

export type WatermarkV2Props = {
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

const propsSchema = definePropsSchema<WatermarkV2Props>({
  sourceIds: {
    type: "media[]",
    required: true,
    meta: {
      control: { multiple: true, picker: "folder", accept: ["image", "video"] },
    },
  },
  mode: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["static", "adaptive", "page"] },
    },
  },
  content: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["logo", "text", "lockup"] },
    },
  },
  image: {
    type: "media",
    required: false,
    meta: {
      control: { picker: "file", accept: ["image"] },
    },
  },
  text: {
    type: "string",
    required: false,
  },
  textColor: {
    type: "string",
    required: false,
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true },
    },
  },
  imageDark: {
    type: "media",
    required: false,
    meta: {
      control: { picker: "file", accept: ["image"] },
      ui: { visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  textColorOnLight: {
    type: "string",
    required: false,
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true },
      ui: { visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  variant: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["single", "auto"] },
      ui: { visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  windowing: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["always", "windows"] },
      ui: { visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  coverageOverride: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 0, max: 1 },
      control: { flavor: "slider", step: 0.05 },
      ui: { visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  fadeMs: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 0, max: 5000 },
      ui: { visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  crossfadeMs: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 0, max: 5000 },
      ui: { visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  lumaThreshold: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 0, max: 255 },
      control: { flavor: "slider", step: 1 },
      ui: { visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  minGapMs: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 0, max: 60000 },
      ui: { visibleWhen: { prop: "mode", equals: "adaptive" } },
    },
  },
  lumaByInput: {
    type: "json",
    required: false,
    meta: {
      ui: { hidden: true, consumer: "agent" },
    },
  },
  lockupLayout: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["text-right", "text-below"] },
      ui: { visibleWhen: { prop: "content", equals: "lockup" } },
    },
  },
  angleDeg: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: -90, max: 90 },
      control: { flavor: "slider", step: 5 },
      ui: { visibleWhen: { prop: "mode", equals: "page" } },
    },
  },
  tileGapRatio: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 0.01, max: 0.5 },
      control: { flavor: "slider", step: 0.01 },
      ui: { visibleWhen: { prop: "mode", equals: "page" } },
    },
  },
  stagger: {
    type: "boolean",
    required: false,
    meta: {
      ui: { visibleWhen: { prop: "mode", equals: "page" } },
    },
  },
  maxTiles: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 1, max: 24 },
      control: { flavor: "slider", step: 1 },
      ui: { visibleWhen: { prop: "mode", equals: "page" } },
    },
  },
  debugLayout: {
    type: "boolean",
    required: false,
  },
  opacity: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 0.05, max: 1 },
      control: { flavor: "slider", step: 0.05 },
    },
  },
  position: {
    type: "string",
    required: false,
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
    },
  },
  sizeRatio: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 0.02, max: 0.9 },
      control: { flavor: "slider", step: 0.01 },
    },
  },
  sizeBasis: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["min", "width", "height"] },
    },
  },
  marginRatio: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 0, max: 0.25 },
      control: { flavor: "slider", step: 0.002 },
    },
  },
  layoutM0: {
    type: "m0",
    required: false,
  },
  imageOutputFormat: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["match", "png", "jpeg"] },
    },
  },
});

const DEFAULTS: Omit<WatermarkV2Props, "sourceIds"> = {
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

// ---- HANDLES (v2) ----

/**
 * Hang the watermark's props on the rects v1's pipeline builds (tagged there:
 * `wm:base`, `wm:text`, `wm:logo`). The footage takes a dropped file for ITS
 * input. The artwork — its wordmark if it has one, else its logo — carries
 * what it shows: the text and ink (v1 bound those on the stamp; page mode
 * bound nothing), the opacity and size, then the knobs of the mode it is in
 * (the corner margin; the adaptive fades; the page pattern's angle and
 * density). The logo takes a dropped image.
 */
function addWatermarkHandles(doc: MosaicDocument, inputIndex: number, knobs: WatermarkStepKnobs): void {
  const all = sourcesOfTree((doc.sources ?? []) as MosaicSource[], (doc as { children?: Record<string, MosaicDocument> }).children);
  const hasText = all.some((x) => labelOf(x) === "wm:text");
  const placement: PropBindingEntry[] = [
    { propKey: "opacity" },
    { propKey: "sizeRatio" },
    ...(knobs.mode === "page"
      ? [{ propKey: "angleDeg" }, { propKey: "tileGapRatio" }, { propKey: "maxTiles" }]
      : [{ propKey: "marginRatio" }]),
    ...(knobs.mode === "adaptive"
      ? [{ propKey: "fadeMs" }, { propKey: "crossfadeMs" }, { propKey: "lumaThreshold" }, { propKey: "minGapMs" }, { propKey: "coverageOverride" }]
      : []),
  ];
  addHandlesByLabel(all, {
    "wm:base": [{ propKey: "sourceIds", index: inputIndex }],
    "wm:text": [{ propKey: "text" }, ...(knobs.mode === "page" ? [{ propKey: "textColor" }] : []), ...placement],
    "wm:logo": [{ propKey: "image" }, ...(knobs.mode === "adaptive" ? [{ propKey: "imageDark" }] : []), ...(hasText ? [] : placement)],
  });
}

// ---- STAND-INS (no source yet / no logo yet) ----

const STAND_IN_KEY = "stand-in";
/** The placeholder a logo watermark draws until a logo is picked. */
const LOGO_PLACEHOLDER = "stand-in-logo";
const LOGO_PLACEHOLDER_DIMS = { width: 300, height: 120 };

/**
 * Swap every logo drawn from {@link LOGO_PLACEHOLDER} (any document of the
 * tree) for a placeholder tile, dropping the asset. Returns whether any was.
 */
function swapLogoPlaceholder(doc: MosaicDocument, seen = new Set<unknown>()): boolean {
  if (!doc || typeof doc !== "object" || seen.has(doc)) return false;
  seen.add(doc);
  let swapped = false;
  const assets = (doc.assets ?? {}) as Record<string, { path?: string }>;
  const ids = Object.keys(assets).filter((id) => assets[id]?.path === LOGO_PLACEHOLDER);
  if (ids.length) {
    const sources = (doc.sources ?? []) as MosaicSource[];
    for (let i = 0; i < sources.length; i++) {
      if (!ids.includes(String((sources[i] as { assetId?: string }).assetId))) continue;
      sources[i] = tag(
        makeColorTile(STAND_IN_TILE_ALT, {
          effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.18 }, stroke: { position: "inner", width: 0.02, color: "#5b6678" as MosaicColor, alpha: 1 } },
        }) as MosaicSource,
        "wm:logo",
      );
      swapped = true;
    }
    for (const id of ids) delete assets[id];
  }
  for (const child of Object.values((doc as { children?: Record<string, MosaicDocument> }).children ?? {})) {
    if (swapLogoPlaceholder(child, seen)) swapped = true;
  }
  return swapped;
}

function buildStandIn(knobs: WatermarkStepKnobs, ctx: MosaicEngineContext): MosaicDocument {
  const W = Math.max(1, Math.round(ctx.target.width));
  const H = Math.max(1, Math.round(ctx.target.height));
  // v1's step builder needs a probed input: hand it a canvas-sized still under
  // a placeholder key, then swap that base for the drop slot.
  const probe = { ...ctx, media: { ...ctx.media, [asAssetId(STAND_IN_KEY)]: { kind: "image", width: W, height: H } } } as unknown as MosaicEngineContext;
  const step = buildWatermarkStep({ inputPath: STAND_IN_KEY, stepName: STAND_IN_KEY, knobs, ctx: probe });
  const built = step.file as MosaicDocument;
  const baseAt = ((built.sources ?? []) as MosaicSource[]).findIndex((x) => labelOf(x) === "wm:base");
  if (baseAt < 0) return built; // v1 answered with an error card — show it

  const slotDoc = mediaStandInDocument({
    width: W,
    height: H,
    name: ERROR_TITLE,
    title: "Drop a video or image here",
    hint: "Files or a folder — each one comes back with this watermark.",
    handles: [{ propKey: "sourceIds", index: 0 }],
    fps: ctx.target.fps,
    durationMs: ctx.target.durationMs,
    nested: true,
  });
  const baseAssetId = (built.sources[baseAt] as { assetId?: string }).assetId;
  const sources = [...(built.sources as MosaicSource[])];
  // The slot is the BASE the watermark sits on (as the footage will be): a
  // nested child, so the root source that refs it is the drop target and
  // carries the marker hosts read.
  sources[baseAt] = markIncomplete(
    { type: "mosaic", ref: STAND_IN_KEY, editor: { owner: "template", label: "wm:base" } } as unknown as MosaicSource,
    `${ERROR_TITLE}: drop a video or image here`,
  );
  const assets = { ...(built.assets as Record<string, unknown>) };
  if (baseAssetId) delete assets[baseAssetId];
  const { format: _format, ...rest } = built as MosaicDocument & { format?: unknown };
  const doc = {
    ...rest,
    sources,
    assets,
    children: { ...((built as { children?: Record<string, MosaicDocument> }).children ?? {}), [STAND_IN_KEY]: slotDoc },
    backgroundColor: slotDoc.backgroundColor,
    audio: { mode: "off" },
  } as MosaicDocument;
  swapLogoPlaceholder(doc);
  addWatermarkHandles(doc, 0, knobs);
  return doc;
}

// ---- TEMPLATE ----

const ERROR_TITLE = "Watermark";

export const WatermarkV2 = defineMosaicTemplate<WatermarkV2Props>({
  id: asTemplateId("@m0saic/media/watermark/v2"),
  version: 2,
  capabilities: { tier: "core" },

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
    // The footage is the picture from its first frame — nothing animates in.
    posterTimeMs: 0,
  },

  propsSchema,
  bindings: {
    unbound: {
      // Each of these is carried by the artwork in the MODE / content that uses
      // it; at the defaults (a static logo) nothing on the canvas shows them.
      text: "text content (the wordmark carries it)",
      textColor: "text content (the wordmark carries it)",
      textColorOnLight: "adaptive mode",
      imageDark: "adaptive mode",
      coverageOverride: "adaptive mode",
      fadeMs: "adaptive mode",
      crossfadeMs: "adaptive mode",
      lumaThreshold: "adaptive mode",
      minGapMs: "adaptive mode",
      angleDeg: "page mode",
      tileGapRatio: "page mode",
      maxTiles: "page mode",
    },
  },
  defaultProps: DEFAULTS,

  async render(
    props: WatermarkV2Props,
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
    // v2: a logo watermark with no logo picked is WAITING ON AN INPUT, not an
    // error (v1 threw from the aspect probe and showed a failure card): the
    // stamp is drawn with a placeholder where the logo goes — a drop target
    // for the image — and the render is marked incomplete.
    const needsLogo = (content === "logo" || content === "lockup") && !(typeof props.image === "string" && props.image.trim());

    // Canvas-independent validation happens ONCE (a bad layout string or
    // missing logo fails the whole render with a clear message); per-input
    // problems degrade to per-step error mosaics inside the pipeline.
    const layoutM0 = normalizeLayoutM0(props.layoutM0);
    let contentInfo: WatermarkContentInfo;
    try {
      if (layoutM0) validateLayoutM0(layoutM0);
      contentInfo = needsLogo
        ? resolveContentInfo({ ...props, image: LOGO_PLACEHOLDER }, ctx, LOGO_PLACEHOLDER_DIMS)
        : resolveContentInfo(props, ctx);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    const knobs: WatermarkStepKnobs = {
      mode,
      content,
      ...(needsLogo ? { image: LOGO_PLACEHOLDER } : props.image !== undefined ? { image: props.image } : {}),
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
    if (inputs.length === 0) {
      // v2: no source yet → THE SLOT BEFORE THE FOOTAGE instead of an error
      // card: the real watermark (its text or logo, corner, size, opacity —
      // every knob live) over a drop slot, marked `incomplete`.
      return buildStandIn(knobs, ctx);
    }

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
    const steps: MosaicPipelineStep[] = inputs.map((inputPath, i) => {
      const step = buildWatermarkStep({ inputPath, stepName: stepNames[i], knobs, ctx });
      const doc = step.file as MosaicDocument;
      if (swapLogoPlaceholder(doc)) {
        const base = ((doc.sources ?? []) as MosaicSource[]).find((x) => labelOf(x) === "wm:base");
        if (base) markIncomplete(base, `${ERROR_TITLE}: pick the logo image — drop it on the placeholder.`);
      }
      addWatermarkHandles(doc, i, knobs);
      return step;
    });

    const pipeline: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      steps,
    };
    return pipeline;
  },
});

registerTemplate(WatermarkV2);
export default WatermarkV2;
