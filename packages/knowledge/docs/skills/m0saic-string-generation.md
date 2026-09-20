# m0 Generator Guidelines

Practical algorithm outline for generating valid m0 strings programmatically. **Prefer official helpers over hand-emitting tokens.**

> **Source of truth:**
> - Builders: [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/builders](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/builders)
> - Unified transforms: [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/transforms/unified](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/transforms/unified)
> - Validation: [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate)
> - Feasibility: [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/feasibility](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/feasibility)

---

## 0. Prime directives

### 0.1 Prefer library ops over hand-writing strings

If an official op/helper exists for the transformation you want, **use it** instead of emitting raw m0 tokens.

Three primary sources of safe generation:

- **`@m0saic/dsl-stdlib/builders`** — high-level builders (`grid`, `weightedSplit`, `strip`, `container`, `aspectFit`, `placeRect`/`placeRects`, `rectsToM0`, `safeCanvas`, `snapGridFit`, `spotlight`, `comparison`, `rankedList`, `goldenSplit`, `goldenSpiral`, etc.). Full surface: see [`dsl-stdlib-method-catalog.md`](./dsl-stdlib-method-catalog.md).
- **`@m0saic/dsl-stdlib/transforms`** — unified ops (`split`, `replace`, `addOverlay`, `removeOverlay`, `setTileType`, `measureSplit`, `swapFrames`).
- **`@m0saic/dsl`** — low-level parsing + validation; never the right tool for *generation*.

Raw string emission is a **last resort.**

### 0.2 Use `grid` for grids

For row/column grids (equal cells, weighted cells, gutters, outer gutters), call:

```ts
import { grid } from "@m0saic/dsl-stdlib";

const result = grid({ rows: 3, cols: 4, gutter: 0.05 });
// result.m0 — canonical m0 string
// result.totalX, result.totalY — split factors
// result.cellW, result.gutterW — resolved weights
```

The builder handles weighted-split expansion via `0` carry runs, gutter `-` slots, the illegal `1(...)` / `1[...]` rule, exact classifier-count = child-slot count, and canonical output. **Don't hand-author split trees.**

Workflow: build the base layout with a builder, apply targeted edits with unified transforms, validate.

---

## 1. Validation and feasibility

### 1.1 Always validate

```ts
import { validateM0String } from "@m0saic/dsl";

const v = validateM0String(m0);
if (!v.ok) {
  // v.error is a single structured violation: { code, kind, message, ... }
  // (singular — https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/errors/errors.ts M0ValidationResult)
}
```

Boolean shortcut: `isValidM0String(m0)`.

The validator enforces grammar, token rules, overlay correctness, child-count exactness, the trailing-passthrough rule (trailing `0` is always invalid, even with overlay), and the no-sources rule (≥1 leaf `1` required somewhere in the layout). Overlay bodies do NOT need their own source — sourceless bodies like `1{-}` are legal (relaxed 2026-06-03; see [`overlay-semantics.md`](overlay-semantics.md)). See [`handbook/dsl-rules.md`](../handbook/dsl-rules.md) for the full grammar.

### 1.2 Check feasibility when dimensions are known

```ts
import { computeFeasibility } from "@m0saic/dsl";

const f = computeFeasibility(m0);
if (targetWidth < f.minWidthPx || targetHeight < f.minHeightPx) {
  // Layout cannot render at this resolution — would produce 0-size frames.
  throw new Error(`Below feasible: ${f.minWidthPx}×${f.minHeightPx}`);
}
```

If you parse anyway, `parseM0StringComplete` emits `SPLIT_EXCEEDS_AXIS` at parse time:

```ts
import { parseM0StringComplete } from "@m0saic/dsl";

const parsed = parseM0StringComplete(m0, width, height);
// parsed.precision, parsed.warnings, optional parsed.error
```

### 1.3 Feasibility vs. precision (important distinction)

- **`computeFeasibility`** — exact `{ minWidthPx, minHeightPx }`. Accounts for nested same-axis splits, passthrough carry chains, overlays. Use for all feasibility decisions.
- **Precision** is a separate, independent floor (neither bounds the other). For a combined verdict use `evaluateM0` from `@m0saic/dsl-stdlib` — it returns `feasible`, `meetsPrecision`, and `recommendedMin` (the per-axis max of both floors). (`computePrecisionFromString` is an internal dsl helper, not public API.)

See [`../handbook/feasibility-precision-quantization.md`](../handbook/feasibility-precision-quantization.md) (canonical) for the two-floor model.

---

## 2. Unified transforms — the canonical API for structural changes

When you mutate an existing string, use the unified transforms exported from `@m0saic/dsl-stdlib`. Every transform takes `(m0, target, options) → m0` where `target: TransformTarget` is a discriminated union.

### TransformTarget

```ts
type TransformTarget =
  | { by: "logicalIndex"; index: number }    // 0-based index of rendered frames (1/F only)
  | { by: "span"; span: { start: number; end: number } }  // exact char span
  | { by: "stableKey"; key: string };        // structural identity path
```

Pick the addressing mode that matches your invariant — `logicalIndex` for "the Nth rendered tile," `stableKey` for "this specific node, even after edits," `span` for parser-visible ranges. See [`../file-formats/m0p-and-custom-field.md`](../file-formats/m0p-and-custom-field.md) and [`identity.md`](identity.md) for identity semantics.

