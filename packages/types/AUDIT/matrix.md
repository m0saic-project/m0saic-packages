# Connectivity matrix — top-level index

Per-concept audit pages live below. Each one walks every type and
field in the corresponding `packages/types/src/<concept>/` folder and
classifies it (see [README](./README.md) for conventions).

This index is the dashboard. When a concept page is populated, the
status counts here get updated.

---

## Concept index

| Concept | Folder | Detail page | Source LOC | Status | Notes |
|---|---|---|---|---|---|
| **source** | `source/` | [source.md](./source.md) | 1167 | 🟡 enumerated, test refs TBD | Highest priority — visual-test mandate target. `MosaicSource` closed union: `media`, `text`, `mosaic`, `lavfi`, `ref`, `data`. Plus all per-source effect operators (masks, borderRadius, strokes, transforms, playback, renderMode). |
| **document** | `document/` | [document.md](./document.md) | 488+313 | 🟢 enumerated | `MosaicDocument` + `MosaicDocumentPipeline`. ~50 rows. 3b focus: `variables` (Role 2 cross-step), `MosaicDataSource` diagnostics, `intermediate:true` enforcement. Other rows split across 3d/3e/3f/3g. |
| **output** | `output/` | [output.md](./output.md) | TBD | 🟡 in progress | `MosaicOutput`, `MosaicOutputTarget`, `MosaicOutputFormat`, plus split sub-types: `MosaicAudioConfig`, `MosaicColorConfig`, `MosaicContainerMetadata`. Owns Phase 3d. **3d.1 + 3d.3 wired** (target preset resolution 5/8 + per-output validation with 17 quarantined tests retired); 3d.2 / 3d.4 remaining. |
| **template** | `template/` | [template.md](./template.md) | TBD | ⬜ todo | `MosaicTemplate<P,O,U,D,S>` 5-generic. All schema fields, `outputHints`, capability tier, defaultProps. |
| **engine-context** | `engine-context/` | [engine-context.md](./engine-context.md) | 481 | 🟢 enumerated | `MosaicEngineContext<U,D>` + `MosaicRenderTarget` + `MosaicEngineOutputContext` + `MosaicMediaRegistry` + ffprobe metadata sub-types. ~80 rows total. 3b focus: `upstreamVariables` / `upstreamData` threading. |
| **identifiers** | `identifiers/` | [identifiers.md](./identifiers.md) | 333 | 🟢 enumerated, fully covered | 5 patterns + 11 brands + 9 predicates + 11 casts. All wired; symmetric `is*` gap noted (Asset/Alias/Template/Repo/DictionaryEntry brands have no per-brand predicate, only pattern predicate). |
| **asset** | `asset/` | [asset.md](./asset.md) | 79 | 🟢 enumerated, fully covered | 3 kinds (file/url/data-uri), 6 diagnostic codes, manifest validator fully tested. |
| **meta** | `meta/` | [meta.md](./meta.md) | TBD | ⬜ todo | `MosaicFileMeta`, `MosaicRenderableEditorMeta`, `MosaicEngineMeta`. Mostly `spec-only`. |
| **diagnostic** | `diagnostic/` | [diagnostic.md](./diagnostic.md) | TBD | ⬜ todo | `MosaicDiagnostic`, `MOSAIC_DIAGNOSTIC_CODES` closed registry. Each code is a row. |
| **dictionary** | `dictionary/` | [dictionary.md](./dictionary.md) | TBD | ⬜ todo | `MosaicDictionaryEntry`, ranks, masks. |
| **template-repo** | `template-repo/` | [template-repo.md](./template-repo.md) | TBD | ⬜ todo | `MosaicTemplateRepo`, preview resolution. |
| **colors** | `colors/` | [colors.md](./colors.md) | TBD | ⬜ todo | `MosaicColor`, ffmpeg named colors, parseMosaicColors. Mostly utility. |
| **defaults** | `defaults/` | [defaults.md](./defaults.md) | TBD | ⬜ todo | `audio`, `color`, `media`, `placement`, `text`, `timing`, `visual` defaults bundles. |
| **primitives** | `primitives/` | [primitives.md](./primitives.md) | TBD | ⬜ todo | Foundational shapes (`MosaicRect`, etc.). |
| **telemetry** | `telemetry/` | [telemetry.md](./telemetry.md) | TBD | ⬜ todo | 4-tier model, levels, categories, sink combinators, personas. Owns Phase 3i wiring. |
| **analytics** | `analytics/` | [analytics.md](./analytics.md) | TBD | ⬜ todo | Consent modes, redactor, scrambler, rollup/immediate event split. Phase 5 wiring. |

