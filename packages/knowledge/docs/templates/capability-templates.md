# Capability-tier templates

The tier contract itself (what `{ tier: "capability", caps }` unlocks, default-deny
caps, when to stay core) lives in [`philosophy-and-contract.md`](philosophy-and-contract.md).
This doc carries the two shipped patterns that go beyond the contract: app-runnable
self-fetch templates, and the `renderLite` preview rule.

> **Source of truth:** capability declaration shape in
> https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/template/defineMosaicTemplate.ts; the shipped exemplar
> `@m0saic/github/weekly-pulse/v1` (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/github/weekly-pulse/v1).

---

## App-runnable capability templates (self-fetch)

The `.mosaicx`/cron chain (fetcher → adapter → runner) can't run from the Templates
UI — the core runner is core-tier (mock/upstream only) and the live chain only exists
as a `.mosaicx`. The shipped pattern: a single **capability-tier** template that IS the
whole chain in one pickable unit — `@m0saic/github/weekly-pulse/v1`. It
`fetch → derive → render`s itself when flipped to `source: "live"` (+ repo + token),
and replays a frozen sample by default (network-free).

- It's a **plain-object** `MosaicTemplate` (not `defineMosaicTemplate`) because it
  returns a duration-follows-timings pipeline, so it skips the wrapper's
  `assertTiming` (the CLI `make` path still applies assertTiming — a plain object
  does NOT escape it there).
- It reuses the runner's extracted `buildPulsePipeline`, so the app-runnable version
  and the cron runner emit the identical beat pipeline.
- A template can't be "core sometimes, capability sometimes" — the app-runnable live
  version is a SEPARATE capability template, leaving the runner core-tier for the
  cron path.

### Live-mode clock exception

An app-runnable capability template MAY read the wall clock for ONE thing: a
live-mode default window (`props.window ?? lastFullWeek(now)`), documented as a
deliberate exception to the clock rule (this template is non-deterministic in live
mode by design). Pinning `window` or using the cron `{{lastFullWeek*}}` tokens keeps
it deterministic. Replay mode never reads the clock. A `livePreview: true` escape
hatch lets power users fetch real data into the geometric preview on demand.

---

## renderLite is PREVIEW-ONLY (RenderHero uses the real render geometry)

> `renderLite` is one of FOUR render entry points, and it is not a capability-tier
> feature — a core template may declare it too. The lifecycle contract for all
> four (including the opt-in `renderCover` / `renderTutorial` onboarding
> surfaces) is [`render-lifecycle.md`](render-lifecycle.md). This section keeps
> the part that IS capability-specific: why a self-fetching template's stand-in
> must never reach RenderHero, and the `renderable_ready` wiring that avoids it.

`renderLite()` returns a stand-in (a themed "ready" card) so selecting a
side-effecting template never runs its real work. It must feed ONLY the idle-state
GeometricPreview — NEVER the render-progress hero (RenderHero), which would otherwise
show the card while ffmpeg renders the real beats. Shipped wiring:

- `templates:get` returns `hasRenderLite: typeof tmpl.renderLite === "function"` so
  the host/UI knows a preview is a stand-in.
- `templates:renderToFile`: right after the real `render()` (BEFORE ffmpeg's
  `render_start`), for renderLite templates the host forwards the resolved renderable
  via a `renderable_ready` renderEvent.
- MakePage captures it as `liveRenderable` and flattens THAT into the hero filmstrip;
  a stand-in preview never drives the hero. Until `renderable_ready` lands (a few ms)
  or if it can't be flattened, the hero shows the neutral loader — never the card.
  Core templates (no renderLite) are unchanged: their preview already IS the render
  geometry.

**Rule for authors/hosts:** if `render()` returns geometry structurally different
from `renderLite()` (as any self-fetching capability template does), the host must
not reuse the renderLite doc for render-progress; it must hook the real `render()`
output.
