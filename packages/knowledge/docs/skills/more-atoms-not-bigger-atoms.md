# More atoms, never bigger atoms — the scaling contract with ffmpeg

> The measured cliffs behind atom 1 (and the "graph-size OOM" debunk) live in
> [`../runtime/ffmpeg-expression-limits.md`](../runtime/ffmpeg-expression-limits.md).
> This is the general principle; that is the case study.

m0saic renders arbitrarily complex templates by splitting work into pieces.
That works because ffmpeg capacity scales with the NUMBER of things it is
given (commands, inputs, filters, files). It breaks when a feature grows a
single UNPARTITIONABLE ATOM with content. Chunking cannot rescue a bigger
atom — the atom is smaller than a command.

## The four atoms (with measured walls)

1. **One expression string.** `av_expr_parse` has a ~100 recursion budget:
   ~98 flat `+` terms or ~100 nesting levels, independent of char length.
   Failure is a phantom `Cannot allocate memory` (−12) or `Invalid
   argument` (−22) at graph init, in <80 ms. Applies to EVERY expression:
   `enable`, `geq`, crop/scale/drawtext params, `%{eif}`.
2. **One filter's per-frame work.** `geq` interprets its expression per
   pixel per plane per frame (nodes × W × H × fps). No crash — render time
   explodes. Chunking does not reduce it: same pixels either way.
3. **One frame's memory.** frames-in-flight × W × H × 4 B. Buffering
   filters (`loop=size=N`, `split`, framesync queues, `tpad`) and
   resolution multiply it; filter COUNT does not (12,000 chained filters /
   1.19 MB single graph verified fine).
4. **One process's argv.** Windows caps ~32 K → `ENAMETOOLONG`.

## The classification test (apply to any content-scaled feature)

When something scales with content (N tiles, steps, keyframes, data
points), ask: **which quantity grows?**

- Count of commands / inputs / filters / workspace files grows → MORE
  ATOMS → fine; capacity, chunkable.
- A single expression, a single filter's per-pixel cost, a single frame's
  resident bytes, or argv grows → BIGGER ATOM → redesign before shipping.

## Bigger-atom anti-patterns → more-atoms replacements

| anti-pattern (bigger atom) | replacement (more atoms / bounded atom) |
|---|---|
| nested `if(cond,…,else)` per keyframe (`expr = if(...,${expr})` builders) | flat gated sum: `lt(t,t0)*(v0)+(gte·lt)*seg+…+gte(t,tN)*(vN)` |
| `.join("+")` on a content-scaled window list, emitted raw | route through the funnels (below) or `rebalanceAdditiveChains` |
| `geq` on a canvas/panel-sized stream | static SVG/PNG mask + `alphamerge`; keep geq on small intermediates |
| animated values as ever-larger exprs | pre-render to a small intermediate (value `.mov`s, text renders) |
| content-scaled string inline in argv (`-i lavfi`, drawtext text) | workspace file (`-filter_complex_script`, `-graph_file`, `textfile=`) |
| full-res lossless-alpha (qtrle/argb) intermediates on opaque nodes | alpha intermediates only where alpha flows |

## Existing enforcement (route new work through these; do not bypass)

- `rebalanceAdditiveChains` (`@m0saic/platform` ffexpr) auto-applied at the
  funnels: `quoteEnableArg` (all `:enable=`), `buildOverlayAlphaFilter`
  (enable→geq alpha fold), `buildCameraFilters` (zoom/focus). >32 flat
  terms → balanced tree (O(log n) depth, verified past 1024 terms); ≤32
  passes byte-identical. It CANNOT fix nesting — builders must emit flat
  shapes.
- Input-count split (`maxInputsPerCommand`) — more commands per node.
- Graph/text file lowering — argv atom stays constant.
- SVG rounding rasterizer (default) — rounding is a mask input, not geq.

Known bypasses to watch: hand-rolled lavfi `enable=` strings (dsl-string
caret track, dsl-canvas drawbox — currently ≤3 terms) and nested-if
builders in other templates (e.g. line-chart anim) that will hit atom 1 if
their datasets grow.

## Review greps

`join("+")` on generated arrays; recursive expr accumulation
(`= \`if(…,${expr})\``); `geq` fed by canvas-sized labels; content
interpolation into `-i`/argv rather than a workspace file.

---

*Per-pixel eval cost (atom 2) is the next practical wall at denser grids — a
perf ceiling, not a crash; fix it representationally (masks, pre-rendered
intermediates), not by chunking.*
