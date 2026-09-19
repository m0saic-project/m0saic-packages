/**
 * @m0saic/media/metadata-stamp/v1 — "Metadata Stamp"
 *
 * Utility template: read each source video's creation timestamp from its
 * container metadata (the engine's ffprobe pass already delivers the
 * tags via `ctx.media` — no I/O here) and stamp it as a small text chip
 * at one of the nine standard positions. Batch-first like the watermark:
 * point it at a folder and every video gets stamped to its own output.
 *
 * When a file carries no creation tag (transcoded / stripped files — a
 * normal case, not an edge case): `fallbackText` is stamped instead, and
 * an EMPTY fallback means the video renders clean with no stamp at all —
 * that's the configured no-op. `stampField` can also stamp the filename,
 * or fixed custom text; other metadata fields are one enum value + one
 * `ctx.media` read away.
 *
 * Always an `emit: "multi"` pipeline (watermark's convention, even for
 * one input): pipeline steps are the only vehicle where each output's
 * canvas tracks its input's probed dims (`step.file.size` wins; a plain
 * top-level doc plans at the CLI `--width/--height`).
 *
 * Determinism: creation tags are properties of the input bytes —
 * engine-provided metadata is an explicit input (knowledge:
 * templates/philosophy-and-contract.md, "Core is dynamic — but pure").
 * Formatting is pure UTC math in `format-date.ts`; no locale, no
 * timezone, no wall clock. `meta.rawProbe` is never read.
 */

import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaMetadata,
  MosaicOutputFormat,
  MosaicPipelineStep,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import { roundedRectMask } from "@m0saic/dsl-stdlib";
import {
  bindProp,
  bindProps,
  buildStepNames,
  defineMosaicTemplate,
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  measureText,
  registerTemplate,
  resolveStampRect,
  slugifyAssetKeyFromPath,
  stampOnMedia,
  type StampLayer,
  type StampPosition,
} from "@m0saic/template-utils";
import {
  STAMP_DATE_FORMATS,
  extractCreationTimestampRaw,
  formatVideoTimestamp,
  parseVideoTimestamp,
  type StampDateFormat,
} from "./format-date";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---- PROPS ----

export type MetadataStampField = "creation-date" | "filename" | "custom";

export type MetadataStampV1Props = {
  /** Videos to stamp — a folder, one or more files, or drag-and-drop. One output per input. */
  sourceIds?: string[];
  /** What to stamp: the video's creation date, its filename, or fixed custom text. */
  stampField?: MetadataStampField;
  /** Fixed text to stamp (stampField: "custom"; in batch mode it applies to every file). */
  customText?: string;
  /** Stamped when a file has no creation tag. EMPTY = render that video with no stamp (the no-op). */
  fallbackText?: string;
  /** Date format preset (English month names; deterministic). */
  dateFormat?: StampDateFormat;
  /** Rendered UTC offset in minutes. Unset = the tag's own offset when present, else UTC. */
  utcOffsetMinutes?: number;
  /** Standard placement. */
  position?: StampPosition;
  /** Stamp chip height as a fraction of min(width, height). */
  sizeRatio?: number;
  /** Margin from the canvas edges, fraction of min(W, H). */
  marginRatio?: number;
  /** Stamp text color. */
  fontColor?: string;
  /** Chip (background pill behind the text) color. */
  chipColor?: string;
  /** Chip opacity; 0 removes the chip entirely. */
  chipOpacity?: number;
};

