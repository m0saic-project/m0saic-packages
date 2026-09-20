## Overlay Semantics & Paint Order

Overlays are recursive layout subtrees rendered inside an owner's rect — a first-class
compositional primitive, not just "layers". This doc covers attachment, paint order,
deferred zero-overlay paint, the overlay-body validity rule, and composition at scale.

> **Source of truth:** overlay parsing in [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts);
> overlay-body validation in [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts)
> (relaxation comment at lines 479–486); error codes in [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/errors/errors.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/errors/errors.ts).
> Every accept/reject example below was runtime-verified against https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/dist
> via `validateM0String` on 2026-07-27.

## Attachment: any node can own an overlay

Form:

    node{ overlay_body }

`node` may be ANY node kind — not just `1`:

- `1` (tile), `0` (passthrough), `-` (null — child position only; see Logical Owner)
- `N(...)` / `N[...]` (splits)
- a node that is itself an overlay owner (chains)

No base `1` is required for an overlay to exist. A chain of full layouts is legal:

    2(1,1){3(1,1,1){2(1,1)}}    — base 2-col, overlay 3-col, overlay-on-overlay 2-col

Rules:

- At most ONE immediate overlay object per node — `1{1}{1}` rejects
  (`OVERLAY_CHAIN`). Stack by nesting instead: `1{1{1}}`.
- The overlay body must validate independently as a full m0 string, recursively.
- Nesting depth is structurally unbounded — but see the render-cost caveat below.

Valid: `1{1}` · `2(1,1){1}` · `1{1{1}}` · `2(1,1){3(1,1,1){2(1,1)}}`

## Overlay rect = owner rect

The overlay subtree is parsed against owner.x / owner.y / owner.width / owner.height.

- It does NOT inherit sibling geometry.
- It does NOT escape its parent rect.

Applies to tile, group, null, and zero overlays alike.

## Overlays never mutate geometry

Overlay stacking, at any depth:

- does NOT change splitEven results or sibling sizes
- does NOT change structuralDepth
- does NOT alter stableKeys of the base structure

It only increments `overlayDepth` and adds paint layers. The base layout defines
geometry; overlay chains define drawing.

## Paint order

Deterministic, defined by engine traversal.

### Tile overlay

    1{1}

1. Base tile
2. Overlay subtree (immediately after owner)

### Group overlay

    2(1,1){1}

1. Child 0
2. Child 1
3. Group overlay — group overlays paint AFTER all base children.

### Zero overlay (deferred paint)

    3(0{1},1,1)

Zero overlays do NOT paint immediately; they defer until the claimant renders:

1. Claimant tile
2. Deferred zero overlay

Multiple zero overlays in one run:

    3(0{1},0{1},1)

1. Claimant
2. Larger-area zero overlay
3. Smaller-area zero overlay (top-most)

Deferred zero overlays are sorted by area DESCENDING → smaller overlays paint on top.

### Claimant with its own overlay

    3(0{1},1{1},1)

1. Claimant tile
2. Claimant's own overlay
3. Deferred zero overlay — always after the claimant AND the claimant's overlay.

### Nested overlays

    1{1{1}}

1. Base tile
2. First overlay
3. Nested overlay

## Logical owner `-`

`-{X}` marks `isLogicalOwner = true`: the base does not render, but the overlay rect
exists and carry is still absorbed if it is a claimant. Use for editor semantics and
labeling containers.

Position matters: `-{...}` is valid in a child slot or inside an overlay body, NOT as
the whole-string root — `2(-{1},1)` and `1{-{1}}` accept; bare `-{1}` rejects
(`TOKEN_RULE`), as does a bare `-` root (`INVALID_EMPTY`).

## Overlay depth vs structural depth

Two independent counters:

- `structuralDepth` — increases entering numeric containers; root = 0.
- `overlayDepth` — increases entering `{...}`; base layout = 0, first overlay = 1.

Overlay frames inherit the structuralDepth of their context and use a separate frame
namespace.

## Overlay body node rule (`INVALID_EMPTY`)

An overlay body `{...}` must contribute at least ONE node to the graph, but does not
have to paint. Logical-owner anchors (`-{X}`) are the common shape.

Rejected — zero nodes, or a single root with nothing to act on:

    1{}        — empty body; no nodes at all
    1{0}       — bare passthrough at the overlay root; nothing to donate to
    1{-{}}     — recursive: the inner `{}` is rejected (deepest offender reported)

Accepted — at least one node, even if nothing paints:

    1{-}              — single null node; logical-owner anchor
    1{2(-,-)}         — all-null split; structural nodes, no paint
    1{2(0,-)}         — passthrough with a sibling to donate space to
    1{-{-}}           — nested logical owners
    1{-{2(0,-)}}      — nested with structural content
    1{2(-,1)}         — overlay body has a source (always valid)
    1{2[1,1]{1}}      — nested overlay body has a source

The legacy `ZERO_SOURCE_OVERLAY` rule (body must contain at least one leaf `1`) was
relaxed 2026-06-03 — overlay bodies no longer have to paint, only exist as nodes
([`m0StringValidator.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts):479–486).
The whole-string `NO_SOURCES` check still requires the OUTER (root) layout to produce
at least one source tile, so the renderer is never asked to draw a fully empty canvas.

Error code when rejected: `INVALID_EMPTY` (kind `SYNTAX`).

## Composition at scale: deep overlay stacks

Overlay chains are how large rect sets are composed: each `{}` wraps a full valid
subtree, and each layer paints inside the owner's rect. A 109-overlay brand mark —
each overlay an independently calculated m0saic drawing one precise rectangle — is a
measured working example; its serialized string ran to tens of thousands of
characters, which parse/validate/walk handle without issue.

Deep stacks are editor-clean: each overlay is its own layer, filterable by
`overlayDepth`, structurally independent, with no geometry coupling.

Use deep overlays for programmatic rect emission — dictionary-based layouts, glyphs,
masks, strict layering control. Prefer a single split when it expresses intent more
clearly or raw-string readability matters.

> ⚠️ **Render-cost caveat** (measured 2026-07-02): depth is free structurally, NOT at
> render time. Each overlay level is one sequential blend pass on ffmpeg's single
> graph thread, and past ~25 nested overlay layers inline-masks silently degrade
> (circles→squares, text→tofu) — engine wall W3. Deep stacks are cheap to WRITE
> and inspect, not cheap to RENDER — collapse time-disjoint line geometry into
> lavfi tracks first. Author-facing rules:
> [`../templates/patterns/perf-authoring-rules.md`](../templates/patterns/perf-authoring-rules.md)
> (R6). Deep dives are engine-internal: `.ai/moat/runtime/ffmpeg-limitations.md`,
> `.ai/moat/runtime/render-cost-model.md` — absent in the shipped copy.

## Invalid constructions (verified, with codes)

    1{}          — INVALID_EMPTY (empty body)
    1{0}         — INVALID_EMPTY (bare passthrough body)
    1{-{}}       — INVALID_EMPTY (recursive)
    1{1}{1}      — OVERLAY_CHAIN (two immediate overlays; nest instead)
    1{{1}}       — TOKEN_RULE (no owner token for the inner overlay)
    1{2(1,0)}    — PASSTHROUGH_TO_NOTHING (trailing `0` inside overlay body)
    -{1}         — TOKEN_RULE (`-{...}` cannot be the whole-string root)
