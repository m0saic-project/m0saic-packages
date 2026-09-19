# `source/` — connectivity matrix

**Source:** `packages/types/src/source/source.ts` (1167 LOC)
**Test:** `packages/types/src/source/source.test.ts`
**Phase 3 owners:** 3b (data sources / variables / aliases), 3c (refs)
**Visual-test mandate:** YES — `MosaicSource` variants are the principal render-path types. Every pixel-affecting cell on every variant gets a `V:` row in [coverage-map.md](./coverage-map.md).

---

## Summary (preliminary; gets updated as test cross-reference passes complete)

- **Total rows**: ~140 across 6 variants + supporting types
- **wired**: 0 confirmed yet (test cross-reference pass pending)
- **needs-wiring**: 25+ (refs entirely, data-source diagnostics, lavfi safety rails, alias resolution)
- **spec-only**: ~12 (editor metadata fields per variant)
- **deferred**: 2 (`MosaicLavfiSource.size`, `MosaicRefSource.stepIndex` enforcement)
- **pruning-candidate**: 1 (`MosaicLavfiSource.size` — "widespread use is a smell" per JSDoc)
- **pixel-affecting**: ~70 (every effect/visual/text-style/overlay/placement field across all variants)
- **non-visual**: ~30 (audio props, refs metadata, identifiers, discriminators)

---

## Types in this concept

- `MosaicSource` (closed union — top level)
- `MosaicMosaicSource` (variant: nested mosaic ref)
- `MosaicMediaSource` (variant: file-backed media)
- `MosaicTextSource` (variant: rendered text)
- `MosaicLavfiSource` (variant: lavfi / solid color generator)
- `MosaicRefSource` (variant: pixel mirror / back-edge ref)
- `MosaicDataSource` (variant: pipeline-boundary variables carrier)
- Supporting: `MosaicSourceMask`, `LoopMode`, `MosaicMediaKind`, `MosaicTextEval`, `MosaicTextContent`, `MosaicTextRenderMode`, `MosaicTextLayer`, `MosaicPlaybackProps`, `MosaicLavfiPlaybackProps`, `MosaicEffectProps`, `RoundingOptions`, `MosaicVisualProps`, `MosaicAudioProps`, `MosaicPlacementProps`, `MosaicPlacementContain`, `MosaicPlacementCover`, `MosaicBoxFrac`, `MosaicTextPlacementProps`, `MosaicTextStyleProps`, `MosaicOverlayExpr`, `MosaicOverlayBlendMode`
- Constants: `MOSAIC_DATA_SOURCE_CARRIER`

---

## Top-level union

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source` | `MosaicSource` | wired | n/a | — | `source.test.ts` (union narrowing) | — | Discriminated union over `type`. Closed. |

---

## Variant 1 — `MosaicMosaicSource` (type=mosaic)

Nested-document reference. The `ref` resolves through the parent's `children` map.

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.type=mosaic` | `MosaicMosaicSource` | wired | pixel-affecting | — | `source.test.ts` | `packages/core/__tests__/mosaicSource.spec.ts` | Nested doc inlined by flattener. |
| `T:source.type=mosaic.ref` | `MosaicMosaicSource.ref` | wired | pixel-affecting | — | `flattenMosaicDocument.test.ts` | (see flatten goldens) | `string` — stableKey into parent `children`. |
| `T:source.type=mosaic.placement` | `MosaicMosaicSource.placement` | wired | pixel-affecting | — | TBD | TBD | See `MosaicPlacementProps` rows. |
| `T:source.type=mosaic.playback` | `MosaicMosaicSource.playback` | wired | non-visual | — | TBD | n/a | Timing only. |
| `T:source.type=mosaic.effects` | `MosaicMosaicSource.effects` | wired | pixel-affecting | — | TBD | TBD | See `MosaicEffectProps` rows. |
| `T:source.type=mosaic.mask` | `MosaicMosaicSource.mask` | wired | pixel-affecting | — | TBD | TBD | See `MosaicSourceMask`. |
| `T:source.type=mosaic.visual` | `MosaicMosaicSource.visual` | wired | pixel-affecting | — | TBD | TBD | See `MosaicVisualProps`. |
| `T:source.type=mosaic.audio` | `MosaicMosaicSource.audio` | wired | non-visual | — | TBD | n/a | See `MosaicAudioProps`. |
| `T:source.type=mosaic.overlay` | `MosaicMosaicSource.overlay` | wired | pixel-affecting | — | TBD | TBD | See `MosaicOverlayExpr`. |
| `T:source.type=mosaic.editor` | `MosaicMosaicSource.editor` | spec-only | non-visual | — | — | n/a | UI metadata; engine ignores. |
| `T:source.type=mosaic.engine` | `MosaicMosaicSource.engine` | wired | non-visual | — | TBD | n/a | Engine-internal metadata. |

