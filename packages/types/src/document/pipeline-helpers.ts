import type { MosaicDocument } from "./document";
import type {
  MosaicDocumentPipeline,
  MosaicPipelineStep,
  MosaicPipelineTransition,
} from "./document-pipeline";
import { isPipelineFile } from "./document-pipeline";
import { MOSAIC_XFADE_MODES_SET } from "./xfadeModes";
import type { MosaicOutputEmit } from "../output/output";
import type { OutputKind } from "../output/format";
import type { LoopMode } from "../source/source";
import {
  DEFAULT_MAX_PIPELINE_CONCAT_INPUTS,
  DEFAULT_PIPELINE_DURATION_FIT,
} from "../defaults/pipeline";

/**
 * Helpers and predicates that encode the rendering-model contract
 * (the internal rendering-model-contract notes) at the
 * type-level boundary. The engine and CLI use them so the same
 * decisions are made everywhere.
 */

/**
 * A {@link MosaicDocument} or a {@link MosaicDocumentPipeline} —
 * the union returned by any template's `render()`.
 */
export type MosaicRenderable = MosaicDocument | MosaicDocumentPipeline;

/**
 * Runtime guard for the document side of the renderable union.
 * Companion to {@link isPipelineFile} (defined in document-pipeline.ts)
 * for ergonomic symmetry.
 */
export const isDocumentFile = (x: unknown): x is MosaicDocument =>
  (x as { kind?: string } | null | undefined)?.kind === "mosaic_document";

/**
 * Pipeline steps that contribute to output — `steps` minus the
 * `intermediate: true` ones. This is the canonical list for:
 *
 * - Determining the pipeline's output count (rule 3).
 * - Choosing between single- and multi-output mode (rule 10).
 * - Assembling the concat input list (rule 4, emit:"single").
 * - Assembling the per-file emission list (rule 4, emit:"multi").
 */
export const getOutputSteps = (
  pipeline: MosaicDocumentPipeline,
): MosaicPipelineStep[] => pipeline.steps.filter((s) => !s.intermediate);

/**
 * Convenience for `getOutputSteps(pipeline).length`. The count
 * pipelines use to detect single-vs-multi output and the
 * exact-override path (rule 7).
 */
export const getOutputStepCount = (
  pipeline: MosaicDocumentPipeline,
): number => getOutputSteps(pipeline).length;

/**
 * Resolved emit mode for a pipeline.
 *
 * Resolution rules (rule 2):
 *
 * - Honored only at the top level. Nested pipelines downgrade to
 *   `"single"`; the engine emits `PIPELINE_EMIT_MULTI_DOWNGRADED`.
 * - Defaults to `"single"` when omitted.
 * - Only meaningful when output-step count > 1; with a single
 *   output step there's nothing for `"multi"` to fan out to and
 *   the engine treats it as `"single"`.
 *
 * The `nested` flag must be supplied by the caller; the type
 * system can't tell whether the pipeline is nested.
 */
export const getEmit = (
  pipeline: MosaicDocumentPipeline,
  opts: { nested: boolean },
): MosaicOutputEmit => {
  if (opts.nested) return "single";
  return pipeline.emit ?? "single";
};

/**
 * True when a pipeline can actually fan out to multiple output
 * files in this invocation — top-level + emit `"multi"` + more
 * than one output-step.
 *
 * Used by the planner to decide between concat (false) and fan-out
 * (true).
 */
export const isMultiOutputCapable = (
  r: MosaicRenderable,
  opts: { nested: boolean },
): boolean => {
  if (!isPipelineFile(r)) return false;
  if (getEmit(r, opts) !== "multi") return false;
  return getOutputStepCount(r) > 1;
};

/**
 * Pipeline-step name used for filename basis and CLI addressing.
 *
 * Returns `step.name` if explicitly set; otherwise the engine's
 * fallback `step-{index}` form (e.g. `step-0`, `step-1`). The
 * fallback is deterministic and order-stable so CLI invocations
 * can address unnamed steps positionally.
 */
export const resolveStepName = (
  step: MosaicPipelineStep,
  index: number,
): string => step.name ?? `step-${index}`;

