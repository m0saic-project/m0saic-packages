# Structural construction — emitting valid canonical m0

Operational construction rules. The Handbook is canonical for grammar
([`../handbook/dsl-rules.md`](../handbook/dsl-rules.md)) — this doc is the build-time
checklist form of the same rules; on any conflict, the handbook wins.

> **Source of truth:** [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts)
> and [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/errors/errors.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/errors/errors.ts).

## 1. Canonical output only

Emit `1` not `F`, `0` not `>`, no whitespace; allowed characters: `0–9 ( ) [ ] { } , -`.
Never emit pretty aliases.

## 2. Numeric containers must match exactly

`N(child1, …, childK)` requires `K === N`. No compression, no implicit slots, no
empty classifiers (`2()`, `3[]` invalid). Build children first, count them, then
prefix with N.

Valid: `2(1,1)` · `3[1,0,1]`  Invalid: `2(1)` · `3(1,1)` · `2(1,1,1)` · `3()`

## 3. First token rule

A valid string starts with `1`, or a NUMBER > 1 followed immediately by `(` or `[`.
`0`, `-`, `,1`, `{1}` are invalid openers. `1(...)` / `1[...]` is
`ILLEGAL_ONE_SPLIT` — never wrap a single child in a pseudo-container.

## 4. NUMBER must be followed by a classifier

`2,1` and `2{1}` are invalid; `2(1,1)` and `2[1,1]` are valid.

## 5. Overlay discipline — objects vs nesting

- **At most one immediate overlay object per node**: `1{1}`, `2(1,1){1}`, `0{1}`,
  `-{1}` valid; `1{1}{1}` invalid.
- **Layer via nesting**: `1{1{1}}` — base tile, overlay subtree, overlay on the
  overlay.
- **Multiple overlay layers/regions via structure inside the body**:
  `1{2(1,-){2(-,1)}}` — the overlay body is a container that owns its own overlay;
  holes (`-`) isolate which regions show tiles. "One overlay object per node" does
  not limit overlay depth.

## 6. No trailing passthrough

A trailing `0` inside a classifier is always invalid — **even with an overlay**
(`PASSTHROUGH_TO_NOTHING`): `2(1,0)` and `2(1,0{1})` invalid; `2(0,1)` and
`2(0{1},1)` valid. A passthrough must donate to a claimant; an overlay does not
exempt it.

## 7. Overlay bodies — valid, but sourceless is LEGAL

Bodies validate recursively as full m0 sub-expressions. A body must contain at
least one node, but it does NOT need a leaf `1` — the legacy `ZERO_SOURCE_OVERLAY`
rule was **relaxed 2026-06-03** and is no longer raised
(`m0StringValidator.ts:485`). Canonical overlay rules:
[`overlay-semantics.md`](overlay-semantics.md).

Invalid: `1{}` (INVALID_EMPTY) · `1{0}` (INVALID_EMPTY) · `1{2(1,0)}` (trailing
passthrough in body)
Valid: `1{1}` · `1{2(1,1)}` · `1{1{1}}` · `1{2(-,1)}` · `1{-}` · `1{2(-,-)}`

## 8. No-sources rule

The layout as a whole needs ≥1 leaf `1` (`NO_SOURCES`) — a source inside an
overlay counts: `2(-,-)` invalid, `2(-,-){1}` valid.

## Quick reference

```
VALID:    1 · 2(1,1) · 2(1{1},1) · 3[1,0{1},1] · 1{1{1}} · 1{2(1,-){2(-,1)}} · 1{-}
INVALID:  0 · - · 2(1) · 2(1,1,1) · 1{{1}} · 1{1}{1} · 2(1,0) · 2(1,0{1}) · 1{} · 1{0} · 2(-,-)
```

## Construction procedure

1. Decide the structure shape (tree of splits + leaves).
2. Build child arrays per split; count them; prefix the exact numeric classifier.
3. Attach at most one overlay object per node; get extra layers via nesting or
   split/hole structure inside the body.
4. Canonicalize.
5. Validate with `isValidM0String` / `validateM0String` from `@m0saic/dsl`
   (returns `{ok: true} | {ok: false, error}` — singular `error`).
6. On failure: discard and rebuild. Never patch a broken string by hand — fix the
   generator ([`m0saic-string-generation.md`](m0saic-string-generation.md) §3 has
   the per-code repair moves).
