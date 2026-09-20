# templates/ — the authoring surface

Read as a path: **contract → build → verify → publish**. The required authoring
process (add / deprecate / tests / registry) is the agent contract §10 — not
duplicated here.

## The path

1. [`philosophy-and-contract.md`](philosophy-and-contract.md) — what a template
   IS: the typed contract, ctx.target vs ctx.output, tiers, props-as-schema.
   - **Defaults are part of the contract**: every optional boolean / closed-set
     knob carries a `defaultProps` value, every plain string/number a default or
     a placeholder — enforced inside `defineMosaicTemplate` (throws first-party).
2. [`construction-strategy.md`](construction-strategy.md) — how to build one:
   the Rect Thesis, styles, smell tests.
   - **Constraints first.** Declare the props contract and the layout
     constraints, THEN build, THEN check in a loop across canvases × prop
     combinations; the build itself is the first gate —
     [`standalone-pack-authoring.md`](standalone-pack-authoring.md) §0.
3. [`geometry-recipes.md`](geometry-recipes.md) — the four placement recipes
   (SNAP_PX · placeInsetPieces · placeOptimizedPieces · lattice ratio-grid).
4. [`rendering-model-contract.md`](rendering-model-contract.md) — the 12-rule
   output contract the engine holds you to.
   - [`output-resolution-tree.md`](output-resolution-tree.md) — how top-level
     duration / size / fps / format / audio resolve (user > template intent >
     host hints > engine defaults); read before touching any of them.
5. [`layout-contract.md`](layout-contract.md) — verify layout intent
   (withLayoutContract / checkLayout / assertLayout). **Before the first
   candidate** for anything that paints text: tag fitted text, declare
   `textFits`, sweep `assertLayout` at the 7-canvas set in the gate test.

## By topic

- [`recursion-nested-rendering.md`](recursion-nested-rendering.md) — children,
  bottom-up eval, nested-mosaic-as-clip-region.
- [`data-pipeline.md`](data-pipeline.md) — fetcher / adapter / handle patterns +
  the operational how-to.
- [`render-lifecycle.md`](render-lifecycle.md) — the four entry points
  (`render` required; `renderLite` / `renderCover` / `renderTutorial` opt-in),
  the null-on-absent dispatch rule, and the onboarding-surface checklist.
- [`capability-templates.md`](capability-templates.md) — self-fetch app-runnable
  templates; renderLite rules.
- [`emission-patterns.md`](emission-patterns.md) — non-pixel outputs (data /
  sidecars / telemetry).
- [`theming.md`](theming.md) — design tokens over the upstream channel.
- [`ui-controls.md`](ui-controls.md) — the `picker` taxonomy + prop controls.
- [`standalone-pack-authoring.md`](standalone-pack-authoring.md) — branded pack
  playbook (alpine is the reference).

## reference/ — lookup specs (types & builders)

[`placement-props`](reference/mosaic-placement-props.md) ·
[`prop type: json`](reference/json-prop-type.md) ·
[`template flags`](reference/template-flags.md) ·
[`grid builder`](reference/grid.md) · [`MosaicColor`](reference/mosaic-color.md) ·
[`prop bindings`](reference/prop-bindings.md)

## patterns/ — distilled experience

- [`perf-authoring-rules.md`](patterns/perf-authoring-rules.md) — R1–R11, each
  paid for by a measured incident. Read before shipping any template.
- [`case-study-lessons.md`](patterns/case-study-lessons.md) — L1–L9 from the
  early template generation.
- [`primitive-extraction-pattern.md`](patterns/primitive-extraction-pattern.md)
  — when/how to extract primitives (incl. Rule 7: verify NESTED).
