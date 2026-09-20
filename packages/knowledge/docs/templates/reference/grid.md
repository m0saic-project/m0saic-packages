# grid

Canonical dsl-stdlib builder for grid-layout m0 strings.

> **Source of truth:** [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/builders/grid.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/builders/grid.ts) (`GridOptions` / `GridResult` in the same file).

## Default mode: the gutterless simple path

When the call has **no gutter, no `outerGutters`, no `cellWeightBase`, and no
output dimensions**, the builder short-circuits (`grid.ts:65-82`): compact
nested equal splits via `equalSplit`, one row expression per row, claimant `1`:

```
grid({ rows: 3, cols: 2 }).m0   // "3[2(1,1),2(1,1),2(1,1)]"
grid({ rows: 1, cols: 4 }).m0   // "4(1,1,1,1)"  (rows=1 → just the row expr)
```

No weight math at all. Result metadata reflects the unit basis:
`{ cellW: 1, cellH: 1, gutterW: 0, totalX: cols, totalY: rows }`. The per-axis
basis is just the cell count — minimal quantization risk, nests cleanly.
**This is the shape the ratio-grid recipe builds on** (gutterless `grid()` +
gap carved with `latticeCellInset` — see "Uniform grids" in
[`../construction-strategy.md`](../construction-strategy.md)). Reach for this
first; the weighted machinery below exists for DSL-baked gutters.

## Weighted mode: gutters and resolution-aware weights

Any of `gutter > 0`, `outerGutters: true`, `cellWeightBase`, `outputWidth`, or
`outputHeight` routes to the weighted path (`grid.ts:84-154`): cells become
weight-`cellW` claimants, gaps become blank (`-`) tokens of weight `gutterW`,
built via `strip` per axis. For the weight system itself (donation, `splitEven`,
outside-in remainder) see [`../../handbook/dsl-rules.md`](../../handbook/dsl-rules.md);
for why large weight bases quantize badly (px-per-weight collapse), see
[`../../handbook/feasibility-precision-quantization.md`](../../handbook/feasibility-precision-quantization.md).

### Cell weight (X) and auto-scaling

Priority (`grid.ts:93-108`): explicit `cellWeightBase` wins; else if
`outputWidth` is given, auto-scale to keep ≥ `MIN_PX_PER_WEIGHT = 4` px per
weight unit; else `DEFAULT_CELL_WEIGHT = 50`.

```
maxTotalX = floor(outputWidth / 4)                       // MIN_PX_PER_WEIGHT
cellW = max(2, min(50, floor((maxTotalX - gutterSlots) / cols)))
```

(`gutterSlots` approximates gutterW=1 for the budget; the `max(2, …)` clamp is
in `grid.ts:99-105`.) Then `gutterW = max(1, round(cellW * gutter))`. Keeping
px-per-weight ≥ 4 bounds the `splitEven` remainder at ≤ 25% of the base
allocation. Trade-off: smaller `cellW` coarsens gutter-ratio precision — the
minimum non-zero gutter is `1/cellW` of cell width (2% at the default 50).

### Equal pixel gaps across axes (`cellH` derivation)

With both output dimensions, `cellH` is derived so one weight unit maps to the
same pixel count on both axes (`grid.ts:117-130`) — otherwise a `gutterW: 1` gap
could be 6px across and 3px down:

```
Goal:  outputWidth / totalX = outputHeight / totalY
totalX = cols * cellW + gutterCountX * gutterW
targetTotalY = totalX * outputHeight / outputWidth
cellH = max(1, round((targetTotalY - gutterCountY * gutterW) / rows))
```

`gutterW` stays identical on both axes; the cell weights absorb the aspect ratio.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rows` | number | required | Grid row count |
| `cols` | number | required | Grid column count |
| `gutter` | number | 0 | Gap ratio relative to cellW. gutterW = max(1, round(cellW * gutter)) |
| `outerGutters` | boolean | false | Add gutter padding on all 4 edges, not just between cells |
| `cellWeightBase` | number | 50 (or auto) | Explicit X cell weight. Overrides auto-scaling. |
| `outputWidth` | number | - | Output pixel width. Enables auto-scaling and equal-gap correction. |
| `outputHeight` | number | - | Output pixel height. Enables equal-gap correction. |

## Result

| Field | Description |
|-------|-------------|
| `m0` | The DSL string (field is `m0`, NOT `m0saic` — `GridResult`, https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/builders/grid.ts#L22) |
| `order` | Row-major index array (always `[0, 1, 2, ...]`) |
| `totalX` | Total X weight count (`cols` on the simple path) |
| `totalY` | Total Y weight count (`rows` on the simple path) |
| `cellW` | X-axis cell weight (`1` on the simple path; may be auto-scaled) |
| `cellH` | Y-axis cell weight (equals cellW when no output dimensions) |
| `gutterW` | Gutter weight (0 when no gutter) |

> ⚠️ **When to pass `outputWidth`/`outputHeight` (corrected 2026-07-26).** Pass them
> only when you are keeping DSL-baked gutters at the **head** of a document. For
> primitives and anything that nests, the current guidance is the opposite: use the
> **gutterless** simple path and carve gaps afterwards with `latticeCellInset`. A
> pixel-derived gutter basis re-introduces the coprime-basis blowup
> (`~30,316 → ~2,211` nodes measured) — see the ratio-grid recipe in
> [`../construction-strategy.md`](../construction-strategy.md).

## Golden tests

Wireframe PNG goldens live in per-suite dirs under https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-visual-tests/src
(e.g. `stdlib/grid/__goldens__/`, `stdlib/split/__goldens__/`,
`stdlib/snapGrid/__goldens__/`, `brand/__goldens__/`). Run: `npm test --prefix https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-visual-tests