---

## Variant 2 — `MosaicMediaSource` (type=media)

File-backed media (image/video/audio) via `AssetId` lookup. The workhorse variant.

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.type=media` | `MosaicMediaSource` | wired | pixel-affecting | — | `source.test.ts` | `packages/core/__tests__/mediaSource.spec.ts` | Resolves through `MosaicDocument.assets[assetId]`. |
| `T:source.type=media.mediaType` | `MosaicMediaSource.mediaType` | wired | varies | — | TBD | TBD | Union `video`/`audio`/`image`. Audio cases skip placement/effects/visual/mask/overlay. |
| `T:source.type=media.mediaType=video` | `MosaicMediaSource` w/ `mediaType:"video"` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=media.mediaType=image` | `MosaicMediaSource` w/ `mediaType:"image"` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=media.mediaType=audio` | `MosaicMediaSource` w/ `mediaType:"audio"` | wired | non-visual | — | TBD | n/a | — |
| `T:source.type=media.assetId` | `MosaicMediaSource.assetId` | wired | pixel-affecting | — | `validateAssetManifest.test.ts` | — | Branded `AssetId`; manifest resolves to file/url/data-uri. |
| `T:source.type=media.placement` | `MosaicMediaSource.placement` | wired | pixel-affecting | — | TBD | TBD | Ignored for audio. |
| `T:source.type=media.playback` | `MosaicMediaSource.playback` | wired | non-visual | — | TBD | n/a | See `MosaicPlaybackProps`. |
| `T:source.type=media.effects` | `MosaicMediaSource.effects` | wired | pixel-affecting | — | TBD | TBD | Ignored for audio. |
| `T:source.type=media.mask` | `MosaicMediaSource.mask` | wired | pixel-affecting | — | TBD | TBD | Ignored for audio. |
| `T:source.type=media.visual` | `MosaicMediaSource.visual` | wired | pixel-affecting | — | TBD | TBD | Ignored for audio. |
| `T:source.type=media.audio` | `MosaicMediaSource.audio` | wired | non-visual | — | TBD | n/a | — |
| `T:source.type=media.overlay` | `MosaicMediaSource.overlay` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=media.editor` | `MosaicMediaSource.editor` | spec-only | non-visual | — | — | n/a | UI metadata. |
| `T:source.type=media.engine` | `MosaicMediaSource.engine` | wired | non-visual | — | TBD | n/a | — |

---

## Variant 3 — `MosaicTextSource` (type=text)

Rendered text via FFmpeg `drawtext`/`subtitles`. Layered: a base style + per-layer overrides.

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.type=text` | `MosaicTextSource` | wired | pixel-affecting | — | `source.test.ts` | `packages/core/__tests__/textSource.spec.ts` | — |
| `T:source.type=text.layers[]` | `MosaicTextSource.layers` | wired | pixel-affecting | — | TBD | TBD | Non-empty array of `MosaicTextLayer`. |
| `T:source.type=text.layers[].content.kind=literal` | `MosaicTextContent` literal variant | wired | pixel-affecting | — | TBD | TBD | `{ kind:"literal", text:string }` |
| `T:source.type=text.layers[].content.kind=expr` | `MosaicTextContent` expr variant | wired | pixel-affecting | — | TBD | TBD | `{ kind:"expr", expr:string, eval? }` |
| `T:source.type=text.layers[].content.kind=expr.eval=once` | nested eval `once` | wired | pixel-affecting | — | TBD | TBD | Single-frame evaluation. |
| `T:source.type=text.layers[].content.kind=expr.eval=frame` | nested eval `frame` | wired | pixel-affecting | — | TBD | TBD | Per-frame evaluation. |
| `T:source.type=text.layers[].style` | `MosaicTextLayer.style` | wired | pixel-affecting | — | TBD | TBD | Per-layer style override. |
| `T:source.type=text.layers[].placement` | `MosaicTextLayer.placement` | wired | pixel-affecting | — | TBD | TBD | Per-layer placement override. |
| `T:source.type=text.layers[].effects` | `MosaicTextLayer.effects` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=text.layers[].visual` | `MosaicTextLayer.visual` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=text.layers[].overlay` | `MosaicTextLayer.overlay` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=text.renderMode.kind=image` | `MosaicTextRenderMode` image | wired | pixel-affecting | — | TBD | TBD | Single-frame RGBA. |
| `T:source.type=text.renderMode.kind=video` | `MosaicTextRenderMode` video | wired | pixel-affecting | — | `validateMosaicFile.test.ts` (TEXT_RENDER_MODE_DURATION_MISSING) | TBD | RGBA video; default duration = ctx.target.durationMs. |
| `T:source.type=text.rasterizer=drawtext` | `MosaicTextSource.rasterizer` drawtext | wired | pixel-affecting | — | `packages/core/__tests__/textSource.spec.ts` | TBD | Default (absent). Spawns ffmpeg drawtext to a media file. |
| `T:source.type=text.rasterizer=svg` | `MosaicTextSource.rasterizer` svg | wired | pixel-affecting | — | `packages/core/__tests__/textSource.spec.ts` | TBD | v1 single-color: rewrites to a color tile + glyph inline-mask (no drawtext, no media file). expr-frame text + box/border styling fall back to drawtext. |
| `T:source.type=text.style` | `MosaicTextSource.style` | wired | pixel-affecting | — | TBD | TBD | Base style (overridden by layer). |
| `T:source.type=text.placement` | `MosaicTextSource.placement` | wired | pixel-affecting | — | TBD | TBD | Base placement. |
| `T:source.type=text.playback` | `MosaicTextSource.playback` | wired | non-visual | — | TBD | n/a | — |
| `T:source.type=text.effects` | `MosaicTextSource.effects` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=text.mask` | `MosaicTextSource.mask` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=text.visual` | `MosaicTextSource.visual` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=text.overlay` | `MosaicTextSource.overlay` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=text.editor` | `MosaicTextSource.editor` | spec-only | non-visual | — | — | n/a | — |
| `T:source.type=text.engine` | `MosaicTextSource.engine` | wired | non-visual | — | TBD | n/a | — |

