import type { MosaicXPipeline } from "./mosaicx-document";
import type { MosaicBackgroundImage, MosaicDocument } from "./document";
import type { MosaicXfadeMode } from "./xfadeModes";
import type { MosaicColor } from "../colors/mosaicColor";
import type {
  MosaicFileMeta,
  MosaicRenderableEditorMeta,
  MosaicEngineMeta,
} from "../meta";
import type { MosaicAudioConfig } from "../output/audio-config";
import type { MosaicColorConfig } from "../output/color-config";
import type { MosaicContainerMetadata } from "../output/container-metadata";
import type { MosaicOutputEncode } from "../output/encode";
import type { MosaicOutputEmit } from "../output/output";
import type { MosaicOutputFormat } from "../output/format";
import type { MosaicOutputTarget } from "../output/target";
import type { LoopMode } from "../source/source";

/**
 * Transition behavior between pipeline steps.
 *
 * - `cut` — hard boundary (default; the concat path).
 * - `fade` — crossfade; sugar for `xfade` with `kind: "fade"`.
 * - `xfade` — any of the 58 built-in ffmpeg `xfade` kernels (see
 *   {@link MosaicXfadeMode}; `custom` is deliberately not offered —
 *   interpreter-class).
 *
 * **Timing model (the overlap rule):** a transition of `durationMs` d
 * OVERLAPS the last d of the earlier step with the first d of the later
 * step — the stitched output is `A + B − d`, not `A + B`. The planner
 * clamps d to `min(A, B)` (with a diagnostic) so the overlap can never
 * exceed either side. Boundaries between steps rendered at different
 * canvas sizes fall back to `cut` with a diagnostic — `xfade` requires
 * equal dimensions.
 */
export type MosaicPipelineTransition =
  | { type: "cut" }
  | { type: "fade"; durationMs: number }
  | { type: "xfade"; kind: MosaicXfadeMode; durationMs: number };

/**
 * Shared step timing contract.
 *
 * `durationMs` is the *exact* length this step renders for. The engine
 * enforces this by trimming/looping/freezing sources as needed when
 * building per-step render plans.
 *
 * Whether that rendered duration ends up in the pipeline's final
 * output depends on {@link intermediate} — see below.
 */
export type MosaicPipelineStepBase = {
  durationMs: number;

  /**
   * Friendly-slug name for this step. Used as the filename basis
   * when the pipeline emits `"multi"` (each step becomes
   * `{base}-{name}.{ext}`), and as the addressing key for CLI
   * per-step output overrides (rule 7 in
   * the internal rendering-model-contract notes).
   *
   * When omitted, the engine falls back to `step-{index}` for
   * filename and addressing purposes. Two steps in the same
   * pipeline must not share a name; the engine emits
   * `PIPELINE_STEP_NAME_DUPLICATE` if they do.
   *
   * Must match `FRIENDLY_SLUG_PATTERN` (the same tier as
   * {@link MosaicOutput} keys — filename-safe).
   */
  name?: string;

  /**
   * Optional human-readable label the template wants to associate
   * with this step's output. Surfaced verbatim to the CLI's
   * `--output-pattern` `{{label}}` token so batch renders can use
   * it in output filenames.
   *
   * # Conventions (template-author's choice)
   *
   * - **1 input → N outputs** (e.g. a "make mobile + desktop
   *   variants" template processing one video): set `label` to the
   *   input video's filename without extension (e.g. `"vacation"`).
   *   Each variant step shares the same label; `step.name` carries
   *   the variant suffix (`vacation_desktop`, `vacation_mobile`).
   * - **N inputs → N outputs** (e.g. a per-file batch processor):
   *   set `label` to each input's filename. Steps are 1:1 with
   *   inputs, so the label is unambiguous.
   * - **N inputs → 1 output** (e.g. a grid template fusing 5 vids
   *   into one mosaic): there's no canonical per-output label.
   *   Leave undefined, or pick a composite name. Pattern users
   *   typically don't include `{{label}}` for these templates.
   *
   * The engine does NOT auto-derive this from the step's media
   * sources — it's purely a template-author hint. Falls back to
   * `step.name` in `{{label}}` when undefined.
   */
  label?: string;

  /**
   * Optional override for the boundary *after* this step (ignored for
   * last step and for {@link intermediate} steps).
   */
  transitionToNext?: MosaicPipelineTransition;

  /**
   * When `true`, this step renders for `durationMs` but is **excluded
   * from the pipeline's output**:
   *
   * - **Not concatenated** into the pipeline's final output under
   *   `emit: "single"`.
   * - **Not exposed** as a per-step file under `emit: "multi"`.
   * - **Does not contribute** to the pipeline's total concat
   *   duration. (Internal step durations are independent.)
   * - `transitionToNext` is **ignored** on intermediate steps — they
   *   don't participate in the concat chain.
   *
   * Use case: defining a canonical intermediate render that later
   * steps reference via {@link MosaicRefSource}. The step acts like a
   * "let binding" or "scratch variable" — it produces a workspace
   * file with a specific canvas / format that downstream cells can
   * mirror, without itself being a visible part of the output.
   *
   * Example: a 5s "header strip" rendered at 1920×80 that gets
   * referenced into the top of each subsequent main step. The header
   * isn't its own scene; it's content other scenes share.
   *
   * Constraints:
   *
   * - At least one step in a pipeline must be non-intermediate
   *   (otherwise there's nothing to output). The engine emits
   *   `PIPELINE_NO_OUTPUT_STEPS` when every step is intermediate.
   * - Intermediate steps still participate in the back-edge
   *   invariant for refs — later steps may ref into them via
   *   `MosaicRefSource.stepIndex`. Earlier steps may not.
   *
   * Default: `false` (the step's render contributes to output, as
   * before).
   */
  intermediate?: boolean;
};

