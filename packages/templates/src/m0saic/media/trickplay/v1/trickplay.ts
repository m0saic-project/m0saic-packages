/**
 * Trickplay sheet generator — `@m0saic/media/trickplay/v1`.
 *
 * Renders the seek-preview artifacts video players use while scrubbing:
 * sprite sheets of video thumbnails at a fixed interval, placed at
 * known row-major grid coordinates, plus the player-consumable index
 * files (WebVTT storyboard with `#xywh` cues; JSON manifest carrying
 * Jellyfin-compatible fields and DASH-IF `thumbnail_tile` grid info).
 *
 * One template covers every output shape via the `outputFormat` knob
 * (watermark's per-step-format precedent): `png` (default) / `jpeg`
 * emit static sheets + index sidecars; `mp4` emits an animated
 * contact-sheet preview (no sidecars). `outputHints` deliberately
 * carries NO `format` — a template-level container hint would override
 * the user's `-o` extension in `resolveOutputFormat`; each pipeline
 * step declares its own format instead.
 *
 * Always returns an `emit:"multi"` pipeline (watermark precedent):
 * per-step canvases are the only vehicle for probed-dims sheet sizing,
 * and long inputs fan out to multiple sheet steps.
 */

import type {
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicTemplate,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import {
  buildStepNames,
  definePropsSchema,
  makeErrorMosaic,
  registerTemplate,
} from "@m0saic/template-utils";
import {
  buildTrickplayStepsForInput,
  type TrickplayOutputFormat,
  type TrickplayStepKnobs,
} from "./pipeline";

export type TrickplayV1Props = {
  /** Video(s) to index — a folder, one or more files, or drag-and-drop. One sheet set per input. */
  sourceIds?: string[];
  /** Seconds between thumbnails. Default 10 (Jellyfin parity). */
  intervalSec?: number;
  /** Thumbnail width in px (even-rounded; height derives from source aspect). Default 320. */
  tileWidth?: number;
  /** Thumbnails per sheet row. Default 10. */
  cols?: number;
  /** Max thumbnail rows per sheet; longer content spills to more sheets. Default 10. */
  rowsPerSheet?: number;
  /** Sheet output: png/jpeg static sheets + index sidecars, or an animated mp4 preview. Default "png". */
  outputFormat?: TrickplayOutputFormat;
};

const propsSchema = definePropsSchema<TrickplayV1Props>({
  sourceIds: {
    type: "media[]",
    required: true,
    description:
      "Video(s) to index — pick a folder, one or more files, or drag-and-drop. One trickplay sheet set (sheets + WebVTT + manifest) per input.",
    meta: {
      ui: { label: "Source(s)", order: 1 },
      control: { multiple: true, picker: "folder", accept: ["video"] },
    },
  },
  intervalSec: {
    type: "number",
    required: false,
    description: "Seconds between thumbnails.",
    meta: { constraints: { min: 1, max: 600 }, ui: { label: "Interval (s)", order: 1 } },
  },
  tileWidth: {
    type: "number",
    required: false,
    description: "Thumbnail width in pixels (height derives from the source aspect; both even-rounded).",
    meta: { constraints: { min: 64, max: 1024 }, ui: { label: "Tile width (px)", order: 2 } },
  },
  cols: {
    type: "number",
    required: false,
    description: "Thumbnails per sheet row.",
    meta: { constraints: { min: 1, max: 20 }, ui: { label: "Columns", order: 3 } },
  },
  rowsPerSheet: {
    type: "number",
    required: false,
    description: "Maximum thumbnail rows per sheet — longer content spills to additional sheets.",
    meta: { constraints: { min: 1, max: 20 }, ui: { label: "Rows per sheet", order: 4 } },
  },
  outputFormat: {
    type: "string",
    required: false,
    description:
      'Sheet output format. "png"/"jpeg" render static sheets with WebVTT + JSON manifest sidecars; "mp4" renders an animated contact-sheet preview (no sidecars).',
    meta: {
      constraints: { oneOf: ["png", "jpeg", "mp4"] },
      ui: { label: "Output", order: 1 },
    },
  },
});

const DEFAULTS: Omit<TrickplayV1Props, "sourceIds"> = {
  intervalSec: 10,
  tileWidth: 320,
  cols: 10,
  rowsPerSheet: 10,
  outputFormat: "png",
};

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** Resolve + clamp props to deterministic step knobs. */
export function resolveTrickplayKnobs(props: TrickplayV1Props): TrickplayStepKnobs {
  const outputFormat: TrickplayOutputFormat =
    props.outputFormat === "jpeg" || props.outputFormat === "mp4"
      ? props.outputFormat
      : "png";
  return {
    intervalSec: clamp(props.intervalSec ?? DEFAULTS.intervalSec!, 1, 600),
    tileWidth: clamp(props.tileWidth ?? DEFAULTS.tileWidth!, 64, 1024),
    cols: clamp(Math.round(props.cols ?? DEFAULTS.cols!), 1, 20),
    rowsPerSheet: clamp(Math.round(props.rowsPerSheet ?? DEFAULTS.rowsPerSheet!), 1, 20),
    outputFormat,
  };
}

export const Trickplay: MosaicTemplate<TrickplayV1Props> = {
  id: asTemplateId("@m0saic/media/trickplay/v1"),
  label: "Trickplay Sheets",
  description:
    "Generate the seek-preview thumbnails video players use while scrubbing: sprite sheets at a fixed interval with a WebVTT storyboard and a Jellyfin/DASH-compatible JSON manifest. Batch a folder for one sheet set per video.",
  version: 1,
  capabilities: { tier: "core" },
  tags: ["media", "trickplay", "storyboard", "batch", "developers", "creators", "video-player", "sprite", "streaming"],

  // No `format` hint on purpose (see file header): steps declare their own.
  outputHints: {
    format: { kind: "image", container: "png" },
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
  },

  propsSchema,
  defaultProps: { ...DEFAULTS },

  async render(
    props: TrickplayV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicRenderableFile> {
    const inputs = props.sourceIds && props.sourceIds.length > 0 ? props.sourceIds : [];
    if (inputs.length === 0) {
      return makeErrorMosaic(
        'Missing required "Source(s)": pick a folder, one or more video files, or drag-and-drop.',
        { title: "Trickplay", width: ctx.target.width, height: ctx.target.height },
      );
    }

    const knobs = resolveTrickplayKnobs(props);
    const stepNames = buildStepNames(inputs);
    const steps = inputs.flatMap((inputPath, i) =>
      buildTrickplayStepsForInput({ inputPath, stepBaseName: stepNames[i], knobs, ctx }),
    );

    return { kind: "mosaic_pipeline", version: 1, emit: "multi", steps };
  },
};

registerTemplate(Trickplay);
