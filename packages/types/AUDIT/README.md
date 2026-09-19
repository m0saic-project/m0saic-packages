# `@m0saic/types` Connectivity Matrix

The Phase 2 audit artifact. Every type, every field, every variant
declared in `@m0saic/types` gets a row. Each row says: does the
engine act on this knob today? Is there a test that proves it? If
not, what owns the wiring? If it's pruning bait, name it.

The matrix is the source of truth for the Phase 3 TODO list and the
exit-gate for "we don't ship knobs nobody uses."

---

## Where things live

```
packages/types/AUDIT/
├── README.md               # this file — convention + schema
├── matrix.md               # top-level index across concepts
├── coverage-map.md         # source × operator visual cross product
├── source.md               # MosaicSource enumeration
├── document.md             # MosaicDocument + MosaicDocumentPipeline
├── output.md               # MosaicOutput + format/audio/color/container
├── template.md             # MosaicTemplate generics
├── engine-context.md       # MosaicEngineContext
├── identifiers.md          # branded id tiers
├── source-effects.md       # per-source operators (masks/borders/strokes)
├── (one .md per concept folder in packages/types/src/)
└── coverage.json           # eventual machine-readable view
                            # (generated; check it in for diffability)
```

One file per concept folder in `packages/types/src/`. The top-level
`matrix.md` is the cross-concept index — counts by status, links to
each detail file, surfaces pruning candidates and test-gap totals.

---

## Codename convention

Every audit row gets a stable, greppable identifier. Two namespaces:

### `T:` — type-system identity

Format: `T:<concept>.<path>`

Path syntax:
- `.<field>` — a struct field
- `=<value>` — pin a discriminator to a value (selects a union variant)
- `[]` — array element or record value indexing

| Codename | Refers to |
|---|---|
| `T:source` | `MosaicSource` (the whole union) |
| `T:source.type=media` | the `media` variant of `MosaicSource` |
| `T:source.type=media.assetId` | the `assetId` field on `MosaicMediaSource` |
| `T:source.type=media.playback.clipDurationMs` | nested field |
| `T:source.type=text.layers[].content.kind=literal` | a nested variant tag |
| `T:source.type=text.layers[].content.kind=dictionary` | sibling variant |
| `T:document.outputs[].format.pixelFormat` | record-keyed nested field |

A `T:` codename is **stable across redesigns of identical shape**.
Renaming a field invalidates its codename — that's intentional; the
matrix surfaces breakage and forces a conscious update.

### `V:` — visual cross-product cells

Format: `V:<source-variant>×<operator>[=<value>]`

Tracks the visual-test mandate (every render-path knob has a pixel
golden in `packages/core/__tests__/`).

| Codename | Refers to |
|---|---|
| `V:source.media×borderRadius` | media source × borderRadius operator |
| `V:source.media×borderRadius=0.18` | a specific value cell |
| `V:source.media×mask=alpha-image` | media × alpha-image mask |
| `V:source.text×renderMode=video` | text source in video render mode |
| `V:source.lavfi×color=red` | lavfi source with a specific color |
| `V:composition×overlay` | `{}` overlay region composition |
| `V:composition×null-slot` | null-slot DSL feature |
| `V:composition×ref-mirror` | `MosaicRefSource` pixel mirror |

The full enumerated cross product lives in `coverage-map.md`.

---

## Matrix row schema

Every concept-level table uses the same column set:

| Column | Required | Values |
|---|---|---|
| **Codename** | yes | `T:...` or `V:...` |
| **TS path** | yes | `MosaicMediaSource.assetId` (the actual symbol) |
| **Status** | yes | `wired` / `needs-wiring` / `spec-only` / `deferred` / `pruning-candidate` |
| **Visual** | yes | `pixel-affecting` / `non-visual` / `n/a` |
| **Sub-epic** | if needs-wiring | `3a`–`3i` (per Phase 3 table in `epic.md`) |
| **Unit test** | if wired | file:line or `// covers:` ref |
| **Visual test** | if pixel-affecting | file:line of pixel golden |
| **Notes** | optional | rationale, ties, deprecation reasons |

### Status values

- **`wired`** — Engine produces or consumes correctly today, and a test
  proves it. (If no test exists yet, this is `wired` + test-gap, which
  the matrix flags separately.)
- **`needs-wiring`** — Type declared; engine ignores. Maps to a Phase 3
  sub-epic. Reactivated once the sub-epic lands.
