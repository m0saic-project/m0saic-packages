import type { MosaicDocument, MosaicRenderableFile } from "./document";
import type {
  MosaicDocumentPipeline,
  MosaicPipelineStepBase,
} from "./document-pipeline";

/**
 * A `MosaicXDocument` (`.mosaicx`) is the **source form** of a
 * `MosaicDocument`. It carries the same fields as a `MosaicDocument`
 * but may contain `template_invocation` sources that have not yet been
 * resolved into rendered child docs. Running `resolveMosaicx` (in
 * `@m0saic/core/runtime`) walks the invocations, calls each template,
 * inlines the rendered children, and emits a flat `MosaicDocument` —
 * which is the engine-runnable form.
 *
 * # Why a separate type (and not just a flag on MosaicDocument)
 *
 * - The discriminator (`kind: "mosaicx_document"`) lets engine entry
 *   points fail-fast if a mosaicx slips through unresolved — much
 *   safer than asking every engine consumer to defensively look for
 *   `template_invocation` sources.
 * - File validators can distinguish "source form" from "runnable form"
 *   by reading `kind` alone, without walking sources.
 * - The two stay structurally identical via `Omit<MosaicDocument, ...>`
 *   so adding fields to `MosaicDocument` (size, fps, etc.) propagates
 *   to `MosaicXDocument` automatically.
 *
 * # Relationship to `.mosaic` files
 *
 * - `.mosaic` = `JSON.stringify(MosaicDocument)` — engine-runnable.
 * - `.mosaicx` = `JSON.stringify(MosaicXDocument)` — source / author form.
 *
 * No envelope (`{ format, version, created, ... }`) — both formats
 * are the documents themselves. This matches how `.mosaic` is handled
 * today (see `apps/mosaic/web/src/state/saveComposeFile.ts`'s
 * `serializeComposeDoc`); the same serializer works for both formats
 * once `MosaicXDocument` is added.
 *
 * # Resolution flow
 *
 * 1. Compose authors a `.mosaicx` containing N `template_invocation`
 *    sources (templateId + props + optional durationMs/fps overrides).
 * 2. User hits "Resolve & Render" or otherwise materializes the doc.
 * 3. The resolver walks invocations in deterministic preorder, calls
 *    each template, and either:
 *    - Inlines the returned `MosaicDocument` into `children[...]` and
 *      replaces the source with a `mosaic` source.
 *    - Inlines a returned `MosaicDocumentPipeline` into `children[...]`
 *      (engine concats pipelines downstream).
 *    - Recurses into a returned nested `MosaicXDocument` (depth-capped).
 * 4. Resolver flips `kind: "mosaicx_document"` → `"mosaic_document"`
 *    and returns the flat doc to the caller (typically Make, which
 *    feeds it to the engine for the actual ffmpeg render).
 */
