/**
 * Identifier hygiene tiers for strings flowing through the m0saic
 * render graph.
 *
 * # Why this exists
 *
 * A render graph contains hundreds of internal identifiers —
 * cell stableKeys, asset keys, alias names, variable keys, sidecar
 * keys, output keys, child keys, prop keys, template ids,
 * diagnostic codes. ffmpeg is powerful but particular: emojis,
 * spaces, shell-special characters, and unusual Unicode tend to
 * cause silent corruption or hard failures somewhere down the
 * filtergraph / argv path. Composability at scale requires every
 * one of those identifiers to have a known, safe shape.
 *
 * This module is the single source of truth for what counts as a
 * safe identifier at each tier. Free-form content strings (label
 * *values*, container metadata, text content) and boundary path
 * strings (asset paths, URLs) deliberately do NOT pass through
 * these tiers — they carry messy data, and the engine quotes them
 * carefully at consumption.
 *
 * # Tiers
 *
 * | Tier                          | Pattern                                  | Used by                                                        |
 * |-------------------------------|------------------------------------------|----------------------------------------------------------------|
 * | {@link STRICT_IDENTIFIER_PATTERN}     | `[a-zA-Z_][a-zA-Z0-9_]{0,63}`            | StableKey, AliasId, VariableKey, SidecarKey, ChildKey, …       |
 * | {@link FRIENDLY_SLUG_PATTERN}         | `[A-Za-z0-9_][A-Za-z0-9_.\-]{0,127}`     | AssetId, OutputKey — filename-friendly (hyphens, dots OK)      |
 * | {@link FLATTENED_STABLE_KEY_PATTERN}  | `(c\d+_)*STRICT_IDENTIFIER`              | FlattenedStableKey — post-flatten namespaced stableKeys        |
 * | {@link NAMESPACED_ID_PATTERN}         | `@?segment(/segment)*`                   | TemplateId, DictionaryEntryId                                  |
 * | {@link DIAGNOSTIC_CODE_PATTERN}       | `[A-Z][A-Z0-9_]{0,63}`                   | DiagnosticCode                                                 |
 * | {@link TEMPLATE_ROLE_PATTERN}         | `[a-z][a-z0-9]*(-[a-z0-9]+)*`            | TemplateRole tag + id-segment hints                            |
 *
 * # API conventions (matches the existing AssetId pattern)
 *
 *  - `XXX_PATTERN` — the regex constant (exported for external validators
 *    and dev-server schema checks).
 *  - `isXxx(v: unknown): v is Xxx` — runtime predicate that validates
 *    against the pattern.
 *  - `asXxx(s: string): Xxx` — **cast** helper, no runtime validation.
 *    Use at JSON parse boundaries where input is already trusted or
 *    will be validated downstream. Match the existing
 *    {@link asAssetId} contract.
 *
 * For "build a key from structured props" ergonomics, the
 * **`@m0saic/platform`** package provides higher-level constructor
 * APIs that take props, format consistently, validate, and return
 * the branded type. Authors use those rather than calling `asXxx`
 * directly.
 */

// ─────────────────────────────────────────────────────────────────────
// Tier patterns
// ─────────────────────────────────────────────────────────────────────

/**
 * Strict identifier — alphanumeric + underscore, must start with a
 * letter or underscore. Max 64 characters.
 *
 * Safe in JavaScript identifier syntax, ffmpeg filtergraph labels,
 * JSON keys, URI fragments, SQL identifiers, and filename components
 * (after appropriate quoting).
 *
 * Used for most internal pipeline identifiers — anywhere you'd want
 * the key to round-trip through dot-property access.
 */
export const STRICT_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

/**
 * Friendly slug — `STRICT_IDENTIFIER` plus hyphens and dots.
 * Max 128 characters.
 *
 * Used for identifiers that are filename-friendly by convention
 * (e.g. `"alpha-master"` output key produces `…-alpha-master.mov`,
 * or `"hero.mp4"` as an asset key reads naturally). NOT safe as a
 * JS identifier directly (hyphens break dot access), but safe in
 * filesystem paths, URL components, and JSON-bracket access.
 *
 * `.` is allowed for readability; `:` is intentionally NOT allowed
 * (collides with Windows drive-letter syntax in any code path that
 * uses the key as a filename component). Hyphens and dots cannot
 * appear at the start of the identifier.
 */
