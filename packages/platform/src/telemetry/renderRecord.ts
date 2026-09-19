import * as crypto from "crypto";
import type {
  FfmpegFailureKind,
  MosaicRenderRecord,
  MosaicRenderRecordCommandStats,
  MosaicRenderRecordError,
  MosaicRenderReportLike,
  MosaicRenderableKind,
  MosaicTelemetrySurface,
  MosaicTemplateLogSummary,
} from "@m0saic/types";
import {
  TELEMETRY_RENDER_RECORD_SCHEMA_VERSION,
  deriveErrorClass,
  deriveRenderOutcome,
} from "@m0saic/types";

/** Caps applied when distilling a report into a record. */
export const RENDER_RECORD_MESSAGE_MAX_CHARS = 500;
export const RENDER_RECORD_MAX_ERRORS = 20;
export const RENDER_RECORD_MAX_TEMPLATE_LOGS = 50;

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

/** `"8.0.1"` / `"n8.0-static"` → `"8.0"`; undefined when unparseable. */
export const versionMajorMinor = (v: string | undefined): string | undefined =>
  v?.match(/(\d+\.\d+)/)?.[1];

/**
 * What the per-render recorder accumulated from the live event
 * stream and the template backchannel, alongside the report.
 */
export type RenderRecordCollected = {
  /** A `render_cancelled` event was seen. */
  cancelled: boolean;
  /** Per-command stats; absent when no command events were seen. */
  commandStats?: MosaicRenderRecordCommandStats;
  /** Classification kind from the last failing `command_end`. */
  ffmpegFailureKind?: FfmpegFailureKind;
  /** Template-emitted `template_log` summaries (already capped). */
  templateLogs: MosaicTemplateLogSummary[];
  /** Host collected validation diagnostics (severity error). */
  hasValidationErrors?: boolean;
  /** `estimatedMs` from the main stage's `render_start`. */
  predictedMs?: number;
  predictedSetupUnits?: number;
  predictedSlopeUnits?: number;
  /** `costModelVersion` from the same `render_start`. */
  costModelVersion?: number;
  /** A wrap stage (`render_start.stage` ≠ main) re-encoded the output. */
  stampWrapped?: boolean;
};

export type BuildRenderRecordOpts = {
  surface: MosaicTelemetrySurface;
  command?: string;
  runId?: string;
  report: MosaicRenderReportLike;
  collected: RenderRecordCollected;
  renderableKind?: MosaicRenderableKind;
  /** Injectable for deterministic tests; defaults to a fresh UUID. */
  recordId?: string;
};

/**
 * Pure distillation of one finished render (report + collected
 * stream facts) into the JSONL record. Returns `null` for
 * validate-only runs — those are not renders and are not recorded.
 *
 * Applies the record's exclusion rules: no m0 strings, no props, no
 * stderr / error details; messages truncated; list fields capped.
 */
