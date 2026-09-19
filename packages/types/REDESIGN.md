# `@m0saic/types` — Next-Major Redesign

Visual change summary for the type-shape sweep. Pairs with the
authoritative JSDoc in each source file. Updated 2026-05-12.

---

## At a glance — what changed

| Layer | Before | After |
|---|---|---|
| **Inputs vs. outputs** | Conflated in `MosaicConfig` (`sources` + `fps` + `durationMs` + `advancedConfig` all jumbled) | Cleanly separated: `sources` hoists to doc top; render config lives in `outputs` map |
| **Single output** | `config.advancedConfig.outputFormat: "mp4" \| "mp3"` (narrow) | `outputs.default: MosaicOutput` (full envelope) |
| **Multi output** | Not possible | `outputs: Record<string, MosaicOutput>` — N parallel renders from shared content |
| **Format target presets** | Implicit | `MosaicOutputTarget`: `web-mp4 \| web-webm \| alpha-mov \| image-png \| image-jpeg \| animated-gif \| audio-mp3 \| audio-wav` |
| **Codec coverage** | 4 video codecs | 26 (software + Apple + NVIDIA + Intel + AMD + VAAPI) |
| **Container coverage** | 4 video + 3 image + 4 audio | 16 video + 9 image + 12 audio |
| **Encoder tuning** | Hardcoded in `@m0saic/core/defaults.ts` | Surfaced on `MosaicOutputFormat`: `crf`, `bitrate`, `encoderPreset/Profile/Level`, `gopSize`, `encoderOptions` |
| **Audio knobs** | Hardcoded | `MosaicAudioConfig`: `codec`, `bitrate`, `sampleRate`, `channelLayout` |
| **Color tags** | Not exposed | `MosaicColorConfig`: `colorSpace`, `colorRange`, `colorPrimaries`, `colorTransfer` |
| **Container metadata** | Not exposed | `MosaicContainerMetadata`: `title`, `description`, `author`, `copyright`, `comment`, `encoder` |
| **Authoring header** | Implicit | File-lifecycle (`created`/`app`/`appVersion`) at doc top-level + content metadata (`title`/`author`/`source`/`note`) in `meta: MosaicFileMeta` — mirrors `M0File`/`M0cFile`/`M0pFile` |
| **Brand-level config reuse** | Not possible | `outputsRef: string` → loads from a `.m0v` file (engine wiring follow-up) |
| **Cross-cell mirroring** | Not possible | `MosaicRefSource` — back-edge intra-job ref; render once, mirror many |
| **Diagnostic type** | Mixed with `MosaicConfig` | Standalone `MosaicDiagnostic` |

---

## File map

### New files

```
packages/types/src/
  meta/meta.ts                       ← MosaicFileMeta + editor/engine meta (consolidated)
  diagnostic/diagnostic.ts           ← MosaicDiagnostic (moved from mosaic-config.ts)
  output/
    output.ts                        ← MosaicOutput envelope + MosaicOutputEmit
    target.ts                        ← MosaicOutputTarget preset enum
    audio-config.ts                  ← MosaicAudioConfig
    color-config.ts                  ← MosaicColorConfig
    container-metadata.ts            ← MosaicContainerMetadata
```

### Extended files

```
packages/types/src/
  source/source.ts                   + MosaicRefSource variant; union extended
  document/document.ts               ↻ hoist sources; +meta, +outputs, +outputsRef; -config
  document/document-pipeline.ts      ↻ +meta, +outputs, +outputsRef; -fps
  template/template.ts               ↻ MosaicTemplateOutputHints.format → MosaicOutputFormat
  diagnostic/diagnostic.ts           ↻ JSDoc cross-ref updated
  output/format.ts                   ↻ huge: new flat MosaicOutputFormat + expanded enums
  output/index.ts                    ↻ re-exports
  defaults/index.ts                  ↻ -./output
  index.ts                           ↻ -mosaic-config; +diagnostic, +meta
```

### File-structure consolidation (this PR)

Beyond shape changes, the package layout was tightened to match the
mature `@m0saic/dsl` pattern of **one folder per concept**, each
containing the type file, its co-located test, and an `index.ts`
barrel. Final shape:

```
packages/types/src/
  index.ts                  ← top-level barrel
  identifiers/              ← tier patterns + brands
  primitives/               ← MosaicPlatform, MosaicVRType, ...
  meta/                     ← file + editor + engine meta (was 3 files)
  asset/
  source/
  diagnostic/
  document/                 ← document + document-pipeline + renderable union
  template/
  engine-context/
  dictionary/
  template-repo/
  job/
  colors/                   ← unchanged
  defaults/                 ← unchanged
  output/                   ← unchanged folder; files de-prefixed
                              (output.ts, target.ts, format.ts, ...)
```

Each folder's `index.ts` re-exports its concept; the top-level
`src/index.ts` re-exports each folder. Filenames lost the
`mosaic-` prefix throughout — the package is already named
`@m0saic/types`, so per-file prefixes were noise.

No downstream package imports from deep paths
(`@m0saic/types/<file>`); they all go through the barrel. The
restructure is fully transparent to consumers.

### Deleted files

```
packages/types/src/
  mosaic-config.ts                   (MosaicConfig + MosaicAdvancedConfig dissolved)
  defaults/output.ts                 (DEFAULT_VIDEO_OUTPUT etc. → superseded by target presets)
```

---

## Shape diff — `MosaicDocument`

### Before

```ts
type MosaicDocument = {
  kind: "mosaic_document";
  version: 1;
  m0: M0String;
  assets: MosaicAssetManifest;
  config: MosaicConfig;             // ❌ inputs/outputs conflated
  children?: ...;
  editor?: ...;
  engine?: ...;
};

type MosaicConfig = {
  sources: MosaicSource[];
  durationMs?: number;
  fps?: number;
  advancedConfig?: MosaicAdvancedConfig;
};

type MosaicAdvancedConfig = {
  outputFormat?: "mp4" | "mp3";     // ❌ narrow
  pixelFormat?: string;
  videoCodec?: string;
  bitrate?: string;
  backgroundColor?: MosaicColor;
};
```

### After