Status legend: ⬜ todo · 🚧 enumerating · 🟡 enumerated, gaps · 🟢 enumerated, no gaps

---

## Visual coverage map

Source × operator cross product. Lives at
[coverage-map.md](./coverage-map.md). Tracks `V:` codenames.

| Source variant | Coverage page status |
|---|---|
| `media` | 🚧 enumerating |
| `text` | ⬜ todo |
| `mosaic` (nested) | ⬜ todo |
| `lavfi` | ⬜ todo |
| `ref` | ⬜ todo |
| `data` (non-pixel) | n/a — does not render |
| composition (overlays, slots, refs) | ⬜ todo |

---

## Aggregate counts

Filled in as concept pages are completed. Each row covers one
classification across the entire types surface.

| Status | Count | Notes |
|---|---|---|
| **wired** | 0 / TBD | Production engine acts on these today |
| **needs-wiring** | 21 (seed) | From `REDESIGN.md` deferred inventory; will grow during audit |
| **spec-only** | 0 / TBD | Editor/UI/tooling concerns |
| **deferred** | 0 / TBD | Reserved for future major versions |
| **pruning-candidate** | 0 / TBD | Surfaced for removal |
| **test-gap (wired w/o test)** | 0 / TBD | Phase 3 acceptance criteria |
| **visual-gap (pixel-affecting w/o golden)** | 0 / TBD | Phase 2 exit blocker |

The seed counts come from the existing
`packages/types/REDESIGN.md` "Deferred-features inventory" section.
The audit expands beyond that — that inventory only covers
intentionally-deferred items, not the comprehensive walk.

---

## Phase 3 sub-epic alignment

The matrix's `needs-wiring` rows are the master TODO for Phase 3.
Each row carries a sub-epic tag (`3a`–`3i`); the count below shows
how much each sub-epic owns:

| Sub-epic | Owns | Status |
|---|---|---|
| 3a — Identifier hygiene at parse boundaries | seed: validators + diagnostics + helper construction | 🟢 **done**: identifiers + asset audited and wired; 5 brand-specific `is*` predicates added (44 tests); downstream parse-boundary cross-refs deferred to 3b/3c/3d/3h/3i; 3 platform-helper follow-ups nominated (`composeFlattenedStableKey`, `asRepoId("")` sentinels, optional `composeOutputKey`) |
| 3b — Variables / MosaicDataSource / upstream-data | seed: `variables`, `upstreamVariables`, `upstreamData`, alias namespacing | 🟢 **done**: parse-time validator (4 diagnostics + 12 tests) + runtime threading (`collectUpstream` / `withUpstream` in `@m0saic/core/runtime` + 17 tests including E2E smoke). Remaining: 4 deferred sub-tasks (3b.4–3b.8) for pipeline-runner-context-aware checks + data-carrier emission, none blocking 3c+. |
| 3c — `MosaicRefSource` resolution | seed: back-edge ref chain + forward-ref detection | 🟡 **3c.1 done** (classification + 4 diagnostics wired in `buildMosaicNode`, 6 tests, shape-valid refs render a `DEFERRED_VISUAL_CARRIER` placeholder); **3c.4 deferred** (mirror render via ffmpeg `split` filtergraph — multi-session engine work) |
| 3d — Outputs map + format emission | seed: `outputs[]`, `outputsRef`, codec/container/pixfmt, audio/color/container configs | 🟡 **3d.1 + 3d.3 done** (target preset resolution 5/8 presets + per-output validation with 17 quarantined tests retired + 22 new unit tests). 3d.2 (full format-field emission), 3d.4 (`outputsRef` merge) remaining |
| 3e — Pipeline features | seed: `intermediate: true`, `emit: "multi"`, cross-step refs, self-stamp | ⬜ |
| 3f — Sidecars | seed: walk + collect + write + `sidecarsSchema` validation | ⬜ |
| 3g — Labels / m0c / m0p | seed: `labels`, `labelsRef`, `.m0c` / `.m0p#variant` resolution | ⬜ |
| 3h — Template generic threading | seed: `<P, O, U, D, S>` narrowing + schema validation | ⬜ |
| 3i — Telemetry emit sites | seed: `ctx.telemetry?.emit(...)` at all engine boundaries | ⬜ |

Counts will grow as the audit walks each concept.

---

## Recommended enumeration order (JIT, tied to Phase 3 sub-epics)

**Principle:** don't enumerate a concept page until you're about to
use the enumeration. Premature population rots — Phase 3 engine work
will rename fields, add diagnostic codes, and shift wired/needs-wiring
status as it touches each surface. Walk the page at the *start* of
the corresponding Phase 3 sub-epic; the audit doc becomes the
sub-epic's planning artifact, not a separate up-front task.