const propsSchema = definePropsSchema<MetadataStampV1Props>({
  sourceIds: {
    type: "media[]",
    required: true,
    description:
      "Videos to stamp — pick a folder, one or more files, or drag-and-drop. One stamped output per input.",
    meta: {
      ui: { label: "Source(s)", order: 1 },
      control: { multiple: true, picker: "folder", accept: ["video"] },
    },
  },
  stampField: {
    type: "string",
    required: false,
    description:
      'What to stamp: the video\'s creation date from its metadata ("creation-date"), its filename, or fixed custom text.',
    meta: {
      constraints: { oneOf: ["creation-date", "filename", "custom"] },
      ui: { label: "Stamp", order: 2 },
    },
  },
  dateFormat: {
    type: "string",
    required: false,
    description: "How the creation date is written on the video.",
    meta: {
      constraints: { oneOf: [...STAMP_DATE_FORMATS] },
      ui: { label: "Date Format", order: 3, visibleWhen: { prop: "stampField", equals: "creation-date" } },
    },
  },
  fallbackText: {
    type: "string",
    required: false,
    description:
      "Stamped when a file carries no creation tag. Leave EMPTY to render such files clean, with no stamp at all.",
    meta: {
      control: { placeholder: "(empty = no stamp when metadata is missing)" },
      ui: { label: "Fallback Text", order: 4, visibleWhen: { prop: "stampField", equals: "creation-date" } },
    },
  },
  utcOffsetMinutes: {
    type: "number",
    required: false,
    description:
      "Show the date at this UTC offset (minutes). Unset uses the tag's own offset when it has one, else UTC — set this when cameras wrote plain UTC but you filmed in local time.",
    meta: {
      control: { placeholder: "tag offset, else UTC" },
      constraints: { min: -720, max: 840 },
      ui: { label: "UTC Offset (min)", order: 5, visibleWhen: { prop: "stampField", equals: "creation-date" } },
    },
  },
  customText: {
    type: "string",
    required: false,
    description: "Fixed text to stamp on every input.",
    meta: {
      control: { placeholder: "e.g. Summer 2024" },
      ui: { label: "Custom Text", order: 6, visibleWhen: { prop: "stampField", equals: "custom" } },
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
      ui: { label: "Position", order: 7 },
    },
  },
  sizeRatio: {
    type: "number",
    required: false,
    description: "Stamp chip height as a fraction of min(width, height).",
    meta: {
      constraints: { min: 0.02, max: 0.2 },
      control: { flavor: "slider", step: 0.005 },
      ui: { label: "Size", order: 8 },
    },
  },
  marginRatio: {
    type: "number",
    required: false,
    description: "Margin from the canvas edges, as a fraction of min(width, height).",
    meta: {
      constraints: { min: 0, max: 0.25 },
      control: { flavor: "slider", step: 0.002 },
      ui: { label: "Margin", order: 9 },
    },
  },
  fontColor: {
    type: "string",
    required: false,
    description: "Stamp text color.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true },
      ui: { label: "Text Color", order: 10 },
    },
  },
  chipColor: {
    type: "string",
    required: false,
    description: "Color of the rounded chip behind the text.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true },
      ui: { label: "Chip Color", order: 11 },
    },
  },
  chipOpacity: {
    type: "number",
    required: false,
    description: "Chip opacity — 0 removes the chip and leaves bare text.",
    meta: {
      constraints: { min: 0, max: 1 },
      control: { flavor: "slider", step: 0.05 },
      ui: { label: "Chip Opacity", order: 12 },
    },
  },
});

const DEFAULTS: Omit<MetadataStampV1Props, "sourceIds"> = {
  stampField: "creation-date",
  customText: "",
  fallbackText: "",
  dateFormat: "YYYY-MM-DD",
  // bottom-LEFT, not the camcorder-classic bottom-right: the free-tier
  // attribution QR lands bottom-right and would cover the stamp.
  position: "bottom-left",
  sizeRatio: 0.045,
  marginRatio: 0.022,
  fontColor: "#ffffff",
  chipColor: "#000000",
  chipOpacity: 0.35,
};

// ---- GEOMETRY CONSTANTS ----

/** Reference size text is measured at; fit-to-box scales linearly from it. */
const REF_FONT_PX = 100;

/** Width safety pad on measured text (same drift guard as the watermark). */
const TEXT_WIDTH_PAD = 1.04;

/** Chip padding around the text, as fractions of the TEXT height (per side). */
const CHIP_PAD_X = 0.55;
const CHIP_PAD_Y = 0.3;

/** Chip corner radius as a fraction of the chip height. */
const CHIP_RADIUS_FRAC = 0.22;

/** Duration used for error-mosaic steps (input problems). */
const ERROR_STEP_MS = 1000;

const ERROR_TITLE = "Metadata Stamp";

// ---- STEP BUILDING ----

