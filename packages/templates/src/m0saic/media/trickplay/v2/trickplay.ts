/**
 * TrickplayV2 sheet generator — `@m0saic/media/trickplay/v2`.
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
 * contact-sheet preview (no sidecars). `outputHints.format` declares the
 * knob's DEFAULT (png) — the `outputFormat` convention — and the knob wins
 * per render: hosts resolve the format for the props they hold
 * (`resolveTemplateOutputHints`), and each pipeline step declares its own.
 *
 * Always returns an `emit:"multi"` pipeline (watermark precedent):
 * per-step canvases are the only vehicle for probed-dims sheet sizing,
 * and long inputs fan out to multiple sheet steps.
 */

import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import {
  buildStepNames,
  definePropsSchema,
  registerTemplate,
  tag,
  type PropBindingEntry,
} from "@m0saic/template-utils";
import { withAddHandles } from "../../../_shared/canvas-handles";
import { mediaStandInDocument } from "../../../_shared/stand-in";
import {
  buildTrickplayStepsForInput,
  type TrickplayOutputFormat,
  type TrickplayStepKnobs,
} from "../v1/pipeline";

export type TrickplayV2Props = {
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

const propsSchema = definePropsSchema<TrickplayV2Props>({
  sourceIds: {
    type: "media[]",
    required: true,
    meta: {
      control: { multiple: true, picker: "folder", accept: ["video"] },
    },
  },
  intervalSec: {
    type: "number",
    required: false,
    meta: { constraints: { min: 1, max: 600 } },
  },
  tileWidth: {
    type: "number",
    required: false,
    meta: { constraints: { min: 64, max: 1024 } },
  },
  cols: {
    type: "number",
    required: false,
    meta: { constraints: { min: 1, max: 20 } },
  },
  rowsPerSheet: {
    type: "number",
    required: false,
    meta: { constraints: { min: 1, max: 20 } },
  },
  outputFormat: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["png", "jpeg", "mp4"] },
    },
  },
});

const DEFAULTS: Omit<TrickplayV2Props, "sourceIds"> = {
  intervalSec: 10,
  tileWidth: 320,
  cols: 10,
  rowsPerSheet: 10,
  outputFormat: "png",
};

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** Resolve + clamp props to deterministic step knobs. */
export function resolveTrickplayKnobs(props: TrickplayV2Props): TrickplayStepKnobs {
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

export const TrickplayV2: MosaicTemplate<TrickplayV2Props> = {
  id: asTemplateId("@m0saic/media/trickplay/v2"),
  version: 2,
  capabilities: { tier: "core" },

  // The knob's default; `resolveTemplateOutputHints` lets the knob move it.
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
    props: TrickplayV2Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicRenderableFile> {
    const inputs = props.sourceIds && props.sourceIds.length > 0 ? props.sourceIds : [];
    // v2: every frame tile of a sheet (and the stand-in slot) carries the
    // sheet's shape — what the tiles ARE — after the file it was cut from.
    const sheetHandles: PropBindingEntry[] = [{ propKey: "intervalSec" }, { propKey: "tileWidth" }, { propKey: "cols" }, { propKey: "rowsPerSheet" }];
    if (inputs.length === 0) {
      // v2: no source yet → THE SLOT BEFORE THE FOOTAGE (a drop target on the
      // Make canvas, marked `incomplete`) instead of an error card.
      return mediaStandInDocument({
        width: ctx.target.width,
        height: ctx.target.height,
        name: "Trickplay",
        title: "Drop a video here",
        hint: "Files or a folder — one set of seek-preview sheets per video.",
        handles: [{ propKey: "sourceIds", index: 0 }, ...sheetHandles],
        fps: ctx.target.fps,
        durationMs: ctx.target.durationMs,
      });
    }

    const knobs = resolveTrickplayKnobs(props);
    const stepNames = buildStepNames(inputs);
    const steps = inputs.flatMap((inputPath, i) => {
      const forInput = buildTrickplayStepsForInput({ inputPath, stepBaseName: stepNames[i], knobs, ctx });
      for (const step of forInput) {
        for (const src of ((step.file as MosaicDocument).sources ?? []) as MosaicSource[]) {
          if ((src as { type?: string }).type !== "media") continue; // an error step's card
          withAddHandles(tag(src, "frame"), [{ propKey: "sourceIds", index: i }, ...sheetHandles]);
        }
      }
      return forInput;
    });

    return { kind: "mosaic_pipeline", version: 1, emit: "multi", steps };
  },
};

registerTemplate(TrickplayV2);
