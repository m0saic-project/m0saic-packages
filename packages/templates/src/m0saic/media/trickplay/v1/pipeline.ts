/**
 * Per-input step builder for the trickplay pipeline.
 *
 * One input fans out to one pipeline step PER SHEET (long content
 * overflows a sheet's cols·rowsPerSheet capacity). Every cell is the
 * same video asset seeked to its own timestamp — screencap-grid's
 * frame-at-timestamp mechanism (`clipStartMs` + freeze) with the
 * proportional math swapped for the fixed cadence in `plan.ts`.
 *
 * The per-input index sidecars (WebVTT storyboard + JSON manifest)
 * ride the FIRST sheet step, image modes only — the engine writes them
 * next to that sheet's deliverable and resolves the step-output tokens
 * to final basenames. The mp4 mode (animated contact-sheet preview)
 * emits no sidecars: index files only make sense against image sheets.
 */

import type {
  MosaicAssetManifest,
  MosaicDocument,
  MosaicEngineContext,
  MosaicOutputFormat,
  MosaicPipelineStep,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId, stepOutputToken } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  makeErrorMosaic,
  slugifyAssetKeyFromPath,
} from "@m0saic/template-utils";
import { planTrickplay, type TrickplayPlan } from "./plan";
import { buildStoryboardVtt, buildTrickplayManifest } from "./sidecars";

/** Fixed duration for image sheet steps — a single-frame render. */
export const IMAGE_STEP_MS = 40;

/** Duration used for error-mosaic steps (input problems). */
export const ERROR_STEP_MS = 1000;

const ERROR_TITLE = "Trickplay";

export type TrickplayOutputFormat = "png" | "jpeg" | "mp4";

/** Resolved knobs a step needs (validated once by the template). */
export type TrickplayStepKnobs = {
  intervalSec: number;
  tileWidth: number;
  cols: number;
  rowsPerSheet: number;
  outputFormat: TrickplayOutputFormat;
};

/** Step name for input `stepBaseName`'s sheet `sheetIndex` (0-based → `__sheet_01`). */
export function sheetStepName(stepBaseName: string, sheetIndex: number): string {
  return `${stepBaseName}__sheet_${String(sheetIndex + 1).padStart(2, "0")}`;
}

/** Input basename without directory or extension — the step label.
 * Local (not node:path) so the template stays web-bundle clean. */
