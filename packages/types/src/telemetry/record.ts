import type {
  MosaicErrorClass,
  MosaicRenderOutcome,
  MosaicRenderableKind,
} from "../analytics/event";
import type { FfmpegFailureKind } from "./event";
import type { TemplateTelemetryLevel } from "./level";

/**
 * The local render-history record — one JSON line per render in
 * `<m0saic-root>/telemetry/renders/YYYY-MM.jsonl`.
 *
 * Distilled from the in-memory `RenderReportV2` (via the structural
 * subset {@link MosaicRenderReportLike} — the report schema itself is
 * locked and untouched) plus what the per-render recorder collected
 * from the live event stream (command stats, ffmpeg failure kind,
 * template-emitted logs).
 *
 * # Scope: LOCAL only
 *
 * This record never crosses the network. It may carry local facts an
 * analytics event never could (`outputPath`, real `templateId`) —
 * the Phase-6 rollup builder aggregates records into
 * `MosaicAnalyticsRollupEvent`s whose closed enums
 * ({@link MosaicRenderOutcome}, {@link MosaicErrorClass},
 * {@link MosaicRenderableKind}) are reused here so aggregation needs
 * no re-mapping.
 *
 * # Deliberate exclusions (size + privacy hygiene, even locally)
 *
 * No m0 strings (`rootM0` / `rootFlattenedM0`), no template props, no
 * stderr / error `details` — error messages are truncated by the
 * builder. Template logs keep the `event` discriminator + payload
 * byte size, not the payload itself.
 */
export type MosaicRenderRecord = {
  schemaVersion: typeof TELEMETRY_RENDER_RECORD_SCHEMA_VERSION;
  /** Unique id for this record (UUIDv4). */
  recordId: string;
  /** The host's render/run id, when it minted one. */
  runId?: string;
  /** Which host recorded the render. */
  surface: MosaicTelemetrySurface;
  /** Host-level command name (`make`, `make-wireframe`, `mosaic:render`, …). */
  command?: string;
  /** ISO 8601 UTC. */
  startedAt: string;
  /** ISO 8601 UTC. */
  finishedAt: string;
  elapsedMs: number;
  ok: boolean;
  exitCode: number;
  /** Closed outcome class (shared with the analytics rollup). */
  outcome: MosaicRenderOutcome;
  /** Closed error class; absent on success. */
  errorClass?: MosaicErrorClass;
  /** ffmpeg failure classification kind, when a command failed. */
  ffmpegFailureKind?: FfmpegFailureKind;
  /** Real template id — LOCAL only; scrambled/dropped before any upstream use. */
  templateId?: string;
  renderableKind?: MosaicRenderableKind;
  output?: MosaicRenderRecordOutput;
  /** Absolute output path — LOCAL only, never upstream. */
  outputPath?: string;
  /** Per-command stats collected from the live render-event stream. */
  commands?: MosaicRenderRecordCommandStats;
  /**
   * A-priori estimate from the main stage's `render_start` (ms) — the cost
   * model's prediction for the ffmpeg execution phase. Pairs with the
   * command stats' `totalCommandMs` (NOT `elapsedMs`, which also counts
   * plan build / probing / sidecars) to make telemetry a standing
   * predicted-vs-actual accuracy corpus. Additive; schemaVersion stays 1.
   */
  predictedMs?: number;
  /** Cost-model version that produced `predictedMs` (absent = v1). */
  costModelVersion?: number;
  /** Reference-machine unit sums at factor 1 (v3+): the regressors for the
   *  two-factor machine calibration. Additive; schemaVersion stays 1. */
  predictedSetupUnits?: number;
  predictedSlopeUnits?: number;
  /**
   * A post-render wrap stage (free-tier QR stamp) re-encoded the output.
   * Its time is inside `elapsedMs` but outside `predictedMs` — machine-
   * factor sampling must skip wrapped records.
   */
  stampWrapped?: boolean;
  /** Geometry scale of the render (drives renders-vs-complexity analytics). */
  layout?: { sourceCount?: number; flattenedSourceCount?: number };
  versions?: { mosaic?: string; ffmpeg?: string };
  /** Error code + truncated message only — no stderr, no details. */
  errors: MosaicRenderRecordError[];
  warningsCount: number;
  /** Template-emitted telemetry (`emitTemplateLog`) summaries, capped. */
  templateLogs?: MosaicTemplateLogSummary[];
};