/** Resolved knobs a step needs (validated once by the template). */
type MetadataStampKnobs = {
  stampField: MetadataStampField;
  customText: string;
  fallbackText: string;
  dateFormat: StampDateFormat;
  utcOffsetMinutes?: number;
  position: StampPosition;
  sizeRatio: number;
  marginRatio: number;
  fontColor: MosaicColor;
  chipColor: MosaicColor;
  chipOpacity: number;
};

/** Pure basename-without-extension (no node:path — keeps labels host-agnostic). */
function basenameNoExt(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * The text this input gets stamped with, or null for "no stamp" (the
 * clean-passthrough no-op when metadata is missing and no fallback set).
 */
function resolveStampText(
  knobs: MetadataStampKnobs,
  meta: MosaicMediaMetadata,
  inputPath: string,
): string | null {
  if (knobs.stampField === "custom") return knobs.customText;
  if (knobs.stampField === "filename") {
    return basenameNoExt(meta.originalFileName ?? inputPath);
  }
  const parsed = parseVideoTimestamp(extractCreationTimestampRaw(meta));
  if (!parsed) {
    return knobs.fallbackText.length > 0 ? knobs.fallbackText : null;
  }
  return formatVideoTimestamp(parsed, knobs.dateFormat, knobs.utcOffsetMinutes);
}

/** Rounded chip child: a color tile clipped by an SVG rounded-rect mask.
 *  `bindTo` names the colour prop that PAINTS the chip (Make's colour picker). */
function buildChipChild(color: MosaicColor, w: number, h: number, bindTo?: string): MosaicDocument {
  const mask = roundedRectMask(w, h, Math.max(1, Math.round(h * CHIP_RADIUS_FRAC)));
  const tile = makeColorTile(color, {
    // Bounds == the child's own pixel size, so scaleX === scaleY (the
    // load-bearing aspect rule for inline masks).
    mask: { kind: "inline-mask", localPath: mask.localPath, bounds: mask.bounds },
  });
  const src: MosaicSource = { ...tile, editor: { owner: "template", label: "mstamp:chip" } };
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "F" as MosaicDocument["m0"],
    sources: [bindTo ? bindProp(src, bindTo) : src],
    assets: {} as MosaicAssetManifest,
    size: { width: w, height: h },
  };
}

/** Text child: the stamp string as SVG glyph outlines, centered.
 *  `bindTo` names the props the rect DISPLAYS (Make's double-click handle):
 *  `text` is what it reads, `color` what inks it — one stacked form. */
function buildTextChild(
  text: string,
  color: MosaicColor,
  fontSize: number,
  w: number,
  h: number,
  bindTo?: { text: string; color: string },
): MosaicDocument {
  const src: MosaicSource = {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    layers: [
      {
        content: { kind: "literal", text },
        style: { fontSize, fontColor: color },
        // placement defaults center the block (hAlign "center", vAlign "middle")
      },
    ],
    editor: { owner: "template", label: "mstamp:text" },
  };
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "F" as MosaicDocument["m0"],
    sources: [bindTo ? bindProps(src, [{ propKey: bindTo.text }, { propKey: bindTo.color }]) : src],
    assets: {} as MosaicAssetManifest,
    size: { width: w, height: h },
  };
}

