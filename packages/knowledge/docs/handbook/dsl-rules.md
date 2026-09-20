# m0 DSL — Grammar, Semantics, and Validation

The exact surface grammar, semantic rules, and validation invariants for the m0
DSL — the deterministic spatial-layout language that powers m0saic. Any system
that generates, transforms, or mutates m0 strings must follow this document and
must prove correctness with the canonical validator. Visual inspection is never
sufficient.

The DSL is strict, deterministic, count-exact, and validator-authoritative.
Posture (as of 2026-07-27): **frozen at v1.1.0**
([https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/package.json](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/package.json); verify there).
Grammar changes are explicitly avoided; the 1.1.0 minor carried the 2026-06-03
overlay-body relaxation (`ZERO_SOURCE_OVERLAY` no longer raised) and the
public-API prune.

> **Source of truth:** [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src).
> Validator: [`validate/m0StringValidator.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts);
> error specs: [`errors/errors.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/errors/errors.ts);
> warning specs: [`warnings/warnings.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/warnings/warnings.ts);
> parsers: [`parse/m0StringParser.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts);
> types: [`types.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/types.ts).

## Canonicalization (always applied first)

Before validation, the reference validator canonicalizes:

1. Remove all whitespace
2. Replace every `F` with `1`
3. Replace every `>` with `0`

All correctness rules apply **after canonicalization**. Generators should emit
canonical form directly. `toCanonicalM0String` / `toPrettyM0String` are exported
from `@m0saic/dsl`
([`format/m0StringFormat.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/format/m0StringFormat.ts)).

### Compact form (transport only — outside the grammar)

