# `.m0` iteration protocol — one file, one prompt

## Mental model

A `.m0` / `.m0c` / `.m0p` file is the **atomic unit** of an iteration: ONE geometry, ONE
question from the writing party, ONE response from the reading party.

**Iteration produces NEW files.** The conversation lives in the *directory*, not inside
any single file. Think of a chess endgame book — each file is a position plus the
discussion that graded it, and the next move sits in the next file over.

Two payoffs:

- **Corpus value.** Over time the directory becomes a graded pattern bank: future agents
  browse `(question, geometry, response)` triples and learn what actually worked.
- **Context survival.** Agent context windows reset; the directory doesn't. Stepping
  back through an old session's files reconstructs the whole design discussion, however
  many resets ago it happened.

---

## Canonical types

**`@m0saic/momo-types` (`src/agent.ts`) is the canonical home** — one lightweight,
dependency-free package for the agent layer, so `@m0saic/dsl-file-formats`, the desktop
app, and momo's runtime all point at the same upstream instead of maintaining
structural mirrors.

> `@m0saic/momo` (`src/agent/meta.ts`) is now a **re-export shim** kept for
> back-compat. Import from `momo-types`; momo remains the heavier runtime (agent loop,
> prompt building) layered on the shared vocabulary. Docs or code still treating
> `momo/src/agent/meta.ts` as the definition site are stale.

| Field | Audience | Shape |
|---|---|---|
| `note` | reading party (prose) | string |
| `question` | reading party (the ask) | string |
| `regions` | downstream router | `stableKey → label` |
| `context` | downstream router | unknown (JSON) |
| `response.body` | originating party | string |
| `response.from` | provenance / routing | `human…` / `agent:<role>` |
| `response.at` | provenance | ISO 8601 |
| `comments[]` | human review / provenance | `M0AgentComment[]` |

Carried as `# m0agent:<key>: <json-or-prose>` headers in `.m0`, and under the top-level
`agent` JSON slot in `.m0c` / `.m0p`.

Prose fields (`note`, `question`, `response.body`, `comments[].body`) render as
**markdown** in the Momo FILE pane, and the JSON formats preserve newlines — use short
lists and tables. The line-based `.m0` format flattens prose to one line, so reach for
`.m0c` when the question needs real structure.

---

## The shape: Reddit-style threading

Each file is one post:

| Slot | Role |
|---|---|
| `note` / `question` / `regions` / `context` | the OP's body |
| `response` | **the** answer — canonical |
| `comments[]` | the thread below — orbiting discussion |

**`response` is single-valued on purpose.** OP + response together are the canonical
record of one design exchange. Iterating the geometry produces a **new file** (a new
post), never a second response on this one — because the geometry itself is what
changed, and the protocol mirrors that.

**`comments[]` is explicitly non-canonical.** Append-only by convention; anyone (human
or agent) may add one to share context, raise a concern, link a related candidate, or
record a side observation that doesn't merit its own file. Flat array — **no nested
replies** — ordered chronologically by `at`, falling back to insertion order.

> Future agents **route on `response`**. Comments are for human review and provenance.
> Don't put a verdict in a comment and expect tooling to find it. Mosaic renders
> comments as URL-hash anchors (`#c-<id>`), so other files and external systems can link
> a specific post.

This is the one place the "single answer" model bends, and it bends deliberately: the
thread absorbs discussion that would otherwise either pollute the response slot or force
a spurious new file.

---

## The loop

1. Writing party generates `candidate-N.m0c`, hands over the path.
2. Reading party opens it — File Details jumps to the agent annotations; `regions`
   hover-highlight in the wireframe.
3. Reader writes a response, saves. **The same file is rewritten in place.**
4. Writing party reads the response and generates `candidate-N+1` with new geometry.
   **The old file stays, frozen at its graded state.**
5. Anyone steps through the directory later to reconstruct the discussion.

⚠️ **Never mutate a file that already carries a response.** The verdict is bound to the
exact geometry it was given; editing the geometry underneath it silently invalidates the
record and collapses the iteration trail.

---

## Party-agnostic by design

`response.from` discriminates the responder — `"human"`, `"human:quentin"`,
`"agent:claude"`, `"agent:brand-x-stylist"`. Tooling routes on the `human:` / `agent:`
prefix. One shape covers human↔agent, agent↔agent, and future multi-agent review
workflows (a brand-trained stylist, a data-viz reviewer, a music-video sensibility
model).

---

## Cross-references

- **https://github.com/m0saic-project/m0saic-sandbox/blob/main/packages/sandbox/agent.md** — the full operational protocol: file naming,
  `-a`/`-b` forking for parallel sessions, when to start a new session, anti-patterns,
  and the `m0saic open` handoff. **Read it before authoring or iterating a candidate.**
- `tools/wireframe.mjs` — single-shot wireframe helper for minting a candidate image.
- `file-formats/m0p-and-custom-field.md` — the `agent` block coexists with `custom.*`:
  `custom` is per-template payload, `agent` is per-iteration metadata. Different
  lifetimes, different owners.
