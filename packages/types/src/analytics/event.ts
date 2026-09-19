import type { InstallId } from "../identifiers/identifiers";
import type { MosaicFeatureCounts } from "./usageMetrics";

/**
 * Discriminated union of analytics events safe for remote upload.
 *
 * Distinct from {@link MosaicTelemetryEvent} by design: this is the
 * narrow, redacted, dimensional shape that crosses the network. The
 * type system enforces the boundary — a sink that accepts a
 * `MosaicAnalyticsEvent` cannot accept a `MosaicTelemetryEvent`,
 * eliminating "I accidentally piped local-only data to the server"
 * as a bug class.
 *
 * # Two channels by cadence
 *
 * Variants are split between two upload cadences:
 *
 *  - **Rollup** ({@link MosaicAnalyticsRollupEvent}) — aggregate
 *    counters / histograms accumulated locally and shipped on a
 *    schedule (default: daily). The privacy-preferred channel; no
 *    per-render granularity reaches the server.
 *  - **Immediate** ({@link MosaicAnalyticsImmediateEvent}) — discrete
 *    one-off events shipped soon after emit. Covers error reports
 *    (when opt-in) and install/version lifecycle events. Per-event
 *    timing data is visible to the operator, so this channel is
 *    user-controllable and off-by-default for error reports.
 *
 * # Shape constraints
 *
 *  - No free strings beyond a small allowlist (`mosaicVersion`,
 *    `ffmpegVersion`, first-party template ids in `templatesUsed`). No
 *    layout strings, canvas sizes or layout shapes (a Layout share is the
 *    `share.layout.copy` count only), no file paths, no asset names, no
 *    ffmpeg argv, no stderr lines, no community or third-party template ids.
 *  - All "what kind of thing" fields are closed enums.
 *  - Identifiers are scrambled at the redactor boundary
 *    ({@link MosaicAnalyticsRedactor}) — a `scrambledTemplateId` is
 *    a deterministic hash of the real id, not the id itself.
 *  - `installId` is the only persistent identifier. No accountId,
 *    no userId, no hardware uuid. Survives across renders; doesn't
 *    survive across machines.
 */
export type MosaicAnalyticsEvent =
  | MosaicAnalyticsRollupEvent
  | MosaicAnalyticsImmediateEvent;

// ─────────────────────────────────────────────────────────────────────
// Correlation / envelope
// ─────────────────────────────────────────────────────────────────────

/**
 * Fields stamped on every analytics event. Deliberately minimal —
 * `installId` is the only persistent identifier; everything else is
 * either dimensional (closed enums) or aggregated.
 */
export type MosaicAnalyticsEnvelope = {
  /** Anonymous install identifier. Same value across all events from this install. */
  installId: InstallId;
  /** Event creation time. Epoch ms. */
  timestamp: number;
  /** Schema version for this event payload. Bumped when shapes evolve. */
  schemaVersion: 1;
};

// ─────────────────────────────────────────────────────────────────────
// Closed enumerations — what gets uploaded, as type-level allowlists
// ─────────────────────────────────────────────────────────────────────

/**
 * Outcome class for a finished render. Closed enum — server reads
 * these directly, so adding a new value is a coordinated change.
 */
export type MosaicRenderOutcome =
  | "ok"
  | "cancelled"
  | "error_plan_build"
  | "error_validation"
  | "error_ffmpeg"
  | "error_template"
  | "error_other";

/**
 * High-level error class for an immediate error report. Closed
 * enum; the redactor maps free-form errors into one of these.
 * Stack traces / messages stay on the user's machine.
 */
export type MosaicErrorClass =
  | "ffmpeg_exit_nonzero"
  | "ffmpeg_not_found"
  | "ffmpeg_unknown_encoder"
  | "ffmpeg_unknown_container"
  | "plan_build_failed"
  | "plan_validation_failed"
  | "template_threw"
  | "asset_missing"
  | "asset_unreadable"
  | "workspace_io_failed"
  | "unexpected_engine_state"
  | "other";

/**
 * Renderable kind that ran. Lets the operator distinguish doc-only
 * renders from pipeline renders without leaking any author data.
 */
export type MosaicRenderableKind = "mosaic_document" | "mosaic_pipeline";

/**
 * Coarse OS bucket. Avoids version-string cardinality explosions.
 * The redactor floors the local OS into one of these.
 */
export type MosaicHostOs = "macos" | "windows" | "linux" | "other";

// ─────────────────────────────────────────────────────────────────────
// Rollup channel — daily aggregates
// ─────────────────────────────────────────────────────────────────────

/**
 * Once-per-period aggregated blob. The default-on analytics
 * channel. Carries totals + dimensional histograms accumulated
 * locally over the rollup window.
 *
 * Sent once per UTC day as a day summary, plus a today-so-far update
 * after renders (same shape, `windowEnd` = time of the last render).
 * Updates for the same `windowStart` supersede each other upstream —
 * the greater `windowEnd` wins — so no per-render history accumulates.
 * If the install was idle the rollup may carry zero counters; if the
 * install was never online during the rollup window, multiple windows
 * may batch into a single upload.
 */
