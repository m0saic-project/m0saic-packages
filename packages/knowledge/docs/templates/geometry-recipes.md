# Geometry recipes — laundering pixel math into composable m0

Scope: the placement recipes for templates that follow the Real-Geometry Hard Rule.
You computed each piece's pixel rect in JS; these recipes turn those rects into m0
geometry whose precision does NOT track the canvas. Read
[`construction-strategy.md`](construction-strategy.md) first (the Rect Thesis + Hard
Rule — why the rects must be real cells at all); the underlying theory (feasibility
vs precision vs quantization, GCD collapse, §3a/§3c fixes) is
[`../handbook/feasibility-precision-quantization.md`](../handbook/feasibility-precision-quantization.md).

## Routing — which launder for which shape

- Uniform grid of equal cells → **Recipe 3** (gutterless ratio grid + `latticeCellInset`).
- Bar row/column → Recipe 3 with a non-zero `marginPx` on the layout axis.
- Independent chrome/text (stat-card bands, KPI blocks, badges) → **Recipe 2**
  (`placeInsetPieces`; `placeOptimizedPieces` when inset-recovery doesn't apply).
- Tight-mask pieces (animated line/area/points) → **Recipe 1** (`SNAP_PX` snap-outward).
- Squarified tiling (treemap) → nested ratio splits with gap-as-inset per leaf
  (adjacent tiles share edges — drift opens gaps).
- Connected/curve/ring geometry → mask-in-a-cell (handbook §3c); legit-absolute ONLY
  when the animation varies the mask PATH per frame — almost nothing does.
- One must-be-exact element at any resolution → the `placeRect` escape hatch (end of
  this doc).

## Recipe 1 — snap tight-mask cells to a grid (`SNAP_PX`)

After computing a masked piece's tight bbox (see the animation-exemption steps in
`construction-strategy.md`), **snap it OUTWARD to a small px grid (`SNAP_PX`, e.g. 4)
before you author the mask** — then build the mask sized to the *snapped* cell. Two
wins from one move:

- **Seams disappear.** Independently-quantized tight cells miss each other by a
  sub-pixel (hairline seams between abutting pieces). Snapping every edge to a
  shared grid lands neighbours on the same grid lines, so they meet.
- **DSL collapses.** Once all band edges are multiples of `SNAP_PX`, `placeRects`
  GCD-reduces by that factor (~`SNAP_PX`× shorter). donut/v3: 27,016 → 6,142 chars
  at `SNAP_PX=4`, ring unchanged.

**Mask-safe because the order matters:** snap the cell, THEN author the mask for
the snapped cell (`bounds` = snapped cell px). The shape path is still generated
from the true center/radius (exact geometry); only the cell *bounds* snap, so the
mask never re-scales. This is the build-time, distortion-free analog of the Layout
editor's "GCD reduce + drift %" compaction — do NOT run that compaction on a
mask-bearing doc after the fact (it resizes cells the masks were authored against
→ distortion).

