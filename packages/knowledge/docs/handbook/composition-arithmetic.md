# Composition arithmetic — the number theory of nesting

> [`feasibility-precision-quantization.md`](feasibility-precision-quantization.md)
> is the math of ONE split. This is the math of splits STACKED — why some trees
> compose exactly all the way down while others hit a wall three levels in, why
> drift composes better than quantization, and where exactness is provably
> impossible so you stop chasing it. Everything here is decidable before rendering:
> it is all divisibility. Companion to [`precision-tiers.md`](precision-tiers.md)
> and https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/GCD.md (the single-asset encoder story).

---

## 0. TL;DR

- A canvas axis is a **prime-factor budget**; every exact split spends factors, and
  Ω(T) (prime factors with multiplicity) is the nesting-depth budget.
- Keep every split count **a divisor of its axis and 5-smooth** and the whole tree
  stays 5-smooth forever — composition never hits a prime wall.
- **Quantization is hereditary poison**: a non-dividing split hands children
  *coprime consecutive* cell sizes (≤1px visually, arithmetically junk). Drift is
  the reverse: lossy to the eye, clean to the arithmetic.
- An m0 is **base × fiber**: split lines on a shared coarse lattice (costed,
  visible, composable) + leaf-private placement (inset / cell-local masks / xExpr —
  free, invisible, *unable* to break composition).
- **Nesting refines to the lcm; overlay adds.** Incompatible denominators go on
  separate layers, never into one refined split.
- On a prime axis, **every exact interior line costs full precision** — theorem,
  not tuning. Self-frame or drift; never emit the 100% string silently.

---

## 1. The canvas is a prime budget

Write an axis as `T = 2^a · 3^b · 5^c · (rest)`. An **exact** split needs `N | T`
and produces cells of `T/N` — it *spends* factors from the multiset. Two numbers
describe the whole budget:

- **Ω(T)** — prime factors with multiplicity — the **depth budget**: how many
  nontrivial exact splits can stack before cells reach 1px.
- **σ₀(T)** — divisor count — the **menu size**: how many exact split counts are
  available at this node.

| dim | factorization | σ₀ (menu) | Ω (depth) |
|---:|---|---:|---:|
| 720 | 2⁴·3²·5 | 30 | 7 |
| 1080 | 2³·3³·5 | 32 | 7 |
| 1280 | 2⁸·5 | 18 | 9 |
| 1350 | 2·3³·5² | 24 | 6 |
| 1920 | 2⁷·3·5 | 32 | 9 |
| 2160 | 2⁴·3³·5 | 40 | 8 |
| 3840 | 2⁸·3·5 | 36 | 10 |
| 4320 | 2⁵·3³·5 | 48 | 9 |
| 7680 | 2⁹·3·5 | 40 | 11 |
| *997 (prime)* | *—* | *2* | *1* |

**Spend order matters.** Split 1080 into 8 and the cells are `135 = 3³·5` — you are
out of 2s *forever*; nothing below can ever halve exactly. Split into 9 and the
cells are `120 = 2³·3·5` — still rich on every prime. Spend the scarce prime late;
balance the spend across levels.

**The hereditary-smoothness invariant.** Divisors of a 5-smooth number are 5-smooth.
So if the root axes are 5-smooth and *every split count divides its axis*, every
cell in the entire tree is 5-smooth — the recursion never lands on a prime wall. A
generator can enforce this mechanically: track the remaining factor multiset per
node; a child template's exactness needs are a sub-multiset test.

---

## 2. The practical canvas lattice

m0 is general-purpose, but this renderer's delivery targets are ~all **5-smooth**
(video standards descend from 2^a·3^b·5^c tilings). That makes the practical set a
family of shared lattices — measured, not vibes:

| canvas family | per-axis gcd | meaning |
|---|---:|---|
| modern core: 1080 / 1920 / 2160 / 3840 / 4320 / 7680 (16:9, 9:16, 1:1) | **120** | any split total dividing 120 is pixel-exact on every axis in the family |
| + 720p (1280, 720) | 40 | |
| + 4:5 social (1350) | 10 | the truly universal pitch |

- **The universal basis menu for the modern core is `divisors(120)`** — sixteen
  values: 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 60, 120. The absences
  teach as much as the entries: **7 divides no standard dimension** (a 7-split is
  never exact anywhere — fine as a small-basis ratio fill, never for registration),
  and **16 divides the widths but not 1080** (a 16-col split is exact where a
  16-row split quantizes).
- **Exactness lifts by integer scaling.** 4K = 2× 1080p exactly, 8K = 4×. Prove a
  layout exact at an aspect family's base size and every larger member is free.
- **Hostile strays exist** — 1.91:1 social lands on `566 = 2·283` (283 prime).
  Don't design for them; route them through §6.
- A basis cap of **120 is the family gcd**, not folklore — a ≤120-basis template is
  exact across the whole modern core. Persisted/portable m0 should draw totals from
  `divisors(family gcd)`; a runtime template (`(props, canvas) → m0`) can use
  `divisors(actual axis)` — enumerating them is `O(σ₀)` ≈ 30–40 candidates, free.
