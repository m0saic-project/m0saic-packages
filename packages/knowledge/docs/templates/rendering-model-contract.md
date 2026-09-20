# Rendering-model contract

**Anchor doc for the 12-rule contract spanning `MosaicDocument`, `MosaicDocumentPipeline`, `MosaicOutputEncode`, `MosaicEngineContext`, the engine planner, and the CLI.**

Verified against (at promotion time, 2026-05-15):
- https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/document/document.ts (MosaicDocument)
- https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/document/document-pipeline.ts (MosaicDocumentPipeline, PipelineStepBase)
- https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/output/encode.ts (MosaicOutputEncode)
- https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/output/format.ts / `audio-config.ts` / `color-config.ts` / `container-metadata.ts` / `target.ts` (sub-field types)
- https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/engine-context/engine-context.ts (MosaicEngineContext)
- https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/document/pipeline-helpers.ts (helpers + predicates)
- the render engine source (not published) (planner)
- the render engine source (not published) (output-format precedence chain)
- the render engine source (not published) (ctx assembly)
- the render engine source (not published) (multi-encode transcode passes)
- the render engine source (not published) (workspace + multi-output handling)
- the CLI source (not published) (capability fixtures gating each rule)
- the CLI source (not published) (E2E gate)
- the render engine source (not published) (visual gate)

## Core architectural insights

Two facts drive the whole contract:

1. **A `MosaicDocument` has exactly one `m0` string → exactly one geometry.** Width, height, fps, durationMs, target preset, format, audio, color, metadata, backgroundColor are properties of the *one render* the doc describes. A doc cannot have "multiple outputs at different geometries"; that's a contradiction with one `m0`.

2. **A `MosaicDocumentPipeline` is a sequence of `MosaicDocument`s, each with their own `m0`.** Multi-geometry is therefore a natural property of pipelines (not just of `emit:"multi"`). Different steps can have different canvases; in `emit:"single"` the engine concatenates them onto one pipeline-level canvas (letterbox / element-wise-max default), in `emit:"multi"` each step emits its own file at its own canvas.

The shape of the types reflects this directly: output knobs are flattened onto Document and Pipeline (no map of "named outputs"), and multi-encode is a separate top-level field.

## Shape

```ts
type MosaicDocument = {
  kind: "mosaic_document";
  version: 1;
  m0: M0String;
  assets: MosaicAssetManifest;
  sources: MosaicSource[];
  children?: Record<string, MosaicRenderable>;
  meta?: MosaicFileMeta;
  labels?: ...;                                // out of rendering-model scope
  variables?: ...; sidecars?: ...;
  editor?: ...; engine?: ...;
  created?: string; app?: ...; appVersion?: ...;

  // -- Rendering-model output knobs (one config per doc) --
  size?: { width: number; height: number };
  fps?: number;
  durationMs?: number;
  target?: MosaicOutputTarget;
  format?: MosaicOutputFormat;
  audio?: MosaicAudioConfig;
  color?: MosaicColorConfig;
  metadata?: MosaicContainerMetadata;
  backgroundColor?: MosaicColor;

  // -- Multi-deliverable transcode pass (post-render) --
  encodes?: Record<string, MosaicOutputEncode>;
};

type MosaicDocumentPipeline = {
  kind: "mosaic_pipeline";
  version: 1;
  steps: MosaicPipelineStep[];
  defaultTransition?: MosaicPipelineTransition;
  meta?: ...; created?: ...; app?: ...; appVersion?: ...;
  variables?: ...; sidecars?: ...;
  editor?: ...; engine?: ...;

  // -- Rendering-model output knobs (one config per pipeline) --
  size?: { width: number; height: number };
  fps?: number;
  durationMs?: number;
  target?: MosaicOutputTarget;
  format?: MosaicOutputFormat;
  audio?: MosaicAudioConfig;
  color?: MosaicColorConfig;
  metadata?: MosaicContainerMetadata;
  backgroundColor?: MosaicColor;

  // -- Pipeline-specific --
  emit?: "single" | "multi";    // single = concat to 1 file; multi = N files

  encodes?: Record<string, MosaicOutputEncode>;
};

type MosaicOutputEncode = {
  size?: { width: number; height: number };   // optional ffmpeg `scale` (stretches)
  format?: MosaicOutputFormat;
  audio?: MosaicAudioConfig;
  color?: MosaicColorConfig;
  metadata?: MosaicContainerMetadata;
  // NOT settable: fps, durationMs, target, emit (inherited from master)
};
```

