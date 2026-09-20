# "Push complexity down" — reduce to 1, then bake the constant

Two moves, applied in order. Move 1 is structural (isolate complexity); move 2
is temporal (stop recomputing a constant). They compose: nest, prove the knobs,
then bake. The user's vocabulary for this is literally **"reduce to 1"**, **"push
complexity down"**, and **"bake that result to a flat video file."**

## Move 1 — Reduce to 1 (nested source)

When a subtree is too complex or too precise, render it as its own **nested
source** (child mosaic document). In the parent it collapses to a single `F` —
one cell, one source ref. High-level layout stays simple; the complexity is
isolated one level down. It still renders every frame; you've only separated
concerns by precision tier (e.g. a px-baked, quantization-sensitive scatter vs.
resolution-independent chrome).

Mechanism: wrap the subtree as a child doc (`children[...]` + a
`{type:"mosaic", ref}` source) so the engine renders it into its own
framebuffer and the parent sees one `F`. Same primitive as nested-mosaic
clipping.

## Move 2 — Bake the constant (flat asset)

When a subtree is **identical on every render** — a fixed background, a
decorative field, a logo sting with no data dependency — don't render it at
runtime at all. Pre-render it **once** and reference the result as a flat asset.

How:
1. Author a one-off **`internal: true`** bake template whose only job is to
   render that subtree full-canvas, opaque, at each target aspect (e.g.
   `hero/ffmpeg-pulse/scatter-bake/v1`).
2. `m0saic make` it once per aspect → small `.mp4` / `.png` into the pack's
   `_shared/assets/` (mirror to `dist` via `build:templates`).
3. In the real template, replace the nested subtree with one
   `{type:"media", mediaType:"video"|"image", assetId, placement:{fit:"cover"}}`
   source, picking the asset by aspect (`scatter-${variantKey}.mp4`).
4. Update the unit test: assert the `assets.<name>` ref + the `mediaType`, and
   DROP the now-stale "child carries N tiles / animates" assertions.

Determinism still holds: a baked asset is a committed fixture, byte-identical
every run. Animation is fine to bake — the reveal/motion lives in the video.

## When to bake (the trigger)

> "When you notice DSL count is high **and** render is long, and the result is
> intended to be the same every time — bake it to a flat file."

All three must hold:
- **High DSL / long render** — the subtree dominates `dsl-complexity.md` metrics
  or wall-clock.
- **Constant across renders** — no prop/data dependency; same pixels every time.
  (If it varies with data, you cannot bake it — keep it live or reduce to 1.)
- **Knobs are locked** — bake LAST, after the look is signed off. Baking freezes
  the subtree; re-tuning means re-baking.

## When NOT to bake

- The subtree depends on props/data (varies per render) → it's not constant.
- The look isn't locked yet → premature; you'll re-bake every iteration.
- The subtree is cheap → baking adds an asset + a build step for no win.

## Measured payoff (FFmpeg-pulse title beat, 2026-06-23)

The title beat's signature background is a ~225-rect scatter with an L→R reveal —
the same on every render. Baking it to a flat per-aspect `.mp4`:

| Metric | Live scatter (inlined) | Baked scatter (1 video src) | Change |
|---|---|---|---|
| Wall-clock render (1920×1080, 9 s) | ~5 min | 66 s | ~4.5× faster, ~78% less |
| Flattened `.mosaic` size | ~163 K chars | 3,838 chars | ~98% smaller |
| Flattened source count | 238 | 14 | ~94% fewer |
| Baked asset size | — | ~98–155 KB / aspect | one-time, reused |

One-time bake cost ~3 m 21 s/aspect, amortized over every future render (it pays
for itself after ~1 render). The residual 66 s is the **chrome-overlay floor** —
the variable, prop-driven work that legitimately stays live. The bake removed the
*constant* cost and left only the *variable* cost; that's the whole point.

## Trade-offs

- **Inline:** one flat doc, simplest pipeline; fat parent m0, mixed precision
  tiers, depth accrues toward the ~25-layer overlay mask ceiling (see
  `feasibility-precision-quantization.md` and the overlay-depth limit), full cost
  every render.
- **Reduced to 1 (nested):** clean parent, isolated complexity, dodges the mask
  ceiling; still full render cost (the subtree still renders).
- **Baked (flat asset):** near-zero per-render cost for that subtree, tiny
  parent; but adds a committed asset + a one-off bake template + a build step, and
  the subtree is frozen (re-tune ⇒ re-bake).

## Adjacent

`dsl-complexity.md` (metrics → *when*), `feasibility-precision-quantization.md`
(precision tiers + the mask ceiling), nested-mosaic clipping (the move-1
mechanism). The shipped reference for a constant-subtree bake is
https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/hero/ffmpeg-pulse/scatter-bake/v1.
