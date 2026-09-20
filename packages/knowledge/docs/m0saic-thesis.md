# The m0saic Thesis — read this first

> Max-importance. This is the *why* behind every other doc. When a design choice
> is unclear, return here. The Handbook is canonical for *grammar*; this is
> canonical for *intent*.

## The product IS m0

m0saic is not "a tool that happens to use a DSL." **The product IS the m0 string.**
Everything — templates, the engine, Make, Layout, Render Hero, the corpus —
revolves around producing, inspecting, and rendering one string.

## Everything is rectangles on a canvas

This is a mental change, and it's the whole change. m0saic does exactly one thing:

> **Place arbitrary rectangles within a canvas, and render content inside them.**

Once you adopt it, every visual problem dissolves into the same shape — a title,
an axis label, a gridline, a chart line, a KPI card, a glyph, a video tile: all
of it is **rectangles on a canvas**. There is no other primitive. What varies is
only what you do with a rect:

- **Fill it** — put pixels in the rect, from *any* source: a solid color
  (lavfi), an image or video (media), a nested template (mosaic), a mirrored
  cell (ref), rendered text, … The source type varies; the act is identical —
  **pixels into a rect.** (The data-fetcher source is the one exception: it
  supplies *data* for other sources to render, not pixels of its own.)
- **Mask it** — a shape carved inside the rect (inline-mask path).
- **Reveal it in order** — animate a set of rects (overlay alpha / draw-on).
- **Rank / set it** — proportion or arrange rects by weight, grid, or placement.

It is **always** rectangles on a canvas. If you're reaching for anything else
(drawtext positioning, `size`/`fit` scaling, a full-frame source standing in for
a small element), you've stepped off the thesis — step back on. The answer to
almost every "how do I render X here" is: **carve a rect sized exactly to the
bounds, then fill or mask it.**

## Embrace complexity in m0 — don't fear it

The instinct to keep the m0 string "small" or "readable" is wrong. **We do not
fear complexity in the m0 string — we embrace it.** Pushing all complexity *into*
the string is precisely what keeps everything downstream simple:

- **One source of truth.** All complexity lives in a single string. The document,
  the render, the preview, the corpus entry — all derive from it. Nothing is
  hidden in source code, in `xExpr` math, or in a mask pretending to be a layout.
- **Unambiguous + deterministic.** The same m0 string is *always* the same
  geometry, byte-for-byte. No hidden state, no time-dependence, no surprises.
- **Inspectable.** Because the geometry is *in* the string, the DSL view, the
  structure preview, Render Hero, and selection all just work. A layout that
  bakes its geometry into pixels or source code is invisible to all of them.

A 78-overlay "renders right but carries no geometry" template is the failure
mode. A frame tree of hundreds of real cells — even thousands — is the success
mode, even when the string is enormous.

## There is effectively no upper limit

Do not cap the geometry out of fear of string size. **m0 strings of millions of
characters have been tested and parse fine.** Length is not a constraint — nest,
split, place, and stack as much as the design needs.

## Agents: use the DSL — it is the point

Agents have been **far too shy about using the DSL.** Reaching for a full-frame
source, a `drawtext` position, or a `size` expression to dodge "complex" geometry
is dodging the entire point of the program. Lean in:

- Translate JS pixel-math into **real m0 cells**, not baked pixels.
- When you need a thin/short/precise element, **carve the cell** — don't scale a
  source to fake it.
- Reuse primitives (the `@m0saic/primitives/grid/v2` template; the `weightedSplit`
  and `placeRects` stdlib builders) — they exist to emit geometry so you don't
  hand-roll donation runs. (grid v1 is deprecated — nested, its basis silently drops.)
- A big, exact, fully-geometric m0 string is the goal, not something to minimize.

## Operational corollaries (where this gets concrete)

- **The grammar itself** (start here to understand the m0 string):
  [`handbook/dsl-rules.md`](handbook/dsl-rules.md) — the exact surface grammar,
  semantic rules, and validation invariants of the m0 DSL. Canonical.
- **The geometry math** (feasibility, precision, quantization, GCD — the absolute
  math behind balanced layouts):
  [`handbook/feasibility-precision-quantization.md`](handbook/feasibility-precision-quantization.md).
- **Template construction:** `docs/templates/construction-strategy.md`
  — the Rect Thesis, the Real-Geometry Hard Rule, the size-expr smell test.
- **Spatial vs temporal:** `docs/templates/philosophy-and-contract.md`
  (§"Document vs pipeline") — geometry is the document; time is the pipeline.
  Keep the algebra pure.
- **Determinism + DSL integrity:** the agent contract (the maintainers' agent contract §9 (not published)) and
  the Handbook (canonical grammar). Verify every string with `validateM0String`.

> If you remember one sentence: **everything is rectangles on a canvas, all
> complexity lives in the m0 string, and that is a feature — so use it fully.**