export function buildRenderRecord(
  opts: BuildRenderRecordOpts,
): MosaicRenderRecord | null {
  const { report, collected } = opts;
  if (report.mode === "validate") return null;

  const errorCodes = report.errors.map((e) => e.code);
  const ffmpegFailed =
    collected.ffmpegFailureKind !== undefined ||
    (collected.commandStats !== undefined && collected.commandStats.failed > 0);

  const outcome = deriveRenderOutcome({
    ok: report.ok,
    cancelled: collected.cancelled,
    errorCodes,
    ffmpegFailed,
    hasValidationErrors: collected.hasValidationErrors,
  });
  const errorClass =
    outcome === "ok" || outcome === "cancelled"
      ? undefined
      : deriveErrorClass({
          errorCodes,
          ffmpegFailureKind: collected.ffmpegFailureKind,
          hasValidationErrors: collected.hasValidationErrors,
        });

  const errors: MosaicRenderRecordError[] = report.errors
    .slice(0, RENDER_RECORD_MAX_ERRORS)
    .map((e) => ({
      code: e.code,
      message: truncate(e.message, RENDER_RECORD_MESSAGE_MAX_CHARS),
    }));

  const templateLogs = collected.templateLogs
    .slice(0, RENDER_RECORD_MAX_TEMPLATE_LOGS)
    .map((l) => ({
      ...l,
      message: truncate(l.message, RENDER_RECORD_MESSAGE_MAX_CHARS),
    }));

  const out = report.output;
  const layout = report.layout;

  return {
    schemaVersion: TELEMETRY_RENDER_RECORD_SCHEMA_VERSION,
    recordId: opts.recordId ?? crypto.randomUUID(),
    ...(opts.runId !== undefined || report.run.id !== undefined
      ? { runId: opts.runId ?? report.run.id }
      : {}),
    surface: opts.surface,
    ...(opts.command !== undefined ? { command: opts.command } : {}),
    startedAt: report.run.startedAtIso,
    finishedAt: report.run.finishedAtIso,
    elapsedMs: report.run.elapsedMs,
    ok: report.ok,
    exitCode: report.exitCode,
    outcome,
    ...(errorClass !== undefined ? { errorClass } : {}),
    ...(collected.ffmpegFailureKind !== undefined
      ? { ffmpegFailureKind: collected.ffmpegFailureKind }
      : {}),
    ...(report.template?.id !== undefined
      ? { templateId: report.template.id }
      : {}),
    ...(opts.renderableKind !== undefined
      ? { renderableKind: opts.renderableKind }
      : {}),
    ...(out !== undefined
      ? {
          output: {
            ...(out.width !== undefined ? { width: out.width } : {}),
            ...(out.height !== undefined ? { height: out.height } : {}),
            ...(out.fps !== undefined ? { fps: out.fps } : {}),
            ...(out.durationMs !== undefined
              ? { durationMs: out.durationMs }
              : {}),
            ...(out.format?.kind !== undefined
              ? { formatKind: out.format.kind }
              : {}),
            ...(out.format?.container !== undefined
              ? { container: out.format.container }
              : {}),
            ...(out.format?.codec !== undefined
              ? { codec: out.format.codec }
              : {}),
          },
        }
      : {}),
    ...(report.paths?.output?.absolutePath !== undefined
      ? { outputPath: report.paths.output.absolutePath }
      : {}),
    ...(collected.commandStats !== undefined
      ? { commands: collected.commandStats }
      : {}),
    ...(collected.predictedMs !== undefined
      ? { predictedMs: collected.predictedMs }
      : {}),
    ...(collected.predictedSetupUnits !== undefined
      ? { predictedSetupUnits: collected.predictedSetupUnits }
      : {}),
    ...(collected.predictedSlopeUnits !== undefined
      ? { predictedSlopeUnits: collected.predictedSlopeUnits }
      : {}),
    ...(collected.costModelVersion !== undefined
      ? { costModelVersion: collected.costModelVersion }
      : {}),
    ...(collected.stampWrapped ? { stampWrapped: true } : {}),
    ...(layout?.rootSourceCount !== undefined ||
    layout?.rootFlattenedSourceCount !== undefined
      ? {
          layout: {
            ...(layout.rootSourceCount !== undefined
              ? { sourceCount: layout.rootSourceCount }
              : {}),
            ...(layout.rootFlattenedSourceCount !== undefined
              ? { flattenedSourceCount: layout.rootFlattenedSourceCount }
              : {}),
          },
        }
      : {}),
    ...(report.versions !== undefined
      ? {
          versions: {
            ...(report.versions.cli?.version !== undefined
              ? { mosaic: report.versions.cli.version }
              : {}),
            ...(versionMajorMinor(report.versions.ffmpeg?.runtime?.version) !==
            undefined
              ? {
                  ffmpeg: versionMajorMinor(
                    report.versions.ffmpeg?.runtime?.version,
                  ),
                }
              : {}),
          },
        }
      : {}),
    errors,
    warningsCount: report.warnings.length,
    ...(templateLogs.length > 0 ? { templateLogs } : {}),
  };
}
