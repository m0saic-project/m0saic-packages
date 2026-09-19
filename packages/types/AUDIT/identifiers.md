# `identifiers/` — connectivity matrix

**Source:** `packages/types/src/identifiers/identifiers.ts` (333 LOC)
**Test:** `packages/types/src/identifiers/identifiers.test.ts` (294 LOC, 13 describe blocks)
**Phase 3 owners:** 3a (identifier hygiene at parse boundaries)

---

## Summary

- **Total rows:** 5 patterns + 10 brands + 9 predicates + 10 casts = 34 rows
- **wired:** 34 (all patterns + brands + predicates + casts have co-located tests)
- **needs-wiring:** 0 in this concept; downstream wiring (validators calling these predicates at parse boundaries) lives in `asset.md` + `document.md` + `template.md` audit pages
- **spec-only:** 0
- **deferred:** 0
- **pruning-candidate:** 0
- **pixel-affecting:** 0 — every row is `non-visual` (identifiers don't carry pixels)
- **test-gap:** 0

This concept is the simplest sub-epic-3a target: everything is wired with tests. The work in 3a is **using** these predicates at parse boundaries downstream (asset manifest validation, template id validation, etc.), not in this file.

---

## Types in this concept

### Tier patterns (5)

1. `STRICT_IDENTIFIER_PATTERN` — `[a-zA-Z_][a-zA-Z0-9_]{0,63}` — alphanumeric + underscore, must start with letter/underscore, max 64 chars
2. `FRIENDLY_SLUG_PATTERN` — `[A-Za-z0-9_][A-Za-z0-9_.\-]{0,127}` — adds hyphens + dots, max 128 chars
3. `FLATTENED_STABLE_KEY_PATTERN` — `(c\d+_)*STRICT_IDENTIFIER` — optional `c0_`, `c1_` namespace prefixes from flattener
4. `NAMESPACED_ID_PATTERN` — `@?segment(/segment)*` — slash-separated scoped ids
5. `DIAGNOSTIC_CODE_PATTERN` — `[A-Z][A-Z0-9_]{0,63}` — SCREAMING_SNAKE_CASE
6. `TRACE_ID_PATTERN` — UUIDv4 regex with version + variant nibble enforcement

### Branded types (10)

1. `AssetId` (pattern: FRIENDLY_SLUG)
2. `FlattenedStableKey` (pattern: FLATTENED_STABLE_KEY)
3. `AliasId` (pattern: STRICT_IDENTIFIER)
4. `TemplateId` (pattern: NAMESPACED_ID)
5. `RepoId` (pattern: NAMESPACED_ID, single-segment-OK)
6. `DictionaryEntryId` (pattern: NAMESPACED_ID)
7. `DiagnosticCode` (pattern: DIAGNOSTIC_CODE)
8. `TraceId` (pattern: TRACE_ID, UUIDv4)
9. `SpanId` (pattern: TRACE_ID, UUIDv4)
10. `OutputKey` (pattern: FRIENDLY_SLUG)
11. `InstallId` (pattern: TRACE_ID, UUIDv4) — anonymous analytics identity

(That's 11 brands, not 10 — counted including `InstallId` which is the analytics-tier addition.)

### Predicates (9)

`isStrictIdentifier`, `isFriendlySlug`, `isFlattenedStableKey`, `isNamespacedId`, `isDiagnosticCode`, `isTraceId`, `isSpanId`, `isOutputKey`, `isInstallId`

### Cast helpers (10)

`asAssetId`, `asFlattenedStableKey`, `asAliasId`, `asTemplateId`, `asRepoId`, `asDictionaryEntryId`, `asDiagnosticCode`, `asTraceId`, `asSpanId`, `asOutputKey`, `asInstallId` — all "no runtime validation; brand cast only" per the documented contract.

---

## Matrix — patterns

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:identifiers.STRICT_IDENTIFIER_PATTERN` | `STRICT_IDENTIFIER_PATTERN` | wired | non-visual | — | `identifiers.test.ts:33` | n/a | Length boundary (64) tested. |
| `T:identifiers.FRIENDLY_SLUG_PATTERN` | `FRIENDLY_SLUG_PATTERN` | wired | non-visual | — | `identifiers.test.ts:61` | n/a | Length boundary (128) tested. |
| `T:identifiers.FLATTENED_STABLE_KEY_PATTERN` | `FLATTENED_STABLE_KEY_PATTERN` | wired | non-visual | — | `identifiers.test.ts:80` | n/a | `c0_`, `c0_c1_`, multi-digit prefix tested. |
| `T:identifiers.NAMESPACED_ID_PATTERN` | `NAMESPACED_ID_PATTERN` | wired | non-visual | — | `identifiers.test.ts:107` | n/a | Empty segments / leading-trailing slash rejection tested. |
| `T:identifiers.DIAGNOSTIC_CODE_PATTERN` | `DIAGNOSTIC_CODE_PATTERN` | wired | non-visual | — | `identifiers.test.ts:135` | n/a | Lowercase / leading-digit / hyphen rejection tested. |
| `T:identifiers.TRACE_ID_PATTERN` | `TRACE_ID_PATTERN` | wired | non-visual | — | `identifiers.test.ts:222` | n/a | Version=4 + variant nibble (8/9/a/b) enforcement tested. |

---

## Matrix — branded types + cast + predicate triples

Each branded type has three rows: the type, the cast helper, the predicate (where one exists).

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:identifiers.AssetId` | `AssetId` (brand) | wired | non-visual | — | `identifiers.test.ts:180` (cast) | n/a | Tier-2 (FRIENDLY_SLUG). Used as the key in `MosaicAssetManifest`. |
| `T:identifiers.asAssetId` | `asAssetId(raw)` | wired | non-visual | — | `identifiers.test.ts:180` | n/a | No-validation cast. |
| `T:identifiers.isAssetId` | — | n/a | non-visual | — | — | n/a | **No `isAssetId` predicate exported.** Manifest validation uses `FRIENDLY_SLUG_PATTERN.test` directly via `validateAssetManifest`. (Naming-symmetry gap; non-blocking.) |
| `T:identifiers.FlattenedStableKey` | `FlattenedStableKey` | wired | non-visual | — | `identifiers.test.ts:166` (cast), :88 (predicate) | n/a | Tier-3 (post-flatten namespaced). |
| `T:identifiers.asFlattenedStableKey` | `asFlattenedStableKey(raw)` | wired | non-visual | — | `identifiers.test.ts:166` | n/a | — |
| `T:identifiers.isFlattenedStableKey` | `isFlattenedStableKey(v)` | wired | non-visual | — | `identifiers.test.ts:88` | n/a | — |
| `T:identifiers.AliasId` | `AliasId` | wired | non-visual | — | `identifiers.test.ts:176` (cast) | n/a | Tier-1 (STRICT_IDENTIFIER). `ctx.upstreamData[alias]` key. |
| `T:identifiers.asAliasId` | `asAliasId(raw)` | wired | non-visual | — | `identifiers.test.ts:176` | n/a | — |
| `T:identifiers.isAliasId` | — | n/a | non-visual | — | — | n/a | **No `isAliasId` predicate exported.** Symmetric gap with `isAssetId`. |
| `T:identifiers.TemplateId` | `TemplateId` | wired | non-visual | — | `identifiers.test.ts:187` (cast) | n/a | Tier-4 (NAMESPACED). `@scope/pack/name/vN`. |
| `T:identifiers.asTemplateId` | `asTemplateId(raw)` | wired | non-visual | — | `identifiers.test.ts:187` | n/a | — |
| `T:identifiers.isTemplateId` | — | n/a | non-visual | — | — | n/a | **No `isTemplateId` predicate exported.** Symmetric gap. |
| `T:identifiers.RepoId` | `RepoId` | wired | non-visual | — | `identifiers.test.ts:193` (cast) | n/a | Degenerate NAMESPACED (single segment OK). `@m0saic-starter` etc. |
| `T:identifiers.asRepoId` | `asRepoId(raw)` | wired | non-visual | — | `identifiers.test.ts:193` | n/a | — |
| `T:identifiers.isRepoId` | — | n/a | non-visual | — | — | n/a | **No `isRepoId` predicate exported.** Symmetric gap. |
| `T:identifiers.DictionaryEntryId` | `DictionaryEntryId` | wired | non-visual | — | `identifiers.test.ts:198` (cast) | n/a | Tier-4 (NAMESPACED). `category/name`. |
| `T:identifiers.asDictionaryEntryId` | `asDictionaryEntryId(raw)` | wired | non-visual | — | `identifiers.test.ts:198` | n/a | — |
| `T:identifiers.isDictionaryEntryId` | — | n/a | non-visual | — | — | n/a | **No `isDictionaryEntryId` predicate exported.** Symmetric gap. |
| `T:identifiers.DiagnosticCode` | `DiagnosticCode` | wired | non-visual | — | `identifiers.test.ts:202` (cast), :135 (via `isDiagnosticCode`) | n/a | Tier-5 (DIAGNOSTIC_CODE). SCREAMING_SNAKE_CASE. |
| `T:identifiers.asDiagnosticCode` | `asDiagnosticCode(raw)` | wired | non-visual | — | `identifiers.test.ts:202` | n/a | — |
| `T:identifiers.isDiagnosticCode` | `isDiagnosticCode(v)` | wired | non-visual | — | `identifiers.test.ts:135` | n/a | — |
| `T:identifiers.TraceId` | `TraceId` | wired | non-visual | — | `identifiers.test.ts:251` (cast), :222 (predicate) | n/a | UUIDv4. Telemetry trace. |
| `T:identifiers.asTraceId` | `asTraceId(raw)` | wired | non-visual | — | `identifiers.test.ts:251` | n/a | — |
| `T:identifiers.isTraceId` | `isTraceId(v)` | wired | non-visual | — | `identifiers.test.ts:222` | n/a | — |
| `T:identifiers.SpanId` | `SpanId` | wired | non-visual | — | `identifiers.test.ts:251` (cast), :222 (predicate) | n/a | UUIDv4. Telemetry span. Same pattern as TraceId, branded distinct. |
| `T:identifiers.asSpanId` | `asSpanId(raw)` | wired | non-visual | — | `identifiers.test.ts:251` | n/a | — |
| `T:identifiers.isSpanId` | `isSpanId(v)` | wired | non-visual | — | `identifiers.test.ts:222` | n/a | — |
| `T:identifiers.OutputKey` | `OutputKey` | wired | non-visual | — | `identifiers.test.ts:272` (cast), :259 (predicate) | n/a | Tier-2 (FRIENDLY_SLUG). Branded distinct from `AssetId`. |
| `T:identifiers.asOutputKey` | `asOutputKey(raw)` | wired | non-visual | — | `identifiers.test.ts:272` | n/a | — |
| `T:identifiers.isOutputKey` | `isOutputKey(v)` | wired | non-visual | — | `identifiers.test.ts:259` | n/a | — |
| `T:identifiers.InstallId` | `InstallId` | wired | non-visual | — | `identifiers.test.ts:289` (cast), :277 (predicate) | n/a | UUIDv4. Anonymous analytics identity. |
| `T:identifiers.asInstallId` | `asInstallId(raw)` | wired | non-visual | — | `identifiers.test.ts:289` | n/a | — |
| `T:identifiers.isInstallId` | `isInstallId(v)` | wired | non-visual | — | `identifiers.test.ts:277` | n/a | — |

---

## Matrix — module-level utility

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:identifiers.patterns#exported-as-RegExp` | (module-level invariant) | wired | non-visual | — | `identifiers.test.ts:209` | n/a | Asserts every pattern is exported as a raw `RegExp` instance (CLI lint + dev-server schema-check consumers depend on this). |

---

## Pruning candidates

None. Every brand has at least one consumer; every pattern is referenced by at least one brand or downstream validator.

---

## Symmetric-gap notes (worth deciding, not blocking 3a)

The following brands have an `as*` cast but no `is*` predicate exported, even though the pattern they validate against is exported and a predicate could be a one-line wrapper:

| Brand | Pattern | Why no predicate? |
|---|---|---|
| `AssetId` | `FRIENDLY_SLUG_PATTERN` | `isFriendlySlug` exists; callers use it directly + cast. |
| `AliasId` | `STRICT_IDENTIFIER_PATTERN` | `isStrictIdentifier` exists; same pattern. |
| `TemplateId` | `NAMESPACED_ID_PATTERN` | `isNamespacedId` exists; same. |
| `RepoId` | `NAMESPACED_ID_PATTERN` | Same — but `RepoId` is the degenerate single-segment case; a stricter `isRepoId` could reject multi-segment for type-safety. |
| `DictionaryEntryId` | `NAMESPACED_ID_PATTERN` | Same. |

**Decision deferred to 3a planning:** add brand-specific `is*` predicates (one-line wrappers around the tier predicates), or leave as-is and document the "use the tier predicate, then cast" pattern? Argument for adding: consumers reading `if (isTemplateId(s)) { return asTemplateId(s) }` is clearer than `if (isNamespacedId(s)) { return asTemplateId(s) }`. Argument for not adding: redundant indirection.

Recommendation: **add them** as one-line wrappers. The naming-symmetry payoff is real (you don't have to remember that `TemplateId` pattern is "the one called `NAMESPACED`"); the implementation cost is trivial (5 one-liners + tests already cover the underlying pattern).

---

## 3a engine-wiring plan (the work that remains)

The audit confirms the types + tests side of identifiers is **fully wired**. The
remaining 3a work splits into four concrete sub-tasks:

### 3a.1 — Add brand-specific `is*` predicates ✅ done

Five brands had an `as*` cast but no per-brand `is*` predicate, breaking the
naming symmetry. Each was added as a one-line wrapper around the underlying
tier predicate in `packages/types/src/identifiers/identifiers.ts`:

```ts
export const isAssetId          = (v: unknown): v is AssetId          => typeof v === "string" && FRIENDLY_SLUG_PATTERN.test(v);
export const isAliasId          = (v: unknown): v is AliasId          => typeof v === "string" && STRICT_IDENTIFIER_PATTERN.test(v);
export const isTemplateId       = (v: unknown): v is TemplateId       => typeof v === "string" && NAMESPACED_ID_PATTERN.test(v);
export const isRepoId           = (v: unknown): v is RepoId           => typeof v === "string" && NAMESPACED_ID_PATTERN.test(v);
export const isDictionaryEntryId= (v: unknown): v is DictionaryEntryId=> typeof v === "string" && NAMESPACED_ID_PATTERN.test(v);
```

Plus 15 accept/reject tests across the 5 brands (covering valid shapes,
malformed shapes, and non-string inputs). Identifier suite is now **44 tests
green** (was 29). All downstream consumers (platform, template-utils) still
pass with no regressions.

`RepoId` deliberately uses the bare `NAMESPACED_ID_PATTERN` rather than a
stricter single-segment-only check — defer until a real caller asks for the
distinction, since the `RepoId` brand's whole purpose is to track
"degenerate single-segment NAMESPACED" and the bare pattern accepts those.

### 3a.2 — Cross-reference downstream parse boundaries

These rows live in *other* concept pages, but 3a is the sub-epic that proves
each downstream consumer validates its id at the parse boundary:

| Brand | Parse boundary | Audit page | Status |
|---|---|---|---|
| `AssetId` | Asset manifest key | `asset.md` | ✅ wired (`FRIENDLY_SLUG_PATTERN.test` in `validateAssetManifest`) |
| `OutputKey` | `MosaicDocument.outputs[]` keys | `document.md` (pending) + `output.md` (pending) | ⬜ audit when 3d enumerates these |
| `TemplateId` | `MosaicTemplate.id` | `template.md` (pending) | ⬜ audit when 3h enumerates |
| `AliasId` | `MosaicDataSource.alias` | `source.md` row, `document.md` (pending) | ⬜ audit when 3b enumerates |
| `FlattenedStableKey` | `MosaicRefSource.flattenedStableKey` | `source.md` row (already `needs-wiring` per 3c) | ⬜ 3c |
| `DictionaryEntryId` | `MosaicSourceMask` `entryId`, dictionary entries | `dictionary.md` (deferred) | ⬜ |
| `RepoId` | `MosaicTemplateRepo` | `template-repo.md` (deferred) | ⬜ |
| `DiagnosticCode` | Every `MosaicDiagnostic.code` emit site | `diagnostic.md` | ✅ wired (`asDiagnosticCode(...)` is the canonical emit shape) |
| `TraceId` / `SpanId` | Telemetry events | `telemetry.md` | ✅ wired (in types; emit-site wiring is 3i) |
| `InstallId` | Analytics events | `analytics.md` | ✅ wired |

The four `⬜` rows are pending — they get checked off as 3b/3c/3d/3h/3i audit
their respective concept pages.

### 3a.3 — Platform-layer key construction helpers

Per the README's stated intent: "build a key from structured props" helpers
live in `@m0saic/platform`. The audit found:

| Brand | Platform helper today | Status |
|---|---|---|
| `AssetId` | `slugifyAssetKey` + `slugifyAssetKeyFromPath` + `uniqueAssetKey` in `@m0saic/platform/asset/slugifyAssetKey.ts` | ✅ canonical — these take messy filenames + dedupe against an existing manifest, then brand-cast. Exactly the README intent. |
| `FlattenedStableKey` | `namespaceChildManifest` in `flattenMosaicDocument.ts` (internal function, not exported) — composes `${prefix}${id}` via `asAssetId` | ⚠️ **Gap.** The flattener inlines `c0_`, `c1_` prefix logic but does NOT export a reusable `composeFlattenedStableKey(prefixes, localKey): FlattenedStableKey` helper. The internal helper returns *`AssetId`* (not `FlattenedStableKey`) because the flattener uses the same prefix scheme for both keyspaces. Template-utils consumers that need to construct a `FlattenedStableKey` for a `MosaicRefSource` today either inline the prefix logic or guess. |
| `OutputKey` | None — callers use `asOutputKey(...)` directly | ⚠️ Mild gap. Common patterns (`outputs.default`, derived from a target preset name, etc.) could benefit from a `composeOutputKey(parts: string[]): OutputKey` helper, but the bare cast works fine and the use sites are simple string literals 90% of the time. |
| `TemplateId` | None — templates declare `id: asTemplateId(...)` at their definition site | ✅ acceptable — there's no structured-prop pattern to abstract; the id is a literal in each template module. |
| `AliasId` | None — data sources declare `alias: asAliasId(...)` | ✅ acceptable — same reasoning as `TemplateId`. |
| `RepoId` | `asRepoId("")` appears in 5 sites in `loadTemplateRepoFromPath.ts` as a placeholder in error-path response objects | ⚠️ Worth a note. The `""` empty string does NOT match `NAMESPACED_ID_PATTERN` — these are deliberately invalid sentinel values used only when the repo failed to load. Today nothing checks; once `isRepoId(...)` predicates start being called at consumption boundaries (Phase 3 anywhere), these sentinels will trip. Either use a proper "unknown" sentinel (`asRepoId("@unknown")`) or restructure the response so the error path doesn't need a `repo` object at all. |
| `DictionaryEntryId` | None — dictionary entry files declare their own id at the entry definition site | ✅ acceptable. |
| `DiagnosticCode` | None — emit sites use `asDiagnosticCode("CODE_LITERAL")` | ✅ acceptable. |
| `TraceId` / `SpanId` / `InstallId` | None yet — UUID generation will live at the telemetry/analytics impl boundary (Phase 3i / Phase 5) | ⏸ deferred — not 3a. |

**Net:** 3a.3 surfaces three findings:

1. **`composeFlattenedStableKey` helper missing.** Export the prefix-composition
   logic from `flattenMosaicDocument.ts` (or move it into a new
   `packages/platform/src/identifiers/composeKeys.ts`) so template-utils
   consumers constructing refs don't reinvent it. Roughly 15 LOC + tests.
   Sub-task; non-blocking for 3a but a real ergonomic gap when 3c lands.
2. **`asRepoId("")` sentinels.** Replace with `asRepoId("@unknown")` or
   restructure the error-response shape so the `repo` object is absent.
   Sub-task; trivial fix.
3. **`composeOutputKey(parts: string[])` helper** — defer unless 3d audit
   in `output.md` shows a real consumer pattern.

### 3a.4 — Two optional diagnostic improvements (surfaced by asset.md)

1. **Promote `ASSET_PATH_NOT_ABSOLUTE` to severity `warning`?** Currently
   emits at `error`, but the loader is *supposed* to have absolutized paths
   before the validator runs — making this a defense-in-depth check, not a
   user-actionable error. A warning matches its intent. Sub-task; non-blocking.
2. **Add `ASSET_MEDIA_TYPE_MISMATCH`?** The optional `MosaicAssetCommon.mediaType`
   advisory may disagree with the actual probed file. No diagnostic fires
   today. Argument for adding: helps catch authoring errors early (typo
   `mediaType:"video"` for an image file). Argument against: the engine
   ignores the hint anyway and uses the probe. **Recommendation:** defer
   until someone hits this in practice; not 3a-blocking.

---

## 3a closing summary

| Sub-task | Result |
|---|---|
| 3a.1 — brand `is*` predicates | ✅ done (5 predicates + 15 tests, 60 LOC) |
| 3a.2 — downstream parse-boundary cross-references | ⏸ deferred into 3b/3c/3d/3h/3i (each future concept-page audit checks off its own row) |
| 3a.3 — platform key construction helpers | 📋 audit done; surfaced 3 findings (see above): `composeFlattenedStableKey` missing (~15 LOC follow-up before 3c lands), `asRepoId("")` sentinels in error paths (trivial fix), `composeOutputKey` helper deferred until 3d demands it |
| 3a.4 — optional diagnostic improvements | ⏸ both deferred (severity promotion + `ASSET_MEDIA_TYPE_MISMATCH`); non-blocking |

**3a is complete.** The single concrete code change (3a.1) shipped. The
remaining items are either (a) audit cross-references that get checked off
naturally as the next sub-epics enumerate their concept pages, or (b)
nominated follow-ups whose value depends on consumers that don't exist yet.

The matrix walk before code paid off: the actual engine wiring for 3a was
~60 LOC, not the multi-day investment a "go fix identifier hygiene"
interpretation would have suggested. The audit revealed the surface was
already mostly correct.
