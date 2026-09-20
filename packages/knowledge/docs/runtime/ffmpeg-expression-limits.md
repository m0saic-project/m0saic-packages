# FFmpeg Expression Limits — the parse-depth cliff (a phantom "OOM")

**Source of truth:** `rebalanceAdditiveChains` in
[https://github.com/m0saic-project/m0saic-packages/blob/main/packages/platform/src/ffexpr/balance.ts](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/platform/src/ffexpr/balance.ts)
(`DEFAULT_MAX_FLAT_ADDITIVE_TERMS = 32`); the funnels that apply it —
`quoteEnableArg` in [https://github.com/m0saic-project/m0saic-packages/blob/main/packages/platform/src/ffexpr/ffmpeg.ts](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/platform/src/ffexpr/ffmpeg.ts),
`buildOverlayAlphaFilter` + `buildCameraFilters` in `@m0saic/core`.
Verified against BtbN ffmpeg `N-124278-gcc3ca17127-20260430` (the pinned GPL build).

> Companion mental model: [`../skills/more-atoms-not-bigger-atoms.md`](../skills/more-atoms-not-bigger-atoms.md).
> This doc is the measured case study; that one is the general principle.

---

## The symptom (and why it lies)

FFmpeg's expression parser (`av_expr_parse`, `libavutil/eval.c`) has a **fixed
recursion budget (~100)**. When an emitted expression exceeds it, filtergraph
init fails with:

- **`Error initializing filters / Error : Cannot allocate memory` (−12)** — a
  **phantom OOM**: deterministic, ~60 ms, completely independent of free RAM.
  This is the additive-chain shape.
- or **`Missing ')' or too many args` → `Invalid argument` (−22) /
  `Error reinitializing filters`** — the deeply-nested shape (e.g. a `crop`
  focus expr).

The word "memory" is a lie. It is NOT commit pressure, graph size, filter
count, or a platform difference — all of which this failure repeatedly (and
expensively) misled debugging toward. It is one expression too deep.

## The cliff (measured, term-count-driven — NOT chars)

- A **flat `a+b+c+…` chain fails at exactly 99 terms** (98 parses, 99 fails).
  Character length is irrelevant: a 3.8 K-char / 98-term expr parses; a
  2.3 K-char / 99-term expr fails.
- **Genuine nesting** (nested `if(cond,…,else)` chains) fails at ~100 levels.
- Because ffmpeg spends one recursion level **per additive term at the same
  nesting level**, both shapes share the same ~100 budget.

## The two shapes → the two fixes

1. **Flat additive chains** (`enable` window sums, the `overlay.enable`→`geq`
   alpha fold, camera zoom/focus). Fixable by REGROUPING the same terms into a
   **balanced binary tree** — `((a+b)+(c+d))…` — which keeps parse depth
   O(log N) and is safe past 1024 terms. This is `rebalanceAdditiveChains`.
2. **Deep nesting** (one nested `if()` level per keyframe). Rebalancing CANNOT
   help — the builder must **emit a flat shape instead**. dsl-tutorial's camera
   `focusExpr` was rewritten from nested `if(lt(t,…),…, else)` (depth 109 at
   10×10) to a **flat sum of disjoint window-gated smoothstep segments**
   (`lt` head + `gte·lt` segments + `gte` tail).

## Authoring rule

**No flat additive chain longer than ~32 terms, and no piecewise-over-time
expression built as a nested if-else chain, should ever reach a filtergraph.**
Build piecewise-in-time values as **flat gated sums**; long chains are
auto-rebalanced at the engine funnels below.

## Engine enforcement (shipped 2026-07-02 — route new work through these)

`rebalanceAdditiveChains` (`@m0saic/platform` `ffexpr/balance.ts`, threshold
`DEFAULT_MAX_FLAT_ADDITIVE_TERMS = 32`) is applied automatically at every
expression funnel:

- `quoteEnableArg` — ALL `:enable='…'` sites (overlay, drawtext,
  `compileEnableArg`).
- `buildOverlayAlphaFilter` — the `overlay.enable` → `geq` alpha fold.
- `buildCameraFilters` — zoom/focus chains.

Chains **≤ 32 terms pass through byte-identical** (goldens unaffected); only
longer chains are regrouped. Rebalancing fixes PARSE; it does not change eval
cost (see below).

**Known bypasses to watch:** hand-rolled lavfi strings that build `enable=`
outside the funnels — dsl-string caret-track `drawbox`, dsl-canvas `drawbox`
(both currently ≤3-term chains, safe) — and any template that still builds a
nested-`if` expression (e.g. a line-chart animation) which will hit the cliff
if its dataset grows. Keep per-filter chains small, or call
`rebalanceAdditiveChains` before joining.

## The "graph-SIZE OOM" was this cliff wearing a trench coat (debunked)

A separate ≈130 K-chars / 9 000-filters "graph-size OOM" mode was once believed
to exist, and a `splitByGraphBudget` chunker was calibrated against it. **It does
not reproduce.** Direct verification:

- The exact 142 K canvas part it was calibrated on renders standalone at full
  duration; so do a **12 000-chained-drawbox / 1.19 MB single graph** and a
  9 000-filter graph.
- Every recorded failure sidecar in `smokebatch/` (smoke9–29) is a command
  whose EXPRESSIONS cross the parse cliff (flat ≥99 or nesting ≥109), failing in
  <80 ms with −12/−22. **No sidecar ever names a size-heavy command.**

Graph chars merely *correlated* with expression bulk in that era's graphs. The
graph-size chunker was reverted. **Do not re-add a filtergraph-size split
chasing a "size OOM" — it is the parse cliff.** (The input-count split,
`maxInputsPerCommand`, is a separate and real argv/process-arg constraint and
stays.)

## Note: the macOS "grind" is a different wall

The same dense graphs that fail fast on Windows (parse cliff) instead ran for
20+ min on macOS. That was NOT the parse cliff (Mac's ffmpeg parses flat chains
fine) — it was **per-pixel `geq` eval cost** (O(terms) per pixel per plane per
frame). Rebalancing does not reduce it; density caps like `PULSE_TERM_CAP` and
representational fixes (SVG masks, pre-rendered intermediates) do. That's a
perf ceiling, not a crash — see the "more atoms" skill, atom 2.

There is also a *third*, mechanically distinct macOS wall on
conversion-/input-dense graphs (many `scale`/`format` nodes + many still
inputs, e.g. dsl-tutorial grids): **swscale thread-cap exhaustion**, where
per-conversion thread pools blow past `kern.num_taskthreads` and frames freeze
at t=0 or grind at ~1 fps. That one is neither parse depth nor `geq` eval cost —
that wall is engine-internal: `.ai/moat/runtime/macos-swscale-thread-cap.md`
(absent in the shipped copy; symptom summary: dense still-image canvases freeze
at t=0 / grind ~1 fps on macOS — the engine's threadGuard mitigates it).