---

## Variant 4 — `MosaicLavfiSource` (type=lavfi)

Procedural generator — solid color or arbitrary lavfi graph string. **Closed sub-union: Form A (`lavfi`) vs Form B (`color`), mutually exclusive.**

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.type=lavfi` | `MosaicLavfiSource` | wired | pixel-affecting | — | `source.test.ts`, `validateLavfiSource.test.ts` | `packages/core/__tests__/lavfiSource.spec.ts` | — |
| `T:source.type=lavfi.form=lavfi` | Form A (`lavfi:string`, `color:never`) | wired | pixel-affecting | — | TBD | TBD | FFmpeg libavfilter graph snippet. Engine owns fps/duration/size/format. |
| `T:source.type=lavfi.form=color` | Form B (`color:MosaicColor`, `lavfi:never`) | wired | pixel-affecting | — | TBD | TBD | Solid-color convenience. |
| `T:source.type=lavfi.lavfi` | `MosaicLavfiSource.lavfi` | wired | pixel-affecting | — | TBD | TBD | **Engine-ignores** any `s=`/`r=`/`d=`/`format=rgba` strings; injected by engine. |
| `T:source.type=lavfi.color` | `MosaicLavfiSource.color` | wired | pixel-affecting | — | TBD | TBD | `MosaicColor`. |
| `T:source.type=lavfi.fitMode=tile` | `MosaicLavfiBase.fitMode` `tile` | wired | pixel-affecting | — | TBD | TBD | Default. Exact tile dimensions. |
| `T:source.type=lavfi.fitMode=content` | `MosaicLavfiBase.fitMode` `content` | wired | pixel-affecting | — | TBD | TBD | Intrinsic size + placement math. "Most templates should NEVER need this." |
| `T:source.type=lavfi.size` | `MosaicLavfiBase.size` | **deferred** + **pruning-candidate** | pixel-affecting | 3c (review) | — | — | JSDoc: "ADVANCED escape hatch. Widespread use in templates is a smell." Consider removal vs. keeping for raw-lavfi edge cases. |
| `T:source.type=lavfi.size.wExpr` | `MosaicLavfiBase.size.wExpr` | deferred | pixel-affecting | 3c (review) | — | — | Uses tile-local macros `TW`/`TH`. |
| `T:source.type=lavfi.size.hExpr` | `MosaicLavfiBase.size.hExpr` | deferred | pixel-affecting | 3c (review) | — | — | — |
| `T:source.type=lavfi.overlay` | `MosaicLavfiBase.overlay` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=lavfi.placement` | `MosaicLavfiBase.placement` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=lavfi.playback` | `MosaicLavfiBase.playback` | wired | non-visual | — | TBD | n/a | Uses `MosaicLavfiPlaybackProps` (strict subset — no `clipStartMs`). |
| `T:source.type=lavfi.effects` | `MosaicLavfiBase.effects` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=lavfi.mask` | `MosaicLavfiBase.mask` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=lavfi.visual` | `MosaicLavfiBase.visual` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.type=lavfi.editor` | `MosaicLavfiBase.editor` | spec-only | non-visual | — | — | n/a | — |
| `T:source.type=lavfi.engine` | `MosaicLavfiBase.engine` | wired | non-visual | — | TBD | n/a | — |

**Engine-ignores assertion safety rail (sub-epic 3d, output validation):**

