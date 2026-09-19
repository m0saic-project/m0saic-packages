# `dictionary/` — connectivity matrix

**Source:** `packages/types/src/dictionary/dictionary.ts`
**Test:** `packages/types/src/dictionary/dictionary.test.ts`
**Phase 3 owners:** — (data shapes; consumed by `@m0saic/dictionary` package)

---

## Status: ⬜ not yet enumerated

## Types in this concept

- `MosaicDictionaryEntry` — single entry (id, kind, masks, ranks, complexity, fingerprint)
- `MosaicDictionaryRanks` — per-entry rank scores
- `MosaicDictionaryMask` — per-mask metadata
- `MosaicDictionaryComplexity` — frame count, node count, precision, feasibility metrics
- `MosaicDictionaryEntryFingerprint` — cache key

## Matrix

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:dictionary.entry` | `MosaicDictionaryEntry` | wired | n/a (consumed by @m0saic/dictionary) | — | `dictionary.test.ts` | — | — |
| ... | TODO walk every field | | | | | | |
