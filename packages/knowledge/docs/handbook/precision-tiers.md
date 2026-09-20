# Precision tiers — light primitives, precise compositions

**The rule.** Precision and complexity belong to HIGHER-LEVEL constructs, not the
base. Keep base-level primitives (a card, a row, a badge, a table) small and
simple — mostly **general grid positioning** via coarse proportional splits.
A complex base makes every composition that nests it ultra-complex (the cost is
multiplicative: one heavy primitive × N instances × M beats).

**How to author light:**
- Build primitives with the split kit (`rowSplit`/`colSplit`, basis ≤ ~120) and
  proportional weights — NOT pixel-exact `placeRects`. Snap height weights to a
  small multiple (e.g. 8) so nested splits GCD-collapse + stay quantization-feasible.
- A primitive must render fine at SMALL px (it'll be nested into a cell) without
  blowing up the parent's m0 string.
- The primitive/head split IS the **RATIO/ABSOLUTE mode choice**: a primitive stays
  RATIO so it nests (proportional splits, or fixed-px features at proportional offsets
  for thin lines — never a per-pixel `placeRects` basis, which silently drops when
  nested); a head may go ABSOLUTE since it owns its canvas. See the three drafting
  modes in [`feasibility-precision-quantization.md` §3c](feasibility-precision-quantization.md).

**The sandbox-loop exception (and the discipline around it):**
- You MAY author at HIGH precision (exact-px `placeRects`, fine silhouettes) while
  iterating WITH the human in the sandbox loop — precise rects make the geometry
  conversation concrete.
- But COMPRESS the result before it becomes the primitive: run Compact (null/repack/
  prune) + a GCD reduce. The silhouette's exact px is scaffolding; the shipped
  primitive is the compressed layout.
- **Minor positional DRIFT to achieve sufficient GCD collapse is very worthwhile** —
  trading a few px of exactness for a big drop in cell count / DSL size is the right
  call for a base-level item. (Precision you can't perceive at the primitive's render
  size is precision not worth paying for.) How much drift? See the search below.

## GCD-collapse search — find the collapse point, don't guess a drift

Reducing a pixel-exact layout to a light one is a **SEARCH, not a setting**. Let the
grid drift by a small tolerance so nearby weights share a common divisor; once they
do, splits GCD-collapse and the m0 string shrinks dramatically.

1. Sweep the drift tolerance from ~0 upward in small steps (0.1%, 0.2%, … to ~2%).
2. At each step, re-quantize (Compact / GCD-reduce) and measure the resulting
   **m0 string length**.
3. The curve is **NON-MONOTONIC**: small drifts give small wins (5–6%), length can
   even rise — then at one value it **collapses** (typically 70%+ smaller). That's
   the collapse point.
4. Take the smallest drift at the collapse — minimum drift for maximum collapse.

The collapse drift is layout-specific (it depends on the weights' near-common
divisors) and the win is discontinuous, so **no fixed default is right** — 0.5% may
do nothing for one layout and 70% for another. Always sweep. Measured exemplar: the
contributor-table grid went ~14K → ~6K chars at ~0.5% (Mosaic Desktop: Layout →
Compact, sweep the drift-tolerance knob and read the length).

Programmatic routes (these automate the sweep — reach for them before hand-sweeping):
`snapRectPrecision` returns a **Pareto frontier** (drift vs precision — the swept
curve, precomputed), `placeOptimizedRects` reports per-rect `driftPx`, and
`reduceSplitCounts` takes an explicit drift budget (all in `@m0saic/dsl-stdlib`).
Open questions (capture findings here): per-layout collapse signatures, automated
collapse-point detection, whether a second collapse exists higher up.

**Where precision IS warranted:** the composition / hero layer — where exact
alignment across panels reads, and the cost isn't multiplied downstream. Even
there, prefer baking a constant precise subtree to a flat asset (see
`../runtime/reduce-to-one.md`) over carrying it live.

## Cost model — where high-precision DSL actually costs

A long, high-precision m0 is **NOT expensive to render** — the engine parses
arbitrary-length DSL cheaply at render time. The cost lands in exactly two places,
and that's what sets the tier:

1. **Composition** — a primitive is nested N× inside higher constructs, so a heavy
   primitive multiplies. Keep primitives LIGHT (coarse splits / GCD-collapse /
   `placeRects` packing).
2. **The editor** — Mosaic Desktop materializes rects as **React DOM objects**, so a
   high rect count bloats the editor DOM. Anything a human edits wants a modest rect
   count.

So: **primitives → keep DSL low** (they compose AND get edited). **Hero /
intended-final-output templates → full precision/resolution is FAIR** — the geometry
is derived from the hero's own inputs, it's designed for its render resolution, it
isn't nested into anything else, and DSL length is cheap to parse at render. Don't
contort a hero to shave bytes; do contort a primitive. Pin must-be-exact elements
with `placeRect` / `placeRects` in EITHER tier (see the resolution-safe escape hatch
in `feasibility-precision-quantization.md`).
