# runtime/ — CLI usage & author-facing render guidance

The public runtime shelf. Deep engine internals (the W1–W12 ffmpeg walls, the
executable cost model, the mosaic-vs-ffmpeg responsibility model, audio wiring)
are **engine-internal** — `.ai/moat/runtime/` (absent in the shipped copy). The
author-facing consequences of those internals are already distilled into
[`../templates/patterns/perf-authoring-rules.md`](../templates/patterns/perf-authoring-rules.md),
which stands alone.

- [`cli-usage.md`](cli-usage.md) — rendering with the CLI: 14 commands (12
  public + 2 dev-gated) plus `telemetry`, routing (template id / `.mosaic` /
  `.mosaicx` / inline DSL), the `make` flag surface; `m0saic mcp`, the agent
  surface (21 tools in four groups).
- [`agent-at-the-canvas.md`](agent-at-the-canvas.md) — the live-canvas flow
  (0.3.1): an agent beside a person who has Make open — see it
  (`desktop_layout`, `desktop_snapshot`), act through Make's own handlers
  (`desktop_set_props`, `desktop_select_tile`, `desktop_make_control`), branch
  when the template runs out (`desktop_fork_to_document`, `desktop_open_file`,
  `desktop_edit_geometry`); the two flows, the etiquette, the fork round-trip.
- [`ffmpeg-expression-limits.md`](ffmpeg-expression-limits.md) — the
  `av_expr_parse` ~100-term recursion cliff that masquerades as OOM, and the
  public mitigation (`platform/ffexpr` chain rebalancing).
- [`reduce-to-one.md`](reduce-to-one.md) — complexity pushdown: nest a complex
  subtree as a child doc, then bake constant subtrees to flat assets.
