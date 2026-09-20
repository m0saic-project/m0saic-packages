# m0 construction methods — the all-up map

> Every way to produce an m0 string, on one page. **Two questions pick the method;
> four currencies price it.** This is an index — each row links to the canonical
> treatment. Companions:
> [`feasibility-precision-quantization.md`](feasibility-precision-quantization.md)
> (per-split math, §3a/§3b pairwise choices),
> [`composition-arithmetic.md`](composition-arithmetic.md) (nesting math),
> [`precision-tiers.md`](precision-tiers.md) (head vs primitive),
> https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/GCD.md (the encoder story), and https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/API.md +
> https://github.com/m0saic-dsl/m0/blob/main/https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/.ai/method-catalog.md (signatures / per-method docs).

---

## 0. The two questions

1. **Who owns the canvas?** (the MODE, feasibility §3c) — a nestable **primitive**
   must stay RATIO; a **head** that owns its render target may go ABSOLUTE; a baked
   pixel-animation asset is BITMAP (bake once, reference forever).
2. **What shape is the content?** — proportional regions · uniform grid · one exact
   rect · many exact rects · curves/shapes · imported geometry · an existing m0 to
   edit.

Answer both before touching a builder. Mode mistakes are the expensive ones —
laundering ABSOLUTE into fine RATIO is the §3c anti-pattern that silently drops
nested content.

---

## 1. The four currencies

Every method pays for geometry in some mix of:

| currency | what it costs | where it shows |
|---|---|---|
| **slots** | m0 chars + precision floor | the string itself; `computePrecisionFromString` |
| **drift** | visual px moved off-target | the render; arithmetically CLEAN cells (composition-arithmetic §3) |
| **fiber** | nothing structural — inset / cell-local masks / xExpr | invisible to the m0; leaf-only; previews must read `placement` |
| **layers** | overlay depth | graph cost; the ~25-mask cliff (engine wall W3, internal doc) |

A method is a fixed exchange rate among these. The recurring trade: exact-pixel
truth costs **slots**; you buy them back with **drift** (visual error), **fiber**
(shrink-room + transparency required), or **layers** (graph depth).

---

## 2. The map

### 2a. Proportional — RATIO (resolution-independent, nests)

| method | shape | notes |
|---|---|---|
| `weightedSplit` (+ `equalSplit`, `container`, `weightedTokens`, `strip`) | authored proportional regions | auto-GCD-reduced; quantizes when basis ∤ axis (feasibility §3); the default |
| `grid` | uniform cells, ratio gutters | `MIN_PX_PER_WEIGHT = 4` auto-scale; for a GAPPED grid go **gutterless + `latticeCellInset`** — gap in the fiber, see construction-strategy's grid recipe (`gridCellInset` is deprecated: approximate) |
| `safeCanvas` / `snapGridFit` / `snapGridFind` / `snapGridEnumerate` / `aspectSafeGrid` | design-time canvas/grid search | quantization-free dims; ranking; landscape↔portrait pairs |
| `goldenSplit` / `goldenSpiral` | φ compositions | Fibonacci weights = the optimal bounded-basis approximants of φ (composition-arithmetic §7) |
| `spotlight` / `comparison` / `rankedList` | opinionated presets | sugar over weighted splits |
| template-local kits (`rowSplit`/`colSplit`/`insetNode` in alpine `_shared`, dsl-tutorial `node-kit`) | per-pack sugar | NOT published; **`insetNode` is the §3b trap** — its margins are real cells that quantize INTO the placed rect; never use it for must-be-exact elements |

### 2b. Exact-pixel — ABSOLUTE (resolution-baked; head-only unless laundered)

