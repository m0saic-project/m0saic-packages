# Template render lifecycle — the four entry points

`render` is required. The other three are optional, opt-in, and **editor-only** —
none of them is ever on the `m0saic make` / CLI path.

> **Source of truth:** the four members + their JSDoc in
> [https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts);
> the wrapper in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/template/defineMosaicTemplate.ts;
> the dispatch helpers in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/render/renderTemplate{Lite,Cover,Tutorial}.ts`;
> the shipped exemplar https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/media/screencap_grid/v2.

| Function | Who calls it | When absent |
|---|---|---|
| `render` | the engine, for real output | — (required) |
| `renderLite` | preview hosts, on the design hot path | falls back to `render` |
| `renderCover` | the editor, on a pure-default first open | **nothing happens** |
| `renderTutorial` | the editor, when the user clicks the "?" pill | **nothing happens** |

Tier is orthogonal. A core-tier template may declare any of the three optional
members; `renderLite`'s *capability* rationale (and the RenderHero wiring that
goes with it) lives in
[`capability-templates.md`](capability-templates.md).

---

## The dispatch asymmetry (the thing to get right)

`renderTemplateLite(tmpl, props, ctx)` falls back to `render` — historical
behavior, and correct: a preview must always show *something*.

`renderTemplateCover` / `renderTemplateTutorial` return `null` and **never** fall
back. Absence means "behave exactly as before this feature existed". Hosts must
not synthesize a generic cover or tutorial; the seam encodes that so no host has
to remember it.

Copying the `renderLite` helper when adding the next surface is the mistake to
avoid — it silently re-introduces "every template gets a cover", which is
precisely what the opt-in design forbids.

## Error semantics differ per surface, on purpose

- **Cover** error or absence → `null` → the host falls through to its normal
  preview path, silently. An error card *about the cover* would recreate the
  broken-first-impression problem the cover exists to fix.
- **Tutorial** error → `makeErrorMosaic`, rendered inside the tutorial view. The
  user explicitly clicked; a silent no-op reads as a dead button.

Both hosts (the Mosaic Desktop / Web app source (not published),
the Mosaic Desktop / Web app source (not published)) implement this pair
identically. The desktop bridge methods are **optional** on the channel, so an
older shell paired with newer web code degrades to "no cover, no pill" rather
than throwing.

---

## Authoring checklist

- **Deterministic and side-effect-free.** No `Date.now`, no `Math.random`.
- **Browser-safe** if the template ships in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/web.ts — no
  node-only imports.
- **Never read `ctx.media`.** Both hosts pass `{}` (no ffprobe pass), so these
  surfaces are self-contained by contract.
- **Size to `ctx.target`.** It carries the editor's canvas dimensions.
- **Real geometry.** A cover page's bands and a tutorial's diagram are known
  rects — carve m0 cells, don't float drawtext over a full-canvas source. The
  Rect Thesis does not get a pass for onboarding content (see
  [`construction-strategy.md`](construction-strategy.md), "Hard rule: real
  geometry first").
- **ASCII-only copy.** drawtext renders `→ · — ×` from the bundled font as tofu
  — the same reason `makeErrorMosaic` runs an `asciiOnly()` pass. See
  [`../skills/text-in-templates.md`](../skills/text-in-templates.md).
- **A tutorial owns its timing.** Declare per-step `durationMs`; never read
  `ctx.target.durationMs`. The host passes no form duration, and a tutorial is
  watched, not rendered into a window.
- **Invocation props**: the tutorial gets the template's OWN `defaultProps`
  (stable regardless of editor state); the cover gets the working props, which at
  the only moment it shows ARE the defaults — so a cover may ignore props
  entirely.
- `defineMosaicTemplate` wraps all three with the **capability gate ONLY** — no
  autoCompact, no stamping, no `assertTiming`. Ephemeral preview material, like
  `renderLite`. (Stamping a tutorial would be actively wrong: it declares its own
  per-step durations.)
- **No new CLI E2E case.** These are unit-tested; they never reach `m0saic make`.
  Same posture as `renderLite`.

---

## Host lifecycle (the Make page)

- The cover shows iff `hasRenderCover && !coverDismissed`. `coverDismissed`
  starts `true`, is set at template load from "did this open carry
  caller-supplied props" (so `m0saic open --props` skips the cover), and is
  flipped permanently by the first user prop edit. Deliberately **not** derived
  from `props === defaults` — edit-then-undo must not resurrect it.
- A cover is a **stand-in**, like a `renderLite` card: it must stay out of the
  render-progress hero filmstrip. Note a template can have a cover *without* a
  `renderLite`, so a hero guard written against `hasRenderLite` alone misses it.
- The tutorial substitutes only the STAGE (a `stageRenderable` + a
  `tutorial:<id>` doc key). The real document keeps feeding save, geometry-edit,
  doc-stats, and `renderRequest`, so view-only holds by construction rather than
  by discipline — the Make button always renders the real template.

## Meta flags

`templates:get` reports `hasRenderLite` / `hasRenderCover` / `hasRenderTutorial`,
with field-for-field parity in the web `getTemplate` and in the `TemplateMeta`
type. UI affordances gate on these flags, never on making the call and seeing
what comes back.

## Exemplar

`@m0saic/media/screencap_grid/v2` — `screencap-grid-cover.ts` (a weighted band
split) and `screencap-grid-tutorial.ts` (six pages, two of them real diagrams:
an actual gutter-separated 4×4 grid, and an actual pane band over chipped tiles).
Its `render` keeps its zero-input `makeErrorMosaic` fail-fast contract untouched
— that is the point. The cover exists so the fail-fast contract can stay strict
without costing the template its first impression.
