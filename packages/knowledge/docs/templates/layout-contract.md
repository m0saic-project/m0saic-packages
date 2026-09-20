# The layout contract — verifying layout intent survived

Scope: the opt-in, label-keyed contract layer in `@m0saic/template-utils` that
checks a template's authored design intent against what the m0 actually resolves
to at a given canvas. Companion to
[`construction-strategy.md`](construction-strategy.md) (real-geometry authoring)
and [`geometry-recipes.md`](geometry-recipes.md) (the placement recipes whose
output this layer guards).

Verified code paths (as of 2026-07-27; re-verify:
`grep -rn "export function \(withLayoutContract\|checkLayout\|assertLayout\|withGeometryContract\)" https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/geometry-contract):

- `withLayoutContract` / `assertLayout` — https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/geometry-contract/withLayoutContract.ts#L65 / `:106`
- `checkLayout` + `LayoutConstraint` — https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/geometry-contract/layoutConstraint.ts#L215 / `:39`
- `withGeometryContract` — https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/geometry-contract/withGeometryContract.ts#L69; `GeometryExpectation` — https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/geometry-contract/types.ts#L24
- The three audits — npm scripts in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/package.json#L13-15` (run from https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates)

## Why it exists

Real-geometry-first gets the rects right in JS pixel math — but the m0 is exact
yet **disposable**: a template re-addresses its whole geometry tree on any change
of canvas or props, so stableKeys and tile order are per-string and can't carry
authored intent. And quantization squashes stay invisible to every
string-level tool because the STRING is healthy (the stat-card icon rendered
33×23 for an intended 26px square; the value band crushed 59→38px; grid/v1
SILENTLY VANISHED when nested at small canvases). `@m0saic/template-utils`
closes the loop with a **label-keyed, ratio-based contract** — opt-in per
template.

## Labels carry intent

**Intent lives on a LABEL.** Tag a source (`source.editor.label = "hero"`);
wherever the builder scatters it in the string, the **source array is the
invariant** — the engine binds `sources[frame.logicalIndex]`, so a tag ties to
its exact geometry node. Declare invariants against the label, as
canvas-INDEPENDENT ratios:

```ts
withLayoutContract(doc, ctx, {
  templateId, debug: props.debugLayout,
  constraints: [
    { label: "hero",   aspect: 16/9, aspectTolerance: 0.04 },   // shape, at ANY canvas
    { label: "value",  minHeightFrac: 0.18, minWidthFrac: 0.5 },// ≥18% tall, ≥50% wide
    { label: "header", within: { yFrac: [0, 0.22] } },          // lives in the top 22%
    { label: "grid" },                                          // PRESENCE — must render at all
  ],
  relations: [
    { label: "photo", equal: "size" },                          // uniform thumbnails (one-to-MANY)
    { label: "photo", gutter: { axis: "x", target: 0.02 } },    // even 2%-of-canvas gutters
  ],
});
```

- **`checkLayout(doc, { canvasW, canvasH, constraints, relations, flatten? })`**
  is the PURE evaluator — a template (or an agent) loops on it during a **layout
  search**: try a packing via the DSL builders → evaluate → keep the one whose
  labeled invariants hold. `withLayoutContract` is the debug tripwire (falsy
  `debug` → returns `doc` untouched at zero cost; a violation → a
  `LAYOUT_CONTRACT` error mosaic at the canvas that broke + an
  `editor.layoutContract` stamp). `assertLayout` is the throwing CI sibling.
- **A label is one-to-MANY** — `{ label: "cell", aspect: 1 }` checks EVERY cell,
  so you constrain a KIND, not a node.
- **Presence, including THROUGH nesting.** A bare `{ label }` asserts the element
  rendered; `checkLayout` auto-flattens nested docs (a parent's top-level m0 is
  trivial), so a parent guards a nested child — and a flatten failure
  (`SPLIT_EXCEEDS_AXIS`) IS the drop signal. This is exactly what would have
  caught grid/v1's silent nested vanish at the canvas it broke (regression test:
  https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/primitives/grid/v1/grid.regression.test.ts).
- **Running the contract backfills `doc.labels`** (`stableKey → label`) from the
  source tags — labeling and checking are one pass; Make / `.m0c` / diagnostics
  get the human names for free.
