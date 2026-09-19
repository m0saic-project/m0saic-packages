# `engine-context/` — connectivity matrix

**Source:** `packages/types/src/engine-context/engine-context.ts` (481 LOC)
**Test:** `packages/types/src/engine-context/engine-context.test.ts` (294 LOC)
**Phase 3 owners:** 3a (core: target, output, media, cache), **3b (upstreamVariables + upstreamData threading — primary focus of this pass)**, 3e (pipelineStep self-stamp consumption), 3h (mode gating + U/D generic narrowing), 3i (ctx.telemetry? sink wiring)

---

## Summary

- **Total rows:** ~30 top-level + ~50 in nested ffprobe / output sub-types
- **wired:** mode, target (4 fields), media (registry of ffprobe results), cache contract, pipelineStep envelope shape
- **needs-wiring (3b focus):** `upstreamVariables` threading, `upstreamData` threading (both undefined pre-wiring)
- **needs-wiring (3d):** `output.format` / `output.audio` / `output.color` resolution chain (target preset → doc → CLI overrides)
- **needs-wiring (3h):** `mode:"design"` capability-tier gating, full U/D generic threading through `MosaicTemplate.render`
- **needs-wiring (3i):** `telemetry?` sink threading (NOOP fallback works today)
- **pixel-affecting:** target dims, output dims, output.format.pixelFormat, output.color.*, output.backgroundColor, media video stream dims/colorspace
- **non-visual:** everything else (mode, cache, pipelineStep, upstream views, telemetry, audio config)

---

## Types in this concept

### Top-level
- `MosaicEngineContext<U, D>` — generic over upstream-variables shape + upstream-data shape
- `MosaicRenderTarget` — minimal 4-field "what canvas does this template render to"
- `MosaicEngineOutputContext` — fully resolved top-level render output envelope
- `MosaicPipelineStepContext` — pipeline-step self-stamp data
- `MosaicEngineMode` — closed union `"render" | "design"`
- `MosaicMediaRegistry` — `Record<AssetId, MosaicMediaMetadata>`
- `MosaicTemplateUpstreamVariables` — base shape for flat upstream view (`Record<string, unknown>`)
- `MosaicTemplateUpstreamData` — base shape for alias-namespaced view (`Record<string, Record<string, unknown>>`)

### Nested (ffprobe-derived metadata)
- `MosaicMediaMetadata` — unified probe blob (kind, width/height, fps, duration, hasVideo/hasAudio, …)
- `MosaicFormatInfo` — container-level probe fields
- `MosaicVideoStreamInfo` — per-video-stream probe fields (codec, pixFmt, color*, sar, dar, …)
- `MosaicAudioStreamInfo` — per-audio-stream probe fields
- `MosaicChapterInfo` — per-chapter metadata
- `MosaicProgramInfo` — per-program metadata

### Imported (full row enumeration lives in other concept pages)
- `MosaicOutputTarget` — high-level preset (see [output.md](./output.md))
- `MosaicOutputFormat` — container/codec/pixfmt (see output.md)
- `MosaicAudioConfig` — audio stream config (see output.md)
- `MosaicColorConfig` — color tags (see output.md)
- `MosaicContainerMetadata` — atoms (see output.md)
- `MosaicTelemetrySink` — emit interface (see [telemetry.md](./telemetry.md))

---

