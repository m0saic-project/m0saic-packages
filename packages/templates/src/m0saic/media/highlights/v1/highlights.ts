/**
 * Highlight clips — `@m0saic/media/highlights/v1`.
 *
 * Pick one video, mark one or more `[startMs, endMs]` ranges (the
 * `picker: "time-ranges"` editor, or hand-authored `--props` JSON), and
 * every range renders as its own deliverable via an `emit:"multi"`
 * pipeline — audio intact, canvas matched to the probed source (with an
 * optional `maxWidth` cap), `mp4` or `webm` per batch.
 *
 * Rendering-model notes (rules 2/3/6/10 of the contract):
 * - With ONE valid range the planner collapses the 1-output-step
 *   `emit:"multi"` pipeline to a single render — the deliverable is the
 *   bare `-o` path. Its container comes from the `outputFormat` prop via
 *   the CLI's reserved prop-bag convention (template tier of rule 5), so
 *   a `-o` extension that DISAGREES with the prop fails loudly at plan
 *   time ("Output extension implies container …") rather than silently
 *   winning — `-o clip.webm` needs `outputFormat: "webm"` too. With ≥2
 *   ranges, each file's extension comes from its step's own format.
 * - A CLI/UI duration override on a single-range render replaces the
 *   authored step duration (`DURATION_MS_OVERRIDDEN_BY_CLI`) — expected
 *   rule-5 behavior.
 * - `outputHints` deliberately carries NO `format` — a template-level
 *   container hint would override the user's `-o` extension in
 *   `resolveOutputFormat`; each pipeline step declares its own format
 *   instead (trickplay/watermark precedent).
 * - The pipeline sets top-level `fps` from the probed source fps so
 *   cuts aren't resampled to the engine default 30; CLI `--fps` still
 *   wins with the `FPS_OVERRIDDEN_BY_CLI` diagnostic.
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
  MosaicTimeRangeMs,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import { weightedSplit } from "@m0saic/dsl-stdlib";
import {
  buildStepNames,
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  parseTimeRangesValue,
  registerTemplate,
} from "@m0saic/template-utils";
import { buildHighlightSteps } from "./pipeline";
import type { HighlightsKnobs, HighlightsOutputFormat } from "./plan";
import {
  buildBrandedCover,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

/** Hard cap on ranges per invocation (mirrors the prop's jsonSchema). */
export const MAX_RANGES = 100;

export type HighlightsV1Props = {
  /** The video to pull highlight clips from. */
  sourceId?: string;
  /** Highlight ranges, ms, source-relative — each becomes its own output clip. */
  ranges?: MosaicTimeRangeMs[] | string;
  /** Container for every emitted clip. Default "mp4". */
  outputFormat?: HighlightsOutputFormat;
  /** Optional output width cap in px (aspect-preserving; never upscales). */
  maxWidth?: number;
  /** Strip the audio track from the clips. Default false (audio passes through). */
  muteAudio?: boolean;
};

const propsSchema = definePropsSchema<HighlightsV1Props>({
  sourceId: {
    type: "media",
    required: true,
    description: "The video to pull highlight clips from.",
    meta: {
      ui: { label: "Source", order: 1 },
      control: { picker: "file", accept: ["video"] },
    },
  },
  ranges: {
    type: "json",
    required: true,
    description:
      "Highlight ranges within the source video, milliseconds. Each { startMs, endMs, label? } entry becomes its own output clip; label (optional) feeds the output filename.",
    meta: {
      constraints: {
        jsonSchema: {
          type: "array",
          minItems: 1,
          maxItems: MAX_RANGES,
          items: {
            type: "object",
            required: ["startMs", "endMs"],
            properties: {
              startMs: { type: "integer", minimum: 0 },
              endMs: { type: "integer", minimum: 1 },
              label: { type: "string" },
            },
          },
        },
      },
      control: { picker: "time-ranges", videoFromProp: "sourceId" },
      ui: { label: "Highlight ranges", order: 2 },
    },
  },
  outputFormat: {
    type: "string",
    required: false,
    description: 'Container for every emitted clip: "mp4" (default) or "webm".',
    meta: {
      constraints: { oneOf: ["mp4", "webm"] },
      ui: { label: "Format", order: 3 },
    },
  },
  maxWidth: {
    type: "number",
    required: false,
    description:
      "Optional output width cap in pixels — clips wider than this downscale (aspect-preserved, even-rounded). Never upscales.",
    meta: { control: { placeholder: "source width" }, constraints: { min: 128, max: 3840 }, ui: { label: "Max width (px)", order: 4 } },
  },
  muteAudio: {
    type: "boolean",
    required: false,
    description: "Strip the audio track from the clips. Off by default — audio passes through.",
    meta: { ui: { label: "Mute audio", order: 5 } },
  },
});

const DEFAULTS: Omit<HighlightsV1Props, "sourceId" | "ranges"> = {
  outputFormat: "mp4",
  muteAudio: false,
};

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** Resolve + clamp props to deterministic step knobs. `outputFormat` is
 * validated (not silently coerced) by render() BEFORE this runs. */