- **`spec-only`** — Editor / UI / tooling concern. The engine has no
  role and never will (e.g. `MosaicSourceEditorMeta.binding`).
  No engine test required; UI tests live in `apps/mosaic/web`.
- **`deferred`** — Reserved for a future major version with an explicit
  reason. Not in the current Phase 3 plan.
- **`pruning-candidate`** — Declared during the redesign but nothing
  actually needs it. Resolves to either "promote to one of the above"
  or "delete in a follow-up PR." Surface aggressively; killing dead
  types is the whole point of the audit.

### Visual values

- **`pixel-affecting`** — The field ends up in an ffmpeg invocation
  and changes the rendered pixels. Subject to the visual-test mandate.
- **`non-visual`** — The field doesn't affect pixels. Examples: validators,
  diagnostic codes, tier annotations, JSDoc-only fields, branded id
  shapes, metadata.
- **`n/a`** — Not yet wired; cannot be classified until Phase 3 wiring
  reveals whether it touches the render path.

---

## Test-coverage marker convention

A test file claims coverage of one or more matrix codenames via a
comment marker:

```ts
// covers: T:source.type=media.assetId
test("media source assetId resolves through manifest", () => { ... });

// covers: V:source.media×borderRadius=0.18, V:source.media×borderRadius=0
test("borderRadius rounds the rendered tile", () => { ... });

// covers: T:source.type=text.layers[].content.kind=literal
test("literal text content renders verbatim", () => { ... });
```

Conventions:
- One `// covers:` line per test (preferred) or per `describe` block.
- Comma-separated list of codenames if a single test exercises multiple.
- Codenames must match the matrix verbatim — no spaces, no shorthand.
- The marker lives in the comment immediately above the relevant
  `test(...)` / `it(...)` / `describe(...)` call.

A future `bin/audit-coverage.ts` script:
1. Parses all `packages/types/AUDIT/*.md` for matrix rows.
2. Greps all `**/*.test.{ts,tsx,js,spec.ts}` for `// covers: ...`.
3. Reconciles: matrix rows without a covering test → gaps; covers
   markers without a matching matrix row → stale references.

Until that script exists, the matrix is human-reconciled. The
convention is locked now so test files written today are forward-
compatible with the script.

---

## How to add a row

1. **Find the right concept file.** `packages/types/src/<concept>/`
   maps 1:1 to `AUDIT/<concept>.md`. If the concept doesn't have a
   file yet, create one from the template at the bottom of `matrix.md`.

2. **Assign the codename.** Use the conventions above. For deeply
   nested unions, walk the path explicitly — every variant gets its
   own row, every field on each variant gets its own row.

3. **Pick the status honestly.** A field that "should work" but has
   no test is `wired` + test-gap, not just `wired`. The audit is
   only useful if it doesn't lie about coverage.

4. **Note the visual axis.** If the field ends up in an ffmpeg
   invocation, mark it `pixel-affecting` and add a `V:` row to
   `coverage-map.md` (or expand an existing cell with a new value).

5. **Cross-reference.** Phase 3 sub-epic from `epic.md`'s table.
   Test references as `file:line` or a `// covers:` marker query.

---

## Anti-patterns

- **Don't merge rows.** One row per field, even if two fields are
  always wired together. Granularity makes pruning visible.
- **Don't write summary-only rows for unions.** The union has a row,
  AND each variant has a row, AND each variant's fields have rows.
  A `MosaicSource` row alone is not coverage; it doesn't tell you
  whether `lavfi` was tested.
- **Don't soft-skip pruning candidates.** If something genuinely
  isn't needed, mark it `pruning-candidate` with a rationale.
  Deletion is a separate PR; the audit just nominates.
- **Don't backfill `// covers:` markers without verifying.** A
  comment that names a codename the test doesn't actually exercise
  is worse than no marker at all (creates false coverage).

---

## Quick start (for the agent / human picking this up mid-flight)

```
1. Read packages/types/AUDIT/matrix.md → see what's left.
2. Pick an unfilled concept from the index.
3. Open packages/types/src/<concept>/<concept>.ts and walk it.
4. Populate AUDIT/<concept>.md row-by-row using the schema above.
5. As you go, seed `// covers:` markers in the corresponding
   packages/types/src/<concept>/<concept>.test.ts.
6. Update matrix.md counts when done with the concept.
```

The audit is open-ended; expect this to span multiple sessions. The
codename convention is the contract — once a codename is published
in `AUDIT/`, downstream tests can cite it and the script can
reconcile.
