# `telemetry/` — connectivity matrix

**Source:** `packages/types/src/telemetry/` — `category.ts`, `event.ts`, `level.ts`, `personas.ts`, `sink.ts`
**Test:** `event.test.ts`, `sink.test.ts`, `category.test.ts`
**Phase 3 owners:** 3i (engine emit sites); Phase 5 (app-side wiring)

---

## Status: ⬜ not yet enumerated

## Types in this concept

- `MosaicTelemetryEvent` — discriminated union over `kind` (template_*, plan_*, runtime_*, batch_*, set_*, etc.)
- `MosaicTelemetryTier` — `"m0saic" | "template" | "ffmpeg-boundary" | "ffmpeg"`
- Per-tier level unions: `M0saicTelemetryLevel`, `TemplateTelemetryLevel`, `FfmpegBoundaryTelemetryLevel`, `FfmpegTelemetryLevel`
- `MOSAIC_TELEMETRY_CATEGORIES` — closed registry
- `MosaicTelemetrySink` — emit interface
- Combinators: `filterSink`, `fanoutSink`, `byTier`, `byTierLevel`, `byLevel`, `byCategory`
- Personas (TierLevelMaps): `templateDev`, `masochist`, `appViewer`, `batchOperator`, `ossQuiet`
- `RenderEvent` (legacy projection) + `projectRenderEvent` helper
- `getTelemetry(ctx)` accessor + `NOOP_TELEMETRY_SINK` fallback

## Matrix

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:telemetry.event` | `MosaicTelemetryEvent` | wired (types) | n/a | 3i (emit sites) | `event.test.ts` | n/a | — |
| `T:telemetry.kind=template_start` | `template_start` variant | needs-wiring (emit) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=template_end` | variant | needs-wiring (emit) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=plan_phase_start` | variant | needs-wiring (emit) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=plan_phase_end` | variant | needs-wiring (emit) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=runtime_render_start` | variant | wired (via RenderEvent legacy) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=runtime_command_start` | variant | wired (legacy) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=runtime_command_progress` | variant | wired (legacy) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=runtime_command_stderr` | variant | wired (legacy) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=runtime_command_end` | variant | wired (legacy) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=runtime_render_cancelled` | variant | wired (legacy) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=runtime_render_end` | variant | wired (legacy) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=batch_run_start` | variant | needs-wiring (emit) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=batch_run_end` | variant | needs-wiring (emit) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=set_start` | variant | needs-wiring (emit) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.kind=set_end` | variant | needs-wiring (emit) | n/a | 3i | TBD | n/a | — |
| `T:telemetry.tier=m0saic` | tier discriminator | wired (types) | n/a | — | TBD | n/a | — |
| `T:telemetry.tier=template` | tier | wired (types) | n/a | — | TBD | n/a | — |
| `T:telemetry.tier=ffmpeg-boundary` | tier | wired (types) | n/a | — | TBD | n/a | — |
| `T:telemetry.tier=ffmpeg` | tier | wired (types) | n/a | — | TBD | n/a | — |
| `T:telemetry.persona.templateDev` | persona TierLevelMap | wired | n/a | — | TBD | n/a | — |
| `T:telemetry.persona.masochist` | persona | wired | n/a | — | TBD | n/a | — |
| `T:telemetry.persona.appViewer` | persona | wired | n/a | — | TBD | n/a | — |
| `T:telemetry.persona.batchOperator` | persona | wired | n/a | — | TBD | n/a | — |
| `T:telemetry.persona.ossQuiet` | persona | wired | n/a | — | TBD | n/a | — |
| `T:telemetry.sink.filterSink` | combinator | wired | n/a | — | `sink.test.ts` | n/a | — |
| `T:telemetry.sink.fanoutSink` | combinator | wired | n/a | — | `sink.test.ts` | n/a | — |
| `T:telemetry.sink.byLevel` | predicate | wired | n/a | — | `sink.test.ts` | n/a | — |
| `T:telemetry.sink.byTier` | predicate | wired | n/a | — | `sink.test.ts` | n/a | — |
| `T:telemetry.sink.byTierLevel` | predicate | wired | n/a | — | `sink.test.ts` | n/a | — |
| `T:telemetry.sink.byCategory` | predicate | wired | n/a | — | `sink.test.ts` | n/a | — |
| `T:telemetry.NOOP_TELEMETRY_SINK` | const | wired | n/a | — | `sink.test.ts` | n/a | — |
| `T:telemetry.RenderEvent` | legacy projection type | wired | n/a | — | `event.test.ts` | n/a | — |
| `T:telemetry.projectRenderEvent` | helper | wired | n/a | — | `event.test.ts` | n/a | — |
| `T:telemetry.getTelemetry` | ctx accessor | wired | n/a | — | TBD | n/a | — |
| `T:telemetry.category=engine.template` | category | wired | n/a | — | `category.test.ts` | n/a | — |
| `T:telemetry.category=engine.plan` | category | wired | n/a | — | `category.test.ts` | n/a | — |
| `T:telemetry.category=engine.runtime` | category | wired | n/a | — | `category.test.ts` | n/a | — |
| `T:telemetry.category=platform.jobs` | category | wired | n/a | — | `category.test.ts` | n/a | — |
| `T:telemetry.category=platform.sets` | category | wired | n/a | — | `category.test.ts` | n/a | — |
| `T:telemetry.category=platform.batch` | category | wired | n/a | — | `category.test.ts` | n/a | — |