function inputLabel(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * The m0 for one sheet: `rows` stacked rows of `cols` cells, with the
 * trailing cells of a partial last row as null tiles (`-` holes — they
 * consume no source; the doc's black background shows through).
 * Produces the identical string to `grid({rows, cols}).m0` when the
 * sheet is full (locked by a unit test).
 */
export function buildSheetM0(rows: number, cols: number, thumbCount: number): string {
  const rowStrs: string[] = [];
  for (let r = 0; r < rows; r++) {
    const tokens: string[] = [];
    for (let c = 0; c < cols; c++) {
      tokens.push(r * cols + c < thumbCount ? "1" : "-");
    }
    rowStrs.push(cols === 1 ? tokens[0] : `${cols}(${tokens.join(",")})`);
  }
  return rows === 1 ? rowStrs[0] : `${rows}[${rowStrs.join(",")}]`;
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
 * Build the pipeline steps for one input: one step per sheet, plus the
 * per-input index sidecars on the first sheet step. Input problems
 * degrade to a single error-mosaic step so one bad file never kills a
 * batch.
 */
export function buildTrickplayStepsForInput(args: {
  inputPath: string;
  stepBaseName: string;
  knobs: TrickplayStepKnobs;
  ctx: MosaicEngineContext;
}): MosaicPipelineStep[] {
  const { inputPath, stepBaseName, knobs, ctx } = args;
  const label = inputLabel(inputPath);
  const firstStepName = sheetStepName(stepBaseName, 0);

  const meta = ctx.media[asAssetId(inputPath)];
  if (!meta || !(meta.width > 0) || !(meta.height > 0)) {
    return [errorStep(firstStepName, label, `No probed dimensions for input: ${inputPath}`, ctx)];
  }
  if (meta.kind !== "video") {
    return [
      errorStep(
        firstStepName,
        label,
        `Trickplay needs a video input (kind: ${meta.kind}): ${inputPath}`,
        ctx,
      ),
    ];
  }
  if (!(meta.durationMs != null && meta.durationMs > 0)) {
    return [errorStep(firstStepName, label, `Video input has no probed duration: ${inputPath}`, ctx)];
  }

  try {
    const frameMs = Math.max(1, Math.round(1000 / (meta.fps ?? ctx.target.fps ?? 30)));
    const plan = planTrickplay({
      durationMs: meta.durationMs,
      srcWidth: meta.width,
      srcHeight: meta.height,
      frameMs,
      intervalSec: knobs.intervalSec,
      tileWidth: knobs.tileWidth,
      cols: knobs.cols,
      rowsPerSheet: knobs.rowsPerSheet,
    });

    const isImage = knobs.outputFormat !== "mp4";
    const format: MosaicOutputFormat = isImage
      ? { kind: "image", container: knobs.outputFormat }
      : { kind: "video", container: "mp4" };
    const stepDurationMs = isImage ? IMAGE_STEP_MS : (ctx.target.durationMs ?? 5000);

    const assetId = asAssetId(slugifyAssetKeyFromPath(inputPath));
    const assets: MosaicAssetManifest = {
      [assetId]: { kind: "file", path: inputPath, mediaType: "video" },
    } as MosaicAssetManifest;

    return plan.sheets.map((sheet) => {
      const sources: MosaicSource[] = [];
      for (let j = 0; j < sheet.thumbCount; j++) {
        const t = plan.timestampsMs[sheet.firstThumbIndex + j];
        sources.push({
          type: "media",
          mediaType: "video",
          assetId,
          // Cell aspect == source aspect up to even-rounding, so cover
          // is an exact fit (no visible crop).
          placement: { fit: "cover" },
          playback: isImage
            ? { clipStartMs: t, clipDurationMs: frameMs, loopMode: "freeze" }
            : { clipStartMs: t },
          audio: { enabled: false },
          editor: { owner: "template" },
        });
      }

      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String(buildSheetM0(sheet.rows, sheet.cols, sheet.thumbCount), "Trickplay"),
        assets,
        sources,
        size: { width: sheet.width, height: sheet.height },
        backgroundColor: "#000000",
        format,
        ...(isImage && sheet.index === 0
          ? { sidecars: buildIndexSidecars(plan, inputPath, meta.durationMs!, knobs, stepBaseName) }
          : {}),
      };

      return {
        name: sheetStepName(stepBaseName, sheet.index),
        label: plan.sheets.length > 1 ? `${label} (sheet ${sheet.index + 1}/${plan.sheets.length})` : label,
        durationMs: stepDurationMs,
        file: doc,
      };
    });
  } catch (err) {
    return [
      errorStep(
        firstStepName,
        label,
        `Trickplay step failed for ${inputPath}: ${err instanceof Error ? err.message : String(err)}`,
        ctx,
      ),
    ];
  }
}

function buildIndexSidecars(
  plan: TrickplayPlan,
  inputPath: string,
  durationMs: number,
  knobs: TrickplayStepKnobs,
  stepBaseName: string,
): Record<string, unknown> {
  const sheetRef = (sheetIndex: number) =>
    stepOutputToken(sheetStepName(stepBaseName, sheetIndex));
  return {
    trickplay: buildTrickplayManifest({
      plan,
      inputPath,
      durationMs,
      cols: knobs.cols,
      rowsPerSheet: knobs.rowsPerSheet,
      sheetRef,
    }),
    storyboard: {
      kind: "text",
      ext: "vtt",
      content: buildStoryboardVtt(plan, sheetRef),
    },
  };
}