export type MosaicXDocument = Omit<MosaicDocument, "kind" | "version"> & {
  /** Discriminator for the file format. Distinct from `mosaic_document`. */
  kind: "mosaicx_document";

  /** Schema version for forwards-compatible decoding. */
  version: 1;

  /**
   * Set by the resolver in-flight to record the most recent resolve
   * attempt. Dropped when the doc is flattened to a `MosaicDocument`.
   * Mosaicx-only metadata; not engine-semantic.
   */
  lastResolvedAt?: string;

  /**
   * Shared-vocabulary imports — paths to `.m0v` files whose `assets`
   * blocks are merged into this doc's effective `assets` manifest at
   * resolve time. Doc-local `assets` override vocab entries on key
   * collision (most-specific layer wins, normal cascade).
   *
   * # Why this lives on `MosaicXDocument` only (not `MosaicDocument`)
   *
   * Vocabulary resolution is a source-form concern: by the time a
   * `.mosaicx` flattens into a `.mosaic`, the resolver has already
   * inlined every vocab asset into `doc.assets` and stripped the
   * `vocab` field. The engine never sees vocab imports — same way it
   * never sees `template_invocation` sources. Keeping the field
   * mosaicx-only means engine entry points don't need a "still has
   * unmerged vocab" precheck.
   *
   * # Path resolution
   *
   * Each entry is a path string, resolved against the directory
   * containing the `.mosaicx` file (same convention as relative paths
   * in `doc.assets[*].path`). Absolute paths are taken as-is.
   *
   * # Merge order
   *
   * Vocabularies are merged in array order (first imports first),
   * then doc-local `assets` overrides. A key that appears in
   * `vocab[0].assets` and `vocab[1].assets` resolves to `vocab[1]`'s
   * value; one that also appears in `doc.assets` resolves to
   * doc-local. Same precedence model as CSS cascades.
   *
   * # Why paths, not asset refs
   *
   * Unlike `propsSchema.type: "media"` prop values — which carry
   * **asset ids** into `doc.assets` because templates resolve them
   * through `ctx.media[id]` — `vocab` entries are paths to `.m0v`
   * files read once by the resolver. They never enter `ctx.media`,
   * never reach a template, and have no meaningful `mediaType`. The
   * asset-ref convention is for template props only.
   *
   * Portability of these raw paths (machine-local absolute paths
   * break when a `.mosaicx` moves between users) is a known gap,
   * shared with `doc.assets[*].path`. Better solved holistically
   * later via search-path resolution (relative to `.mosaicx` →
   * project root → `~/m0saic/vocab/<name>.m0v`).
   *
   * Omitted (rather than `[]`) when the doc has no vocab imports.
   */
  vocab?: string[];

  /**
   * Agent ↔ human annotation block — the same note / question /
   * context / response / comments protocol `.m0c` carries on its
   * `agent` slot, so a `.mosaicx` candidate can ask a question and
   * receive the human's verdict IN the file (the Run view renders the
   * QnA and saves the response; `response.src` points at the
   * time-stamped render the verdict judged, `response.images` carries
   * optional b64 screenshots).
   *
   * Typed loosely here to keep `@m0saic/types` dependency-free — the
   * canonical shape is `M0AgentMeta` in `@m0saic/momo-types` (the
   * lightweight agent-layer vocabulary every consumer narrows
   * through). Pure annotation metadata: ignored by the resolver and
   * the engine.
   */
  agent?: unknown;

  /**
   * Suggested render-output location for INTERACTIVE surfaces (Make / Run).
   * An optional authoring hint: when this doc is rendered interactively, the
   * output path defaults here instead of the workspace's smart default — so a
   * sandbox-iteration `.mosaicx` lands its render (and `.mosaic` twin) back in
   * its session folder, well-named. The user can still override the path in
   * the UI. Pure authoring metadata: ignored by the engine and the resolver.
   *
   * Precedence (highest wins): user picks a path in the UI > `suggestedOutput`
   * > workspace smart default.
   */
  suggestedOutput?: {
    /**
     * Target directory. Absolute, or relative to the directory containing
     * this `.mosaicx`. Created if missing. The surface still appends the
     * dimension/extension suffix to the basename.
     */
    dir?: string;
    /**
     * Output basename (no extension). The surface appends `-{W}x{H}.{ext}`
     * (e.g. `candidate-006` → `candidate-006-1920x1080.mp4`), and the
     * `.mosaic` provenance twin rides the same basename.
     */
    basename?: string;
  };

  /**
   * Runner-mode defaults — consumed by the CLI (`m0saic make
   * <file>.mosaicx`) and by the desktop Run view when the `.mosaicx`
   * is invoked as a droppable template against externally-supplied
   * inputs. Pure runner metadata: ignored by the engine, by the
   * resolver, and by Compose's editing surface.
   *
   * Each field is a **default** that explicit CLI flags / Run-view
   * controls override. The precedence chain (highest wins) is:
   *
   *   explicit CLI flag  >  runner.<field>  >  built-in default
   *
   * Omit the whole block when no runner defaults are desired. The
   * dominant case (a `.mosaicx` opened only in Compose for editing)
   * carries no `runner` block at all.
   */
  runner?: {
    /**
     * Default for the CLI's `--output-pattern` flag. Used to name
     * deliverables in multi-output / multi-input runs. Same tokens
     * as `--output-pattern` (`{{base}}`, `{{ext}}`, `{{stepName}}`,
     * `{{index}}`, `{{batch}}`, `{{label}}`).
     */
    output_pattern?: string;

    /**
     * Default path to a `.m0v` vocabulary file, resolved against
     * the directory containing this `.mosaicx`. Sits between an
     * explicit `--m0v` flag (higher precedence) and the runner's
     * sibling-`.m0v` auto-discovery (lower precedence).
     */
    m0v?: string;

    /**
     * Per-sidecar default truthy/falsy. `true` ⇒ behaves as if
     * `--save-mosaic` / `--save-plan` / `--save-m0` /
     * `--save-commands` were passed without an explicit path
     * (sidecar written next to the output). `false` or unset ⇒
     * no sidecar unless the CLI flag is explicitly provided.
     */
    sidecars?: {
      mosaic?: boolean;
      plan?: boolean;
      m0?: boolean;
      commands?: boolean;
    };
  };
};

