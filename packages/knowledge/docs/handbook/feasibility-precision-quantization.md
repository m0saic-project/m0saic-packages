# Feasibility, Precision, Quantization & GCD — the geometry math

> The four properties that decide whether a layout **renders**, renders
> **correctly**, and looks **balanced**. All four are **absolute, deterministic
> math** — every outcome is computable *before* rendering a pixel. Don't guess
> and eyeball; check the numbers. Companion to [`dsl-rules.md`](dsl-rules.md)
> and the [thesis](../m0saic-thesis.md).

A split lays `N` cells across a pixel axis of length `T`. Everything below falls
out of that one fact and integer pixels.

---

## 1. FEASIBILITY — *will it render at all?*

The **parse floor.** Below it the layout **errors** (a split produces a 0-size
frame). A hard boundary, not a quality issue.

- **API:** `computeFeasibility(m0)` → `{ minWidthPx, minHeightPx }`
  (`@m0saic/dsl`). Exact minimum integer dims with no 0-size frame — accounts for
  nested same-axis splits, passthrough carry chains, and overlay constraints (not
  just `maxSplit`). Authoritative; no repeated-parse probing.
- **Calibration** (exact vs the structural `maxSplit`): `960(1,1,…,1)` needs
  ≥960px width (flat — exact = maxSplit); `2(5(1,1,1,1,1),5(1,1,1,1,1))` needs
  10px (nested same-axis — exact > maxSplit); `10(0,0,0,0,0,0,0,0,0,1)` needs
  1px (passthroughs donate — exact < maxSplit).
