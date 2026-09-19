# Benchmark battery

Frozen `.mosaic` workloads the benchmark runner renders to measure machine
performance. **This is a performance benchmark, not a template test** — each
workload is an immutable `.mosaic` file (the frozen *output* of a render), so
numbers stay comparable across machines and over time. The runner never invokes
a live template at run time; it just renders these files.

## Layout

```
battery/
  manifest.ts                  the scenario list the runner reads (pure data)
  assets/
    scenarios/*.mosaic         the frozen workloads (synthetic ones are baked)
    media/                     bundled clips/audio referenced by media/audio workloads
```

`assets/` is mirrored into `dist/` at build time (`tools/copy-assets.mjs`), so the
workloads ship with the package. `.mosaic` files reference bundled media by
relative path (e.g. `../media/bbb.mp4`).

## Fairness invariants

- Fixed canvas **1920×1080 @ 30fps** across every workload.
- Frozen workloads — never regenerated from a live template during a run.
- Self-contained — synthetic workloads use lavfi/text only; asset-bearing ones
  reference bundled media in `assets/media/`. No external or user paths, no network.
- The `encoders` set renders **one** canonical workload across codecs (selected via
  `make --video-codec`), never by editing the `.mosaic`.

## Sets

### Standard tier (default run — quick synthetic/primitive probes)

| Set | Status | Workloads |
|---|---|---|
| `sources`  | shipped (v2) | lavfi generators, text rasterization, nested mosaic, ref mirror, video decode (4 BBB clips), audio + video. (Image-sequence input is deferred — no first-class sequence source kind exists yet.) |
| `geometry` | shipped | 144-cell grid (chunked-stitch path; under the 200-cell engine cap) |
| `duration` | shipped | 60s render (dominant wall-clock) |
| `encoders` | shipped | one workload × {libopenh264, libx264, libx265} + host-detected hw encoders (appended at run time) |

### Heavy tier (opt-in — minutes-long; the truest real-world cost signal)

| Set | Status | Workloads |
|---|---|---|
| `real` | shipped (v1) | Captured shipped templates (`bar-graph`, `donut`, `screencap_grid_mp4`) frozen as `.mosaic`, each rendered at **short / medium / long** (5s / 15s / 30s via `make --durationMs`) to map how render cost scales with output duration. Real chart/composition templates are 100×+ slower than the synthetic primitives — that's the cost the standard tier can't see. Provenance recorded as `templateIds`. |
| `lifetime` | shipped (v1) | The enable-gating sprint's canonical case: a half-canvas smoothstep fade whose enable window is `[27,30]` of a 30s parent (`lifetime-window-fade.mosaic`, hand-frozen). Pre-sprint the geq alpha-fold pays per-pixel on all 900 frames; the source-lifetime mechanisms gate/trim it to the 90 in-window frames. A/B via the `M0SAIC_*` mechanism envs. |

The runner defaults to the **standard** sets (a quick run). Select `real` in the
`tests` prop for the heavy tier. The two tiers are split by
`BENCHMARK_STANDARD_SETS` / `BENCHMARK_HEAVY_SETS` in `manifest.ts`.

#### Capturing more `real` workloads

All templates reduce to `.mosaic`, so any shipped template can join the heavy
tier. Capture once and freeze:

```
m0saic make <template-id> --props '{...}' --width 1920 --height 1080 --save-mosaic assets/scenarios/real-<id>.mosaic ...
```

- Asset-free templates (charts, procedural) capture **portably**.
- Templates with media bake **absolute** paths — rewrite them to relative
  (`../media/<file>`) and bundle the asset (the `screencap_grid` capture does
  this against the bundled BBB clips). Multi-output templates capture as a
  `mosaic_pipeline` (also fine).

Then add a `REAL_WORKLOADS` entry in `manifest.ts` with its `templateIds`; the
short/medium/long scenarios are generated automatically, and `real`'s version is
bumped when the set changes.

Bundled media (`assets/media/`) is extracted from Big Buck Bunny (CC-BY 3.0) with
ffmpeg: `bbb-clip-01..04.mp4` (4× 720p ~4s video-only) form the decode bank;
`bbb-av.mp4` (720p ~8s, video+audio) drives the audio workload.

## Regenerating the synthetic workloads

```
node tools/bake-benchmark-battery.mjs
```

Run this **only** for a deliberate battery change, and bump the affected set's
version in `manifest.ts` (`BENCHMARK_SET_VERSIONS`) so old runs are never silently
compared against the new battery. Validate after baking:

```
for f in assets/scenarios/*.mosaic; do m0saic make "$f" --width 1920 --height 1080 --validate-only; done
```

## Adding `real` workloads (captured from your own templates)

1. Render a template (or a composition of several) once, saving the document:
   `m0saic make <template-id> --save-mosaic assets/scenarios/real-<id>.mosaic ...`
2. Move any referenced media into `assets/media/` and fix the `.mosaic`'s paths to
   be relative (`../media/<file>`).
3. Add a `manifest.ts` row with `set: "real"`, `file`, and `templateIds: [...]`
   (every template the workload was composed from), and bump `real`'s version.
