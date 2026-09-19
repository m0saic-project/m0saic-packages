import type { AssetId } from "../asset";
import type { MosaicColor } from "../colors/mosaicColor";
import type { MosaicBackgroundImage } from "../document/document";
import type { AliasId, FlattenedStableKey, TemplateId } from "../identifiers";
import type { MosaicLanguageCode } from "../language";
import { type MosaicMediaKind } from "../source";
import type { MosaicAudioConfig } from "../output/audio-config";
import type { MosaicColorConfig } from "../output/color-config";
import type { MosaicContainerMetadata } from "../output/container-metadata";
import type { MosaicOutputFormat } from "../output/format";
import type { MosaicOutput } from "../output/output";
import type { MosaicOutputTarget } from "../output/target";
import type { MosaicTelemetrySink } from "../telemetry/sink";
import type { MosaicSecretResolver } from "../secrets/secrets";
import type { MosaicConnectionResolver } from "../host-connections/host-connections";
import type { LuminanceBucket, RegionPctRect } from "../luminance/LuminanceBucket";

// ---------------------------------------------------------------------------
// On-demand media analysis (ctx.analysis)
// ---------------------------------------------------------------------------

/** Result of {@link MosaicMediaAnalysis.regionLuminance}. */
export type MosaicRegionLuminanceResult = {
  /** Time-bucketed average luma (0..255) of the region. One bucket for stills. */
  buckets: LuminanceBucket[];
  /** Whole-duration average luma of the region (0..255). */
  overallAvgLuma: number;
  /** Analyzed duration, ms (0 for stills). */
  durationMs: number;
};

/**
 * On-demand media analysis the ENGINE performs for a template — the
 * lazy, deeper sibling of `ctx.media` (which the host probes eagerly
 * with ffprobe). Templates PULL the analysis they actually need
 * instead of hosts pushing feature-specific props; the engine mediates
 * the spawn, so results stay deterministic for fixed inputs and no
 * template runs its own IO.
 *
 * Available to every capability tier (it reads only media the user
 * already declared). ABSENT in `mode: "design"` (previews must never
 * spawn analysis passes) and on hosts without a toolchain — templates
 * must degrade gracefully when it's missing.
 */
export type MosaicMediaAnalysis = {
  /**
   * Average luminance of a fractional region of a declared input over
   * time (ffmpeg `crop` + `signalstats`, decode-only). `mediaPath` is
   * the same raw key `ctx.media` uses.
   */
  regionLuminance(
    mediaPath: string,
    region: RegionPctRect,
    opts?: { bucketMs?: number; smoothingMs?: number },
  ): Promise<MosaicRegionLuminanceResult>;

  /**
   * Per-cell average luminance of a declared input, integrated over
   * every sampled frame: the video is area-downsampled to a
   * `cols × rows` grid (`scale=COLS:ROWS:flags=area,format=gray`) and
   * each cell's byte is averaged across frames. The forensic-watermark
   * family's one shared filtergraph — the embed side probes the SOURCE
   * with it, the verify side samples the DELIVERED copy with it, and
   * baseline subtraction only works because both ran the same chain.
   *
   * Optional on the type so hand-built analysis fakes stay valid;
   * `createEngineContext` always attaches it alongside `regionLuminance`.
   */
  cellLuminance?(
    mediaPath: string,
    opts: MosaicCellLuminanceOpts,
  ): Promise<MosaicCellLuminanceResult>;
};

/** Options for {@link MosaicMediaAnalysis.cellLuminance}. */
export type MosaicCellLuminanceOpts = {
  /** Cells along width. */
  cols: number;
  /** Cells along height. */
  rows: number;
  /**
   * Sample only this pixel rectangle of the (decoded) frame — applied
   * FIRST. The verify side uses it to skip letterbox / pillarbox bars a
   * platform padded onto a delivered copy, so the cells line up with the
   * content the mark was embedded over.
   */
  crop?: { x: number; y: number; width: number; height: number };
  /**
   * Reproduce the render pipeline's cover-fit ahead of the cell grid:
   * `scale=W:H:force_original_aspect_ratio=increase,crop=W:H`. Set it to
   * the canvas the input will be composited onto so cells line up with
   * the pixels that actually render; omit to sample the file as-is.
   */
  coverTo?: { width: number; height: number };
  /**
   * Hold the last frame out to `durationMs` (`tpad=stop_mode=clone`) —
   * what the render pipeline does when the requested duration outlasts
   * the source. Requires `durationMs`.
   */
  holdLastFrame?: boolean;
  /** Pin the sampled frame rate (`-r`). Omit to take the file's own. */
  fps?: number;
  /** Pin the sampled duration (`-t`). Omit to read the whole file. */
  durationMs?: number;
};