/**
 * One time-ordered render step inside a pipeline.
 *
 * A step may be provided inline (`file`) or by reference (`ref`).
 * Only one is allowed.
 *
 * - `file`: the full MosaicDocument payload is embedded in the pipeline JSON.
 * - `ref`: an external identifier resolved by the caller (path, templateId, etc.).
 */
export type MosaicPipelineStep =
  | (MosaicPipelineStepBase & { file: MosaicDocument; ref?: never })
  | (MosaicPipelineStepBase & { ref: string; file?: never });

/**
 * A MosaicDocumentPipeline (a `.mosaic` file with
 * `kind: "mosaic_pipeline"`) composes multiple renderables over
 * time.
 *
 * Unlike {@link MosaicDocument} (purely spatial), a pipeline is
 * **temporal**: it renders each step to an intermediate clip, then
 * stitches them into a single output via the selected transition
 * strategy.
 *
 * The pipeline itself has no `m0` layout; each step supplies its own.
 *
 * # Shape (post-redesign)
 *
 * - `steps`        — ordered time slices, each carrying a MosaicDocument
 *                    (inline `file`) or a `ref`.
 * - `size` / `fps` / `durationMs` / `target` / `format` / `audio` /
 *   `color` / `metadata` / `backgroundColor` — pipeline-level output
 *                    knobs. In `emit: "single"` mode they govern the
 *                    concatenated output. In `emit: "multi"` mode the
 *                    canvas/fps/duration knobs are mostly inert (each
 *                    step's own canvas wins) but `encodes` still
 *                    applies per emitted file.
 * - `emit`         — `"single"` (default, concat) or `"multi"` (each
 *                    output-step is its own file).
 * - `encodes`      — optional map of post-process transcode passes.
 * - `meta`         — authoring header.
 *
 * # Top-level vs. nested behavior
 *
 * **Top-level pipelines** render every step at its declared
 * `step.durationMs` and concat (or emit per-file under `emit:
 * "multi"`). Steps marked `intermediate: true` render but are
 * excluded from the output — they act as ref-source backing for
 * later steps.
 *
 * For top-level `emit: "single"`, the engine resolves the **pipeline
 * output canvas** with this precedence:
 *
 *   1. Explicit {@link size} on the pipeline (template intent).
 *   2. Otherwise: **element-wise max** of each step's `file.size` —
 *      the largest width × largest height. Lossless: no step is
 *      downscaled; smaller variants letterbox up via `placement:
 *      "contain"`.
 *   3. Otherwise (no steps declare a canvas): engine default /
 *      CLI flags.
 *
 * Duration does NOT follow the same pattern — it is a two-stage
 * model, because a pipeline's length is emergent rather than declared:
 *
 *   1. **Natural duration** — `Σ output-step durationMs − Σ transition
 *      overlaps`. This is what the stitch produces and it is never
 *      overridden. Note the overlap term: a plain sum of
 *      `step.durationMs` is only correct when every boundary is a cut.
 *   2. **Fit** — if {@link durationMs} is set and differs, the
 *      FLATTENED result is fit to it per {@link durationFit}. Steps are
 *      never re-timed; the pipeline renders naturally and the single
 *      resulting clip is then trimmed or filled.
 *
 * Under `emit: "multi"` no pipeline-level canvas resolution is
 * needed — each step emits its own file at its own step's canvas, and
 * {@link durationMs} is inert (there is no flattened result to fit).
 *
 * **Nested pipelines** (those appearing in a parent document's
 * `children` map) must produce exactly one clip for the parent slot.
 * Two collapse rules apply:
 *
 * 1. **Duration: flatten, then fit.** The child renders every step at
 *    its own `durationMs` and stitches to its natural duration — the
 *    parent slot's effective duration `T` does NOT reach inside the
 *    child. The stitched clip is then fit into the slot by the
 *    embedding source's ordinary
 *    {@link MosaicPlaybackProps.loopMode} (`"loop"` / `"freeze"` /
 *    `"cut"`; default `"loop"`), exactly as any other video source
 *    would be. {@link durationMs} is the same fit for a pipeline with
 *    no parent slot to supply `T`.
 *
 * 2. **Canvas / format collapse.** A nested pipeline is always
 *    inside a parent slot, and the parent slot always provides a
 *    canvas — so the **parent slot's canvas wins** for every step.
 *    Each step is rendered into that canvas using its own placement
 *    rules. Per-step `outputs` declarations (canvas, codec,
 *    pixelFormat) are overridden under nesting; the format follows
 *    the parent's effective format. Heterogeneous-output pipelines
 *    (e.g., desktop + mobile variants) work at top level under
 *    `emit: "multi"`; under nesting the per-step variants are
 *    unused.
 *
 * Nested pipelines silently downgrade `emit: "multi"` to `"single"`
 * (`PIPELINE_EMIT_MULTI_DOWNGRADED` warning) and emit
 * `PIPELINE_NESTED_CANVAS_COLLAPSED` when nested step dimensions are
 * overridden.
 *
 * See {@link MosaicOutputEmit} for the full nested-behavior
 * specification.
 */
