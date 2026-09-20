# Primitive Extraction Pattern (Templates → Primitives)

The repeatable pattern for extracting reusable, globally-useful logic from a
domain template into a **primitive** under `@m0saic/primitives/*`. Goal:
primitives reusable across templates for years without inheriting domain
assumptions.

> **Source of truth:** primitives in [https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/primitives](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/primitives); extraction helpers: `buildOverlayStack` in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/m0saic/build-overlay-stack.ts; `transparentSlot`, `lavfiStrip`, `buildGridlineSources` in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/primitives (`transparentSlot.ts`, `lavfiStrip.ts`, `girdlines.ts` (sic — misspelled in code)).

## Definitions

- **Domain template** — expresses a specific user-facing feature or design
  (e.g. `@m0saic/collage/image-collage/v1`). Owns semantics, tunings, theme
  tokens, animation rules.
- **Internal template** — used only inside one domain template's tree (e.g.
  `charts/bar-graph/v1/internal/plot-area`). Often expects injected children /
  parent refs; often not runnable standalone; carries domain assumptions.
- **Primitive template** — globally reusable building block (e.g.
  `@m0saic/primitives/grid/v2`). One focused job, no domain coupling, runnable
  standalone, designed for reuse across domains.

## When to extract

Extract when most of these hold: the behavior is **general** (gridlines,
borders, matte fills, masks, simple overlays); it's **parameterizable** with a
small stable prop surface; it's **already being reimplemented** (copy/paste
creep); it has **no domain meaning**; it's **useful outside** the current
template.

Do NOT extract when: logic depends on domain semantics ("baseline belongs to
PlotArea"); props need parent/child wiring (refs like `barsStackRef`); it's an
experimental one-off or unstable API.

## Hard rules

1. **No domain semantics.** A primitive must not know "charts", "baseline",
   "bars", "labels", or domain axis config. Accept generic parameters
   (`direction`, `origin`, `excludeEdges`); the domain template decides meaning.
2. **Small, explicit prop surface.** Prefer `direction`, `count`,
   `excludeEdges?`, `origin?`, `color?`, `opacity?`, `thicknessFrac?`. No
   kitchen-sink domain config objects.
3. **Runnable standalone.** `m0saic make @m0saic/primitives/<slug>/vN` must
   produce valid output — no required child refs, safe defaults, no crash in
   isolation.
4. **Flagged correctly.** Set `primitive: true`
   (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts#L1416 — "is this a base others
   build on?") and default to public (`internal: false` — "can this render on
   its own?"); the two flags are orthogonal and compose freely. Example:
   `primitives/grid/v1/grid.ts:166`. A truly-internal helper is not a
   primitive; it's an internal utility template.
5. **Reusable composition helpers.** Never hardcode `F{F{F}}` overlay chains —
   compute from count via `buildOverlayStack(n)`.
6. **Valid canonical m0 only.** Helpers that generate m0saic must produce
   canonical strings, validate (or finalize) before returning, and return
   branded `M0String` where possible.
7. **Verify the primitive NESTED, not just standalone.** Standalone renders
   prove nothing about composition: grid v1 satisfied every rule above and was
   still deprecated. Its single-axis path re-encoded absolute pixel positions
   as a `placeRects` split with a per-pixel basis — per the v2 header
   (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/primitives/grid/v2/grid.ts#L16-22`): "it
   renders exactly STANDALONE (853 slices of 853px = 1px each) but the
   per-pixel basis does NOT nest — the engine folds the child split into the
   parent layout, re-divides the basis below 1px, cells round to 0, and the
   grid is SILENTLY DROPPED at certain canvases". A primitive's acceptance test
   is composed-inside-a-cell at several canvas sizes, not one full-frame render.

## The extraction process

1. **Identify the core behavior** in non-domain words ("create N-1
   evenly-spaced line overlays in one direction, optionally excluding edges").
2. **Define the primitive API** — a tiny prop surface (Rule 2).
3. **Move the implementation** to `@m0saic/primitives/...`: new template id,
   defaults that render something clearly, runnable standalone (Rule 3),
   flags per Rule 4.
4. **Extract shared utilities into `@m0saic/template-utils`** when multiple
   templates need them: `buildOverlayStack(count)`, `transparentSlot()`,
   `buildGridlineSources(opts)`, `lavfiStrip(...)` (paths in the source-of-truth
   note above).
5. **Replace the old internal logic** with the primitive, keeping domain
   decisions local (PlotArea decides baseline ownership; the grid primitive
   just draws lines) — then **delete the legacy local versions**
   (`horizontalLineAtFracY`-style shadow implementations must not survive).

For a breaking change later: create `.../v2`; never mutate `v1`.

## Worked example: grid v1 → v2 (the ratio-vs-absolute extraction)

**v1** (`@m0saic/primitives/grid/v1`) was a textbook extraction by Rules 1-6:
generic props, standalone-runnable, public + `primitive: true`, validated m0.
It still failed as a primitive: it computed each gridline's ABSOLUTE pixel
position from `ctx.target` and re-encoded them as a split whose basis ≈ the
axis length in px (`853[0,1,0,…]`). Composed into a parent, the engine
re-divides that basis below 1px and the gridlines silently vanish at some
canvases (1024², 1000²) while surviving at others (1080²). Deprecated
2026-07-07; kept registered as a "what not to do" reference
(`primitives/grid/v1/grid.ts:170-175`).

**v2** (`@m0saic/primitives/grid/v2`) repositions each line as a PROPORTION —
a thin lavfi strip at an overlay offset (`H*frac`) evaluated against the actual
cell at render time, thickness decoupled as a fixed thin strip. Costs N+1
nested overlays instead of one `placeRects`, but composes at every canvas —
for a primitive, composability wins. Full rationale in the v2 header
(`grid/v2/grid.ts:1-55`). This failure mode is why Rule 7 exists.
