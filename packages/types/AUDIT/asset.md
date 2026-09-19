# `asset/` — connectivity matrix

**Source:** `packages/types/src/asset/asset.ts` (79 LOC)
**Test:** `packages/platform/src/mosaic/validate/validateAssetManifest.test.ts` (126 LOC, 12 cases)
**Phase 3 owners:** 3a (manifest validation; uses `FRIENDLY_SLUG_PATTERN` from identifiers)

---

## Summary

- **Total rows:** 17 (3 kind variants × 4 fields + 2 common + 1 manifest + 1 kind registry + 5 diagnostic codes)
- **wired:** 17 (manifest validator extensively tested)
- **needs-wiring:** 0
- **spec-only:** 0
- **deferred:** 0
- **pruning-candidate:** 0
- **pixel-affecting:** 0 — assets are referenced by `MosaicMediaSource.assetId` etc.; those rows are pixel-affecting, but the manifest itself is just metadata
- **test-gap:** 0 (all diagnostic codes have test cases)

---

## Types in this concept

- `MosaicAsset` — closed union over `kind` (3 variants)
- `MosaicAssetFile` (`kind:"file"`, `path:string`)
- `MosaicAssetUrl` (`kind:"url"`, `url:string`)
- `MosaicAssetDataUri` (`kind:"data-uri"`, `uri:string`)
- `MosaicAssetCommon` — shared optional fields (`displayName`, `mediaType`)
- `MosaicAssetManifest` — `Record<AssetId, MosaicAsset>`
- `ASSET_KINDS` — closed const-array of the 3 valid kinds
- `AssetKind` — `(typeof ASSET_KINDS)[number]`
- Re-exports: `AssetId`, `asAssetId` from `../identifiers`

---

## Matrix — `MosaicAsset` variants

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:asset` | `MosaicAsset` | wired | non-visual | — | `validateAssetManifest.test.ts:6` (suite) | n/a | Closed union over `kind`. |
| `T:asset.kind=file` | `MosaicAssetFile` | wired | non-visual | — | `validateAssetManifest.test.ts:17,32` | n/a | Local filesystem entry. |
| `T:asset.kind=file.path` | `.path:string` | wired | non-visual | — | `validateAssetManifest.test.ts:17,25,32` | n/a | Absolute at the time downstream code sees it. Loader normalizes relative paths. |
| `T:asset.kind=file#absolute-path` | invariant | wired | non-visual | — | `validateAssetManifest.test.ts:25` | n/a | Emits `ASSET_PATH_NOT_ABSOLUTE` when loader hasn't normalized — defense-in-depth check. |
| `T:asset.kind=file#windows-paths` | platform invariant | wired | non-visual | — | `validateAssetManifest.test.ts:32` | n/a | Backslash and forward-slash Windows paths both accepted. |
| `T:asset.kind=url` | `MosaicAssetUrl` | wired | non-visual | — | `validateAssetManifest.test.ts:41` | n/a | Remote http(s) URL. |
| `T:asset.kind=url.url` | `.url:string` | wired | non-visual | — | `validateAssetManifest.test.ts:41` | n/a | No protocol enforcement at type level; loaders validate. |
| `T:asset.kind=data-uri` | `MosaicAssetDataUri` | wired | non-visual | — | `validateAssetManifest.test.ts:41` | n/a | `data:...` inline URI. |
| `T:asset.kind=data-uri.uri` | `.uri:string` | wired | non-visual | — | `validateAssetManifest.test.ts:41` | n/a | — |

## Matrix — common fields (shared across all variants)

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:asset.displayName` | `MosaicAssetCommon.displayName` | spec-only | non-visual | — | — | n/a | Editor UI label. Engine ignores. |
| `T:asset.mediaType` | `MosaicAssetCommon.mediaType` | wired (advisory) | non-visual | — | `validateAssetManifest.test.ts:17` | n/a | `MosaicMediaKind` advisory. Engine probes content for authoritative metadata; this hint helps the editor. |

## Matrix — manifest + registry

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:asset.manifest` | `MosaicAssetManifest` | wired | non-visual | — | `validateAssetManifest.test.ts:7,94` | n/a | `Record<AssetId, MosaicAsset>`. Empty manifest accepted. Per-key validation uses `FRIENDLY_SLUG_PATTERN`. |
| `T:asset.ASSET_KINDS` | const-array | wired | non-visual | — | `validateAssetManifest.test.ts:50,108` | n/a | Closed registry; anything outside triggers `ASSET_KIND_UNKNOWN`. |
| `T:asset.AssetKind` | `AssetKind` type | wired | non-visual | — | (type-level) | n/a | Derived from `typeof ASSET_KINDS`. |

