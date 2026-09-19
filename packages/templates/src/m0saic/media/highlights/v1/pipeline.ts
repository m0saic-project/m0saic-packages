/**
 * Per-range step builder for the highlights pipeline.
 *
 * One valid range → one pipeline step: a hermetic single-cell document
 * (m0 `"1"`, own assets manifest) whose one source is the input video
 * trimmed via the engine's playback primitive
 * (`clipStartMs` + `clipDurationMs`, `loopMode: "cut"`). Audio is left
 * UNSET so the cut keeps the source's synced audio; the `muteAudio`
 * knob opts out per-source. Each step declares its own canvas (probed
 * dims, maxWidth-capped) and its own `format` — the per-step format is
 * what gives an `emit:"multi"` batch correct per-file containers.
 *
 * Invalid ranges degrade to per-range error steps that keep their
 * positional name/label slot, so one bad range never kills the batch
 * (trickplay/watermark philosophy).
 */

import type {
  MosaicAssetManifest,
  MosaicDocument,
  MosaicEngineContext,
  MosaicPipelineStep,
  MosaicSource,
  MosaicTimeRangeMs,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  makeErrorMosaic,
  normalizeTimeRanges,
  slugifyAssetKeyFromPath,
} from "@m0saic/template-utils";
import {
  defaultRangeLabel,
  inputLabel,
  rangeStepName,
  sanitizeLabel,
  scaleToMaxWidth,
  type HighlightsKnobs,
} from "./plan";

/** Duration used for error-mosaic steps (bad ranges). */
export const ERROR_STEP_MS = 1000;

const ERROR_TITLE = "Highlights";

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
 * Build the pipeline steps for the input: one step per range, in the
 * given order (never sorted — step names and output files are
 * positional).
 */
export function buildHighlightSteps(args: {
  inputPath: string;
  stepBaseName: string;
  ranges: MosaicTimeRangeMs[];
  sourceDurationMs: number;
  sourceWidth: number;
  sourceHeight: number;
  knobs: HighlightsKnobs;
  ctx: MosaicEngineContext;
}): MosaicPipelineStep[] {
  const { inputPath, stepBaseName, ranges, knobs, ctx } = args;
  const labelBase = inputLabel(inputPath);
  const verdicts = normalizeTimeRanges(ranges, args.sourceDurationMs);

  const assetId = asAssetId(slugifyAssetKeyFromPath(inputPath));
  const assets: MosaicAssetManifest = {
    [assetId]: { kind: "file", path: inputPath, mediaType: "video" },
  } as MosaicAssetManifest;
  const size = scaleToMaxWidth(args.sourceWidth, args.sourceHeight, knobs.maxWidth);

  return verdicts.map((verdict, i) => {
    const name = rangeStepName(stepBaseName, i);

    if (!verdict.ok) {
      const label =
        (verdict.range.label !== undefined ? sanitizeLabel(verdict.range.label) : "") ||
        defaultRangeLabel(labelBase, verdict.range.startMs, verdict.range.endMs);
      return errorStep(name, label, `Range ${i + 1} invalid: ${verdict.reason}`, ctx);
    }

    const { startMs, endMs } = verdict;
    const label =
      (verdict.label !== undefined ? sanitizeLabel(verdict.label) : "") ||
      defaultRangeLabel(labelBase, startMs, endMs);

    const source: MosaicSource = {
      type: "media",
      mediaType: "video",
      assetId,
      // Cell aspect == source aspect up to even-rounding, so cover is
      // an exact fit (no visible crop).
      placement: { fit: "cover" },
      playback: { clipStartMs: startMs, clipDurationMs: endMs - startMs, loopMode: "cut" },
      ...(knobs.muteAudio ? { audio: { enabled: false } } : {}),
      editor: { owner: "template" },
    };

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String("1", ERROR_TITLE),
      assets,
      sources: [source],
      size,
      backgroundColor: "#000000",
      format: { kind: "video", container: knobs.outputFormat },
      // Doc-level disable is what actually STRIPS the track (`-an` on the
      // deliverable). The source-level knob above only mutes the mix
      // contribution — alone it ships a silent placeholder track.
      ...(knobs.muteAudio ? { audio: { mode: "off" } } : {}),
    };

    return { name, label, durationMs: endMs - startMs, file: doc };
  });
}