/** Result of {@link MosaicMediaAnalysis.cellLuminance}. */
export type MosaicCellLuminanceResult = {
  /** Per-cell average luminance (0–255), row-major, length `cols * rows`. */
  luminanceGrid: number[];
  /** Frames the average was computed over. */
  frameCount: number;
};

// ---------------------------------------------------------------------------
// Structured ffprobe sub-objects
// ---------------------------------------------------------------------------

export type MosaicFormatInfo = {
  formatName?: string;
  formatLongName?: string;
  sizeBytes?: number;
  bitRate?: number;
  startTimeMs?: number;
  probeScore?: number;
  nbStreams?: number;
  nbPrograms?: number;
  tags?: Record<string, string | undefined>;
};

export type MosaicVideoStreamInfo = {
  codecName?: string;
  codecLongName?: string;
  profile?: string;
  level?: number;
  pixFmt?: string;
  colorSpace?: string;
  colorRange?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
  fieldOrder?: string;
  sar?: string;
  dar?: string;
  codedWidth?: number;
  codedHeight?: number;
  rotationDeg?: number;
  streamIndex?: number;
  bitRate?: number;
  avgFrameRate?: number;
  rFrameRate?: number;
  timeBase?: string;
  tags?: Record<string, string | undefined>;
};

export type MosaicAudioStreamInfo = {
  codecName?: string;
  codecLongName?: string;
  profile?: string;
  sampleRate?: number;
  channels?: number;
  channelLayout?: string;
  sampleFmt?: string;
  bitRate?: number;
  streamIndex?: number;
  timeBase?: string;
  tags?: Record<string, string | undefined>;
};

export type MosaicChapterInfo = {
  id: number;
  startMs: number;
  endMs: number;
  tags?: Record<string, string | undefined>;
};

export type MosaicProgramInfo = {
  programId: number;
  nbStreams: number;
  tags?: Record<string, string | undefined>;
};

// ---------------------------------------------------------------------------
// Subtitle streams (text-based codecs only in v1: subrip/ass/ssa/mov_text/webvtt;
// bitmap codecs surface stream info with cues:[])
// ---------------------------------------------------------------------------

export type MosaicSubtitleCue = {
  /** Cue start time in milliseconds from start of stream. */
  startMs: number;
  /** Cue end time in milliseconds from start of stream. */
  endMs: number;
  /** Decoded cue text. May contain embedded newlines for multi-line cues. */
  text: string;
};

export type MosaicSubtitleStreamInfo = {
  streamIndex: number;
  /** ffprobe codec_name (e.g. "subrip", "ass", "mov_text", "webvtt", "dvd_subtitle"). */
  codecName?: string;
  /** ffprobe codec_long_name when available. */
  codecLongName?: string;
  /**
   * Raw language tag from the stream — typically ISO 639-2/B 3-letter
   * (e.g. `"eng"`) but may arrive as 2-letter or with locale suffix.
   * Use `normalizeLanguageCode` from `@m0saic/platform/language` before
   * comparing. See {@link MosaicLanguageCode}.
   */
  language?: MosaicLanguageCode;
  /** Optional human title from stream tags.title. */
  title?: string;
  /** True when ffprobe disposition flags include `default`. */
  default?: boolean;
  /** True when ffprobe disposition flags include `forced`. */
  forced?: boolean;
  /** Full stream-level tags merged in (language/title duplicated above for convenience). */
  tags?: Record<string, string | undefined>;
};

export type MosaicSubtitleTrack = {
  stream: MosaicSubtitleStreamInfo;
  /** Decoded cues. Empty when the stream is a bitmap codec or when extraction failed. */
  cues: MosaicSubtitleCue[];
};

// ---------------------------------------------------------------------------
// Main metadata type
// ---------------------------------------------------------------------------

