import type { DiagnosticCode } from "../identifiers";

/**
 * Render-pipeline planning diagnostic.
 *
 * Emitted by `@m0saic/platform` validators and `@m0saic/core` planners
 * while turning a {@link MosaicDocument} into a render plan. Errors
 * usually prevent rendering; warnings indicate that the plan can still
 * be executed but may behave unexpectedly.
 */
export type MosaicDiagnostic = {
  /**
   * Machine-readable code for the issue (e.g. `"MISSING_SOURCE"`,
   * `"INVALID_DURATION"`, `"MOSAIC_REF_FORWARD_REFERENCE"`). Stable
   * across versions so tooling and tests can pin on specific codes.
   *
   * Branded as {@link DiagnosticCode} — values must match
   * {@link DIAGNOSTIC_CODE_PATTERN} (SCREAMING_SNAKE_CASE).
   * Construct via {@link asDiagnosticCode} at the diagnostic-emit
   * site.
   *
   * For the closed list of currently-emitted codes, see
   * {@link MOSAIC_DIAGNOSTIC_CODES} / {@link MosaicDiagnosticCode}.
   * `DiagnosticCode` is the *contract* (any well-formed code is
   * allowed); `MosaicDiagnosticCode` is the *registry* (the
   * specific codes the engine emits today).
   */
  code: DiagnosticCode;

  /** Human-readable message describing the problem. */
  message: string;

  /**
   * Severity:
   * - `"error"` — fatal; rendering halts or the affected node is skipped.
   * - `"warning"` — non-fatal; engine continues with a fallback.
   */
  severity: "error" | "warning";
};

// ─────────────────────────────────────────────────────────────────────
// Diagnostic-code registry
// ─────────────────────────────────────────────────────────────────────

/**
 * Closed registry of every diagnostic code currently emitted (or
 * reserved for emit) by `@m0saic/platform` validators and
 * `@m0saic/core` planners.
 *
 * Stable across versions:
 * - **Additions** are minor-version safe (new codes appear here).
 * - **Removals** require a major version bump.
 *
 * Used by tests / lint to enumerate the surface (no code may be
 * emitted that isn't in this list); used by the Phase 2 connectivity
 * matrix to track which codes are actually wired vs. reserved.
 *
 * Distinct from the {@link DiagnosticCode} brand:
 * - `DiagnosticCode` is the *contract* — any string matching
 *   {@link DIAGNOSTIC_CODE_PATTERN} is structurally valid. This
 *   keeps the type future-proof when new codes are added.
 * - `MOSAIC_DIAGNOSTIC_CODES` / `MosaicDiagnosticCode` is the
 *   *registry* — the specific codes the engine emits today. Tests
 *   pin on this; engine code references it; consumers wanting
 *   exhaustive switch coverage use `MosaicDiagnosticCode`.
 */