- **This is enforced, not advised (2026-09-16):** the `latticeSmooth` template
  convention (throw) holds every split count above 12 to 5-smooth, at the hinted
  canvas and the sweep canvases; `m0saic doctor` applies it to external packs
  (declarations: [`../templates/reference/template-flags.md`](../templates/reference/template-flags.md)).
  The number theory lives in `@m0saic/template-utils` `lattice/`: `gcd`, `lcm`,
  `lcmAll`, `roughPart`, `isSmooth`, `factorize`/`formatFactors`, `divisors`,
  `smoothDivisors`, `ceilToSmooth`/`floorToSmooth`, `nearestSmooth`,
  `FAMILY_GCD = 120`, `FAMILY_BASIS_MENU = divisors(120)`, `latticeWeights`,
  `quantizedSections`, and the scanner/report pair `splitCounts(m0)` /
  `latticeReport(m0s)` / `latticeViolations(m0s, { canvas, allow, physicalCanvas })`.

---

## 3. Quantization is hereditary poison

The inverted intuition, and the single most load-bearing fact in this chapter.

A non-dividing N-split looks nearly harmless — cells of `⌊T/N⌋` and `⌈T/N⌉`, spread
≤1px (§3 of the feasibility doc). But consecutive integers are **coprime**: the
children inherit arithmetically junk axes no matter how rich T was.
`1080/7 → 154 = 2·7·11 and 155 = 5·31.` The eye can't see the pixel; the child that
inherits a 155px axis can't split it.

Drift does the opposite. A gcd-snapped split puts every line on the `d`-lattice, so
every band is a **multiple of d** — children inherit d's factors, wealth instead of
poison.

> **Drift is lossy to the eye but clean to the arithmetic; quantization is clean to
> the eye but poisons descendants.** For anything meant to be composed, the
> arithmetic cost dominates.

Why the RATIO doctrine survives this: a **small-basis ratio child needs no
inheritance at all** — an N-slot split has cell spread ≤1px on ANY axis, hostile or
not. That robustness (not exactness) is what the audit's slope ≈ 0 actually
measures. So the division of labor is: **exactness for what must REGISTER** (across
siblings, to pixels), **small-basis robustness for what merely FILLS**. (The one
ratio danger zone is interleaved thin-line weights, where boundary error compounds —
feasibility doc §3a.)

---

## 4. Base × fiber — the composability algebra

Every m0 placement decomposes into two layers of meaning:

- **The base** — split lines on a shared coarse lattice. Costed in slots/chars,
  visible to editors and validators, the thing children subdivide. Composition
  happens HERE and only here.
- **The fiber** — per-leaf freedom *inside* a cell: `placement.inset`, mask paths in
  cell-local coordinates, cell-local text, `xExpr`/`yExpr`. The fiber is
  structurally free (zero chars, zero precision) and **leaf-private: fibers cannot
  interact across leaves, so nothing in the fiber can break composition** — that is
  a guarantee, not a heuristic.

The 2026-07 rebuild patterns are all one move (table):

| pattern | base move | fiber move |
|---|---|---|
| uniform grid (heatmap v2) | gutterless `grid()` | gap as `latticeCellInset` (`gridCellInset` is deprecated — approximate, see feasibility §3c) |
| independent chrome (stat-card) | gcd-snapped `placeOptimizedRects` | (accepted drift; or inset-recovery) |
| curves / charts (kpi-card, line-chart, donut v2) | one ratio cell | mask paths in cell-local coords |
| many-mask soups (donut v4) | self-framed coarse `placeRects` | origin-relative sector paths |
| rect soups (`placeInsetRects` / `placeInsetPieces`) | divisor-pitch quantized cells | half-pixel-centered inset recovery |

**Engine fine print — the fiber floors.** `applyInsetToRect` (core) computes
`Math.floor(f · cellSize)`, and `floor((n/W)·W)` genuinely loses a pixel on real
pairs (verified: n=15/W=22, 13/23, 15/26 …). Exact-recovery insets must be
**half-pixel-centered**: emit `(n + 0.5)/W` (verified zero failures for all
`n < W ≤ 7680`). See (internal design history).

**The fiber's price is invisibility.** What lives in the fiber doesn't exist in the
string — previews must read `placement` to show it; editors can't grab it. Spend
fiber on what nothing else needs to see structurally.

Doctrine in one line: **registration geometry on the base; private detail in the
fiber.**

---

## 5. Overlay is a sum; nesting is an lcm

Forcing two line families into ONE split costs the **lcm** of their denominators;
putting them on separate overlay layers costs the **sum**. Lines at thirds and at
sevenths: one split needs a 21-slot basis; two layers need 3 + 7 = 10 slots and no
lcm ever happens. **lcm blowup is THE char-count killer; overlays are
lcm-avoidance** — priced in graph depth (the ~25-mask cliff and overlay-depth
warnings are that budget). `primitives/grid/v2` (fixed-px strips at proportional
overlay offsets) is exactly this trade, chosen correctly.