export type MosaicMediaMetadata = {
  /** "video" | "image" | "audio" | "unknown" */
  kind: MosaicMediaKind | "unknown";

  /** pixel dimensions */
  width: number;
  height: number;

  /** True if the file contains at least one video stream */
  hasVideo: boolean;
  /** True if the file contains at least one audio stream */
  hasAudio: boolean;

  /** Duration in ms if available */
  durationMs?: number;

  /** fps if present (video only). Useful for playlist timing */
  fps?: number;

  /** Original filename (not path) */
  originalFileName?: string;

  /** Merged tags from format + video + audio streams */
  tags?: Record<string, string | undefined>;

  /** Raw ffprobe run if advanced templates want it */
  rawProbe?: unknown;

  // -- Structured sub-objects --
  format?: MosaicFormatInfo;
  video?: MosaicVideoStreamInfo;
  audio?: MosaicAudioStreamInfo;
  chapters?: MosaicChapterInfo[];
  programs?: MosaicProgramInfo[];
  /**
   * Subtitle tracks discovered in the file. Text-based codecs
   * (subrip/ass/ssa/mov_text/webvtt) have populated `cues`; bitmap
   * codecs (PGS, DVD) surface only the stream info with `cues: []`.
   * Undefined when the file has no subtitle streams.
   */
  subtitles?: MosaicSubtitleTrack[];
};

export type MosaicMediaRegistry = Record<AssetId, MosaicMediaMetadata>;

/**
 * Final, authoritative output context surfaced to every template's
 * `render(props, ctx)` call.
 *
 * # What this represents
 *
 * The fully resolved output envelope for the current render job.
 * By the time a template runs, every authoring-tier input has been
 * collapsed into these fields (highest precedence first):
 *
 *   1. **User intent** — CLI flags plus `.m0v` defaults, assembled
 *      by the CLI before plan-build (CLI flags > `.m0v` within this
 *      tier). Available raw on {@link MosaicEngineContext.userIntent}.
 *   2. **Template intent** — the flat output fields (`size`, `fps`,
 *      `durationMs`, `target`, `format`, `audio`, `color`,
 *      `metadata`, `backgroundColor`) written directly on the doc
 *      or pipeline by the template's `render()`.
 *   3. **Engine default** — target preset resolution followed by
 *      hardcoded engine defaults.
 *
 * Templates should treat this as the **single source of truth** for
 * "what am I rendering for?" — no need to re-derive from doc fields
 * or re-merge any layer. The engine has done that work.
 *
 * See the internal rendering-model-contract notes
 * (rule 5) for the full precedence-ladder contract.
 *
 * # Use cases
 *
 * Templates branch on resolved fields to adapt their render:
 *
 * - **Alpha awareness**: read `format.pixelFormat` to decide
 *   between transparent layers vs. solid-fill fallback.
 * - **Codec-adaptive content**: branch on `target === "animated-gif"`
 *   or `target === "image-png"` to render a poster frame instead of
 *   a full timeline.
 * - **Audio-skipped overlays**: `audio?.mode === "off"` →
 *   skip SFX overlay step entirely.
 * - **HDR-aware grading**: `color?.colorTransfer === "smpte2084"`
 *   → apply PQ-aware tonemap pre-encode.
 * - **Canvas-aligned compositing**: read `backgroundColor` to
 *   match the canvas fill instead of guessing.
 *
 * # Nested templates
 *
 * For nested template renders (a child template inside a parent
 * doc's `children`), `ctx.output` describes the **top-level**
 * render envelope (the parent's authoritative output) — codec,
 * format, color tagging are per-job decisions that don't change
 * for nested cells. The current template's **slot dimensions** are
 * on `ctx.target` (which may differ from `ctx.output.width/height`).
 */