- **Error:** rendering below the floor raises `SPLIT_EXCEEDS_AXIS` ("split
  produced a 0-size frame").
- **Diagnostic:** after parsing at a concrete size, `M0ResolutionDiagnostics`
  (`tightestWidthPx`/`tightestHeightPx` + the offending `stableKey`) tells you the
  smallest frame actually produced — 1–2px means you're sitting on the floor.

**What to do:** ensure target dims ≥ `computeFeasibility(m0)`. If not, the layout
is *infeasible* — reduce cell count, decompose the split, or raise the canvas.
There is no "looks slightly off" here; it's render-or-error.

---

## 2. PRECISION — *will it look right?*

The **appearance guarantee** — separate from feasibility. A layout can be
feasible (parses, no 0-size *frame*) yet **not look right**, because below the
precision floor a split's cells (incl. passthrough/donation cells) can't each get
≥1px, so the layout squashes / spreads.

- **API:** `getComplexityMetricsFast(m0)` (the only aggregate export — the validating
  `getComplexityMetrics` was removed) bundles `precision` (`maxSplitX`/`maxSplitY`/
  `maxSplitAny` — the largest classifier count on each axis, O(n) scan) with
  frame/passthrough/null counts and `precisionCost = maxSplitAny`.
  (`computePrecisionFromString` is an internal dsl helper, not public API.)
- **Warning surface:** when `maxSplitAny` exceeds the norm (`opts.precisionNorm` on
  `parseM0StringComplete`, default 100), the parse emits a `PRECISION_EXCEEDS_NORM`
  **warning** (https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/warnings/warnings.ts). Not invalid — a signal the
  layout is highly granular: possibly expensive, size-sensitive, hard to reason
  about. Raise the norm deliberately for intentionally fine layouts.
- **Relationship — two INDEPENDENT floors that cross both ways.** Feasibility
  (no 0-size *frame*) and precision (every split cell ≥1px, incl. passthroughs)
  are *not* ordered — neither is a floor on the other. Measured across the sandbox
  corpus: gutter grids and `weightedSplit([3,5,2])` have **precision > feasibility**
  (render small, only look right bigger); deeply-nested same-axis layouts have
  **feasibility > precision**. In practice take the **per-axis max of both** — the
  smallest canvas that *renders AND looks right*. `evaluateM0`/`compareM0`
  (`@m0saic/dsl-stdlib`) expose `feasible`, `meetsPrecision`, and that
  `recommendedMin` directly. Even above precision, exact balance is a further
  question — quantization (§3).

**What to do:** treat "feasible" as "won't error," never as "looks correct."
After feasibility, ask the quantization question.

---

## 3. QUANTIZATION — *is it balanced, or does it spread?*

When `N` cells don't divide the axis `T` evenly, the `T - N·floor(T/N)` leftover
pixels must go *somewhere*. The engine distributes them **outside-in**, so cell
sizes differ and any position computed from them **shifts** — a chart's middle
gridline drifts, a grid's center column is a pixel thin. This **visual
imbalance** is:

- **Deterministic** — same string + same dims → identical pixels, every time.
- **Not a bug, not an error** — the defined consequence of integer pixels.
- **Predictable** — `T % totalWeight === 0` ⇒ perfectly uniform; otherwise
  spread, growing with cell count. Measured: a 499-cell split rendered uniform
  at **1996px** (=4×499, gaps `[400,400,400]`) but spread at **1920px** (gaps
  `[400,324,400]`) — same string, both deterministic; the 1920 case is feasible
  but sub-precision.

**Outside-in remainder distribution (the exact rule).** Each slot starts at
`base = floor(total/N)`; the remainder `rem = total − base·N` is added one pixel
at a time to indices in the order `0, N−1, 1, N−2, 2, N−3, …` (edges first,
center last — NOT first-N). Example: `4(1,1,1,1)` at axis 103 → base 25, rem 3,
order `0, 3, 1, 2` → sizes `[26, 26, 25, 26]`. Intentional and stable;
generators that predict per-slot pixel geometry must reproduce it exactly.
Source: https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts ("outside-in remainder
distribution"); locked by https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/outside-in-remainder.test.ts.

**You know in advance when something will look unbalanced — don't ship it blind.
You can't change the math; you massage the values:**

### ★ The general fix: `placeRects` at real pixel positions

Spread comes from letting a **weight basis** decide positions — a basis that
doesn't divide the axis. The general escape: stop using a weight basis at all —
compute the wanted positions as **absolute integer pixels**, then `placeRects` a
rect at each. Why it's exact: placeRects builds bands whose weights ARE those
pixel sizes and **sum to the axis length**, so each weight maps to an integer
pixel count — no remainder to spread. The pattern: **trivial even split → read
the clean edge positions → `placeRects` exact rects there.** Two rules keep it
exact:

1. **Round each boundary independently** from its fraction — `round(i/N · axisPx)`
   — never sum rounded widths (that accumulates error). Independent rounding
   bounds error to ≤0.5px per line, no drift.
2. **Compute at the target resolution.** The px are baked — the deliberate trade
   for exactness. Feed it the slot's real dims (`ctx.target` when nested).

> **Caveat — this is a HEAD move (§3c).** It bakes a canvas-scale basis, so it's
> exact only where the element owns its canvas and won't be nested. Doing it
> inside a *nestable* primitive is the "absolute → fine ratio" anti-pattern —
> see the grid/v1 callout in §3c.

(The resolution-DEPENDENT vs -INDEPENDENT trade this makes, and when each side
wins, is §3a — the builder choice.)

### When you're staying weight-based

- **GCD-collapse the weights** (§4) — fewer cells → larger px-per-weight →
  smaller relative remainder → less visible spread. Always do this.
- **Render at quantization-free dimensions** — pick dims where the split divides
  evenly:

  | helper (`@m0saic/dsl-stdlib`) | what it gives |
  |---|---|
  | `safeCanvas({rows, cols, …})` | **largest zero-distortion canvas** for a grid (largest multiple of its `totalX`/`totalY` that fits) |
  | `snapGridFit({rootW, rootH, rows, cols})` | snaps a known grid into the largest quantization-free inner rect, letterboxing the remainder |
  | `snapGridEnumerate(range)` / `snapGridFind(range)` | sweep `(rows,cols)`, **rank** quantization-free candidates by `fitScore = coverage × tileCount` |
  | `aspectSafeGrid(…)` | landscape↔portrait grid pair, both quantization-free, same cell count, matched cell aspect (not a naïve transpose) |

- **Keep px-per-weight ≥ ~4** — the `grid` builder's `MIN_PX_PER_WEIGHT = 4` rule:
  at ≥4px/weight the remainder is ≤25% of a cell, so spread is visually negligible
  even at high counts. Auto-scaled cell weights enforce this.
- **Hairlines: ≥ 2.5px per weight unit, never a 1-unit band in a ~1px/unit split.**
  A 1-unit rule inside a 13-unit band at 480×270 (~1px/unit) quantized to a
  0-size frame → `SPLIT_EXCEEDS_AXIS` → the CLI refused the whole render, and the
  nested flatten collapsed the layout wherever child slot and parent cell differed
  by ±1px (gate 33, dsl-tutorial, 2026-09-05). Rule: derive the band's unit count
  from its px — `units = floor(bandH / 2.5)`, the hairline takes 1 unit, and below
  3 units drop the rule (the label-keyed layout contract reports the collapse as
  `missing-label`; see `templates/layout-contract.md`).
- **Accept the spread and derive dependents from the same weights** — when you
  can't control the canvas, compute overlays/animated layers from the *same*
  quantized geometry (never recompute from ideal fractions) so everything tracks
  the same spread and stays mutually aligned (line-chart `frame.ts` derives the
  plot rect from the frame weights; the data layer follows it).

**What NOT to do:** don't fight spread with `size`/`fit` expressions or pixel
nudges — off-thesis (see construction-strategy). Fix the *numbers*.

---

## 3a. Two builders — `placeRects` vs `weightedSplit` (when to use which)

Both emit weighted splits; the difference is what decides the weights.

- **`weightedSplit(weights, axis)`** — proportional, **resolution-INDEPENDENT**,
  GCD-reduced (+ Hamilton's-method `precision` scaling). One string, re-parses
  correctly at any size. **May quantize** (§3). Shines: portable/authored
  layouts reused across sizes, the editor, readable proportional regions.
- **`placeRects({rootW,rootH,rects})`** — absolute integer-pixel rects,
  **resolution-DEPENDENT**, **exact at that canvas** (band weights are pixels that
  sum to the axis → no remainder). Shines: render-time known-target geometry, exact
  positions (gridlines, ticks), arbitrary 2D rect sets, overlay packing.

**Decision rule:** default to `weightedSplit` (+ GCD-collapse §4 / `safeCanvas`).
Reach for **forced-absolute `placeRects` only when you want a *specific exact*
result** and accept px baked for one resolution. Portability is the axis: the
Layout editor re-parses the same string on every canvas resize, and the
rendering-model "one m0 → one geometry" contract relies on resolution
independence — so weight-based is for layouts that travel (authored layouts, the
editor, the published stdlib builders); absolute is for a template rendering to
a target it owns (a chart, a screencap grid). Slot nuance: a template nesting a
genuinely resolution-dependent primitive should pass it real rendered px as a
`slot` when it must register with SIBLING geometry at exact pixels (line-chart's
gridlines ↔ data plot rect) or line thickness must be exact for the cell —
though a slot only *mitigates* non-nestability; the structural fix is a ratio
primitive needing no slot (§3c). And placeRects still emits a *weighted-band*
split, so an EVEN division stays uniform even scaled into another cell
(bar-graph nests the grid with bare `ctx`; gaps stay uniform).

**DSL cost (measured).** placeRects costs more DSL *only* when you force
exactness on proportions that don't divide the axis cleanly:

| layout @1000px | weightedSplit | placeRects |
|---|---|---|
| cols 1:2:1 (clean) | 4 tok, exact | **4 tok, exact** (GCD-collapses identical) |
| cols 1:1:1 (333.3 ea) | 3 tok, 0.6px spread | **1000 tok, exact** (≈250×) |
| cols 382:618 | 500 tok, exact | 500 tok, exact (equal) |
| thin-line grid ×5 | ~720 tok, 0.5px | ~720 tok, exact (equal) |

The "placeRects tax" is really *the inherent cost of placing coprime pixels
exactly* — clean proportions GCD-collapse to the same short string; fine ratios
and thin-line grids cost the same either way (there placeRects is a free win).
**Runtime vs authoring** decides whether the cost matters: runtime-regenerated
geometry (a chart, the grid primitive) is rebuilt every render → DSL cost
irrelevant → take exact placeRects; persisted/reused geometry (a saved
dictionary layout) → keep the cheap portable weightedSplit when its spread is
imperceptible, pay placeRects only when exactness is genuinely needed.

**Thin-line grids are special:** the interleaved `[gap,line,gap,…]` weightedSplit
basis can drift 0.5→**67px** while placeRects stays ~0px — the
weightedSplit-when-imperceptible win is for **region** layouts, not thin lines.
But mind the mode trap: a per-pixel placeRects grid is exact only at the
**head** — nested, its canvas-scale basis silently drops (the grid/v1 callout,
§3c). A **nestable** thin-line grid decouples the lines from the basis instead —
fixed-px strips at proportional overlay offsets (`primitives/grid/v2`, ladder
rung 2).

### Don't guess — measure (`@m0saic/dsl-stdlib`)

- `quantizationSpread(m0, w, h)` → max px any frame drifts from ideal (`0` = exact);
  `isQuantizationImperceptible(m0, w, h, maxPx)` is the yes/no.
- `evaluateM0(m0, canvas)` → bundle: `dslLength`, `feasible`, `meetsPrecision`,
  `recommendedMin`, frame/passthrough/null counts, `maxSpreadPx`.
- `compareM0(a, b, canvas|canvas[])` → per-metric diff (better-when lower/higher/
  context), `comparable` (same frameCount), and — the one unambiguous case —
  `geometricallyEqual` + `recommendation`: if both render identical frames (via
  `areM0StringsFrameEqual`), keep the **shorter** string.

A generator can emit an m0 several ways and `compareM0` them to pick the best.
Compare at ≥ `recommendedMin` (the floors cross both ways — §1–§2). The
dsl-stdlib grid family (`grid`, `safeCanvas`, `snapGrid*`, `aspectSafeGrid`) is
**not** redundant with placeRects — it's the resolution-independent /
design-time side (aspect-matching, ranking, gutters, portability). Keep it.

---

## 3b. Escape hatch: `placeRect` for resolution-safe absolute positioning

When an element MUST occupy an exact pixel rect at ANY canvas resolution, place it
with `placeRect` (`@m0saic/dsl-stdlib`) — **NOT** a margin/inset helper built from
splits (`insetNode` and the 3×3-split positioners). `placeRect({rootW, rootH, rectW,
rectH, x, y})` emits the rect at exact pixels with `-` null tiles for the margins;
null tiles never claim space, so the rect is byte-exact regardless of whether the
canvas divides evenly.

**Why margin-based placement is the trap.** `insetNode(node, top, right, bottom,
left)` makes the margins REAL split cells, so on a canvas that doesn't divide
evenly the engine spreads the quantization remainder INTO the placed rect —
shrinking + shifting it (§3). Invisible at clean resolutions, brutal at others →
a flaky "the geometry itself doesn't align" bug that only shows at some sizes.
Measured: the alpine stat-card's icon glyph (intended 26px square) came out
**33×23, shoved past its chip's right edge** at the 290×288 desktop rail, and its
value band (intended 59px) was **crushed to 38px** so the 55px digits clipped —
while 480×480 / 360×184 / 224×224 (which divide cleanly) rendered fine.
Desktop-only = the classic quantization tell.

**When to reach for it:** small rects (icons, chips, badges), fixed-font text
bands that must not clip, anything multi-resolution-critical. When two rects must
stay registered (a glyph centred in its chip), place BOTH via placeRect so they
share exact coordinates — mixing placeRect (exact) with insetNode (quantized)
makes them drift apart. **Cost:** higher DSL token count (the null-tile padding)
— pay it. For a whole light primitive that must stay small, keep proportional
splits + GCD-collapse; placeRect is for the elements that must be exact, not the
entire tree ([`precision-tiers.md`](precision-tiers.md)). **Verify:** parse
(`parseM0StringComplete`) and assert each rect's render-frame width/height ==
intended and center-offset == 0 across the target resolutions.

### `placeRect` vs `placeRects` — pick by count

- **`placeRect`** (singular): ONE exact rect with `-` null margins — one-off
  exact elements.
- **`placeRects`** (plural): MANY rects, **packing non-overlapping ones onto as
  few overlay layers as possible** (one compact m0, N frames per layer;
  overlapping rects spill via `importance`-bucketed greedy first-fit). Reach for
  it whenever you place more than a couple of rects.

Map sources to the packed result: build `pieces = [{rect, source}]`, call
`placeRects({rootW, rootH, rects: pieces.map(p => p.rect)})`, then per `layer`
read `layer.rectIndices`, sort by `(y, x)` (band-emission order), and push
`pieces[idx].source` — sources line up with frames. Use `rect.importance`
(ascending = base→top) for z-order: surface < tiles < text/glyphs.

**Why plural matters (measured).** The commit-feed as N separate `placeRect`
overlay layers was **208K-char m0 / 68 layers**; the same rects via one
`placeRects` dropped to **114K / a handful of layers**. The stat-card's 8
per-element layers → **~16K → 4K**. Fewer layers = the real perf win (fewer
filtergraph overlay ops) and keeps you clear of the ~25-layer overlay mask-drop
cliff (engine wall W3 — see the internal walls doc, below).

---

## 3c. The three drafting modes — RATIO, ABSOLUTE, BITMAP (never launder one into another)

`placeRects` (§3/§3a) and `placeRect` (§3b) are *tactics*; underneath sits a
**strategic choice** that decides whether an m0 **composes**:

- **RATIO (product-native, the default).** m0 *is* ratio decomposition — a
  rectangle split into weighted sub-rectangles. **Resolution-independent, nests
  cleanly.** Its only failure is quantization (§3), and we have tools for that.
  Reach here first.
- **ABSOLUTE (the trivial case).** Pin real pixels — effectively one weight per
  pixel, so the **basis ≈ the canvas dimension**. Laser-sharp, zero quantization
  at the known dims. **But its feasibility floor rises to ~canvas level and it
  does NOT nest** — an absolute element carries canvas-scale precision and eats
  whatever cell it is given. Correct only at the **HEAD** (top-level, resolution
  known, never nested); `placeRects` / `placeRect` are its builders.
- **BITMAP (the raster extreme).** A full N×M grid where *every* cell is
  addressed (null or frame), taken across time for pixel-level animation. Very
  heavy → strictly **bake-once-to-an-asset, then reference forever**; never
  nested or live-composed (QR module grid; `brand/logo/v3` `m-33_bitmap`).

| mode | nests | feasibility floor | resolution | typical use |
|---|---|---|---|---|
| RATIO | ✅ yes | small, ~constant | independent | the default; any nestable primitive |
| ABSOLUTE | ❌ eats its cell | ≈ the canvas | baked | a head laser-placing its own chrome |
| BITMAP | ❌ bake first | ≈ the raster | baked | pixel-level animation, baked to an asset |

**The rule:** default RATIO. ABSOLUTE only when quantization genuinely bites
*and* the element sits at the head. BITMAP only for a baked asset with rich
pixel-level motion.

> **☠ The anti-pattern — the grid/v1 silent drop (canonical telling; §3, §3a,
> and the probe below all point here).** Never launder ABSOLUTE into a fine
> RATIO split: computing absolute pixel positions and re-encoding them as a
> weighted split whose basis ≈ the axis in px is the **worst of both** — ratio's
> composability is already spent (the basis is canvas-scale) AND you inherit
> absolute's non-nestability *without* its head-only safety.
> `primitives/grid/v1` did exactly this — `buildAxisSplitGrid` computed each
> line's px then `placeRects`'d a per-pixel-basis split (`1024[0,1,0,…]` for a
> 1024px plot). Standalone it renders perfectly (1024 slices of 1024px = 1px
> each); **nested, the engine re-divides the per-pixel basis below 1px, cells
> round to 0, and the grid is SILENTLY DROPPED** — at 1024², 1000², … while
> 1080² happens to survive, so it reads as intermittent silent loss (and
> `SPLIT_EXCEEDS_AXIS` at flatten). Diagnostic signature: *renders fine
> standalone but vanishes when composed at certain canvases; child m0 basis ≈
> its pixel dimension.*

**The proper fix for a quantizing primitive is NOT raw `placeRects`** — keep it
RATIO. **The authoritative rung enumeration is the launder ladder in
[`m0-construction-methods.md`](m0-construction-methods.md) §2c**; this section
keeps the per-rung detail (rung numbers below refer to that ladder):

- **Rung 1 — Restructure as ratio; return a DIFFERENT ratio m0 for the canvas.**
  A template is `(props, canvas) → m0`; at a size that would quantize, yield a
  re-laid-out ratio m0 that divides cleanly. More derivation, but composability
  survives.
- **Rung 2 — Decouple thin features from the basis.** For thin lines (where the
  interleaved `[gap,line,gap,…]` split spreads catastrophically — §3a), don't
  split at all: draw each line as a **fixed-px strip at a proportional overlay
  offset** (`H*frac`). `primitives/grid/v2` is the reference — a proportional
  overlay chain (`1{1{1{1{1}}}}`, feasibility 1×1) that nests into any cell. It
  pays a shallow overlay chain (one composite per line, warn-only past depth 20,
  and — plain colored strips, no masks — it never hits the ~25-layer
  inline-mask-drop cliff, W3) instead of
  surrendering composability. v1 was 1 op but non-nestable; v2 is N overlays but
  nestable — for a primitive, composability wins.
- **Rungs 3 & 5 — Launder coprime pixels through the inset (zero-drift
  inset-recovery).** The unifying principle: **it's the quantized SPLIT that
  kills coprime; a render-time `placement.inset` makes the quantization visually
  lossless.** Round each rect's CELL outward to a coarse divisor lattice (cheap,
  bounded precision), then shrink the painted source back onto the exact target
  inside it — the inset costs zero chars and zero precision (it lives in the
  fiber — [`composition-arithmetic.md`](composition-arithmetic.md) §4). Shipped
  tools: `placeInsetRects` (`@m0saic/dsl-stdlib`) + the author front door
  `placeInsetPieces` (`@m0saic/template-utils`), with divisor-pitch selection and
  floor-safe half-pixel-centered fractions built in. Three load-bearing constraints:
  (1) **inset only SHRINKS** — cells round OUTWARD (cell ⊇ target), and between two
  rects the boundary needs a lattice point in the gap (guaranteed at
  `gap ≥ pitch − 1`; when it misses, the cells spill to separate overlay layers —
  painted content stays disjoint, so collision costs LAYERS, not correctness);
  (2) **leaf-scoped** — an inset repositions a painted SOURCE within its cell, so
  container edges can't launder this way, and leaves must paint nothing outside the
  inset box (a cell-filling background would show the quantized cell); (3) **coarser
  pitch → bigger insets** — a `minFill` floor keeps small rects from drowning in
  giant cells (clamps to a finer divisor, reported not silent). The same one move
  underlies all four ratio-rebuild shapes: uniform grid = gutterless `grid()` +
  gap-as-**`latticeCellInset`** (see the caveat bullet below — **not**
  `gridCellInset`, which is deprecated); curves/charts = the mask path IS the
  recovery, in cell-local coords (rung 4); irregular tilings = nested splits +
  gap-as-inset per leaf; independent chrome = `placeInsetPieces`. Exemplar:
  stat-card migrated here from the drift budget (2026-07-10) — same ~120-basis
  bound, **zero visual drift**, render-verified including prime-dim canvases.
  Where a cell can contain its target, this DOMINATES the drift budget (rung 6).
  Design + corrections history: (internal design history).
- **⚠️ `gridCellInset` is DEPRECATED — it is approximate, not pixel-exact** (founder
  ruling 2026-07-21). It fails the one-move contract in two ways, and both are
  invisible in code review (the math *looks* right) and subtle on screen (±1px per
  shared edge) — which is exactly why it shipped. (1) **Ideal vs quantized cells:** it
  computes half-gap fractions against the IDEAL cell (`gridW / cols`), but the engine
  floors `frac × actualCellPx` against the QUANTIZED cell the equal split really
  produced. Whenever the grid's pixel region doesn't divide evenly — the common case
  when a grid sits under a content-driven band (1080 − 110 = 970px → rows of
  243/242/243/242) — the same fraction recovers 1px on one row and 0px on the next, so
  a 2px gap wobbles between 2 and 0. (2) **No half-pixel centering:** its fractions are
  plain `n / cell`, so even on exactly-dividing cells `floor((1/480)·480)` can land at
  0 under IEEE — the precise failure `placeInsetRects` defends against with
  `(n + 0.5) / cell`.
  **Use `latticeCellInset`** (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/layout/latticeCellInset.ts)
  for this rung: it retargets each RAW parsed cell onto an authored integer lattice
  with half-pixel-centered `(n + 0.5)/rawSize` fractions — exact gutters at every
  canvas, and it keeps the compact gutterless `grid()` m0. Reach for
  `placeInsetPieces` instead when the helper should own the WHOLE layout (mixed bands,
  non-grid pieces, z-order via importance).
  `gridCellInset` **remains exported, deprecated not deleted** — it now lives in the
  graveyard folder https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/deprecated/gridCellInset.ts. As of
  2026-07-26 **no template module imports it anymore** (verified: the only importer is
  the graveyard's own test; the grep hits in `heatmap/*`, `bar-graph/v1`,
  `screencap_grid/*` are comments and deprecation-reason strings). It is the first
  entry in the helper-level deprecation registry (`HELPER_DEPRECATIONS` /
  `helperDeprecation()` / `isDeprecatedHelper()` in
  https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/deprecation.ts), the library-API sibling of
  `MosaicTemplate.deprecated`. Exemplar of the fix: `@m0saic/media/screencap_grid/v2`
  (gap-carved integer rects → one `placeInsetPieces` call); `v1` is kept registered as
  the canonical reference for the pitfall.
- **Rung 4 — Express connected geometry as masks-in-a-cell (the general fix).**
  Curves, charts, and rings are only forced-absolute when placed via per-curve
  pixel bboxes. Author the marks as **inline-masks filling ONE ratio-positioned
  cell, paths in CELL-LOCAL coordinates** — every mask in the same cell shares
  one coordinate system and registers exactly, while the cell is a plain ratio
  split → bounded precision. Scales from a sparkline (kpi-card `1.04 → 0.00`) to
  an entire plot (line-chart `1.08 → 0.02`: gridlines + axis + area + line +
  halo + dot masks all filling one plot cell, sibling labels inset to the SAME
  plot fractions) — **including radial** (donut/v2: ring marks in one ring cell,
  `0.00`). The test of "legit-absolute" is whether the ANIMATION varies the mask
  PATH per frame — NOT whether the geometry is connected or radial. Reveals ride
  the overlay (alpha fade / enable gate), so almost nothing truly varies the
  path. (This corrects a prior belief: the donut sweep does NOT carve its arcs
  per frame.) **Bounded by the ~25-mask overlay cliff**
  (W3) — the marks all stack in ONE cell's
  overlay chain (line-chart ≤6 masks, alpine donut ≤12 segments). A soup of many
  more masks needs rung 7.
- **Rung 6 — Launder the absolute basis with a drift budget (GCD-snap).** A
  primitive positioning **INDEPENDENT** elements (chrome, text blocks, badges)
  at exact pixels can keep those positions and collapse the coprime basis: the
  precision floor of a placed rect is `axisLen ÷ gcd(before, size, after)`, so
  ONE coprime edge ⇒ `gcd 1` ⇒ the leaf pins ~its render canvas — and
  back-solved through its slot (`needs = self × canvas ÷ slot`) it pins the
  *parent* too. The fix trades a tiny canvas-relative drift for the coarsest
  common grid: `snapRectPrecision` (single rect — exact + a Pareto frontier of
  nearby low-precision rects), `placeOptimizedRects` (plural, per-rect
  `driftPx`, `0` = LOCK byte-exact — a locked coprime edge correctly stays
  100%), and the author front door `placeOptimizedPieces`
  (`@m0saic/template-utils`). Measured (stat-card `@480×480`, its drift era):
  `100% / 5,785 chars → 17% / 899 chars` (≤2px drift, visually identical),
  audit slope `1.04 → 0.08` — the card has since moved to inset-recovery
  (rungs 3 & 5: same bound, zero drift). **Independent elements ONLY** — it
  breaks uniform grids (equal cells snap unequal → use a ratio grid), tilings
  (shared edges open gaps), and connected geometry (rung 4). Preference order:
  zero-drift **inset-recovery** first where the leaves are transparent-margin
  painted sources with shrink room; drift remains right for per-rect LOCKS
  (must-stay-exact geometry mixed with collapsible chrome), container edges,
  tiles that paint their whole cell, and wanted-snap (pixel-aligned strokes,
  butt-joint cell edges).
- **Rung 7 — Self-framed coarse-quantize (many-mask rect-soups).** A soup of
  many overlapping origin-relative masks — the donut's smooth `premium` sweep is
  **~32 thin annular-sector slivers** — defeats the other rungs: angular
  geometry isn't row/col-expressible, one cell would stack a 32-layer chain over
  the mask-drop cliff (W3), and raw
  `placeRects` (which packs the non-overlapping sliver bboxes into ~8 layers —
  under the cliff) is absolute. Keep `placeRects` and add ONE move — build the
  soup in its **own coarse-grid-aligned frame**:
  1. Pick a **canvas-proportional** pitch `P = round(min(W,H)/K)` and a square
     frame side `S = ceil(regionSide/P)·P` — `S` is a `P`-multiple **by
     construction**.
  2. Snap each bbox **OUTWARD** to `P`. Masks are origin-relative, so only the
     invisible bbox grows to the grid — the drawn arc stays pixel-perfect.
  3. `placeRects` inside the `S×S` frame. Every band — INCLUDING trailing
     margins and empty corners — is a `P`-multiple, so the split gcd collapses
     to `S/P ≈ K`, constant on every canvas *including coprime dims* (1001×733:
     ~51/51 vs the exact build's 1001/733).
  4. **Letterbox** the frame into the canvas with a basis-capped ratio split.
     Cost: a **≤1px uniform translation** of the whole frame (zero *relative*
     drift; this slop is one reason sliver seams need care).
  The own frame is load-bearing: quantizing on the FULL canvas leaves a trailing
  margin `≡ axisLen mod P` that collapses the gcd back to `gcd(P, axisLen)` —
  and coprime canvas dims share NO coarse `P` at all. Constraints: marks must be
  **origin-relative** (a media tile would SHIFT when its bbox snaps — use
  inset-recovery instead); `P` must be **proportional** (`min/K`) — a FIXED snap
  px bounds chars but still tracks the canvas (donut/v3's `SNAP_PX = 4` probed
  slope 1.04); and on a light or deeply-nested surface, anti-aliased sliver
  edges leave hairline notches that angular overlap can NOT close — the robust
  fix is an **inflated seamless base** per segment (`rOuter+δ`, `rInner−δ`,
  δ ≈ 2px) underneath the slivers, **timed to fade in as each segment finishes**
  (not during its sweep, or the base reads as a two-tone second layer). Measured
  (donut/v4, 32-sliver sweep): precision bounds at ~`K` on every canvas, m0
  6–25× smaller, ~8 layers, arcs pixel-perfect — audit `ABSOLUTE 1.04 → RATIO
  ~0`, taking the template library to 0 audit warnings.

Why the laundering family works — and why an accepted DRIFT composes *better*
than a quantizing split (snapped cells stay lattice multiples; quantized cells
go coprime-consecutive and poison descendants):
[`composition-arithmetic.md`](composition-arithmetic.md).

**Rung 8 — honest ABSOLUTE at the head.** `placeRects` / `placeRect` remain the
**lazy-but-right** move for a **head** — a hero/dashboard already knows its
canvas at render, never nests, so the canvas-level feasibility floor costs
nothing (this is why the pulse beats moved from ratio to absolute — at certain
canvases the ratio squares quantized visibly). Reach for them only after
deciding the element is head-only. The primitive/head distinction IS the
RATIO/ABSOLUTE choice — see [`precision-tiers.md`](precision-tiers.md).

**Detecting the mode (build-time probe).** A template's output isn't knowable
statically, but you can **probe** it: render `defaultProps` across aspects ×
resolutions (240p→4K) and watch `computeFeasibility` + `precision` (§1–§2).
**Precision that TRACKS the canvas (slope ≈ 1) ⇒ absolute; stable (slope ≈ 0) ⇒
ratio.** Verified: `grid/v1` precision-Y = canvas height (slope 1.00 →
absolute); `grid/v2` and `charts/stat-card/v1` stay flat (slope 0.00 → ratio).
A `primitive`-role template that probes absolute is a **composability warning**
(`PRIMITIVE_ABSOLUTE_POSITIONING`). The audit lives in `@m0saic/templates`
(`gen-template-audit.ts` → `TEMPLATE-AUDIT.md`, safe canvas = per-axis max of
precision and feasibility); the dense companion `gen-precision-sweep`
(`npm run audit:precision-sweep`) catches primitives that pin on only SOME
canvases (~24–85%) even when the coarse audit reads "ratio", and ranks migration
value. For a NESTED template the top-level m0 is trivial (`line-chart` →
`1{1{1{1{1}}}}`), so the probe must **flatten** before measuring — a flatten
that fails (`SPLIT_EXCEEDS_AXIS`) at a canvas is itself a strong
absolute/infeasible signal.

**Did the layout SURVIVE, not just the mode?** The audits above measure the
precision *slope*; the **layout contract** goes further — a template tags its
sources with LABELS and declares canvas-independent ratio invariants against
them (aspect, min/max fraction, `within`, and **presence** — incl. through
nested flatten, which catches grid/v1's silent nested drop). `checkLayout` is
the pure evaluator a layout search loops on; `npm run audit:layout-envelope`
reports the canvas range where each invariant holds. The emitter round-trip
guard (`audit:geometry-matrix` / `audit:geometry-proof`) additionally locks a
zero-drift placement. Resolve-only, opt-in. See
[`../templates/construction-strategy.md`](../templates/construction-strategy.md)
"Verifying layout intent survived".

---

## 4. GCD — *collapse weights to lowest terms*

Greatest-common-divisor reduction is the cheapest quantization mitigation: divide
all weights by their GCD — identical proportions, fewer cells, more pixels per
weight.

- **Helpers:** `dsl-stdlib` GCD-reduces internally (`builders/_internal/barSplit.ts`,
  `transforms/.../buildSplitFragment.ts`) and exports NO `gcd`/`gcdArray`. The
  exported number theory is `@m0saic/template-utils` `lattice/`: `gcd(a, b)`,
  `lcm(a, b)`, `lcmAll(ns, cap)`, `isSmooth`, `roughPart`, `divisors`.
- **Built in:** `weightedSplit(weights, axis)` in the default `"optimized"` mode
  **auto-GCD-reduces** (and collapses to a plain equal split when all reduced
  weights are 1). `placeRects`, `placeRect`, `strip`, `aspectFit`, `golden*`, and
  the bar splits all GCD-reduce their segment weights too.
  - `weightedSplit([35,65],"col")` → GCD 5 → `[7,13]` → 20 cells, not 100.
  - `weightedSplit([10,10,10],"row")` → GCD 10 → all 1 → emits `3[F,F,F]`.
- **`mode: "literal"`** skips GCD reduction (keeps your exact cell count). Use it
  only when the cell count itself is load-bearing (e.g. a thin-line grid where
  the count sets line thickness) — and then mind §3.

**What to do:** prefer `optimized` (default). Reach for `literal` consciously,
knowing it raises the quantization risk.

---

## The agent playbook (in order)

1. **Feasible?** `computeFeasibility(m0)` ≤ target dims, else it errors. Hard gate.
2. **Balanced?** `axisLength % totalWeight === 0`? Yes → uniform, done. No →
   quantization spread (deterministic, computable) — acceptable only if
   px-per-weight is large (≥~4) and the imbalance is below perception.
3. **Not balanced and it matters?** First reach: **compute the real pixel
   positions and `placeRects` them** (round each independently; bake at the target
   res) — the general fix. If you must stay weight-based: GCD-collapse → choose
   quantization-free dims (`safeCanvas` / `snapGrid*` / `aspectSafeGrid`) → ensure
   px-per-weight ≥ 4 → accept + derive dependents from the same weights.

The point: **the math is absolute and known ahead of time.** Feasibility and
quantization are not "render and see" — they're `computeFeasibility`, a modulo,
and a GCD. Compute them, then choose the canvas or the weights deliberately.

---

## See also

- [`m0-construction-methods.md`](m0-construction-methods.md) — the all-up MAP
  (two questions, four currencies, the **canonical launder ladder** §2c).
- [`composition-arithmetic.md`](composition-arithmetic.md) — the NESTING math:
  factor budgets, drift-vs-quantization, base×fiber, the prime-axis theorem.
- [`dsl-rules.md`](dsl-rules.md) — grammar, tokens, validation invariants,
  error codes.
- Engine walls W1–W12, incl. W3 (the ~25-overlay inline-mask-drop cliff, canonical
  home) — **engine-internal**: `.ai/moat/runtime/ffmpeg-limitations.md` (absent in
  the shipped copy of this folder; the cliff numbers quoted above stand alone).
- [`../m0saic-thesis.md`](../m0saic-thesis.md) — why it's all rectangles.
- [`../templates/construction-strategy.md`](../templates/construction-strategy.md)
  — the Rect Thesis at authoring time.
- `dsl-stdlib/src/builders/` — `safeCanvas`, `snapGrid*`, `aspectSafeGrid`,
  `weightedSplit`, `grid`, and the GCD helpers.
