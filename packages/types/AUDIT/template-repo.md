# `template-repo/` — connectivity matrix

**Source:** `packages/types/src/template-repo/template-repo.ts`
**Test:** (co-located if present; check)
**Phase 3 owners:** — (data shapes; consumed by `@m0saic/platform/template-repos`)

---

## Status: ⬜ not yet enumerated

## Types in this concept

- `MosaicTemplateRepo` — repository descriptor (id, label, source URL, etc.)
- `MosaicTemplateRepoSource` — closed union over how the repo's contents are loaded (npm package, git url, local path)
- Preview resolution helpers / types

## Matrix

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:template-repo` | `MosaicTemplateRepo` | wired | n/a | — | `resolveTemplatePreview.test.ts` (platform) | — | — |
| ... | TODO walk every field, every source variant | | | | | | |
