# `meta/` — connectivity matrix

**Source:** `packages/types/src/meta/meta.ts`
**Test:** `packages/types/src/meta/meta.test.ts`
**Phase 3 owners:** — (mostly `spec-only`)

---

## Status: ⬜ not yet enumerated

Mostly `spec-only` — these are editor / UI / authoring metadata that the
engine doesn't consume. A few engine-side meta fields exist
(`MosaicEngineMeta`) that the engine does use internally.

## Types in this concept

- `MosaicFileMeta` — user-authored content metadata (title, author, source, note)
- `MosaicRenderableEditorMeta` — editor UI metadata
- `MosaicSourceEditorMeta` — per-source editor metadata (e.g. `binding` for click-to-jump)
- `MosaicEngineMeta` — engine-internal metadata (cached fingerprints etc.)

## Matrix

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:meta.file` | `MosaicFileMeta` | spec-only | non-visual | — | `meta.test.ts` | n/a | Authoring metadata only. |
| ... | TODO walk every field | | | | | | |
