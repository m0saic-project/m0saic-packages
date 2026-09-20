# Skill: Template Construction Strategy (Human-Friendly vs Engine-Native)

How to decide between human-readable layout and engine-native power, choose splits
vs overlays, and build templates that are stable, predictable, and extensible.
Not every valid DSL construct is ideal for every template.

> **Source of truth:** Existing templates in [https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic) — categories (2026-07-26): `alpine`, `benchmark`, `brand`, `charts`, `code`, `collage`, `demos`, `dsl-tutorial`, `forensic`, `github`, `hero`, `language`, `media`, `meta`, `primitives`, `science`, `social`, `theming`, `wireframe` (`ls` the folder — this list drifts). `charts/bar-graph/v2` is the canonical example of programmatic construction.

Companion docs: the placement recipes are
[`geometry-recipes.md`](geometry-recipes.md); layout-intent verification is
[`layout-contract.md`](layout-contract.md).

## Two construction styles

**Human-friendly layout style** — uses `N(...)` / `N[...]` splits directly,
`1{...}` or group overlays, avoids complex `0`-run overlay staging, keeps the
string short and readable:

    2(
      3[1,1,1],
      3[1,1,1]
    )

Ideal for hand-written templates, teaching examples, simple grids, standard UI
layouts.

**Engine-native composition style** — heavy overlay stacking, rect-capture
overlays, deep nesting, generated programmatically, possibly thousands of
characters, geometry derived algorithmically. Ideal for dictionary-generated
layouts, glyph rendering, debug visualizers, signal-driven demos, high-precision
rectangle emission.

Choose engine-native only when demonstrating DSL power, encoding rect sets
programmatically, building art/glyph systems, or constructing debug tools.
**"Data visualizations" is NOT a blanket license for overlay-stack style.** A
chart's chrome (title, axis labels, ticks, legend, plot frame) is *real
geometry* — see the Hard Rule below. Only the data mark that needs per-frame
animation (a line draw-on, a count-up) is exempt and lives as an overlay.

## Choosing between splits and overlays

Use **splits** when defining structural geometry, siblings need shared partition
logic, the layout is conceptually hierarchical, or you want stable structural
identity. Use **overlays** when layering paint, regions are independent, you are
composing rect instructions, you want depth isolation, or you are building glyphs
or masks. Splits define space; overlays define drawing.

## Hard rule: real geometry first

> **The Rect Thesis.** To render anything at known bounds: carve an m0 CELL sized
> exactly to those bounds (splits / `weightedSplit` / `placeRects`, or nest a
> primitive like `@m0saic/primitives/grid` for repeated thin rects), then **fill
> it** (a lavfi color) or **mask it** (an inline-mask path). The cell is the
> size+position; the source just fills the cell it lands in. This is the core of
> m0saic — see [`../m0saic-thesis.md`](../m0saic-thesis.md).

**If you know a region's rectangle at author time, encode it as a real m0 rect
(splits / `weightedSplit` / `placeRects`) — NOT as a full-canvas source
positioned by `drawtext` `xExpr`/`yExpr` or an inline mask.**

A template's job is **JS pixel-math → real rectangles → m0 DSL geometry.** When an
agent instead computes pixels and bakes them into full-frame drawtext/mask
sources, the output "renders right" but the document *carries no geometry* — which
defeats the structure preview, Render Hero (its whole job is to show the `{}`
frame tree), the layout corpus, and the entire point of the DSL.

- Splits / `placeRects` define **WHERE**; the source fills the cell it lands in.
- Full-frame overlay stacks + in-source positioning are the **FALLBACK**, reserved
  for content that genuinely cannot be a static rect — e.g. an animated line
  sweep, or per-frame-varying geometry.
- **Smell test:** if your `m0` is `buildOverlayStack(N)` with `N == element
  count` and every source is full-canvas, you have pixel-math baked into
  drawtext, not geometry. Preview + Render Hero will be empty/garbage. Rebuild
  with real cells.
- **Reuse first-party primitives** for standard chrome — gridlines are
  `@m0saic/primitives/grid/v2` (v1 is DEPRECATED since 2026-07-07: its per-pixel
  basis silently drops when nested — the layout contract's presence check is what
  catches that class of failure, see
  [`layout-contract.md`](layout-contract.md)); do not re-emit gridline rects by
  hand.

### The animation exemption is narrow — even animated pieces are tightly placed

