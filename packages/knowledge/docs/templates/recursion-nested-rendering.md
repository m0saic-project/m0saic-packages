# Children, recursion, and nested rendering

How `children` work inside a `MosaicDocument`, and how nested documents and
pipelines evaluate. Source of truth: `renderNestedTemplate`
([https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/render/renderNestedTemplate.ts](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/render/renderNestedTemplate.ts));
document types in [https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src).

The core rule — **bottom-up evaluation**: for a document D, every child C in
`children` renders fully first; C's rendered output is then treated as a media
source; D renders last from those resolved inputs. Each document stays spatially
pure, children resolve before parent composition, and no circular dependencies
are possible. Children may themselves contain children — recursion depth is
unbounded in principle, limited only by practical engine constraints.

## A nested mosaic is also a clip region

Children have a second, less obvious use: **bounding an animated overlay's pixels.**

### The trap

`MosaicMediaSource.overlay.xExpr` / `.yExpr` are **offsets** handed to ffmpeg's
`overlay` filter. That filter positions the layer — it does **not** clip it to the
destination rect. So a source placed in a cell, even with `placement.inset` and a
correct `fit: "contain"`, will happily paint **outside** its cell once `xExpr` /
`yExpr` push it there. `applyInsetToRect`
(the render engine source (not published), verified 2026-07-27) insets the
*destination*; it does not constrain the *payload*. The natural assumption —
"it's placed in a cell, so it stays in the cell" — is wrong.

Worst offenders:

- **Diagonal sweeps** — a tilted band's horizontal footprint is
  `sin(angle)·tileSize + 2·halfWidth/cos(angle)`, easy to under-estimate.
- **Offscreen entry/exit** — the layer is *intentionally* outside the rect at the
  extremes of the animation.
- **Procedural offsets** where no static bound is obvious.

### The fix is structural, not arithmetic

Don't tighten the math — **wrap the moving layer in a child mosaic.** Per the
bottom-up rule, the engine renders each child into an intermediate framebuffer
sized to its allocated frame, then composites that result. A finite buffer clips
by construction: pixels the inner overlay tries to paint past the edge have
nowhere to land.

Parent — swap the moving media source for a `type: "mosaic"` source:

```ts
sources.push({
  type: "mosaic",
  ref: "<child-key>",
  placement: { fit: "contain", hAlign: "left", vAlign: "top", inset: { /* … */ } },
  overlay: { blendMode: "screen", enable: enableExpr },  // re-declare the gate here too
});
```

Child — a transparent base plus the moving layer:

```ts
doc.children["<child-key>"] = {
  kind: "mosaic_document",
  version: 1,
  m0: toM0String("F{F}", "ChildName"),
  assets: { /* the moving layer */ },
  sources: [
    { type: "lavfi", color: "black@0" },          // transparent base = the framebuffer
    { type: "media", mediaType: "image", assetId: id,
      placement: { fit: "contain" },
      overlay: { xExpr: sweepXExpr, enable: enableExpr } },   // clipped at the edge
  ],
};
```

`color: "black@0"` is the idiomatic transparent base. Intermediates carry alpha by
default, so the composite stays clean.

### Cost, and when to skip it

One extra encode pass per nested mosaic — negligible for a small overlay (corner
badge, shimmer on a 10–20% cell) against the parent's full-canvas encode, but not
free. Skip the wrap when the offset is bounded by static math **and you have
verified it** at every value (rare, historically easy to get wrong), or when you
*want* the bleed (a shadow or glow deliberately falling outside its source).

### Reference — read the history, not just the code

https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/media/qr/stamp-video/v1 wraps its gleam sweep in
`children["qr_stamp_gleam"]` (`qr-stamp.ts:536`), with a ±0.7w sweep in
`gleamBand.ts` `buildGleamSweepXExpr` that pushes the band fully offscreen at both
extremes — **only safe because the child clips.** It shipped with the bleed bug
first; the wrap was the fix.

> ⚠️ **That template is `deprecated`** (replacement `@m0saic/media/qr/stamp/v1`),
> and its deprecation note retires the gleam sweep *by design*: "decoration
> belongs baked into the input media, not computed in the stamp." It stays
> registered as the reference adaptive video stamp. So this is currently a
> **pattern with no live consumer** — the engine behavior it exploits is real and
> unchanged, but if you reach for it, you are the first user in the current
> shelf. Weigh the "bake it into the input instead" argument before adding an
> animated overlay at all.

Related: the same child mechanism is the vehicle for complexity pushdown — see
[`../runtime/reduce-to-one.md`](../runtime/reduce-to-one.md). Clipping and
pushdown are two applications of one feature.

## Children fill tiles; they never change geometry

    children?: Record<string, MosaicDocument | MosaicDocumentPipeline>

The m0 string defines geometry only — it does not name tiles. Template code maps
logical tiles to child entries by StableKey: parse the m0, identify target tiles,
attach children under consistent keys. StableKeys are structural, so they stay
stable across resolution changes — the mapping is robust.

Children do NOT modify the parent's m0 string, split behavior, overlay logic, or
StableKey generation. They only fill existing tiles: the DSL is *shape*,
`children` is *content*.

## Pipelines as children

A child entry may be a `MosaicDocumentPipeline` rather than a document. The
pipeline renders first; its final stitched output is treated as media that the
parent consumes. This enables animated sub-tiles, time-sequenced inserts, and
scene-within-scene structures without polluting the DSL with time.

## Determinism

Nested rendering stays deterministic when all child templates are deterministic,
no capability introduces nondeterminism, and props + ctx.output are fixed —
bottom-up evaluation then guarantees reproducibility.

## Flags (`internal: true` etc.)

Template status flags — `internal` (not intended as a top-level pick: hidden
from public registries, available for nested rendering; standalone renderability
varies per template), `primitive`, `deprecated` — are owned by
[`reference/template-flags.md`](reference/template-flags.md). Internal templates are the
natural children in layered template architectures.