| Codename | Engine behavior | Status | Test |
|---|---|---|---|
| `T:source.type=lavfi.lavfi#hardcoded-size` | Engine injects `scale=W:H` post-graph; user `s=`/`r=`/`d=` in `lavfi` string is **ignored** | needs-wiring | should emit `LAVFI_HARDCODED_TIMING` warning (does not exist yet) |

---

## Variant 5 — `MosaicRefSource` (type=ref) — SHAPE WIRED, MIRROR RENDER DEFERRED

**3c.1 (classification) shipped.** The planner now validates ref shape against the flat-document keyspace, classifies each ref, and emits the appropriate diagnostic. Mirror-render via ffmpeg `split` filtergraph (3c.4) is the meaningful remaining work — until that lands, shape-valid refs render a `DEFERRED_VISUAL_CARRIER` placeholder (1s × 16×16 black) so the planner's frames / mediaSources 1:1 invariant holds.

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.type=ref` | `MosaicRefSource` | wired (shape) + needs-wiring (mirror) | pixel-affecting | 3c.4 (mirror) | `source.test.ts` (shape) + `buildMosaicNode.test.ts` (classification) | — | Shape validated against flat doc; mirror render is deferred. |
| `T:source.type=ref.flattenedStableKey` | `MosaicRefSource.flattenedStableKey` | wired | n/a | — | `buildMosaicNode.test.ts` (4 classifications) | — | Branded `FlattenedStableKey`. Resolved against post-flatten DSL via frame-by-frame stableKey lookup. |
| `T:source.type=ref.stepIndex` | `MosaicRefSource.stepIndex` | needs-wiring | n/a | 3c, 3e | — | — | Pipeline-only back-edge index. Cross-step ref check lands with pipeline ref-step resolution. |
| `T:source.type=ref.placement` | `MosaicRefSource.placement` | needs-wiring | pixel-affecting | 3c.4 | — | — | Applied to mirror copy (when mirror lands). |
| `T:source.type=ref.playback` | `MosaicRefSource.playback` | needs-wiring | non-visual | 3c.4 | — | — | Duration mismatch resolved by `loopMode` (`"loop"` / `"freeze"` / `"cut"`) + `clipStartMs` / `clipDurationMs`. Type already complete (`source.ts:819-825`); 3c.4 wires it. |
| `T:source.type=ref.effects` | `MosaicRefSource.effects` | needs-wiring | pixel-affecting | 3c.4 | — | — | — |
| `T:source.type=ref.mask` | `MosaicRefSource.mask` | needs-wiring | pixel-affecting | 3c.4 | — | — | — |
| `T:source.type=ref.visual` | `MosaicRefSource.visual` | needs-wiring | pixel-affecting | 3c.4 | — | — | — |
| `T:source.type=ref.audio` | `MosaicRefSource.audio` | needs-wiring | non-visual | 3c.4 | — | — | — |
| `T:source.type=ref.overlay` | `MosaicRefSource.overlay` | needs-wiring | pixel-affecting | 3c.4 | — | — | — |
| `T:source.type=ref.editor` | `MosaicRefSource.editor` | spec-only | non-visual | — | — | n/a | — |
| `T:source.type=ref.engine` | `MosaicRefSource.engine` | wired | non-visual | — | TBD | n/a | — |

**Diagnostics owned by 3c (status updated):**

| Diagnostic | Trigger | Status |
|---|---|---|
| `MOSAIC_REF_FORWARD_REFERENCE` | target's logicalIndex >= ref's logicalIndex (back-edge violation) | wired in `buildMosaicNode` (3c.1) |
| `MOSAIC_REF_NOT_FOUND` | `flattenedStableKey` doesn't resolve to any frame in the flat doc | wired in `buildMosaicNode` (3c.1) + `flatten` (pre-existing) |
| `MOSAIC_REF_NOT_YET_IMPLEMENTED` | shape-valid ref encountered (mirror render deferred) | wired as `warning` (retires when 3c.4 lands) |
| `MOSAIC_DATA_SOURCE_VISIBLE_USE` | ref points at a `MosaicDataSource` carrier | wired in `buildMosaicNode` (3c.1) |
| `MOSAIC_CYCLE_DETECTED` | ref → … → ref cycle | wired (flatten) |

**3c.4 (mirror render) sub-task scope:** wire ref's slot to reuse the target source's **precursor intermediate file** (m0saic's per-source rendered video) rather than re-rendering. The build-graph layer already produces one precursor per source — a ref's slot just needs to point at the target's precursor handle. The ref's own `placement` / `playback` / `effects` / `mask` / `visual` / `audio` / `overlay` props apply on top of the mirrored pixels. Replace the `DEFERRED_VISUAL_CARRIER` placeholder push in `buildMosaicNode.ts` with the real precursor-reuse wiring. Multi-session engine work.

**3c.4 resolution table — five cases, all reuse the precursor:**

| # | Locality | Size | Duration | Mechanism |
|---|---|---|---|---|
| 1  | Same doc       | match  | match (implicit) | Precursor handle reuse. Ref's `placement` applies. |
| 2  | Same doc       | differ | match (implicit) | Precursor reuse + `placement.fit` (`contain`/`cover`) + offset/padding. |
| 3a | Cross-step     | match  | match  | Precursor reuse across step boundary. `stepIndex` disambiguates which earlier flattened root contains the target. |
| 3b | Cross-step     | differ | match  | Precursor reuse + `placement.fit`; target lives in earlier step. |
| 3c | Cross-step     | (either) | differ | `MosaicPlaybackProps.loopMode` (`"loop"` / `"freeze"` / `"cut"`) + `playback.clipStartMs` / `clipDurationMs`. Composes with 3a/3b spatial behavior. |

**No new fields needed for 3c.4.** Duration-mismatch handling reuses the existing `MosaicPlaybackProps.loopMode` type (`source.ts:6`, documented at `source.ts:819-825` and `source.ts:980-984`). Size-mismatch reuses existing `placement.fit`. Cross-step `flattenedStableKey` lookup just extends resolver scope from "current document's flat frames" to "all earlier steps' flattened roots, plus current step's flat frames up to current index" — same data the flattener already builds, no new runtime struct.

**3c.4 follow-up — cross-step format negotiation (separate sub-task):** pixel-format / fps / alpha differences across step boundaries need a rule map (re-encode vs. `setpts`/`fps` normalization vs. alpha-aware compositing). Explicitly scoped out of 3c.4 by `source.ts:828-831`; lands as its own focused PR.

**Authoring side — the handle pattern:** Producer templates self-stamp `{ stepIndex, flattenedStableKey }` into `MosaicDocument.variables` so downstream consumers can spread directly into a `MosaicRefSource` without hardcoding the producer's stableKey. See `source.ts:917-959` for the canonical example, and the the internal templates notes data-fetcher-adapter-handle authorship doc (candidate at the internal data-fetcher-and-adapter-patterns notes).

---

## Variant 6 — `MosaicDataSource` (type=data)

**Whole variant is `needs-wiring` per REDESIGN deferred inventory.** Sub-epic 3b (variables / aliases / upstream-data).

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.type=data` | `MosaicDataSource` | needs-wiring | non-visual | 3b | `source.test.ts` (shape only) | n/a | Pipeline-boundary variables carrier. Renders the `MOSAIC_DATA_SOURCE_CARRIER` 16×16 black placeholder. |
| `T:source.type=data.variables` | `MosaicDataSource.variables` | needs-wiring | non-visual | 3b | — | n/a | `Record<string, unknown>` — opaque JSON. |
| `T:source.type=data.alias` | `MosaicDataSource.alias` | needs-wiring | non-visual | 3b | — | n/a | Branded `AliasId`. Surfaces under `ctx.upstreamData[alias]`. |
| `T:source.type=data.editor` | `MosaicDataSource.editor` | spec-only | non-visual | — | — | n/a | — |
| `T:source.type=data.engine` | `MosaicDataSource.engine` | needs-wiring | non-visual | 3b | — | n/a | — |

