# `document/` — connectivity matrix

**Source:** `packages/types/src/document/document.ts` (488 LOC) + `document-pipeline.ts` (313 LOC)
**Test:** `packages/types/src/document/document.test.ts` (413 LOC), `document-pipeline.test.ts` (301 LOC)
**Phase 3 owners:** 3a (core fields), **3b (variables / data-source / upstream-data — primary focus of this audit pass)**, 3d (outputs / outputsRef), 3e (pipeline features: emit-multi, canvas collapse, intermediate steps), 3f (sidecars), 3g (labels / labelsRef)

---

## Summary

- **Total rows:** ~50 (24 on `MosaicDocument`, 8 on `MosaicPipelineStep` variants, 12 on `MosaicDocumentPipeline`, 5 on supporting types)
- **wired:** ~25 (core file shape, m0, assets, sources, children, meta, kind/version, transitions, step durations)
- **needs-wiring (3b focus):** `variables` cross-step threading (Role 2), `MosaicDataSource` 5 diagnostics, alias-namespacing into `ctx.upstreamData`
- **needs-wiring (3d):** `outputs` map multi-output execution, `outputsRef` `.m0v` merge
- **needs-wiring (3e):** `MosaicPipelineStep.intermediate` true-behavior enforcement, `emit:"multi"` per-step file emission, nested `emit:"multi"` downgrade warning, nested canvas collapse warning
- **needs-wiring (3f):** `sidecars` on-disk emission
- **needs-wiring (3g):** `labelsRef` `.m0c` / `.m0p#variant` loader
- **spec-only:** `editor` (3 sub-fields), `engine` (2 sub-fields)
- **pixel-affecting:** `m0`, `sources`, `children`, transitions, step `durationMs`, `outputs.<key>.size/fps/format/color/backgroundColor`
- **non-visual:** everything else (assets manifest, metadata, ids, lifecycle stamps, upstream variables/data, sidecars)

---

## Types in this concept

### From `document.ts`
- `MosaicDocument` — top-level renderable (24 fields including required + optional)
- `MosaicRenderableFile = MosaicDocument | MosaicDocumentPipeline` — union for "what templates may return"

### From `document-pipeline.ts`
- `MosaicDocumentPipeline` — temporal sequence of steps
- `MosaicPipelineStep` — closed union: `file` variant (inline doc) vs `ref` variant (external reference)
- `PipelineStepBase` (private, shared base)
- `MosaicPipelineTransition` — closed union: `cut` vs `fade`
- `isPipelineFile(x)` — runtime type guard

---

## Matrix — `MosaicDocument` (document.ts)

### Core file-shape fields

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:document` | `MosaicDocument` | wired | n/a | — | `document.test.ts` | — | Top-level renderable; root payload for renders. |
| `T:document.kind` | `MosaicDocument.kind` | wired | non-visual | — | `document.test.ts` | n/a | Literal `"mosaic_document"`. |
| `T:document.version` | `MosaicDocument.version` | wired | non-visual | — | `document.test.ts` | n/a | Literal `1`. |
| `T:document.created` | `MosaicDocument.created` | wired | non-visual | — | TBD | n/a | UTC ISO 8601. **Templates must not set this** (determinism rule). |
| `T:document.app` | `MosaicDocument.app` | wired | non-visual | — | TBD | n/a | Writer name. |
| `T:document.appVersion` | `MosaicDocument.appVersion` | wired | non-visual | — | TBD | n/a | Writer version. |
| `T:document.meta` | `MosaicDocument.meta` | wired | non-visual | — | TBD | n/a | `MosaicFileMeta` envelope. |
| `T:document.meta.title` | `.title` | wired | non-visual | — | TBD | n/a | — |
| `T:document.meta.author` | `.author` | wired | non-visual | — | TBD | n/a | — |
| `T:document.meta.source` | `.source` | wired | non-visual | — | TBD | n/a | Origin reference (free-form). |
| `T:document.meta.note` | `.note` | wired | non-visual | — | TBD | n/a | — |

### Renderable content

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:document.m0` | `MosaicDocument.m0` | wired | pixel-affecting | — | `document.test.ts` + `flattenMosaicDocument.test.ts` | (existing visual goldens in `@m0saic/core`) | Branded `M0String`. Spatial DSL. |
| `T:document.assets` | `MosaicDocument.assets` | wired | non-visual | — | `validateAssetManifest.test.ts` (platform) | n/a | `MosaicAssetManifest`. **Full row enumeration in [asset.md](./asset.md).** |
| `T:document.assets#per-doc-namespace` | invariant | wired | non-visual | — | `flattenMosaicDocument.test.ts` (namespace prefix tests) | n/a | Each child mosaic owns own asset namespace; flattener prefixes (`c0_`, `c1_`, …) and rewrites `assetId` references. |
| `T:document.sources` | `MosaicDocument.sources` | wired | pixel-affecting | — | (sources covered in [source.md](./source.md)) | — | `MosaicSource[]`. Count must match m0 frame count (data-source-only docs exempted — see below). |
| `T:document.sources#data-source-coexistence` | invariant | wired | non-visual | 3b | `validateSources.test.ts` (mixed acceptance) | n/a | A `MosaicDataSource` may sit alongside renderable sources in the same `sources[]`; each data source occupies a cell that renders the degenerate `MOSAIC_DATA_SOURCE_CARRIER` (1s × 16×16 black) — analogous to audio-only media sources. Pure-data-only steps (no renderables in `sources`) must be `intermediate:true` (enforced by `PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE`). |
| `T:document.children` | `MosaicDocument.children` | wired | pixel-affecting | — | `flattenMosaicDocument.test.ts` (cycle, ref-not-found, recursion-depth tests) | (flatten goldens) | `Record<string, MosaicDocument \| MosaicDocumentPipeline>`. Keys must match `STRICT_IDENTIFIER_PATTERN`. |
| `T:document.children#namespace-prefix` | invariant | wired | non-visual | — | `flattenMosaicDocument.test.ts` | n/a | Flattener assigns `c0_`, `c1_`, …; bottom-up evaluation. |