export const FRIENDLY_SLUG_PATTERN =
  /^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,127}$/;

/**
 * Flattened-stableKey — optional `c0_`, `c1_`, … namespace prefixes
 * (added by the flattener for nested-child stableKeys) followed by a
 * {@link STRICT_IDENTIFIER_PATTERN} suffix.
 *
 * Used exclusively for {@link MosaicRefSource.flattenedStableKey}.
 */
export const FLATTENED_STABLE_KEY_PATTERN =
  /^(c\d+_)*[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

/**
 * Namespaced identifier — `@scope/path/v1` style, slash-separated.
 *
 * Used for {@link MosaicTemplate.id} (e.g. `@m0saic/dj/session-hero/v1`)
 * and {@link MosaicDictionaryEntry.id} (e.g. `splits/2-col`).
 */
export const NAMESPACED_ID_PATTERN =
  /^@?[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

/**
 * Diagnostic code — SCREAMING_SNAKE_CASE, max 64 characters.
 *
 * Used exclusively for {@link MosaicDiagnostic.code} values
 * (`"MOSAIC_REF_FORWARD_REFERENCE"`, `"SIDECAR_SCHEMA_MISMATCH"`, …).
 */
export const DIAGNOSTIC_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Template role slug — kebab-case, lowercase. Max 32 characters.
 *
 * Used both as a value in the `TemplateRole` closed union
 * (`renderable`, `data-fetcher`, `building-block`, `orchestrator`,
 * `harness`) and as a segment within a {@link TemplateId} when a
 * role-specific naming convention applies (e.g. `/fetcher/`,
 * `/intel/` in a data-fetcher's id).
 *
 * The pattern is broader than the closed union on purpose: the
 * regex covers any role-shaped slug; the union enforces membership
 * at type-check time via {@link isTemplateRole}.
 */
export const TEMPLATE_ROLE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Trace / span identifier — UUIDv4 (lowercase hex, hyphenated).
 *
 * Used by the telemetry layer to correlate events across a single
 * render (`TraceId`) and to nest spans within it (`SpanId`).
 * Hyphens preclude this from {@link STRICT_IDENTIFIER_PATTERN}, so
 * trace/span keys never accidentally satisfy a slot expecting a
 * filtergraph-safe identifier.
 */
export const TRACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ─────────────────────────────────────────────────────────────────────
// Predicates (validate against pattern)
// ─────────────────────────────────────────────────────────────────────

export const isStrictIdentifier = (v: unknown): v is string =>
  typeof v === "string" && STRICT_IDENTIFIER_PATTERN.test(v);

export const isFriendlySlug = (v: unknown): v is string =>
  typeof v === "string" && FRIENDLY_SLUG_PATTERN.test(v);

export const isFlattenedStableKey = (v: unknown): v is FlattenedStableKey =>
  typeof v === "string" && FLATTENED_STABLE_KEY_PATTERN.test(v);

export const isNamespacedId = (v: unknown): v is string =>
  typeof v === "string" && NAMESPACED_ID_PATTERN.test(v);

export const isDiagnosticCode = (v: unknown): v is DiagnosticCode =>
  typeof v === "string" && DIAGNOSTIC_CODE_PATTERN.test(v);

export const isTraceId = (v: unknown): v is TraceId =>
  typeof v === "string" && TRACE_ID_PATTERN.test(v);

export const isSpanId = (v: unknown): v is SpanId =>
  typeof v === "string" && TRACE_ID_PATTERN.test(v);

export const isOutputKey = (v: unknown): v is OutputKey =>
  typeof v === "string" && FRIENDLY_SLUG_PATTERN.test(v);

// ─────────────────────────────────────────────────────────────────────
// Brand-specific predicates
//
// Symmetry with the existing `isOutputKey` / `isInstallId` / `isTraceId` /
// `isSpanId` / `isDiagnosticCode` / `isFlattenedStableKey` brands — every
// brand gets a per-brand predicate that narrows to its branded type, even
// when the underlying check is just the tier predicate. Callers reading
// `if (isTemplateId(s)) return asTemplateId(s)` need not remember that the
// `TemplateId` brand validates via `NAMESPACED_ID_PATTERN`.
// ─────────────────────────────────────────────────────────────────────

export const isAssetId = (v: unknown): v is AssetId =>
  typeof v === "string" && FRIENDLY_SLUG_PATTERN.test(v);

export const isAliasId = (v: unknown): v is AliasId =>
  typeof v === "string" && STRICT_IDENTIFIER_PATTERN.test(v);

export const isTemplateId = (v: unknown): v is TemplateId =>
  typeof v === "string" && NAMESPACED_ID_PATTERN.test(v);

export const isRepoId = (v: unknown): v is RepoId =>
  typeof v === "string" && NAMESPACED_ID_PATTERN.test(v);

export const isDictionaryEntryId = (v: unknown): v is DictionaryEntryId =>
  typeof v === "string" && NAMESPACED_ID_PATTERN.test(v);

// ─────────────────────────────────────────────────────────────────────
// Branded identifier types
// ─────────────────────────────────────────────────────────────────────

declare const AssetIdBrand: unique symbol;
/**
 * Opaque identifier for an entry in a `MosaicAssetManifest`.
 *
 * Matches {@link FRIENDLY_SLUG_PATTERN} — filename-friendly so the
 * key survives filesystems, URL paths, JSON keys, and ffmpeg argv
 * intact. The asset table exists to hide troublesome source strings
 * (spaces, emojis, drive letters, Unicode) behind a stable
 * identifier; that intent only works if the identifier itself is
 * safe — so the same pattern applies to the keys too.
 *
 * Construct via {@link asAssetId} at JSON parse boundaries.
 */
export type AssetId = string & { readonly [AssetIdBrand]: true };

/** Cast a raw string to an AssetId. No runtime validation. */
export const asAssetId = (raw: string): AssetId => raw as AssetId;

declare const FlattenedStableKeyBrand: unique symbol;
/**
 * StableKey resolved against the post-flatten root DSL keyspace.
 *
 * Distinct from a local stableKey (which lives in an unflattened
 * doc-tier keyspace). Matches {@link FLATTENED_STABLE_KEY_PATTERN}.
 *
 * Use {@link asFlattenedStableKey} at JSON parse boundaries, or
 * the `@m0saic/platform` flatten helpers to construct one from a
 * local key plus a namespace prefix chain.
 */
export type FlattenedStableKey = string & {
  readonly [FlattenedStableKeyBrand]: true;
};

/** Cast a raw string to a FlattenedStableKey. No runtime validation. */
export const asFlattenedStableKey = (raw: string): FlattenedStableKey =>
  raw as FlattenedStableKey;

declare const AliasIdBrand: unique symbol;
/**
 * Author-facing alias declared on a {@link MosaicDataSource}.
 *
 * Matches {@link STRICT_IDENTIFIER_PATTERN}. Becomes a key in
 * `ctx.upstreamData[alias]` for namespaced downstream reads.
 */
export type AliasId = string & { readonly [AliasIdBrand]: true };

/** Cast a raw string to an AliasId. No runtime validation. */
export const asAliasId = (raw: string): AliasId => raw as AliasId;

declare const TemplateIdBrand: unique symbol;
/**
 * Unique template identifier — `@scope/pack/name/vN` style.
 *
 * Matches {@link NAMESPACED_ID_PATTERN}. Official templates follow
 * `@m0saic/<pack>/<name>/v<major>`; community templates follow
 * `@community/<name>/v<major>` or `@<author>/<name>/v<major>`.
 */
export type TemplateId = string & { readonly [TemplateIdBrand]: true };

/** Cast a raw string to a TemplateId. No runtime validation. */
export const asTemplateId = (raw: string): TemplateId => raw as TemplateId;

declare const RepoIdBrand: unique symbol;
/**
 * Template-repo scope identifier — the first segment of every
 * {@link TemplateId} produced by the repo (e.g. `@m0saic-starter`,
 * `@community`, `@my-org`).
 *
 * Matches {@link NAMESPACED_ID_PATTERN} as a degenerate single-segment
 * case (no slashes). Branded distinct from {@link TemplateId} so a
 * fully-qualified template key never accidentally satisfies a slot
 * expecting a repo scope.
 *
 * Used by `MosaicTemplateRepoDescriptor.repoId` and friends.
 */
export type RepoId = string & { readonly [RepoIdBrand]: true };

/** Cast a raw string to a RepoId. No runtime validation. */
export const asRepoId = (raw: string): RepoId => raw as RepoId;

declare const DictionaryEntryIdBrand: unique symbol;
/**
 * Unique dictionary entry identifier — `category/name` style
 * (e.g. `splits/2-col`, `brand/m0saic-m-256`).
 *
 * Matches {@link NAMESPACED_ID_PATTERN}.
 */
export type DictionaryEntryId = string & {
  readonly [DictionaryEntryIdBrand]: true;
};

/** Cast a raw string to a DictionaryEntryId. No runtime validation. */
export const asDictionaryEntryId = (raw: string): DictionaryEntryId =>
  raw as DictionaryEntryId;

declare const DiagnosticCodeBrand: unique symbol;
/**
 * Machine-readable diagnostic code — SCREAMING_SNAKE_CASE.
 *
 * Matches {@link DIAGNOSTIC_CODE_PATTERN}. Stable across versions
 * so tooling, tests, and lint overrides can pin on specific codes.
 */
export type DiagnosticCode = string & {
  readonly [DiagnosticCodeBrand]: true;
};

/** Cast a raw string to a DiagnosticCode. No runtime validation. */
export const asDiagnosticCode = (raw: string): DiagnosticCode =>
  raw as DiagnosticCode;

declare const TraceIdBrand: unique symbol;
/**
 * Telemetry trace identifier — UUIDv4. Correlates every
 * {@link MosaicTelemetryEvent} emitted during one logical render
 * (template phase → plan phase → runtime phase → batch envelope).
 *
 * Matches {@link TRACE_ID_PATTERN}. Future migration target for
 * `JobRun.renderId` in `@m0saic/platform`.
 */
export type TraceId = string & { readonly [TraceIdBrand]: true };

/** Cast a raw string to a TraceId. No runtime validation. */
export const asTraceId = (raw: string): TraceId => raw as TraceId;

declare const SpanIdBrand: unique symbol;
/**
 * Telemetry span identifier — UUIDv4. Names a single event in a
 * trace. Pairs with optional `parentSpanId` for hierarchy
 * (e.g. command_start → command_progress → command_end share a
 * parent that wraps the whole command's life).
 *
 * Matches {@link TRACE_ID_PATTERN}.
 */
export type SpanId = string & { readonly [SpanIdBrand]: true };

/** Cast a raw string to a SpanId. No runtime validation. */
export const asSpanId = (raw: string): SpanId => raw as SpanId;

declare const OutputKeyBrand: unique symbol;
/**
 * Key into {@link MosaicDocument.outputs} — names a single deliverable
 * (e.g. `"desktop"`, `"mobile"`, `"alpha-master"`). Forms the
 * filename basis at render time (default `{base}-{key}.{ext}`), so
 * the same filename-friendly rules as {@link AssetId} apply.
 *
 * Matches {@link FRIENDLY_SLUG_PATTERN}. Branded distinct from
 * {@link AssetId} so the two tier-2 keyspaces stay non-interchangeable
 * at type level even though they share the same character rules.
 */
export type OutputKey = string & { readonly [OutputKeyBrand]: true };

/** Cast a raw string to an OutputKey. No runtime validation. */
export const asOutputKey = (raw: string): OutputKey => raw as OutputKey;

declare const InstallIdBrand: unique symbol;
/**
 * Anonymous install identifier — UUIDv4 generated at first launch
 * and persisted in the install's local config. Survives across
 * renders, app restarts, and updates; does not migrate across
 * machines.
 *
 * The unit of analytics counting in {@link MosaicAnalyticsEvent}.
 * A user with laptop + desktop counts as two installs by design —
 * the analytics surface tracks rendering environments, not humans.
 *
 * Matches {@link TRACE_ID_PATTERN} (same UUIDv4 shape as
 * {@link TraceId} / {@link SpanId}, branded separately so the
 * three keyspaces stay non-interchangeable at type level).
 */
export type InstallId = string & { readonly [InstallIdBrand]: true };

/** Cast a raw string to an InstallId. No runtime validation. */
export const asInstallId = (raw: string): InstallId => raw as InstallId;

/** Runtime predicate: is `v` a syntactically valid InstallId? */
export const isInstallId = (v: unknown): v is InstallId =>
  typeof v === "string" && TRACE_ID_PATTERN.test(v);