The "animated / per-frame-varying" exemption above is **NOT** a license for
full-canvas overlays. A piece that animates (a line sliver, a marker, an area)
still has a KNOWN bounding box — you generated its path, so you know its extent.
A masked source whose `bounds` == the full canvas is the lie: it tells the
document "this element is everywhere," which wrecks selection/hit-testing (one
sliver's box swallows every click beneath it), Render Hero, and the layout
corpus. **Complexity lives in the m0 string (geometry), not hidden inside
full-frame masks.** Place each animated piece as a tight rect:

1. Compute the piece's bbox (incl. stroke / radius + ~1px anti-alias pad).
2. Snap the bbox **OUTWARD** to a bounded basis grid (≤200 cells/split) so the
   cell ⊇ the shape and never clips it.
3. `placeRects()` the pieces (input in paint order — greedy first-fit packs them
   into the fewest overlay layers; areas under lines under points).
4. Generate the mask path in **cell-local** coords (absolute − cell origin); set
   the mask `bounds` to the cell's px size → `scaleX==scaleY==1`, pixel-exact, no
   clip. Per-piece `overlay.alpha` (`fadeInExpr`) works the same inside a placed
   cell as on a full-frame overlay.

> Worked example: `charts/line-chart/v1/line-series.ts` (`placePiece`) — the
> animated line/area/points place as tight bbox cells (quantized to the same
> frame basis as the chrome), not full-canvas masked overlays. That template was
> first authored as ~78 full-frame overlays (one per title/label/gridline)
> positioned by `xExpr`, then rebuilt as a `weightedSplit` frame with only the
> animated line left as an overlay. Stat-card (`weightedSplit` bands) is the
> canonical small example.

### The placement recipes

How to make the placed rects composable — precision that does NOT track the
canvas — is the recipe book at [`geometry-recipes.md`](geometry-recipes.md):

- Recipe 1: `SNAP_PX` snap-outward for tight-mask cells (seams + GCD collapse).
- Recipe 2: `placeInsetPieces` / `placeOptimizedPieces` for independent chrome.
- Recipe 3: gutterless ratio grid + `latticeCellInset` for uniform grids
  (incl. the `gridCellInset` → `latticeCellInset` migration).
- Plus: the routing table, the feasibility/precision/quantization floors, and the
  `placeRect` escape hatch for must-be-exact elements.
- Recipe 4 (the lattice, `@m0saic/template-utils` `lattice/`): weighted bands go
  through `weightedSplit(latticeWeights(weights, { cap: 120 }), axis, { claimants })`
  — `latticeWeights` judges the GCD-reduced total, never emits more slots than
  the input had, keeps symmetry (`[pad, mid, pad]`) and alternation
  (items/gutters), bounds drift to max(2 %, 2 slots, 1 slot of the target) and
  otherwise returns the input untouched so the convention reports it. **Never
  round each weight to a cap on its own** — the sum lands on cap ± (bands − 1),
  which is how the whole Alpine pack sat on 121. When an intent must register
  with the cell a split will actually produce (a chip inset, a tick font cap, a
  nested child's slot), predict it with `quantizedSections(totalPx, weights)` —
  the parser's outside-in remainder, an EDGE section absorbs it first — and hand
  children 5-smooth slots (`nearestSmooth`, `snapSlot`, or the hero's `insetSlot`
  pattern that nudges the rect until the predicted cell is smooth). Self-framed
  soups take the pitch from `divisors(side)` nearest `side/K` (`ceilToSmooth`
  fallback on a rough side), never `round(side/K)` + `ceil`. The rule behind it
  (`latticeSmooth`, throw) and the `lattice` declarations:
  [`reference/template-flags.md`](reference/template-flags.md).

### Don't size/position with `size` expressions — carve the cell

To make an element small/short (a tick, a rule, a swatch, a badge), DON'T keep
the source full-tile and shrink it with `fitMode:"content"` + `size:{wExpr,hExpr}`
+ `placement:{fit:"contain"}`. `fit` is only `contain`/`cover` — both **scale**:
a source small in BOTH axes upscales to fill its tile (blocks / distortion). It
only "stays small" when one dimension is already full (so a full-height 1px rule
via `wExpr:"max(1,TW*f)", hExpr:"TH"` is the one acceptable size-expr case).

**Carve the cell instead.** Geometry decides size+position; the source fills.

- **Smell test:** writing `size:{wExpr,hExpr}` to make something SMALL in both
  axes → you're scaling, not placing. Carve a rect.
- Worked example: line-chart **tick marks**. First attempt sized stubs with
  size-exprs → rendered as full-cell blocks (contain upscaled them). Fix: carve a
  narrow RAIL cell beside the labels and nest a short `grid` — its thin
  line-cells ARE the tick rects, exact and aligned. (`chrome.ts`)

### Solid-colour tile sources — use `makeColorTile`

`@m0saic/template-utils` exports `makeColorTile(color, opts?)` as the shared factory for "paint this cell with a solid colour" sources (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/sources/makeColorTile.ts#L52). Adoption is now broad — `brand/logo/v1`/`v2`/`v3`, the whole alpine pack (via `alpine/_shared/alpine-card.ts`), and ~20 other templates use it. New templates should follow the same convention so the engine pipeline stays uniform. (Grep `makeColorTile` in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src for the live consumer list.)

```ts
import { makeColorTile } from "@m0saic/template-utils";

makeColorTile("#050314");
makeColorTile(color, { overlay: { alpha, enable, xExpr, yExpr, startAtSec, blendMode } });
makeColorTile(color, { mask });
makeColorTile(color, { overlay: { enable }, mask });
```

Returns a `MosaicLavfiSource` using ffmpeg's `color=` generator. Prefer this over hand-rolling a `MosaicTextSource` with empty literal text + `visual.backgroundColor`:

- `color=` is essentially free per cell — no rasterized intermediate to share, so N independent tiles cost no more than one shared source with N refs would (and refs to lavfi at nested depth aren't wired in v1 anyway — see `rendering-model-contract.md` Rule 9's ref-source note).
- Lavfi sources are valid `MosaicRefSource` targets at root depth without needing the `renderMode: { kind: "image" }` escape hatch.
- Single API across templates — no per-template variants of `makeSolidColorTile` to drift.

Verify the export with: `grep -n "export function makeColorTile" https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/sources/makeColorTile.ts.

### Drawing shapes: SVG inline-mask on a **color** source

The Rect Thesis above says a cell is either *filled* or *masked*. This is how to mask
one — arrows, triangles, badge silhouettes, any non-rect shape.

**Two wrong reaches, in order of temptation:**

1. **A drawtext glyph** (`▲` / `▼` / an emoji). ffmpeg silently drops these as tofu.
   Nothing errors; the shape is just gone.
2. **A `text` source with a `backgroundColor` rect + an inline-mask.** This *works*,
   but routes a shape through the text path and distorts easily.

**Do this instead** — a lavfi colour source (via `makeColorTile` above), masked by
an SVG path:

```ts
makeColorTile(color, { mask: { kind: "inline-mask", localPath, bounds } })
```

No drawtext involvement, and it renders in **both** the engine and the Make preview
(LavfiTile applies masks). m0 controls the rect; SVG draws the shape into it. ffmpeg is
excellent at *composition* and the wrong tool for *drawing* — SVG is the specialist.

#### ⚠️ The load-bearing rule: `bounds` aspect MUST match the cell's aspect

The engine scales the authored path to the tile:

```
scaleX = tileW / bounds.width
scaleY = tileH / bounds.height
```

Those are computed **independently**. If `bounds` aspect ≠ tile aspect the scale is
**anisotropic** and the shape distorts — a right angle stops being a right angle. Author
the path in the cell's actual pixel space (or any matching ratio) so `scaleX === scaleY`.
Get that right and the shape is undistorted *and* crisp at any resolution: sharp
rasterizes at tile res, so it stays vector-clean.

This one rule is the whole difference between a crisp triangle and a smeared one, and
it fails silently — the render succeeds, it just looks wrong.

#### Two supporting habits

- **Keep the rect's split coarse.** Sizing the shape's cell with pixel-exact
  `weightedSplit` weights can push the literal split past ~200 cells and hit
  engine split-rounding. Percent-ish weights are enough — the mask does the precision.
- **Author variants in the template, select by prop.** Up / down / neutral arrows are
  three authored paths; the template picks one from a `direction` prop. Don't compute
  path geometry at render time.

#### Check the shared helpers before authoring a path

`@m0saic/dsl-stdlib` ships a small shape library at
https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/libraries/mask-shapes — each returns a ready `M0cMaskEntry`
(path + correctly-authored `bounds`, so the aspect rule above is handled for you):

| Helper | Signature |
|---|---|
| `circleMask` | `(width, height = width)` |
| `roundedRectMask` | `(width, height, radius…)` |
| `pillMask` | `(width, height)` |

**Prefer these over a hand-authored path** — they're where the bounds discipline lives.

There is **no `triangleMask`** yet; `charts/stat-card/v1` authors its arrow paths inline
and leaves a `// (Future: a triangleMask helper in dsl-stdlib/mask-shapes.)` marker at
`stat-card.ts:300`. If you need a second triangle, add the helper rather than
copy-pasting the path — that's the signal the library is missing one.

### Canvas / card backgrounds: prefer `document.backgroundColor`

For a full-frame background fill, set `backgroundColor` on the returned
`MosaicDocument` — **don't** add a dedicated base layer via a `1{...}` overlay wrapper.

A base-layer overlay makes the doc **two layers** (L0 = surface, L1 = content). The
engine renders that correctly, but the Make-page preview then has to composite the
upper layer over the lower one, and **that compositing is best-effort** — it can show
black, or a stray cell background, where the lower layer should show through the
upper's transparent areas. The render is right and the preview lies, which is the worst
failure mode: the preview is the surface you and the human review on.

`document.backgroundColor` keeps the card a **single DSL layer**. The engine fills the
canvas wherever sources don't cover; the preview paints the same colour straight onto
`.gp-canvas` with no layer compositing. Render and preview agree, and the m0 is lighter
(no wrapper, no base tile source).

**Reach for a base tile only when `backgroundColor` can't express it** — rounded
corners, a stroke, per-region fills. It's a flat rect fill, nothing more.

**Two adjacent things, easily confused:**

- **`doc.backgroundImage`** (`MosaicBackgroundImage`) is the sibling for a *baked image*
  background — bottom layer, beneath every source, **on top of** `backgroundColor`.
  Carries `opacity` (ghost a reference at `0.3`), `fit` (default `"cover"`;
  `"contain"` letterboxes against `backgroundColor`), and `focusX`/`focusY` crop
  anchors with the same semantics as `placement.focusX`. This is the mechanism behind
  the agent protocol's reference-background bake — build chrome on top of a reference
  render, section by section.
- **`source.visual.backgroundColor`** is a *different field on a different object* — it
  fills one source's tile, not the canvas. Same name, unrelated scope. Check which one
  you're reading.

### Text needs a WIDTH, chrome needs `min(H, 0.75·W)`

`drawtext` never shrinks a string and `fit:"contain"` only picks the anchor, so a
font sized from a bar's HEIGHT clips on any canvas narrower than the design
aspect. Fit every text under `textEmUnits(text) × fontSize × em` with a budget of
`cell × 0.94 − 2px` (quantization takes 1–2px per split level), prefer a degrade
ladder (shrink → compact wording → drop) over ellipsis at the floor, and size
chrome bars off `min(H, 0.75·W)` rather than a fraction of H (a 173px header slab
on 1080×1920 otherwise). The full rule set, em table, and the 7-canvas gate sweep:
[`layout-contract.md`](layout-contract.md) §"Text".

### Verifying layout intent survived

The m0 is exact but disposable — stableKeys and tile order are per-string and
can't carry authored intent, and quantization squashes are invisible to
string-level tools. The label-keyed layout contract (`withLayoutContract` /
`checkLayout` / `assertLayout`) plus the three resolve-only audits close that
loop: [`layout-contract.md`](layout-contract.md).

## Avoid overengineering

Just because the DSL allows `0{...}`, deep overlay stacks, logical owners `-{}`,
and nested containers everywhere does not mean every template should use them.
Prefer the simplest construct that expresses the layout clearly.

Weighted splits: prefer small basis values (10, 20, 32, 64); avoid extreme counts
unless intentional; ensure the render resolution supports the split granularity;
remember feasibility constraints. Only use `0`-runs for precise weighted
geometry, advanced prefix-overlay patterns, or algorithmic generation — avoid
them for everyday layouts.

A good template has predictable geometry, works at intended resolutions, uses
overlays intentionally, avoids fragile structural side-effects and unnecessary
deep nesting — and is deterministic, has safe defaults, and passes validation
cleanly.

## Checklist

When designing a template:

- [ ] Do I know each region's rect at author time? If so, is it a REAL m0 cell (not a full-frame `xExpr`/mask overlay)? (See the Hard Rule.)
- [ ] Is this primarily structural layout or paint layering?
- [ ] Could this be simpler with direct splits?
- [ ] Am I using overlays intentionally?
- [ ] Is the string readable if humans will maintain it?
- [ ] Is this dictionary-level generation where readability does not matter?
- [ ] Does it validate and remain feasible at target resolution?
- [ ] Is every split count above 12 5-smooth (2ᵃ3ᵇ5ᶜ) — basis capped with `latticeWeights` / `precision`, never per-weight rounding? The gate (`latticeSmooth`, throw) and `m0saic doctor` will refuse it otherwise; a raster declares `lattice: { mode: "bitmap" }`, a content count `lattice.allow` with its reason.
- [ ] Did I route through the right placement recipe ([`geometry-recipes.md`](geometry-recipes.md)) instead of hand-rolling pixel math?