// ───────────────────────── duration / timeline ─────────────────────────
//
// A pipeline has TWO durations and they are not the same number:
//
//   natural  = Σ output-step durations − Σ transition overlaps
//              (what the stitch actually produces)
//   declared = `pipeline.durationMs`, a self-declared slot duration
//              (what the flattened result should be fit to)
//
// The plain "sum of step.durationMs" is wrong the moment any boundary
// carries a transition: a transition of duration d overlaps the last d
// of the earlier step with the first d of the later one, so the pair
// stitches to `A + B − d`, not `A + B`.
//
// These helpers are the ONE implementation of that math. They live in
// `@m0saic/types` because the engine, the template-authoring guards,
// and the desktop timeline all need to agree on it, and the latter two
// may not depend on `@m0saic/core`.

/**
 * Whether a pipeline-level `durationMs` is structurally usable.
 *
 * Deliberately strict — `Infinity`, `NaN`, negatives, zero and
 * fractional milliseconds all fail. Callers that can emit diagnostics
 * should report the rejection rather than silently ignoring the field.
 */
export const isValidPipelineDurationMs = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n > 0;

/**
 * The stitched length of a run of segments joined by transitions.
 *
 * `overlapsMs[i]` is the overlap consumed at segment `i`'s LEFT edge
 * (so `overlapsMs[0]` is always 0). Both arrays are indexed over
 * OUTPUT steps only — intermediates never reach the stitch.
 */
export const sumPipelineDurations = (
  durationsMs: readonly number[],
  overlapsMs: readonly number[],
): number =>
  durationsMs.reduce((total, d, i) => total + d - (overlapsMs[i] ?? 0), 0);

/** What the engine does to reconcile a declared duration with the natural one. */
export type PipelineFitAction =
  /** Declared absent, invalid, or already equal — the stitch is untouched. */
  | "none"
  /** Declared is shorter — the flattened output is trimmed at the tail. */
  | "trim"
  /** Declared is longer, `freeze` — hold the final frame for the remainder. */
  | "pad"
  /** Declared is longer, `loop` — repeat the flattened output to fill. */
  | "loop"
  /** Declared is longer, `cut` — nothing to fill with; render natural and warn. */
  | "underrun";

export interface PipelineFitResolution {
  /** The length the pipeline's deliverable actually ends up being. */
  durationMs: number;
  naturalDurationMs: number;
  /** Present only when the pipeline declared a structurally valid duration. */
  declaredDurationMs?: number;
  fit: LoopMode;
  action: PipelineFitAction;
}

/**
 * Reconcile a declared slot duration against the natural one.
 *
 * This is the single decision table behind `pipeline.durationMs`. The
 * planner uses it to choose a filtergraph; the desktop timeline uses it
 * to draw a track that matches. They must never disagree, which is why
 * neither owns a copy.
 *
 * Shortening is mode-independent — all three fit modes trim the tail.
 * The mode only decides how a SHORTFALL is filled.
 */
export const resolvePipelineFit = (
  naturalDurationMs: number,
  declaredDurationMs: number | undefined,
  fit: LoopMode = DEFAULT_PIPELINE_DURATION_FIT,
): PipelineFitResolution => {
  const base = { naturalDurationMs, fit };

  // A zero-length pipeline has nothing to trim and nothing to repeat —
  // looping it would never terminate.
  if (
    !isValidPipelineDurationMs(declaredDurationMs) ||
    naturalDurationMs <= 0
  ) {
    return { ...base, durationMs: naturalDurationMs, action: "none" };
  }

  const declared = declaredDurationMs;
  if (declared === naturalDurationMs) {
    return {
      ...base,
      declaredDurationMs: declared,
      durationMs: naturalDurationMs,
      action: "none",
    };
  }
  if (declared < naturalDurationMs) {
    return {
      ...base,
      declaredDurationMs: declared,
      durationMs: declared,
      action: "trim",
    };
  }
  if (fit === "cut") {
    return {
      ...base,
      declaredDurationMs: declared,
      durationMs: naturalDurationMs,
      action: "underrun",
    };
  }
  return {
    ...base,
    declaredDurationMs: declared,
    durationMs: declared,
    action: fit === "freeze" ? "pad" : "loop",
  };
};