Pick `SNAP_PX` to taste: ↑ = smaller DSL + coarser edges (more outward drift),
↓ = larger DSL + finer. ~4px is a good default. (The line-chart does the
equivalent via a fixed basis grid: `snapAndPlace` quantizes to `BASIS_COL`×
`BASIS_ROW` so its data layer shares the chrome's basis.) Pair it with a hair of
overlap between abutting same-content pieces (and a smaller amount across a color
boundary) so anti-aliased edges can't reveal the background — snapping aligns
edges, overlap covers the residual.

> Worked examples: `charts/donut/v3/donut.ts` (`SNAP_PX` + `placePiece`);
> `charts/line-chart/v1/line-series.ts` (`snapAndPlace`). This is how a tight-mask
> template *makes* its positions GCD-collapsible on purpose — see handbook §3a.

**Head-only as written — a FIXED `SNAP_PX` still tracks the canvas.** A fixed
pitch bounds the CHAR count but not precision: the basis is `regionSide/SNAP_PX`,
which grows with the canvas (donut/v3 probed ABSOLUTE, slope 1.04, and pinned its
parent). A **nestable primitive** uses the self-framed version instead:
canvas-proportional pitch `P = round(min(W,H)/K)`, square frame side
`S = ceil(regionSide/P)·P` (a `P`-multiple by construction), `placeRects` inside
the frame, then ratio-letterbox the frame into the canvas (cost: ≤1px uniform
translation, zero relative drift). Precision bounds at ~`K` on every canvas —
even coprime dims. `charts/donut/v4` is the exemplar (`ABSOLUTE 1.04 → RATIO ~0`,
library to 0 audit warnings); full treatment handbook §3c. Also from v4: on a
light or deeply-nested surface, anti-aliased sliver notches need an **inflated
seamless base per segment, timed to each segment's completion** — the
overlap-hair above can't close an AA gap.

## Recipe 2 — independent chrome/text: launder the basis (`placeInsetPieces` / `placeOptimizedPieces`)

The `SNAP_PX` recipe above is the by-hand move for masked pieces. For a primitive
that positions **independent** rects (stat-card chrome, KPI blocks, badges) with
`placeRects`, use the tool-ified version — and the default tool is the
**zero-drift** one: hand your `{ rect, source }` pieces to `placeInsetPieces`
(`@m0saic/template-utils`, https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/layout/placeInsetPieces.ts#L119).
It quantizes each piece's CELL outward to a divisor
lattice (precision bounds at ~120, the modern canvas-family gcd) and returns the
frame-aligned sources with a recovery `placement.inset` wired onto each — every
element paints on its EXACT computed rect. Why it matters: ONE coprime edge pins
the whole leaf to ~its render canvas AND back-solves to pin the parent
(`needs = self × canvas ÷ slot`) — the stat-card rail is what held the pulse
hero's Safe-Min at 1895×1080. Exemplar: `alpine/stat-card/v1` (migrated
2026-07-10 from the drift budget: same `100% → ~17%` collapse, now with zero
visual drift; hostile prime-dim cells automatically degrade to exact on that
axis and render fine). Contract: sources must paint nothing outside their inset
box (transparent margins), and a source may not already carry `placement.inset`
— bake design insets into the rect instead (it paints exactly, so shrinking it
is free).

Reach for `placeOptimizedPieces` (drift;
https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/layout/placeOptimizedPieces.ts#L95) instead when
inset-recovery doesn't
apply: per-piece LOCKS (`drift: "exact"` on must-stay-exact geometry mixed with
collapsible chrome), container rects, tiles that paint their whole cell, or
wanted-snap (pixel-aligned strokes). Scope guard for BOTH: independent elements
ONLY — a uniform grid wants the ratio-grid recipe (Recipe 3; equal cells snap
unequal under drift), a tiling shares edges (drift opens gaps), and
connected/curve geometry wants mask-in-a-cell instead (handbook §3c). Full
treatment: handbook §3c (fixes three and four).

## Recipe 3 — uniform grids: gutterless ratio grid + gap-as-inset (`grid` + `latticeCellInset`)

> **⚠️ Helper changed 2026-07-21.** This recipe's *shape* is unchanged and still
> correct — gutterless `grid()`, gap in the fiber, zero DSL tokens. But the helper
> that computes the inset is now **`latticeCellInset`**; **`gridCellInset` is
> deprecated** (approximate, ±1px gap wobble — see handbook §3c and
> `HELPER_DEPRECATIONS` in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/deprecation.ts). Read
> "Migrating off `gridCellInset`" at the end of this recipe before writing code:
> the replacement is **not a drop-in rename**, it takes different inputs.

**A nestable primitive whose picture is a uniform grid of equal
cells emits a gutterless `grid()` with the gap as a `latticeCellInset` on each cell
source — never DSL gutters, never `placeRects` per cell.** The absolute build
(`placeRects` per cell on a per-pixel snap grid) pins precision to the canvas —
coprime cell pitches ⇒ `gcd 1` ⇒ ~100% precision (heatmap v1 was a **30k-node
m0**) — and drift is the WRONG launder here (equal cells snap unequal; a
quantization-spread guard catches it). The ratio build:

1. **Gutterless `grid({ rows, cols })`** for the cells. No DSL gutters — a gutter
   is a pixel-width band baked into the split, which re-introduces the
   coprime-basis blowup. The gutterless grid's precision is the **cell count**
   (`max(rows, cols)`), constant across every canvas.
2. **Gap as a per-cell `placement.inset`** via `latticeCellInset({ rows, cols,
   canvasW, canvasH, gutterXPx, gutterYPx, marginPx, cells })`
   (`@m0saic/template-utils`,
   https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/layout/latticeCellInset.ts#L79) — a render-time
   fractional inset, **zero DSL
   tokens**, so the layout string stays compact. It authors the TARGET painted
   grid first as integer lattice lines (`X_k = round(m + k·(unitW + g))`, each
   boundary rounded independently so drift can't accumulate), then emits each
   inset as `(px + 0.5) / rawSize` so the engine's per-edge `Math.floor`
   recovers the integer target exactly. Result: gutters are **exactly** `g` px
   between every adjacent pair and margins exactly `m`, on every canvas.
3. **Chrome as plain ratio splits** (`weightedSplit`; the alpine kit's local
   `rowSplit`/`colSplit` in `alpine/_shared` are sugar over it — not published) —
   row/col labels, legend, letterbox. Center square cells with a null-node
   letterbox (`{ weight: LB, node: EMPTY }`), never absolute offsets.

Measured (heatmap v1 → v2, defaultProps): audit `ABSOLUTE slope 1.04 → RATIO
0.00`; Safe-Min @1080² `~777×583 → ~120×121`; `~30,316 → ~2,211` m0 nodes (~13×
leaner); ~5× faster default render; precision sweep clean everywhere. The
Safe-Min collapse is the composability payoff — an absolute grid back-solves
(`needs = self × canvas ÷ slot`) to pin its PARENT near its own render canvas;
the ratio grid asks its parent for almost nothing.

Trade-offs to know:

- **Full-bleed vs equal cells.** With `latticeCellInset` this is just
  `marginPx`: `marginPx: 0` is full-bleed (gaps only *between* cells),
  `marginPx: g` puts an equal margin around the grid. Unlike the deprecated
  `gridCellInset` — whose full-bleed default left outer cells up to `gapPx/2`
  larger than interior ones (invisible for image/color tiles, **wrong for bars**)
  — the lattice authors every boundary from the same integer line set, so cells
  differ only by ±1px independent-rounding jitter at any `marginPx`.
- **Check `maxClampPx` / `clampedEdges` on the result.** When the ideal slack
  (≈ `g/cols` px at the extreme interior boundaries) drops below the raw split's
  quantization jitter — tiny canvases with tiny gutters — a target edge escapes
  its raw cell and is **clamped to the cell boundary rather than thrown**,
  narrowing that one gutter. `0` on healthy lattices. A template that cares
  should assert it in its geometry-contract test; degrading to a ≤2px-off gutter
  at hostile canvases beats a dead render, but you want to know.
- **`skipFirstRowTop`** (a `gridCellInset` knob, for a grid hugging a header
  directly above it) has **no direct `latticeCellInset` equivalent** — express it
  in the lattice instead, by authoring the target rows you actually want.
- **The gap is not a DSL edge.** Because it's an inset, geometry-mode previews
  and the Render Hero layout viz must read `placement.inset` to show it (they
  do). A consumer reading only the m0 doesn't see the gap — that's the point
  (compactness), but preview code has to opt in.
- **Values / overlays** ride a *second* gutterless grid of the same shape,
  `overlay`-stacked on the cells — same precision, index-aligned.

### Migrating off `gridCellInset` (not a rename)

The two helpers take different inputs, because that's *why* the new one is exact:

| | `gridCellInset` (deprecated) | `latticeCellInset` |
|---|---|---|
| Sizing basis | the **ideal** cell (`gridW / cols`) | the **raw parsed** cell the engine really produced |
| Needs | `rows, cols, gridW, gridH, gapPx` | `rows, cols, canvasW, canvasH, gutterXPx, gutterYPx, marginPx, cells[]` |
| Fractions | plain `n / cell` | half-pixel-centered `(n + 0.5) / rawSize` |
| Outer margin | `outerMargin: true \| {x,y}` | `marginPx` (integer px) |
| Returns | inset per cell | `insetAt(i)`, `targets[]`, `columnEdges/rowEdges`, `maxClampPx`, `clampedEdges` |

The load-bearing step is supplying `cells[]`: **parse the COMPOSED m0 at the
render canvas** and hand over each span's `{ unit, raw }`. The raw cell is the
truth only *after* basis-capped ratio splits, letterbox bands, and engine
rounding have all happened — a `split()` whose weights sum past 120 RESCALES to
basis 120, so no up-front pixel math survives. Computing `cells[]` from your own
intended geometry re-introduces exactly the ideal-vs-quantized bug you're
migrating away from.

Then set `placement.inset = insetAt(i)` per source (skip when it returns
`undefined` — the raw cell already *is* the target), and assert against
`targets[]` in the geometry-contract test.

> Exemplars: `@m0saic/media/screencap_grid/v2` (gap-carved integer rects → one
> `placeInsetPieces` call — the pick when the helper should own the whole
> layout); `@m0saic/alpine/heatmap/v2` (the full data-viz build — cells + value
> overlay grid + labels + legend — migrated to `latticeCellInset`, with a
> regression test that replays the engine floor and asserts ONE gap value per
> axis at both the design canvas and an awkward 1000×700).
> `@m0saic/media/screencap_grid/v1` is kept registered + `deprecated` as the
> canonical reference for the ideal-cell-gap pitfall; `@m0saic/alpine/heatmap/v1`
> likewise for the "absolute grid" anti-example.

## The two floors — and the third question

Every m0 string exposes **two floors** — know which one you're hitting:

- **Feasibility** (`computeFeasibility` → `minWidthPx/minHeightPx`): the "won't
  error" floor. Below it the layout **errors** (0-size *frame*) — won't render.
- **Precision** (`M0Precision.maxSplit*`): the "looks right" floor — the smallest
  canvas where every split cell (incl. passthrough/donation cells) is ≥1px.
  **Independent of feasibility, and can be higher OR lower** (gutter grids:
  precision > feasibility; deep nesting: feasibility > precision). In practice
  render at ≥ the per-axis max of both (`evaluateM0`'s `recommendedMin`).
- Then a THIRD question above both floors: **quantization** — even on a big-enough
  canvas, if the split factor doesn't divide the axis the remainder spreads
  (1996px ÷ 499 → uniform 4px cells; 1920px ÷ 499 → some 3px/some 4px → positions
  shift). Deterministic, **not a bug** — see the handbook.

To get the appearance guarantee back: render at quantization-free dimensions
(`snapGridFit` / `snapGridEnumerate` find the largest clean inner rect), keep
cell counts modest, or quantize to a bounded basis and **derive dependent
geometry from the weights** so animated/overlaid layers track whatever spread the
canvas imposes.

Full treatment — feasibility vs precision, the quantization options, and GCD
collapse — in [`../handbook/feasibility-precision-quantization.md`](../handbook/feasibility-precision-quantization.md).

## Escape hatch — `placeRect` for must-be-exact elements

When an icon / chip / fixed-font band must occupy an exact pixel rect *regardless
of resolution*, position it with `placeRect` (null-tile margins, byte-exact at any
canvas; https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/builders/placeRect.ts#L99) — NOT a margin-based
`insetNode` (an alpine-pack-local helper at
https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/alpine/_shared/alpine-card.ts#L90, not a published
API), which turns the margins into split cells and spreads the quantization
remainder INTO the element (a flaky, resolution-dependent misalignment). See the
placeRect escape-hatch section in the handbook.

Layout-intent verification for all of these recipes — the label-keyed layout
contract + the three resolve-only audits — lives in
[`layout-contract.md`](layout-contract.md).