### `variables` (3b — Role 1 in-process, Role 2 cross-step — both WIRED)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:document.variables` | `MosaicDocument.variables` | wired | non-visual | — | `document.test.ts` (shape) + `upstream.test.ts` (Role 2 threading) | n/a | `Record<string, unknown>`. Keys: `STRICT_IDENTIFIER_PATTERN`. Two roles, both wired: (1) Role 1 — nested-template return value (TS pass-through); (2) Role 2 — pipeline-step output threading into next step's `ctx.upstreamVariables` (via `collectUpstream`). |
| `T:document.variables#role=1-nested-return` | invariant | wired | non-visual | — | TBD | n/a | Caller template reads `nested.variables` directly in TypeScript — no engine threading. |
| `T:document.variables#role=2-pipeline-step` | invariant | wired | non-visual | — | `upstream.test.ts` ("flat view picks up doc-level variables from an earlier step (Role 2)") | n/a | Pipeline step's doc-level `variables` accumulates into back-edge collection for later steps. Last-write-wins on key collisions. **Wired via `collectUpstream` in `@m0saic/core/runtime/upstream.ts`.** |
| `T:document.variables#tier-determinism-rule` | invariant | needs-wiring | non-visual | 3h | — | n/a | Core-tier templates must derive `variables` deterministically from props + `ctx.target` + probed media. Capability-tier templates may use side-effects. Engine enforcement is part of 3h (schema validation + tier gating). |

### `outputs` / `outputsRef` (3d)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:document.outputs` | `MosaicDocument.outputs` | needs-wiring | pixel-affecting | 3d | `document.test.ts` (shape) | — | `Record<OutputKey, MosaicOutput>`. Map keys must match `FRIENDLY_SLUG_PATTERN`. **Full enumeration in [output.md](./output.md).** Engine renders first key only pre-3d, emits `MULTI_OUTPUT_NOT_YET_IMPLEMENTED` when >1 key. |
| `T:document.outputsRef` | `MosaicDocument.outputsRef` | needs-wiring | non-visual | 3d | `document.test.ts` (shape) | n/a | Relative path to `.m0v` brand-config file. Doc-level entries override per-key. **Loader not yet wired.** |

### `labels` / `labelsRef` (3g)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:document.labels` | `MosaicDocument.labels` | needs-wiring | non-visual | 3g | `document.test.ts` (shape) | n/a | `Record<string, string>`. Keys: `STRICT_IDENTIFIER_PATTERN`. Flatten namespaces child labels. **Engine consumption not yet wired** (diagnostics + UI). |
| `T:document.labelsRef` | `MosaicDocument.labelsRef` | needs-wiring | non-visual | 3g | `document.test.ts` (shape) | n/a | Path to `.m0c` (single) or `.m0p#variant`. Engine errors `M0P_VARIANT_REQUIRED` if `.m0p` lacks fragment. **Loader not yet wired.** |