**Diagnostics owned by 3b (all needs-wiring):**

| Diagnostic | Trigger |
|---|---|
| `PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE` | every source in the step is a data source AND `intermediate !== true`. Mixed steps don't trigger. |
| `MOSAIC_DATA_SOURCE_VISIBLE_USE` | ref points at a data source (see also 3c) |
| `MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE` | data source in a non-pipeline document |
| `MOSAIC_ALIAS_COLLISION` | two data sources publish the same `alias` |

**Coexistence with renderables (formalized 2026-05-14):** A `MosaicDataSource` may sit alongside renderable sources in the same `doc.sources` array. Each data source occupies a cell that renders the degenerate `MOSAIC_DATA_SOURCE_CARRIER` (1s × 16×16 black), analogous to how an audio-only media source occupies a cell with an empty visual buffer. The previously-considered `MOSAIC_DATA_SOURCE_MIXED_WITH_RENDERABLE` diagnostic was dropped — formalizing what the engine already supports rather than artificially constraining it.

**Constant:**

| Codename | TS path | Status | Notes |
|---|---|---|---|
| `T:source.MOSAIC_DATA_SOURCE_CARRIER` | `MOSAIC_DATA_SOURCE_CARRIER` (const) | wired | Engine-internal placeholder render (1s × 16×16 black lavfi). Authors never configure. |

---

## Supporting types