| method | shape | pays | notes |
|---|---|---|---|
| `aspectFit` | letterbox an aspect | slots | exact frame + null margins |
| `placeRect` | ONE exact rect | slots | null-tile margins, multi-resolution-safe (§3b); `goldenRect` wraps it |
| `placeRects` | MANY exact rects | slots (+ layers on overlap) | band decomposition + `importance` z-packing; exact at its canvas (§3a) |
| `snapRectPrecision` | one rect, near-exact | drift | Pareto frontier of nearby low-precision rects; the single-rect GCD-snap |
| `placeOptimizedRects` / `placeOptimizedPieces` (template-utils) | many rects, near-exact | drift | per-rect `driftPx` budgets, `0` = LOCK exact; zero-drift ⇒ byte-identical to `placeRects` |
| `placeInsetRects` / `placeInsetPieces` (template-utils) | many rects, exact content in coarse cells | fiber (+ layers on overlap) | divisor-pitch cells + half-pixel-centered inset recovery: **zero drift** at bounded precision; needs transparent-margin leaves + shrink room; `onHostile: "exact"` for runtime primitives (prime dims degrade to exact, reported). Exemplar: `alpine/stat-card/v1` |

### 2c. The launder ladder — making ABSOLUTE content composable

**This is the canonical enumeration** (per-rung mechanics, constraints, and
measured numbers live in
[`feasibility-precision-quantization.md`](feasibility-precision-quantization.md)
§3c, which references these rung numbers). In preference order — stop at the
first rung that fits:

1. **Restructure into nested ratio splits** — no helper, no cost (all six alpine
   rebuilds landed here). Includes canvas-adaptive re-layout: a template is
   `(props, canvas) → m0`, so at a size that would quantize, return a DIFFERENT
   ratio m0 that divides cleanly.
2. **Decouple thin features from the basis** — thin lines only: fixed-px strips
   at proportional overlay offsets instead of an interleaved `[gap,line,gap,…]`
   split (`primitives/grid/v2`); N shallow mask-free overlays, nests into any
   cell.
3. **Ratio grid + gap-as-`latticeCellInset`** — uniform grids; never drift a grid
   (unequal cells), never `placeRects` per cell.
4. **Mask-in-a-cell** — curves/charts/rings: marks are masks filling ONE ratio
   cell in cell-local coords; registration is free because they share the cell.
5. **`placeInsetRects` / `placeInsetPieces`** — independent rect soups with
   transparent margins and gaps ≥ pitch−1: zero drift, bounded precision
   (stat-card ships on this rung).
6. **`placeOptimizedRects` drift** — when inset-recovery doesn't apply: container
   edges, cell-painting tiles, wanted-snap (pixel-aligned strokes), or mixed
   soups needing per-rect LOCKS.
7. **Self-framed coarse-quantize** — many-mask soups over the ~25-mask cliff:
   own P-divisible frame, outward bbox snap, ratio letterbox (≤1px uniform
   translation).
8. **Honest ABSOLUTE at the head** — the element owns its canvas and never nests
   (pulse beats). Legitimate; just keep it out of `primitive`-role templates
   (the audit slope catches violations).

**Verify the rung held.** Tag the placed sources with LABELS and declare
canvas-independent ratio invariants (aspect / fraction / `within` / **presence**,
incl. through nesting) via the **layout contract** — `checkLayout` is the pure
evaluator a layout search loops on, and `npm run audit:layout-envelope` reports
the canvas range where each holds. The emitter round-trip guard
(`audit:geometry-matrix` / `audit:geometry-proof`) additionally locks a
zero-drift placement. Resolve-only, opt-in. See
[`../templates/construction-strategy.md`](../templates/construction-strategy.md)
"Verifying layout intent survived".

### 2d. Import & generate (content → m0)

| method | source | notes |
|---|---|---|
| `svgToM0` / `enumerateSvgToM0` / `rectsToM0` (+ `parseSvg`, `extractGeometry`, `inferGrid`) | SVG / pixel-rect sets | packing + gcd-snap drift modes; the GCD.md story; emit variants and `compareM0` them |
| `qrToM0` / `barcodeToM0` / `binaryGridToM0` + pixel-art family | codes / bitmaps | **BITMAP mode** — bake to an asset, never live-compose |
| `generateMasks` / `circleMask` / `roundedRectMask` / `pillMask` / `toLocalPath` | shapes | fiber, not m0 — mask sidecars + cell-local paths |

### 2e. Re-emission (m0 → m0)

| method | job |
|---|---|
| targeted transforms (`split`, `replace`, `addOverlay`, …) + `pipe`/`compose`/`withHistory` | edits that preserve StableKey identity |
| `reduceSplitCounts` | per-split GCD tidy, drift-budgeted (default lossless) |
| `compactLossless` / `compactDocument` | closeout: null-layer removal, growth-guarded repack, optional gcd drift |
| `rebuildRects` | post-render geometry edits — always rebuilds, resolution-baked |