export type MosaicAnalyticsRollupEvent = MosaicAnalyticsEnvelope & {
  kind: "rollup";
  /** Start of the aggregation window. Epoch ms. */
  windowStart: number;
  /** End of the aggregation window. Epoch ms. */
  windowEnd: number;
  /** Host environment dimensions captured at rollup-emit time. */
  host: MosaicHostFingerprint;
  /** Aggregated counters / histograms for the window. */
  metrics: MosaicAnalyticsRollupMetrics;
};

/**
 * Coarse host fingerprint. Each field is bounded cardinality
 * (closed enum or version-pinned string) so the operator can slice
 * the dataset without identifying individuals.
 */
export type MosaicHostFingerprint = {
  /** Coarse OS bucket. */
  os: MosaicHostOs;
  /** CPU architecture string (`x64`, `arm64`, `arm`, etc.). */
  arch: string;
  /** Major + minor m0saic version (`"0.1"`). NOT the full semver — patch versions explode cardinality. */
  mosaicVersion: string;
  /** ffmpeg version major.minor (e.g. `"8.0"`). Major.minor only. */
  ffmpegVersion?: string;
};

/**
 * Aggregated metrics for a rollup window. Counters increment-once-
 * per-event; histograms record value distributions.
 */
export type MosaicAnalyticsRollupMetrics = {
  /** Total renders started in this window. */
  rendersStarted: number;
  /** Renders finished, bucketed by outcome. Sum may exceed `rendersStarted` if windows overlap a long-running render. */
  rendersByOutcome: Readonly<Record<MosaicRenderOutcome, number>>;
  /** Renders bucketed by renderable kind (doc vs pipeline). */
  rendersByKind: Readonly<Record<MosaicRenderableKind, number>>;
  /** Total ffmpeg subprocess invocations across all renders. The "1 billion invocations" counter feeds off this field. */
  ffmpegInvocations: number;
  /**
   * Render duration histogram (ms). Buckets are exponential:
   * `[<1s, 1-5s, 5-30s, 30s-2m, 2-10m, 10-30m, 30m+]`. Counts only —
   * no per-render durations leave the install.
   */
  renderDurationMsBuckets: ReadonlyArray<number>;
  /**
   * Distinct templates used in the window (count, not ids). Lets
   * the operator see "how many distinct templates does this install
   * exercise" without revealing which.
   */
  distinctTemplatesUsed: number;
  /**
   * Optional histogram of plan-command counts per render. Same
   * exponential bucketing as durations:
   * `[1, 2-3, 4-9, 10-29, 30-99, 100+]`.
   */
  planCommandCountBuckets?: ReadonlyArray<number>;
  /**
   * Feature-usage counts for the window — sparse (only nonzero keys),
   * every key a member of the closed feature-key enum the hosts own
   * (`@m0saic/types-internal`; shape rule `FEATURE_KEY_SHAPE_RE` here) — the
   * server rejects unknown keys.
   * Counted per UTC day; never timestamped events.
   */
  features?: MosaicFeatureCounts;
  /**
   * Built-in (first-party) template ids opened in the window, with
   * counts. Community and third-party templates are counted under
   * `features` (`template.open.community` / `.external`) and never named.
   * At most 64 entries (top by count).
   */
  templatesUsed?: Readonly<Record<string, number>>;
};

// ─────────────────────────────────────────────────────────────────────
// Immediate channel — per-event uploads
// ─────────────────────────────────────────────────────────────────────

/**
 * Per-event uploads. Three families:
 *
 *  - **Lifecycle** (`install_completed`, `update_completed`) — fire
 *    once each per install/upgrade. Lets the operator see install
 *    counts and version-migration timing. Default-on.
 *  - **Error report** — fires when a render fails. Opt-in. Carries
 *    the error class and a hash of the stack frames (NOT the
 *    frames themselves), plus host fingerprint for environment
 *    bucketing.
 */
export type MosaicAnalyticsImmediateEvent =
  | (MosaicAnalyticsEnvelope & {
      kind: "install_completed";
      host: MosaicHostFingerprint;
    })
  | (MosaicAnalyticsEnvelope & {
      kind: "update_completed";
      host: MosaicHostFingerprint;
      /** Previous mosaic version major.minor (`"0.0"`). */
      fromVersion: string;
      /** New mosaic version major.minor (`"0.1"`). */
      toVersion: string;
    })
  | (MosaicAnalyticsEnvelope & {
      kind: "error_report";
      host: MosaicHostFingerprint;
      errorClass: MosaicErrorClass;
      /** ffmpeg exit code, when the error came from a child process. */
      ffmpegExitCode?: number;
      /**
       * Deterministic hash (sha256-prefix) of the stack frame names
       * for this error. Lets the operator de-duplicate identical
       * errors across installs without seeing the frames themselves.
       * Empty string when no stack was captured.
       */
      stackHash: string;
      /**
       * Optional renderable kind that was being processed when the
       * error fired. Lets the operator distinguish "pipelines crash
       * 3x more often than docs" without leaking template ids.
       */
      renderableKind?: MosaicRenderableKind;
    });
