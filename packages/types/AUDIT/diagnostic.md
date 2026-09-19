# `diagnostic/` — connectivity matrix

**Source:** `packages/types/src/diagnostic/diagnostic.ts`
**Test:** `packages/types/src/diagnostic/diagnostic.test.ts`
**Phase 3 owners:** All — every sub-epic owns specific diagnostic codes

---

## Status: ⬜ not yet enumerated

Special concept: **every diagnostic code** in `MOSAIC_DIAGNOSTIC_CODES`
gets its own row. The matrix is also the master list for "which codes
are wired vs. stubbed."

## Types in this concept

- `MosaicDiagnostic` — `{ code, message, severity, location? }`
- `MOSAIC_DIAGNOSTIC_CODES` — closed registry (array of literal strings)
- `MosaicDiagnosticSeverity` — `"error" | "warning" | "info"`
- `MosaicDiagnosticLocation` — pointer into source (optional)
- `asDiagnosticCode` / `isDiagnosticCode` brand helpers

## Per-code matrix (one row per code in `MOSAIC_DIAGNOSTIC_CODES`)

| Code | Owner | Trigger | Status |
|---|---|---|---|
| `INVALID_MOSAIC_STRING` | wired | invalid m0 DSL | wired |
| `SOURCE_COUNT_MISMATCH` | wired | sources.length ≠ frame count | wired |
| `ASSETS_MISSING` | wired | `assets` missing or wrong type | wired |
| `ASSET_KEY_INVALID` | wired | asset key doesn't match `FRIENDLY_SLUG_PATTERN` | wired |
| `ASSET_MALFORMED` | wired | asset entry not an object | wired |
| `ASSET_KIND_UNKNOWN` | wired | asset `kind` not in `ASSET_KINDS` | wired |
| `ASSET_KIND_FIELDS_MISSING` | wired | per-kind required field absent (file w/o path, url w/o url, data-uri w/o uri) | wired |
| `ASSET_PATH_NOT_ABSOLUTE` | wired | file asset path is relative (loader should have absolutized) | wired |
| `TEXT_RENDER_MODE_DURATION_MISSING` | wired | text source with renderMode=video, no duration | wired |
| `INVALID_DURATION` | wired (3d.3) | per-output `durationMs` not a positive integer | wired in `validateMosaicOutput` |
| `INVALID_FPS` | wired (3d.3) | per-output `fps` not an integer in [1, 240] | wired in `validateMosaicOutput` |
| `PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER` | wired (3d.3) | any `AUDIO_CONTAINERS` entry + non-empty `pixelFormat` | wired in `validateMosaicOutput` (matrix across all 12 audio containers) |
| `VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER` | wired (3d.3) | any `AUDIO_CONTAINERS` entry + non-empty `videoCodec` | wired in `validateMosaicOutput` (matrix across all 12 audio containers) |
| `VIDEO_CODEC_IGNORED_FOR_IMAGE_CONTAINER` | wired (3d.3) | any `IMAGE_CONTAINERS` entry + non-empty `videoCodec` | wired in `validateMosaicOutput` (matrix across all 9 image containers) |
| `AUDIO_IGNORED_FOR_IMAGE_CONTAINER` | wired (3d.3) | any `IMAGE_CONTAINERS` entry + `output.audio` set | wired in `validateMosaicOutput` (matrix across all 9 image containers) |
| `EMPTY_BITRATE` | wired (3d.3) | empty-string `format.bitrate` | wired in `validateMosaicOutput` |
| `EMPTY_PIXEL_FORMAT` | wired (3d.3) | empty-string `format.pixelFormat` | wired in `validateMosaicOutput` |
| `MOSAIC_CYCLE_DETECTED` | wired | A→B→A flatten cycle | wired |
| `MOSAIC_REF_NOT_FOUND` | wired | ref's stableKey doesn't resolve | wired (flatten only) |
| `MOSAIC_REF_NOT_YET_IMPLEMENTED` | wired (stub) | any `MosaicRefSource` | wired (will retire when 3c lands) |
| `MOSAIC_REF_FORWARD_REFERENCE` | needs-wiring | ref.stepIndex >= current | needs-wiring (3c) |
| `MOSAIC_DATA_SOURCE_VISIBLE_USE` | wired (3c.1) | ref points at data source | wired in `buildMosaicNode.ts` |
| `PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE` | needs-wiring | pure-data-only step (no renderables) not marked intermediate | needs-wiring (3b) |
| `MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE` | needs-wiring | data source in non-pipeline doc | needs-wiring (3b) |
| `MOSAIC_ALIAS_COLLISION` | needs-wiring | two data sources publish same alias | needs-wiring (3b) |
| `VARIABLES_NOT_YET_IMPLEMENTED` | wired (stub) | any `variables` field set on a pipeline step (Role 2) | wired (retires when 3b lands) |
| `PIPELINE_NO_OUTPUT_STEPS` | needs-wiring | every step in pipeline marked `intermediate:true` | needs-wiring (3b/3e) |
| `PIPELINE_EMIT_MULTI_DOWNGRADED` | needs-wiring | nested `emit:"multi"` silently downgraded to `"single"` | needs-wiring (3e) |
| `PIPELINE_NESTED_CANVAS_COLLAPSED` | needs-wiring | nested step's `outputs.<k>.size` overridden by parent slot | needs-wiring (3e) |
| `MULTI_OUTPUT_NOT_YET_IMPLEMENTED` | wired (stub) | `outputs` map has > 1 key | wired (retires when 3d lands) |
| `SIDECAR_NOT_YET_IMPLEMENTED` | retired (never emitted) | — | sidecar writes are live; this code is retained in the enum for ABI stability but is no longer reachable. Same retirement pattern as `MOSAIC_DATA_SOURCE_VISIBLE_USE`. |
| `MOSAIC_REF_FORWARD_REFERENCE` | needs-wiring | `MosaicRefSource.stepIndex >= currentStep` | needs-wiring (3c) |
| `M0P_VARIANT_REQUIRED` | needs-wiring | `labelsRef` points to `.m0p` without `#variant` fragment | needs-wiring (3g) |
| `M0C_LABEL_MISSING` | needs-wiring | `.m0c` label not found | needs-wiring (3g) |
| `M0P_VARIANT_MISSING` | needs-wiring | `.m0p#variant` variant not found | needs-wiring (3g) |
| `VARIABLES_SCHEMA_MISMATCH` | needs-wiring | doc.variables doesn't match template.outputsSchema | needs-wiring (3h) |
| `SIDECAR_SCHEMA_MISMATCH` | needs-wiring | sidecar payload doesn't match sidecarsSchema | needs-wiring (3f, 3h) |
| `OUTPUT_TARGET_FORMAT_CONFLICT` | needs-wiring | codec/container/pixfmt mutually exclusive | needs-wiring (3d) |
| `PIPELINE_EMIT_MULTI_DOWNGRADED` | needs-wiring | nested `emit:"multi"` collapsed | needs-wiring (3e) |
| `PIPELINE_NESTED_CANVAS_COLLAPSED` | needs-wiring | nested step canvas reduced | needs-wiring (3e) |
| ... | (walk the full `MOSAIC_DIAGNOSTIC_CODES` array to surface any missed) | | |

(Populate by enumerating every entry in `MOSAIC_DIAGNOSTIC_CODES`.)