export type MosaicDocumentPipeline = {
  /** Discriminator for the pipeline format. */
  kind: "mosaic_pipeline";

  /** Schema version for forwards-compatible decoding. */
  version: 1;

  /**
   * Creation timestamp. Same lifecycle as
   * {@link MosaicDocument.created} — stamped at save time, never by
   * templates.
   */
  created?: string;

  /** Writer name. See {@link MosaicDocument.app}. */
  app?: string | null;

  /** Writer version. See {@link MosaicDocument.appVersion}. */
  appVersion?: string | null;

  /**
   * User-authored content metadata. See {@link MosaicDocument.meta}.
   */
  meta?: MosaicFileMeta;

  /** Ordered list of steps that make up the final output. */
  steps: MosaicPipelineStep[];

  /**
   * Transition applied between steps.
   *
   * If omitted, default is `{ type: "cut" }` (hard boundary). In v1,
   * treat this as a global default for all boundaries.
   */
  defaultTransition?: MosaicPipelineTransition;

  /**
   * Pipeline-level output canvas. In `emit: "single"` mode, this is
   * the canvas the concatenated output renders at (overrides the
   * element-wise-max-of-steps default). In `emit: "multi"` mode,
   * mostly inert — each step's own canvas wins.
   */
  size?: { width: number; height: number };

  /** Pipeline-level frame rate. Same emit-mode semantics as {@link size}. */
  fps?: number;

  /**
   * A self-declared **slot duration** for the flattened output
   * (`emit: "single"`). Inert under `emit: "multi"`.
   *
   * This does not re-time the pipeline. Steps always render at their
   * own `durationMs` and stitch to the pipeline's natural length
   * (`Σ output steps − Σ transition overlaps`); the single flattened
   * clip is THEN fit to this value per {@link durationFit}:
   *
   * - shorter than natural — trimmed at the tail (all fit modes);
   * - longer than natural — filled per {@link durationFit}.
   *
   * When omitted, the natural duration stands. Templates normally have
   * this stamped to the natural duration at write time, so the fit is
   * a no-op; it earns its keep when a composed pipeline is flattened
   * and then placed into a different time budget.
   *
   * Must be a positive integer number of milliseconds — the engine
   * rejects anything else with `PIPELINE_DURATION_INVALID` and renders
   * the natural duration.
   */
  durationMs?: number;

  /**
   * How a {@link durationMs} LONGER than the pipeline's natural
   * duration gets filled. Defaults to `"loop"` — the same default a
   * nested pipeline gets from its embedding source's
   * {@link MosaicPlaybackProps.loopMode}, so a pipeline fits the same
   * way whether its target duration comes from a parent slot or from
   * its own declaration.
   *
   * - `"loop"` — repeat the flattened output until the slot is full.
   * - `"freeze"` — hold the final frame for the remainder.
   * - `"cut"` — do not fill; render the natural duration and emit
   *   `PIPELINE_DURATION_UNDERRUN`.
   *
   * Inert when `durationMs` is absent, equal to, or shorter than the
   * natural duration (shortening always trims the tail).
   */
  durationFit?: LoopMode;

  /** Pipeline-level target preset (e.g. `"web-mp4"`). */
  target?: MosaicOutputTarget;

  /** Container / codec / pixel-format / encoder-tuning knobs. */
  format?: MosaicOutputFormat;

  /** Audio-stream knobs. */
  audio?: MosaicAudioConfig;

  /** Color tagging. */
  color?: MosaicColorConfig;

  /** Container metadata atoms. */
  metadata?: MosaicContainerMetadata;

  /** Canvas background fill. */
  backgroundColor?: MosaicColor;

  /** Baked background image, painted beneath all sources. */
  backgroundImage?: MosaicBackgroundImage;

  /**
   * Emission mode (top-level pipelines only; silently downgraded to
   * `"single"` when nested). Default `"single"`. See
   * {@link MosaicOutputEmit}.
   */
  emit?: MosaicOutputEmit;

  /**
   * Multi-encode passes. Under `emit: "single"`, applied to the one
   * concatenated output. Under `emit: "multi"`, applied to **each**
   * emitted step file (each step file → N encoded variants). See
   * {@link MosaicOutputEncode}.
   */
  encodes?: Record<string, MosaicOutputEncode>;

  /**
   * Pipeline-level initial bindings for back-edge variables.
   *
   * **Map keys must match {@link STRICT_IDENTIFIER_PATTERN}** — same
   * tier as {@link MosaicDocument.variables}. Values are opaque JSON.
   *
   * Available to every step's
   * {@link MosaicEngineContext.upstreamVariables} as the seed; each
   * step then publishes its own that accumulate (last write wins)
   * for subsequent steps.
   *
   * See {@link MosaicDocument.variables} for the full back-edge
   * read semantics and the tier-aware determinism rule.
   *
   * Engine wiring deferred (see plan D9).
   */
  variables?: Record<string, unknown>;

  /**
   * Pipeline-level sidecars — structured-data files delivered to
   * the end user alongside the pipeline's rendered output(s).
   *
   * **Map keys must match {@link STRICT_IDENTIFIER_PATTERN}** —
   * same tier as {@link MosaicDocument.sidecars}, because each key
   * becomes a filename component (`{output-basename}.{sidecar-key}.json`).
   *
   * Same on-disk semantics as {@link MosaicDocument.sidecars}:
   * each key becomes its own JSON file next to the rendered output
   * (`{output-basename}.{sidecar-key}.json`).
   *
   * Pipeline-level sidecars are typically render-summary data —
   * the list of steps run, total duration, top-level audit info —
   * while per-step sidecars on each step's `file.sidecars` live
   * alongside that step's individual output.
   *
   * Engine wiring deferred (see plan D9). See
   * {@link MosaicDocument.sidecars} for the full contract.
   */
  sidecars?: Record<string, unknown>;

  /**
   * Editor-only metadata. Ignored by engine/rendering. See
   * {@link MosaicDocument.editor}.
   */
  editor?: MosaicRenderableEditorMeta;

  /**
   * Engine-only metadata. Ignored by editor/UI. See
   * {@link MosaicDocument.engine}.
   */
  engine?: MosaicEngineMeta;
};

/** Runtime type guard. */
export const isPipelineFile = (x: any): x is MosaicDocumentPipeline =>
  x?.kind === "mosaic_pipeline";

/**
 * Runtime type guard for EITHER pipeline root — resolved
 * (`mosaic_pipeline`) or source form (`mosaicx_pipeline`).
 *
 * Use this when the question is STRUCTURAL — "does this file have `steps`?"
 * — as spatial/preview code asks. Use {@link isPipelineFile} when the answer
 * must guarantee the pipeline is RESOLVED: it narrows to
 * `MosaicDocumentPipeline`, and engine-bound paths rely on that to reject
 * unresolved `template_invocation` sources.
 *
 * Introduced because `mosaicx_pipeline` failed `isPipelineFile`, so preview
 * code fell past its pipeline branch, past its document branch, and out the
 * bottom as `FLATTEN_HERO_UNKNOWN_KIND` — a chain file loaded fine and then
 * rendered an empty stage.
 */
export const isAnyPipelineFile = (
  x: any,
): x is MosaicDocumentPipeline | MosaicXPipeline =>
  x?.kind === "mosaic_pipeline" || x?.kind === "mosaicx_pipeline";