### `MosaicSourceMask` (closed union)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.mask.kind=alpha-image` | `MosaicSourceMask` alpha variant | wired | pixel-affecting | — | TBD | TBD | Pre-rendered grayscale PNG. |
| `T:source.mask.kind=alpha-image.assetId` | `.assetId` | wired | n/a | — | — | — | Branded `AssetId`. |
| `T:source.mask.kind=inline-mask` | `MosaicSourceMask` inline variant | wired | pixel-affecting | — | `core/resolveMasks*.test` | `core/__tests__/effects` | SVG path + bounds carried on the source; engine rasterizes via shared cache. |
| `T:source.mask.kind=inline-mask.localPath` | `.localPath` | wired | n/a | — | — | — | SVG path data in local design coords. |
| `T:source.mask.kind=inline-mask.bounds` | `.bounds` | wired | n/a | — | — | — | Design-space rect the path was authored against. |

<!-- `dictionary-mask` variant was removed in Step 7d (2026-06-01). Templates
     consuming dictionary entries with mask sets now load those masks at
     template-execution time and emit them as `inline-mask` on each source —
     see `packages/templates/src/m0saic/brand/{logo,qr-animate}/*`. -->


### `MosaicPlaybackProps` and `MosaicLavfiPlaybackProps`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.playback.playSpeed` | `MosaicPlaybackProps.playSpeed` | wired incl. mosaic (2026-08-02) | visual | — | `ffmpegCommands.test.ts` "playSpeed" describe; `playbackPlaySpeed.test.ts`; `buildChildMosaicSource.test.ts` "playSpeed wiring" describe | `playback.spec.ts` PLAYSPEED_* + PLAYSPEED_mosaic_* goldens; `command-goldens.spec.ts` `playback_playspeed_mosaic_2x` | Default 1, clamp [0.1, 10]. Media video/audio (video setpts, audio chained atempo); source-time clip window (rendered length = clipDurationMs / k). Image no-op. Mosaic sources re-time the child's RENDERED deliverable: rendered length auto-stamped as `clipDurationMs` (loop unit — true whole-deliverable loop when k ≠ 1), child render slot-capped to `slotMs × k` (audio-free children only); pipeline children re-time but freeze; `clipStartMs` still a no-op for children. text/ref/lavfi warn `PLAY_SPEED_NOT_WIRED_FOR_SOURCE` + render 1×. CLI gates: `test-templates/playspeed-tone-2x.mosaic`, `test-templates/playspeed-mosaic-2x.mosaic`. |
| `T:source.playback.loopMode=loop` | `LoopMode` `loop` | wired | non-visual | — | TBD | n/a | Default. Repeat. |
| `T:source.playback.loopMode=freeze` | `LoopMode` `freeze` | wired | non-visual | — | TBD | n/a | Hold final frame. |
| `T:source.playback.loopMode=cut` | `LoopMode` `cut` | wired | non-visual | — | TBD | n/a | Play once, transparent remainder. |
| `T:source.playback.clipStartMs` | `MosaicPlaybackProps.clipStartMs` | wired | non-visual | — | TBD | n/a | Trim offset. |
| `T:source.playback.clipDurationMs` | `MosaicPlaybackProps.clipDurationMs` | wired | non-visual | — | TBD | n/a | Trim length. |
| `T:source.lavfi-playback` | `MosaicLavfiPlaybackProps` | wired | non-visual | — | — | n/a | Strict subset — **no `clipStartMs`** (lavfi has no underlying file timeline). |

### `MosaicEffectProps`

All fields are pixel-affecting. Cross-references to visual cells in [coverage-map.md](./coverage-map.md).

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.effects.rounding.borderRadius` | `RoundingOptions.borderRadius` | wired | pixel-affecting | — | TBD | TBD | 0–1 fraction of `min(w,h)/2`. |
| `T:source.effects.rounding.cornerStyle=rounded` | `cornerStyle:"rounded"` | wired | pixel-affecting | — | TBD | TBD | borderRadius controls radius. |
| `T:source.effects.rounding.cornerStyle=pill` | `cornerStyle:"pill"` | wired | pixel-affecting | — | TBD | TBD | Full radius. |
| `T:source.effects.stroke.width` | `.stroke.width` | wired | pixel-affecting | — | TBD | TBD | Fraction of `min(w,h)`. |
| `T:source.effects.stroke.color` | `.stroke.color` | wired | pixel-affecting | — | TBD | TBD | `MosaicColor`. |
| `T:source.effects.stroke.alpha` | `.stroke.alpha` | wired | pixel-affecting | — | TBD | TBD | 0–1. |
| `T:source.effects.stroke.position=inner` | `.stroke.position` | wired | pixel-affecting | — | TBD | TBD | Inner stroke only (no outer). |
| `T:source.effects.dropShadow.dx` | `.dropShadow.dx` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.effects.dropShadow.dy` | `.dropShadow.dy` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.effects.dropShadow.blur` | `.dropShadow.blur` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.effects.dropShadow.color` | `.dropShadow.color` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.effects.rotate` | `.rotate` | wired | pixel-affecting | — | TBD | TBD | Degrees. |
| `T:source.effects.blur` | `.blur` | wired | pixel-affecting | — | TBD | TBD | Gaussian radius (px). |
| `T:source.effects.zoomInPercent` | `.zoomInPercent` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.effects.fadeInMs` | `.fadeInMs` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.effects.fadeOutMs` | `.fadeOutMs` | wired | pixel-affecting | — | TBD | TBD | — |

Removed 2026-09-13: `effects.scale` and `effects.translate` — typed since v1 but never wired in the engine and set by no template; `effects.camera` is the zoom/pan surface. Deleted from the type, `MOSAIC_EFFECT_PROP_KEYS`, the JSON schema, and the CLI effects manifest.

### `MosaicVisualProps`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.visual.backgroundColor` | `.backgroundColor` | wired | pixel-affecting | — | TBD | TBD | Letterbox / transparent fill. |
| `T:source.visual.opacity` | `.opacity` | wired | pixel-affecting | — | TBD | TBD | 0–1 multiplier. |
| `T:source.visual.opacityExpr` | `.opacityExpr` | wired | pixel-affecting | — | TBD | TBD | FFmpeg expression (time-varying). |