- **You author the label; the per-m0 resolution is OUTPUT.** The result's
  `matched` / `resolved` map each label → the `stableKey` + `sourceIndex`
  (= `logicalIndex`, the `sources[]` index) it landed on THIS render — for tooling
  (Make's jump-to-piece), never for authored intent.

## The three audits (all resolve-only — NO ffmpeg)

- `npm run audit:layout-envelope` → `LAYOUT-ENVELOPE.md` — per labeled invariant,
  the **canvas range where it holds vs breaks**, with the boundary
  (`breaks ≤ Npx, holds ≥ Mpx`). The layout-solver report: it hands you the
  feasible envelope, so you fix the geometry math for the range you need or
  declare the template's supported output range.
- `npm run audit:geometry-matrix` → `GEOMETRY-MATRIX.md` — curated tier sweep
  (modern-core / adjacent / hostile) with §3c routing hints (geometry expectations).
- `npm run audit:geometry-proof -- --template <id> [--range … | --canvases …]`
  → **sloth** tier (NOT in the merge gate; estimator refuses ≥10min without
  `--yes`), a clustered PROVEN/FAILED report (geometry expectations).

## Two contracts, distinct jobs

- **`LayoutConstraint`** (label + ratio) — the authored DESIGN contract; survives
  every m0 the template regenerates. Add a `debugLayout?: boolean` prop (section
  "Debug", deterministic default false).
- **`GeometryExpectation`** (px rect + inset + maskBounds, zip-ordered) — the
  SECONDARY "did the builder's m0 round-trip" guard, emitted for free by
  `placeInsetPieces` / `placeOptimizedPieces`; `withGeometryContract` +
  `debugGeometry`. Near-tautological for a correct builder — use it to
  regression-lock a zero-drift placement, not to express design intent.

## Text: fit under the ruler the contract measures with

The engine's `drawtext` never shrinks a string — `placement.fit:"contain"` only
picks the anchor. A font derived from a bar's HEIGHT alone clips the moment the
canvas is narrower than the design aspect (portrait 1080×1920 turned "Animated
Wireframe" into "Animated"; 4-digit values into two digits — gate 33,
dsl-tutorial, 2026-09-05). Every text a template paints needs a WIDTH budget.

- **`textFits` is the contract side** — `{ label, textFits: { charWidthEm?, padPx? } }`
  (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/geometry-contract/layoutConstraint.ts#L285; defaults
  `0.72em` / `2px`, measured against the CLI rasterizer) estimates
  `textEmUnits(text) × fontSize × em + pad` (`:71`) against the label's realized box.
  Expr content is skipped by design (a live counter has no single width).
- **Fit with the SAME ruler.** Size the font from `textEmUnits × em` so the fit and
  the check can't disagree. Per-site em that held at 12 canvases (1920×200 …
  3840×2160): prose/labels `0.62`, digit-heavy values `0.68`, ALL-CAPS captions
  `0.76` (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/dsl-tutorial/v1/_shared/text-fit.ts:
  `PROSE_EM` / `DIGIT_EM` / `CAPS_EM`, `fitFontPx`, `fitLine`).
- **Budget = `cell × 0.94 − 2px`** (`FIT_SLACK`, `FIT_QUANT_PX`). Floor quantization
  hands a leaf 1–2px LESS than its modelled share, per split level, not
  proportionally — a proportional-only slack passed the model and still failed the
  realized box (a 28px chip realized 24px at 800×450). With the budget carrying
  the allowance, declare `textFits.padPx: 0`.
- **Degrade ladders beat ellipsis at the floor.** Title: shrink to 70% of the design
  size, THEN ellipsize. Pills: full → compact wording (`Speed  1.0x` → `1.0x`).
  Status strips: drop trailing metrics (whole ones). Captions: blank at the floor.
  Tile marks: drop the dims line, keep the number.
- **Per-glyph-column text (a strip, a ruler) is bounded by its WIDEST glyph**
  (`>` .86em, brackets .42em on the m0 alphabet — `widestM0GlyphEm`), not a flat
  cap; a flat prose em over-measures a comma-heavy m0 string ~1.7×.
- **Live/expr text can't be contract-checked** — model its WIDEST state
  (`Step  N / N`) for the fit and lock it in a unit test.
- **Chrome that is a fraction of HEIGHT is a portrait bug waiting** — size bars off
  `min(H, 0.75·W)` (landscape byte-identical; portrait gets app-bar chrome) and cap
  row heights to the panel WIDTH in tall side panels.

## `missing-label` is the drop signal, not noise

A hairline (a 1-unit rule inside a ~1px/unit band) quantizes to a 0-size frame →
`SPLIT_EXCEEDS_AXIS` → the CLI refuses the whole render ("expects 39 renderable
sources but doc.sources has 40" at 480×270), and `flattenMosaicDocument` collapses
the WHOLE nested layout wherever the child's slot and the flattened parent's cell
differ by ±1px (700–960px wide for dsl-tutorial). The label-keyed contract reports
this class as `missing-label` ("layout collapsed … flatten failed") — treat it as
the geometry bug it is. The sizing rule lives in the handbook
([`feasibility-precision-quantization.md`](../handbook/feasibility-precision-quantization.md)
§3 "Hairlines").

## Recommended: the contract BEFORE the first candidate (founder, 2026-09-05)

"The layout contract can be heavily recommended in a template authoring guide due
to this exact scenario." Default authoring step for any template that paints text:

1. **Tag every fitted text source** (`tag(src, label)`) and declare `textFits` for it
   under the template's `debugLayout` prop — before minting candidate-01.
2. **Sweep `assertLayout` at the 7-canvas set in the gate test** — 1920×1080 ·
   1280×720 · 1080×1920 · 1080×1080 · 3840×2160 · 640×360 · 480×270 — THROUGH
   nested children (`checkLayout` auto-flattens). The end user only ever sees
   "layout contract satisfied"; the failures it takes to get there are the agent's,
   and the sweep is where they surface. Exemplar:
   https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/dsl-tutorial/v1/dsl-tutorial.gate33.test.ts.
3. Debug-only, forever (2026-08-22 ruling): a production render never blocks on a
   contract violation — `debugLayout` is the tripwire, the gate test is the lock.

Full design: (internal design history). Opt-in —
trivial-geometry templates gain nothing; don't add ceremony. The positioning
audit + precision sweep remain the zero-effort baseline every template gets for
free.
