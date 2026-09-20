# Template emission patterns — data + telemetry

Templates produce up to three kinds of output: **pixels** (the rendered video/image —
the primary purpose, documented in `rendering-model-contract.md`), **structured data**
(typed values published to downstream consumers), and **telemetry** (observability
events). This doc covers the latter two.

---

## The three channels

| Channel | Audience | Persistence | Read via |
|---|---|---|---|
| `MosaicDataSource` in `doc.sources` | Downstream pipeline steps | In-memory, render-scoped | `ctx.upstreamData[alias]` |
| `doc.sidecars.<key>` | End user / external callers | Disk, as `{output-basename}.<key>.json` | the file |
| `emitTemplateLog(ctx, …)` | Analytics, debugging, dev console | Sink-defined (NDJSON, IPC, …) | `MosaicEngineContext.telemetry` |

Sidecar writing is owned by the engine — the render engine source (not published).
Templates *declare*; core *writes*. Do not write sidecar files from inside `render()`.

> **Adoption reality check (2026-07-26).** These are real, wired mechanisms, but
> adoption is thin: **`@m0saic/media/subtitle-burn/v1` is still the only template that
> emits telemetry at all**, and only it and `@m0saic/forensic/watermark/video/v1`
> declare `sidecarsSchema`. Treat the conventions below as *the intended shape*, not as
> a well-trodden path — you may be the second or third adopter, so prefer following
> subtitle-burn exactly over inventing a variant.

---

## Telemetry: always via `emitTemplateLog`

Emit through `emitTemplateLog` from `@m0saic/types` — **never construct envelopes
inline**. The helper supplies correlation-field defaults and falls back to a no-op sink
when `ctx.telemetry` is absent, so it is safe to call unconditionally.

**`traceId` / `spanId` still default to the `"unwired"` sentinel**
(https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/telemetry/emit.ts#L13-14`). This survived the telemetry sprint —
it is current behavior, not a stale note. Don't be surprised by `"unwired"` in output,
and don't hand-fake a trace id to work around it.

### Event discriminator convention

The closed `kind` union stays `template_log` for **all** template-emitted events.
Distinguish event types with `data.event: "<name>"` inside the free-form payload. This
gives consumers a stable filter key without growing the union — adding a `kind` member
is a types-package change with a much wider blast radius.

### Taxonomy for selection-style templates

Templates that pick one thing from many (track, preset, route, fallback):

| Event | Carries |
|---|---|
| `<thing>_discovered` | what the template saw — count + identifying metadata |
| `<thing>_selected` | what it picked, including `rule: "<algorithm-path>"` |
| `<thing>_filtered` | counts before/after window/predicate filtering |
| `<thing>_applied` | that an optional transform actually fired |
| `passthrough` | no selection was possible — **always include `reason`** |

Subtitle-burn emits all five: `tracks_discovered`, `track_selected`, `cues_filtered`,
`clip_applied`, and `passthrough` at three distinct sites (`no-video-source`,
`invalid-clip-range`, and the selection `rule`). Note `passthrough` recurs with
different `reason` values rather than becoming several event names — follow that.

---

## Data emission: dual-channel symmetry

When publishing structured data alongside pixels, emit through **both** channels with
the **same payload shape**:

1. `MosaicDataSource` with `alias: "<name>"` in `doc.sources` — pipeline-readable
2. `doc.sidecars.<name>` — disk-readable

They serve different audiences (pipeline composition vs. external consumption);
symmetric semantics let a consumer switch channels without recoding.

**Sidecar-only is legitimate** when there is no plausible downstream *pipeline* reader.
`forensic/watermark/video/v1` is the reference: its `watermark` sidecar is the
per-render embedding record (payload, ECC params, key, grid, slots, embed α, host
reference, render dims) that the **decoder** consumes later, out of band. Nothing in
the render graph wants it, so it declares no `MosaicDataSource`. Don't add one for
symmetry's sake.

### Opt-in via `emit<Thing>?: boolean`, default `false`

Auxiliary data emission is opt-in and free when disabled — no extra sources, no disk
write. The pixels are the primary output; aux data shouldn't bloat every render.
Subtitle-burn's `emitCues` (default `false`) is the pattern.

Exception: when the sidecar *is* the point (forensic watermark — the render is useless
without its decode record), make it unconditional and `required: true` in the schema.

### Declare the schemas even when free-form

Declare `outputsSchema` (for `MosaicDataSource` shapes) and `sidecarsSchema` (for
`doc.sidecars` keys) even when entries are `type: "object"` with a prose description.
They are living documentation that ships with the code, and engine-side validation may
follow. Write the description as if it's the only thing a consumer will read — for
sidecars, say **where the file lands** (`{output-basename}.<key>.json`) and **what
gates it**.

---

## Two habits worth copying

**Selection-rule introspection.** A template making an algorithmic choice should return
a typed `{ result, rule }` from its selector and stamp `rule` into *both* the
`<thing>_selected` telemetry event and the published data payload. Consumers then
attribute behavior to an algorithm path without reverse-engineering props.
Subtitle-burn's rule union: `"explicit-index" | "language-match" | "fallback-default" | …`.

**Pass-through graceful degradation.** A template handling optional input (a video that
may or may not have subtitles) must render the base content cleanly when the optional
path can't fire — and emit `passthrough` with a `reason` so consumers can see *why*.
Silence here is the failure mode: an empty overlay and a successful render are
indistinguishable without the event.

---

## Worked example

https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/media/subtitle-burn/v1/subtitle-burn.ts is the canonical
reference — read it end-to-end before authoring an emission-heavy template. It
demonstrates every convention above: five telemetry events, dual-channel emission gated
by `emitCues`, selection-rule stamping, and both schemas declared.

**Related:** `data-pipeline.md` — the data-fetcher role's
`MosaicDataSource` publishing is one specific application of the dual-channel idea here;
that doc covers the *role* contract, this one covers the *mechanism*.
