/**
 * Highlight clips — `@m0saic/media/highlights/v2`.
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
  bindProps,
  slugifyAssetKeyFromPath,
  tag,
  type PropBindingEntry,
} from "@m0saic/template-utils";
import { buildHighlightSteps } from "../v1/pipeline";
import { scaleToMaxWidth } from "../v1/plan";
import { withAddHandles } from "../../../_shared/canvas-handles";
import { markIncomplete, mediaStandInDocument } from "../../../_shared/stand-in";
import type { HighlightsKnobs, HighlightsOutputFormat } from "../v1/plan";
import {
  buildBrandedCover,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

/** Hard cap on ranges per invocation (mirrors the prop's jsonSchema). */
export const MAX_RANGES = 100;

export type HighlightsV2Props = {
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

const propsSchema = definePropsSchema<HighlightsV2Props>({
  sourceId: {
    type: "media",
    required: true,
    meta: {
      control: { picker: "file", accept: ["video"] },
    },
  },
  ranges: {
    type: "json",
    required: true,
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
    },
  },
  outputFormat: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["mp4", "webm"] },
    },
  },
  maxWidth: {
    type: "number",
    required: false,
    meta: { constraints: { min: 128, max: 3840 } },
  },
  muteAudio: {
    type: "boolean",
    required: false,
  },
});

const DEFAULTS: Omit<HighlightsV2Props, "sourceId" | "ranges"> = {
  outputFormat: "mp4",
  muteAudio: false,
};

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** Resolve + clamp props to deterministic step knobs. `outputFormat` is
 * validated (not silently coerced) by render() BEFORE this runs. */
export function resolveHighlightsKnobs(props: HighlightsV2Props): HighlightsKnobs {
  return {
    outputFormat: props.outputFormat === "webm" ? "webm" : "mp4",
    ...(props.maxWidth != null && Number.isFinite(props.maxWidth)
      ? { maxWidth: clamp(Math.round(props.maxWidth), 128, 3840) }
      : {}),
    muteAudio: props.muteAudio === true,
  };
}

const ERROR_TITLE = "Highlights";

export const HighlightsV2: MosaicTemplate<HighlightsV2Props> = {
  id: asTemplateId("@m0saic/media/highlights/v2"),
  version: 2,
  capabilities: { tier: "core" },

  // No `format` hint on purpose (see file header): steps declare their own.
  outputHints: {
    format: { kind: "video", container: "mp4" },
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
    // The footage is the picture from its first frame — nothing animates in.
    posterTimeMs: 0,
  },

  propsSchema,
  bindings: {
    unbound: {
      // Ranges are marked ON the footage: the footage carries the first range's
      // fields, each clip its own — there is nothing to mark before it.
      ranges: "marked on the footage",
    },
  },
  defaultProps: { ...DEFAULTS },

  async render(
    props: HighlightsV2Props,
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
      // v2: no source yet → THE SLOT BEFORE THE FOOTAGE (a drop target on the
      // Make canvas, marked `incomplete`) instead of an error card.
      return mediaStandInDocument({
        width: ctx.target.width,
        height: ctx.target.height,
        name: ERROR_TITLE,
        title: "Drop a video here",
        hint: "Then mark the ranges — each one renders as its own clip.",
        handles: [{ propKey: "sourceId" }, { propKey: "maxWidth" }],
        fps: ctx.target.fps,
        durationMs: ctx.target.durationMs,
      });
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

    // v2: "no ranges yet" (unset / empty) is a state to show, not a parse error.
    const noRanges =
      props.ranges == null ||
      (Array.isArray(props.ranges) && props.ranges.length === 0) ||
      (typeof props.ranges === "string" && props.ranges.trim() === "");
    const parsed = noRanges ? { ok: true as const, ranges: [] as MosaicTimeRangeMs[] } : parseTimeRangesValue(props.ranges);
    if (!parsed.ok) {
      return fail(parsed.error);
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
    // Leaf handles into `ranges` exist only for the LIST form (a string value
    // — the picker's serialized form — has no elements for a rect to name).
    const listForm = props.ranges === undefined || Array.isArray(props.ranges);
    const rangeLeaves = (i: number): PropBindingEntry[] => listForm
      ? [
          { propKey: "ranges", path: [i, "label"], kind: "string" },
          { propKey: "ranges", path: [i, "startMs"], kind: "number" },
          { propKey: "ranges", path: [i, "endMs"], kind: "number" },
        ]
      : [];

    if (parsed.ranges.length === 0) {
      // v2: a source but no takes yet is WAITING ON AN INPUT, not an error —
      // show the footage (so the ranges can be marked against it), say what is
      // missing, and offer the first range's fields on it.
      const size = scaleToMaxWidth(meta.width, meta.height, knobs.maxWidth);
      const assetId = asAssetId(slugifyAssetKeyFromPath(sourceId));
      const footage = markIncomplete(bindProps({
        type: "media",
        mediaType: "video",
        assetId,
        placement: { fit: "cover" },
        audio: { enabled: false },
        editor: { owner: "template", label: "footage" },
      } as MosaicSource, [{ propKey: "sourceId" }, ...rangeLeaves(0), { propKey: "maxWidth" }]), `${ERROR_TITLE}: mark at least one range — each becomes its own clip.`);
      return {
        kind: "mosaic_document",
        version: 1,
        m0: "1" as never,
        assets: { [assetId]: { kind: "file", path: sourceId, mediaType: "video" } } as never,
        sources: [footage],
        size,
        backgroundColor: "#000000" as MosaicColor,
        audio: { mode: "off" },
      } as MosaicDocument;
    }

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

    // ── v2: handles. Step i IS range i (v1's pipeline keeps the order, an
    //    invalid range becoming an error step in place): its clip carries that
    //    range's label and bounds, takes a dropped file, and shows the width cap. ──
    steps.forEach((step, i) => {
      for (const src of ((step.file as MosaicDocument).sources ?? []) as MosaicSource[]) {
        if ((src as { type?: string }).type !== "media") continue; // an error step's card
        withAddHandles(tag(src, "clip"), [...rangeLeaves(i), { propKey: "sourceId" }, { propKey: "maxWidth" }]);
      }
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
    _props: HighlightsV2Props,
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
          // The cover screenshot is v1's asset (shipped beside it; never copied).
          path: unpackedAsar(`${__dirname}/../v1/assets/cover-ranges.jpg`),
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

registerTemplate(HighlightsV2);