### `sidecars` (3f)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:document.sidecars` | `MosaicDocument.sidecars` | **wired** | non-visual | 3f | `document.test.ts` (shape) + `writeSidecars.test.ts` (engine) | n/a | `Record<string, unknown>`. Each key becomes `{output-base}.{key}.json` file next to the primary output. Wired in `@m0saic/core`'s `writeSidecars`; called by CLI (4 sites) and Electron app (3 sites: 2 in `main.js`, 1 in `jobs/runJob.js`). Invalid keys (not matching `STRICT_IDENTIFIER_PATTERN`) are skipped with a warning. |

### `editor` / `engine` meta

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:document.editor` | `MosaicDocument.editor` | spec-only | non-visual | — | — | n/a | `MosaicRenderableEditorMeta`. UI hints; engine ignores. |
| `T:document.editor.owner` | `.owner:"template"\|"user"` | spec-only | non-visual | — | — | n/a | Authoring ownership flag. |
| `T:document.editor.label` | `.label` | spec-only | non-visual | — | — | n/a | UI label. |
| `T:document.editor.provenance` | `.provenance` | spec-only | non-visual | — | — | n/a | `{ kind:"template_call", templateId, templateVersion?, props }`. Tree-view surface. |
| `T:document.engine` | `MosaicDocument.engine` | wired | non-visual | — | TBD | n/a | `MosaicEngineMeta`. Engine-internal render status. |
| `T:document.engine.renderStatus` | `.renderStatus:"ok"\|"error"` | wired | non-visual | — | TBD | n/a | Informational only; does NOT abort renders. |
| `T:document.engine.renderError` | `.renderError` | wired | non-visual | — | TBD | n/a | `{ message, code? }`. |

---

## Matrix — `MosaicDocumentPipeline` (document-pipeline.ts)

### Core pipeline shape

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:pipeline` | `MosaicDocumentPipeline` | wired | n/a | — | `document-pipeline.test.ts` | — | Temporal sequence. |
| `T:pipeline.kind` | `.kind` | wired | non-visual | — | `document-pipeline.test.ts` | n/a | Literal `"mosaic_pipeline"`. |
| `T:pipeline.version` | `.version` | wired | non-visual | — | `document-pipeline.test.ts` | n/a | Literal `1`. |
| `T:pipeline.created` / `.app` / `.appVersion` / `.meta` | same as document.ts | wired | non-visual | — | TBD | n/a | Same shape as `MosaicDocument.{created, app, appVersion, meta}`. |
| `T:pipeline.steps[]` | `.steps` | wired | pixel-affecting | — | `document-pipeline.test.ts` | (concat goldens) | Array of `MosaicPipelineStep`. Required. |
| `T:pipeline.defaultTransition` | `.defaultTransition` | wired | pixel-affecting | — | TBD | TBD | Default: `{type:"cut"}`. Applied between steps (overridable per-step). |

### Pipeline variables / sidecars (3b / 3f)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:pipeline.variables` | `MosaicDocumentPipeline.variables` | needs-wiring | non-visual | 3b | `document-pipeline.test.ts` (shape) | n/a | **Pipeline-level seed for the back-edge collection.** All steps see this in `ctx.upstreamVariables` from step 0 onwards. Keys: `STRICT_IDENTIFIER_PATTERN`. **Not yet wired.** |
| `T:pipeline.sidecars` | `MosaicDocumentPipeline.sidecars` | needs-wiring | non-visual | 3f | `document-pipeline.test.ts` (shape) | n/a | Pipeline-level sidecars (typical: render-summary, audit-log). Same on-disk semantics as `MosaicDocument.sidecars`. **Not yet wired.** |

### Pipeline outputs (3d / 3e)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:pipeline.outputs` | `MosaicDocumentPipeline.outputs` | needs-wiring | pixel-affecting | 3d, 3e | `document-pipeline.test.ts` (shape) | — | Same shape as `MosaicDocument.outputs`. **Two orthogonal axes:** multi-canvas/multi-format (3d) and per-step `emit:"multi"` (3e). |
| `T:pipeline.outputsRef` | `MosaicDocumentPipeline.outputsRef` | needs-wiring | non-visual | 3d | `document-pipeline.test.ts` (shape) | n/a | Same as `MosaicDocument.outputsRef`. |
| `T:pipeline.outputs#canvas-resolution` | invariant | needs-wiring | pixel-affecting | 3d, 3e | — | TBD | Explicit `outputs.<k>.size` wins; else element-wise max across steps; else CLI default. |
| `T:pipeline.outputs#duration-resolution` | invariant | needs-wiring | non-visual | 3d, 3e | — | n/a | Explicit `outputs.<k>.durationMs` wins; else sum of step durations. |