### `MosaicAudioProps`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.audio.enabled` | `.enabled` | wired | non-visual | — | TBD | n/a | Default true. |
| `T:source.audio.volume` | `.volume` | wired | non-visual | — | TBD | n/a | Linear multiplier. |

### `MosaicPlacementProps` (closed sub-union)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.placement.fit=contain` | `MosaicPlacementContain` | wired | pixel-affecting | — | `placement.spec.ts` | TBD | Default. |
| `T:source.placement.fit=contain.hAlign=left` | `.hAlign:"left"` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.placement.fit=contain.hAlign=center` | `.hAlign:"center"` | wired | pixel-affecting | — | TBD | TBD | Default. |
| `T:source.placement.fit=contain.hAlign=right` | `.hAlign:"right"` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.placement.fit=contain.vAlign=top` | `.vAlign:"top"` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.placement.fit=contain.vAlign=middle` | `.vAlign:"middle"` | wired | pixel-affecting | — | TBD | TBD | Default. |
| `T:source.placement.fit=contain.vAlign=bottom` | `.vAlign:"bottom"` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.placement.fit=contain.inset` | `.inset` | wired | pixel-affecting | — | TBD | TBD | `MosaicBoxFrac`. |
| `T:source.placement.fit=contain.padding` | `.padding` | wired | pixel-affecting | — | TBD | TBD | `MosaicBoxFrac`. |
| `T:source.placement.fit=cover` | `MosaicPlacementCover` | wired | pixel-affecting | — | TBD | TBD | No empty space — forbids hAlign/vAlign/padding via `never`. |
| `T:source.placement.fit=cover.inset` | `.inset` | wired | pixel-affecting | — | TBD | TBD | Only field allowed alongside `fit:"cover"`. |
| `T:source.boxFrac.uniform` | `MosaicBoxFrac` number form | wired | pixel-affecting | — | TBD | n/a | Single number = all sides. |
| `T:source.boxFrac.axis-x` | `MosaicBoxFrac.x` | wired | pixel-affecting | — | TBD | n/a | Axis override (axis loses to per-side). |
| `T:source.boxFrac.axis-y` | `MosaicBoxFrac.y` | wired | pixel-affecting | — | TBD | n/a | — |
| `T:source.boxFrac.side-top` | `MosaicBoxFrac.top` | wired | pixel-affecting | — | TBD | n/a | Per-side wins over axis. |
| `T:source.boxFrac.side-right` | `MosaicBoxFrac.right` | wired | pixel-affecting | — | TBD | n/a | — |
| `T:source.boxFrac.side-bottom` | `MosaicBoxFrac.bottom` | wired | pixel-affecting | — | TBD | n/a | — |
| `T:source.boxFrac.side-left` | `MosaicBoxFrac.left` | wired | pixel-affecting | — | TBD | n/a | — |

### `MosaicTextPlacementProps`

Extends `MosaicPlacementProps` with FFmpeg expression escape hatches.

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.text-placement.xExpr` | `.xExpr` | wired | pixel-affecting | — | TBD | TBD | Overrides hAlign/padding. |
| `T:source.text-placement.yExpr` | `.yExpr` | wired | pixel-affecting | — | TBD | TBD | Overrides vAlign/padding. |

### `MosaicTextStyleProps`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.text-style.borderWidth` | `.borderWidth` | wired | pixel-affecting | — | TBD | TBD | px (engine may scale). |
| `T:source.text-style.borderColor` | `.borderColor` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.text-style.fontSize` | `.fontSize` | wired | pixel-affecting | — | TBD | TBD | px (engine may scale). |
| `T:source.text-style.fontColor` | `.fontColor` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.text-style.fontFamily` | `.fontFamily` | wired | pixel-affecting | — | TBD | TBD | Must resolve to installed/bundled font. |
| `T:source.text-style.fontWeight` | `.fontWeight` | wired | pixel-affecting | — | `validateSources` (TEXT_FONT_WEIGHT_INVALID) | TBD | CSS weight (number 1–1000 or "normal"/"bold"). svg mode resolves nearest variant file; drawtext best-effort. Default 400. |
| `T:source.text-style.fontStyle` | `.fontStyle` | wired | pixel-affecting | — | `validateSources` (TEXT_FONT_STYLE_INVALID) | TBD | "normal" \| "italic". svg mode resolves italic variant; faux-italic is a fast-follow fallback. Default "normal". |