export function resolveHighlightsKnobs(props: HighlightsV1Props): HighlightsKnobs {
  return {
    outputFormat: props.outputFormat === "webm" ? "webm" : "mp4",
    ...(props.maxWidth != null && Number.isFinite(props.maxWidth)
      ? { maxWidth: clamp(Math.round(props.maxWidth), 128, 3840) }
      : {}),
    muteAudio: props.muteAudio === true,
  };
}

const ERROR_TITLE = "Highlights";

export const Highlights: MosaicTemplate<HighlightsV1Props> = {
  id: asTemplateId("@m0saic/media/highlights/v1"),
  label: "Highlight Clips",
  description:
    "Pick a video, mark one or more time ranges, and get each range as its own clip — mp4 or webm, audio intact, one render for the whole batch.",
  version: 1,
  capabilities: { tier: "core" },
  tags: ["media", "clips", "highlights", "promo", "multi-output", "creators", "marketers", "animated", "trailer", "teaser", "video"],

  // No `format` hint on purpose (see file header): steps declare their own.
  outputHints: {
    format: { kind: "video", container: "mp4" },
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
  },

  propsSchema,
  defaultProps: { ...DEFAULTS },

  async render(
    props: HighlightsV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicRenderableFile> {
    const fail = (message: string) =>
      makeErrorMosaic(message, {
        title: ERROR_TITLE,
        width: ctx.target.width,
        height: ctx.target.height,
      });

    const sourceId = props.sourceId;
    if (!sourceId) {
      return fail('Missing required "Source": pick the video to pull highlight clips from.');
    }

    if (
      props.outputFormat !== undefined &&
      props.outputFormat !== "mp4" &&
      props.outputFormat !== "webm"
    ) {
      return fail(
        `Unsupported outputFormat "${String(props.outputFormat)}" — use "mp4" or "webm".`,
      );
    }

    const parsed = parseTimeRangesValue(props.ranges);
    if (!parsed.ok) {
      return fail(parsed.error);
    }
    if (parsed.ranges.length === 0) {
      return fail("Ranges are empty — mark at least one { startMs, endMs } highlight range.");
    }
    if (parsed.ranges.length > MAX_RANGES) {
      return fail(`Too many ranges (${parsed.ranges.length}) — the cap is ${MAX_RANGES}.`);
    }

    const meta = ctx.media[asAssetId(sourceId)];
    if (!meta || !(meta.width > 0) || !(meta.height > 0)) {
      return fail(`No probed dimensions for input: ${sourceId}`);
    }
    if (meta.kind !== "video") {
      return fail(`Highlights needs a video input (kind: ${meta.kind}): ${sourceId}`);
    }
    if (!(meta.durationMs != null && meta.durationMs > 0)) {
      return fail(`Video input has no probed duration: ${sourceId}`);
    }

    const knobs = resolveHighlightsKnobs(props);
    const stepBaseName = buildStepNames([sourceId])[0];
    const steps = buildHighlightSteps({
      inputPath: sourceId,
      stepBaseName,
      ranges: parsed.ranges,
      sourceDurationMs: meta.durationMs,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      knobs,
      ctx,
    });

    const sourceFps =
      meta.fps != null && meta.fps > 0 ? Math.max(1, Math.round(meta.fps)) : undefined;

    return {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      ...(sourceFps !== undefined ? { fps: sourceFps } : {}),
      steps,
    };
  },

  // Editor-only first-open cover — the mosaic-branding BAND: the REAL
  // ranges-picker screenshot (bundled asset, web-safe string-concat path —
  // this template is web-registered and node:path breaks the web build)
  // above the brand band. Browser falls back to a dark stage.
  async renderCover(
    _props: HighlightsV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const isNode = typeof process !== "undefined" && !!process.versions?.node;
    const unpackedAsar = (p: string) =>
      p.includes("/app.asar/")
        ? p.split("/app.asar/").join("/app.asar.unpacked/")
        : p.split("\\app.asar\\").join("\\app.asar.unpacked\\");
    const coverAsset = isNode
      ? {
          kind: "file" as const,
          path: unpackedAsar(`${__dirname}/assets/cover-ranges.jpg`),
          mediaType: "image" as const,
        }
      : null;
    const heroSource: MosaicSource = coverAsset
      ? ({
          type: "media",
          mediaType: "image",
          assetId: asAssetId("cover-ranges"),
          placement: { fit: "contain" },
          editor: { owner: "template", label: "highlights:cover-screenshot" },
        } as MosaicSource)
      : makeColorTile("#1c2530" as MosaicColor);

    return buildBrandedCover({
      ctx,
      variant: "band",
      copy: { productName: "Highlight Clips", title: "Mark ranges; each renders as its own clip." },
      hero: (theme) => onboardingFrame({ m0: "1", sources: [heroSource] }, theme.borderStrong),
      heroAssets: (coverAsset ? { "cover-ranges": coverAsset } : {}) as never,
    });
  },
};

registerTemplate(Highlights);