/** Bumped when the record shape changes incompatibly. */
export const TELEMETRY_RENDER_RECORD_SCHEMA_VERSION = 1;

/** Which host wrote a record. */
export type MosaicTelemetrySurface = "cli" | "app";

/** Aggregated per-command stats for one render. */
export type MosaicRenderRecordCommandStats = {
  total: number;
  completed: number;
  failed: number;
  totalCommandMs: number;
  maxCommandMs: number;
};

/** Output facts distilled from the report. */
export type MosaicRenderRecordOutput = {
  width?: number;
  height?: number;
  fps?: number;
  durationMs?: number;
  formatKind?: "video" | "image";
  container?: string;
  codec?: string;
};

/** One report diagnostic, stripped to code + truncated message. */
export type MosaicRenderRecordError = { code: string; message: string };

/**
 * Summary of one template-emitted `template_log` event. The free-form
 * `data` payload is summarized as its recommended `data.event`
 * discriminator plus serialized byte size — the payload itself stays
 * out of the history file.
 */
export type MosaicTemplateLogSummary = {
  templateId: string;
  level: TemplateTelemetryLevel;
  message: string;
  event?: string;
  dataBytes?: number;
};

/**
 * Structural subset of `@m0saic/core`'s `RenderReportV2`, containing
 * exactly the fields the record builder reads.
 *
 * Exists because the builder lives in `@m0saic/platform` (public),
 * which MUST NOT import `@m0saic/core` (private) — hosts that have a
 * real `RenderReportV2` pass it straight in (it is structurally
 * assignable; the CLI carries a compile-time assertion locking that).
 * Every nested field is optional-friendly so report evolution can
 * only break this by CHANGING a field's type, not by adding fields.
 */
export type MosaicRenderReportLike = {
  mode: "render" | "validate";
  ok: boolean;
  exitCode: number;
  run: {
    id?: string;
    startedAtIso: string;
    finishedAtIso: string;
    elapsedMs: number;
  };
  paths?: { output?: { absolutePath?: string } };
  output?: {
    width?: number;
    height?: number;
    fps?: number;
    durationMs?: number;
    format?: { kind?: "video" | "image"; container?: string; codec?: string };
  };
  template?: { id: string };
  layout?: { rootSourceCount?: number; rootFlattenedSourceCount?: number };
  versions?: {
    cli?: { version?: string };
    ffmpeg?: { runtime?: { version?: string } };
  };
  errors: ReadonlyArray<{ code: string; message: string }>;
  warnings: ReadonlyArray<unknown>;
};

/** Inputs a host already knows when deriving the outcome class. */
export type DeriveRenderOutcomeInput = {
  ok: boolean;
  /** The render was cancelled by the user (from `render_cancelled`). */
  cancelled: boolean;
  /** Report `errors[].code` values. */
  errorCodes: readonly string[];
  /** An ffmpeg command exited non-zero (from `command_end`). */
  ffmpegFailed: boolean;
  /** Host collected validation diagnostics (severity error). */
  hasValidationErrors?: boolean;
};

/**
 * Map a finished render onto the closed {@link MosaicRenderOutcome}
 * enum. Priority: cancelled > ok > ffmpeg > validation > plan-build >
 * template > other.
 */
export const deriveRenderOutcome = (
  i: DeriveRenderOutcomeInput,
): MosaicRenderOutcome => {
  if (i.cancelled) return "cancelled";
  if (i.ok) return "ok";
  if (i.ffmpegFailed || i.errorCodes.some((c) => c.startsWith("FFMPEG"))) {
    return "error_ffmpeg";
  }
  if (i.hasValidationErrors) return "error_validation";
  if (i.errorCodes.includes("NO_COMMANDS")) return "error_plan_build";
  if (i.errorCodes.some((c) => c.startsWith("TEMPLATE"))) {
    return "error_template";
  }
  return "error_other";
};

