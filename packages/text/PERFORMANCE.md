# Performance — SVG text vs. drawtext

`@m0saic/text` powers the engine's **svg** text rasterizer (`rasterizer:"svg"` on a
`MosaicTextSource`): text → SVG glyph outlines → a flat color tile shown through an
`inline-mask`. The alternative is the legacy **drawtext** path, which renders each
text source to its own PNG/MOV via a separate ffmpeg process and then composites it.

This doc records why svg is the faster path for multi-label documents, with an
end-to-end measurement.

## Why svg scales better

| | drawtext | svg |
|---|---|---|
| ffmpeg processes for **N** labels | **N + 1** (one drawtext spawn per label + one composite) | **1** (a single composite; the lavfi color tile is free) |
| Glyph rasterization | per-label, inside each ffmpeg spawn | all masks in **one batched sharp call** during plan-build |
| Repeat renders of identical text | re-rendered every time | **content-addressable mask cache** (sha256) → reused |
| Font | host fontconfig (non-deterministic) | bundled deterministic font file |

drawtext cost grows **linearly with the number of labels** because every label is its
own process spawn. svg keeps the process count flat at one composite — the per-label
work collapses into a single sharp invocation that the engine runs once.

## Measurement

End-to-end wall-clock (plan-build **+** render) for the *same* document rendered both
ways: an `N`-cell grid where every cell is a distinct text source (distinct strings,
so neither path can dedupe). Full ffmpeg render to mp4.

- Canvas 1280×720, fontSize 40, 500 ms @ 30 fps.
- drawtext: best of 3 runs. svg: cold = mask cache cleared first; warm = cache hot.
- Machine-dependent (measured on a dev macOS box, ffmpeg w/ libx264). Treat the
  absolute numbers as **indicative**; the *scaling shape* is the point.

| labels | drawtext (ms) | svg cold (ms) | svg warm (ms) | cold speedup |
|---|---|---|---|---|
| 1  | 242  | 198 | 148 | 1.2× |
| 4  | 466  | 207 | 181 | 2.3× |
| 16 | 1351 | 422 | 330 | 3.2× |
| 36 | 2851 | 722 | 589 | 4.0× |

drawtext emitted **N+1** ffmpeg commands (2 → 37); svg emitted **1** composite command
at every size, with the glyph rasterization showing up as a flat ~60–110 ms of
plan-build time (the single batched sharp call) regardless of label count.

### Takeaways

- **One label:** roughly on par (svg ~1.2× — the spawn-vs-mask difference is small).
- **Many labels:** svg pulls away — ~3–4× faster by a few dozen labels, and the gap
  keeps widening with N because drawtext is O(N) process spawns vs. svg's O(1).
- **Warm cache:** repeat renders of unchanged text skip rasterization entirely.

## Caveats

- svg mode is **single-color** today (one ink per source); multi-color / per-glyph
  recolor is future work. drawtext remains the fallback for `expr` (per-frame) text
  and box/border styling.
- Numbers are single-machine and will vary with CPU, ffmpeg build, and label size;
  re-measure on the target host before quoting figures.

## Reproduce

Build the workspace, then drive `buildMosaicPlanFromFile` + `renderPlanToFile`
(`@m0saic/core`) over an `N`-cell grid document, toggling `rasterizer: "drawtext" |
"svg"` and timing plan-build + render. Clear `os.tmpdir()/[m0saic]_mask-cache` to
measure svg cold.