## Matrix — `MosaicEngineContext<U, D>` top-level

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:engine-context` | `MosaicEngineContext<U, D>` | wired | n/a | — | `engine-context.test.ts` | — | 2-generic over upstream-variables and upstream-data shapes. |
| `T:engine-context.generic.U` | `<U extends MosaicTemplateUpstreamVariables>` | wired (default) | non-visual | 3h | `engine-context.test.ts` (narrowing) | n/a | Default `Record<string, unknown>`. Templates narrow via `MosaicTemplate<P, O, U, D, S>`. |
| `T:engine-context.generic.D` | `<D extends MosaicTemplateUpstreamData>` | wired (default) | non-visual | 3h | `engine-context.test.ts` (narrowing) | n/a | Default `Record<string, Record<string, unknown>>`. |
| `T:engine-context.mode` | `ctx.mode` | wired | non-visual | — | `engine-context.test.ts` | n/a | Closed union `"render" \| "design"`. |
| `T:engine-context.mode=render` | — | wired | non-visual | — | TBD | n/a | Default for `m0saic make` and pipeline runner. Side effects expected. |
| `T:engine-context.mode=design` | — | needs-wiring | non-visual | 3h | TBD | n/a | Set by editor for design-time data fetches. **Capability-tier gating not yet enforced.** |
| `T:engine-context.output` | `ctx.output` | wired | pixel-affecting | — | `engine-context.test.ts` | — | `MosaicEngineOutputContext`. Fully resolved top-level envelope. |
| `T:engine-context.target` | `ctx.target` | wired | pixel-affecting | — | `engine-context.test.ts` | — | `MosaicRenderTarget`. **Differs from `output` for nested templates** (slot dimensions vs. top-level envelope). |
| `T:engine-context.media` | `ctx.media` | wired | non-visual | — | `engine-context.test.ts` | n/a | `MosaicMediaRegistry`. ffprobe results, keyed by `AssetId`. |
| `T:engine-context.pipelineStep` | `ctx.pipelineStep` | wired | non-visual | — | `engine-context.test.ts` | n/a | Optional. Populated only inside pipeline steps. |

### Upstream reads (3b primary focus — WIRED)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:engine-context.upstreamVariables` | `ctx.upstreamVariables?: Readonly<U>` | wired | non-visual | — | `upstream.test.ts` (collector + smoke) + `engine-context.test.ts` (narrowing) | n/a | **Flat union** of variables published by earlier pipeline steps. Populated by `withUpstream(baseCtx, pipeline, stepIndex)` in `@m0saic/core/runtime`. |
| `T:engine-context.upstreamData` | `ctx.upstreamData?: Readonly<D>` | wired | non-visual | — | `upstream.test.ts` + `engine-context.test.ts` | n/a | **Alias-namespaced view** — outer key is `MosaicDataSource.alias`. Populated by the same collector. |
| `T:engine-context.upstreamVariables#tier-determinism` | invariant | needs-wiring | non-visual | 3h | — | n/a | Capability-tier producers may inject non-deterministic vars; core-tier consumers read them as opaque JSON. Engine enforcement of producer determinism is part of 3h. |
| `T:engine-context.upstream-collection#flat-vs-namespaced` | invariant | wired | non-visual | — | `upstream.test.ts` ("MosaicDataSource with alias contributes to BOTH views") | n/a | Same data appears in both views when an alias is set: `flat` gets the variables merged; `namespaced[alias]` gets a copy. Unaliased data sources contribute to flat only. |
| `T:engine-context.upstream-collection#last-write-wins` | invariant | wired | non-visual | — | `upstream.test.ts` ("last-write-wins on flat-view key collisions across steps") | n/a | Flat view: key collisions resolve by step order (latest step wins). Namespaced view: alias collisions are caught at parse time by `MOSAIC_ALIAS_COLLISION` (3b.1). |
| `T:engine-context.upstream-collection#seed` | invariant | wired | non-visual | — | `upstream.test.ts` ("seeds pipeline-level variables into flat view") | n/a | `pipeline.variables` seeds the flat view from step 0 onwards. |
| `T:engine-context.upstream-collection#back-edge` | invariant | wired | non-visual | — | `upstream.test.ts` ("current step's own variables are NOT in its view") | n/a | Strictly earlier steps only — current step's own `variables` are not visible in its own upstream view. |

### Telemetry hook (3i primary)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:engine-context.telemetry` | `ctx.telemetry?: MosaicTelemetrySink` | wired (NOOP fallback) | non-visual | 3i (emit sites) | — | n/a | Optional. `getTelemetry(ctx)` returns `NOOP_TELEMETRY_SINK` when absent. |

---

## Matrix — `MosaicRenderTarget`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:render-target` | `MosaicRenderTarget` | wired | pixel-affecting | — | `engine-context.test.ts` | — | Minimal envelope for the current template's slot. |
| `T:render-target.width` | `.width` | wired | pixel-affecting | — | `engine-context.test.ts` | TBD | px. |
| `T:render-target.height` | `.height` | wired | pixel-affecting | — | `engine-context.test.ts` | TBD | px. |
| `T:render-target.fps` | `.fps` | wired | pixel-affecting | — | `engine-context.test.ts` | TBD | fps. |
| `T:render-target.durationMs` | `.durationMs` | wired | non-visual | — | `engine-context.test.ts` | n/a | ms. |