export const MOSAIC_DIAGNOSTIC_CODES = [
  // ── Core source / render ─────────────────────────────────
  "MISSING_SOURCE",
  "INVALID_DURATION",
  "UNSUPPORTED_COMBINATION",
  "HARDWARE_ENCODER_FALLBACK",
  "AUDIO_CODEC_SUBSTITUTED",

  // ── MosaicRefSource (back-edge mirror) ───────────────────
  /** @deprecated since Phase 3c.4 — engine no longer emits this code.
   *  Unsupported ref-target shapes now use
   *  `MOSAIC_REF_TARGET_NOT_SUPPORTED`. Kept registered for ABI
   *  stability; external consumers may continue to filter on it. */
  "MOSAIC_REF_NOT_YET_IMPLEMENTED",
  "MOSAIC_REF_CELL_NOT_FOUND",
  "MOSAIC_REF_FORWARD_REFERENCE",
  "MOSAIC_REF_AMBIGUOUS_STABLEKEY",
  "MOSAIC_REF_TARGET_NOT_SUPPORTED",

  // ── Outputs map / .m0v inheritance ───────────────────────
  "MOSAIC_OUTPUTSREF_NOT_FOUND",
  "MOSAIC_OUTPUTSREF_INVALID",
  "MULTI_OUTPUT_NOT_YET_IMPLEMENTED",
  "MULTI_OUTPUT_CODEC_VARIATION",
  "OUTPUT_TARGET_NOT_YET_IMPLEMENTED",
  "OUTPUT_TARGET_FORMAT_CONFLICT",

  // ── Per-output validation (3d.3) ─────────────────────────
  "INVALID_FPS",
  "PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER",
  "VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER",
  "VIDEO_CODEC_IGNORED_FOR_IMAGE_CONTAINER",
  "AUDIO_IGNORED_FOR_IMAGE_CONTAINER",
  "EMPTY_BITRATE",
  "EMPTY_PIXEL_FORMAT",

  // ── Pipeline features ────────────────────────────────────
  "PIPELINE_EMIT_MULTI_NOT_YET_IMPLEMENTED",
  "PIPELINE_EMIT_MULTI_DOWNGRADED",
  "PIPELINE_NESTED_CANVAS_COLLAPSED",
  "PIPELINE_NO_OUTPUT_STEPS",
  "PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE",

  // ── Pipeline declared duration (`durationMs` / `durationFit`) ──
  /** `durationMs` is not a positive integer (Infinity / NaN / 0 / negative
   *  / fractional). Error; the natural duration renders instead. */
  "PIPELINE_DURATION_INVALID",
  /** The declared duration differs from the stitched length, so the
   *  flattened output was trimmed or filled to reach it. */
  "PIPELINE_DURATION_FITTED",
  /** Declared LONGER than the stitch under `durationFit: "cut"`, which
   *  does not fill — the natural duration renders and the declaration is
   *  not honored. */
  "PIPELINE_DURATION_UNDERRUN",
  /** The CLI `--durationMs` / desktop Duration field replaced a duration
   *  the file declared (a step's, or the pipeline's slot duration). */
  "DURATION_MS_OVERRIDDEN_BY_CLI",

  // ── Playback playSpeed wiring ────────────────────────────
  /** `playback.playSpeed` was set on a source kind that does not honor it
   *  yet (text / ref / lavfi — wired for media video/audio AND nested
   *  mosaic children). Warning; the source renders at 1×. */
  "PLAY_SPEED_NOT_WIRED_FOR_SOURCE",
  /** `playback.playSpeed` on a media source is non-finite or ≤ 0 on an
   *  engine path that skipped full document validation (the validated path
   *  fails fast with `INVALID_PLAY_SPEED` instead). Warning; the value is
   *  ignored and the source renders at 1×. */
  "PLAY_SPEED_INVALID_IGNORED",
  /** `playback.playSpeed` on a media source is finite but outside
   *  [MIN_PLAY_SPEED, MAX_PLAY_SPEED] (0.1–10). Warning; the clamped
   *  value is used. */
  "PLAY_SPEED_CLAMPED",

  // ── User-intent exact-override (rule 7) ──────────────────
  "OUTPUT_NAME_NOT_FOUND",
  "OUTPUT_EXACT_OVERRIDE",
  "OUTPUT_OVERRIDE_IGNORED",

  // ── Back-edge variables / MosaicDataSource / aliases ─────
  "VARIABLES_NOT_YET_IMPLEMENTED",
  "VARIABLES_SCHEMA_MISMATCH",
  "MOSAIC_DATA_SOURCE_VISIBLE_USE",
  "MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE",
  "MOSAIC_ALIAS_COLLISION",
  "DATA_SOURCE_VARIABLES_MALFORMED",
  "DATA_SOURCE_ALIAS_INVALID",

  // ── Sidecar (end-user structured-data) delivery ──────────
  /** @deprecated — sidecar writes are live. `@m0saic/core`'s
   *  `writeSidecars` flushes each `sidecars[key]` to disk as
   *  `<output-basename>.<key>.json` next to the primary output. This
   *  code is no longer emitted but is kept registered for ABI
   *  stability (same retirement pattern as
   *  `MOSAIC_REF_NOT_YET_IMPLEMENTED` and `MOSAIC_DATA_SOURCE_VISIBLE_USE`).
   *  External consumers may continue to filter on it. */
  "SIDECAR_NOT_YET_IMPLEMENTED",
  "SIDECAR_SCHEMA_MISMATCH",

  // ── Template registry (role + naming) ────────────────────
  "TEMPLATE_ROLE_NAMING_MISMATCH",

  // ── Unsafe-filename staging ──────────────────────────────
  "MEDIA_PATH_STAGED",
  "MEDIA_PATH_STAGED_COLLISION",

  // ── Layout floors (feasibility / precision vs the canvas) ─
  // The render canvas is below the flattened layout's safe minimum
  // (per-axis max of the feasibility and precision floors). It still
  // renders, but sub-pixel cells are squashed or culled. The same
  // condition Make shows as its "min W×H" chip — emitted by the planner
  // so headless (CLI) renders see it too.
  "LAYOUT_BELOW_SAFE_MIN",

  // ── Labels (.m0c) and layout packs (.m0p) ────────────────
  "LABEL_NOT_FOUND",
  "M0C_LABEL_MISSING",
  "M0C_LABEL_UNEXPECTED",
  "M0P_VARIANT_MISSING",
  "M0P_VARIANT_UNEXPECTED",
  "M0P_VARIANT_REQUIRED",

  // ── `.mosaicx` source-form + resolver phase ──────────────
  /**
   * A `template_invocation` source reached the engine-bound
   * validator (`validateMosaicDocument`). This means the resolver
   * (`resolveMosaicx`) didn't run before the doc hit the engine,
   * which is always a programmer error — flat `.mosaic` docs must
   * have all invocations materialized into `mosaic` sources first.
   */
  "UNRESOLVED_TEMPLATE_INVOCATION",
  /** Structural error in a `.mosaicx`: `template_invocation` source missing `templateId`. */
  "MOSAICX_INVOCATION_MISSING_TEMPLATE_ID",
  /** Structural error in a `.mosaicx`: `template_invocation` source missing `props` (must be present even if empty `{}`). */
  "MOSAICX_INVOCATION_MISSING_PROPS",
  /** Resolver hit the configured `maxDepth` while recursing into nested mosaicx returns from a template. */
  "MOSAICX_DEPTH_EXCEEDED",
  /** Resolver couldn't find the referenced `templateId` in the registry. */
  "MOSAICX_TEMPLATE_NOT_FOUND",
  /** `template_invocation.templateVersion` pin differs from the registry version. */
  "MOSAICX_TEMPLATE_VERSION_MISMATCH",
] as const;

/**
 * Union of every currently-registered diagnostic code string
 * literal. Use this when you want exhaustive switch coverage; use
 * {@link DiagnosticCode} when you want to accept any future code.
 */
export type MosaicDiagnosticCode = (typeof MOSAIC_DIAGNOSTIC_CODES)[number];

/**
 * Runtime type guard against the closed registry. True iff `v` is
 * one of the codes in {@link MOSAIC_DIAGNOSTIC_CODES}.
 */
export const isMosaicDiagnosticCode = (v: unknown): v is MosaicDiagnosticCode =>
  typeof v === "string" &&
  (MOSAIC_DIAGNOSTIC_CODES as readonly string[]).includes(v);
