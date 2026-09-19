# `template/` — connectivity matrix

**Source:** `packages/types/src/template/template.ts`
**Test:** `packages/types/src/template/template.test.ts`
**Phase 3 owners:** 3h (template generic threading), 3g (labels/m0c/m0p contract)

---

## Status: ⬜ not yet enumerated

## Types in this concept

- `MosaicTemplate<P, O, U, D, S>` — five-generic template type
- `MosaicTemplateCapabilities` — tier ("core"/"capability"), feature flags
- `MosaicTemplateOutputHints` — width/height/fps/durationMs/format/note hints
- `MosaicTemplateOutputs` (`O` generic) — what `outputsSchema` declares
- `MosaicTemplateUpstreamVariables` (`U` generic) — what `upstreamVariablesSchema` declares
- `MosaicTemplateUpstreamData` (`D` generic) — what `upstreamDataSchema` declares
- `MosaicTemplateSidecars` (`S` generic) — what `sidecarsSchema` declares
- `MosaicPropControl` / `MosaicPropsSchema` — input contract
- m0c / m0p prop types — labeled layouts + layout packs

## Seed from REDESIGN.md deferred inventory

| Item | Owner |
|---|---|
| `M0C_LABEL_MISSING` / `M0P_VARIANT_MISSING` validation | 3g |
| `VARIABLES_SCHEMA_MISMATCH` validation | 3h |
| `SIDECAR_SCHEMA_MISMATCH` validation | 3f, 3h |
| 5-generic `<P, O, U, D, S>` narrowing in `render` | 3h |

## Matrix

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:template` | `MosaicTemplate` | wired | n/a | — | `template.test.ts` | — | — |
| ... | TODO walk every field, every generic, every schema | | | | | | |

(Populate by walking `template.ts`.)