---

## Matrix — `MosaicEngineOutputContext`

The fully-resolved envelope. Templates read from `ctx.output` for top-level render parameters; for slot dimensions, prefer `ctx.target`.

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:output-context` | `MosaicEngineOutputContext` | wired | pixel-affecting | — | `engine-context.test.ts` | — | — |
| `T:output-context.width` | `.width` | wired | pixel-affecting | — | TBD | TBD | Final pixel width. |
| `T:output-context.height` | `.height` | wired | pixel-affecting | — | TBD | TBD | Final pixel height. |
| `T:output-context.fps` | `.fps` | wired | pixel-affecting | — | TBD | TBD | Final fps. |
| `T:output-context.durationMs` | `.durationMs` | wired | non-visual | — | TBD | n/a | Final duration. |
| `T:output-context.workspaceDir` | `.workspaceDir` | wired | non-visual | — | TBD | n/a | Absolute path. Engine-managed. |
| `T:output-context.target` | `.target?: MosaicOutputTarget` | needs-wiring | non-visual | 3d | — | n/a | Resolved preset name. See [output.md](./output.md). |
| `T:output-context.format` | `.format?: MosaicOutputFormat` | needs-wiring | pixel-affecting | 3d | — | TBD | Resolved container/codec/pixfmt. See [output.md](./output.md). |
| `T:output-context.audio` | `.audio?: MosaicAudioConfig` | needs-wiring | non-visual | 3d | — | n/a | Resolved audio config. `enabled:false` for image targets. See [output.md](./output.md). |
| `T:output-context.color` | `.color?: MosaicColorConfig` | needs-wiring | pixel-affecting | 3d | — | TBD | Resolved color tags (space, range, primaries, transfer). |
| `T:output-context.metadata` | `.metadata?: MosaicContainerMetadata` | needs-wiring | non-visual | 3d | — | n/a | Container atoms. |
| `T:output-context.backgroundColor` | `.backgroundColor?: MosaicColor` | needs-wiring | pixel-affecting | 3d | — | TBD | Canvas fill under non-covering sources. |

---

## Matrix — `MosaicPipelineStepContext`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:pipeline-step-context` | `MosaicPipelineStepContext` | wired | non-visual | — | `engine-context.test.ts` | n/a | Populated only inside pipeline steps. |
| `T:pipeline-step-context.index` | `.index` | wired | non-visual | — | TBD | n/a | 0-based. |
| `T:pipeline-step-context.total` | `.total` | wired | non-visual | — | TBD | n/a | Pipeline length. |
| `T:pipeline-step-context.intermediate` | `.intermediate` | wired | non-visual | — | TBD | n/a | Mirrors `MosaicPipelineStep.intermediate`. |

---