```ts
type MosaicDocument = {
  kind: "mosaic_document";
  version: 1;
  created?: string;                 // ✅ writer-stamped (M0-family alignment)
  app?: string | null;
  appVersion?: string | null;
  meta?: MosaicFileMeta;            // ✅ user-authored content metadata
  m0: M0String;
  assets: MosaicAssetManifest;
  sources: MosaicSource[];          // ✅ hoisted
  outputs?: Record<string, MosaicOutput>;  // ✅ multi-output ready
  outputsRef?: string;              // ✅ .m0v brand-config ref
  children?: ...;
  editor?: ...;
  engine?: ...;
};

// MosaicFileMeta is structurally identical to M0FileMeta:
type MosaicFileMeta = {
  title?: string;
  author?: string;
  source?: string;
  note?: string;
};

type MosaicOutput = {
  size?: { width: number; height: number };
  fps?: number;
  durationMs?: number;
  target?: MosaicOutputTarget;      // preset enum
  format?: MosaicOutputFormat;      // codec/container/pixfmt/encoder knobs
  audio?: MosaicAudioConfig;
  color?: MosaicColorConfig;
  metadata?: MosaicContainerMetadata;
  backgroundColor?: MosaicColor;
  emit?: MosaicOutputEmit;          // pipeline-only
};
```

---

## Shape diff — `MosaicDocumentPipeline`

### Before

```ts
type MosaicDocumentPipeline = {
  kind: "mosaic_pipeline";
  version: 1;
  steps: MosaicPipelineStep[];
  defaultTransition?: MosaicPipelineTransition;
  fps?: number;                     // ❌ top-level render knob
  cacheKey?: string;
  editor?: ...;
  engine?: ...;
};
```

### After

```ts
type MosaicDocumentPipeline = {
  kind: "mosaic_pipeline";
  version: 1;
  created?: string;                 // file-lifecycle stamps (M0-family alignment)
  app?: string | null;
  appVersion?: string | null;
  meta?: MosaicFileMeta;
  steps: MosaicPipelineStep[];
  defaultTransition?: MosaicPipelineTransition;
  outputs?: Record<string, MosaicOutput>;  // fps now lives in outputs.<key>.fps
  outputsRef?: string;
  editor?: ...;
  engine?: ...;
};
```

---

## Flattening — what the engine actually renders

At plan-build time, `flattenMosaicDocument` (in
`@m0saic/platform/mosaic/flatten`) collapses the entire document
tree — including all `children` — into a single flat MosaicDocument.
The engine never sees the per-child shapes; it operates on the
merged form.

**Three things flatten together:**

1. **m0 DSL strings** — every nested child has its own DSL string
   (e.g. a "bar graph" template's root might be `"1{1}"` with two
   children, each having their own DSL). The flattener splices the
   child DSLs into the parent's, producing **one master m0 string**
   that describes every cell in the final render.