A third form, **compact**, exists for length-constrained transports: pretty form
with runs of `>` or `-` folded into `N>` / `N-` (`6[1,0,0,0,0,1]` → `6[F,4>F]`).
Compact is **outside the grammar** — a folded string fails `isValidM0String` by
construction, and nothing in the parser, validator, or file formats accepts it.
Always unfold before parse, validate, or persist; files stay canonical.
`toCompactM0String` / `fromCompactM0String` are exported from `@m0saic/dsl`
([`format/m0StringCompact.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/format/m0StringCompact.ts)),
and the round-trip law is
`fromCompactM0String(toCompactM0String(x)) === toCanonicalM0String(x)`.

The fold is unambiguous because NUMBER may only be followed by `(` or `[`
(invariant 2 under "Grammar invariants", below), so a digit adjacent to `>` or
`-` is free namespace no valid m0 can occupy. That
argument is also why the fold is only expressible over *pretty* tokens: it turns
on `>` and `-` living outside the digit alphabet. `0` is itself a digit and
appears inside ordinary split counts (`10(`, `100(`), so a canonical marker `N0`
would be built from the same characters counts are, with nothing delimiting the
run count from the digits after it — no free namespace, and no left-to-right way
to find the marker's edges.

`fromCompactM0String` is meant to be fed by untrusted input (share URLs are
forgeable) and bounds expansion before allocating: it throws on a zero count, a
non-safe-integer count, or a total past `MAX_COMPACT_EXPANSION` (10M chars — the
same ceiling `perf/large-dsl-ceiling.break.test.ts` treats as supported).

Consumers today are the layout share URL
(the Mosaic Desktop / Web app source (not published): compact on build, expand on parse)
and the editor's compact token view, which renders the same codec so the string
on screen matches the one a link carries. Share links are self-contained by
construction — there is no server-side share store — because compact fits ~98.8%
of layouts under the URL limit and the remainder exports a `.m0` file.

Compact was evaluated and **rejected** as a storage format — gzip already beats
the fold on stored bytes, and the file-format layers canonicalize on read AND
write.

## Allowed characters (after canonicalization)

Digits `0–9`, classifiers `( ) [ ]`, overlays `{ }`, separator `,`, null tile
`-`. No letters, no spaces, no other symbols.

## Token types

The DSL is parsed as a strict token stream:

| Token | Form | Meaning |
|---|---|---|
| PRIMITIVE | `0` | zero-frame (donates space forward) |
| PRIMITIVE | `-` | null-render tile (hole) |
| PRIMITIVEONE | `1` | rendered tile |
| NUMBER | digits forming an integer (`2`, `10`, `154`) | split count; `0` is NOT a NUMBER token |
| CLASSIFIEROPEN | `(` / `[` | column split (horizontal) / row split (vertical) |
| CLASSIFIERCLOSE | `)` / `]` | closes a split |
| OBJECTOPEN / OBJECTCLOSE | `{` / `}` | overlay object |
| COMMA | `,` | slot separator |

## Root form

A m0 string must resolve to exactly one root node. Valid root shapes:

- `1` · `1{...}`
- `N(...)` · `N[...]` · `N(...){...}` · `N[...]{...}` (N ≥ 2)

The root may carry an overlay. There is no implicit wrapping — the DSL
represents a single explicit tree. Invalid roots: `0`, `-` (both
`INVALID_EMPTY`), `{1}`, `1{1}{1}` (`OVERLAY_CHAIN`).

## Node forms

### Primitives

`1` (rendered tile), `0` (zero-frame), `-` (null tile). Each may carry one
overlay: `1{1}`, `0{1}`, `-{1}`. Overlays never appear standalone — they always
attach to a primitive or container.

### Numeric containers (splits)

`N( ... )` — column split; `N[ ... ]` — row split.

- **N ≥ 2.** A 1-way split is rejected: `1(` / `1[` →
  `ILLEGAL_ONE_SPLIT` ("Use a count >= 2 for splits",
  [`m0StringValidator.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts) ~L793).
- **Count-exact:** the container must contain **exactly N child slots**. There
  is no compression *in the grammar*; all slots are explicit. (The compact
  transport form folds runs — see "Compact form" under Canonicalization,
  above — but it is not valid m0 and never reaches the validator.)
- Commas are separators only; slot order is semantically meaningful and
  preserved; slots may be primitives, nested containers, and may carry overlays.

Valid: `2(1,1)` · `3[1,0,1]` · `4(0,0,0,1)` · `2(1{1},1)`
Invalid: `2(1)` · `3(1,1)` · `2(1,1,1)` (all `TOKEN_COUNT`) · `3()` (`INVALID_EMPTY`) · `1(1)` (`ILLEGAL_ONE_SPLIT`)

## Overlay objects `{}`

An overlay may follow a primitive or a numeric container: `node{ <valid m0> }`.

- Overlay contents are validated recursively.
- The overlay subtree renders within the parent's rectangle: origin = parent
  rect origin, size = parent rect size. Overlays never escape their parent rect.
- Overlays may themselves contain splits and further overlays: `2(1,1){3[1,0,1]}`,
  `1{2[3(1,1,1),3(1,1,1)]}`.
- Chained overlays are illegal: `1{1}{1}` → `OVERLAY_CHAIN` (nest instead:
  `1{1{1}}`).

## Zero-frame (`0`) semantics

`0` consumes a split slot but produces no rendered output. Consecutive `0`s form
a **donation run**: each `0` grows the merged region; the next claimant (`1` or
`-`) absorbs all donated space. `3(0,0,1)` → the `1` spans three slots.

### Overlays on `0`

> An overlay attached to `0` applies to the merged region accumulated **at the
> moment the overlay appears**. It does not retroactively resize when later
> tokens grow the region.

Worked example — `4(0,0{2(1,1)},0,1)`:

1. First `0` — merged region = 1 slot
2. `0{2(1,1)}` — merged region = 2 slots; overlay canvas = those 2 slots
3. Third `0` — merged region = 3 slots
4. `1` — absorbs all 4 slots; the overlay stays sized to the 2-slot region

Result: base tile spans full width; the overlay occupies the left half only.
With multiple zero overlays (`5(0{1},0{1},0,0,1)`) each overlay is independent
and anchored at its creation-time region size. In short: `0` = grow region;
`0{...}` = grow region AND paint an overlay over the current region; the
claimant finalizes the region but never resizes earlier overlays.

### Overlay paint order (deferred painting)

When multiple overlays exist at the same level, paint order is **not**
left-to-right by source position. The engine defers zero-overlay painting until
all sibling overlays are collected, then paints sorted by:

1. **Area, descending** — the largest overlay paints first (bottom of the
   overlay stack).
2. **Stable rootId, ascending** — deterministic tie-break at identical area.

Smaller overlays therefore paint on top of larger ones. Source:
[`parse/sortDeferredOverlays.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/sortDeferredOverlays.ts),
called from [`parse/m0StringParser.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts).
Generators must trust the engine's ordering — do not try to encode z-order via
source position.

## Null tile (`-`) semantics

Consumes space, renders nothing, does **not** donate space forward, may carry
overlays. Bare `-` as the root is invalid (`INVALID_EMPTY`).

## Grammar invariants (hard rules)

1. First token must be NUMBER or `1`
2. NUMBER must be immediately followed by `(` or `[`
3. All enclosures `() [] {}` must be balanced and correctly nested
4. Every numeric container must contain exactly N child slots (N ≥ 2)
5. No empty splits (`N()` / `N[]`)
6. Token transitions must obey the validator's state rules
7. Every donation run must resolve to a claimant
8. A valid string must produce at least one renderable frame at the root
9. Strings that produce zero-size frames at execution resolution fail at parse
   (`SPLIT_EXCEEDS_AXIS`, below)

## Passthrough-to-nothing

The validator rejects any split whose **last child** begins with passthrough
`0` — a trailing passthrough has no next tile to donate to. An overlay on the
`0` does not change this: the donation still goes nowhere. The rule applies
recursively inside nested classifiers AND overlay bodies, and also covers the
all-donors case (`2(0,0)` — structurally balanced, but no claimant exists).

Invalid: `2(1,0)` · `2(1,0{1})` · `3(1,1,0{1})` · `2(0,0)`
Valid: `2(0,1)` · `2(0{1},1)` · `3(1,0,1)`

Error code: `PASSTHROUGH_TO_NOTHING`.

## No-sources

The validator rejects any layout containing **no leaf `1` anywhere** — all-`-`
/ all-`0` layouts produce no renderable output.

Invalid: `2(-,-)` · `3[-,-,-]` — Valid: `2(1,-)` · `2(-,-){1}` (a source in an
overlay counts).

Error code: `NO_SOURCES`.

## Overlay body rules

An overlay body `{...}` must contribute **at least one node** to the graph, but
those nodes do **not** have to paint. This lets overlays act as logical-owner
anchors (carrying `stableKey` + label without contributing rendered tiles).

Rejected (`INVALID_EMPTY`):

- `1{}` — empty body, no nodes at all
- `1{0}` — bare passthrough at the overlay root with nothing to donate to
- `1{-{}}` — recursive: the inner `{}` fails the same rule (deepest offender reported)

Accepted — at least one node, even if nothing paints:

- `1{-}` — single null node; valid logical-owner anchor
- `1{2(-,-)}` — all-null split; structural nodes, no paint
- `1{2(0,-)}` — passthrough with a sibling to donate to
- `2(-{F},-{F})` · `1{-{2(0,-)}}` · `1{2[1,1]{1}}`

The whole-string `NO_SOURCES` check still enforces that the ROOT layout paints
at least one source tile — the relaxation is per-overlay, so nested bodies can
be paint-free but the root must paint something. The legacy `ZERO_SOURCE_OVERLAY`
code is **no longer raised** (see the error table below).

## Runtime feasibility guard: `SPLIT_EXCEEDS_AXIS`

`SPLIT_EXCEEDS_AXIS` is NOT a grammar error and is **never emitted by the
validator** — `isValidM0String` / `validateM0String` operate purely on the
token stream and have no notion of pixel dimensions. A string that will fail at
runtime due to infeasibility still validates `ok: true`.

It is emitted only by `parseM0StringComplete(m0, w, h)` after concrete frame
geometry is computed: every produced frame is checked for
`width > 0 && height > 0`, and any zero-size frame (or an empty frame set)
returns `{ ok: false, error: SPLIT_EXCEEDS_AXIS }`
([`m0StringParser.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts) ~L1840).
The convenience wrappers (`parseM0StringToLogicalFrames`,
`parseM0StringToFullGraph`) delegate to `parseM0StringComplete` and collapse any
failure to `[]` — they do not surface the error object.

To preflight infeasibility **before** parse, use `computeFeasibility` (next
section). This is the recommended generator-side check.

## Feasibility, precision, quantization → the geometry doc

Everything about whether a valid string **renders** at given dims, **looks
right**, and stays **balanced** — `computeFeasibility`, the precision floor,
quantization spread, outside-in remainder distribution, GCD collapse — lives in
[`feasibility-precision-quantization.md`](feasibility-precision-quantization.md)
(canonical). Quick reference: `computeFeasibility(m0)` → `{ minWidthPx,
minHeightPx }` (`@m0saic/dsl`,
[`feasibility/computeFeasibility.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/feasibility/computeFeasibility.ts));
render at dims ≥ that floor or the parse fails with `SPLIT_EXCEEDS_AXIS`.

## Validation API

A string is valid **only if it passes the canonical validator**. Exported from
`@m0saic/dsl`
([`validate/m0StringValidator.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts)):

- `isValidM0String(s): boolean` — boolean shortcut.
- `validateM0String(s): { ok: true } | { ok: false, error }` — structured
  result. **`error` is singular** — one `M0ValidationError` (`code`, `kind`,
  `message`, `span`, `position`, optional `details`); there is no `errors`
  array.

The validator runs in O(n) using a structural index; performance is consistent
across layout depth. Public error types (`M0ValidationErrorKind`,
`M0ValidationErrorCode`, `M0ValidationError`, `M0ValidationResult`) are
exported; the `M0_VALIDATION_ERROR_SPECS` table and `makeValidationError` are
internal ([`errors/index.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/errors/index.ts)).

## Error codes (complete, as of 2026-07-27)

Every code declares a `kind` in
[`errors/errors.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/errors/errors.ts) —
`SYNTAX` (the string is not well-formed m0), `ANTIPATTERN` (well-formed DSL the
engine rejects by policy), `SEMANTIC` (reserved). A consumer uses `kind` to
decide grammar-bug vs policy-reject. Re-verify with:
`grep -n "kind:" https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/errors/errors.ts.

| Code | Kind | Trigger |
|---|---|---|
| `OVERLAY_CHAIN` | SYNTAX | chained overlays (`1{1}{1}`) — nest instead |
| `INVALID_CHAR` | SYNTAX | character outside the allowed set |
| `UNBALANCED` | SYNTAX | unbalanced `()` / `[]` / `{}` |
| `TOKEN_RULE` | SYNTAX | illegal token transition |
| `TOKEN_COUNT` | SYNTAX | container child count ≠ N |
| `ILLEGAL_ONE_SPLIT` | SYNTAX | `1(` / `1[` — split count must be ≥ 2 |
| `INVALID_EMPTY` | SYNTAX | degenerate input: empty string, bare `0` / `-` root, `N()`, empty overlay body `{}`, bare-passthrough body `{0}` |
| `PASSTHROUGH_TO_NOTHING` | ANTIPATTERN | trailing `0` in any split (recursive; an overlay on the `0` doesn't save it) |
| `NO_SOURCES` | ANTIPATTERN | no leaf `1` anywhere in the string |
| `SPLIT_EXCEEDS_AXIS` | ANTIPATTERN | parser-only: a split produced a 0-size frame at the given w×h |
| `ZERO_SOURCE_OVERLAY` | SEMANTIC | **reserved, never emitted since 2026-06-03** — the overlay-body relaxation dropped it (validator comment at [`m0StringValidator.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/validate/m0StringValidator.ts) ~L485: "The ZERO_SOURCE_OVERLAY rule above was dropped"); paint-free bodies now validate, `INVALID_EMPTY` covers the degenerate cases |

## Warnings

Warnings are a **parse-time** surface, separate from validation errors — they
flag legal-but-suspect layouts without failing them.

- `parseM0StringComplete(input, width, height, opts?)` returns `ParseM0Result`:
  `{ ok: true, ir, precision, warnings }` or
  `{ ok: false, error, precision, warnings }` — `precision` and `warnings` are
  **always present** regardless of `ok`.
- One warning code exists: `PRECISION_EXCEEDS_NORM` — emitted when the string's
  `maxSplitAny` exceeds `opts.precisionNorm` (**default 100**;
  [`m0StringParser.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts) ~L1814).
  Raise the norm deliberately for intentionally fine layouts.
- Specs live in `M0_WARNING_SPECS`
  ([`warnings/warnings.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/warnings/warnings.ts));
  the spec table and `makeWarning` are internal — the public surface is the
  `M0Warning` / `M0WarningCode` types (exported from
  [`types.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/types.ts)) and the `warnings` array on
  parse results.

Note `computePrecisionFromString` is an **internal** dsl helper, not public API
(barrel comment in [`parse/index.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/index.ts));
for precision metrics use `getComplexityMetricsFast(m0).precision` — see
[`dsl-complexity.md`](dsl-complexity.md).

## Rules for generators

1. **Emit canonical form** (`1` not `F`, `0` not `>`, no whitespace).
2. **Build token arrays first; count child slots mechanically; assert the count
   equals N.** Never guess counts.
3. **Validate every string** with `isValidM0String` / `validateM0String` before
   use. If validation fails, the string is invalid — regardless of intent.
4. **Preflight feasibility when render dims are known:** refuse to emit when
   `targetWidth < f.minWidthPx || targetHeight < f.minHeightPx` for
   `f = computeFeasibility(m0)`.
5. **Watch the warning surface:** a `PRECISION_EXCEEDS_NORM` on parse means the
   layout is highly granular — expensive, size-sensitive, hard to reason about.
6. If correctness cannot be proven, do not emit.

## Known limitations

**Unbounded nesting depth.** Neither the grammar nor the implementation caps
nesting depth. The parser uses an iterative explicit-stack strategy
(`parseInternal` in
[`parse/m0StringParser.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts)),
not native recursion, so depths beyond 2000 work in practice; inputs are bounded
only by heap. There is no `DEPTH_EXCEEDED` error code. Generators emitting
machine-produced layouts should self-impose a depth cap if memory
predictability matters.