/**
 * How each {@link FfmpegFailureKind} maps onto the closed
 * {@link MosaicErrorClass} enum. Exported so the table itself is
 * test-locked and the Phase-6 redactor reuses the same verdicts.
 */
export const FFMPEG_FAILURE_KIND_TO_ERROR_CLASS: Readonly<
  Record<FfmpegFailureKind, MosaicErrorClass>
> = {
  "missing-codec": "ffmpeg_unknown_encoder",
  "missing-input": "asset_missing",
  "no-space": "workspace_io_failed",
  "thread-exhaustion": "ffmpeg_exit_nonzero",
  "link-queue-buffer-overflow": "ffmpeg_exit_nonzero",
  "out-of-memory": "ffmpeg_exit_nonzero",
  killed: "ffmpeg_exit_nonzero",
  "ffmpeg-crash": "ffmpeg_exit_nonzero",
  "filter-graph-invalid": "ffmpeg_exit_nonzero",
  stalled: "ffmpeg_exit_nonzero",
  unknown: "ffmpeg_exit_nonzero",
};

/** Inputs a host already knows when deriving the error class. */
export type DeriveErrorClassInput = {
  /** Report `errors[].code` values. Empty on success. */
  errorCodes: readonly string[];
  /** Classification kind from `command_end.failure`, when present. */
  ffmpegFailureKind?: FfmpegFailureKind;
  /** Host collected validation diagnostics (severity error). */
  hasValidationErrors?: boolean;
};

/**
 * Map a failed render onto the closed {@link MosaicErrorClass} enum;
 * `undefined` when there is nothing to classify (success). The ffmpeg
 * classifier's verdict wins when present — it saw the stderr.
 */
export const deriveErrorClass = (
  i: DeriveErrorClassInput,
): MosaicErrorClass | undefined => {
  if (i.ffmpegFailureKind !== undefined) {
    return FFMPEG_FAILURE_KIND_TO_ERROR_CLASS[i.ffmpegFailureKind];
  }
  if (i.errorCodes.length === 0 && !i.hasValidationErrors) return undefined;
  if (i.errorCodes.includes("FFMPEG_NOT_FOUND")) return "ffmpeg_not_found";
  if (i.errorCodes.some((c) => c.startsWith("FFMPEG"))) {
    return "ffmpeg_exit_nonzero";
  }
  if (i.hasValidationErrors) return "plan_validation_failed";
  if (i.errorCodes.includes("NO_COMMANDS")) return "plan_build_failed";
  if (i.errorCodes.some((c) => c.startsWith("TEMPLATE"))) {
    return "template_threw";
  }
  if (i.errorCodes.includes("UNHANDLED_EXCEPTION")) return "other";
  return "other";
};

/**
 * Aggregates for the Telemetry page / `m0saic telemetry` — computed
 * from local records by `@m0saic/platform`'s `summarizeRenderRecords`
 * and shipped over IPC as one small payload.
 */
export type MosaicTelemetrySummary = {
  totals: { renders: number; ok: number; failed: number; cancelled: number };
  /** ok / (ok + failed); null when nothing finished decisively. */
  successRate: number | null;
  durationMs: {
    avg: number | null;
    median: number | null;
    p90: number | null;
    max: number | null;
  };
  rendersLast7Days: number;
  /** Per-day outcome counts, oldest → newest (day = `YYYY-MM-DD` UTC). */
  byDay: Array<{ day: string; ok: number; failed: number; cancelled: number }>;
  /** Recent (t, duration) points for the scatter chart, capped. */
  recentDurations: Array<{
    t: number;
    elapsedMs: number;
    outcome: MosaicRenderOutcome;
    templateId?: string;
  }>;
  /** Most-used templates with duration + failure stats, capped. */
  topTemplates: Array<{
    templateId: string;
    count: number;
    avgMs: number;
    failures: number;
  }>;
  surfaces: { cli: number; app: number };
};