export type MosaicEngineOutputContext = {
  /** Final pixel resolution chosen by the engine or user. */
  width: number;
  height: number;

  /** Final, authoritative output FPS. */
  fps: number;

  /** Final, authoritative output duration in milliseconds. */
  durationMs: number;

  /**
   * Absolute path to the engine-managed workspace directory for this render.
   * Created by the CLI before template rendering begins.
   */
  workspaceDir: string;

  /**
   * Resolved output target preset (e.g. `"web-mp4"`, `"alpha-mov"`,
   * `"image-png"`). Undefined when CLI flags drove the render without
   * picking a preset (rare — usually the engine fills in
   * `DEFAULT_OUTPUT_TARGET`).
   *
   * Templates branch on this when behavior differs by target kind
   * (animated-gif → simplify palette; image-* → render poster frame).
   */
  target?: MosaicOutputTarget;

  /**
   * Resolved format envelope — container, codec, pixel format,
   * encoder knobs. Post-resolution: target preset filled in absent
   * fields, then doc/.m0v/CLI overrides applied per leaf.
   *
   * Templates read `format.pixelFormat` for alpha awareness,
   * `format.container` for container-specific behaviors,
   * `format.videoCodec` for codec-specific encoding paths.
   */
  format?: MosaicOutputFormat;

  /**
   * Resolved audio config. `audio.mode === "off"` when the
   * target has no audio stream (image targets, silent renders).
   *
   * Templates skip audio-only work paths when this signals no audio.
   */
  audio?: MosaicAudioConfig;

  /**
   * Resolved color tagging (space, range, primaries, transfer).
   *
   * Templates rendering for HDR pipelines branch on `colorTransfer`
   * to apply target-appropriate tonemapping.
   */
  color?: MosaicColorConfig;

  /**
   * Resolved container metadata atoms (title, author, copyright,
   * comment, encoder). Mostly informational for templates — useful
   * if a template wants to surface the brand's copyright in a
   * visible watermark layer, for example.
   */
  metadata?: MosaicContainerMetadata;

  /**
   * Resolved canvas background fill — what the engine paints under
   * sources that don't cover the full frame.
   *
   * Templates that composite custom backgrounds read this to align
   * their visuals with the canvas color (e.g., gradient anchored to
   * the brand's background hue instead of a guessed black).
   */
  backgroundColor?: MosaicColor;

  /**
   * Resolved baked background image painted beneath all sources (on
   * top of `backgroundColor`). Sibling to `backgroundColor`; templates
   * read it to align foreground content with a baked reference.
   */
  backgroundImage?: MosaicBackgroundImage;
};

export type MosaicRenderTarget = {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
};

/**
 * Raw user-tier intent surfaced to templates BEFORE engine resolution.
 *
 * Contains values the user supplied via CLI flags merged with `.m0v`
 * defaults (CLI flags > `.m0v` within this tier). The CLI assembles
 * this before plan-build; templates never see `.m0v` directly.
 *
 * # Why this exists separately from {@link MosaicEngineOutputContext}
 *
 * `ctx.output` is the fully resolved envelope (User > Template >
 * Engine default). For single-output cases that's all a template
 * needs — render at `ctx.output.width × ctx.output.height` and stop.
 *
 * For **multi-output** cases (rule 6 of the rendering-model
 * contract), the template emits multiple outputs and decides how to
 * apply user intent to each. The template needs to read raw user
 * intent — what did the user *actually ask for*? — distinct from
 * the resolved values. This field surfaces that.
 *
 * # Empty / undefined
 *
 * Fields that the user did not supply are simply absent.
 * `userIntent` itself may be undefined when the engine is invoked
 * without a User tier (e.g. internal tooling that bypasses the
 * CLI). Templates that care must use `?.` access.
 *
 * # Exact-override path (rule 7)
 *
 * When `userIntent.requestedOutputs.length === outputStepCount` on
 * a pipeline, the engine treats the request as a positional
 * per-step override and skips template-driven output mapping. The
 * template surfaces `userIntent.requestedOutputs` to address its
 * own outputs by name (e.g. `step.name`).
 *
 * See the internal rendering-model-contract notes
 * (rules 6, 7, 12) for the full contract.
 */
