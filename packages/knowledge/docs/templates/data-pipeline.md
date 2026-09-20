# Data pipeline: fetchers, adapters, handles, and wiring

The chain: a FETCHER template publishes data → the resolver threads it across
pipeline steps / sibling tiles → a CONSUMER template reads it from ctx → a cron
Job (or the CLI / Make page) renders the whole thing from a `.mosaicx`.
Copy-adaptable reference pair: `@m0saic/meta/fixture-fetcher/v1` +
`@m0saic/meta/upstream-echo/v1` (see Reference implementations).

## The three patterns

All three ride the runtime upstream collection (`collectUpstream`,
the render engine source (not published) — pure, sync; the runner invokes it
per step transition before the step's `render`):

- **Data-fetcher** — a step-0 template whose render returns a doc publishing
  structured data via `MosaicDataSource`; downstream reads `ctx.upstreamData[alias]`
  / `ctx.upstreamVariables`.
- **Adapter** — a small pure template that reads upstream data, transforms it,
  and re-publishes under a different alias. Cross-pack composition.
- **Handle** — a producer self-stamps `{ stepIndex, flattenedStableKey }` into
  its variables; a downstream `MosaicRefSource` spreads the handle to mirror the
  producer's rendered pixels across the step boundary — no re-render, no re-encode.

Fetchers/adapters carry *data* across the back-edge; handles carry *pixel pointers*.

## Publish channels × read views

A producer publishes through three channels on its returned doc:

| # | Channel | Flat view | Namespaced view | Publication entry |
|---|---|---|---|---|
| 1 | Doc-level `doc.variables` | ✅ merges | — | — (no provenance) |
| 2 | `MosaicDataSource` WITHOUT `alias` | ✅ merges | — | ✅ |
| 3 | `MosaicDataSource` WITH `alias` | ✅ merges | ✅ `upstreamData[alias]` | ✅ |

Plus one authored (not template-published) source: `pipeline.variables`, the
pipeline-level seed — flat view only, visible from step 0 onward. (Data flow
WITHIN one template is plain function returns; the ctx views below exist for
crossing a step/tile boundary.)

- **`upstreamVariables` — the global bank.** Flat last-write-wins union of everything
  above. Grounded example: THEMING — a theme step publishes tokens once
  (`{ chromeDark: "#111", accent: "#e33", … }`); every downstream template reads
  `ctx.upstreamVariables.chromeDark`; swap the one producer (or the seed) to re-skin.
- **`upstreamData` — alias-namespaced blocks.** Populated ONLY by aliased
  `MosaicDataSource`s. The consumer must know the namespace; that's the point — it's
  a contract. The alias stays FIXED across versions (part of `outputsSchema`);
  varying data goes in the payload, never in the key. Consumers declare needs in
  `upstreamDataSchema`, so drift is a resolve-time error and keys can't shadow.
- **`upstreamPublications` — the provenance escape hatch.** Lossless ordered list,
  one entry per data source, stamped with `stepIndex`, `tileStableKey`, and
  `templateId`. Same-alias colliders BOTH survive here. Same back-edge scope as the
  merged views, just unmerged — not a wider window; doc-level `variables` mint no
  publication. Use for geometry-addressed reads
  (`publications.find(p => p.tileStableKey === "r/fc0")`) when "which tile said
  this" is the real question; otherwise prefer the alias. Rule of thumb: alias
  anything another pack might read; doc-level variables are fine for single-producer
  flows, themes, and handles; publications are the audit channel, not the read path.

## Author a fetcher (producer)

- `defineMosaicTemplate` with `capabilities: { tier: "capability", caps: {…} }`.
  Without that tier the Level 1 gate STRIPS `ctx.secrets` / `ctx.connections` before
  your render runs — long the #1 silent failure. It is no longer silent: a core-tier
  template that READS a handle the host actually supplied gets a `console.warn`
  naming the template, the field and the declaration that would grant it, plus a
  `warn`-level `capability_denied_read` template log on `ctx.telemetry`. The read
  still returns `undefined` and the ctx key set is unchanged — the tripwire is a
  non-enumerable getter, so only a real read trips it. Both handles are withheld
  together, which is the tell: `ctx` keys `[analysis, cache, media, mode, output,
  target, telemetry]` with `connections`/`secrets` absent means TIER, not a
  missing host connection. (Raw template objects that skip `defineMosaicTemplate`
  are not gated — don't rely on that.) Pure-derivation fetchers (data from props
  alone) can stay `core`.
- The render return, sketched (the load-bearing fields):

      // m0: "1" — one cell, for the carrier
      // sources: [ { type: "lavfi", color: "#000000" },             // carrier
      //   { type: "data", alias: asAliasId("athleteData"),
      //     variables: { name, country, stats } } ]                 // the publish
      // sidecars: { athleteData: data }                             // disk mirror

- **Include a 1-cell renderable carrier** (the lavfi above). A strictly data-only
  doc cannot be planned when a `.mosaicx` wrapper's cell references it; inline
  data-only step files DO work (the planner skips them), but the carrier makes the
  fetcher safe in both shapes. Data sources occupy no m0 cell — the planner filters
  them from layout — so the m0 counts renderables only.
- Secrets: `ctx.secrets.get("env:NAME")` (CLI/jobs resolve env vars; desktop
  also resolves `keychain:` refs). NEVER put cleartext in variables/sidecars —
  publish derived facts only. Connections: `ctx.connections.get("publisher@profile")`
  (CLI needs `M0SAIC_CONNECTIONS_FILE=<path to connections.json>`).
- Declare `outputsSchema` — all-optional keys unless you can always deliver;
  required keys are validated post-render (VARIABLES_SCHEMA_MISMATCH, error).
  Mirror the payload to `sidecars.<key>` — lands as `<output>.<key>.json` next
  to every render, your byte-assertable proof. Opt out only for sensitive data.
- Naming: announce the role in the id — `<scope>/<pack>/<name>-fetcher/v1` (or
  `/intel/`, `/prologue/`); `role: "data-fetcher"` is a real `TEMPLATE_ROLES`
  value (the opt-in, warning-only `TEMPLATE_ROLE_NAMING_MISMATCH` pins the hint).

## Author a consumer

- Core tier is fine — consumers of capability-produced data stay core; the data
  is opaque input, so the consumer stays deterministic given it.
- Read via the `@m0saic/template-utils` upstream helpers — NOT raw ctx fields
  (optional + generic-typed; they decay into casts). Full set at
  https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/data/upstream.ts#L36-135` (verified 2026-07-27):
  `hasUpstream`, `listUpstreamAliases`, `hasUpstreamBlock`, `getUpstreamBlock`,
  `requireUpstreamBlock`, `getUpstreamVariables`, `getUpstreamVariable`,
  `getUpstreamPublications`, `findUpstreamPublications`.

      if (!hasUpstream(ctx)) return renderMissingCard();          // wired at all?
      const athlete = requireUpstreamBlock(ctx, "athleteData");   // throws w/ available aliases
      const soft = getUpstreamBlock(ctx, "designTokens");         // undefined when absent
      const accent = getUpstreamVariable<string>(ctx, "accent") ?? "#e33"; // flat union
      listUpstreamAliases(ctx)                                    // sorted, for diagnostics
      findUpstreamPublications(ctx, { tileStableKey: "r/fc0" })   // provenance escape hatch

  Helpers never transform values, and "no upstream threaded" stays
  distinguishable from "threaded but empty" (`undefined` vs `{}`).
- Declare `upstreamDataSchema` / `upstreamVariablesSchema` — required keys make
  mis-wiring a resolve-time ERROR. Standalone renders (no resolver) skip the
  check, so always handle absent upstream with a deterministic, VISIBLE missing
  state (à la upstream-echo's red card); `requireUpstreamBlock` is the fail-fast
  complement for consumers meaningless without their producer.

## Adapter (re-emission)

Sketch — core tier, `role: "adapter"` (id-hint `adapter`|`bridge`):

      // render(_props, ctx):
      //   const upstream = ctx.upstreamData?.teamAData;
      //   return doc with sources: [{ type: "data", alias: asAliasId("teamBData"),
      //     variables: { athlete: { name: upstream?.hero?.fullName, … } } }]

Why the template layer, not the type layer: the impulse is to let `MosaicRefSource`
target a `MosaicDataSource` (ref relays data). We deliberately don't — a ref carries
pixel-affecting props (`placement`, `effects`, `mask`, …) that would be silently
meaningless on a data target, and a render() can transform / filter / merge far
beyond static renames. Enforced structurally: data sources occupy no m0 cell, so a
ref at a data source's "slot" surfaces `MOSAIC_REF_NOT_FOUND`
(`MOSAIC_DATA_SOURCE_VISIBLE_USE` stays registered in `@m0saic/types` for ABI
stability but is emitted from nowhere). Write an adapter for: cross-pack renames,
subset filtering, merging two aliased sources, computed fields. Writing the same
one-key rename a fifth time is the signal to propose a re-emission variant.

## Handle (cross-step pixel reuse)

Sketch — producer stamps a self-describing pointer; consumer spreads it into a ref:

      // producer (owns the geometry, so the key is correct by construction):
      //   variables: { introHero: { stepIndex: ctx.pipelineStep!.index,
      //                             flattenedStableKey: "intro_hero" } }
      // consumer:
      //   sources: [{ type: "ref", ...ctx.upstreamVariables!.introHero,
      //     placement: { fit: "cover" }, playback: { loopMode: "freeze" } }]

The producer self-stamps (never the consumer hardcoding) because only the producer
knows its `stepIndex` and cell stableKeys at author time — v2 can rename
"intro_hero" without breaking consumers. Channel choice: doc-level `variables`
(flat — single-producer flows) or an aliased `MosaicDataSource` (namespace-safe —
consumer reads `ctx.upstreamData.introHero`); both spread into the ref identically.
Data sources sit beside renderables without occupying cells, so ONE producer can
publish pixels + a data block + a handle in one doc.

Resolution matrix (engine behavior, 3c.4):

| # | Locality | Size | Duration | Behavior |
|---|---|---|---|---|
| 1  | Same doc   | match  | match  | Precursor reuse, identity. Ref's `placement` applies. |
| 2  | Same doc   | differ | match  | Precursor reuse + `placement.fit` + offset. |
| 3a | Cross-step | match  | match  | Precursor reuse across step boundary; `stepIndex` disambiguates. |
| 3b | Cross-step | differ | match  | Precursor reuse + `placement.fit`; target in earlier step. |
| 3c | Cross-step | (either) | differ | `playback.loopMode` (`"loop"`/`"freeze"`/`"cut"`) + `clipStartMs`/`clipDurationMs`. |

All five reuse the producer's intermediate precursor file. Each consumer's own
`placement` / `playback` / `effects` / `mask` / `visual` / `audio` / `overlay`
decorate the mirrored stream independently — N consumers, N decoration chains,
one decode. Cross-step pixel-format / fps / alpha bridging is engine-internal
(the ref consumer's chain inserts `scale=` / `fps=` / `setpts=` / `format=` as
needed — https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/source/source.ts#L1198-1201`).
Handle vs fetcher + re-render: handle when you want **the same rendered pixels**
back (cheapest, frame-identical); fetcher + downstream re-render when you want
**the same logical content rendered differently** per step. They compose.

## Wire the pipeline (.mosaicx)

TWO equivalent shapes. Both resolve to the same `mosaic_pipeline`; the fixtures
render byte-identical mp4s + sidecars, and the e2e suite gates that.

**Flat (preferred for new chains)** —
the CLI source (not published):
`kind: "mosaicx_pipeline"` at the root, steps each wrap ONE invocation. No `m0`,
no `sources`, no `children` — a pipeline root carries no layout of its own.
Stamp `size`/`fps`/`durationMs` on the pipeline (the self-describing-artifact
rule) where the wrapped form stamps them on the wrapper document.

**Wrapped (legacy; still fully supported)** —
the CLI source (not published):
mosaicx_document → single `{type:"mosaic", ref}` source → `mosaic_pipeline` child
whose steps each wrap ONE invocation. The resolver PROMOTES the pipeline child to
the top-level renderable.

Either way the steps read:

    step 0: fetcher invocation, "intermediate": true   ← required; its carrier
            renders to workspace but never reaches the deliverable
    step 1+: consumer invocations — each sees (earlier steps ∪ earlier
            siblings); strict back-edge, no forward references

The wrapped form is promoted to the top level automatically; the flat form is
already there. Invocation ids differ between the two (they are slugs of the path
into the source tree, so the wrapper contributes a `children.<ref>.` segment) —
internal handles only, not deliverable names.

Cross-TILE also works without a pipeline: an earlier sibling invocation's
published data reaches later siblings in the same doc.

The flat root is what makes a chain visible to every surface that iterates a
**top-level** pipeline's steps. As of 2026-08-14 the CLI (`m0saic make`,
`m0saic resolve`) accepts both roots; Compose rejects `mosaicx_pipeline` at load
and `m0saic open --make` can't open one (it needs a top-level invocation).
`MosaicXPipeline` carries `runner` but deliberately NOT `vocab` / `agent` /
`suggestedOutput` — those are read only by surfaces that require a top-level
`template_invocation` source.

## Run it

- CLI: `M0SAIC_FIXTURE_SECRET=… m0saic make thing.mosaicx -w 640 -h 360 -o out.mp4`
  (env vars ARE the CLI secret store; sidecars land next to out.mp4)
- Jobs: input kind `"mosaicx-file"` (UI infers it from the extension). Cron jobs
  auto-suffix colliding outputs; `validateJob` is strict — unknown template ids
  / schema drift FAIL validation.
- Make page: open the .mosaicx and render — same lowering.
- Smoke: `npm run smoke:test-templates -w @m0saic/cli -- fixture-pipeline`

### Jobs window tokens (host-injected time)

A cron/scheduled Job interpolates window tokens into invocation props at TRIGGER
time, before `resolveMosaicx` runs — the template still receives a plain explicit
`{startISO,endISO}` window and stays clock-free. Token set (UTC): `{{todayISO}}`,
`{{lastFullWeekStartISO}}`, `{{lastFullWeekEndISO}}` — the last COMPLETE Mon..Sun
week strictly before the trigger instant. Exact-substring replacement inside
string values only.

- the Mosaic Desktop / Web app source (not published) — `windowTokenMap(triggerInstant)`
  (reuses `lastFullWeek` from the github pack's week-math) +
  `interpolateWindowTokens` (nested string walk).
- `runJob.js` threads the trigger instant and interpolates BOTH a `.mosaicx` doc
  (before resolve) and template `mergedProps` (before render).
- `validateJob.js` mirrors it; unrecognized `{{…}}` → `UNKNOWN_WINDOW_TOKEN` warning
  (never an error; unknown tokens pass through verbatim).

Timezone: v1 is UTC. The cron `tz` schedules WHEN a job fires but does NOT shift
the tokens — a weekly Monday job always renders the just-completed week.
Coupling note: `windowTokens.js` imports week math from a template pack; the
cleaner long-term home is `@m0saic/platform` — flagged for a future hoist.

## Diagnostics you'll meet

| Code | Means | Fix |
|---|---|---|
| VARIABLES_SCHEMA_MISMATCH (error) | upstream payload ≠ declared schema, or producer under-delivered outputsSchema | fix the wiring/alias/types |
| PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE (error) | data-only step not marked intermediate | add `"intermediate": true` |
| MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE (warning) | data source on a non-pipeline root — nobody can read it | move it into a step / invocation child |
| VARIABLES_NOT_YET_IMPLEMENTED (warning) | raw authored pipeline sets step variables; only the resolver can thread | run it via .mosaicx invocations |
| MOSAICX_RESOLVE_FAILED (jobs validate, error) | an invocation failed (unknown id / render threw) | fix the template id / props |

## The github/ connector pack (the shipped exemplar)

https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/github (verified 2026-07-27): `connection.ts`
(registerHostConnection "github@default" + /rate_limit probe), `client.ts`
(injectable-fetch, Link pagination, 202-retry, per-run call budget, committer-date
windowing), `week-math.ts` (pure ISO-week / Mon-start helpers),
`repo-facts-fetcher/v1` (capability, publishes `githubRepoFacts`),
`weekly-pulse-adapter/v1` (core, PURE, publishes `weeklyPulse`), `weekly-pulse/v1`
(self-contained app-runnable capability consumer — the clock-rule exception below),
`__fixtures__/` (a frozen real week + record-facts.mjs). No generic connector
substrate until connector #2.

**Coverage record (never silently zero).** A fetcher hitting a rate-limited /
partial API publishes an explicit `coverage` block (authenticated?,
commitDetails full/partial/none, which KPIs are real; every cap in
`coverage.truncated`). The adapter selects KPIs ADAPTIVELY from it — a mirror
repo drops PR/issue KPIs instead of emitting zeros; degraded basis is LABELED.

**The clock rule (hosts inject time).** Templates NEVER read the wall clock;
identical facts replay → byte-identical publish; all tests run replay or stubbed
fetch; CI never touches the network. Scheduling is the host's job (window tokens
above). One documented exception: an app-runnable capability template's live-mode
default window (`capability-templates.md` §"App-runnable capability templates").

**Secret handling.** Token → request headers ONLY. `coverage.authenticated` is the
only signal a token was used; the cleartext never enters variables, sidecars,
diagnostics, errors, or logs. tokenRef resolution order: `props.tokenRef` (when it
resolves) → connection keychain via `mintConnectionSecretRef` → anonymous.

## Forward references

- **TemplateRole** (layer 1 shipped) — `data-fetcher` and `adapter` are real
  `TEMPLATE_ROLES` values (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts#L1169);
  `handle-producer` is NOT a role. Render-return-shape enforcement (3j) parked.
- **Schema validation** (Phase 3h) — once template generics (`<P, O, U, D, S>`)
  thread end-to-end, producer/consumer mismatches become type-level errors.
- **Cross-step mirror render** (Phase 3c.4 — ✅ **SHIPPED**, re-verified
  2026-07-27) — the handle pattern's ref consumer mirrors precursor pixels across
  step boundaries for real: 20 `ref-*` capability fixtures exercise it in the
  always-on E2E gate (the CLI source (not published)), and
  the render engine source (not published) asserts
  `MOSAIC_REF_NOT_YET_IMPLEMENTED` is NOT emitted. **Do not treat the handle
  pattern as non-functional — it is one of the best-tested surfaces in the
  repo.** (Fetchers/adapters produce no pixels — no visual-golden mandate.)
- **Sibling docs** — `recursion-nested-rendering.md`: `renderNestedTemplate` (how
  a parent invokes producer/fetcher templates); `philosophy-and-contract.md`: the
  `capabilities.tier` contract; `emission-patterns.md`: the sidecar/telemetry
  *mechanism* the fetcher role applies.

## Reference implementations

- Producer: https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/meta/fixture-fetcher/v1
- Consumer: https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/meta/upstream-echo/v1 (self-evidencing green/red status card)
- Wiring (flat root): the CLI source (not published)
- Wiring (wrapped root): the CLI source (not published)
  — the same chain; the e2e matrix asserts both produce identical deliverables
- Headless jobs usage: the Mosaic Desktop / Web app source (not published) (stub pattern + cron-style run)
