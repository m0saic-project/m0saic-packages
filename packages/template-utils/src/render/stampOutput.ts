import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicPipelineStep,
  MosaicRenderableFile,
  MosaicAudioConfig,
  MosaicColorConfig,
  MosaicOutputFormat,
  MosaicOutputTarget,
} from "@m0saic/types";
import {
  computePipelineTimeline,
  isValidPipelineDurationMs,
} from "@m0saic/types";

/**
 * Resolved output values to stamp onto a doc/pipeline before the
 * file is serialized. The point of stamping is to make a `.mosaic`
 * (or `.mosaic-plan.json`) file **self-describing** — anyone
 * reading the file later can see what canvas / fps / duration /
 * codec it was rendered at without re-running the engine.
 *
 * Templates author with most of these fields optional (template
 * intent). The wrapper around `template.render()` calls
 * `stampRenderableOutput` after the render returns, supplying the
 * resolved values, so the on-disk artifact carries them whether or
 * not the template chose to set them itself.
 *
 * See the internal rendering-model-contract notes for the
 * "stamp at write time" contract.
 */
export type StampSource = {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  target?: MosaicOutputTarget;
  format?: MosaicOutputFormat;
  audio?: MosaicAudioConfig;
  color?: MosaicColorConfig;
};

function stampDocOutput(doc: MosaicDocument, src: StampSource): MosaicDocument {
  // Authored-intent precedence for durationMs (the pipeline precedent —
  // resolveStampedPipelineDurationMs — extended to plain documents, gate
  // 26): a doc that DECLARES a valid durationMs did so deliberately
  // (source-follow, e.g. subtitle-burn stamping the input's real length),
  // and well-behaved templates already yield to explicit user intent via
  // ctx.userIntent BEFORE authoring. Unconditional stamping here silently
  // clobbered that to the hint default ("big buck bunny defaulted to 10
  // seconds"). Docs that author nothing keep the resolved-target stamp.
  const authoredDurationMs =
    typeof doc.durationMs === "number" &&
    Number.isFinite(doc.durationMs) &&
    doc.durationMs > 0
      ? doc.durationMs
      : undefined;
  return {
    ...doc,
    // Authored size wins (gate-28 canvas law): a doc that declares its
    // canvas keeps it — the HOST decides whether to plan at it (default)
    // or at explicit user dims. Docs authoring nothing get the resolved
    // target so every stamped root doc carries a size (the boundary law).
    size: doc.size ?? { width: src.width, height: src.height },
    fps: src.fps,
    durationMs: authoredDurationMs ?? src.durationMs,
    ...(src.target !== undefined ? { target: src.target } : {}),
    ...(src.format !== undefined ? { format: src.format } : {}),
    ...(src.audio !== undefined ? { audio: src.audio } : {}),
    ...(src.color !== undefined ? { color: src.color } : {}),
  };
}

/**
 * Step-aware stamp: preserves the step's authoring intent for size /
 * fps / format when the template set them explicitly. Used by
 * emit:multi heterogeneous-output pipelines (e.g. aspect-safe-grid:
 * each step has its own canvas — landscape vs portrait; or
 * mixed-deliverable pipelines where a PNG cover step sits inside an
 * mp4 render target — the planner needs the step's own `format` to
 * plan an IMAGE graph for it). The unconditional top-level
 * {@link stampDocOutput} stamp would clobber those.
 *
 * `durationMs` always comes from `step.durationMs` (the step is the
 * source of truth for its own length, regardless of what the inner
 * file declares).
 */
