## Passthrough & Carry Semantics

`0` (passthrough) is the zero-frame donation primitive. Misused, a layout is either
invalid (`PASSTHROUGH_TO_NOTHING`) or geometrically wrong. This doc covers donation
mechanics, claimant/carry scoping, overlay behavior on zero-runs, the trailing rule,
and the weighted-split encoding.

> **Source of truth:** passthrough handling in [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts)
> and validator rules in [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts).
> Trailing-passthrough error code `PASSTHROUGH_TO_NOTHING` in [`errors/errors.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/errors/errors.ts).
> Validity examples below runtime-verified against https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/dist on 2026-07-27.

## What `0` means

`0`:

- Consumes a split slot
- Produces no rendered frame
- Donates its space forward to the next claimant

It does NOT render. It only contributes geometry.

> Design intent: `0` exists primarily to encode weighted / percentage splits in a
> deterministic integer-only way.

## What is a claimant?

A claimant is the first non-zero node after a run of `0`s:

- `1` (tile)
- `-` (null)
- `N(...)` / `N[...]` (group)

When a claimant appears:

- It absorbs ALL donated space from the run
- It absorbs its own slot
- Its position snaps back to the start of the run

## Donation run example

    3(0,0,1)

- First `0` → carry = 1 slot
- Second `0` → carry = 2 slots
- `1` appears → absorbs carry + own slot = 3 slots

Result: the tile spans the entire width of the classifier.

## Carry is scoped per classifier

Carry does NOT leak outside the classifier body, and resets after each claimant:

    7(0{1},1,0{1},1,1,1,1)

Two separate runs:

- Run 1: `0{1}` starts carry → first `1` absorbs the run
- Run 2: new `0{1}` → fresh carry → next `1` absorbs it

## Overlay behavior on `0`

### `0{...}` targets the merged region so far

    4(0,0{2(1,1)},0,1)

1. First `0` — carry = 1 slot
2. Second `0{2(1,1)}` — carry = 2 slots; overlay canvas = merged 2-slot region
3. Third `0` — carry = 3 slots
4. `1` — absorbs 4 slots total

Overlay size is fixed at the moment it appears. Later carry growth does NOT resize
earlier overlays.

### Multiple zero overlays grow monotonically

    5(0{1},0{1},0,0,1)

- First `0{1}` → overlay spans 1 slot
- Second `0{1}` → overlay spans 2 slots
- Remaining `0`s → carry grows
- `1` absorbs all 5

Each overlay anchors to the region size at its creation time. Zero-overlay prefix
geometry as a deliberate technique (progressive region staging, area-ordered
layering) has its own doc: [`zero-overlay-analysis.md`](zero-overlay-analysis.md).

## Trailing passthrough rule (`PASSTHROUGH_TO_NOTHING`)

A trailing `0` inside a classifier is **always** invalid — even if it carries an
overlay. No claimant absorbs the donation; an overlay on `0` does not change that.

Invalid:

    2(1,0)       — bare trailing passthrough
    2(1,0{1})    — trailing passthrough with overlay (still invalid)
    3(1,1,0{1})  — trailing passthrough with overlay
    0{1}         — whole-string passthrough: no sibling exists to claim

Valid:

    2(0,1)       — passthrough donates to claimant
    2(0{1},1)    — passthrough with overlay, not trailing
    3(1,0,1)     — passthrough in middle position

The rule applies recursively inside nested classifiers AND overlay bodies:
`1{2(1,0)}` rejects with `PASSTHROUGH_TO_NOTHING`.

## Weighted split encoding

Zero-runs are how weighted splits are encoded. To encode a 60/40 split:

    [60% region][40% region]

DSL representation (conceptual pattern):

    100( 59 zeros, 1, 39 zeros, 1 )

The zero-run before each `1` encodes how much space that tile absorbs. Mechanical
and deterministic.

### The stdlib GCD-reduces this for you

Never hand-roll the 100-slot form. `weightedSplit` (and the unified `split`
transform's `weights` option) default to `mode: "optimized"`, which divides all
weights by their GCD before emitting slots:

    weightedSplit([60, 40], "col")     →  5(0,0,1,0,1)   — not 100(...)
    weightedSplit([50, 25, 25], "col") →  4(0,1,1,1)

Verified 2026-07-27: GCD reduction in
[https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/builders/weightedSplit.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/builders/weightedSplit.ts):119–122;
the `split` transform routes through the same reduction in
[`buildSplitFragment.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-stdlib/src/transforms/primitives/split/_internal/buildSplitFragment.ts)
(default `mode = "optimized"`). `mode: "literal"` keeps raw weights (legacy);
`precision` rescales weights to an exact slot budget first (largest-remainder).