/**
 * One time-ordered step inside a {@link MosaicXPipeline}.
 *
 * Identical to {@link MosaicPipelineStep} except that the inline `file`
 * may still be in **source form**: a `MosaicXDocument`, a nested
 * `MosaicXPipeline`, or either already-resolved kind. The resolver
 * materializes each step file's invocations and flips its discriminator
 * to the runnable counterpart, so by the time the pipeline reaches the
 * engine every step file is a `MosaicDocument` / `MosaicDocumentPipeline`
 * — i.e. an ordinary {@link MosaicPipelineStep}.
 */
export type MosaicXPipelineStep =
  | (MosaicPipelineStepBase & { file: MosaicRenderableFile; ref?: never })
  | (MosaicPipelineStepBase & { ref: string; file?: never });

/**
 * A `MosaicXPipeline` (`.mosaicx` with `kind: "mosaicx_pipeline"`) is the
 * **source form** of a {@link MosaicDocumentPipeline} — the temporal
 * sibling of {@link MosaicXDocument}.
 *
 * # Why it exists
 *
 * A chain of `template_invocation`s is the whole point of `.mosaicx`, and
 * a chain is temporal. Without this kind the root of a `.mosaicx` had to
 * be a *document* whose child was the pipeline, which buried the actual
 * subject one level down: every surface that iterates a **top-level**
 * pipeline's steps (Make's filmstrip, Compose's pipeline strip) saw "a
 * document with one tile" and no step cards.
 *
 * # Why a new discriminator (and not `kind: "mosaic_pipeline"` reused)
 *
 * Same reason `mosaicx_document` is its own kind rather than a flag on
 * `MosaicDocument`: an engine entry point must be able to refuse
 * unresolved input **by discriminator alone**, without sniffing step
 * files for lurking invocations. Reusing `mosaic_pipeline` at a
 * `.mosaicx` root would silently void that guarantee.
 *
 * # Relationship to the wrapped form
 *
 * A document wrapping a pipeline child stays legal — `resolveMosaicx`
 * promotes that child to the top-level renderable. The two forms resolve
 * to the same renderable; this one just says what it is at the root.
 *
 * # Resolution
 *
 * `resolveMosaicx` walks `steps[].file`, materializes every invocation
 * (threading upstream data across the step boundary — step N sees only
 * steps < N, seeded from {@link MosaicDocumentPipeline.variables}), and
 * flips `kind: "mosaicx_pipeline"` → `"mosaic_pipeline"` on the way out.
 *
 * # Divergence from MosaicXDocument (deliberate)
 *
 * Carries `runner` — the CLI's `m0saic make <file>.mosaicx` path applies
 * it identically for both roots, and `output_pattern` in particular is
 * what names the deliverables of an `emit: "multi"` chain. It does NOT
 * carry `vocab` / `agent` / `suggestedOutput`: those are consumed only by
 * surfaces that require a top-level `template_invocation` source (the
 * Make agent loop) or are unwired, and a never-wired field is worse than
 * an absent one. Add them here when the consuming surface learns this
 * root kind.
 */