export type MosaicEngineUserIntent = {
  /** Width in pixels if the user supplied one. */
  width?: number;
  /** Height in pixels if the user supplied one. */
  height?: number;
  /** Frame rate if the user supplied one. */
  fps?: number;
  /** Duration in milliseconds if the user supplied one. */
  durationMs?: number;
  /** Partial output-format knobs the user supplied (codec, container, etc.). */
  format?: Partial<MosaicOutputFormat>;
  /**
   * Named output bundles the user supplied (typically loaded by the
   * CLI from a `.m0v` file). The map's keys are the user-supplied
   * names; the values carry full `MosaicOutput` bundles — size, fps,
   * durationMs, target, format, audio, color, metadata,
   * backgroundColor, encodes.
   *
   * # Two distinct use cases (one map, two consumers)
   *
   * 1. **Template-consultative** — a template reads named entries
   *    here (e.g. `outputs.desktop`, `outputs.mobile`) to decide its
   *    structure and per-step settings BEFORE producing its
   *    renderable. The template's API contract should document
   *    which keys it consults; if a key is absent the template
   *    falls back to its internal defaults.
   *
   * 2. **Post-render literal override** — after the template runs,
   *    the CLI merges these values onto the produced renderable
   *    BY INDEX when the entry count matches the renderable's
   *    output count (single doc → 1; `emit:"single"` → 1;
   *    `emit:"multi"` → N output-steps). Names are advisory only.
   *
   * # Rule 7 count signal
   *
   * The engine planner reads `Object.keys(outputs).length` as the
   * count signal for rule 7. When it equals the pipeline's
   * output-step count, the planner emits `OUTPUT_EXACT_OVERRIDE`
   * as an informational marker — the user has supplied as many
   * named bundles as the template produces output steps. Names that
   * don't match step names surface `OUTPUT_NAME_NOT_FOUND` warnings
   * (advisory; engine proceeds regardless).
   *
   * Both can fire in the same render — templates consult the map,
   * CLI merges the same map post-render. Templates should treat
   * the map as a suggestion, not a requirement.
   *
   * See the internal rendering-model-contract notes (rules 5/7)
   * for the precedence contract this participates in.
   */
  outputs?: Record<string, MosaicOutput>;
};

/**
 * Pipeline-step position info exposed to templates rendering inside
 * a {@link MosaicDocumentPipeline}.
 *
 * Lets producer templates self-stamp their step index when
 * publishing handoff data, so downstream consumers don't need to
 * know the producer's position via a separate pipeline-assembly
 * contract.
 *
 * # Scope
 *
 * Populated only when the current render is a step of a pipeline.
 * Undefined for top-level non-pipeline renders.
 *
 * For nested pipelines (a pipeline appearing inside a parent doc's
 * `children` map), this refers to the **innermost** containing
 * pipeline. A chain-style "all containing pipelines from inside
 * out" extension can be added additively later.
 */
export type MosaicPipelineStepContext = {
  /** 0-based position of this step in the containing pipeline. */
  index: number;

  /** Total step count in the containing pipeline. */
  total: number;

  /** Whether this step is marked `intermediate: true`. */
  intermediate: boolean;
};

// ─────────────────────────────────────────────────────────────────────
// Upstream reads — two views over the same back-edge data
// ─────────────────────────────────────────────────────────────────────
//
// Templates can read upstream-published variables through either of
// two parallel views on `MosaicEngineContext`:
//
//   • ctx.upstreamVariables  — flat union, `Record<string, unknown>`.
//                              One bag, last-write-wins on collisions.
//                              Ergonomic for the simple case.
//
//   • ctx.upstreamData       — namespaced view,
//                              `Record<alias, Record<string, unknown>>`.
//                              Outer key is the alias on a
//                              MosaicDataSource. Disambiguates
//                              overlapping keys across producers and
//                              gives editor UIs a stable handle for
//                              producer→consumer wiring lines.
//
// What contributes to which view:
//
//   ┌─────────────────────────────────────────┬──────┬────────────┐
//   │ Producer                                │ flat │ namespaced │
//   ├─────────────────────────────────────────┼──────┼────────────┤
//   │ MosaicDocument.variables (doc-level)    │  yes │     no     │
//   │ MosaicDocumentPipeline.variables (seed) │  yes │     no     │
//   │ MosaicDataSource (no alias)             │  yes │     no     │
//   │ MosaicDataSource { alias: "X", ... }    │  yes │ yes, as X  │
//   └─────────────────────────────────────────┴──────┴────────────┘
//
// Only aliased data sources get a namespaced bucket. The flat view
// is the universal merge; the namespaced view is opt-in by
// declaring an alias on a MosaicDataSource. Aliased producers
// contribute to BOTH views (their values still merge into the flat
// union under last-write-wins, AND show up under their alias).
//
// Typed reads: parameterize MosaicEngineContext<U, D> with narrower
// shapes; see the generics on the context type below.