/** Base video + chip + text at the resolved stamp rect. */
function buildStampedDoc(args: {
  baseSource: MosaicSource;
  baseAssets: MosaicAssetManifest;
  canvasW: number;
  canvasH: number;
  text: string;
  knobs: MetadataStampKnobs;
  /**
   * Bind the chip to its props (Make's double-click → inline edit): the text
   * rect to `customText` (the override wins once Stamp = "custom") with
   * `fontColor` stacked beside it, the chip tile to `chipColor`. Production
   * steps only — the first-open cover stamps a fixed demo date that is no
   * prop's value.
   */
  bindToProps?: boolean;
}): MosaicDocument {
  const { baseSource, baseAssets, canvasW, canvasH, text, knobs } = args;
  const m = measureText(text, { fontSize: REF_FONT_PX });
  if (!(m.width > 0) || !(m.height > 0)) {
    throw new Error("Stamp text measures to an empty box — provide non-empty text.");
  }
  const textAspect = (m.width * TEXT_WIDTH_PAD) / m.height;
  const chipAspect = (textAspect + 2 * CHIP_PAD_X) / (1 + 2 * CHIP_PAD_Y);

  // `sizeRatio` is the chip HEIGHT fraction; resolveStampRect sizes by
  // width, so convert through the chip's aspect.
  const rect = resolveStampRect({
    canvasW,
    canvasH,
    position: knobs.position,
    sizeRatio: knobs.sizeRatio * chipAspect,
    sizeBasis: "min",
    marginRatio: knobs.marginRatio,
    contentAspect: chipAspect,
  });

  // Fit the text into the chip's inner box (the pads scale with the
  // rect, so these fractions hold even when the rect was clamped).
  const innerW = rect.w * (textAspect / (textAspect + 2 * CHIP_PAD_X));
  const innerH = rect.h / (1 + 2 * CHIP_PAD_Y);
  const scale = Math.min(innerW / (m.width * TEXT_WIDTH_PAD), innerH / m.height);
  const fontSize = Math.max(4, Math.floor(REF_FONT_PX * scale));

  // Two layers on the SAME rect: translucent chip under full-opacity
  // text. (stampOnMedia labels its layer sources wm:<key> — helper
  // convention.)
  const layers: StampLayer[] = [];
  if (knobs.chipOpacity > 0) {
    layers.push({
      child: buildChipChild(knobs.chipColor, rect.w, rect.h, args.bindToProps ? "chipColor" : undefined),
      opacity: knobs.chipOpacity,
      key: "chip",
    });
  }
  layers.push({
    child: buildTextChild(
      text,
      knobs.fontColor,
      fontSize,
      rect.w,
      rect.h,
      args.bindToProps ? { text: "customText", color: "fontColor" } : undefined,
    ),
    key: "text",
  });

  return stampOnMedia({ baseSource, baseAssets, canvasW, canvasH, rect, layers });
}

/** The no-op path: the video passes through unstamped at its own dims. */
function buildPassthroughDoc(
  baseSource: MosaicSource,
  baseAssets: MosaicAssetManifest,
  canvasW: number,
  canvasH: number,
): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "F" as MosaicDocument["m0"],
    sources: [baseSource],
    assets: { ...baseAssets },
    size: { width: canvasW, height: canvasH },
  };
}

/** Cover-only welcome band: dark strip + title/hint text (two layers, one
 *  source). Fonts are WIDTH-CAPPED to the band (0.62em pack model) — the
 *  band-height-scaled base font overran 1920-wide canvases (founder catch:
 *  "…or pass thro" cut at the edge). */
function coverBandChild(w: number, h: number): MosaicDocument {
  const TITLE = "METADATA STAMP - date chips read from each video's own tags";
  const HINT = "Point at a folder: one stamped output per input. Files without tags use your fallback or pass through clean.";
  const capW = (base: number, text: string, min: number): number =>
    Math.max(min, Math.min(base, Math.floor((w * 0.96) / (text.length * 0.62))));
  const titleFont = capW(Math.max(11, Math.round(h * 0.3)), TITLE, 11);
  const hintFont = capW(Math.max(10, Math.round(h * 0.21)), HINT, 10);
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "F{F}" as MosaicDocument["m0"],
    sources: [
      { ...makeColorTile("#161b22" as MosaicColor), editor: { owner: "template", label: "mstamp:cover-band-bg" } },
      {
        type: "text",
        visual: { backgroundColor: "black@0" },
        layers: [
          { content: { kind: "literal", text: TITLE }, style: { fontSize: titleFont, fontColor: "#eaeef2" }, placement: { hAlign: "left", vAlign: "top", padding: { left: 0.02, top: 0.14 } } },
          { content: { kind: "literal", text: HINT }, style: { fontSize: hintFont, fontColor: "#8b949e" }, placement: { hAlign: "left", vAlign: "bottom", padding: { left: 0.02, bottom: 0.14 } } },
        ],
        editor: { owner: "template", label: "mstamp:cover-band" },
      } as MosaicSource,
    ],
    assets: {} as MosaicAssetManifest,
    size: { width: w, height: h },
  };
}