## Matrix — diagnostic codes owned by this concept

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:asset.diagnostic.ASSETS_MISSING` | (emitted by validator) | wired | non-visual | 3a | `validateAssetManifest.test.ts:11` | n/a | Manifest is null/undefined/array. |
| `T:asset.diagnostic.ASSET_KEY_INVALID` | (emitted by validator) | wired | non-visual | 3a | `validateAssetManifest.test.ts:65,74` | n/a | Key fails `FRIENDLY_SLUG_PATTERN` (empty, spaces, paths, emojis). |
| `T:asset.diagnostic.ASSET_KIND_UNKNOWN` | (emitted by validator) | wired | non-visual | 3a | `validateAssetManifest.test.ts:50` | n/a | Kind not in `ASSET_KINDS`. Engine-internal kinds (`lavfi`, `node-output`) also fire this from the OSS validator's vantage. |
| `T:asset.diagnostic.ASSET_MALFORMED` | (emitted by validator) | wired | non-visual | 3a | `validateAssetManifest.test.ts:105` | n/a | Entry not an object, missing `kind`, kind not a string. |
| `T:asset.diagnostic.ASSET_KIND_FIELDS_MISSING` | (emitted by validator) | wired | non-visual | 3a | `validateAssetManifest.test.ts:115` | n/a | Per-kind required field absent (file w/o path, url w/o url, data-uri w/o uri). |
| `T:asset.diagnostic.ASSET_PATH_NOT_ABSOLUTE` | (emitted by validator) | wired | non-visual | 3a | `validateAssetManifest.test.ts:25` | n/a | File asset path is relative — loader should have absolutized. Defense-in-depth. |

These six codes are missing from the current `diagnostic.md` matrix — adding them in a follow-up pass.

---

## Pruning candidates

None.

---

## What 3a does with this concept

The audit confirms **asset manifest validation is fully wired** in `@m0saic/platform`. The remaining 3a work for assets is:

1. **Cross-reference into `diagnostic.md`** to surface the two codes missed in the initial diagnostic enumeration (`ASSET_PATH_NOT_ABSOLUTE`, `ASSET_KIND_FIELDS_MISSING`).
2. **Verify each diagnostic code emits at the correct severity.** Currently the validator emits everything at `error`; some (like `ASSET_PATH_NOT_ABSOLUTE`) may want `warning` since the loader is expected to have normalized. Phase 3a planning question.
3. **Engine-internal kind filtering.** The validator's `acceptedEngineInternalKinds?` option lets `@m0saic/core` mint transient `lavfi` / `node-output` entries during plan-building without tripping `ASSET_KIND_UNKNOWN`. Audit that the engine actually uses this option (it does — see `validateMosaicDocument.ts:opts.acceptedEngineInternalKinds`). No change needed.
4. **`AssetId` predicate symmetry gap.** Per `identifiers.md`, there's no `isAssetId` predicate. The asset manifest validator uses `FRIENDLY_SLUG_PATTERN.test` directly. Decision: add the predicate (one-line wrapper) for symmetry, or leave the pattern direct? Recommended add (see identifiers.md note).

## Open questions

1. **`MosaicAssetCommon.displayName` — is it ever consumed?** The JSDoc says "editor UIs," but the engine ignores it. Audit pass should grep `apps/mosaic/web` for `displayName` to confirm it's actually rendered somewhere. If not, it's a `pruning-candidate`.
2. **`MosaicAssetCommon.mediaType` divergence.** The author may declare `mediaType:"video"` but the file is actually an image. Does the engine emit a diagnostic when the probe disagrees with the manifest declaration? Currently `wired (advisory)` — no enforcement. Worth a diagnostic code (`ASSET_MEDIA_TYPE_MISMATCH`)? Probably yes; defer to 3a planning.
3. **URL protocol validation.** Currently `kind:"url"` accepts any string in `.url`. Should the type-level invariant be `https://` only (the README implies this)? Or runtime-validated by the loader? Probably runtime — `data:` URIs and HTTP can both make sense, just not in the same `kind`.