/**
 * Base shape for the flat-union upstream-variables read
 * (`ctx.upstreamVariables`). Accumulates every upstream node's
 * `variables` keys; last-write-wins on collisions. See the
 * upstream-reads overview above for what contributes.
 */
export type MosaicTemplateUpstreamVariables = Record<string, unknown>;

/**
 * Base shape for the namespaced (by-alias) upstream-data read
 * (`ctx.upstreamData`). Outer key = a {@link MosaicDataSource}'s
 * declared `alias`; inner = that source's `variables`. Unaliased
 * data sources and doc/pipeline-level `variables` do not appear
 * here — they only contribute to the flat
 * {@link MosaicTemplateUpstreamVariables} union. See the
 * upstream-reads overview above.
 */
export type MosaicTemplateUpstreamData = Record<
  string,
  Record<string, unknown>
>;

/**
 * One engine-stamped upstream data publication (envelope + payload).
 *
 * The ordered {@link MosaicEngineContext.upstreamPublications} list is
 * the **lossless, collision-free, geometry-addressable** upstream
 * channel. {@link MosaicTemplateUpstreamVariables} (flat) and
 * {@link MosaicTemplateUpstreamData} (by-alias) remain the merged
 * conveniences over the same data; the publications list is the
 * canonical source when a consumer needs to disambiguate two producers
 * that published the same alias, or wants to select a producer by its
 * position in the layout rather than by an alias it had to know in
 * advance.
 *
 * # Two producers, one type
 *
 * - **Cross-tile** (sibling `template_invocation`s in a layout,
 *   threaded by `resolveMosaicx`): `tileStableKey` is the producing
 *   invocation's cell, `stepIndex` is the step inside that producer's
 *   pipeline (absent for single-doc producers), `templateId` is the
 *   producing template.
 * - **Cross-step** (earlier steps of a {@link MosaicDocumentPipeline},
 *   collected by the pipeline runner): `tileStableKey` is absent
 *   (a step is not a tile), `stepIndex` identifies the producing step.
 *
 * # Consumer lookup ladder
 *
 *  1. {@link upstreamData}`[alias]` — friendly alias (primary API).
 *  2. filter `upstreamPublications` by `tileStableKey` (+ optional
 *     `stepIndex`) — exact geometric selection.
 *  3. scan `upstreamPublications` in order and shape-sniff each
 *     `variables` — "find me anything of this shape upstream."
 */
export type MosaicUpstreamPublication = {
  /** The payload — the producing data source's `variables`, untouched. */
  variables: Record<string, unknown>;

  /** Friendly alias, when the producer declared one on its data source. */
  alias?: AliasId;

  /**
   * Geometric anchor: flattened stableKey of the producing
   * invocation's cell in the resolved parent doc — the same key a
   * {@link MosaicRefSource} would use to address that cell.
   *
   * Absent for non-tile contexts (e.g. intra-pipeline collection,
   * where the publication came from a step rather than a sibling
   * tile), or when the parent geometry could not be resolved.
   */
  tileStableKey?: FlattenedStableKey;

  /**
   * Step index within the producer's pipeline where the data source
   * sat. Absent when the producer returned a single
   * {@link MosaicDocument} (no pipeline).
   */
  stepIndex?: number;

  /**
   * Producing template id — engine-stamped from the invocation, never
   * trusted from the payload. Absent for cross-step publications
   * (a pipeline step carries no invocation-level template id here).
   */
  templateId?: TemplateId;
};

/**
 * Invocation mode for the current render context.
 *
 * Distinguishes "the engine is rendering a video to disk" from
 * "the editor is invoking this template at design time to populate
 * its UI" (e.g., a {@link MosaicTemplatePropControl.optionsFrom}
 * picker needs to call a capability-tier publisher to populate its
 * option list).
 *
 * Implications for capability-tier templates:
 * - `"render"` — the template is producing final output. Side
 *   effects (writes to disk via sidecars, full network fetches,
 *   anything user-visible) are expected.
 * - `"design"` — the template is providing data to the editor.
 *   Side effects that produce final-render artifacts must be
 *   suppressed; sidecar writes are noops; the host may cache
 *   results across re-invocations to keep the editor snappy.
 *
 * Implications for core-tier templates:
 * - Core-tier templates are deterministic, so the mode is
 *   informational rather than gating. They MAY use the mode to
 *   pick a faster preview path (e.g. skip expensive layout
 *   computation in `"design"`) but MUST produce equivalent
 *   outputs in both modes.
 */