2. **Asset manifests** — each child owns its own `assets` map at
   authoring time (their `"logo"` doesn't collide with the
   parent's `"logo"`). The flattener namespaces each child's keys
   with prefixes (`c0_`, `c1_`, `c2_`, …) and rewrites every
   `assetId` reference in the spliced sources. So a child's local
   `"logo"` becomes `"c0_logo"` in the flattened manifest.

3. **Sources arrays** — each child's `sources` are spliced into the
   flat sources array in the right DSL frame order; the engine
   matches them positionally against the flattened m0 string.

**Why this matters for the new shape:**

- {@link MosaicRefSource}.`flattenedStableKey` resolves against the
  *post-flatten* m0 string. Templates that mirror a cell from a
  nested child must use the **namespaced** key, not the child's
  local one.
- `outputs` and `outputsRef` are unaffected — they're top-level on
  the root document and don't participate in flattening.
- `meta` is preserved on the root only.

The flatten step is also what makes ref-source resolution work
across nested children: one keyspace, one DSL, one manifest, one
master tree.

---

## `MosaicSource` — new variant

```ts
type MosaicSource =
  | MosaicMosaicSource    // nested doc (inline, re-rendered each place)
  | MosaicMediaSource
  | MosaicTextSource
  | MosaicLavfiSource
  | MosaicRefSource;      // ✅ NEW: intra-job back-edge mirror

type MosaicRefSource = {
  type: "ref";
  flattenedStableKey: string;  // resolves against post-flatten root DSL (single keyspace per doc/step)
  stepIndex?: number;          // pipeline-only; back-edge (strictly earlier step)
  // ...standard source decoration props (placement, playback, effects, ...)
};
```

### Key invariants

1. **Back-edge only.** A ref can only point at a node that came
   *before* it in graph-evaluation order. Cycles are structurally
   impossible — no node can reference its own descendants because they
   don't exist yet at authoring time. **This is a deliberate design
   choice**, matching the DSL's own one-pass left-to-right resolution
   model: every ref is resolvable the moment it's encountered, no
   backtracking. "I want a later cell to drive the source" is handled
   by editor-side wire-flipping or by an `intermediate: true` pipeline
   first-step (see below).

2. **Intra-job only.** Refs do not reach across `.mosaic` files. A
   `.mosaic` artifact is a self-contained intermediate description;
   cross-file reuse should render to video and use as a
   `MosaicMediaSource`.

3. **Flattened-DSL keyspace.** `flattenedStableKey` resolves against
   the *post-flatten* root DSL of the doc (or pipeline step). Nested
   children's local keys get rewritten into the parent's keyspace at
   flatten time — refs see the namespaced final form. The field is
   named `flattenedStableKey` (not just `stableKey`) to keep the
   keyspace visible at every call site.

4. **Chains terminate by construction.** Ref→ref→ref→… is allowed; the
   chain walks strictly earlier in evaluation order and bottoms out at
   the first node (which can't itself be a ref).

5. **Mismatch resolution reuses existing source props.** Duration via
   `playback.loopMode` (`"loop"` / `"freeze"` / `"cut"`); size via
   `placement.fit` (`"contain"` / `"cover"`); cross-step
   pixfmt/fps/alpha — engine-internal.

---

## Multi-output — two distinct axes

Both `MosaicDocument` and `MosaicDocumentPipeline` carry an
`outputs?: Record<string, MosaicOutput>` map. They support two
orthogonal use cases:

### Axis 1 — Multi-canvas / multi-format (both doc and pipeline)

One source of content rendered to N canvas/format combos:

```jsonc
{
  "outputs": {
    "desktop": { "size": { "width": 1920, "height": 1080 }, "target": "web-mp4" },
    "mobile":  { "size": { "width": 375,  "height": 667  }, "target": "web-mp4" },
    "social":  { "size": { "width": 1080, "height": 1080 }, "target": "image-png" },
    "alpha":   { "size": { "width": 1920, "height": 1080 }, "target": "alpha-mov" }
  }
}
```

→ One render job, four files. Engine prefers the `tee` muxer when
entries share codec settings (one encode, N muxes); falls back to
multi-`-map` when codecs diverge.

### Axis 2 — Per-step emission (pipeline only, top-level only)

```jsonc
{
  "kind": "mosaic_pipeline",
  "steps": [
    { "file": <mobileDoc>, "durationMs": 5000 },
    { "file": <desktopDoc>, "durationMs": 5000 }
  ],
  "outputs": {
    "default": { "emit": "multi" }
  }
}
```

→ Two files: one for each step. Different *content* per file because
each step is its own MosaicDocument.

### Combined

A 3-step pipeline with
`outputs.desktop = { size: 1920×1080, emit: "multi" }` +
`outputs.mobile = { size: 375×667, emit: "single" }` produces:
`desktop-step-0.mp4`, `desktop-step-1.mp4`, `desktop-step-2.mp4`,
and `mobile.mp4` — four files from one render job.

---

## Pipeline nesting — collapse rules

When a `MosaicDocumentPipeline` is **nested** (lives in a parent doc's
`children` map), it must produce exactly one clip for the parent slot.
Two collapse rules apply:

### Duration summing

| Condition | Behavior |
|---|---|
| Slot duration `T` > sum of step durations | Concat all steps, then fall back to embedding source's `playback.loopMode` (default `"loop"`) |
| Slot duration `T` ≤ sum of step durations | Walk steps in order, trim the last step to fit, concat |

### Canvas / format collapse

| Source | Rule |
|---|---|
| Parent slot canvas (always present when nested) | Wins — every step renders into it |
| Per-step `outputs.<key>.size` declarations | Overridden under nesting |
| `emit: "multi"` | Silently downgraded to `"single"` + `PIPELINE_EMIT_MULTI_DOWNGRADED` warning |

## Pipeline intermediate steps (let-binding pattern)

A pipeline step can opt out of the output via `intermediate: true`:

```jsonc
{
  "steps": [
    { "intermediate": true, "durationMs": 5000, "file": <headerStripDoc> },
    { "durationMs": 30000, "file": <mainContentDoc> }
  ]
}
```

The intermediate step **renders** for its `durationMs` (so later
steps can ref it via `MosaicRefSource.stepIndex: 0`) but is
**excluded from output**:

- Not concatenated under `emit: "single"`.
- Not emitted as a file under `emit: "multi"`.
- Does not contribute to the pipeline's total concat duration.
- `transitionToNext` is ignored.

Think of it as a `let varName = <render>` declaration — content that
exists in the workspace for back-edge refs but isn't part of the
visible output. Useful when a specific canvas / format must drive a
canonical source that multiple later cells mirror, without that
source being a "scene" in its own right.

At least one step must be non-intermediate; otherwise the engine
emits `PIPELINE_NO_OUTPUT_STEPS`.

---

## Pipeline top-level — canvas resolution

When a `MosaicDocumentPipeline` is **top-level** with `emit: "single"`:

| Precedence | Source |
|---|---|
| 1 | Explicit `outputs.<key>.size` (user override always wins) |
| 2 | **Element-wise max** of `step.file.outputs.<...>.size` (lossless) |
| 3 | Engine default / CLI flags |

Duration follows the same precedence ladder: explicit
`outputs.<key>.durationMs` → sum of `step.durationMs`.

Under `emit: "multi"` no canvas resolution is needed — each step emits
its own file using its own canvas.

---

## `MosaicOutputTarget` presets

| Target | Container | Video codec | Audio codec | Notes |
|---|---|---|---|---|
| `web-mp4` | mp4 | libx264 | aac | + `-movflags +faststart` for HTTP-progressive playback |
| `web-webm` | webm | libvpx-vp9 | libopus | **VP9 CRF inverted** (0=best, 63=worst) |
| `alpha-mov` | mov | prores_ks (profile 4) | pcm_s24le | yuva444p10le; alpha preserved |
| `image-png` | png | — | — | lossless, alpha; single frame or sequence |
| `image-jpeg` | jpeg | — | — | lossy; no alpha |
| `animated-gif` | gif | — | — | engine auto-applies `palettegen` + `paletteuse` |
| `audio-mp3` | mp3 | — | libmp3lame | 192k stereo default |
| `audio-wav` | wav | — | pcm_s16le | uncompressed |

Per-field fields on `MosaicOutput.format` / `audio` / `color` /
`metadata` override the preset's defaults.

---

## Container coverage

### `VIDEO_CONTAINERS` (16)

mp4 · webm · mkv · mov · m4v · avi · flv · ts · m2ts · mpg · 3gp ·
3g2 · wmv · asf · f4v · mxf · dv · nut

### `IMAGE_CONTAINERS` (9)

png · jpeg · gif · apng · webp · avif · tiff · bmp · ico

**GIF is animation-capable** despite the image-container
classification. Input: `MosaicMediaSource` with `mediaType: "video"`
(ffmpeg decodes GIF as a video stream). Output: `animated-gif` target
pairs the `gif` encoder with `palettegen` + `paletteuse`.

### `AUDIO_CONTAINERS` (12)

mp3 · wav · flac · aac · m4a · ogg · opus · ac3 · eac3 · dts · amr ·
caf

**Engine support is the gating factor** — the type lists what's
typeable; `resolveOutputFormat` in `@m0saic/core` defines what's
actually wired end-to-end. The `(string & {})` escape hatch on
`MosaicOutputFormat.container` accepts anything for forward-compat.

---

## Codec coverage

### `VIDEO_CODECS` (26)

**Software (9)**: libx264 · libx265 · libopenh264 · libvpx-vp9 ·
libaom-av1 · libsvtav1 · prores_ks · prores_aw · mjpeg

**Apple VideoToolbox (3)**: h264_videotoolbox · hevc_videotoolbox ·
prores_videotoolbox (Apple Silicon)

**NVIDIA NVENC (3)**: h264_nvenc · hevc_nvenc · av1_nvenc (Ada+)

**Intel Quick Sync (4)**: h264_qsv · hevc_qsv · av1_qsv (Arc+) ·
vp9_qsv

**AMD AMF (3)**: h264_amf · hevc_amf · av1_amf (RDNA 3+)

**Linux VAAPI (5)**: h264_vaapi · hevc_vaapi · av1_vaapi · vp9_vaapi ·
mjpeg_vaapi

Hardware encoders are **5–20× faster** than software, with a
quality-per-byte tradeoff (software still wins bitrate efficiency).
Engine probes availability at startup; falls back to software with a
`HARDWARE_ENCODER_FALLBACK` diagnostic.

### `AUDIO_CODECS` (6)

aac · libmp3lame · libopus · flac · pcm_s16le · pcm_s24le

---

## Pixel formats

8-bit: yuv420p · yuvj420p · yuv422p · yuvj422p · yuv444p · yuvj444p ·
yuva420p · yuva422p · yuva444p · rgb24 · bgr24 · rgba · argb · bgra ·
abgr · gray · ya8

10-bit: yuv420p10le · yuv422p10le · yuv444p10le · yuva444p10le ·
gbrp · gbrp10le

Palette: pal8 (GIF)

Alpha encoding follows the pixel-format name (`yuva*`, `rgba`, `argb`,
`bgra`, `abgr`). `hasAlpha` is **not** a separate field — pixfmt is
the source of truth. ProRes is the only exception: profile 0–3 cannot
carry alpha even with `yuva*` pixfmt; profile 4 / 4444xq required.

---

## Three places metadata lives — don't confuse them

| | File-lifecycle stamps | `MosaicFileMeta` | `MosaicContainerMetadata` |
|---|---|---|---|
| **Location** | `MosaicDocument.created/app/appVersion`; same on `MosaicDocumentPipeline`, `M0File`, `M0cFile`, `M0pFile`, `M0vFile` | `MosaicDocument.meta`, `MosaicDocumentPipeline.meta`, `M0vFile.meta` (planned) | `MosaicOutput.metadata` |
| **Describes** | When + by what the *source file* was written | User-authored content metadata about the *source artifact* | Rendered *output* file (mp4 / mov / mp3) |
| **Written to** | JSON header (top level) | JSON header (`meta` block) | Container atoms (mp4 `ilst`, MKV tags, ID3v2, …) |
| **Fields** | `created`, `app`, `appVersion` | `title`, `author`, `source`, `note` | `title`, `description`, `author`, `copyright`, `comment`, `encoder` |
| **Set by** | CLI / electron writer at save time | Author / template / editor | Author / template / editor |
| **Aligned with** | `M0File` / `M0cFile` / `M0pFile` family (identical field names) | `M0FileMeta` / `M0cFileMeta` / `M0pFileMeta` (structurally identical) | ffmpeg `-metadata` flag surface |

**Templates MUST NOT set `created`** — wall-clock dependency violates
determinism (the agent contract §9). `app` and `appVersion` are
permitted to be `null` (M0-family convention) when the writer can't
attribute itself.

---

## Structured data transport — `variables`, `MosaicDataSource`, aliases

The redesign adds a back-edge data channel for **cross-pipeline-step**
communication. Within a single MosaicDocument, the parent template
already holds nested-render results in its TypeScript scope — no
engine channel is needed. The two cases:

### Three patterns, no overlap

| Goal | Pattern | Step intermediate? |
|---|---|---|
| **Within one doc** — cell A runs a nested template that produces both a renderable result and structured data; cell B needs that data | Nested template returns a doc with `doc.variables` set. The parent template destructures it from `renderNestedTemplate`'s return value in TypeScript. | n/a — within-doc, no engine channel |
| **Cross-step, real render publishes data alongside** — step N produces a real visible step *and* exports data | Real source(s) in `doc.sources` + `doc.variables` on the doc | No — step is a real output, concatenated |
| **Cross-step, non-rendering data shortcut** — step N exists only to fetch/derive and publish | One or more `MosaicDataSource`s in `doc.sources`; no other source kinds | Yes — auto-enforced |

The cross-step patterns are **mutually exclusive within a single
doc**. A `MosaicDataSource` array may contain one or many entries
(typically one per logical data block / alias — `templateContext`,
`designTokens`, `seasonData`, …) — multiple data sources is the
recommended organizational pattern when a step publishes several
independent named payloads.

> **2026-05-14 amendment:** The originally-specced
> `MOSAIC_DATA_SOURCE_MIXED_WITH_RENDERABLE` constraint (forbidding
> mixed renderable + data sources in one `doc.sources`) was
> **dropped** — formalizing the data-source-as-non-rendering-cell
> pattern. A `MosaicDataSource` may now sit alongside renderable
> sources; each occupies a cell that renders the degenerate
> `MOSAIC_DATA_SOURCE_CARRIER` (1s × 16×16 black), exactly
> analogous to how an audio-only media source occupies a cell with
> an empty visual buffer. See `AUDIT/source.md` and the templates
> doc at the internal templates notes for current guidance.

`ctx.upstreamVariables` / `ctx.upstreamData` are populated **only
at pipeline-step boundaries**. They exist because step N+1's render
context is opaque to step N's TypeScript closure; within a single
doc, the calling template already has full control and doesn't need
a side channel.

### The let-binding analogy (Scenario 2)

The pipeline-boundary pattern is `let varName = value` at the
authoring tier, paired with `ref` on the rendering tier:

| Tier             | Author emits                          | Downstream reads                          |
|------------------|---------------------------------------|-------------------------------------------|
| **Video output** | A rendered cell (flattened stableKey) | `MosaicRefSource.flattenedStableKey`      |
| **Structured data** | `MosaicDataSource.variables` in an intermediate step | `ctx.upstreamVariables` (flat) / `ctx.upstreamData[alias]` (namespaced) |

Both pair with the same back-edge invariant: every read resolves
against something that came *before* in evaluation order. No
backtracking, no forward refs.

### Two-tier model (file = opaque, template = typed)

| Layer              | Shape                                  | Why                                                                 |
|--------------------|----------------------------------------|---------------------------------------------------------------------|
| File format        | `Record<string, unknown>`              | `.mosaic` files are durable artifacts; opaque keeps tools decoupled |
| Template definition| `outputsSchema` / `upstreamVariablesSchema` / `upstreamDataSchema` keyed on `keyof O`/`keyof U`/`keyof D` | Code-level introspection for editors, engine, LSP                   |

The file-format `variables` field stays `Record<string, unknown>` —
hand-authored files and external tools work without the producing
template in scope. The template tier carries the typed contract so
editors and the engine can introspect.

### `MosaicDataSource` — a pipeline-boundary "variables-only" source

```
MosaicSource =
  | MosaicMosaicSource
  | MosaicMediaSource
  | MosaicTextSource
  | MosaicLavfiSource
  | MosaicRefSource
  | MosaicDataSource            ← new
```

```ts
type MosaicDataSource = {
  type: "data";
  variables: Record<string, unknown>;
  alias?: string;        // namespaced downstream reads
  editor?, engine?;
};
```

**No `carrier` knob.** The carrier render is an engine-internal
placeholder fixed by convention — authors never see it. The constant
`MOSAIC_DATA_SOURCE_CARRIER` (1s × 16×16 black) lives in the engine
so the placeholder cell round-trips through the existing renderable
plan without special-casing.

If you want pixels *and* data on the same step, two options
(amended 2026-05-14):

1. Put real renderable source(s) + a `MosaicDataSource` (typically
   with `alias` for namespacing) in the same `doc.sources`. The
   data source occupies a degenerate carrier cell, analogous to
   audio-only media sources.
2. Or use a real source and set `doc.variables` on the doc for the
   flat (no-alias) variant.

**Required invariants (engine-enforced):**
- *Pure data-only* step (no renderables in `sources`) must be
  marked `intermediate: true`; the placeholder carrier landing in
  the final output is a mistake. `PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE`
  is an **error**. *Mixed* steps don't trigger this — they emit
  real pixels via their renderables.
- ~~Not mixed with real renderable sources in the same `doc.sources`
  array — `MOSAIC_DATA_SOURCE_MIXED_WITH_RENDERABLE` is an
  **error**.~~ **Dropped 2026-05-14.** Mixed renderable + data
  sources are allowed; see the amendment box above.
- Inside a non-pipeline document has no downstream consumer —
  `MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE` (warning).

Editor affordance: a typed `type: "data"` source renders as a
named "data block" pill (icon + alias + key list) instead of a video
preview, and wiring lines connect data-block outputs to consumer
`upstreamVariablesSchema` / `upstreamDataSchema` slots.

### Aliases — `templateContext.team` instead of flat-union lookups

`MosaicDataSource.alias` declares a short, author-friendly name for
the data block. Its only role is **namespaced data reads**:
`ctx.upstreamData[alias]` surfaces this data block's `variables`
separately from the flat union.

Aliases are **exclusively a data-read channel.** They have no role
in `MosaicRefSource` — refs mirror pixels, and a data source has no
real pixels to mirror. Pointing a `MosaicRefSource` at a
`MosaicDataSource` is structurally invalid and an **error**
(`MOSAIC_DATA_SOURCE_VISIBLE_USE`).

### Engine context shape (post-redesign)

```ts
type MosaicEngineContext<
  U extends MosaicTemplateUpstreamVariables = MosaicTemplateUpstreamVariables,
  D extends MosaicTemplateUpstreamData = MosaicTemplateUpstreamData,
> = {
  // ...existing (output, target, media, cache)...
  upstreamVariables?: Readonly<U>;   // flat union, last-write-wins
  upstreamData?: Readonly<D>;        // by-alias namespaced view
};
```

Generic defaults preserve existing single-arg call sites. Consumers
that want typed reads parameterize:

```ts
type Ctx = MosaicEngineContext<
  { topContributor: string; commitsToday: number },
  { templateContext: { team: string; season: number } }
>;
```

### Typed schemas on `MosaicTemplate<P, O, U, D>`

```ts
interface MosaicTemplate<
  P extends MosaicTemplateProps         = MosaicTemplateProps,
  O extends MosaicTemplateOutputs       = MosaicTemplateOutputs,
  U extends MosaicTemplateUpstreamVariables = MosaicTemplateUpstreamVariables,
  D extends MosaicTemplateUpstreamData  = MosaicTemplateUpstreamData,
> {
  // ...existing (id, label, version, capabilities, propsSchema, defaultProps, ...)...

  outputsSchema?:          Partial<Record<keyof O, MosaicTemplateVariableDefinition>>;
  upstreamVariablesSchema?: Partial<Record<keyof U, MosaicTemplateVariableDefinition>>;
  upstreamDataSchema?:     Partial<Record<keyof D, {
    description?: string;
    variables: Partial<Record<string, MosaicTemplateVariableDefinition>>;
  }>>;
  defaultOutputs?: O;

  render: (props: P, ctx: MosaicEngineContext<U, D>) => Promise<MosaicRenderableFile>;
}
```

Variable type set is JSON-only — no `media` / `group` / `list` /
`m0`. Those are UI affordances on `MosaicTemplatePropType`; variables
are pure data:

```ts
type MosaicTemplateVariableType =
  | "string" | "string[]"
  | "number" | "number[]"
  | "boolean" | "boolean[]"
  | "object"
  | "any";
```

### Canonical "fetch + publish + ref" pattern

A capability-tier template publishes structured data once; downstream
core-tier templates consume it for the rest of the video. The
sports-reel season-data example:

```jsonc
// some-render.mosaic (kind: "mosaic_pipeline")
{
  "kind": "mosaic_pipeline",
  "version": 1,
  "steps": [
    // Step 0: side-effecting fetch + publish.
    //  - intermediate:true  → carrier NOT in final video
    //  - data source        → minimal 1s × 16×16 carrier
    //  - alias              → namespaced reads downstream
    //  - capability-tier    → net.fetch granted by host
    {
      "intermediate": true,
      "durationMs": 1,
      "file": {
        "kind": "mosaic_document",
        "version": 1,
        "m0": "1",
        "assets": {},
        "sources": [{
          "type": "data",
          "alias": "templateContext",
          "variables": {
            "team": "lakers",
            "season": 2025,
            "topScorer": "doncic",
            "schedule": [/* ... */]
          }
        }]
      }
    },

    // Steps 1+: regular renderables, core-tier, reading the
    // upstream data block by alias.
    { "durationMs": 5000, "ref": "@m0saic/sports/team-intro/v0" },
    { "durationMs": 8000, "ref": "@m0saic/sports/scoreboard/v0" },
    { "durationMs": 4000, "ref": "@m0saic/sports/closing-card/v0" }
  ]
}
```

Downstream template body:

```ts
interface UpData extends MosaicTemplateUpstreamData {
  templateContext: { team: string; season: number; topScorer: string };
}

const teamIntro: MosaicTemplate<
  TeamIntroProps,
  MosaicTemplateOutputs,
  MosaicTemplateUpstreamVariables,
  UpData
> = {
  // ...
  upstreamDataSchema: {
    templateContext: {
      description: "Season data block published by step 0",
      variables: {
        team:      { type: "string", required: true },
        season:    { type: "number", required: true },
        topScorer: { type: "string", required: true },
      },
    },
  },
  render: async (_, ctx) => {
    const team = ctx.upstreamData?.templateContext.team;
    // typed as string | undefined
    // ... build the team intro using team + season + topScorer ...
    return /* ... */;
  },
};
```

### Cross-step ref handoff via `variables`

A common authoring pattern: step 0 renders a real visual whose cells
step 1 wants to mirror. The consumer (step 1) needs to know:

1. The `stepIndex` of the producer.
2. The `flattenedStableKey` of the cell — only the *producer*
   template knows this at author time, because it builds the m0
   geometry.

Solution: the producer self-stamps both via `doc.variables`, using
its own step index from `ctx.pipelineStep`. No out-of-band assembly
contract required:

```ts
// Step 0 — real render that publishes a self-describing ref handoff:
return {
  kind: "mosaic_document",
  version: 1,
  m0: m0("2(1,1)"),
  assets: {},
  sources: [
    { type: "media", mediaType: "video", assetId: heroAsset, stableKey: "intro_hero" },
    { type: "text",  layers: [/* ... */] },
  ],
  variables: {
    introHero: {
      stepIndex: ctx.pipelineStep!.index,
      flattenedStableKey: "intro_hero",
    },
  },
};

// Step 1 — reads and spreads:
return {
  kind: "mosaic_document",
  version: 1,
  m0: m0("1"),
  assets: {},
  sources: [{
    type: "ref",
    ...ctx.upstreamVariables!.introHero,
    effects: { rounding: { borderRadius: 0.12 } },
  }],
};
```

The producer owns the geometry → the published key is correct by
construction. m0 geometry doesn't change at render time, so the
handoff is stable. `ctx.pipelineStep` lets the producer self-stamp
its index so the handoff is fully self-describing — the consumer
template doesn't need any out-of-band knowledge of where in the
pipeline the data came from.

### `ctx.pipelineStep` — knowing where you are

```ts
type MosaicPipelineStepContext = {
  index: number;        // 0-based position in this pipeline
  total: number;        // total step count
  intermediate: boolean; // whether this step is intermediate
};

// on MosaicEngineContext:
pipelineStep?: MosaicPipelineStepContext;
```

Populated only when the render is a pipeline step. Undefined for
top-level non-pipeline renders. For nested pipelines (a pipeline
inside a parent doc's `children`), refers to the innermost
containing pipeline — chain semantics can be added additively
later.

**Namespacing note.** The flattener prefixes nested children's
keys (`c0_`, `c1_`, …). When publishing a key for a cell inside a
`children` entry, the producer must publish the prefixed form. A
`template-utils` helper for computing the prefix is on the
engine-wiring follow-up; for v1 the contract is just "publish
whatever `flattenedStableKey` the consumer should pass into a
ref."

### Tier-aware determinism rule

Variable derivation follows the existing
`MosaicTemplateCapabilities` contract:

- **Core-tier** (`tier: "core"`): variables MUST be deterministic
  from props + `ctx.target` + probed media metadata. No wall-clock,
  no random, no side effects.
- **Capability-tier** (`tier: "capability"`): variables MAY be
  populated from results of explicitly-granted capabilities (net
  fetch, fs read, exec spawn). This is the intended escape hatch
  for the fetch-and-publish pattern above.

Cross-run reproducibility is governed by the host — the engine
itself does not cache, and `ctx.cache` is not part of the template
contract.

---

## Structured-data delivery to the user — `sidecars`

Distinct from `variables`. Variables flow between templates;
sidecars flow to the **end user / caller** as files on disk.

| Channel | Audience | Persistence | Filename pattern |
|---|---|---|---|
| `doc.variables` / `MosaicDataSource.variables` | Other templates / pipeline steps | In-memory, render-scoped | (no file — read via `ctx.upstreamVariables` / `ctx.upstreamData`) |
| `doc.sidecars` | End user / caller | **Written to disk** alongside the rendered output | `{output-basename}.{sidecar-key}.json` |

### Shape

```ts
// File format — opaque
type MosaicDocument = { /* ... */ sidecars?: Record<string, unknown> };
type MosaicDocumentPipeline = { /* ... */ sidecars?: Record<string, unknown> };

// Template tier — typed
type MosaicTemplateSidecars = Record<string, unknown>;
interface MosaicTemplate<P, O, U, D, S extends MosaicTemplateSidecars> {
  // ...
  sidecarsSchema?: Partial<Record<keyof S, MosaicTemplateVariableDefinition>>;
}
```

`MosaicTemplate` now has 5 generics (`P, O, U, D, S`); all default,
so legacy `MosaicTemplate<P>` still compiles.

### Canonical use case — forensic watermark

```ts
interface WatermarkSidecars extends MosaicTemplateSidecars {
  watermark: {
    algorithm: "lsb" | "dct" | "phase";
    seed: string;
    embeddedAt: ReadonlyArray<{ frame: number; region: { x: number; y: number; w: number; h: number } }>;
    recoveryKey: string;
  };
}

const forensicWatermark: MosaicTemplate<
  WatermarkProps, MosaicTemplateOutputs,
  MosaicTemplateUpstreamVariables, MosaicTemplateUpstreamData,
  WatermarkSidecars
> = {
  // ...
  sidecarsSchema: {
    watermark: { type: "object", required: true, description: "Forensic embedding record" },
  },
  render: async (props, ctx) => ({
    kind: "mosaic_document",
    // ...the watermarked render...
    sidecars: {
      watermark: { algorithm: "lsb", seed: "...", embeddedAt: [/* ... */], recoveryKey: "..." },
    },
  }),
};
```

At render time:
- Output: `forensic-hero.mp4`
- Sidecar: `forensic-hero.watermark.json` (the embedding record, for later verification)

A template can declare any number of named sidecars; each top-level
key in `doc.sidecars` becomes its own JSON file.

### Pipeline-level vs. per-step

- **Pipeline-level** (`MosaicDocumentPipeline.sidecars`): render-summary
  data delivered alongside the pipeline's primary output (step
  count, total duration, audit info).
- **Per-step** (`step.file.sidecars`): each step's own sidecars
  land next to that step's individual output under `emit: "multi"`,
  or contribute alongside the concatenated output under
  `emit: "single"`. Engine wiring follow-up will decide
  consolidation rules.

### What's deferred

- Custom filename suffixes / formats (only `.json` in v1).
- Per-output sidecar grouping in multi-output renders (sidecars
  are doc-level in v1 — same files for every output entry).
- Engine wiring: ~~`SIDECAR_NOT_YET_IMPLEMENTED` warning emitted
  pre-wiring~~ — **landed 2026-05-17**. `@m0saic/core` exports
  `writeSidecars(renderable, outputPath)` and the CLI + Electron
  render paths invoke it on successful render. The diagnostic code
  remains registered for ABI but is never emitted.
  `SIDECAR_SCHEMA_MISMATCH` for drift is still deferred until
  validation wiring lands.

---

## New diagnostic codes

```
HARDWARE_ENCODER_FALLBACK                        (warning)

MOSAIC_REF_NOT_YET_IMPLEMENTED                   (warning — stub)
MOSAIC_REF_CELL_NOT_FOUND                        (error)
MOSAIC_REF_FORWARD_REFERENCE                     (error — back-edge invariant)
MOSAIC_REF_AMBIGUOUS_STABLEKEY                   (error)

MOSAIC_OUTPUTSREF_NOT_FOUND                      (error)
MOSAIC_OUTPUTSREF_INVALID                        (error)

MULTI_OUTPUT_NOT_YET_IMPLEMENTED                 (warning — stub)
MULTI_OUTPUT_CODEC_VARIATION                     (info — tee→multi-map fallback)

PIPELINE_EMIT_MULTI_NOT_YET_IMPLEMENTED          (warning — stub)
PIPELINE_EMIT_MULTI_DOWNGRADED                   (warning — nested override)
PIPELINE_NESTED_CANVAS_COLLAPSED                 (info — step dims overridden)
PIPELINE_NO_OUTPUT_STEPS                         (error)

OUTPUT_TARGET_NOT_YET_IMPLEMENTED                (warning — preset stub)
OUTPUT_TARGET_FORMAT_CONFLICT                    (warning — per-field override contradicts target)
UNSUPPORTED_COMBINATION                          (error   — codec/container/pixfmt triple has no resolution)
AUDIO_CODEC_SUBSTITUTED                          (warning — codec swapped for container compat)

VARIABLES_NOT_YET_IMPLEMENTED                    (warning — stub)
VARIABLES_SCHEMA_MISMATCH                        (warning — drift vs. schema)
SIDECAR_NOT_YET_IMPLEMENTED                      (warning — stub)
SIDECAR_SCHEMA_MISMATCH                          (warning — drift vs. sidecarsSchema)
MOSAIC_DATA_SOURCE_VISIBLE_USE                   (error   — ref targets a data source; refs need pixels)
MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE              (warning — data source outside a pipeline step)
# MOSAIC_DATA_SOURCE_MIXED_WITH_RENDERABLE       (DROPPED 2026-05-14 — mixed renderable + data is allowed; data sources sit in a carrier cell like audio-only media)
MOSAIC_ALIAS_COLLISION                           (warning — duplicate alias)
PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE         (error   — pure data-only step without intermediate:true)
```

`MOSAIC_REF_CYCLE_DETECTED` was considered but is **not in the
surface** — back-edge invariant makes cycles structurally
impossible.

---

## Identifier hygiene — branded tier types + published regex patterns

ffmpeg is powerful but particular about string shapes: filtergraph
labels, mapping refs, expression vars, output paths — every one of
them has its own quoting and character restrictions, and a single
wonky character anywhere in the pipeline turns into a hard-to-debug
runtime failure. Keeping the internal graph clean and only
*resolving* troublesome strings at the consumption boundary is the
only scalable model at the composability we're targeting.

`packages/types/src/identifiers.ts` is the single source of truth.
It publishes five **regex tier patterns** alongside matching
predicates, branded types, and cast helpers.

### The five tiers

| Tier | Pattern | Used for |
|---|---|---|
| `STRICT_IDENTIFIER_PATTERN` | `^[a-zA-Z_][a-zA-Z0-9_]{0,63}$` | Engine-internal keys: `MosaicDocument.labels`, `MosaicDocument.children`, `MosaicDocument.variables`, `MosaicDocument.sidecars`. Keys that flow into ffmpeg as filter-graph labels, into TypeScript as `ctx.upstreamVariables.foo` dot access, and into sidecar filenames. |
| `FRIENDLY_SLUG_PATTERN` | `^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,127}$` | Author-facing names with hyphens/dots, e.g. `MosaicDocument.outputs` keys (become `{base}.{outputName}.{ext}` filename segments). Filename-safe but permits the `alpha-master` / `v1.0.0` shapes authors expect. |
| `FLATTENED_STABLE_KEY_PATTERN` | `^(c\d+_)*[a-zA-Z_][a-zA-Z0-9_]{0,63}$` | `MosaicRefSource.flattenedStableKey` — strict identifier with optional `c<N>_` namespace prefixes added by the flatten pass. |
| `NAMESPACED_ID_PATTERN` | `^@?[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$` | Globally unique ids: `MosaicTemplate.id` (`@m0saic/dj/session-hero/v1`), `MosaicDictionaryEntry.id` (`splits/2-col`). |
| `DIAGNOSTIC_CODE_PATTERN` | `^[A-Z][A-Z0-9_]{0,63}$` | `MosaicDiagnostic.code` — SCREAMING_SNAKE_CASE codes for stable test/tooling pins. |

### Brand types — atomic fields only

Where the field is a single atomic value (not a Record key), the
type is **branded** so a raw string literal fails compilation and
the cast site is the natural place to validate at the boundary:

| Field | Type before | Type after |
|---|---|---|
| `MosaicRefSource.flattenedStableKey` | `string` | `FlattenedStableKey` |
| `MosaicDataSource.alias` | `string` | `AliasId` |
| `MosaicTemplate.id` | `string` | `TemplateId` |
| `MosaicDictionaryEntry.id` | `string` | `DictionaryEntryId` |
| `MosaicDiagnostic.code` | `string` | `DiagnosticCode` |

Following the existing `AssetId` pattern: `declare const Brand:
unique symbol; type X = string & { readonly [Brand]: true }`. Cast
helpers (`asFlattenedStableKey`, `asAliasId`, `asTemplateId`,
`asDictionaryEntryId`, `asDiagnosticCode`) are unchecked casts —
the predicate functions (`isStrictIdentifier`, `isFriendlySlug`,
`isFlattenedStableKey`, `isNamespacedId`, `isDiagnosticCode`) are
the validators, called at JSON parse boundaries.

### Record-keyed fields — tier annotations, not brands

Branding Record keys is hostile to object-literal authoring
(`{ [asFooKey("hero")]: { ... } }`). For those, the field stays
`string` and the **JSDoc declares the expected tier**. Today this
covers:

- `MosaicDocument.labels` — STRICT_IDENTIFIER
- `MosaicDocument.children` — STRICT_IDENTIFIER (namespace prefix on flatten)
- `MosaicDocument.variables` — STRICT_IDENTIFIER (dot-access target)
- `MosaicDocument.sidecars` — STRICT_IDENTIFIER (becomes filename segment)
- `MosaicDocument.outputs` — FRIENDLY_SLUG (filename-safe)
- `MosaicDocumentPipeline.variables` / `.sidecars` / `.outputs` — same tiers

The published regexes mean external validators (CLI lint,
dev-server schema check, editor form validation) can pin to the
same definitions without re-implementing them.

### Platform boundary

The boundary layer (`@m0saic/platform`) is expected to wrap the
cast helpers in friendlier APIs — e.g., `makeFlattenedStableKey({
prefixDepth: 2, name: "intro_hero" }) → FlattenedStableKey`. The
types package only publishes the contract; ergonomic key
construction lives one tier up.

### What's NOT branded (yet)

- `outputsRef` / `labelsRef` / `assetsRef` — these are URI-shaped
  strings (potentially with `#variant` fragments). Migrating them
  to `AssetId` requires extending `MosaicAsset` for fragment
  support and touches every file-format authoring surface;
  deferred to a focused follow-up.
- Free-form user content (titles, descriptions, captions) — these
  are Unicode-permissive by design and should never be tightened.

---

## What's NOT in this PR

Engine wiring lands in focused follow-up PRs:

- Target preset resolution (`web-mp4` → concrete defaults).
- Engine emission of `format.crf` / `bitrate` / `encoderPreset` /
  `encoderProfile` / `gopSize`.
- `encoderOptions` flattening per-codec (`-x264-params k=v:...` etc.).
- `audio.*` engine wiring (codec, bitrate, sampleRate, channelLayout).
- `color.*` color-tag flag emission.
- `metadata.*` container-atom writing.
- Multi-output execution (`tee` muxer + multi-`-map`).
- Pipeline `emit: "multi"` execution.
- `MosaicRefSource` engine resolution.
- `.m0v` loader and `outputsRef` merge.
- Make / Compose UI for the new fields.
- Back-edge `variables` collection + threading to
  `ctx.upstreamVariables` / `ctx.upstreamData` at pipeline-step
  boundaries.
- `MosaicDataSource` carrier render (fixed
  `MOSAIC_DATA_SOURCE_CARRIER`) + alias-table build at plan time.
- Schema validation at render boundaries
  (`outputsSchema` / `upstreamVariablesSchema` / `upstreamDataSchema`).
- `@m0saic/template-utils` `renderNestedTemplate` return shape — must
  surface the nested doc's `variables` field to the calling
  template so Scenario 2 (within-doc data flow in TypeScript)
  works ergonomically.

---

## Deferred-features inventory (Phase 0 → Phase 3 hand-off)

Closed inventory of every field, behavior, or diagnostic that the
types package declares but the engine does not yet act on. This is
the master list the Phase 2 connectivity matrix walks; every entry
becomes a "needs-wiring" row to be addressed in a Phase 3 sub-epic.

See `epic.md` at the repo root for the phased plan that consumes
this inventory.

### Engine wiring deferred (type exists; engine ignores today)

| File | Field / Symbol | Owning Phase 3 sub-epic |
|---|---|---|
| `document/document.ts` | `labels`, `labelsRef` (.m0c / .m0p#variant) | 3g |
| `document/document.ts` | `outputs` (map; multi-output execution) | 3d |
| `document/document.ts` | `outputsRef` (.m0v inheritance) | 3d |
| `document/document.ts` | `variables` (cross-step threading) | 3b |
| `document/document.ts` | `sidecars` (end-user JSON delivery) | 3f |
| `document/document-pipeline.ts` | `outputs` (multi-output emission) | 3d, 3e |
| `document/document-pipeline.ts` | `variables` (pipeline-level seed) | 3b |
| `document/document-pipeline.ts` | `sidecars` (pipeline-level) | 3f |
| `output/output.ts` | `emit: "multi"` (per-step file emission) | 3e |
| `output/format.ts` | full `MosaicOutputFormat` field emission | 3d |
| `output/audio-config.ts` | `MosaicAudioConfig` field emission | 3d |
| `output/color-config.ts` | `MosaicColorConfig` color-tag flags | 3d |
| `output/container-metadata.ts` | `MosaicContainerMetadata` container atoms | 3d |
| `source/source.ts` | `MosaicRefSource` resolution | 3c |
| `source/source.ts` | `MosaicDataSource` carrier + alias resolution | 3b |
| `engine-context/engine-context.ts` | `upstreamVariables` threading | 3b |
| `engine-context/engine-context.ts` | `upstreamData` threading | 3b |
| `engine-context/engine-context.ts` | `mode: "render" \| "design"` gating in capability tier | 3h |
| `template/template.ts` | `M0C_LABEL_MISSING` / `M0P_VARIANT_MISSING` validation | 3g |
| `template/template.ts` | `VARIABLES_SCHEMA_MISMATCH` validation | 3h |
| `template/template.ts` | `SIDECAR_SCHEMA_MISMATCH` validation | 3f, 3h |

### Behavior deferred (planned engine behavior, not yet implemented)

| File | Behavior | Owning Phase 3 sub-epic |
|---|---|---|
| `output/output.ts` | Codec/container/pixfmt conflict resolution → `OUTPUT_TARGET_FORMAT_CONFLICT` | 3d |
| `document/document-pipeline.ts` | Nested `emit: "multi"` downgrade → `PIPELINE_EMIT_MULTI_DOWNGRADED` | 3e |
| `document/document-pipeline.ts` | Nested step canvas collapse → `PIPELINE_NESTED_CANVAS_COLLAPSED` | 3e |
| `source/source.ts` | Cross-step format negotiation rule map (re-encoding, setpts/fps normalization, alpha-aware compositing) | 3c, 3e |

### Reserved (declared in JSDoc only; no field yet)

| File | What's reserved | Notes |
|---|---|---|
| `source/source.ts` | Future `MosaicEffectProps` fields (`flipH`, `brightness`, `contrast`, `saturation`, `hueRotation`, `noise`, `grain`) | Wishlist in a comment. Add fields when a concrete consumer needs them — do not pre-add to the type. |
| `source/source.ts` | `MosaicRefSource.aliasRef` (sugar for ref-by-alias) | Removed during shape refinement; revisit only if real authoring friction shows up. |

### Pure TODO / follow-up notes

| File | Note |
|---|---|
| `source/source.ts` | Cross-step format negotiation rule map deferred to a focused follow-up. |
| `source/source.ts` | Child-doc stableKey namespacing helper for `template-utils` deferred to engine-wiring follow-up. |
| `template/template.ts` | TS cannot statically prove `doc.variables` matches `O` at v1; schemas are a doc/editor contract. Engine-side warnings land with 3h wiring. |

### Tracked outside the engine-wiring epic

- `outputsRef` / `labelsRef` / `assetsRef` → `AssetId` migration is a
  separate focused PR after Phase 1. Requires extending `MosaicAsset`
  for `#variant` fragments. Not part of any Phase 3 sub-epic.

### Codes covered by this inventory

Every "needs-wiring" entry above maps to one or more codes in the
{@link MOSAIC_DIAGNOSTIC_CODES} registry. A wiring sub-epic is
"done" when its diagnostic codes fire on the correct trigger
conditions and the corresponding `*_NOT_YET_IMPLEMENTED` stub stops
emitting.

---

## Test status

```
Test Suites: 15 passed, 15 total
Tests:       197 passed, 197 total
```

Co-located `.test.ts` covers every new + restructured type. See:
- `identifiers/identifiers.test.ts` (five tier patterns + brand cast helpers)
- `meta/meta.test.ts`
- `diagnostic/diagnostic.test.ts`
- `source/source.test.ts` (MosaicRefSource + MosaicDataSource + multi-data-source cases)
- `document/document.test.ts` (variables + data-source coexistence)
- `document/document-pipeline.test.ts` (variables + fetch+publish pattern)
- `engine-context/engine-context.test.ts` (generic narrowing of `U` and `D`)
- `template/template.test.ts` (4-param generics, JSON-only variable type set)
- `output/output.test.ts`
- `output/target.test.ts`
- `output/format.test.ts`
- `output/audio-config.test.ts`
- `output/color-config.test.ts`
- `output/container-metadata.test.ts`