### Pipeline editor / engine meta

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:pipeline.editor` | `.editor` | spec-only | non-visual | — | — | n/a | Same as `MosaicDocument.editor`. |
| `T:pipeline.engine` | `.engine` | wired | non-visual | — | TBD | n/a | Same as `MosaicDocument.engine`. |

### Nested-pipeline collapse invariants (3e)

| Codename | Behavior | Status | Sub-epic | Notes |
|---|---|---|---|---|
| `T:pipeline#nested-duration-summing` | Accumulate step durations until ≥ parent slot `T`; trim last step to fit; fall back to `loopMode` if T exceeds total. | wired (in flatten) | — | Implemented during flatten. |
| `T:pipeline#nested-canvas-collapse` | Parent slot canvas always wins; per-step output declarations overridden. | needs-wiring | 3e | Should emit `PIPELINE_NESTED_CANVAS_COLLAPSED` warning. **Not yet wired.** |
| `T:pipeline#nested-emit-multi-downgrade` | Nested `emit:"multi"` silently downgraded to `"single"`. | needs-wiring | 3e | Should emit `PIPELINE_EMIT_MULTI_DOWNGRADED` warning. **Not yet wired.** |
| `T:pipeline#no-output-steps-error` | All steps marked `intermediate:true` → nothing to output. | needs-wiring | 3b, 3e | Should emit `PIPELINE_NO_OUTPUT_STEPS` error. **Not yet wired.** |

---

## Matrix — `MosaicPipelineStep` (closed union)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:pipeline.step` | `MosaicPipelineStep` | wired | n/a | — | `document-pipeline.test.ts` | — | Closed union: file-variant vs ref-variant. |
| `T:pipeline.step.durationMs` | `PipelineStepBase.durationMs` | wired | non-visual | — | `assertTiming.test.ts` (template-utils) | n/a | Required. Step's render length. |
| `T:pipeline.step.transitionToNext` | `PipelineStepBase.transitionToNext` | wired | pixel-affecting | — | TBD | TBD | Overrides `pipeline.defaultTransition` for this boundary. Ignored for last step and intermediate steps. |
| `T:pipeline.step.intermediate` | `PipelineStepBase.intermediate` | needs-wiring | non-visual | 3b, 3e | `document-pipeline.test.ts` (shape) | n/a | When `true`: excluded from output concat, transitions ignored, contributes to internal back-edge ref chain. **Behavior not yet enforced by engine** (3e). |
| `T:pipeline.step.variant=file` | `{ file: MosaicDocument, ref?: never }` | wired | pixel-affecting | — | `document-pipeline.test.ts` | TBD | Inline doc step. |
| `T:pipeline.step.variant=file.file` | `.file` | wired | pixel-affecting | — | `document-pipeline.test.ts` | TBD | Full `MosaicDocument` embedded. |
| `T:pipeline.step.variant=ref` | `{ ref: string, file?: never }` | wired (type only) | pixel-affecting | — | `document-pipeline.test.ts` | — | External reference. |
| `T:pipeline.step.variant=ref.ref` | `.ref:string` | wired (type only) | pixel-affecting | — | `document-pipeline.test.ts` | — | String identifier resolved by caller. **Resolution semantics deferred.** |

### Transition variants

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:pipeline.transition` | `MosaicPipelineTransition` | wired | pixel-affecting | — | `document-pipeline.test.ts` | (concat goldens) | Closed union. |
| `T:pipeline.transition.type=cut` | `{type:"cut"}` | wired | pixel-affecting | — | `document-pipeline.test.ts` | TBD | Hard cut. concat demuxer. |
| `T:pipeline.transition.type=fade` | `{type:"fade", durationMs:number}` | wired | pixel-affecting | — | `document-pipeline.test.ts` | TBD | Crossfade via filtergraph. |

### Runtime guard

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:pipeline.isPipelineFile` | `isPipelineFile(x)` | wired | non-visual | — | TBD | n/a | Type guard for runtime dispatch. |

---

## Matrix — `MosaicRenderableFile`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:renderable-file` | `MosaicDocument \| MosaicDocumentPipeline` | wired | n/a | — | `document.test.ts`, `document-pipeline.test.ts` | — | What `MosaicTemplate.render` returns. |

---

## 3b — diagnostic codes owned by this concept

