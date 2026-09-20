# Template case-study lessons

Distilled 2026-07-26 from seven Feb-era case-study essays (deleted — git history has
the long forms). Format follows [`perf-authoring-rules.md`](perf-authoring-rules.md):
the rule, the incident that paid for it, the code that proves it. Companion:
[`primitive-extraction-pattern.md`](primitive-extraction-pattern.md).

**L1 — Derive overlay depth from source count; never hardcode `F{F{F}}`.**
`buildOverlayStack(sources.length)` (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/m0saic/build-overlay-stack.ts#L11)
keeps the m0 and the source array in lockstep when layers are added/removed.
**But** apply the Rect-Thesis smell test first: if your m0 is `buildOverlayStack(N)`
with `N == element count` and every source is full-canvas, you've baked pixel-math
into drawtext instead of geometry — Preview/Render Hero will be empty. Rebuild with
real cells ([`../construction-strategy.md`](../construction-strategy.md)).

**L2 — Solid-colour cells are `makeColorTile`, not text-sources-with-background.**
The old pill-bar technique (empty `MosaicTextSource` + `visual.backgroundColor`) is
explicitly legacy: lavfi `color=` is free per cell, and `makeColorTile` tiles are
valid `MosaicRefSource` targets without escape hatches
(https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/sources/makeColorTile.ts#L28). For lavfi sizing,
`fitMode:"tile"` fills the slot rect; `"content"` sizes to the content box +
placement.

**L3 — Transparent lavfi + `drawbox` needs `:replace=1`.** Plain `drawbox` on
`color=black@0` blends RGB but does NOT write alpha. This is
[`perf-authoring-rules.md`](perf-authoring-rules.md) **R7** — canonical there;
verify transparent tracks in rgba.

**L4 — Staggered reveals: lead + trail padding, identity by `logicalIndex`.**
The wireframe reveal (`wireframe/animated/v1/animated-wireframe.ts`) is the reference:
`startAtSec = leadPaddingSec + i * staggerSec`; trail padding =
`max(leadPaddingMs, OVERLAY_SLIDE_MS = 300)` so the LAST slide finishes before the
cut (`:157-161`); per-tile identity via `frame.logicalIndex`
(`childId = \`cell-${logicalIndex}\``, `:236`). Gate with the typed
`overlay.window` (preferred) or a recognized `enable` shape (R4).

**L5 — Rank-driven per-tile animation (brand/logo/v3 machinery).** A deterministic
rank function maps every filled tile to its time slot; four modes
(`logo_loop | progress_fill | loading_shimmer | loading_ui_v2`) + `rankSet`
(`diag | cascade | radial`) reuse one rank→enable/alpha pipeline
(`brand/logo/v3/logo.ts:39`). Guard frame 0 with `gte(t, 1/fps)` so nothing pops
before its slot. Two-doc blends ride the `F{F}` runner
(`logo/v3/logo_runner.ts:233`). Dictionary geometry ids: `m-33`, `m0`,
`m0saic-pattern`, `m-33_bitmap` (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/dictionary/src/entries/brand).

**L6 — Primitive positioning must be RATIO-based, and verified NESTED.** grid v1
computed absolute pixel positions and re-encoded them as a canvas-scale `placeRects`
basis: renders perfectly standalone, **silently drops when nested** (the engine
re-divides the per-pixel basis below 1px at e.g. 1024²). grid v2's design law:
position = a proportion of the cell expressed as an overlay offset (`H*frac`);
thickness = decoupled fixed-px strips (`primitives/grid/v2/grid.ts:23-40`).
Composability wins over node count. Corollary: "runnable standalone" is NOT a
sufficient primitive gate — test the primitive nested inside a parent split.

**L7 — Primitives never interpret domain config.** A gridline primitive takes counts
and fractions, not "chart config". [`primitive-extraction-pattern.md`](primitive-extraction-pattern.md)
Rule 1 owns this.

**L8 — Internal-pane text sizes derive from `ctx.target.height`, NOT the pane rect.**
The screencap InfoPane fix (`media/screencap_grid/internal/info_pane.ts:56-58,93-94`):
`titleFontSize = clamp(16..48, round(targetH * 0.022))` — pane-proportional fonts
wobble as the pane resizes, and fractional y-offsets resolve against the RASTER
height, landing text in the wrong band. Pixel-anchor metadata blocks
(`metaY = topPad + titleBlockH + gap`); auto-size the pane from content in the
parent.

**L9 — A template can be a TOOL.** The contact-sheet class (screencap grid) earns
its keep by producing a decision artifact a human can understand, share, and act on
immediately — design for that artifact, not for DSL flex.
