# `@m0saic/momo-types` — Vocabulary Contract for the AI-Human Work-Session Protocol

This package **is** the canonical vocabulary for how AI agents and humans collaborate on m0saic layouts. When in doubt about which word to use, this file decides — collaborators (people, agents, downstream tooling) that drift into synonyms cause real fragmentation, and adapters between half-matching APIs are the cost. Read this file once; use these nouns everywhere.

## Why a separate package

The vocabulary is expected to grow as the AI layer matures (new categories, new evaluation kinds, future shapes none of us have named yet). Keeping it in its own publishable package — separate from the heavy `@m0saic/momo` runtime — means:

- **Any package can share the shape cheaply.** File-format layers (`@m0saic/dsl-file-formats`), tooling (`wireframe.mjs`), the desktop editor (`apps/mosaic`) — they all take a dep on `@m0saic/momo-types` without pulling in the model wrapper, tool registry, or download lifecycle.
- **Types-only / types-mostly.** Two small pure-function helpers (`gradeFromScore`, `normalizeCandidateContext`) ship alongside the types; everything else is type-only. Zero runtime baggage.
- **The file formats own the wire shapes.** `M0AgentMeta`, `M0AgentResponse`, `M0AgentComment`, the loose `CandidateContext` and the transport helpers (`mintAgentId`, `normalizeAgentProse`…) are defined in `@m0saic/dsl-file-formats` — this package depends on it and re-exports them with the typed `CandidateContext` refinement, so the language repo stays free of the agent protocol and nothing is duplicated.
- **Independent release cadence.** When the protocol churns (it will), `@m0saic/momo-types` can bump versions without dragging the rest of momo along.

The model is consciously chess-inspired (see `./candidate.ts` for the chess.com grade union, taken verbatim) — sessions are games, candidates are positions, evaluations are annotator marks, scoring is the engine eval.

---

## Canonical noun set

| Noun | Meaning | Lives in |
|---|---|---|
| **session** | A chronological directory of candidates exploring one problem. The "game" in the chess analogy. | `session.ts` |
| **candidate** | One `.m0` (or `.m0c`) file inside a session. The "position / move". | `session.ts`, `candidate.ts` |
| **intent** | What the writing party is *trying* to accomplish (per-candidate prose + optional closed-union verb). | `category.ts` |
| **category** | What *class* of layout problem this session is solving. Closed union + `other` escape hatch. | `category.ts` |
| **layout-intent** | The structural kind of a candidate's geometry (grid / comparison / spotlight / …). Picked by the scorer's caller. | `scoring.ts` |
| **grade** | Categorical evaluation of a candidate (chess.com vocab, verbatim). Rank order (strong → weak): `brilliant` ▸ `great` ▸ `best` ▸ `excellent` ▸ `good` ▸ `inaccuracy` ▸ `mistake` ▸ `blunder`. Plus `book` (known canon), `miss` (human-only judgment), `unevaluated`. **Note:** `best` means "engine's top pick" — `brilliant` and `great` rank *above* it. | `candidate.ts` |
| **score** / **breakdown** | The numeric automated quality signal from `scoreLayout`. `breakdown` is the per-metric view. Types here; values + scoring function in `@m0saic/momo/scoring`. | `scoring.ts` |
| **evaluation** | The grade assignment for one candidate — `grade` + optional `breakdown` + provenance. | `candidate.ts` |
| **annotation** | Any structured note attached to a candidate (a `RegionAnnotation`, a comment, a relation). | `region.ts`, `agent/meta.ts` |
| **region** | A labeled sub-area of the geometry, keyed by stableKey. | `region.ts` |
| **relation** | Lineage between candidates (`refines`, `branches-from`, `rejects`, …). | `candidate.ts` |
| **party** | Anyone who can speak in the thread — `human`, `human:<name>`, `agent:<id>`. | `party.ts` |
| **phase** | Tripartite session arc — `scaffolding` / `refining` / `finalizing`. Mosaic analog of chess opening/middlegame/endgame. | `session-summary.ts` |
| **summary** | Per-party + per-phase stats across a session. Renders as the Game Review board on the post-mortem template. | `session-summary.ts` |
| **corpus** | The union of all sessions across all sandboxes — the "book". | (concept; no type) |

---

## Banned synonyms

When tempted to use the left, use the right.