/** One output step's placement on the stitched timeline. */
export interface PipelineStepBand {
  /** Output-step ordinal (intermediates are not counted). */
  index: number;
  /** Engine-parity name: explicit `step.name`, else `step-{rawIndex}`
   *  over the FULL steps array — matches emit:"multi" filenames and CLI
   *  addressing, both of which keep intermediates in their positions. */
  name: string;
  startMs: number;
  endMs: number;
  /** Transition overlap consumed at this band's LEFT edge. Always 0 for
   *  the first band, for cut/degraded boundaries, and under emit:"multi". */
  overlapInMs: number;
  /**
   * Set when this band exists only because the declared duration is
   * LONGER than the natural one — a repeated lap under `durationFit:
   * "loop"`. The content is real (it's what the deliverable shows
   * there), but it's a repeat rather than authored timeline, so a UI
   * can render it dimmed.
   *
   * `lap` is the 0-based repetition index; lap 0 is the authored pass.
   */
  lap?: number;
  /**
   * Set on the final band when `durationFit: "freeze"` extends it —
   * everything past `heldFromMs` is the last frame held, not motion.
   */
  heldFromMs?: number;
}

export interface PipelineTimeline extends PipelineFitResolution {
  emit: MosaicOutputEmit;
  /**
   * What is on screen across `[0, durationMs]` — the DELIVERABLE's
   * timeline, not the authored one.
   *
   * The fit is applied to the flattened output rather than to
   * individual steps, so step lengths never change. What does change is
   * how much of them survives, and what fills a shortfall:
   *
   * - `trim` — bands past `durationMs` are dropped, the straddling one
   *   is clipped.
   * - `pad` (freeze) — the final band extends to `durationMs`, carrying
   *   {@link PipelineStepBand.heldFromMs}.
   * - `loop` — the whole cycle repeats, each repeat carrying
   *   {@link PipelineStepBand.lap}; the final lap is clipped.
   *
   * Bands therefore always tile `[0, durationMs]`, which is what makes
   * {@link stepIndexAtTime} agree with the render at every point on the
   * track. `naturalDurationMs` is still there for anything that needs
   * the authored length.
   */
  bands: PipelineStepBand[];
}

export interface PipelineTimelineOpts {
  /** The OUTER render target. Steps without a declared `file.size`
   *  render at this size, so it feeds the size-mismatch degrade check.
   *  When absent, only boundaries where BOTH sides declare differing
   *  sizes degrade (conservative). */
  targetSize?: { width: number; height: number } | null;
  /** Resolved OUTPUT format kind — a single-image-step pipeline counts
   *  as multi-output (the Frame Stripper shape). */
  outputKind?: OutputKind | null;
  /** Nested pipelines always collapse to `emit:"single"`. */
  nested?: boolean;
  /**
   * A host-supplied duration for the deliverable — the CLI
   * `--durationMs` flag or the desktop Duration field. Mirrors what the
   * planner does with `options.durationMs`:
   *
   * - exactly ONE output step → that step re-renders at this length
   *   (its content re-times);
   * - MORE than one → this becomes the declared slot duration, winning
   *   over `pipeline.durationMs`, and the ordinary fit applies.
   *
   * Ignored for nested pipelines: the override addresses the outer
   * deliverable, never an inner stitch.
   */
  overrideDurationMs?: number | null;
}

type Stepish = MosaicPipelineStep & {
  file?: { size?: { width: number; height: number }; format?: { kind?: string } };
};

const finitePositiveMs = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;

/** The size this step RENDERS at — declared `file.size` wins, else the
 *  outer planning target (the planner's `baseStepOptions`). */