function stampStepInlineDocOutput(
  doc: MosaicDocument,
  src: StampSource,
  stepDurationMs: number,
): MosaicDocument {
  const format = doc.format ?? src.format;
  return {
    ...doc,
    size: doc.size ?? { width: src.width, height: src.height },
    fps: doc.fps ?? src.fps,
    durationMs: stepDurationMs,
    ...(src.target !== undefined ? { target: src.target } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(src.audio !== undefined ? { audio: src.audio } : {}),
    ...(src.color !== undefined ? { color: src.color } : {}),
  };
}

/**
 * The `durationMs` to stamp on a pipeline.
 *
 * Precedence:
 *
 * 1. **A duration the template declared itself** — that's authoring
 *    intent, and `pipeline.durationMs` is a load-bearing render input
 *    (the flattened output is fit to it). Stamping over it would
 *    silently discard the template's decision.
 * 2. **`emit:"single"` → the NATURAL duration** — what the stitch
 *    actually produces (`Σ output steps − Σ transition overlaps`).
 *    Stamping the resolved render TARGET instead makes the file claim
 *    a length it doesn't have the moment any boundary carries a
 *    transition, which is how the hero pipeline came to declare 38s
 *    while rendering 35.55s.
 * 3. **`emit:"multi"` → the resolved target** — the fan-out emits one
 *    file per step and the pipeline-level field is inert, but a
 *    serialized pipeline must still carry one
 *    (`SERIALIZED_DOC_MISSING_DURATIONMS`).
 */
function resolveStampedPipelineDurationMs(
  pipe: MosaicDocumentPipeline,
  src: StampSource,
): number {
  if (isValidPipelineDurationMs(pipe.durationMs)) return pipe.durationMs;
  const timeline = computePipelineTimeline(pipe, {
    targetSize: { width: src.width, height: src.height },
    outputKind: src.format?.kind,
  });
  if (!timeline || timeline.emit === "multi") return src.durationMs;
  return timeline.naturalDurationMs;
}

/**
 * The `fps` to stamp on a pipeline. Same authored-intent precedence as
 * {@link resolveStampedPipelineDurationMs}: a pipeline fps the template
 * declared itself is authoring intent (highlights sets it from the probed
 * source so 60fps footage isn't resampled to the engine-default 30) —
 * stamping ctx.target.fps over it silently discarded that decision (the
 * gate-20 fps-follow bug: authored 60 left the wrapper as 30). Absent or
 * invalid authored fps still stamps the resolved target. An explicit
 * user fps continues to win DOWNSTREAM (planner `options.fps`, with the
 * FPS_OVERRIDDEN_BY_CLI diagnostic) — the stamp is not the override seam.
 */
function resolveStampedPipelineFps(
  pipe: MosaicDocumentPipeline,
  src: StampSource,
): number {
  const authored = pipe.fps;
  return typeof authored === "number" && Number.isFinite(authored) && authored > 0
    ? authored
    : src.fps;
}

export function stampRenderableOutput(
  file: MosaicRenderableFile,
  src: StampSource,
): MosaicRenderableFile {
  if (file.kind === "mosaic_document") {
    return stampDocOutput(file as MosaicDocument, src);
  }

  const pipe = file as MosaicDocumentPipeline;
  // Steps are stamped FIRST so the duration resolver sees the same
  // per-step canvases the engine will (a step's declared size decides
  // whether its boundary can xfade at all).
  const steps = pipe.steps.map((step) => stampStepInlineDoc(step, src));
  return {
    ...pipe,
    size: { width: src.width, height: src.height },
    fps: resolveStampedPipelineFps(pipe, src),
    durationMs: resolveStampedPipelineDurationMs({ ...pipe, steps }, src),
    ...(src.target !== undefined ? { target: src.target } : {}),
    ...(src.format !== undefined ? { format: src.format } : {}),
    ...(src.audio !== undefined ? { audio: src.audio } : {}),
    ...(src.color !== undefined ? { color: src.color } : {}),
    steps,
  };
}

function stampStepInlineDoc(step: MosaicPipelineStep, src: StampSource): MosaicPipelineStep {
  if (!("file" in step) || step.file === undefined) return step;
  // Each pipeline step owns its own durationMs (always stamped from
  // the step). Size and fps are preserved when the template set
  // them — emit:multi heterogeneous-output pipelines need per-step
  // canvases. Preserve the step's authoring fields (`name`,
  // `label`, `intermediate`) — they drive --output-pattern
  // {{name}}/{{label}} and the pipeline's output-step count, so
  // stripping them silently breaks emit:multi naming.
  const stamped = stampStepInlineDocOutput(step.file, src, step.durationMs);
  return {
    ...step,
    file: stamped,
  } as MosaicPipelineStep;
}