| Don't use | Use instead | Why |
|---|---|---|
| *background* | **context** | The `M0AgentMeta.context` field is the carrier; "background" is the same idea in different syllables. |
| *prompt* | **question** | `M0AgentMeta.question` is the specific ask field; "prompt" is overloaded with LLM-prompt-engineering jargon. |
| *attempt* | **candidate** | A candidate is one file (the position). Calling it an "attempt" loses the chess analogy. |
| *iteration* | **session** OR **candidate** | Pick one — an iteration is *either* the whole session you went through *or* the next candidate you produced. Don't conflate. |
| *rating* / *quality* (numeric) | **score** | `ScoreBreakdown.total` is "score". Use "rating" only for the per-session Elo-style number in `PartySummary.rating`. |
| *grade* | **(only for the categorical thing)** | Grade is `brilliant` / `mistake` / `blunder` — the categorical chess mark. Don't write `grade` when you mean `score`. |

---

## The two orthogonal axes (read carefully)

`LayoutIntent` and `SessionCategory` are the most-confused pair. They are **NOT the same thing**; they live on different axes of the same candidate.

- **`LayoutIntent`** (`../scoring`) — *structural* kind of the layout. `grid`, `comparison`, `spotlight`, `magazine`, `ranked-list`, `free`. Picked by the scorer's caller so `scoreLayout` uses the right weight row.
- **`SessionCategory`** (`./category.ts`) — *kind of exploration* the session is performing. `spacing-alignment`, `hierarchy-emphasis`, `scaffold-from-scratch`, etc. Picked by the human or agent to classify what the iteration is FOR.

### Worked example

A user is iterating on the bar-graph template. They have a working 5-bar grid that feels visually cramped. They open a session to refine it:

- `SessionCategory`: `{ kind: "known", value: "spacing-alignment" }` — the session is exploring how to fix the cramped feeling.
- Each candidate's `layoutIntent`: `"grid"` — the geometry stays a grid throughout; only its gutters and weights vary.

The two axes co-vary in principle (a `spacing-alignment` session usually keeps `layoutIntent` constant across candidates because the geometry is what you're refining), but they're recorded independently because they answer different questions.

---

## Engine eval vs. annotator mark (the chess analogy is load-bearing)

A chess game has BOTH the engine's centipawn score (numeric, machine-computed) AND the annotator's `?!` (categorical, human-applied). They don't replace each other — they're shown side-by-side in any decent game review.

Same here:

- `breakdown.total` (number, 0..1) — the **engine eval**. Cheap, deterministic, available on any candidate.
- `evaluation.grade` (one of `brilliant` / `great` / … / `blunder`) — the **annotator mark**. Canonical; the human's selected answer.

When they disagree, the human wins — and the disagreement itself is interesting. The post-mortem template surfaces those moments because they're exactly where learning lives.

`gradeFromScore()` in `./candidate.ts` provides one auto-derivation path (use it for pre-fills); the human can always overwrite. **The automated grader caps at `best`** — it never returns `brilliant` or `great`, because those require insight (sacrifice, critical-moment recognition) an automated metric can't see. Same for `book` and `miss`. Those four grades are reserved for humans to award when they spot something the score didn't.

---

## Shared, not mirrored

This package's types are the **single source of truth**. `@m0saic/dsl-file-formats` and `@m0saic/momo` both take a workspace dep on `@m0saic/momo-types` and import the shapes directly — no parallel declarations, no CI lint to keep mirrors in sync.

(One holdover: `M0AgentMeta` itself remains mirrored between `@m0saic/momo` and `@m0saic/dsl-file-formats` — that struct predates this package and is stable enough that collapsing it isn't worth the churn.)

---

## Coexists with: scoring values in `@m0saic/momo/scoring`

Scoring is **split** across the two packages:

- **Types** (`ScoreBreakdown`, `LayoutIntent`, `ScoreInput`, `ScoreComponent`, `ScoreComponentKey`) live here in `./scoring.ts`.
- **Values + logic** (`WEIGHTS`, `THRESHOLDS`, the `scoreLayout` function, quality curves) live in `@m0saic/momo/scoring`.

`@m0saic/momo`'s `WEIGHTS` uses `satisfies Record<LayoutIntent, WeightTuple>` so the runtime constant and the type union stay in lockstep — adding a new intent requires editing both, with the type-check enforcing the consistency.

---

## Open: starter category enum

The nine `KnownCategory` entries in `./category.ts` are the Plan-agent's best guess. They'll get refined once the user has driven enough real sessions to know which buckets are over/under-represented. Promote new patterns from `{ kind: "other", label: "X" }` to first-class after a label recurs ~3 times across sessions.
