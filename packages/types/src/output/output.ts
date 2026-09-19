import type { MosaicColor } from "../colors/mosaicColor";
import type { MosaicBackgroundImage } from "../document/document";
import type { MosaicAudioConfig } from "./audio-config";
import type { MosaicColorConfig } from "./color-config";
import type { MosaicContainerMetadata } from "./container-metadata";
import type { MosaicOutputFormat } from "./format";
import type { MosaicOutputTarget } from "./target";

/**
 * Bundle of output knobs that live **flat on
 * {@link MosaicDocument} and {@link MosaicDocumentPipeline}**.
 *
 * This is a parameter-passing convenience type, not a discrete
 * field on the doc. The doc carries each of these fields directly
 * (one geometry per doc, per the rendering-model contract). The
 * type exists so resolvers, normalizers, and CLI override-bakers
 * can pass the bundle around without listing every field.
 *
 * The contract pair `MosaicOutput` (this type) and
 * {@link MosaicOutputEncode}:
 *
 * - `MosaicOutput` — the output knobs for a render: size, fps,
 *   duration, target preset, format, audio, color, metadata,
 *   background. One render = one of these.
 * - `MosaicOutputEncode` — overrides for a post-process transcode
 *   pass. Inherits master fps/durationMs/target; may override
 *   format/codec, optionally scale.
 *
 * `MosaicOutput` does NOT include `emit` (pipeline-only, at the
 * top level) or `encodes` (top-level on doc/pipeline) — those are
 * sibling fields, not part of the render-config bundle.
 *
 * See the internal rendering-model-contract notes for
 * the full contract.
 */
export type MosaicOutput = {
  /** Output canvas in pixels. */
  size?: { width: number; height: number };

  /** Output frame rate. */
  fps?: number;

  /** Output duration in milliseconds. */
  durationMs?: number;

  /**
   * High-level named target preset (e.g. `"web-mp4"`,
   * `"alpha-mov"`, `"image-png"`). Resolves to concrete `format` /
   * `audio` / `color` defaults at engine time; per-field overrides
   * below win.
   */
  target?: MosaicOutputTarget;

  /** Container / codec / pixel-format / encoder-tuning knobs. */
  format?: MosaicOutputFormat;

  /** Audio-stream knobs (codec, bitrate, sample rate, channels). */
  audio?: MosaicAudioConfig;

  /** Color tagging (space, range, primaries, transfer). */
  color?: MosaicColorConfig;

  /** Container metadata atoms (title, author, copyright, …). */
  metadata?: MosaicContainerMetadata;

  /**
   * Canvas background fill when sources don't cover the full
   * frame (e.g., `fit: "contain"` letterboxing, transparent
   * media, padding). Accepts hex or any ffmpeg-compatible color
   * string.
   */
  backgroundColor?: MosaicColor;

  /**
   * Baked background image, painted beneath all sources (on top of
   * `backgroundColor`). See {@link MosaicBackgroundImage}.
   */
  backgroundImage?: MosaicBackgroundImage;
};

/**
 * Pipeline emission mode.
 *
 * Selects how a `MosaicDocumentPipeline` produces its final file(s):
 *
 * - `"single"` (default) — pipeline output-steps are rendered and
 *   then concatenated into one output file. Always valid; works at
 *   any nesting depth. Step geometries reconcile to the pipeline's
 *   output canvas (explicit `pipeline.size`, or element-wise max
 *   of step canvases as the default).
 * - `"multi"` — each output-step is exposed as its own file at its
 *   own step's geometry. The engine skips the final concat pass.
 *   **Top-level pipelines only.**
 *
 * # Top-level-only for `"multi"`
 *
 * The `"multi"` mode exists so a single pipeline can emit several
 * deliverables from one template invocation — the canonical example
 * is a "desktop + mobile" template where each pipeline step is its
 * own `MosaicDocument` with its own canvas size and format
 * declaration, and the user wants both files out of one render.
 *
 * A nested pipeline (one that appears in a parent document's
 * `children` map) must produce **exactly one clip** for the parent
 * slot — the parent's filtergraph needs a single input stream, not
 * N separate files. The engine silently downgrades nested
 * `"multi"` to `"single"` and emits a
 * `PIPELINE_EMIT_MULTI_DOWNGRADED` warning.
 *
 * # Nested pipeline duration negotiation (`"single"` mode)
 *
 * When a pipeline is nested, it must produce one clip for a parent
 * slot of effective duration `T`. The model is **flatten, then fit** —
 * `T` does not reach inside the child:
 *
 *   1. Render every step at its own `step.durationMs` and stitch, giving
 *      the child's NATURAL duration
 *      (`Σ output steps − Σ transition overlaps`).
 *   2. Fit that single clip into the slot using the embedding source's
 *      ordinary {@link MosaicPlaybackProps.loopMode}, exactly as for any
 *      other video source:
 *      - `"loop"`   — repeat the stitched clip to fill `T`
 *      - `"freeze"` — hold the final frame for the remainder
 *      - `"cut"`    — transparent for the remainder
 *      Default `loopMode` is `"loop"`. Longer-than-`T` clips trim at
 *      the tail under every mode.
 *
 * A pipeline at top level renders every step at its declared
 * `durationMs` and concats (or emits per-file under `"multi"`). It has
 * no parent slot to supply `T`, so it may declare its own via
 * `pipeline.durationMs` + `pipeline.durationFit` — the same fit, self-
 * declared.
 *
 * # Nested pipeline canvas collapse
 *
 * Per-step canvases are overridden under nesting; the parent slot's
 * canvas wins. The engine emits `PIPELINE_NESTED_CANVAS_COLLAPSED`
 * when nested step dimensions are overridden.
 *
 * See the internal rendering-model-contract notes (rules
 * 2 and 4) for the full contract.
 */
export type MosaicOutputEmit = "single" | "multi";