export type MosaicXPipeline = Omit<
  MosaicDocumentPipeline,
  "kind" | "version" | "steps"
> & {
  /** Discriminator for the file format. Distinct from `mosaic_pipeline`. */
  kind: "mosaicx_pipeline";

  /** Schema version for forwards-compatible decoding. */
  version: 1;

  /** Ordered steps, each of which may still carry source-form content. */
  steps: MosaicXPipelineStep[];

  /**
   * Set by the resolver in-flight to record the most recent resolve
   * attempt. Dropped when the pipeline is flattened to a
   * `MosaicDocumentPipeline`. Same field, same lifecycle as
   * {@link MosaicXDocument.lastResolvedAt}.
   */
  lastResolvedAt?: string;

  /**
   * Runner-mode defaults. Same contract as
   * {@link MosaicXDocument.runner} — see that field for the precedence
   * chain and per-field semantics.
   */
  runner?: MosaicXDocument["runner"];
};

// ─────────────────────────────────────────────────────────────────────
// Design note — asset identity under vocab cascade
// ─────────────────────────────────────────────────────────────────────
//
// Scenario the vocab cascade exposes:
//
//   brand.m0v          → assets.companyLogo = { kind: "file", path: "C:/brand/logo_v3.png" }
//   sponsor-pack.m0v   → assets.companyLogo = { kind: "file", path: "C:/sponsor/logoA.png" }
//   doc-local          → assets.companyLogo = { kind: "file", path: "./assets/override.png" }
//
// Three layers claim the same map key `companyLogo`. Two interpretations:
//   (a) They are conceptually the SAME asset, and the last write wins
//       (most-specific override — the cascade rule we've documented).
//   (b) They are conceptually DIFFERENT assets that happen to share a
//       friendly slug, and an editor should be able to disambiguate
//       ("this layer's logo vs that one") for audits, "find all
//       references," cross-vocab dedup, or safe rename refactors.
//
// What `MosaicAsset` (see packages/types/src/asset/asset.ts) supports
// today:
//   - Lookup by manifest key (the slug, e.g. `"companyLogo"`).
//   - `displayName?` for human-facing UI labels.
//   - `mediaType?` advisory tag.
//   - `kind: "file" | "url" | "data-uri"` + payload field per kind.
//
// What it does NOT support today:
//   - Stable identity across cascade merges. The manifest key doubles
//     as lookup id AND identity, so overwrites are indistinguishable
//     from intentional overrides at the type level. There is no
//     mechanism to say "these two entries are conceptually one asset
//     that was overridden" vs "these are two distinct assets that
//     collided on slug."
//   - Namespace hierarchy. Keys are flat slugs (`^[a-z0-9][a-z0-9_-]*$`)
//     so `brand/logos/main` vs `social/cta/main` has to be encoded by
//     prefixing the slug (`brand_logos_main`). No structured path.
//   - Audit / rename refactoring across docs. Renaming `companyLogo`
//     in `brand.m0v` requires hunting every `.mosaicx` that references
//     it; there's no stable identifier to follow through the rename.
//
// Future shape under consideration (NOT implemented):
//
//   type MosaicAssetCommon = {
//     // What we have today:
//     displayName?: string;                 // friendly name for editor UI
//     mediaType?: MosaicMediaKind;
//
//     // Identity layer (additive — optional, editor-stamped):
//     cryptoId?: string;                    // random, guaranteed-unique identity
//     logicalName?: string;                 // namespace path, e.g. "brand/logos/main"
//                                           // (defaults to manifest key)
//   };
//
// Open question for that future shape: what do template_invocation
// props (propsSchema.type: "media") reference — manifest key,
// logicalName, or cryptoId? Map key is the current contract and
// keeps authoring readable; cryptoId solves identity but is
// hostile to write by hand; logicalName carries collision risk
// (the very problem cryptoId solves). Leaning toward "map key as
// the lookup contract, cryptoId stamped by editors for tooling."
//
// Holding off on the schema change until the cross-vocab editor or
// audit tooling that would consume it is actually being built.
// Adding fields without a consumer is the kind of speculative
// schema growth we've been avoiding.