The `outputs: Record<string, MosaicOutput>` map and the `MosaicOutput` type are **gone**.

---

## Rule 1 — Top-level return types

A template returns exactly one of:

    MosaicDocument | MosaicDocumentPipeline

- `MosaicDocument` → always exactly 1 master render at 1 geometry.
- `MosaicDocumentPipeline` → a sequence of documents, possibly with different geometries.

Runtime discrimination: `isPipelineFile()` / `isDocumentFile()`.

## Rule 2 — Pipeline emit mode

A pipeline declares `emit?: "single" | "multi"` (default `"single"`).

- `"single"` → render every step, concatenate the output-steps into 1 video. Step geometries reconcile to the pipeline's canvas (explicit `pipeline.size`, or element-wise max of step canvases).
- `"multi"` → render every step, emit each output-step as its own file at its own step's geometry. **Top-level only**: nested pipelines silently downgrade to `"single"` (`PIPELINE_EMIT_MULTI_DOWNGRADED`).

The relevant fan-out test:

    isMultiOutputCapable = pipeline is top-level
                           && emit === "multi"
                           && outputStepCount > 1

## Rule 3 — Step model

Each pipeline step:

- has `durationMs: number` — exact rendered length.
- may carry `intermediate?: boolean` (default `false`).
- may carry `name?: string` — friendly-slug used for filename basis under `emit:"multi"` and for CLI per-step addressing. Falls back to `step-{index}`.
- may carry `label?: string` — template-author hint for `{{label}}` token in the CLI's `--output-pattern` (e.g. the user-supplied input filename when a template fans 1→N variants).

Derived:

    outputSteps = steps.filter(s => !s.intermediate)
    outputCount = outputSteps.length

At least one step must be non-intermediate (`PIPELINE_NO_OUTPUT_STEPS` otherwise).

## Rule 4 — Pipeline execution

**Top-level pipeline:**
- Renders all steps (intermediates included — they back ref-sources).
- `emit:"single"` → concat output-steps; pipeline-level output knobs govern the concat canvas + final format.
- `emit:"multi"` → each output-step emits its own file at its own step's canvas. Pipeline-level knobs are mostly inert for canvas/fps/duration (steps win); pipeline-level `encodes` apply to **each** emitted file.

Each step renders at its own declared `step.file.size`; the pipeline-level / CLI `-w/-h` target is the default canvas, used only when a step doesn't declare its own (`buildMosaicPlanFromFile.ts` step loop).

**Per-cell tap intermediates (Phase 3c.4).** When a `media`-source cell is the target of one or more `MosaicRefSource`s, the planner emits an additional per-cell `.mov` render (the "tap") via `tapNodeIdFor(stepIndex, flattenedStableKey)`. The tap captures that cell's post-decoration, pre-composite pixel stream; ref consumers (same-doc and cross-step) read from it. Cells that aren't ref targets are unaffected — the tap is opt-in via a pre-pass (`collectRefTargets`) that scans the whole renderable once before plan-build. `text` and `mosaic` ref targets reuse their existing per-cell intermediates; `lavfi` ref targets re-emit the same lavfi expression at the consumer (hash-deduped by graph string).

