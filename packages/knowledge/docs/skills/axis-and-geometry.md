## Axis & Geometry (Splits, Pixels, Remainders)

The math layer of the walk: exact rectangle geometry from `()` and `[]`,
deterministic pixel-remainder distribution (`splitEven`), and how `0`-runs and `-`
holes shape final rects.

> **Source of truth:** `splitEven` in [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts)
> (line 478 as of 2026-07-27). Locked behavior: outside-in remainder distribution.
> Test fixtures in [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/outside-in-remainder.test.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/outside-in-remainder.test.ts).

## Axis semantics

- Column split `N( ... )` — splits **width** into N segments; height stays the
  container's height.
- Row split `N[ ... ]` — splits **height** into N segments; width stays the
  container's width.

Children are laid out in order:

- Columns advance **x** (left → right)
- Rows advance **y** (top → bottom)

## splitEven pixel distribution (deterministic)

When splitting an integer pixel length (`total`) into `parts`:

- `base = floor(total / parts)`
- `remainder = total - base * parts`
- The `remainder` extra pixels are distributed **outside-in**: indices
  0, P-1, 1, P-2, 2, P-3, ...
- The remaining segments get `base`

Example:

- `total = 1080`, `parts = 7`
- `base = 154`, `remainder = 2`
- Outside-in order: index 0 gets +1, then index 6 gets +1
- Sizes: `[155, 154, 154, 154, 154, 154, 155]`

Key consequence: remainders distribute symmetrically from the edges inward, keeping
layouts visually balanced.

## Coordinate propagation (rects)

Every node owns a rectangle `(x, y, width, height)`. Splits carve that rect into
child rects:

- Column split: child width from `splitEven(width, N)`; child x = cumulative sum of
  prior child widths; y/height unchanged.
- Row split: child height from `splitEven(height, N)`; child y = cumulative sum of
  prior child heights; x/width unchanged.

Overlays always reuse the **owner rect** (same x/y/width/height) and never escape it.

## How `0` and `-` affect geometry

### `0` (passthrough)

- Consumes a split slot; adds its slot size into "carry"
- The claimant absorbs carry + its own slot, and snaps back to the run start position

Geometry impact: `0` changes the eventual claimant rect size and origin. `0` itself
creates no visible rect (but may create overlay rects via `0{...}`).

### `-` (null)

- Consumes a split slot; does NOT donate forward
- Creates a hole / gutter region; can still host overlays (`-{...}`)

Geometry impact: a stable region that does not affect siblings beyond consuming its
share of split space. Useful for isolating sub-layouts and masks.

## Why resolution matters (integer pixels)

All geometry is integer-pixel based. Two implications:

1. A layout can look "perfect" at one size and slightly biased at another, because
   remainder pixels distribute outside-in (edges first).
2. Bitmap-like layouts (e.g. 64×64 encodings) require compatible output sizes,
   otherwise meaning drifts due to integer rounding distribution.

Guidance: if a layout encodes literal grid art, render at sizes aligned to that grid
(multiples of the grid resolution). For feasibility guards, quantization strategy,
and quantization-free construction, see
[`../handbook/feasibility-precision-quantization.md`](../handbook/feasibility-precision-quantization.md).

## Minimal examples

Even-ish columns — `3(1,1,1)` at width=10:

- sizes = `[4,3,3]` (1 remainder pixel goes to the first edge)

Rows — `2[1,1]` at height=5:

- sizes = `[3,2]`

Donation changes claimant geometry — `3(0,1,1)`:

- first tile claims 2 slots (`0` + its own)

Hole creates gutter — `3(1,-,1)`:

- middle region is an explicit empty gutter
