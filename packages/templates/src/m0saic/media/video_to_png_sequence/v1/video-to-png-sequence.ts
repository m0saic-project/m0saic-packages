import type {
  MosaicAssetManifest,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicPipelineStep,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  registerTemplate,
  makeErrorMosaic,
  slugifyAssetKeyFromPath,
  computeFrameCount,
} from "@m0saic/template-utils";

// ---- PROPS ----

export type FrameStripperProps = {
  /**
   * The source video(s) — THE source knob. Every frame of every input is
   * emitted as its own PNG step, with step names prefixed by a per-input
   * slug so files from different videos don't collide on disk. One input
   * renders a single sequence; multiple fan out via `emit: "multi"`.
   */
  sourceIds?: string[];

  /**
   * Source-relative milliseconds at which the rendered segment begins.
   * When set with `clipEndMs`, the template only extracts frames in the
   * [clipStartMs, clipEndMs] window — the in-UI "scrub to the section
   * you care about" flow. Unset (or 0) → extract from the start.
   * Ignored when greater than the input's natural duration.
   *
   * Applies uniformly to every input under `sourceIds`. The Make page's
   * section editor scrubs the first input only (multi-input flows are
   * drag-drop and rarely need a range).
   */
  clipStartMs?: number;

  /**
   * Source-relative milliseconds at which the rendered segment ends.
   * Must be greater than `clipStartMs` when both are set. Unset → run
   * to the end of the clip. Clamped to the input's duration.
   */
  clipEndMs?: number;

  /**
   * Cap on the number of frames extracted **per input**. Useful as a
   * safety net for long inputs (a 60s @ 30fps video → 1800 ffmpeg
   * invocations). Unset = no cap, every frame of every input (within
   * the configured clip range, if any) is emitted.
   */
  maxFrames?: number;
};

const propsSchema = definePropsSchema<FrameStripperProps>({
  // The one source input. One required "Source(s)" field that takes a
  // folder, one or many files, or drag-and-drop. Every frame of every video
  // is emitted as its own PNG (emit:multi when >1 input).
  sourceIds: {
    type: "media[]",
    required: true,
    description:
      "Source video(s) to strip into PNG sequences — pick a folder, one or more files, or drag-and-drop. Every frame becomes its own PNG.",
    meta: {
      ui: { label: "Source(s)" },
      control: { multiple: true, picker: "folder", accept: ["video"] },
    },
  },
  clipStartMs: {
    type: "number",
    required: false,
    description:
      "Source-relative ms where the extracted segment starts. Paired with clipEndMs to scrub out a section. Unset → start at 0.",
    meta: {
      constraints: { min: 0 },
      control: {
        picker: "time-range",
        videoFromProp: "sourceIds",
        unit: "ms",
      },
      ui: { label: "Clip start" },
    },
  },
  clipEndMs: {
    type: "number",
    required: false,
    description:
      "Source-relative ms where the extracted segment ends. Must be > clipStartMs when both are set. Unset → run to the end of the clip.",
    meta: {
      constraints: { min: 0 },
      control: {
        placeholder: "video end",
        picker: "time-range",
        videoFromProp: "sourceIds",
        unit: "ms",
      },
      ui: { label: "Clip end" },
    },
  },
  maxFrames: {
    type: "number",
    required: false,
    description:
      "Cap on the number of frames extracted per input. Each frame is a separate ffmpeg invocation — long inputs are slow. Defaults to no cap.",
    meta: {
      control: { placeholder: "all frames" },
      constraints: { min: 1, max: 100000 },
      ui: { label: "Max Frames (per input)" },
    },
  },
});

/**
 * Resolve the input list from `sourceIds`. Returns `[]` when it's
 * empty/unset so the caller can surface a fail-fast error.
 */
function resolveInputs(props: FrameStripperProps): string[] {
  if (props.sourceIds && props.sourceIds.length > 0) return props.sourceIds;
  return [];
}

/**
 * Build unique, filename-safe slugs from input paths.
 *
 * Two distinct files can share a basename (`a/clip.mp4`, `b/clip.mp4`).
 * Dedupe by appending `_2`, `_3`, … so each input's frames carry a
 * unique step-name prefix (the engine rejects duplicate step names with
 * `PIPELINE_STEP_NAME_DUPLICATE`). Mirrors the convention in
 * `screencap-grid`.
 */
function buildInputSlugs(inputs: string[]): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (const input of inputs) {
    const base = slugifyAssetKeyFromPath(input);
    let name = base;
    let i = 2;
    while (used.has(name)) {
      name = `${base}_${i}`;
      i++;
    }
    used.add(name);
    out.push(name);
  }
  return out;
}

function frameStepName(
  inputSlug: string,
  frameIndex: number,
  totalFrames: number,
): string {
  const width = Math.max(4, String(totalFrames).length);
  return `${inputSlug}_frame_${String(frameIndex + 1).padStart(width, "0")}`;
}

// For a frame-stripper the INPUT video is the source of truth: we want
// every frame at its native rate across its full natural duration. The
// probed `meta` therefore wins over `ctx.target` (whose duration/fps
// describe the editor canvas / output timeline, and default to a short
// 5s / 30fps when the wrapping doc doesn't pin them). Preferring ctx
// here silently truncated long inputs to the first ~5s.
function resolveFps(meta: { fps?: number } | undefined, ctxFps: number | undefined): number {
  return meta?.fps ?? ctxFps ?? 30;
}