export type MosaicEngineMode = "render" | "design";

/**
 * Global engine-level context exposed to all templates.
 *
 * Generic in `U` (flat upstream-variables shape) and `D`
 * (namespaced upstream-data shape). Defaults preserve existing
 * single-arg `MosaicEngineContext` usage at call sites that don't
 * care about variable typing.
 */
export type MosaicEngineContext<
  U extends MosaicTemplateUpstreamVariables = MosaicTemplateUpstreamVariables,
  D extends MosaicTemplateUpstreamData = MosaicTemplateUpstreamData,
> = {
  /**
   * What kind of invocation this is — actual render vs editor
   * design-time data fetch. See {@link MosaicEngineMode}.
   *
   * Capability-tier templates MUST gate side-effect-producing
   * behavior on this field (no sidecar writes, no final-output
   * artifacts in `"design"`). Core-tier templates may ignore it.
   *
   * Defaults to `"render"` when the host does not explicitly set
   * it — preserves the historical "everything is a render"
   * assumption for code paths that pre-date this field.
   */
  mode: MosaicEngineMode;

  /** Final, authoritative output/render target info. Equal to target for the top level template */
  output: MosaicEngineOutputContext;

  /**
   * The current template's render canvas — `{width, height, fps,
   * durationMs}`. For top-level renders this equals the
   * corresponding fields of {@link output}. **Under nested
   * rendering**, when the parent supplies a `slot` to
   * `renderNestedTemplate`, this field carries the slot dimensions
   * so the child can render adaptively (pixel-aware effects, text
   * sizing, etc.).
   *
   * Templates that don't care about slot dimensions can still read
   * `target.{width,height}` — they'll just get the same values the
   * parent saw when the parent didn't pass a `slot`.
   */
  target: MosaicRenderTarget;

  /**
   * Raw user-tier intent (CLI flags + `.m0v` defaults, assembled by
   * the CLI) BEFORE engine resolution into {@link output}. Templates
   * doing multi-output preset-mapping read this; single-output
   * templates can ignore it and read {@link output} directly. See
   * {@link MosaicEngineUserIntent}.
   */
  userIntent?: MosaicEngineUserIntent;

  /**
   * ffprobe-derived metadata for all media sources, keyed by their source id.
   * e.g. "hero", "broll1", etc.
   */
  media: MosaicMediaRegistry;

  /**
   * On-demand media analysis (see {@link MosaicMediaAnalysis}).
   * Optional by design — absent in design mode and on hosts without a
   * toolchain; templates degrade gracefully.
   */
  analysis?: MosaicMediaAnalysis;

  /**
   * Pipeline-step position info — populated when this render is a
   * step of a {@link MosaicDocumentPipeline}. Undefined for
   * top-level non-pipeline renders.
   *
   * Producer templates that publish handoff data for downstream
   * consumers (e.g. a `flattenedStableKey` for a later step's
   * ref) should include `ctx.pipelineStep?.index` in their
   * published payload, so the consumer doesn't need a separate
   * out-of-band contract to know which step produced the value.
   *
   * See {@link MosaicPipelineStepContext} for the field shape and
   * nesting semantics.
   */
  pipelineStep?: MosaicPipelineStepContext;

  /**
   * Flat union of all `variables` published by **earlier pipeline
   * steps** — same back-edge invariant as {@link MosaicRefSource}.
   *
   * # Scope: pipeline boundaries only
   *
   * This field is the engine-threaded read channel for
   * cross-pipeline-step data flow. It is **not** the mechanism for
   * within-doc data flow — when one cell's template wants to pass
   * data to another cell's template inside the *same*
   * MosaicDocument, the parent template should use
   * `renderNestedTemplate` and forward the result in TypeScript
   * directly. See {@link MosaicDataSource} for the rationale.
   *
   * # Sources merged here (in evaluation order, last-write-wins)
   *
   *  - `MosaicDocumentPipeline.variables` (pipeline-level seed)
   *  - For each earlier step: `step.file.variables` (doc-level on
   *    that step's MosaicDocument)
   *  - For each earlier step: every `MosaicDataSource.variables`
   *    in that step's `sources` array (aliased or not)
   *
   * # Inside non-pipeline contexts
   *
   * When this render is *not* inside a pipeline, the field is
   * undefined / empty. Templates that read upstream data should
   * tolerate both the populated and the empty case
   * (`ctx.upstreamVariables?.foo`).
   *
   * Read-only. Engine wiring is deferred — pre-wiring this is
   * always undefined.
   */
  upstreamVariables?: Readonly<U>;

  /**
   * Namespaced view: pipeline-upstream variables grouped by the
   * `alias` declared on each producing {@link MosaicDataSource}.
   *
   * Same scope rules as {@link upstreamVariables} — pipeline
   * boundaries only.
   *
   * Doc/pipeline-level `variables` and unaliased
   * `MosaicDataSource`s do not appear here. They only contribute
   * to the flat {@link upstreamVariables} union; this field is
   * specifically for sources that declared a name.
   *
   * Engine wiring is deferred.
   */
  upstreamData?: Readonly<D>;

  /**
   * Ordered, lossless list of every upstream data publication visible
   * to this render — the geometry-addressable channel that
   * {@link upstreamVariables} / {@link upstreamData} merge from.
   *
   * Ordered by evaluation: for cross-tile threading, producer-tile
   * source order then step order; for cross-step collection, step
   * order. Each entry is a {@link MosaicUpstreamPublication} envelope
   * (payload + provenance stamp).
   *
   * Unlike the two merged views, this list is collision-free: two
   * producers that published the same alias appear as two distinct
   * entries, distinguishable by `tileStableKey` (and `stepIndex`).
   * Consumers that need exact producer selection — or that don't know
   * the producer's alias — read this list directly. See
   * {@link MosaicUpstreamPublication} for the consumer lookup ladder.
   *
   * Same scope rules as {@link upstreamVariables}: undefined / empty
   * when this render has no upstream producers.
   */
  upstreamPublications?: ReadonlyArray<MosaicUpstreamPublication>;

  /**
   * Telemetry sink for emit-site instrumentation. Optional — when
   * absent, {@link getTelemetry} (in `@m0saic/types/telemetry`)
   * returns a no-op sink so emit sites don't need optional-chaining.
   *
   * Phase 1 ships the type only; no engine code emits yet. Phase 2
   * threads emits at template / planner / runtime boundaries.
   *
   * The sink contract is sync, fire-and-forget. A sink that needs
   * to write to disk / send over IPC owns its own queue and never
   * blocks the producer.
   */
  telemetry?: MosaicTelemetrySink;

  /**
   * Resolver from opaque {@link SecretRef} strings to cleartext
   * secrets. Threaded by the host (CLI, Electron app, test harness).
   *
   * Templates that need an API key / OAuth token read it from a
   * `propRef`-style prop and call `ctx.secrets?.get(propRef)` at
   * render time. The `.mosaic` doc itself never carries the literal
   * secret — only the ref into the host's store.
   *
   * Undefined when the host hasn't supplied a resolver (e.g. core-tier
   * renders that don't need secrets, or a malformed setup). Capability
   * templates should error explicitly if they need a secret and
   * `ctx.secrets` is missing — silent fallback would mask config bugs.
   *
   * See `@m0saic/platform/secrets` for the canonical impls
   * (`envSecretResolver`, `keychainSecretResolver`).
   */
  secrets?: MosaicSecretResolver;

  /**
   * Resolver from {@link MosaicHostConnectionId} → registered
   * connection's non-secret field values. Threaded by the host (CLI,
   * Electron app, test harness) for any template that declares a
   * connection dependency.
   *
   * Returns `undefined` when the host has no value for that
   * connection (e.g., user hasn't configured it yet). Templates that
   * need the values should error explicitly rather than silently
   * fall back — the error path is the right place to tell the user
   * "go configure GitHub in Settings."
   *
   * Pairs with `ctx.secrets`: non-secret fields (URL, mode, plain
   * config) come back via this resolver; the host mints a
   * {@link SecretRef} for each `secret`-kind field and the template
   * reads those through `ctx.secrets.get(...)`. Maintains the
   * security-tier distinction at the call site.
   *
   * Implementations live in `@m0saic/platform/host-connections/*`.
   */
  connections?: MosaicConnectionResolver;
};