### Already populated (no sub-epic gate — walked cleanly up-front)

- ✅ `source.md` — comprehensive, ~140 rows. Visual-test mandate target.
- ✅ `diagnostic.md` — every `MOSAIC_DIAGNOSTIC_CODE` owned by a sub-epic.
- ✅ `telemetry.md` — every event kind, tier, persona, combinator.
- ✅ `analytics.md` — consent modes, redaction treatments, sink interfaces.

These didn't need engine work to wait on; the type surface alone was
sufficient.

### Enumerate when picking up each sub-epic

| Order | Sub-epic | Pages to walk first | Notes |
|---|---|---|---|
| 1 | **3a** — identifier hygiene | `identifiers.md`, `asset.md` | Smallest footprint. No engine churn risk. Unblocks every parse-boundary validator downstream. |
| 2 | **3b** — variables / data / upstream | `document.md` (variables, children), `engine-context.md` (upstream threading) | `source.md` ref/data variants already done. |
| 3 | **3c** — refs | `document.md` supplement (children refs across steps) | `source.md`'s ref variant already done. |
| 4 | **3d** — outputs / format emission | `output.md` (large — codec/container/pixfmt enumeration), `colors.md` (color tags), partial `defaults.md` | Largest single page. Reactivates 17 quarantined `validateMosaicFile.test.ts` rows. |
| 5 | **3e** — pipeline features | `document.md` (pipeline portion), partial `output.md` (per-step `emit:"multi"`) | — |
| 6 | **3f** — sidecars | `document.md` (sidecars field) | Likely partially covered by 3b sweep. |
| 7 | **3g** — labels / m0c / m0p | `template.md` (m0c/m0p prop types), `document.md` (labels/labelsRef) | — |
| 8 | **3h** — template generic threading | `template.md` (full 5-generic walk) | Largest single concept after `output.md`. |
| 9 | **3i** — telemetry emit sites | `engine-context.md` supplement (`ctx.telemetry?`) | `telemetry.md` already done. |

### Defer or skip (no Phase 3 owner)

These have no active sub-epic. Touch them opportunistically when
adjacent work surfaces a gap, or leave them as stubs until Phase 4
hero scenarios reveal real coverage needs. **Do not pre-populate.**

- `meta.md` — mostly `spec-only` (editor/authoring metadata). Engine ignores.
- `dictionary.md` — consumed by `@m0saic/dictionary` package, not the engine.
- `template-repo.md` — consumed by `@m0saic/platform/template-repos`.
- `primitives.md` — foundational shapes; touched in passing during others.
- `defaults.md` — constants; most surface naturally covered during 3d.

### Workflow per sub-epic

When picking up sub-epic 3X:

1. **Open the corresponding audit page.** Most start as stubs with
   seeded rows from `REDESIGN.md`'s deferred inventory.
2. **Walk the source files** (`packages/types/src/<concept>/*.ts`)
   exhaustively. Every field, every variant, every nested union
   gets a row.
3. **Seed `// covers:` markers in existing tests** that already
   exercise the matrix codenames. This converts test-gap → wired.
4. **Identify gaps** — rows with no covering test and no Phase 3
   work scheduled. These become tasks within the sub-epic.
5. **Then write the engine code.** The audit page guides what
   needs wiring; the engine work flips status `needs-wiring` →
   `wired` row by row.
6. **At sub-epic completion**, update this `matrix.md` status
   column (⬜ → 🟢) and the aggregate counts above.

---

## Per-concept page template

Use this skeleton when creating a new concept page. Copy verbatim,
fill in the table rows.

```markdown
# `<concept>` — connectivity matrix

**Source:** `packages/types/src/<concept>/`
**Test:** `packages/types/src/<concept>/<concept>.test.ts`
**Phase 3 owners:** 3a, 3b, ... (whichever sub-epics own rows here)

## Summary

- N total rows
- N wired, N needs-wiring, N spec-only, N deferred, N pruning-candidate
- N pixel-affecting, M non-visual, K n/a
- Test-gaps: ...
- Visual-gaps: ...

## Types in this concept

- `<TypeName>` (`<file>.ts`)
- ...

## Matrix

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:<concept>` | `<TypeName>` | ... | ... | ... | ... | ... | ... |
| `T:<concept>.<field>` | `<TypeName>.<field>` | ... | ... | ... | ... | ... | ... |
| ... | ... | ... | ... | ... | ... | ... | ... |

## Pruning candidates

(or "none" if none surfaced)

## Open questions

(architectural decisions deferred to a follow-up)
```