**Rule:** when identity must survive (saved docs, `_humanedits`), EDIT the existing
m0 — never regenerate from scratch.

### 2f. Not-a-builder — the fiber

Sometimes the answer is no m0 at all: `placement.inset` (`latticeCellInset`, the
`placeInsetPieces` recovery), cell-local mask paths, `xExpr`/`yExpr` offsets,
cell-local text. Zero chars, zero precision, leaf-only, invisible to structure —
and *unable* to break composition (composition-arithmetic §4). If nothing else
needs to see the geometry structurally, put it in the fiber.

> **The inset fiber now has a persisted file-format home.** `placement.inset`
> is promoted to a first-class, stableKey-keyed `insets` field on `.m0c` /
> `.m0p` (per-edge fractions; resolved projection of the `MosaicBoxFrac`
> superset), so the recovered rect survives to the file, is painted as a cyan
> inner box in Layout, and is editable per-edge in the inspector + File
> Details. See `file-formats/m0p-and-custom-field.md` §4. It's still fiber —
> zero m0 chars — just no longer invisible to the editor.

---

## 3. Pairwise discriminators (the recurring confusions)

- **`weightedSplit` vs `placeRects`** → feasibility §3a. Portable proportions vs
  baked exactness; clean proportions cost the same either way.
- **`placeRect` vs `placeRects`** → count (§3b). More than a couple of rects →
  plural (layer packing is the real win).
- **`snapRectPrecision` vs `placeOptimizedRects`** → one rect (with a Pareto
  frontier to choose from) vs many (with per-rect budgets/locks).
- **`placeInsetRects` vs `placeOptimizedRects`** → where BOTH apply (independent
  transparent-margin leaves, gaps ≥ pitch−1) inset-recovery dominates (zero
  drift). Drift remains RIGHT for: per-rect LOCKS, container edges, tiles that
  paint their whole cell, wanted-snap (strokes, butt-joint cell edges). Both
  degrade identically on hostile prime axes (pitch → 1, exact).
- **`grid` vs anything-per-cell** → never place grid cells individually; grids
  are one ratio structure + fiber gaps.
- **mask-in-a-cell vs self-framed quantize** → count the masks: one shared cell
  until the ~25-mask cliff; past it, self-frame with `placeRects` layer-packing.
- **`insetNode` vs `placeRect`** → §3b: insetNode margins quantize INTO the rect;
  placeRect null margins never claim space.

---

## 4. The decision playbook (in order)

1. **Mode first.** Primitive → RATIO only (rungs 1–7 of the ladder). Head →
   ABSOLUTE allowed (rung 8). Pixel animation → BITMAP, baked.
2. **Shape second.** Proportional regions → `weightedSplit`. Uniform grid →
   `grid` gutterless + `latticeCellInset`. One exact element → `placeRect`. Many
   exact rects → `placeRects` (head) or the launder ladder (primitive).
   Curves/shapes → masks in a shared ratio cell. Import → §2d. Existing m0 → §2e.
3. **Price it.** Split counts from `divisors(axis)`, 5-smooth, basis ≤ 120 for
   family portability (composition-arithmetic §1–§2). Layers under the cliff.
4. **Measure, don't guess.** `evaluateM0` / `compareM0` / `quantizationSpread` at
   ≥ `recommendedMin`; generators should emit 2–3 candidates and compare.

---

## See also

- [`feasibility-precision-quantization.md`](feasibility-precision-quantization.md) —
  §3a/§3b/§3c: the pairwise choices and the per-rung launder detail this map
  routes between.
- [`composition-arithmetic.md`](composition-arithmetic.md) — why the routing works
  (currencies, hereditary quantization, the lattice math).
- [`precision-tiers.md`](precision-tiers.md) — head/primitive.
- [`../templates/construction-strategy.md`](../templates/construction-strategy.md) —
  authoring-side application (the recipe subsections).
- https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/API.md / https://github.com/m0saic-dsl/m0/blob/main/https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/.ai/method-catalog.md — signatures and
  per-method agent docs.
- https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/GCD.md — the import-path compression story.
