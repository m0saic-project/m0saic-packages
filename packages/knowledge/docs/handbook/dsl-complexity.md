# DSL Complexity Analysis

`@m0saic/dsl` exports lightweight complexity utilities for inspecting the
structural cost of an m0 string: how expensive is this layout to render, to
edit, and to subdivide? All functions operate via canonical-string scanning —
no geometry computation, no full tree parse.

> **Source of truth:** [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/complexity/complexity.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/complexity/complexity.ts).

## The public surface: two functions

| API | Validates? | Return type | Use when |
|---|---|---|---|
| `getComplexityMetricsFast(input)` | No | `ComplexityMetrics` (never null, never throws) | The default — editor, scoring, preflight, hot loops |
| `getFrameCount(input)` | Yes | `number \| null` (null = invalid input) | Single-metric query with strict input handling |

**These are the only complexity exports.** `getComplexityMetrics`,
`getPassthroughCount`, and `getNodeCount` were **removed** — the barrel comment
in [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/complexity/index.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/complexity/index.ts)
says so explicitly ("callers use `getComplexityMetricsFast`"); `getPrecisionCost`
is an internal helper, not exported. Every other metric is a **field** on the
`ComplexityMetrics` result, not a function:

```ts
type ComplexityMetrics = {
  frameCount: number;        // rendered leaves (`1`/`F`) → composited layers: the render-cost signal
  passthroughCount: number;  // `0`/`>` leaves → implicit donation chains: the editor-cost signal (zero render cost)
  nullCount: number;         // `-` leaves — gaps; structurally simple
  groupCount: number;        // split containers
  nodeCount: number;         // all structural nodes — total tree size (completeness metric)
  precisionCost: number;     // maxSplitAny — min-resolution viability, orthogonal to the others
  precision: M0Precision;    // maxSplitX / maxSplitY / maxSplitAny
};
```

One canonicalization, one node-count scan, one precision scan — prefer the
aggregate whenever you need more than a frame count. `ComplexityMetrics` and
`M0Precision` live in [`types.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/types.ts).

## How the metrics relate

| Metric | Render cost | Editor cost | Precision |
|--------|:-----------:|:-----------:|:---------:|
| `frameCount` | **primary** | secondary | — |
| `passthroughCount` | none | **primary** | — |
| `nodeCount` | correlates | correlates | — |
| `precisionCost` | — | — | **primary** |

Independent dimensions: a layout can be cheap to render but hard to edit (few
frames, many passthroughs), expensive to render but easy to edit (many frames,
no passthroughs), or precision-constrained regardless of either.

## Two instructive examples

```
Layout A:  3(1,1,1)        frameCount=3  passthroughCount=0
Layout B:  5(0,1,0,1,1)    frameCount=3  passthroughCount=2
```

Same render cost (3 composited frames); B's passthroughs create implicit
space-donation chains the editor must visualize and the user must reason about.

```
Nulls:         3(1,-,1)    frameCount=2  passthroughCount=0  nullCount=1
Passthroughs:  3(1,0,1)    frameCount=2  passthroughCount=1  nullCount=0
```

Nulls consume space as empty gaps — structurally simple. Passthroughs donate
space forward — same frame count, higher editor complexity.

## Scale

These metrics only bite at scale: frame count matters ~20k+ (compositing
pipeline stress), passthroughs ~10k+ (deep donation graphs), precision when
split factors push the minimum resolution past the target output dims.
