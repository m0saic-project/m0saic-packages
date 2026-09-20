# Identity — StableKey, depth axes, and selection

Merged 2026-07-27 from four overlapping docs (stablekey-and-overlay-identity,
identity-model, structural-vs-overlay-depth, structural-identity_visual-identity —
deleted; git history has the long forms). One doc, one owner: everything about
*referring to the same node* across parses, edits, and renders.

> **Source of truth:** `StableKey` + `M0NodeIdentity` in
> [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/types.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/types.ts); identity
> construction in [`parse/m0StringParser.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts)
> (search `buildIdentity`, `makeStableKeySegment`).

## 1. The identity contract

Every parsed node receives a deterministic `stableKey` — the address of the parser's
walk through **structure**. Segments encode node kind + split axis + childIndex among
structural siblings. Segment grammar (verified at runtime): `r` (root) ·
`g{row|col}c{n}` (group) · `fc{n}` (frame) · `pc{n}` (passthrough) · `nc{n}` (null) ·
`/ov{d}c{k}` (overlay namespace).

Same canonical string → same StableKeys, same structuralDepth, same overlay
namespace. If the string changes, the tree changes and some keys change — that is
correct, not a bug.

**StableKey is NOT:** `paintOrder` / `stackOrder` (paint depends on overlay-deferral
rules), display/label numbering, or geometry. Geometry is *derived* —
`rect = f(m0, width, height)` — and shifts with resolution and `splitEven`
remainders while keys stay put. The DSL guarantees **structural** identity, never
**visual** identity.

## 2. The five axes — keep them separate

| Axis | Increments when | Use it for |
|---|---|---|
| `structuralDepth` (`meta.structuralDepth`) | entering `N(...)` / `N[...]` | tree indentation, containment reasoning |
| `overlayDepth` | entering `{...}` | layer filtering |
| `paintOrder` / `stackOrder` | derived from traversal + overlay deferral | paint simulation ONLY |
| `logicalIndex` | per rendered leaf, logical order | source assignment (`sources[i]`) |
| `stableKey` | — (structural address) | persistent identity across edits |

Worked example — `2(2(1,1),1)` (verified at runtime): the outermost split **IS the
root** (`stableKey: r`, structuralDepth 0); the inner group is depth **1**
(`r/gcolc0`); its tiles are depth **2** (`r/gcolc0/fc0`, `fc1`); the outer `1` is
depth **1** (`r/fc1`). There is no extra root node above the outermost split.

`1{1{1}}` has structuralDepth 0 on all three nodes and overlayDepth 0/1/2 — the two
depth systems are orthogonal: deep structure with zero overlays, flat structure with
100 overlays, or both.

Never assume `deeper == painted later` — overlay deferral (and area-descending
zero-overlay stacking) controls paint timing, not depth. See
[`overlay-semantics.md`](overlay-semantics.md).

> ⚠️ overlayDepth is structurally free but NOT render-free: each level is a
> sequential blend pass, and inline-masks silently drop past ~25 nested layers
> (engine wall W3 — internal: `.ai/moat/runtime/ffmpeg-limitations.md`).

## 3. The overlay invariant

Overlay subtrees do NOT affect structural childIndex assignment:

- Adding/removing overlays never renumbers the base tree.
- Overlay frames live in a separate namespace — `<ownerStableKey>/ov<depth>c<k>`
  (`r/fc0` → `r/fc0/ov1c0` → `r/fc0/ov1c0/ov2c0`) — so overlay keys cannot collide
  with or shift structural keys.

This is why overlays can be used freely (debug layers, labels, reveals) without
destabilizing the base layout or any tool keyed on it.

## 4. logicalIndex vs paintOrder

RenderFrames carry both `paintOrder` (stacking order) and `logicalIndex` (logical
tile index — same as `LogicalFrame.logicalIndex`; there is **no `sourceIndex`
field** in https://github.com/m0saic-dsl/m0/blob/main/packages/dsl). Build sources in logical order, paint in stack order —
the split keeps the source array clean of paint semantics. See
[`parse-apis.md`](parse-apis.md) for which parse API returns which.

## 5. Stability limits — what edits do to keys

Keys **WILL change** when you: change split counts, insert/remove siblings in the
base tree, change axis/group nesting. Keys will **NOT change** when you: add/remove
overlays, deepen overlay nesting, reorder overlay-only layers.

Overlay data attaches to `ownerStableKey`, so across edits: split *inside* the owner
→ owner survives → overlay stays valid; edit a sibling → unaffected; delete/replace
the owner → the overlay has no owner and cannot reattach. That last case is correct
behavior, not data loss to be papered over.

**Never reattach by geometry.** Preserving overlays via nearest-rect / similar-size /
pixel-overlap heuristics introduces non-determinism and unfixable edge cases. If the
owner is gone, the overlay is gone. Determinism > convenience.

## 6. Selection policies (agent workflows)

When you need to "pick a tile" — recursive growth, demos, batch transforms — pick by
StableKey, not geometry or paint order. Deterministic policies:

- **Smallest StableKey lexicographically** — stable across edits, cheap.
- **Earliest leaf in StableKey-sorted order** — a "top-left-most" that survives
  structural change.
- **`(seed + step) mod leafCount`** over a StableKey-sorted leaf list — round-robin
  demos where each step targets a different tile.

Anti-patterns: selecting by pixel position (resolution change → different
selection), by paint order (adding overlays shifts it), or by unsorted traversal
order.

## 7. Labeling

Label tiles by StableKey (`.m0c` labels are StableKey-keyed); use the label `text`
as the human-meaningful join key (`.m0p` regions reference labels by text). If a
label's key no longer exists in the current parse, `validateLabels`
(`@m0saic/dsl-file-formats`) flags it — see
[`../file-formats/m0p-and-custom-field.md`](../file-formats/m0p-and-custom-field.md) §5.

## 8. Common mistakes

- Treating overlay tiles as structural leaves — scope "leaves" iterations to the
  base namespace; overlays live under `/ov…`.
- Confusing overlayDepth for structuralDepth (UI tree depth ≠ "inside another split").
- Hardcoding StableKey strings — they're stable across *layout* edits but computed
  from structure; always derive them from a parse, never string-match literals.
- Assuming paintOrder reflects structure — it's derived, overlay rules own it.
