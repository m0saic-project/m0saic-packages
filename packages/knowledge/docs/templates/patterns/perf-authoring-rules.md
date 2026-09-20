# Template perf authoring rules

> Templates layer. The author-facing distillation of the engine's cost model and
> ffmpeg walls — the rules below stand alone; the deep dives are
> **engine-internal** (`.ai/moat/runtime/render-cost-model.md`,
> `.ai/moat/runtime/ffmpeg-limitations.md` — absent in the shipped copy).
> Every rule below was paid for by a real dsl-tutorial or chart-template incident.

## R1 — Complexity belongs in the m0 string, not the source list
The string is near-free (millions of chars parse fine); **source count is the cost**
— every source is built at setup AND composited on every frame for the whole clip
(no active window unless it declares one — see R4). The smell: emitting N sources
to draw ONE visual thing. Measured: a donut whose sweep needed 31 lavfi arc
slivers took 376s to render 3s. Window gating does NOT fix this — the setup
intercept and the per-frame composite count remain per source.

## R2 — Smooth shapes are ONE masked tile; coarse shapes are a few unmasked tiles
A mask is one source regardless of edge length; a tile grid stitches at ~N².
Never draw shapes with drawtext glyphs (tofu) or text-masked rects (distortion) —
shapes are `makeColorTile` + inline-mask SVG with `bounds` = cell aspect.

## R3 — Never geq; never expression-mode filters
geq evaluates its expression per pixel per frame — 2–3 orders of magnitude over
compiled filters. Rounding and shape masks are SVG sidecars now (engine default).
The trap re-enters through the back door: a time-varying `overlay.alpha` expression
compiles INTO a per-pixel geq fold. Which is why —

## R4 — Give every short-lived source a WINDOW; animated alpha is affordable when canonical
`overlay:enable=` is a scalar per-frame gate (free) — still the right tool for
hard on/off. And since the enable-gating engine sprint (2026-07-09/10), windowed
FADES are cheap too: canonical alpha products (`fadeInExpr` shapes, `exit()`
complements, the in/hold/out envelope, constants) lower to compiled
`fade`/`colorchannelmixer`, and any surviving fold is dual-gated + trimmed to
the source's window. Declare the window as an `enable` in a recognized shape
(`gte(t,A)`, `lt(t,B)`, `between(t,A,B)`, `gte*lt`) or the typed
`overlay.window {startSec,endSec}` — the published motion-kit helpers
(`entrance`/`exit`/`composeMotion` + the track builders in
`@m0saic/template-utils`) emit it automatically, as do the alpine-pack-local
reveals (`revealGate`/`revealSlideNode`/`revealFade` in
`alpine/_shared/alpine-anim.ts` — pack-local, not published). What still costs: NON-canonical alpha with NO window (spatial
sweeps, custom eases, unbounded lifetimes). Consequence for two-mode templates:
the alpine premium/light split is now a LOOK decision, not a perf one — the
runner renders premium ≈ 3× faster than pre-sprint light.

## R5 — A value that changes N times = one layer per DISTINCT VALUE, not one N-boundary expression
The narration-collapse idiom (dsl-tutorial inspector). A single `%{eif:…}` with ~100
change-boundaries crashes drawtext's ~80-boundary budget; 8 fields × animated alpha
overflowed a filtergraph. One text source per distinct value, enable-gated over the
union of windows where that value holds.

## R6 — Line geometry over time = ONE lavfi drawbox track, not N masked overlays
Cursors, split lines, borders, curtain wipes: collapse N time-disjoint elements into
one lavfi source whose graph is a flat chain of enable-gated `drawbox` ops. Depth
O(N) → O(1); measured 37.9s → 9.0s on the 4×4 canvas. Keeps the whole panel at a
fixed handful of overlay layers at any tile count — safely under the ~25 overlay-depth
mask-drop ceiling (see limitations doc W3). Constraints: solid rect strokes only
(dashes = runs of boxes); positions snap per-window (no smooth per-frame motion).
For a masked line draw-on, use a curtain wipe over the static art, not a per-sliver
cascade.

## R7 — `replace=1` on every drawbox over a transparent base
Plain `drawbox` on `color=black@0` blends RGB but does NOT write alpha — edges are
`(r,g,b,0)`: visible in an rgb24 probe, gone after compositing. Verify transparent
lavfi tracks in **rgba** and check edge-pixel alpha.

## R8 — Bake what never changes
A subtree that is constant across renders and expensive to composite → render it once
and reference the asset; a precise subtree that bloats the parent → nest it
("reduce to 1"). Triggers, mechanics, and measured payoffs:
[`../../runtime/reduce-to-one.md`](../../runtime/reduce-to-one.md). The cost-model
bar: an intermediate round-trip costs ~5–15 ms/frame — anything costlier in-graph
should be materialized.

## R9 — Text: svg rasterizer for static, drawtext only for per-frame-dynamic
`rasterizer:"svg"` turns static text into a mask + color tile (no drawtext, no
per-frame shaping). It does NOT support expressions — that fallback to drawtext is
correct, keep dynamic text drawtext and keep the instance count low. Mind
density budgets: hundreds of glyph masks in one panel approach the argv wall
(dsl-canvas caps: 260 mask subpaths, 200 labels, 500 curtain boxes per source).
Also: the app fits text wider than the CLI — leave generous fixed-font margins.

## R10 — Camera: constant zoom is cheap, animated zoom is a different animal
Constant zoom = static `eval=init` scale + free crop. An animated zoom forces
per-frame scale (`eval=frame`) — the stream becomes variable-size and materially
more expensive. Don't animate zoom for effect you can get from enable-gated cuts.

## R11 — Measure before optimizing
`m0saic make … --perf` writes a `.perf.json`/`.perf.md` sidecar: per-command timing
rolled up by node, with `overlayDepth` per rect and a hotPath. Render at two
durations to split setup cost (intercept) from per-frame cost (slope). Optimize the
named bottleneck, not the vibe.

## Quick pre-flight (before handing off a candidate)
- [ ] Source count ≈ number of visually distinct things (not slivers/glyph shards)?
- [ ] Any geq / animated-alpha / N-boundary expression? (R3–R5)
- [ ] Line geometry collapsed to tracks; `replace=1` present? (R6–R7)
- [ ] Overlay depth per panel comfortably under ~25?
- [ ] Static text on svg rasterizer; dynamic text instances counted? (R9)
- [ ] Constant-across-renders expensive subtree baked or nested? (R8)
- [ ] `--perf` sidecar checked once at target size?