const effectiveStepSize = (
  step: Stepish,
  opts: PipelineTimelineOpts,
): { width: number; height: number } | null => {
  const s = step.file?.size;
  if (s && Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  return opts.targetSize ?? null;
};

/**
 * The duration this step actually renders for.
 *
 * Nested-pipeline steps use the inner pipeline's own FITTED duration —
 * the engine plans the child recursively and takes the resulting
 * command's length, warning (`PIPELINE_STEP_DURATION_MISMATCH`) when
 * the authored `step.durationMs` disagrees. The derived duration wins.
 */
const effectiveStepDurationMs = (
  step: Stepish,
  opts: PipelineTimelineOpts,
): number => {
  const file = step.file as unknown;
  if (isPipelineFile(file)) {
    const inner = buildTimeline(file, { ...opts, nested: true });
    if (inner) return inner.durationMs;
  }
  return finitePositiveMs((step as { durationMs?: number }).durationMs);
};

/**
 * One boundary's overlap, after every degrade-to-cut path the planner
 * applies: unknown xfade kernel, non-finite/non-positive duration, a
 * size-mismatched boundary, and finally the clamp to the shorter
 * adjacent segment.
 */
const boundaryOverlapMs = (
  prev: Stepish,
  next: Stepish,
  prevDurMs: number,
  nextDurMs: number,
  defaultTransition: MosaicPipelineTransition | undefined,
  opts: PipelineTimelineOpts,
): number => {
  const t = prev.transitionToNext ?? defaultTransition;
  if (!t || t.type === "cut") return 0;
  // `fade` is sugar for the "fade" kernel; anything unrecognized cuts.
  const kind = t.type === "fade" ? "fade" : t.kind;
  if (!MOSAIC_XFADE_MODES_SET.has(kind)) return 0;
  if (!Number.isFinite(t.durationMs) || t.durationMs <= 0) return 0;
  // xfade requires equal dimensions on both sides.
  const a = effectiveStepSize(prev, opts);
  const b = effectiveStepSize(next, opts);
  if (a && b && (a.width !== b.width || a.height !== b.height)) return 0;
  return Math.min(Math.round(t.durationMs), prevDurMs, nextDurMs);
};

function buildTimeline(
  renderable: unknown,
  opts: PipelineTimelineOpts,
): PipelineTimeline | null {
  if (!isPipelineFile(renderable)) return null;
  const pipeline = renderable as MosaicDocumentPipeline;
  const nested = opts.nested === true;

  // Walked directly (rather than via getOutputSteps) so each band keeps
  // its FULL steps-array index for engine-parity naming.
  const outputs: Array<{ step: Stepish; rawIndex: number }> = [];
  pipeline.steps.forEach((s, i) => {
    if (s && !(s as { intermediate?: boolean }).intermediate) {
      outputs.push({ step: s as Stepish, rawIndex: i });
    }
  });
  if (outputs.length === 0) return null;

  const hasImageOutputStep = outputs.some(
    (o) => o.step.file?.format?.kind === "image",
  );
  const emit: MosaicOutputEmit =
    getEmit(pipeline, { nested }) === "multi" &&
    (outputs.length > 1 || opts.outputKind === "image" || hasImageOutputStep)
      ? "multi"
      : "single";

  // Mirror the planner's duration override (see `overrideDurationMs`):
  // a single output step absorbs it directly; more than one leaves the
  // steps alone and takes it as the declared slot duration below.
  const override =
    !nested && isValidPipelineDurationMs(opts.overrideDurationMs)
      ? opts.overrideDurationMs
      : undefined;
  const durations =
    override !== undefined && outputs.length === 1
      ? [override]
      : outputs.map((o) => effectiveStepDurationMs(o.step, opts));

  let overlaps = outputs.map((o, i) => {
    if (emit === "multi" || i === 0) return 0;
    return boundaryOverlapMs(
      outputs[i - 1].step,
      o.step,
      durations[i - 1],
      durations[i],
      pipeline.defaultTransition,
      opts,
    );
  });
  // Past the concat-input ceiling the stitch batches into cut-only
  // rounds, so EVERY transition is dropped.
  if (outputs.length > DEFAULT_MAX_PIPELINE_CONCAT_INPUTS) {
    overlaps = overlaps.map(() => 0);
  }

  const bands: PipelineStepBand[] = [];
  let cursor = 0;
  for (let i = 0; i < outputs.length; i++) {
    const startMs = cursor - overlaps[i];
    bands.push({
      index: i,
      name: resolveStepName(outputs[i].step, outputs[i].rawIndex),
      startMs,
      endMs: startMs + durations[i],
      overlapInMs: overlaps[i],
    });
    cursor = startMs + durations[i];
  }

  const naturalDurationMs = sumPipelineDurations(durations, overlaps);

  // `durationMs` is a self-declared SLOT duration for the flattened
  // single output. Under emit:"multi" every step is its own file, so
  // there is no flattened result to fit and the field is inert.
  //
  // The host override supersedes an authored/stamped `pipeline.durationMs`
  // in BOTH arities: with several output steps it IS the declared slot;
  // with exactly one it already re-timed the step above, and letting a
  // stale declared value survive would loop/pad the re-timed content to
  // fill it (the render wrapper stamps the natural total onto
  // `pipeline.durationMs`, so a 596.5s stamp + a 10s Duration field
  // looped a 10s window for ~60 laps — the metadata-stamp regression).
  // Mirrors the planner (buildMosaicPlanFromFile's declaredSourceMs).
  const declared = override !== undefined ? override : pipeline.durationMs;
  const fitted =
    emit === "multi"
      ? resolvePipelineFit(naturalDurationMs, undefined, pipeline.durationFit)
      : resolvePipelineFit(naturalDurationMs, declared, pipeline.durationFit);

  return {
    ...fitted,
    emit,
    bands: applyFitToBands(bands, fitted, naturalDurationMs),
  };
}

/**
 * Re-project the authored bands onto the fitted deliverable.
 *
 * The engine fits the FLATTENED output, so nothing here re-times a
 * step — bands are clipped, held, or repeated wholesale. Getting this
 * wrong is not cosmetic: a scrubber resolves "which step is on screen"
 * from these bands, so an unmodelled fill region reports the wrong step
 * for the whole tail.
 */
function applyFitToBands(
  bands: PipelineStepBand[],
  fitted: PipelineFitResolution,
  naturalDurationMs: number,
): PipelineStepBand[] {
  const total = fitted.durationMs;

  if (fitted.action === "trim") {
    return bands
      .filter((b) => b.startMs < total)
      .map((b) => (b.endMs > total ? { ...b, endMs: total } : b));
  }

  if (fitted.action === "pad") {
    // The held frame is still the last step's content, so the final
    // band simply runs longer.
    return bands.map((b, i) =>
      i === bands.length - 1
        ? { ...b, endMs: total, heldFromMs: b.endMs }
        : b,
    );
  }

  if (fitted.action === "loop" && naturalDurationMs > 0) {
    const out: PipelineStepBand[] = [];
    for (let lap = 0; lap * naturalDurationMs < total; lap++) {
      const shift = lap * naturalDurationMs;
      for (const b of bands) {
        const startMs = b.startMs + shift;
        if (startMs >= total) break;
        out.push({
          ...b,
          startMs,
          endMs: Math.min(b.endMs + shift, total),
          ...(lap > 0 ? { lap } : {}),
        });
      }
    }
    return out;
  }

  // "none" and "underrun" both render the natural duration untouched.
  return bands;
}

/**
 * Resolve a renderable to its stitched timeline — per-step bands, the
 * natural (overlap-adjusted) duration, and the effective duration after
 * the declared-duration fit.
 *
 * Returns `null` for single documents and for pipelines with no output
 * steps; callers fall back to their own duration source.
 *
 * This reproduces what the PLANNER does, including every degrade-to-cut
 * path — the numbers are meant to match the render, not the type docs.
 */
export const computePipelineTimeline = (
  renderable: unknown,
  opts: PipelineTimelineOpts = {},
): PipelineTimeline | null => buildTimeline(renderable, opts);

/**
 * The band containing `tMs` — the LAST band whose `[startMs, endMs)`
 * contains it, so inside an overlap zone the INCOMING step wins (the
 * transition is visually "arriving"). The final band is end-INCLUSIVE
 * so an End-key / 100% cursor still resolves a step. Null outside.
 */
export const stepIndexAtTime = (
  timeline: PipelineTimeline,
  tMs: number,
): number | null => {
  const last = timeline.bands.length - 1;
  for (let i = last; i >= 0; i--) {
    const b = timeline.bands[i];
    const endOk = i === last ? tMs <= b.endMs : tMs < b.endMs;
    if (tMs >= b.startMs && endOk) return b.index;
  }
  return null;
};