| Code | Trigger | Status | Sub-epic |
|---|---|---|---|
| `PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE` | Step has only `MosaicDataSource` entries in `sources` but missing `intermediate:true` | needs-wiring | 3b |
| `MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE` | Data source appears in a non-pipeline `MosaicDocument` | needs-wiring | 3b |
| `MOSAIC_DATA_SOURCE_VISIBLE_USE` | `MosaicRefSource.flattenedStableKey` resolves to a data source's carrier | needs-wiring | 3b, 3c |
| `MOSAIC_ALIAS_COLLISION` | Two `MosaicDataSource`s in the same step publish the same `alias` | needs-wiring | 3b |
| `VARIABLES_NOT_YET_IMPLEMENTED` | Any `variables` field set on a pipeline step (Role 2) | wired (stub warning) | retires when 3b lands |
| `PIPELINE_NO_OUTPUT_STEPS` | Pipeline has zero non-intermediate steps | needs-wiring | 3b, 3e |

These codes are missing from the current `diagnostic.md` matrix — adding in a follow-up pass.

---

## Pruning candidates

None surfaced. Every field has either a wired consumer or an owning sub-epic. The `editor` sub-tree is `spec-only` and consumed by `apps/mosaic/web` (not pruning candidate; it's documented design).

---

## 3b engine-wiring plan (the work that remains)

The audit confirms the **types side is fully landed**. Engine wiring splits into three layers:

### 3b.1 — Data-source diagnostics (validators)

Five diagnostic codes need a parse-time check. Likely lives in `@m0saic/platform/src/mosaic/validate/validateSources.ts` (extending the existing validator).

For each `MosaicDocument.sources`:
1. Partition into `dataSources` (`type === "data"`) and `renderableSources` (everything else).
2. Mixed sources arrays are **allowed** (each data source occupies a degenerate carrier cell, analogous to audio-only media sources).
3. If `dataSources.length > 0 && renderableSources.length === 0` (pure data-only step):
   - If document is not a pipeline step → emit `MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE` (warning).
   - If document is a pipeline step but the step lacks `intermediate:true` → emit `PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE` (error).
4. Among data sources, check `alias` collisions:
   - Build `Set<AliasId>` walking each `MosaicDataSource.alias` (skip unaliased).
   - On duplicate → emit `MOSAIC_ALIAS_COLLISION` (error).
5. (Cross-concept) When 3c lands, also wire `MOSAIC_DATA_SOURCE_VISIBLE_USE` — `MosaicRefSource.flattenedStableKey` resolving to a data source.

**Effort:** ~80 LOC validator code + ~60 LOC tests.

### 3b.2 — Upstream collection + threading

Two views, both built once per pipeline step transition:

```ts
function collectUpstream(
  pipeline: MosaicDocumentPipeline,
  currentStepIndex: number,
): { upstreamVariables: Record<string, unknown>; upstreamData: Record<string, Record<string, unknown>> } {
  // 1. Seed with pipeline-level variables
  const flat = { ...(pipeline.variables ?? {}) };
  const namespaced: Record<string, Record<string, unknown>> = {};

  // 2. Walk earlier steps in order (last-write-wins on flat)
  for (let i = 0; i < currentStepIndex; i++) {
    const step = pipeline.steps[i];
    if (!("file" in step) || !step.file) continue;
    const doc = step.file;
    if (doc.kind !== "mosaic_document") continue;

    // (a) doc-level variables → flat view only
    Object.assign(flat, doc.variables ?? {});

    // (b) each MosaicDataSource → flat view; aliased → namespaced
    for (const source of doc.sources) {
      if (source.type !== "data") continue;
      Object.assign(flat, source.variables);
      if (source.alias) {
        namespaced[source.alias] = { ...source.variables };
      }
    }
  }

  return { upstreamVariables: flat, upstreamData: namespaced };
}
```

Wire into the pipeline runner: before each step's `template.render(props, ctx)` call, populate `ctx.upstreamVariables` + `ctx.upstreamData` from the collection above. Lives in `@m0saic/core` runtime (likely `runPlan.ts` or wherever step transitions happen).

**Effort:** ~50 LOC collector + ~30 LOC pipeline-runner integration + ~80 LOC tests.

### 3b.3 — Retire `VARIABLES_NOT_YET_IMPLEMENTED` stub

Currently emits when any `variables` field is set on a step's `doc`. Once 3b.2 lands and templates can actually read upstream variables, the stub goes away.

**Effort:** trivial.

### 3b.4 — `PIPELINE_NO_OUTPUT_STEPS` check

If `pipeline.steps.every(s => s.intermediate === true)` → error. Lives in pipeline validator. ~15 LOC + 1 test.

### 3b.5 — Alias-keyed reads in upstream data view

The `namespaced[alias] = { ...source.variables }` pattern (3b.2) might want to be **structurally-shared** (e.g. via a sealed Readonly view) rather than copied. Defer until profile shows a hot path; for now a shallow copy is fine.

### Out of scope for 3b

- `MosaicRefSource.flattenedStableKey` → data-source-carrier check is **3c** (refs).
- Tier-determinism enforcement on `variables` content is **3h**.
- Pipeline `outputs`/`outputsRef` resolution is **3d/3e**.

---

## 3b closing summary

| Sub-task | Result |
|---|---|
| 3b.1 — Data-source diagnostics in `validateSources` | ✅ done. 3 new diagnostics wired (`DATA_SOURCE_VARIABLES_MALFORMED`, `DATA_SOURCE_ALIAS_INVALID`, `MOSAIC_ALIAS_COLLISION`). Per-source `validateDataSource` + cross-source `validateDataSourcePartitioning` helpers. `MOSAIC_DATA_SOURCE_MIXED_WITH_RENDERABLE` was initially wired but **dropped 2026-05-14** — formalized the data-source-coexists-with-renderables pattern (analogous to audio-only media sources). |
| 3b.2 — Upstream collection + pipeline-runner threading | ✅ done. `collectUpstream(pipeline, stepIndex)` + `withUpstream(baseCtx, pipeline, stepIndex)` in `@m0saic/core/src/runtime/upstream.ts`. 17 tests: 12 unit-shape tests covering canonical scenarios (seed, doc-level vars, aliased/unaliased data sources, last-write-wins, back-edge invariant, malformed-data tolerance, ref-step skip, defensive bounds) + 2 augmenter tests + 1 end-to-end smoke test (data-fetcher template → consumer template via `withUpstream`). |
| 3b.3 — Update `VARIABLES_NOT_YET_IMPLEMENTED` diagnostic | ✅ done. `buildMosaicNode.ts` data-source handler comment updated to clarify the split: variables threading is wired (3b.2); carrier emission is still deferred. Diagnostic message rewritten. |
| 3b.4 — `PIPELINE_NO_OUTPUT_STEPS` validator | ⏸ deferred. Pipeline-level check (every step is `intermediate:true`). ~15 LOC; needs a `validateMosaicDocumentPipeline` (which doesn't exist yet). Sub-task on its own. |
| 3b.5 — `MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE` | ⏸ deferred. Needs document-context awareness in the caller. Lives in `validateMosaicDocument` once it knows whether the doc is a pipeline step. |
| 3b.6 — `PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE` | ⏸ deferred. Pipeline-runner-side check (lands when ref-step resolution lands; the planner doesn't currently call `template.render`). |
| 3b.7 — `MOSAIC_DATA_SOURCE_VISIBLE_USE` (ref points at data source) | ⏸ deferred to **3c**. Cannot be wired before refs resolve. |
| 3b.8 — Data-carrier (1s × 16×16 black) emission for data-only steps | ⏸ deferred. The `MOSAIC_DATA_SOURCE_CARRIER` placeholder render so the visual slot is filled. Today `buildMosaicNode` skips and warns. Sub-task on its own. |

**3b core wired.** Both the parse-time validator (3b.1) and the runtime upstream collection + threading (3b.2/3b.3) are shipped end-to-end with smoke test coverage. The remaining sub-tasks (3b.4–3b.8) are scoped, named, and tracked — none are blockers for downstream sub-epics (3c+).

**Engine ergonomic surface:** template authors can now write a consumer template that reads `ctx.upstreamVariables.someKey` or `ctx.upstreamData.someAlias.someKey` and a pipeline runner that calls `withUpstream(baseCtx, pipeline, stepIndex)` before each step's `template.render(...)`. The data-fetch convention (parked as Phase 3j) builds on this primitive directly.

**Effort shipped (cumulative 3b):**
- ~110 LOC validator + 2 new diagnostic codes (3b.1)
- ~115 LOC pure collector + ctx augmenter (3b.2)
- 12 new validator tests + 17 new collector/smoke tests
- Workspace stays green: types 272/272, platform 234/234, template-utils 144/144, core upstream 17/17, with only pre-existing Mac-flaky visual goldens in `effects.spec.ts` unrelated to 3b.
