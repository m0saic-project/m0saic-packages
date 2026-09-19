import type { M0String } from "@m0saic/dsl";
import type { AssetId, MosaicAssetManifest } from "../asset";
import type { MosaicColor } from "../colors/mosaicColor";
import type { MosaicDocumentPipeline } from "./document-pipeline";
import type { MosaicXDocument, MosaicXPipeline } from "./mosaicx-document";
import type {
  MosaicFileMeta,
  MosaicRenderableEditorMeta,
  MosaicEngineMeta,
} from "../meta";
import type { MosaicAudioConfig } from "../output/audio-config";
import type { MosaicColorConfig } from "../output/color-config";
import type { MosaicContainerMetadata } from "../output/container-metadata";
import type { MosaicOutputEncode } from "../output/encode";
import type { MosaicOutputFormat } from "../output/format";
import type { MosaicOutputTarget } from "../output/target";
import type { MosaicPlacementFit, MosaicSource } from "../source";

/**
 * A baked background image for a document — painted as the bottom layer,
 * beneath every source, on top of {@link MosaicDocument.backgroundColor}.
 *
 * Sibling to `backgroundColor`: where that fills empty canvas with a flat
 * colour, this composites a reference/base image. Useful for baking a render
 * behind a (transparent) wireframe, and for the agent protocol — an agent can
 * bake a reference background and build template chrome on top of it
 * section-by-section.
 */
export type MosaicBackgroundImage = {
  /** References `doc.assets[assetId]` — a `file` / `url` / `data-uri` image. */
  assetId: AssetId;
  /**
   * Opacity of the background image, 0..1. Default `1` (fully opaque). Lower
   * values ghost the reference (e.g. `0.3`) so foreground content reads over it.
   */
  opacity?: number;
  /**
   * How the image fills the canvas when its aspect differs. Default `"cover"`
   * (fill, cropping overflow). `"contain"` letterboxes against
   * `backgroundColor`.
   */
  fit?: MosaicPlacementFit;

  /**
   * Cover-crop anchor, horizontal (only meaningful with `fit:"cover"`).
   * 0..1: `0` keeps the left edge, `0.5` centers (default), `1` keeps the
   * right edge. Same semantics as `placement.focusX` on cover placement.
   */
  focusX?: number;

  /**
   * Cover-crop anchor, vertical (only meaningful with `fit:"cover"`).
   * 0..1: `0` keeps the top edge, `0.5` centers (default), `1` keeps the
   * bottom edge. Same semantics as `placement.focusY` on cover placement.
   */
  focusY?: number;
};

/**
 * A MosaicDocument (`.mosaic`) is the core renderable unit of the m0saic
 * engine.
 *
 * It is a **pure spatial description** of a single render pass: it
 * defines *where* tiles exist and *what* content fills them. Temporal
 * sequencing (cuts, fades, animations) is handled by
 * {@link MosaicDocumentPipeline}, which composes multiple documents.
 *
 * # Shape (post-redesign)
 *
 * - `m0`             — DSL string (spatial geometry).
 * - `assets`         — per-document asset manifest.
 * - `sources`        — tile content (hoisted from the legacy `config.sources`).
 * - `size` / `fps` / `durationMs` / `target` / `format` / `audio` /
 *   `color` / `metadata` / `backgroundColor` — output knobs for the
 *                      one render this doc describes (a `MosaicDocument`
 *                      has one `m0`, therefore one geometry). Template
 *                      intent; CLI overrides per-field from user flags
 *                      and `.m0v` before planning.
 * - `encodes`        — optional map of post-process transcode passes
 *                      (multi-encode = same master, N codec/container
 *                      variants).
 * - `children`       — nested renderables filling tile slots.
 * - `meta`           — authoring header (created/app/appVersion/title/...).
 * - `editor` / `engine` — non-semantic UI/engine metadata.
 */