function resolveDurationMs(
  meta: { durationMs?: number } | undefined,
  ctxDurationMs: number | undefined,
): number {
  return meta?.durationMs ?? ctxDurationMs ?? 1000;
}

function resolveCanvas(
  meta: { width?: number; height?: number } | undefined,
  ctxWidth: number,
  ctxHeight: number,
): { width: number; height: number } {
  const w = meta?.width != null && meta.width > 0 ? meta.width : ctxWidth;
  const h = meta?.height != null && meta.height > 0 ? meta.height : ctxHeight;
  return { width: w, height: h };
}

// ---- TEMPLATE ----

export const FrameStripper: MosaicTemplate<FrameStripperProps> = {
  id: asTemplateId("@m0saic/media/video_to_png_sequence/v1"),
  label: "Frame Stripper",
  description:
    "Drop one or more videos, get every frame as a separate numbered PNG. Multi-input renders prefix each frame with the source basename so files don't collide. One ffmpeg invocation per frame — use maxFrames to cap long inputs.",
  version: 1,
  capabilities: { tier: "core" },
  tags: ["media", "frames", "png-sequence", "extract", "developers", "creators", "video"],
  propsSchema,

  outputHints: {
    format: { kind: "image", container: "png" },
    note: "Outputs N numbered PNGs per input via emit:multi.",
  },

  defaultProps: { clipStartMs: 0 },

  async render(
    props: FrameStripperProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocumentPipeline | MosaicDocument> {
    const inputs = resolveInputs(props);
    if (inputs.length === 0) {
      return makeErrorMosaic(
        "Drop one or more videos onto Frame Stripper to extract their frames.",
        {
          title: "Frame Stripper",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }

    // Validate the optional clip range up-front. Apply uniformly to every
    // input (multi-input drag-drop renders simply ignore the range when
    // unset; the Make page wires both knobs against the first input).
    if (
      props.clipStartMs != null &&
      props.clipEndMs != null &&
      props.clipEndMs <= props.clipStartMs
    ) {
      return makeErrorMosaic(
        `Clip end (${props.clipEndMs}ms) must be greater than clip start (${props.clipStartMs}ms).`,
        {
          title: "Frame Stripper",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }

    const slugs = buildInputSlugs(inputs);
    const steps: MosaicPipelineStep[] = [];

    for (let inputIdx = 0; inputIdx < inputs.length; inputIdx++) {
      const rawPath = inputs[inputIdx];
      const inputSlug = slugs[inputIdx];

      const ctxMediaKey = asAssetId(rawPath);
      const sourceAssetId = asAssetId(slugifyAssetKeyFromPath(rawPath));
      const meta = ctx.media[ctxMediaKey];

      const fps = resolveFps(meta, ctx.target.fps);
      const totalDurationMs = resolveDurationMs(meta, ctx.target.durationMs);
      const { width: stepWidth, height: stepHeight } = resolveCanvas(
        meta,
        ctx.target.width,
        ctx.target.height,
      );

      // Resolve the effective clip window. Clamped to [0, totalDurationMs]
      // so out-of-range values degrade gracefully (e.g. a range set in the
      // UI for a long clip still works when reused against a shorter one).
      const clipStartMs = Math.max(0, Math.min(props.clipStartMs ?? 0, totalDurationMs));
      const clipEndMs = Math.max(
        clipStartMs,
        Math.min(props.clipEndMs ?? totalDurationMs, totalDurationMs),
      );
      const segmentDurationMs = clipEndMs - clipStartMs;

      const { count: frameCount, frameDurationMs } = computeFrameCount({
        durationMs: segmentDurationMs,
        fps,
        ...(props.maxFrames != null ? { maxFrames: props.maxFrames } : {}),
      });

      // Each step is hermetic: it carries its own assets manifest so the
      // engine can render it standalone. Sharing one manifest object across
      // steps would couple their lifetimes; keep them independent.
      const assets: MosaicAssetManifest = {
        [sourceAssetId]: {
          kind: "file",
          path: rawPath,
          mediaType: "video",
        },
      };

      for (let frameIdx = 0; frameIdx < frameCount; frameIdx++) {
        // Offset by the segment start so the UI's section editor scrubs to
        // the right slice. Single-input drag-drop renders pass clipStartMs=0
        // and this is a no-op.
        const frameClipStartMs =
          clipStartMs + Math.round(frameIdx * frameDurationMs);
        const stepName = frameStepName(inputSlug, frameIdx, frameCount);

        const sources: MosaicSource[] = [
          {
            type: "media",
            mediaType: "video",
            assetId: sourceAssetId,
            placement: { fit: "cover" },
            playback: {
              clipStartMs: frameClipStartMs,
              clipDurationMs: Math.ceil(frameDurationMs),
              loopMode: "freeze",
            },
            audio: { enabled: false },
            editor: { owner: "template" },
          },
        ];

        const stepDoc: MosaicDocument = {
          kind: "mosaic_document",
          version: 1,
          sources,
          assets,
          m0: toM0String("F", "FrameStripper"),
          fps,
          durationMs: Math.ceil(frameDurationMs),
          size: { width: stepWidth, height: stepHeight },
          format: { kind: "image", container: "png" },
        };

        steps.push({
          name: stepName,
          label: stepName,
          durationMs: Math.ceil(frameDurationMs),
          file: stepDoc,
        });
      }
    }

    return {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      steps,
    };
  },
};

registerTemplate(FrameStripper);
export default FrameStripper;