The "find the coarsest grid describing the most things" game, stated formally:
partition the required lines per axis into few groups, each on a coarse lattice,
minimizing `Σ_layers T/gcd(bands)` under the layer budget. Two consequences:

- **Per-axis cost is separable** (row slots + Σ per-band col slots, each term
  depending only on its own axis's gcd) — so cross-axis joint optimization gains
  ≈ nothing. This resolves https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/GCD.md §14.1.
- The remaining unexplored optimization is **layer partitioning by divisor-class**
  (put the lines divisible by 8 on one layer, the stubborn ones on another) —
  `placeRects` currently packs layers by overlap only. This is the sharper form of
  GCD.md §14.2.

---

## 6. Where exactness is impossible (stop chasing it)

- **The prime-axis theorem.** An interior split line at `p` on axis `T` makes
  sections `(p, T−p)`; slots = `T/gcd(p, T)`. For prime `T`, `gcd(p, T) = 1` for
  every interior `p` — **every exact interior line costs precision T, by any
  method.** Inset can't help: insets ride cells, and the cell boundary IS the line.
  The remaining moves: **(a) self-frame** — build the interior geometry in its own
  P-divisible frame and letterbox it with a small-basis ratio split; zero *relative*
  drift, ≤1px uniform translation of the whole frame (the donut-v4 move — handbook
  §3c, fix six); **(b) spend per-line drift** (§7).
- **Inset feasibility.** Inset only shrinks, so a quantized cell must contain its
  target; between two rects, the shared boundary needs a lattice point **inside the
  gap**: possible iff the gap contains a multiple of P, guaranteed iff
  `gap ≥ P − 1`. *The gap is the inset budget* — literally, in pixels.
- **Flush shared edges at coprime positions.** A structural line two siblings share
  can't move into the fiber (both cells end AT it). Restructure, or drift it.
- **The pure-inset endpoint.** Pitch `P = T` degenerates to one slot with the inset
  doing all placement: precision 1 on ANY canvas *including primes* — but one
  overlay layer per rect and zero structural legibility. It is the far end of a
  dial (`P ∈ divisors(T)`, with `placeRects` at `P = 1`), not a free lunch: the
  basis knob trades slot count vs layer count vs how much of the design the string
  still shows.

---

## 7. Drift, principled — bounded-denominator approximation

"Best position for a line at fraction φ with basis ≤ B" is the classical
best-rational-approximation problem, and **continued-fraction convergents**
(equivalently Stern–Brocot / Farey-mediant descent) are provably optimal. The
golden builders' Fibonacci weights are literally the convergents of φ — 2/3, 3/5,
5/8, 8/13, 13/21 — so a golden split at basis 21 is `[13, 8]` with error ~0.09%
(≈1px at 1080): optimal, not aesthetic.

Two search spaces, two tools:

- **gcd-snap** (GCD.md §6) — optimizes ALL lines jointly onto ONE lattice of a
  KNOWN canvas. Use at the head / in encoders.
- **Convergents** — optimize ONE line's denominator with NO canvas in hand. Use
  inside ratio primitives that must travel.

And remember §3: snapped geometry composes *better* than quantized geometry — the
drift budget is an investment in your descendants' axes.

---

## The agent playbook (in order)

1. **Composing tree?** Every split count divides its axis and is 5-smooth; watch
   the factor budget (don't burn all the 2s early — 1080/8 = 135 ends halving
   forever; 1080/9 = 120 stays rich) — the gate measures exactly this
   (`latticeSmooth`); declare the honest exceptions on `template.lattice`.
2. **Persisted / portable m0** → totals from divisors of the family gcd
   (`divisors(120)` for the modern core; 40 with 720p; 10 with 4:5). **Runtime
   template** → divisors of the actual `ctx` axis.
3. **Registration on the base lattice; everything leaf-private in the fiber**
   (insets half-pixel-centered; masks cell-local). If nothing else needs to see it
   structurally, it belongs in the fiber.
4. **Incompatible denominators → separate overlay layers** (sum, not lcm), budgeted
   by the mask cliff. Never refine one split to the lcm.
5. **Hostile axis or stubborn coprime line** → self-frame (relative exactness +
   ≤1px translation) or convergent-optimal drift. Never silently emit a
   canvas-scale basis — that's the §3c laundering anti-pattern; the audit slope
   catches it.
6. The toolkit is **divisibility, lcm, and rational approximation** — *not* Bézout:
   splits subdivide; they never form integer combinations.

---

## See also

- [`feasibility-precision-quantization.md`](feasibility-precision-quantization.md) —
  the per-split math this chapter stacks.
- [`precision-tiers.md`](precision-tiers.md) — the head/primitive (ABSOLUTE/RATIO)
  decision this chapter's arithmetic underwrites.
- [`../templates/construction-strategy.md`](../templates/construction-strategy.md) —
  how the patterns of §4 show up when authoring.
- https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/GCD.md — the single-asset encoder story (drift as gcd-discovery,
  canvas destiny); §14.1–.2 are resolved in §5 here.
- (internal design history) — the rect-soup builder that motivated
  the divisor-pitch and half-pixel-centering results.