### 2.1 Split

```ts
import { split } from "@m0saic/dsl-stdlib";

// Uniform 3-way column split on the 0th tile
split(m0, { by: "logicalIndex", index: 0 }, { axis: "col", count: 3 });

// Weighted split: weights.length must equal count
split(m0, { by: "logicalIndex", index: 0 }, { axis: "col", count: 2, weights: [60, 40] });
```

GCD-reduces emitted DSL by default. Pass `weightMode: "literal"` to preserve exact slot count.

### 2.2 Measure-mode split

```ts
import { measureSplit } from "@m0saic/dsl-stdlib";

// axis "col" or "row"; count = granularity; ranges are {a, b} objects (inclusive)
// (MeasureSplitOptions — https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/transforms/unified/measureSplit.ts#L9)
measureSplit(m0, { by: "logicalIndex", index: 1 }, { axis: "row", count: 12, ranges: [{ a: 2, b: 8 }] });
```

### 2.3 Set leaf type

```ts
import { setTileType } from "@m0saic/dsl-stdlib";

// Change a leaf to "-" (null), ">" (passthrough), "F" (frame), or "1"
setTileType(m0, { by: "logicalIndex", index: 0 }, "-");
setTileType(m0, { by: "stableKey", key: "r/growc0/fc1" }, ">");
```

### 2.4 Add / remove overlay

```ts
import { addOverlay, removeOverlay } from "@m0saic/dsl-stdlib";

addOverlay(m0, { by: "logicalIndex", index: 2 });          // visual overlay
removeOverlay(m0, { by: "stableKey", key: "r/fc2" });
```

### 2.5 Replace / swap

```ts
import { replace, swapFrames } from "@m0saic/dsl-stdlib";

replace(m0, { by: "logicalIndex", index: 0 }, "2(F,F)");   // replace subtree at target
swapFrames(m0, 0, 1);   // swap rendered tiles — takes two logicalIndex numbers
                        // directly, NOT a TransformTarget (the one exception to §2)
```

---

## 3. Repair-loop strategy

When validation fails, apply targeted repairs instead of regenerating from scratch.

### 3.1 ILLEGAL_ONE_SPLIT

Problem: `1(...)` or `1[...]` — wrapping a single child as a pseudo-container is illegal.

Fix: drop the `1(...)` wrapper or use `0`-runs instead.

### 3.2 Trailing passthrough

Problem: last child in a split is `0` (even with overlay — `0{...}` trailing is always invalid).

Fix:
- Replace trailing `0` with `-`: `2(1,0)` → `2(1,-)`
- Or replace trailing `0` with `1`: `2(1,0)` → `2(1,1)`

Don't use `2(1,0{1})` — trailing passthrough with overlay is still invalid.

### 3.3 TOKEN_COUNT mismatch

Problem: classifier `N` doesn't match the number of children.

Fix: adjust `N` to match children, or add/remove children to match `N`.

### 3.4 SPLIT_EXCEEDS_AXIS

Problem: classifier count exceeds available pixels on an axis.

Fixes (in order):
1. Reduce split count.
2. Collapse subtree to `1`.
3. Replace with fewer parts.

### 3.5 NO_SOURCES

Problem: the layout as a whole contains no leaf `1` (overlay bodies are allowed to be
sourceless — `ZERO_SOURCE_OVERLAY` is no longer raised).

Fix: ensure at least one `1` / `F` exists somewhere (a source inside an overlay counts:
`2(-,-){1}` is valid). See [`overlay-semantics.md`](overlay-semantics.md).

### 3.6 INVALID_CHAR / TOKEN_RULE

Problem: malformed output. **Generator bug** — fix the generation logic, don't band-aid the output.

---

## 4. Overlay body constraints

Bodies are parsed as complete m0 sub-expressions: non-empty, not a bare `0`
(`INVALID_EMPTY`), no trailing passthrough — but they do **NOT** need a leaf `1`
(sourceless `{-}` / `{2(-,-)}` are legal; relaxed 2026-06-03). Full rules:
[`overlay-semantics.md`](overlay-semantics.md) and
[`structural-construction.md`](structural-construction.md) §7.

---

## 5. Output format options

Most ops accept output options:

```ts
{ output: "canonical" }   // 1, 0
{ output: "pretty" }      // F, >
```

Agents should prefer canonical output for machine use unless pretty is explicitly required.

---

## 6. Precision warnings

High classifier counts emit `PRECISION_EXCEEDS_NORM` warnings (informational, never
blocking; raise the threshold via `parseM0StringComplete(s, w, h, { precisionNorm: 256 })`).
The two-floor feasibility/precision model:
[`../handbook/feasibility-precision-quantization.md`](../handbook/feasibility-precision-quantization.md).

---

## See also

- [`../handbook/dsl-rules.md`](../handbook/dsl-rules.md) — full grammar.
- [`../handbook/feasibility-precision-quantization.md`](../handbook/feasibility-precision-quantization.md) — feasibility rules (canonical).
- [`structural-construction.md`](structural-construction.md) — structural-build patterns.
- [`overlay-semantics.md`](overlay-semantics.md) — overlay rules.
- [`parse-apis.md`](parse-apis.md) — parser entry points.
