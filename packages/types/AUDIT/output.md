# `output/` — connectivity matrix

**Source:** `packages/types/src/output/` — `output.ts`, `target.ts`, `format.ts`, `audio-config.ts`, `color-config.ts`, `container-metadata.ts`
**Test:** corresponding `.test.ts` files per source
**Phase 3 owners:** 3d (outputs map + format emission)

---

## Status: 🟡 in progress (3d.1 wired)

**High priority.** Carries the entire output-config surface that the Phase 1
audit quarantined (per-output validation `.skip`'d in `validateMosaicFile.test.ts`).
Reactivation of those tests is Phase 3d acceptance.

**3d.1 (2026-05-14):** `MosaicOutputTarget` preset resolution wired into
`@m0saic/core/output/resolveOutputFormat.ts`. The 5 currently-wired
container targets (`web-mp4`, `web-webm`, `alpha-mov`, `image-png`,
`image-jpeg`) resolve to concrete `kind` / `container` / `videoCodec` /
`pixelFormat` / `hasAlpha` / `hasAudio` defaults. The 3 not-yet-wired
targets (`animated-gif`, `audio-mp3`, `audio-wav`) return
`UNSUPPORTED_COMBINATION` with explicit per-target "deferred" messages —
authors get a clear signal rather than silent fall-through. Precedence:
user > template > target preset > path-inferred > engine default
(matches the ladder documented on `MosaicOutput`). 12 new tests in
`resolveOutputFormat.test.ts`.

**3d.3 (2026-05-14):** Per-output validation wired in
`@m0saic/platform/mosaic/validate/validateMosaicOutput.ts`. Walks each
`MosaicDocument.outputs[<key>]` entry and emits 8 diagnostics across
two tiers:

*Field-level* (4): `INVALID_DURATION` (now per-output, was previously
on the retired `config.durationMs`), `INVALID_FPS` (new), `EMPTY_BITRATE`,
`EMPTY_PIXEL_FORMAT`.

*Container-kind matrix* (4): `PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER`,
`VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER`,
`VIDEO_CODEC_IGNORED_FOR_IMAGE_CONTAINER`,
`AUDIO_IGNORED_FOR_IMAGE_CONTAINER`. The validator imports
`AUDIO_CONTAINERS` / `IMAGE_CONTAINERS` / `VIDEO_CONTAINERS` from
`@m0saic/types` and classifies the container by membership; rules
apply uniformly across all 12 audio containers, all 9 image
containers, and skip cleanly on all 19 video containers + unknown
escape-hatch strings.

All 17 quarantined tests in `validateMosaicFile.test.ts` retired;
**~100 new matrix-driven tests** in `validateMosaicOutput.test.ts`
covering every entry in each container tuple. Adding a new container
to `@m0saic/types` automatically picks up coverage via `test.each`.
Fixtures migrated from the old `config: { durationMs, fps, advancedConfig }`
shape to the new `outputs.<key>: { durationMs, fps, format }` shape.

## Types in this concept

- `MosaicOutput` — full output config; carries fps, durationMs, width, height, format, audio, color, container, target, metadata
- `MosaicOutputTarget` — preset bundles (e.g. `social-portrait`, `youtube-landscape`)
- `MosaicOutputFormat` — closed union over container/codec/pixelFormat
- `MosaicAudioConfig` — codec, bitrate, sample-rate, channels
- `MosaicColorConfig` — color tag flags (matrix, primaries, transfer)
- `MosaicContainerMetadata` — container atoms (title, comment, etc.)

## Seed from REDESIGN.md deferred inventory

| Item | Owner |
|---|---|
| Full `MosaicOutputFormat` field emission | 3d |
| `MosaicAudioConfig` field emission | 3d |
| `MosaicColorConfig` color-tag flags | 3d |
| `MosaicContainerMetadata` container atoms | 3d |
| Codec/container/pixfmt conflict resolution → `OUTPUT_TARGET_FORMAT_CONFLICT` | 3d |
| `output.ts` `emit: "multi"` (per-step file emission) | 3e |

## Container coverage seed (REDESIGN.md §Container coverage)

- 16 `VIDEO_CONTAINERS`
- 9 `IMAGE_CONTAINERS`
- 12 `AUDIO_CONTAINERS`

Each container value should be a row.

## Codec coverage seed (REDESIGN.md §Codec coverage)

- 26 `VIDEO_CODECS`
- 6 `AUDIO_CODECS`

Each codec value should be a row.

## Pixel formats

See REDESIGN.md §Pixel formats — enumerated list to be cloned in here.

## Matrix

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:output` | `MosaicOutput` | wired | varies | — | `output.test.ts` | — | Carries all per-output knobs. |
| `T:output.target` | `MosaicOutput.target` | wired (5/8 presets) | varies | 3d.1 ✅ | `resolveOutputFormat.test.ts` (12 tests) | — | Resolves to concrete `kind` / `container` / `videoCodec` / `pixelFormat` / `hasAlpha` / `hasAudio` via `TARGET_PRESETS` table in `@m0saic/core/output/resolveOutputFormat.ts`. Wired: `web-mp4`, `web-webm`, `alpha-mov`, `image-png`, `image-jpeg`. Deferred to 3d.X: `animated-gif`, `audio-mp3`, `audio-wav` (return `UNSUPPORTED_COMBINATION`). |
| `T:output.target=web-mp4` | `MosaicOutputTarget` literal | wired | pixel-affecting | 3d.1 ✅ | `resolveOutputFormat.test.ts` | — | H.264 + MP4 + yuv420p + AAC + faststart. |
| `T:output.target=web-webm` | `MosaicOutputTarget` literal | wired | pixel-affecting | 3d.1 ✅ | `resolveOutputFormat.test.ts` | — | VP9 + WebM + yuv420p + Opus. |
| `T:output.target=alpha-mov` | `MosaicOutputTarget` literal | wired | pixel-affecting | 3d.1 ✅ | `resolveOutputFormat.test.ts` | — | ProRes + MOV + yuva420p + alpha + audio. |
| `T:output.target=image-png` | `MosaicOutputTarget` literal | wired | pixel-affecting | 3d.1 ✅ | `resolveOutputFormat.test.ts` | — | PNG + rgba + alpha + no-audio + frameCount=1. |
| `T:output.target=image-jpeg` | `MosaicOutputTarget` literal | wired | pixel-affecting | 3d.1 ✅ | `resolveOutputFormat.test.ts` | — | JPEG + rgb24 + no-alpha + no-audio. |
| `T:output.target=animated-gif` | `MosaicOutputTarget` literal | needs-wiring | pixel-affecting | 3d.X | — | — | Gif container + palettegen/paletteuse filter chain — deferred. |
| `T:output.target=audio-mp3` | `MosaicOutputTarget` literal | needs-wiring | non-visual | 3d.X | — | n/a | Audio-kind path not wired in resolver. |
| `T:output.target=audio-wav` | `MosaicOutputTarget` literal | needs-wiring | non-visual | 3d.X | — | n/a | Audio-kind path not wired in resolver. |
| `T:output.size` | `MosaicOutput.size` | TBD | pixel-affecting | 3d.2 | — | — | `{ width, height }`. |
| `T:output.fps` | `MosaicOutput.fps` | wired (validator) | non-visual | 3d.3 ✅ | `validateMosaicOutput.test.ts` | n/a | Integer in [1, 240]. Emits `INVALID_FPS`. |
| `T:output.durationMs` | `MosaicOutput.durationMs` | wired (validator) | non-visual | 3d.3 ✅ | `validateMosaicOutput.test.ts` | n/a | Positive integer required. Per-output (was previously a flat field on retired `config.durationMs`). |
| `T:output.format` | `MosaicOutput.format` | partial (overrides target) | varies | 3d.2 | `resolveOutputFormat.test.ts` | — | Per-field overrides flow via `templateRequest` today; full enumeration is 3d.2. |
| `T:output.audio` | `MosaicOutput.audio` | needs-wiring | non-visual | 3d.2 | — | — | `MosaicAudioConfig` field emission. |
| `T:output.color` | `MosaicOutput.color` | needs-wiring | pixel-affecting | 3d.2 | — | — | `MosaicColorConfig` tag flags. |
| `T:output.metadata` | `MosaicOutput.metadata` | needs-wiring | non-visual | 3d.2 | — | — | `MosaicContainerMetadata` atoms. |
| ... | full container / codec / pixfmt row enumeration | | | 3d.2 | | | — |

(Continue populating row-by-row as each `.ts` file under `output/` is walked.)