## Matrix — `MosaicMediaRegistry` + `MosaicMediaMetadata`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:media-registry` | `MosaicMediaRegistry` | wired | non-visual | — | TBD | n/a | `Record<AssetId, MosaicMediaMetadata>`. ffprobe cache. |
| `T:media-metadata` | `MosaicMediaMetadata` | wired | non-visual (carries pixel-affecting fields) | — | TBD | n/a | Unified probe blob. |
| `T:media-metadata.kind` | `.kind` | wired | non-visual | — | TBD | n/a | `MosaicMediaKind \| "unknown"`. |
| `T:media-metadata.width` | `.width` | wired | pixel-affecting | — | TBD | n/a | Probed dims. |
| `T:media-metadata.height` | `.height` | wired | pixel-affecting | — | TBD | n/a | Probed dims. |
| `T:media-metadata.hasVideo` | `.hasVideo` | wired | non-visual | — | TBD | n/a | — |
| `T:media-metadata.hasAudio` | `.hasAudio` | wired | non-visual | — | TBD | n/a | — |
| `T:media-metadata.durationMs` | `.durationMs?` | wired | non-visual | — | TBD | n/a | — |
| `T:media-metadata.fps` | `.fps?` | wired | pixel-affecting | — | TBD | n/a | Frame rate (playback). |
| `T:media-metadata.originalFileName` | `.originalFileName?` | wired | non-visual | — | — | n/a | Diagnostic only. |
| `T:media-metadata.tags` | `.tags?` | wired | non-visual | — | — | n/a | Merged ffprobe tags. |
| `T:media-metadata.rawProbe` | `.rawProbe?` | wired | non-visual | — | — | n/a | Escape hatch — full ffprobe payload. |
| `T:media-metadata.format` | `.format?` | wired | non-visual | — | TBD | n/a | `MosaicFormatInfo` (see below). |
| `T:media-metadata.video` | `.video?` | wired | pixel-affecting (nested) | — | TBD | n/a | `MosaicVideoStreamInfo` (see below). |
| `T:media-metadata.audio` | `.audio?` | wired | non-visual | — | TBD | n/a | `MosaicAudioStreamInfo`. |
| `T:media-metadata.chapters` | `.chapters?` | wired | non-visual | — | — | n/a | Per-chapter timestamps. |
| `T:media-metadata.programs` | `.programs?` | wired | non-visual | — | — | n/a | DVB streams (rare). |

### `MosaicVideoStreamInfo` (pixel-affecting nested fields)

| Codename | TS path | Status | Visual | Notes |
|---|---|---|---|---|
| `T:video-stream.codecName` | `.codecName?` | wired | non-visual | — |
| `T:video-stream.pixFmt` | `.pixFmt?` | wired | pixel-affecting | Decoded pixel format. |
| `T:video-stream.colorSpace` | `.colorSpace?` | wired | pixel-affecting | — |
| `T:video-stream.colorRange` | `.colorRange?` | wired | pixel-affecting | — |
| `T:video-stream.colorPrimaries` | `.colorPrimaries?` | wired | pixel-affecting | — |
| `T:video-stream.colorTransfer` | `.colorTransfer?` | wired | pixel-affecting | HDR characteristic. |
| `T:video-stream.fieldOrder` | `.fieldOrder?` | wired | pixel-affecting | Interlace. |
| `T:video-stream.sar` | `.sar?` | wired | pixel-affecting | Sample aspect ratio. |
| `T:video-stream.dar` | `.dar?` | wired | pixel-affecting | Display aspect ratio. |
| `T:video-stream.codedWidth` | `.codedWidth?` | wired | pixel-affecting | Pre-rotation dims. |
| `T:video-stream.codedHeight` | `.codedHeight?` | wired | pixel-affecting | — |
| `T:video-stream.rotationDeg` | `.rotationDeg?` | wired | pixel-affecting | Metadata rotation. |
| `T:video-stream.avgFrameRate` | `.avgFrameRate?` | wired | pixel-affecting | — |
| `T:video-stream.rFrameRate` | `.rFrameRate?` | wired | pixel-affecting | — |
| `T:video-stream.timeBase` | `.timeBase?` | wired | non-visual | — |
| `T:video-stream.codecLongName` / `.profile` / `.level` / `.streamIndex` / `.bitRate` / `.tags` | various | wired | non-visual | Informational. |

### `MosaicAudioStreamInfo`

| Codename | TS path | Status | Visual | Notes |
|---|---|---|---|---|
| `T:audio-stream.codecName` / `.codecLongName` / `.profile` | various | wired | non-visual | — |
| `T:audio-stream.sampleRate` / `.channels` / `.channelLayout` / `.sampleFmt` / `.bitRate` / `.streamIndex` / `.timeBase` / `.tags` | various | wired | non-visual | — |

### `MosaicFormatInfo`

| Codename | TS path | Status | Visual | Notes |
|---|---|---|---|---|
| `T:format-info.formatName` / `.formatLongName` / `.sizeBytes` / `.bitRate` / `.startTimeMs` / `.probeScore` / `.nbStreams` / `.nbPrograms` / `.tags` | various | wired | non-visual | All informational. |

### `MosaicChapterInfo` / `MosaicProgramInfo`

