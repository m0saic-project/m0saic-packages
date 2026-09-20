# `docs/` — the m0saic knowledge base

Golden rules and mental models for working in the m0saic ecosystem. This folder is
**shippable**: it may be published to the public m0saic ecosystem as-is, so new
engineers can point their agents at it. Read
[`m0saic-thesis.md`](m0saic-thesis.md) first — the one load-bearing idea.

## The moat contract

Nothing in this folder may document private engine internals. Deep dives on the
engine (filtergraph builders, cost-model coefficients, ffmpeg walls and their
mitigations, private-app internals) live in **`.ai/moat/`** — internal-only, never
shipped. Public docs here stand alone; where one references an internal deep-dive
it uses the marked form ``(internal: `.ai/moat/…` — absent in the shipped copy)``
as plain text, never a markdown link. Moat docs may link here freely; docs here
must never *depend* on moat content.

## Authority hierarchy (from the agent contract §0)

1. **handbook/** — canonical truth for DSL grammar, semantics, geometry math
2. **skills/** — mental models & invariants (subordinate to handbook)
3. **templates/** — concrete constructs & the authoring surface

Handbook wins over skills; skills win over templates. Code wins over all docs —
found drift? Propose a fix via (internal design history) (agents propose; the owner
disposes).

## Folder map

| Folder | Contents | Start with |
|---|---|---|
| [`handbook/`](handbook/README.md) | DSL grammar + the geometry math (canonical) | `m0-construction-methods.md` |
| [`skills/`](skills/README.md) | DSL/engine mental models | per-task, see its README |
| [`templates/`](templates/README.md) | Template contract, construction, authoring | `philosophy-and-contract.md` |
| `file-formats/` | `.m0` family persistence + the agent-iteration protocol | `m0p-and-custom-field.md` |
| `runtime/` | CLI usage + author-facing render guidance | `cli-usage.md` |

## Doing X → read Y

| Task | Read |
|---|---|
| Generate / mutate an m0 string | `handbook/m0-construction-methods.md` → `handbook/dsl-rules.md` → `skills/m0saic-string-generation.md` |
| Any geometry work (splits, grids, gutters) | `handbook/feasibility-precision-quantization.md` (start here — contract §1) |
| Nesting / composition math | `handbook/composition-arithmetic.md` |
| Overlays, passthroughs, identity | `skills/overlay-semantics.md`, `skills/passthrough-semantics.md`, `skills/identity.md` |
| Build a template | `templates/philosophy-and-contract.md` → `templates/construction-strategy.md` → `templates/geometry-recipes.md` |
| Template perf | `templates/patterns/perf-authoring-rules.md` |
| Data-driven templates | `templates/data-pipeline.md` |
| Read/write `.m0` / `.m0c` / `.m0p` / `.m0v` | `file-formats/m0p-and-custom-field.md` |
| Render via the CLI | `runtime/cli-usage.md` |

## House conventions for docs in this tree

- **Golden-rule register**: rule → evidence → code pointer (`file:line`). No essays.
- **Date volatile claims** ("as of 2026-07-27") and ship a one-line re-verification
  grep alongside anything that can drift. Citation density predicts accuracy — the
  docs that named exact files and constants survived audit; the ones that didn't,
  rotted.
- Code is the source of truth. A doc that contradicts the code is wrong; fix the
  doc (via (internal design history) if you're an agent).