function errorStep(
  stepName: string,
  label: string,
  message: string,
  ctx: MosaicEngineContext,
): MosaicPipelineStep {
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
 * Build one pipeline step: the input stamped at its own probed dims,
 * full source duration. Input problems degrade to an error-mosaic step
 * so one bad file never kills a batch.
 */
function buildMetadataStampStep(args: {
  inputPath: string;
  stepName: string;
  knobs: MetadataStampKnobs;
  ctx: MosaicEngineContext;
}): MosaicPipelineStep {
  const { inputPath, stepName, knobs, ctx } = args;
  const label = basenameNoExt(inputPath);

  // ctx.media is keyed by the RAW path; the outgoing asset-manifest key
  // must be slugified (ASSET_KEY_PATTERN) — two different ids.
  const meta = ctx.media[asAssetId(inputPath)];
  if (!meta || !(meta.width > 0) || !(meta.height > 0)) {
    return errorStep(stepName, label, `No probed dimensions for input: ${inputPath}`, ctx);
  }
  if (meta.kind !== "video") {
    return errorStep(stepName, label, `Input is not a video (kind: ${meta.kind}): ${inputPath}`, ctx);
  }
  if (!(meta.durationMs != null && meta.durationMs > 0)) {
    return errorStep(stepName, label, `Video input has no probed duration: ${inputPath}`, ctx);
  }

  const canvasW = meta.width;
  const canvasH = meta.height;

  try {
    const baseAssetId = asAssetId(slugifyAssetKeyFromPath(inputPath));
    const baseAssets: MosaicAssetManifest = {
      [baseAssetId]: { kind: "file", path: inputPath, mediaType: "video" },
    } as MosaicAssetManifest;
    const baseSource: MosaicSource = {
      type: "media",
      mediaType: "video",
      assetId: baseAssetId,
      // Canvas == input dims, so cover is an exact fit (no crop).
      placement: { fit: "cover" },
      editor: { owner: "template", label: "mstamp:base" },
    };

    const text = resolveStampText(knobs, meta, inputPath);
    const doc =
      text === null || text.trim().length === 0
        ? buildPassthroughDoc(baseSource, baseAssets, canvasW, canvasH)
        : buildStampedDoc({ baseSource, baseAssets, canvasW, canvasH, text: text.trim(), knobs, bindToProps: true });

    const format: MosaicOutputFormat = { kind: "video", container: "mp4" };
    return {
      name: stepName,
      label,
      durationMs: Math.max(1, Math.round(meta.durationMs!)),
      file: { ...doc, format },
    };
  } catch (err) {
    return errorStep(
      stepName,
      label,
      `Metadata stamp failed for ${inputPath}: ${err instanceof Error ? err.message : String(err)}`,
      ctx,
    );
  }
}

// ---- TEMPLATE ----

export const MetadataStampV1 = defineMosaicTemplate<MetadataStampV1Props>({
  id: asTemplateId("@m0saic/media/metadata-stamp/v1"),
  label: "Metadata Stamp",
  version: 1,
  description:
    "Stamp each video's creation date (read from its metadata) onto the video as a small chip — 9 positions, deterministic date formats. Point it at a folder for one stamped output per input; files without metadata use your fallback text or pass through clean. (Defaults to bottom-left: the free tier's m0saic QR occupies bottom-right.)",
  capabilities: { tier: "core" },
  tags: ["media", "stamp", "date", "metadata", "batch", "utility", "creators", "animated", "timestamp", "overlay", "video"],

  // No `format` hint on purpose (screencap/watermark convention): steps
  // declare `{kind:"video",container:"mp4"}` per-doc, and a template-
  // level hint would override the user's `-o` extension.
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
    props: MetadataStampV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicRenderableFile> {
    const fail = (message: string) =>
      makeErrorMosaic(message, {
        title: ERROR_TITLE,
        width: ctx.target.width,
        height: ctx.target.height,
      });

    const stampField = props.stampField ?? DEFAULTS.stampField!;
    if (stampField !== "creation-date" && stampField !== "filename" && stampField !== "custom") {
      return fail(
        `Stamp field "${stampField}" is not recognized — use "creation-date", "filename", or "custom".`,
      );
    }
    const dateFormat = props.dateFormat ?? DEFAULTS.dateFormat!;
    if (!(STAMP_DATE_FORMATS as readonly string[]).includes(dateFormat)) {
      return fail(`Date format "${dateFormat}" is not recognized.`);
    }
    const customText = (props.customText ?? DEFAULTS.customText!).trim();
    if (stampField === "custom" && customText.length === 0) {
      return fail('Stamp field is "custom" but Custom Text is empty — provide the text to stamp.');
    }

    const inputs = props.sourceIds ?? [];
    if (inputs.length === 0) {
      return fail('Missing required "Source(s)": pick a folder, one or more files, or drag-and-drop.');
    }

    const knobs: MetadataStampKnobs = {
      stampField,
      customText,
      fallbackText: (props.fallbackText ?? DEFAULTS.fallbackText!).trim(),
      dateFormat,
      ...(props.utcOffsetMinutes !== undefined ? { utcOffsetMinutes: props.utcOffsetMinutes } : {}),
      position: props.position ?? DEFAULTS.position!,
      sizeRatio: props.sizeRatio ?? DEFAULTS.sizeRatio!,
      marginRatio: props.marginRatio ?? DEFAULTS.marginRatio!,
      // isColor-constrained props; brand once here.
      fontColor: (props.fontColor ?? DEFAULTS.fontColor!) as MosaicColor,
      chipColor: (props.chipColor ?? DEFAULTS.chipColor!) as MosaicColor,
      chipOpacity: props.chipOpacity ?? DEFAULTS.chipOpacity!,
    };

    const stepNames = buildStepNames(inputs);
    const steps: MosaicPipelineStep[] = inputs.map((inputPath, i) =>
      buildMetadataStampStep({ inputPath, stepName: stepNames[i], knobs, ctx }),
    );

    const pipeline: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      steps,
    };
    return pipeline;
  },

  // Editor-only first-open cover — the mosaic-branding BAND: a REAL film
  // still (Big Buck Bunny title card, bundled) with the template's own date
  // chip stamped on it, above the brand band. Node reads the bundled jpg;
  // the browser build excludes this template, but guard anyway.
  async renderCover(
    _props: MetadataStampV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const isNode = typeof process !== "undefined" && !!process.versions?.node;
    const unpackedAsar = (p: string) =>
      p.includes("/app.asar/")
        ? p.split("/app.asar/").join("/app.asar.unpacked/")
        : p.split("\\app.asar\\").join("\\app.asar.unpacked\\");
    const heroAssets = (isNode
      ? {
          "mstamp-cover-frame": {
            kind: "file",
            path: unpackedAsar(`${__dirname}/assets/cover-frame.jpg`),
            mediaType: "image",
          },
        }
      : {}) as MosaicAssetManifest;
    const baseSource: MosaicSource = isNode
      ? ({
          type: "media",
          mediaType: "image",
          assetId: "mstamp-cover-frame",
          placement: { fit: "cover" },
          editor: { owner: "template", label: "mstamp:cover-frame" },
        } as unknown as MosaicSource)
      : ({ ...makeColorTile("#21262d" as MosaicColor), editor: { owner: "template", label: "mstamp:cover-frame" } } as MosaicSource);

    const knobs: MetadataStampKnobs = {
      stampField: "creation-date",
      customText: "",
      fallbackText: "",
      dateFormat: "YYYY-MM-DD",
      position: DEFAULTS.position!,
      sizeRatio: 0.06,
      marginRatio: DEFAULTS.marginRatio!,
      fontColor: DEFAULTS.fontColor! as MosaicColor,
      chipColor: DEFAULTS.chipColor! as MosaicColor,
      chipOpacity: 0.5,
    };
    const demo = buildStampedDoc({
      baseSource,
      baseAssets: heroAssets,
      canvasW: heroBox.width,
      canvasH: heroBox.height,
      text: "2024-07-15",
      knobs,
    });

    return buildBrandedCover({
      ctx,
      variant: "band",
      copy: { productName: "Metadata Stamp", title: "Date chips read from each video's own tags." },
      hero: (theme) => onboardingFrame(inlineHeroDoc(demo), theme.borderStrong),
      heroAssets: { ...heroAssets, ...(demo.assets ?? {}) } as MosaicAssetManifest,
      children: (demo as { children?: Record<string, MosaicDocument> }).children,
    });
  },
});

registerTemplate(MetadataStampV1);
export default MetadataStampV1;
