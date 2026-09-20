# The `0{}` operator — phantom geometry, deferred paint

`0` is a passthrough: it donates its space to the next claimant and renders nothing.
`0{...}` is a passthrough whose overlay still renders: the base donates space as
usual, but the body receives the accumulated carry rect and **paints on top of the
claimant, deferred**. An element that gives its space away, then draws over the
sibling that absorbed it. Trimmed 2026-07-27 from a longer essay (git history).

> **Source of truth:** [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts)
> (+ `parse/sortDeferredOverlays.ts`). Basics: [`passthrough-semantics.md`](passthrough-semantics.md),
> [`overlay-semantics.md`](overlay-semantics.md).

## The four quadrants

| | Owns space | Doesn't own space |
|---|---|---|
| **Paints** | `1` (tile) | `0{}` (phantom overlay) |
| **Doesn't paint** | `-` (null gap) | `0` (passthrough) |

`0{}` is the fourth quadrant: spatial accounting and visual presence, fully
decoupled.

## The mechanism (verified at runtime)

`3(1, 0{1}, 1)` @ 1080×720 — three 360px slots; the `0` donates, the last tile
claims 720px; the overlay body gets the merged carry rect and paints LAST:

| Paint order | What | Rect | `logicalIndex` |
|---|---|---|---|
| 0 | first tile | `{x:0, w:360}` | 0 |
| 1 | claimant (expanded) | `{x:360, w:720}` | 2 |
| 2 | deferred zero-overlay | `{x:360, w:360}` | 1 |

Note the split between orders: the overlay is `logicalIndex` **1** (encountered
before the claimant in DFS) but paints **after** it. Build sources in logical
order; paint order is derived.

**Multiple `0{...}` before one claimant sort area-DESCENDING at flush** — widest
paints first (background), narrowest last (top). `5(0{1},0{1},0{1},0,1)` @1000px:
claimant 1000px paints first, then 600 → 400 → 200 on top. Free z-ordering from
coverage, no z-index.

**Rects grow monotonically:** each `0{...}` in a run captures the prefix sum of
slot widths, anchored at the run start — `4(0{1},0{1},0{1},1)` @800px yields
overlays at `{x:0, w:200/400/600}` under a full-width claimant. Concentric framing
from pure geometry.

**Trailing `0{}` is always invalid** — `PASSTHROUGH_TO_NOTHING`; an overlay does
not exempt the donation from needing a claimant. `2(1,0{1})` invalid;
`2(0{1},1)` valid.

## The body is a full m0 sub-expression

Splits, nulls, passthroughs, nested overlays — all legal inside `0{...}`, parsed
into the merged rect like an independent document. So a phantom can carry an entire
sub-layout: holes that let the claimant show through (`0{4(1,-,-,1)}`), stacked
rows (`0{3[1,1,1]}`), thin gridline rules at precise offsets
(`0{100[0,…,1,…,0,1,…]}`), even nested overlay depth (`0{2(1{1},1{1})}` — four
sources from one zero-space element). Source count = whatever the body demands.

## Patterns (one line each)

- **Floating annotation** — grid-positioned callout over an expanded tile's region.
- **Progressive reveal** — monotone widths + per-source `startAtSec`: layers peel
  front-to-back.
- **Gradient banding** — N phantoms at fractional widths, solid colors at
  decreasing opacity.
- **Watermark/badge** — a tiny phantom deep in a 100-split places a corner stamp;
  content and stamp stay structurally independent.
- **Conditional layer** — phantom sources honor `overlay.enable` windows: a flash
  highlight with zero structural change.
- **Debug overlay** — inject `0{1}` tints/labels during development; removing `{1}`
  restores the bare `0` with geometry untouched.

## When `0{}` is wrong

- The layer should CLAIM space (push siblings) → use `1` or `-`.
- The template has many sources and non-expert consumers → the logical/paint order
  split confuses source mapping; keep `0{}` inside internal primitives.

## For agents

You will almost never need `0{}` — `1`, `-`, `0`, and `1{1}` cover ~99% of
layouts. Reach for it only when all three hold: (1) a visual layer at a specific
grid position, (2) painting on top of whatever fills that region, (3) claiming no
layout space. When all three hold, `0{}` is the correct expression, not a
workaround.