| Codename | TS path | Status | Visual | Notes |
|---|---|---|---|---|
| `T:chapter-info.id` / `.startMs` / `.endMs` / `.tags` | various | wired | non-visual | — |
| `T:program-info.programId` / `.nbStreams` / `.tags` | various | wired | non-visual | — |

---

## Matrix — `MosaicEngineMode`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:engine-mode` | `MosaicEngineMode` | wired | non-visual | — | `engine-context.test.ts` | n/a | Closed `"render" \| "design"`. |
| `T:engine-mode=render` | — | wired | non-visual | — | `engine-context.test.ts` | n/a | Default. Side effects expected. |
| `T:engine-mode=design` | — | needs-wiring | non-visual | 3h | TBD | n/a | Editor design-time. Capability-tier templates **MUST** gate on this. Engine enforcement deferred to 3h. |

---

## Matrix — `MosaicTemplateUpstreamVariables` / `MosaicTemplateUpstreamData`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:upstream.flat-base` | `MosaicTemplateUpstreamVariables` | wired | non-visual | — | `engine-context.test.ts` | n/a | Base shape `Record<string, unknown>`. |
| `T:upstream.namespaced-base` | `MosaicTemplateUpstreamData` | wired | non-visual | — | `engine-context.test.ts` | n/a | Base shape `Record<string, Record<string, unknown>>`. |

---

## 3b — what already works on engine-context

Pre-wiring, every consumer can:
- Type-narrow `ctx: MosaicEngineContext<MyU, MyD>` via the template generics
- Read `ctx.target` / `ctx.output` / `ctx.media` (wired today)
- Read `ctx.pipelineStep?` when inside a pipeline step (wired today)
- Type-access `ctx.upstreamVariables?` and `ctx.upstreamData?` — they're always `undefined` pre-3b, but the type signature is correct

This means **template code written today against the 3b types will compile correctly and continue to compile after 3b wiring lands** — the only behavior change is that `ctx.upstreamVariables` / `ctx.upstreamData` go from always-undefined to populated when inside a pipeline.

---

## Cross-reference: 3b code surfaces (combined with `document.md`)

The 3b engine-wiring plan straddles four files:

| File | Responsibility | Effort |
|---|---|---|
| `packages/platform/src/mosaic/validate/validateSources.ts` | Add 5 data-source diagnostics (parse-time partition check, alias collision, etc.) | ~80 LOC + tests |
| `packages/core/src/runtime/runPlan.ts` (or pipeline runner equivalent) | Build `upstreamVariables` + `upstreamData` before each step's `template.render(props, ctx)`; pass into ctx | ~80 LOC + tests |
| `packages/types/src/diagnostic/diagnostic.ts` | Surface the 5 new diagnostic codes (likely already in `MOSAIC_DIAGNOSTIC_CODES`; if not, append) | trivial |
| `packages/core/.../emitUpstream*` (new file) | Pure-function collector covered in 3b.2 above | included in runPlan effort |

**Total estimate:** ~half day code + tests. Same conclusion as `document.md`.

---

## Open questions

1. **Upstream view immutability.** The types declare `Readonly<U>` and `Readonly<D>` — should the collector produce frozen views (`Object.freeze`) or trust the readonly contract? Probably trust at types and skip the runtime freeze (perf), but document explicitly.
2. **Aliased + unaliased same payload?** If a `MosaicDataSource` declares `alias:"hero"` and publishes `{w:1920}`, the flat view also gets `{w:1920}`. Could a downstream template accidentally read `ctx.upstreamVariables.w` thinking it came from somewhere else and not from hero? **Yes, by design** — flat view is "everything", namespaced is "by alias". The risk is acceptable; if a template needs disambiguation, it reads `ctx.upstreamData.hero.w` instead.
3. **`mode:"design"` gating.** When does the editor call templates with `mode:"design"`? Today it doesn't — there's no editor-side wiring. Phase 3h or Phase 5 territory. The type field is wired but the runtime path is dormant.
4. **`ctx.pipelineStep` self-stamping pattern.** Producer templates can write `step.index` into their `variables` for downstream consumers. Should there be a helper `selfStampVariables(ctx, vars)`? Probably yes; lives in `@m0saic/template-utils`. Phase 3b sub-task.