### `MosaicOverlayExpr` and `MosaicOverlayBlendMode`

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:source.overlay.xExpr` | `.xExpr` | wired | pixel-affecting | — | `overlayExpr.spec.ts` | TBD | Symbols: `t`, `lt`, `W`, `H`. |
| `T:source.overlay.yExpr` | `.yExpr` | wired | pixel-affecting | — | TBD | TBD | — |
| `T:source.overlay.enable` | `.enable` | wired | pixel-affecting | — | TBD | TBD | e.g. `between(t,0,3)`. |
| `T:source.overlay.alpha` | `.alpha` | wired | pixel-affecting | — | TBD | TBD | 0–1 over time. |
| `T:source.overlay.startAtSec` | `.startAtSec` | wired | non-visual (timing offset) | — | TBD | n/a | When present, `lt` (local time) symbol is available. |
| `T:source.overlay.blendMode=normal` | `"normal"` | wired | pixel-affecting | — | TBD | TBD | Default. Alpha-over. |
| `T:source.overlay.blendMode=add` | `"add"` | wired | pixel-affecting | — | TBD | TBD | Light emission. |
| `T:source.overlay.blendMode=screen` | `"screen"` | wired | pixel-affecting | — | TBD | TBD | Photographic lightening. |
| `T:source.overlay.blendMode=multiply` | `"multiply"` | wired | pixel-affecting | — | TBD | TBD | Shadow / darken. |

---

## Pruning candidates

| Codename | Reason | Disposition |
|---|---|---|
| `T:source.type=lavfi.size` | JSDoc explicitly states "ADVANCED escape hatch. Widespread use in templates is a smell." | **Keep but discourage.** A handful of templates may need it for raw-lavfi generators where the lavfi output isn't tile-sized. Add a `LAVFI_SIZE_OVERRIDE` warning so the audit can show how often it's actually used; if usage stays at zero across shipped templates after Phase 3d, prune. |

---

## Open questions

1. **`MosaicTextSource.style` vs `layers[].style` precedence.** The JSDoc says layer overrides the base — but engine behavior under partial overrides (layer sets `fontSize` but not `fontColor`) is not unit-tested. Phase 3h template generic threading should add a precedence test. → `// covers: T:source.type=text.style+layer-override-precedence`.

2. **`MosaicLavfiSource` engine-ignores enforcement.** The JSDoc says authors MUST NOT include `s=`/`r=`/`d=`/`format=` in lavfi strings; the engine "injects/normalizes." No diagnostic exists today (`LAVFI_HARDCODED_TIMING` is not in `MOSAIC_DIAGNOSTIC_CODES`). Should this be a Phase 3 task (lint at parse boundary)?

3. **`MosaicRefSource` audio mirroring.** A ref carries `audio?` props — does mirroring the source mean re-routing its audio, or is it always pixel-only? The redesign doc doesn't say. → Owned by 3c.

4. **`MosaicSourceMask.kind=inline-mask` ephemerality.** Rasterized PNGs are content-addressable (`sha256(localPath|bounds|w|h)`) and never enter the asset manifest. Test boundary: rasterization + cache behavior tested in `core/rasterizeMaskPng.test.ts`; engine application tested in `core/resolveMasks*.test.ts`; visual goldens in `core/__tests__`. The `T:` codename is satisfied across these.

5. **`MosaicMosaicSource` is itself recursive.** A mosaic source whose `ref` resolves to a `MosaicDocument` whose `sources[]` contains another mosaic source. Flatten handles this (`flattenMosaicDocument.test.ts` covers up to grandchild). Should the matrix have a depth-of-recursion row? Probably not — recursion behavior is one row.

---

## Next steps after this concept

- Cross-reference `// covers:` markers into the existing test files (`source.test.ts`, the relevant `packages/core/__tests__/*.spec.ts` files). The `wired` rows above with `TBD` test refs are test-gap candidates until proven covered.
- Populate [coverage-map.md](./coverage-map.md) with the source × operator visual cross product. The TBD visual-test cells in this file are the input.
- Then move to the next concept page — recommend `document.md` (carries `MosaicSource[]` and most of the deferred Phase 3 surface).