**Nested pipeline** (appears in a parent's `children`):
- Must produce exactly one clip for the parent slot's effective duration `T`.
- Engine sums step durations to meet `T`; trims last step; falls back to embedding source's `MosaicPlaybackProps.loopMode` (`"loop"` / `"freeze"` / `"cut"`) when the pipeline is shorter.
- Per-step canvases are overridden under nesting; parent slot's canvas wins (`PIPELINE_NESTED_CANVAS_COLLAPSED`).
- `emit:"multi"` silently downgrades to `"single"`.

## Rule 5 — Output resolution (single render)

Applies to:
- `MosaicDocument` (always — a doc is always one render).
- `MosaicDocumentPipeline` with `emit:"single"` or `outputCount === 1` (the pipeline produces one concatenated file).

Each output field resolves via a **3-tier chain** (highest first):

    1. User intent  (CLI flags + .m0v defaults, assembled by the CLI)
    2. Template intent  (the fields set on doc / pipeline by render())
    3. Engine default  (target preset → engine hardcoded defaults)

`.m0v` is CLI-consumed default user input — not part of the template/engine contract. Templates never read `.m0v` files. The CLI loads `.m0v` (when supplied) and uses its named output presets as the User tier's default layer; CLI flags override `.m0v` defaults within the same tier; the merged result is the User tier for the document/pipeline.

### Rule 5b — Size off `ctx.target`, never `ctx.output`

**`ctx.target.{width,height}` is THIS template's canvas. `ctx.output` is the top-level
render envelope.** They are not the same thing once a template is nested.

| | `ctx.target` | `ctx.output` |
|---|---|---|
| Means | the canvas *this* template is drawing into | the root render's envelope (codec / container / pixel format + root dims) |
| Top level | identical to `ctx.output` | identical to `ctx.target` |
| Nested via `renderNestedTemplate(id, props, ctx, { slot })` | **the slot** (e.g. 640×216) | **still the parent root** (e.g. 1920×1080) |

`renderNestedTemplate` deliberately overrides **only** `ctx.target`
(https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/render/renderNestedTemplate.ts — `fps` and `durationMs`
default to the parent's target too). Time already comes from `ctx.target.durationMs` by
convention; **size must come from `ctx.target` for the same reason.**

**Use `ctx.target` for:**
- font sizes — `Math.round(ctx.target.height * FRAC)`
- px → fraction conversions
- `makeErrorMosaic` / `makeStubMosaic` dimensions

**Use `ctx.output` only for** format / codec / alpha decisions — never geometry.

#### ⚠️ Why this hides

At top level `ctx.target === ctx.output`, so a template that reads `ctx.output` looks
completely correct — every standalone render, every preview, every golden. The bug
appears **only** when someone composes it: the child sizes to the parent's canvas and
blows out of its cell. `stat-card` rendered ~5× too large this way.

That means **a passing test suite is not evidence.** The check is a grep, not a render:

```
grep -rn "ctx.output.width\|ctx.output.height" https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src
```

Every hit is either an error-card dimension (should be `ctx.target`) or geometry (must
be `ctx.target`). As of 2026-07-26 this still returns hits across ~23 template files —
including `charts/donut/v4`, which is `primitive: true` (i.e. explicitly meant to be
composed) and sets `const W = ctx.output.width` for its entire layout. Latent today
because nothing nests it in-repo; a live 5× bug the moment something does.

## Rule 6 — Multi-output (pipelines only)

Multi-output happens only when a top-level pipeline has `emit:"multi"` and more than one output-step. There is no multi-output for individual documents (one m0 = one geometry).

Rules:
- The template authors a pipeline with N output-steps; each step is its own `MosaicDocument` with its own geometry.
- The engine emits N files, named by `step.name` (or `step-{index}` fallback): `{base}-{stepName}.{ext}`.
- Pipeline-level `encodes` apply to each emitted file (each file → N transcoded variants).
- User intent (`ctx.userIntent.outputs`) is surfaced to templates that want to map presets to specific steps (rule 8).

## Rule 7 — Exact per-output override

Special case for pipeline `emit:"multi"`:

    if (Object.keys(userIntent.outputs).length === outputStepCount)

Then user overrides are applied **positionally** to each output-step (joined by index, not name). This overrides whatever the template authored on each step's MosaicDocument output fields. The CLI also emits an `OUTPUT_NAME_NOT_FOUND` warning per stale key when the user's keys drift from the template's step names — the override still fires (because count matched), but the warning surfaces the drift.

## Rule 8 — Preset semantics

The user can supply (via CLI flags directly, or via `.m0v` defaults the CLI loads):
- A default output config.
- Named presets (e.g. `"desktop"`, `"mobile"`, `"alpha-master"`).

Behavior:
- **Single render (document, or pipeline emit:single)** → presets resolve directly through the 3-tier chain (rule 5). Only one preset's worth of fields is actually applied.
- **Multi render (pipeline emit:multi)** → presets are input to the template via `ctx.userIntent.outputs`. The template decides how to map preset names onto its own step `name`s. The exact-override path (rule 7) is the only hard-override.

## Rule 9 — Intermediate steps + back-edge refs

Steps with `intermediate: true`:
- DO render. The engine produces a real video file in `workspaceDir`.
- The workspace file is deleted at the end of the render job — not delivered to the user.
- ARE available to later steps via `MosaicRefSource` (back-edge invariant; see below).
- Do NOT count toward `outputCount`.
- Are NOT concatenated under `emit:"single"`.
- Are NOT exposed as per-file under `emit:"multi"`.
- Their `transitionToNext` is ignored.

**`MosaicRefSource` scope (post-3c.4).** Refs are back-edge mirrors of another cell's pixels. They work in both directions intermediate steps unlock — but the surface is broader than pipelines:

- **Locality**: same-document (`stepIndex` omitted) AND cross-step (`stepIndex` set; must be strictly earlier).
- **Targets**: any cell that produces pixels — `media`, `text`, `mosaic`, top-level same-doc `lavfi`, and overlay frames (`r/.../ovNcN`). Inner cells of nested mosaics resolve at any depth via `flattenedStableKey` (e.g. `r/gcolc0/fc1`, `r/growc0/fc0`).
- **Not targets**: `data` sources (structurally hidden from layout), other ref sources (chains — editor flattens them; engine rejects with `MOSAIC_REF_TARGET_NOT_SUPPORTED`), cross-step lavfi (deferred — same code emits `MOSAIC_REF_TARGET_NOT_SUPPORTED` and falls back to placeholder).
- **Matrix normalization**: when the ref's slot dims / fps / duration / pixfmt differ from the target's, the consumer's own filter chain inserts `scale=` / `fps=` / `setpts=` / `format=` to bridge. Ref's own `placement` / `playback` / `effects` / `mask` then apply on top.

Use case: a "header strip" rendered once into workspace, referenced from multiple downstream steps for pixel reuse. Or: a hero clip rendered in step 0 echoed at a different size in step 3 with audio sync preserved. Or: a same-doc overlay frame reused as the visual content of another cell.

### Note — `MosaicRefSource` lavfi-target gap (v1)

Lavfi ref targets have a narrower v1 surface than the other source kinds: they resolve only when the target cell is at the root of the same doc (`descendPath.length === 0`). Refs to lavfi cells at deeper nesting silently fall back to black placeholders with a `MOSAIC_REF_TARGET_NOT_SUPPORTED` warning — only surfaced in `--validate-only` or `--report` output. Media / mosaic / text-with-image-render-mode targets all walk nested depth fine (see the `ref-same-doc-multi-level-inner-cell` and `ref-cross-step-nested-inner-cell` fixtures).

For "one solid colour reused across many cells", prefer N independent `MosaicLavfiSource` entries — ffmpeg's `color=` generator is essentially free, so the ref optimization has no payoff there. Reserve refs for targets with a real intermediate to share (media files, text-as-image PNGs, nested mosaics).

If a use case for nested-lavfi refs surfaces (e.g. mirroring a complex procedural gradient across deep cells), the gate at the render engine source (not published) is where the resolver is deferred. Verify with: `grep -nE "descendPath\.length > 0" the render engine source (not published).

### Solid-colour tile sources — use `makeColorTile`

Full section (API forms, why lavfi `color=` beats an empty text source, adoption list) moved to
[`construction-strategy.md`](construction-strategy.md) § "Solid-colour tile sources — use `makeColorTile`". Source: https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/sources/makeColorTile.ts#L52.

## Rule 10 — Single vs multi render

| Mode    | Source                                                           | User authority |
|---------|------------------------------------------------------------------|----------------|
| Single  | `MosaicDocument`, or pipeline with `emit:"single"` / 1 output    | Full (rule 5)  |
| Multi   | Pipeline with top-level `emit:"multi"` and `outputCount > 1`     | Template-driven (rule 6); user only via rule 7 |

## Rule 11 — Multi-encode (separate axis)

`encodes?: Record<string, MosaicOutputEncode>` on `MosaicDocument` and `MosaicDocumentPipeline` declares N transcoded variants of the master render(s).

    1 render → 1 master + N encodes

Engine implementation: master renders into a workspace `{base}.__master.{ext}` (never the user-facing path, so encodes can stream-copy/transcode from it), then post-process ffmpeg passes `ffmpeg -i master.<ext> ...` produce each encode entry. `runPlanInWorkspace` skips its "final command" sweep when `multiOutput: true`, so every command writes to its own `outputPath` hint instead of getting rerouted to the user-facing path.

### What an encode CAN change
- Codec, container, pixel format, encoder tuning (the primary axis).
- Width/height (optional `scale` filter pass — **stretches** content; no aspect-aware padding or re-layout).
- Audio, color tagging, container metadata.

### What an encode CANNOT change
- `fps`, `durationMs` (inherited from master).
- The render's `target` preset or `emit` mode.

### Pipeline + encodes
- `emit:"single"` → `encodes` apply to the one concat output (one master, N encodes).
- `emit:"multi"` → `encodes` apply to **each** emitted file (each of N step outputs gets N encodes — `outputCount × encodeCount` files total).

### Container/codec compatibility defaults
- WebM rejects AAC; when no audio override is supplied and the encode targets WebM, `buildEncodeCommand` defaults to `-c:a libopus` (master AAC can't be stream-copied into WebM).
- `matroska` / `quicktime` / `mpegts` are ffmpeg muxer names; `containerToExt` aliases them to `.mkv` / `.mov` / `.ts` so the writer emits valid file extensions.

## Rule 12 — Template / engine / CLI responsibilities

**Templates:**
- Author one `MosaicDocument` or one `MosaicDocumentPipeline` per `render()` call.
- Set output knobs (`size`, `fps`, etc.) on the doc/pipeline as **template intent** (tier 2 of rule 5).
- For multi-output (pipeline emit:multi) authors: read `ctx.userIntent.outputs` and map preset names onto step `name`s.
- Never read `.m0v` files directly.

**Engine:**
- Resolves output knobs per rule 5 (User > Template > Engine default).
- Branches on `emit` at top level: concat for single, fan-out for multi.
- Filters `intermediate` steps from output count / concat / per-file emission.
- Honors the exact-override path (rule 7) when triggered.
- Issues post-render transcode passes per `encodes` (rule 11).
- Concat path always emits audio (silent AAC track when sources are image-only) so downstream encodes carry an audio stream regardless of source mediaType.

**CLI:**
- Loads `.m0v` (when supplied) as default user input.
- Merges CLI flags on top (CLI flags > `.m0v` defaults within the User tier).
- Assembles `ctx.userIntent` and bakes user values into the doc/pipeline before plan-build.

---

## Per-rule wiring status (2026-05-15, end of Phase 5)

| # | Rule                       | Typed? | Wired? | Tested? | Notes                                                              |
|---|----------------------------|--------|--------|---------|--------------------------------------------------------------------|
| 1 | Top-level return types     | ✓      | ✓      | ✓       | Document/Pipeline dispatch wired in `buildMosaicPlanFromFile.ts`. |
| 2 | Pipeline emit single/multi | ✓      | ✓      | ✓       | `multi-output-minimal` fixture; `test-templates.e2e.test.js`.    |
| 3 | Step model (durationMs, intermediate, name, label) | ✓ | ✓ | ✓ | label honored in `--output-pattern`'s `{{label}}` token.        |
| 4 | Pipeline execution         | ✓      | ✓      | ✓       | Per-step `size` honored; nested-downgrade emits diagnostic.      |
| 5 | Output resolution (single) | ✓      | ✓      | ✓       | 3-tier chain in `resolveOutputFormat.ts`.                        |
| 6 | Multi-output (pipeline emit:multi) | ✓ | ✓      | ✓       | Fan-out + workspace→user-facing copy in CLI.                     |
| 7 | Exact per-output override  | ✓      | ✓      | ✓       | Length-match triggers positional merge; warns on key drift.      |
| 8 | Preset semantics           | ✓      | ✓      | ✓       | CLI `--m0v` + flag merge; `ctx.userIntent.outputs` surfaced.     |
| 9 | Intermediate steps         | ✓      | ✓      | ✓       | Filter in step loop; verified absent from user-facing output.    |
| 10 | Single vs multi distinction | ✓     | ✓      | ✓       | Follows from rules 6+7.                                          |
| 11 | Multi-encode (separate axis) | ✓   | ✓      | ✓       | Transcode chain + matroska alias + WebM audio default.           |
| 12 | Template / engine / CLI responsibilities | ✓ | ✓ | ✓ | `ctx.userIntent` wired through `createEngineContext`.            |

Legend: ✓ fully present · partial present-but-incomplete · ✗ absent.

---

## Test coverage by rule

> ⚠️ **Fixture set has roughly quadrupled since this table was written (2026-05-15).**
> As of 2026-07-26 the always-on gate renders **49 fixtures**, including **20 `ref-*`**
> (cross-step / same-doc mirror coverage for Rule 9), **15 `effects/*`**, the data-
> pipeline fixtures (`fixture-pipeline-via-mosaicx`, `github-pulse-replay`), and 4 audio
> fixtures with `minMeanVolumeDb` floors. The rows below name the original anchor
> fixtures only — the `FIXTURES` array in
> the CLI source (not published) is the live inventory.

| Rule | Gate type | Where |
|---|---|---|
| 1 | unit | the render engine source (not published) |
| 2/3/4/9/10 | E2E + visual | the CLI source (not published) (multi-output-minimal); the render engine source (not published) |
| 5 | unit | the render engine source (not published) |
| 6 | E2E | the CLI source (not published) (multi-output-minimal) |
| 7 | unit + E2E | the render engine source (not published) exact-override branch; the CLI source (not published) --m0v plumbing |
| 8 | unit | the CLI source (not published); CLI `cli.flags.test.js` |
| 11 | E2E | the CLI source (not published) (doc-with-encodes, pipeline-single-encodes, pipeline-multi-encodes, codec-matrix-video, codec-matrix-audio) |
| 12 | structural | See the render-path walkthrough (internal: `.ai/moat/templates/cli-template-lifecycle.md`) |

---

## Migration notes (what disappeared)

This contract represents a flatten refactor from a previous design:

- **`MosaicOutput` type — DELETED.** Its fields are flat on `MosaicDocument` and `MosaicDocumentPipeline` now.
- **`outputs: Record<string, MosaicOutput>` map — DELETED.** Documents have one output config; multi-geometry deliverables go through pipelines.
- **`outputsRef?: string` — DELETED.** Templates don't reference `.m0v` files; the CLI loads `.m0v` as default user input.
- **`labelsRef?: string` — DELETED.** Same principle as `outputsRef`. The canonical path for `.m0c` / `.m0p` content into a doc is via the template `m0c` / `m0p` prop type — the CLI/host loads the file, supplies it as a prop value, and the template extracts the labels into `doc.labels`. See `MosaicTemplatePropType` in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts.
- **`encodes?: ...` — MOVED to top-level** on Document and Pipeline (was nested inside MosaicOutput).
- **`emit?: ...` — MOVED to top-level** on Pipeline (was on MosaicOutput).
- **`ctx.userIntent.requestedOutputs` — REMOVED.** Subsumed by `ctx.userIntent.outputs` (the engine reads `Object.keys(outputs)` for the count signal in rule 7).

## Forward references

- `MosaicPipelineStep / PipelineStepBase` JSDoc — full `intermediate` / `label` semantics.
- `MosaicOutputEncode` JSDoc — full multi-encode contract.
- Concrete render walkthrough for templates consulting `ctx.userIntent` — engine-internal: `.ai/moat/templates/cli-template-lifecycle.md` (absent in the shipped copy).
- Data-fetcher / adapter / handle patterns — rely on intermediate steps and data-only docs in pipelines. Promoted: [`data-pipeline.md`](data-pipeline.md) (sibling doc in this folder).