export type MosaicDocument = {
  /** Discriminator for the file format. */
  kind: "mosaic_document";

  /** Schema version for forwards-compatible decoding. */
  version: 1;

  /**
   * Creation timestamp. UTC ISO 8601 with milliseconds + 'Z'.
   *
   * Stamped by the CLI / electron writer at save time. **Templates
   * must not set this** — wall-clock dependency violates determinism
   * (see the agent contract §9).
   *
   * Mirrors the same field on `M0File` / `M0cFile` / `M0pFile` /
   * `M0vFile` (file-lifecycle stamp).
   */
  created?: string;

  /** Writer name, e.g. `"m0saic-cli"`, `"m0saic-electron"`. */
  app?: string | null;

  /** Writer version. */
  appVersion?: string | null;

  /**
   * User-authored content metadata (`title`, `author`, `source`,
   * `note`). Distinct from {@link MosaicOutput.metadata} (container
   * atoms in the rendered output) and from the file-lifecycle stamps
   * above. See {@link MosaicFileMeta}.
   */
  meta?: MosaicFileMeta;

  /**
   * m0 DSL string defining the spatial layout.
   *
   * The DSL describes only geometry: rows, columns, zero-slots,
   * null-slots, and overlays. It does NOT describe media, timing, or
   * effects.
   *
   * Examples:
   *   "1"          → single tile
   *   "2(1,1)"     → two horizontal tiles
   *   "3[1,0,1]"   → three vertical slots with a zero-slot
   *   "1{1}"       → tile with overlay region
   */
  m0: M0String;

  /**
   * Per-document asset manifest.
   *
   * Maps opaque `AssetId` keys to `MosaicAsset` entries. Every
   * `MosaicMediaSource.assetId` and every `alpha-image` mask `assetId`
   * in this document (or in the layers below it) must resolve to an
   * entry here. Callers MUST go through `resolveAsset` in
   * `@m0saic/core` rather than read manifest entry fields directly —
   * the manifest is the boundary between the renderer and any concrete
   * file path / URL / data URI.
   *
   * On-disk asset kinds: `file`, `url`, `data-uri`. Entries of kind
   * `lavfi` or `node-output` are engine-synthesized at plan-build time
   * and MUST NOT appear in serialized JSON.
   *
   * # Authoring time: per-document, independent namespaces
   *
   * Each child mosaic owns its own `assets` map; nested manifests are
   * NOT merged at load time. A child template's `"logo"` assetId is
   * private to that child — it cannot collide with a parent or
   * sibling's `"logo"`.
   *
   * # Render time: flattened into one master manifest
   *
   * At plan-build time, `flattenMosaicDocument` (in
   * `@m0saic/platform/mosaic/flatten`) collapses the entire document
   * tree — including all nested `children` — into a single flat
   * MosaicDocument that the engine renders. This mirrors the m0 DSL
   * collapse: just as multiple per-child m0 strings get spliced into
   * one master m0 string, multiple per-child asset manifests get
   * merged into one master manifest.
   *
   * To avoid collisions across child namespaces, the flattener
   * **namespaces every child's asset keys** with prefixes (`c0_`,
   * `c1_`, `c2_`, …) and rewrites every `assetId` reference in the
   * spliced sources to match. So a child template's local
   * `"logo"` becomes `"c0_logo"` in the flattened parent's manifest
   * (and every `MosaicMediaSource.assetId` referencing it in the
   * flattened doc points at the namespaced key).
   *
   * This flatten step is also what makes
   * {@link MosaicRefSource.flattenedStableKey} resolvable across nested
   * children — the post-flatten root has a single unified keyspace
   * for both DSL stableKeys and asset ids. The engine never sees the
   * pre-flatten per-child manifests; it operates on the merged form.
   */
  assets: MosaicAssetManifest;

  /**
   * Per-cell labels keyed by **local** stableKey
   * ({@link STRICT_IDENTIFIER_PATTERN} tier).
   *
   * Engine-visible authoring metadata used by diagnostics
   * ("Cell `'hero'` missing source" beats "Cell `c0_xyz` missing
   * source"), ref/handoff payloads, and editor UIs (Make / Compose
   * wire-graph nodes labeled by intent).
   *
   * # Authoring sources (where labels come from)
   *
   * Labels are a general per-cell label channel. They can be
   * populated by any of:
   *
   *  - **Doc author inline** — write `labels: { hero: "..." }`
   *    directly on the doc.
   *  - **Template adoption** — a template that accepts a `.m0c`
   *    or `.m0p` input (props of type `"m0c"` / `"m0p"` — see
   *    {@link MosaicTemplatePropType}) typically forwards the
   *    loaded labels onto its returned doc via this field. A
   *    template can pick a specific `.m0p` variant and adopt that
   *    variant's labels. This is the canonical path for getting
   *    `.m0c`/`.m0p` content into a doc — the CLI/host loads the
   *    file and supplies it as a prop value; the template reads
   *    the labels from the prop and writes them to {@link labels}
   *    on its returned doc.
   *  - **Template generation** — a template can synthesize labels
   *    from its own logic, independent of any user input.
   *
   * # Flatten semantics
   *
   * Identical to `assets` and stableKeys themselves — child labels
   * get namespaced (`c0_intro`, `c1_outro`) and merged into the
   * parent's flattened label map. Each doc owns its OWN local
   * keyspace; parents never label child cells directly. Parent
   * labels for stableKeys that survive flatten are carried forward;
   * labels for slot-stableKeys that get replaced by child content
   * (e.g., a `mosaic`-source overlay slot) drop out post-flatten
   * naturally, since the stableKey no longer exists in the
   * post-flatten DSL.
   */
  labels?: Record<string, string>;

  /**
   * Tile content sources. The array is **heterogeneous**: renderable
   * sources (`media` / `text` / `mosaic` / `lavfi` / `ref`) describe
   * pixels that fill m0 cells, while {@link MosaicDataSource} entries
   * are a pure side-channel for `variables` payloads.
   *
   * # Cell-count invariant
   *
   * The number of **renderable** sources (i.e. `sources.filter(s =>
   * s.type !== "data").length`) must match the number of renderable
   * frames implied by the DSL (after accounting for zero-slots and
   * null-slots). Data sources are skipped from this count — they don't
   * occupy m0 cells, the planner emits no ffmpeg command for them, and
   * they contribute nothing to the rendered output. The planner emits
   * an error diagnostic if the renderable count and the DSL frame count
   * disagree.
   *
   * # Data-only documents
   *
   * When `sources` contains ONLY {@link MosaicDataSource} entries (no
   * renderables), the containing pipeline step **must** be marked
   * `intermediate: true` — there's nothing to deliver to the user;
   * `PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE` fires otherwise. Each
   * data source contributes its `variables` (and aliased data) to
   * back-edge collection for downstream steps to read via
   * `ctx.upstreamVariables` / `ctx.upstreamData`.
   *
   * # Mixed documents
   *
   * `MosaicDataSource` entries may sit anywhere in `sources[]` (start,
   * middle, end) alongside renderables. The engine's planner walks
   * the array and skips data entries when assigning m0 cells, so their
   * position is irrelevant to the layout. See {@link MosaicDataSource}
   * for the full contract.
   */
  sources: MosaicSource[];

  /**
   * Output canvas in pixels. One geometry per document (a doc has
   * one `m0`, therefore one layout). For multi-geometry
   * deliverables, use a {@link MosaicDocumentPipeline} where each
   * step is its own document with its own canvas.
   *
   * ## Behavior as a NESTED CHILD (`type:"mosaic"` ref)
   * When a document is rendered as a child of another mosaic, `size`
   * ALSO declares the child's NATURAL dimensions — the aspect ratio the
   * parent's `placement` (contain / cover / align / padding) resolves
   * against. Set this on a child template's returned document when it is
   * PROCEDURAL (only lavfi / text / inline-mask sources, no intrinsic
   * media to infer an aspect from) AND you want it letterboxed at a
   * non-tile aspect: without a declared `size`, a procedural child falls
   * back to the parent tile size and is STRETCHED to the cell, so
   * `fit:"contain"` produces no letterbox. (A child with media sources
   * infers its aspect from those instead.) Templates that prefer to
   * letterbox via real m0 geometry — sizing the child's cell to the target
   * aspect with null-padded bars — simply leave `size` unset.
   */
  size?: { width: number; height: number };
  // ROOT documents must always carry `size` — a mosaic document has a
  // canvas (open a .mosaic, render, get the same thing). Enforced at the
  // platform boundary (serialize/load), not the type, because CHILD docs
  // legitimately omit it (the stretch-vs-letterbox lever above). Hosts
  // treat the size as the DEFAULT render canvas; explicit host dims
  // (-w/-h, Make Device) always win.

  /** Output frame rate (frames per second). */
  fps?: number;

  /** Output duration in milliseconds. */
  durationMs?: number;

  /**
   * High-level named target preset (e.g. `"web-mp4"`, `"alpha-mov"`,
   * `"image-png"`). Resolves to concrete `format` / `audio` / `color`
   * defaults at engine time; per-field overrides below override the
   * preset.
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
   * Canvas background fill when sources don't cover the full frame
   * (e.g., `fit: "contain"` letterboxing, transparent media, padding).
   *
   * Accepts hex or any ffmpeg-compatible color string.
   */
  backgroundColor?: MosaicColor;

  /**
   * Baked background image, painted as the bottom layer (beneath all sources,
   * on top of `backgroundColor`). See {@link MosaicBackgroundImage}.
   */
  backgroundImage?: MosaicBackgroundImage;

  /**
   * Multi-encode axis: render the document once to a master file,
   * then transcode the master into N codec / container variants
   * via post-process ffmpeg passes. See {@link MosaicOutputEncode}
   * for what can and cannot differ per encode.
   *
   * Each map key is filename-safe and forms the encode filename
   * basis: `{base}-{encodeKey}.{ext}`. Keys must match
   * {@link FRIENDLY_SLUG_PATTERN}.
   *
   * Distinct from multi-geometry deliverables (which require a
   * {@link MosaicDocumentPipeline}): multi-encode reuses the same
   * master pixels at the same geometry; if the layout needs to
   * change, use a pipeline instead.
   *
   * See the internal rendering-model-contract notes
   * (rule 11) for the full multi-encode contract.
   */
  encodes?: Record<string, MosaicOutputEncode>;

  /**
   * Optional nested renderables used to fill one or more tiles.
   *
   * **Map keys must match {@link STRICT_IDENTIFIER_PATTERN}** —
   * safe identifier names, no hyphens. Becomes the namespace prefix
   * (`c0_`, `c1_`, …) basis at flatten time, so it must round-trip
   * through filtergraph labels and asset namespacing.
   *
   * The m0saic DSL defines the *shape* of tiles, but does not name
   * them. Template code associates tiles with entries in this map.
   *
   * Each entry may be:
   * - another {@link MosaicDocument} (recursive composition).
   * - a {@link MosaicDocumentPipeline} (time-sequenced renderable).
   * - a {@link MosaicXDocument} or {@link MosaicXPipeline} (author-time
   *   source forms — must be materialized via `resolveMosaicx` before
   *   reaching the engine).
   *
   * Rendering is evaluated bottom-up:
   *   1. All children are rendered first.
   *   2. Their outputs are treated as media sources.
   *   3. This mosaic is rendered once all children resolve.
   *
   * Enables arbitrary recursive composition while keeping the core DSL
   * purely spatial.
   */
  children?: Record<string, MosaicRenderableFile>;

  /**
   * Named structured-data payload published by this document.
   *
   * **Map keys must match {@link STRICT_IDENTIFIER_PATTERN}** — safe
   * identifier names. Templates author keys as camelCase (`introHero`,
   * `commitsToday`); the engine surfaces them on
   * `ctx.upstreamVariables` for downstream reads, so the keys must
   * be valid JS identifier shape for ergonomic dot access.
   *
   * Values are opaque JSON. The producing template's typed contract
   * lives at {@link MosaicTemplate.outputsSchema}; consumer
   * templates declare their needs at
   * {@link MosaicTemplate.upstreamVariablesSchema}.
   *
   * # Two roles this field plays
   *
   * **Role 1 — Nested-template return value (within-doc).** When a
   * template runs another template via `renderNestedTemplate` and
   * needs to surface structured data back to the caller, it sets
   * `doc.variables` on its returned MosaicDocument. The parent
   * template reads the data from the nested-render return value in
   * TypeScript directly. No engine channel involved.
   *
   * **Role 2 — Pipeline-step output (cross-step, rendered).** When
   * this document *is* a pipeline step's `file` AND the step
   * renders real pixels (not intermediate), set `variables` here to
   * publish data alongside the rendered output. The step is
   * concatenated into the final video *and* its variables are
   * hoisted into the back-edge collection seen by every later
   * step's {@link MosaicEngineContext.upstreamVariables}. This is
   * the right pattern for "step that does meaningful work and also
   * happens to produce data downstream consumers want."
   *
   * A canonical sub-case is **publishing a `flattenedStableKey`
   * for a later step to ref**. The producer self-stamps both its
   * step index (via `ctx.pipelineStep`) and the key, so the
   * consumer doesn't need an out-of-band assembly contract:
   *
   *   // Step 0 returns:
   *   return {
   *     kind: "mosaic_document",
   *     // ...m0/sources where one cell uses stableKey "intro_hero"...
   *     variables: {
   *       introHero: {
   *         stepIndex: ctx.pipelineStep!.index,
   *         flattenedStableKey: "intro_hero",
   *       },
   *     },
   *   };
   *
   *   // Step 1 reads it and mirrors that cell:
   *   sources: [{
   *     type: "ref",
   *     ...ctx.upstreamVariables!.introHero,
   *   }]
   *
   * For the *non-rendering* "just publish data" shape — a step
   * that exists only to fetch/derive and surface data — prefer one
   * or more {@link MosaicDataSource}s in `sources` (typically one
   * per logical data block / alias). Pure data-only steps must be
   * marked `intermediate:true`; their carrier cells are not
   * concatenated into the final output. A `MosaicDataSource` may
   * also sit alongside renderable sources — the data cell renders
   * the degenerate carrier (analogous to audio-only media), and
   * the step is fully renderable.
   *
   * # Not the same as {@link sidecars}
   *
   * `variables` are **for other templates** — in-memory data flow
   * through the engine context. `sidecars` are **for the end user**
   * — persistent files written to disk alongside the rendered
   * output. Pick the right channel for the audience.
   *
   * # Back-edge invariant
   *
   * For Role 2, same rule as {@link MosaicRefSource}: a step at
   * position N sees the union of `variables` published by every
   * step that came *before* N in evaluation order.
   * Last-write-wins on key collisions.
   *
   * # Determinism
   *
   * Tier-aware: core-tier templates must derive `variables`
   * deterministically from props + `ctx.target` + probed media
   * metadata. Capability-tier templates may populate from granted
   * side-effects (net fetch, fs read, exec spawn) — this is the
   * intended escape hatch for "fetch external data, publish for
   * downstream consumers" patterns.
   *
   * # Engine wiring
   *
   * Deferred. Pre-wiring, the engine ignores this field for Role 2
   * (cross-step threading) and emits `VARIABLES_NOT_YET_IMPLEMENTED`
   * once per render when set. Role 1 (in-process return value) works
   * immediately — it's just a TypeScript property on the returned doc.
   */
  variables?: Record<string, unknown>;

  /**
   * Structured-data sidecars delivered to the **end user** alongside
   * the rendered output.
   *
   * **Map keys must match {@link STRICT_IDENTIFIER_PATTERN}** —
   * because each key becomes a filename component
   * (`{output-basename}.{sidecar-key}.json`), the key must be safe
   * in filesystem paths and not collide with shell-special characters.
   *
   * Values are opaque JSON, with one recognized exception: a value
   * shaped like {@link MosaicTextSidecar} (`{kind:"text", ext, content}`)
   * is written as a RAW TEXT file with the given extension instead of
   * JSON — e.g. a WebVTT storyboard as `{basename}.storyboard.vtt`.
   * The producing template's typed contract lives at
   * {@link MosaicTemplate.sidecarsSchema}.
   *
   * String content (text sidecars and JSON string leaves) may embed
   * step-output tokens built with {@link stepOutputToken} —
   * `{{stepOutput:<stepName>}}` — which the writer substitutes with
   * the referenced pipeline step's final deliverable basename at
   * write time (final names are host-minted and unknowable at
   * make-time). Unresolvable tokens stay literal and are reported.
   *
   * # On-disk semantics
   *
   * Each top-level key in this record becomes its own sidecar
   * file, written next to the primary render output:
   *
   *   render output:  `forensic-hero.mp4`
   *   doc.sidecars:   `{ watermark: {...}, audit: {...},
   *                      storyboard: {kind:"text", ext:"vtt", content:"WEBVTT…"} }`
   *   sidecar files:  `forensic-hero.watermark.json`
   *                   `forensic-hero.audit.json`
   *                   `forensic-hero.storyboard.vtt`
   *
   * For an `emit:"multi"` pipeline, a STEP doc's sidecars are written
   * next to THAT step's own user-facing deliverable (per-step base),
   * so batch steps sharing a sidecar key do not collide.
   *
   * # Distinct from {@link variables}
   *
   * | Channel | Audience | Persistence |
   * |---------|----------|-------------|
   * | `variables` | Other templates / pipeline steps | In-memory, render-scoped |
   * | `sidecars`  | End user / caller                | Written to disk          |
   *
   * Canonical use case: a forensic watermark template embeds
   * imperceptible patterns into a video and publishes the embedding
   * record as `sidecars.watermark` for later verification.
   *
   * # Engine wiring
   *
   * Wired. After a successful render, `@m0saic/core`'s `writeSidecars`
   * walks each `sidecars` map and emits one `<output-basename>.<key>.json`
   * file per entry next to the primary output. Invoked by the CLI
   * (`packages/cli/src/index.ts`) and the Electron app's render paths
   * (`apps/mosaic/electron/main.js`, `apps/mosaic/electron/jobs/runJob.js`).
   * Keys must match `STRICT_IDENTIFIER_PATTERN`; non-matching keys are
   * skipped with a warning rather than failing the render.
   */
  sidecars?: Record<string, unknown>;

  /**
   * Editor-only metadata. Ignored by engine/rendering.
   *
   * Provides UI hints about ownership, labeling, and provenance when
   * this document is opened directly in the editor or displayed in a
   * tree view. Does not affect rendering, validation, or determinism.
   */
  editor?: MosaicRenderableEditorMeta;

  /**
   * Engine-only metadata. Ignored by editor/UI.
   *
   * Tracks the semantic render status of this document and any
   * non-fatal errors encountered during rendering. Does NOT affect
   * render control flow — the engine continues even when marked as
   * `"error"`.
   */
  engine?: MosaicEngineMeta;
};

/**
 * Union of all top-level renderable file shapes.
 *
 * - {@link MosaicDocument} — flat, engine-runnable (`.mosaic`).
 * - {@link MosaicDocumentPipeline} — temporal composition of mosaic docs.
 * - {@link MosaicXDocument} — author-time source form of a `.mosaic`
 *   that may contain unresolved `template_invocation` sources. Must be
 *   resolved (via `resolveMosaicx` in `@m0saic/core/runtime`) before
 *   reaching the engine.
 * - {@link MosaicXPipeline} — author-time source form of a
 *   {@link MosaicDocumentPipeline}: a chain of template invocations
 *   written as a top-level pipeline. Same resolve-before-render rule.
 *
 * Templates may return any of these. The CLI and Make page handle
 * mosaicx by resolving it on load; engine entry points reject mosaicx
 * outright with `MOSAIC_UNRESOLVED_MOSAICX`.
 */
export type MosaicRenderableFile =
  | MosaicDocument
  | MosaicDocumentPipeline
  | MosaicXDocument
  | MosaicXPipeline;
