import type {
  EffectiveTelemetryMode,
  FfmpegFailureKind,
  MosaicRenderRecord,
  MosaicRenderReportLike,
  MosaicRenderableKind,
  MosaicTelemetrySettingsFile,
  MosaicTelemetrySink,
  MosaicTelemetrySurface,
  MosaicTemplateLogSummary,
  RenderEvent,
} from "@m0saic/types";
import {
  NOOP_TELEMETRY_SINK,
  isLocalRecordingEnabled,
  resolveEffectiveTelemetryMode,
} from "@m0saic/types";
import { appendRenderRecord } from "./recordStore";
import { maybeEnqueueErrorReportForRecord } from "./redactor";
import {
  RENDER_RECORD_MAX_TEMPLATE_LOGS,
  buildRenderRecord,
} from "./renderRecord";
import {
  DO_NOT_TRACK_ENV,
  TELEMETRY_MODE_ENV,
  getEffectiveTelemetryMode,
} from "./settingsStore";

/**
 * The per-render telemetry recorder — the ONE pattern every host
 * (CLI render handlers, electron render IPC handlers) uses:
 *
 *   const rec = createRenderRecorder({ surface: "cli", command: "make", runId });
 *   // 1. template backchannel:
 *   createEngineContext({ ..., telemetry: rec.sink })
 *   // 2. one line inside the EXISTING inline events callback:
 *   events: (e) => { rec.onRenderEvent(e); ...existing taps... }
 *   // 3. after the report object is built (success OR failure):
 *   rec.recordRender(report, { renderableKind });
 *
 * Contract: NEVER throws and never breaks a render — every entry
 * point is wrapped. Fully inert (no telemetry fs at all) when the
 * effective mode is `ghost`. Single-shot: only the first
 * `recordRender` call appends; later calls return `null`.
 */
export type MosaicRenderRecorder = {
  /** False when the effective mode is ghost (or init failed). */
  readonly enabled: boolean;
  /** The resolved mode this recorder was built against. */
  readonly effectiveMode: EffectiveTelemetryMode;
  /** Pass as `ctx.telemetry` — collects the template_log backchannel. */
  readonly sink: MosaicTelemetrySink;
  /** Tap the live render-event stream (command stats, failure kind, cancellation). */
  onRenderEvent(e: RenderEvent): void;
  /** Distill + append the record. Null when disabled, validate-only, or already recorded. */
  recordRender(
    report: MosaicRenderReportLike,
    extras?: {
      renderableKind?: MosaicRenderableKind;
      hasValidationErrors?: boolean;
    },
  ): MosaicRenderRecord | null;
};

export type CreateRenderRecorderInit = {
  surface: MosaicTelemetrySurface;
  command?: string;
  runId?: string;
  /** Pre-loaded settings — skips the disk read (and its first-touch mint). */
  settings?: MosaicTelemetrySettingsFile;
  /** Env to resolve mode from; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Injectable append target for tests; defaults to the JSONL store. */
  append?: (record: MosaicRenderRecord) => void;
  /** Injectable record id for deterministic tests. */
  recordId?: string;
};

const INERT_EFFECTIVE: EffectiveTelemetryMode = {
  mode: "ghost",
  source: "default",
  dntDegraded: false,
};

const inertRecorder = (
  effective: EffectiveTelemetryMode = INERT_EFFECTIVE,
): MosaicRenderRecorder => ({
  enabled: false,
  effectiveMode: effective,
  sink: NOOP_TELEMETRY_SINK,
  onRenderEvent: () => {
    /* inert */
  },
  recordRender: () => null,
});

export function createRenderRecorder(
  init: CreateRenderRecorderInit,
): MosaicRenderRecorder {
  let effective: EffectiveTelemetryMode;
  try {
    const env = init.env ?? process.env;
    effective =
      init.settings !== undefined
        ? resolveEffectiveTelemetryMode({
            fileMode: init.settings.mode,
            envMode: env[TELEMETRY_MODE_ENV],
            doNotTrack: env[DO_NOT_TRACK_ENV],
          })
        : getEffectiveTelemetryMode(env);
  } catch {
    return inertRecorder();
  }
  if (!isLocalRecordingEnabled(effective.mode)) return inertRecorder(effective);

  const append = init.append ?? appendRenderRecord;

  // ── collected state ──────────────────────────────────────────────
  let cancelled = false;
  let sawCommandEvents = false;
  let cmdTotal = 0;
  let completed = 0;
  let failed = 0;
  let totalCommandMs = 0;
  let maxCommandMs = 0;
  let ffmpegFailureKind: FfmpegFailureKind | undefined;
  const templateLogs: MosaicTemplateLogSummary[] = [];
  let recordedOnce = false;
  let predictedMs: number | undefined;
  let predictedSetupUnits: number | undefined;
  let predictedSlopeUnits: number | undefined;
  let costModelVersion: number | undefined;
  let stampWrapped = false;
  let sawMainRenderStart = false;

  const sink: MosaicTelemetrySink = {
    emit: (event) => {
      try {
        if (event.kind !== "template_log") return;
        if (templateLogs.length >= RENDER_RECORD_MAX_TEMPLATE_LOGS) return;
        const { templateId, message, data } = event.payload;
        let eventName: string | undefined;
        let dataBytes: number | undefined;
        if (data !== undefined) {
          if (typeof data.event === "string") eventName = data.event;
          try {
            dataBytes = Buffer.byteLength(JSON.stringify(data), "utf8");
          } catch {
            dataBytes = undefined; // circular / non-serializable payload
          }
        }
        templateLogs.push({
          templateId: String(templateId),
          level: event.level,
          message,
          ...(eventName !== undefined ? { event: eventName } : {}),
          ...(dataBytes !== undefined ? { dataBytes } : {}),
        });
      } catch {
        /* a telemetry sink must never throw into a template */
      }
    },
  };

  return {
    enabled: true,
    effectiveMode: effective,
    sink,
    onRenderEvent: (e) => {
      try {
        switch (e.type) {
          case "render_start":
            // First render_start = the main stage; its estimate is the cost
            // model's prediction. Any LATER stage (the free-tier QR stamp
            // wrap) re-encodes the output — flag it so machine-factor
            // sampling can skip the record (wrap time is unmodeled).
            if (!sawMainRenderStart) {
              sawMainRenderStart = true;
              if (typeof e.estimatedMs === "number" && e.estimatedMs > 0) {
                predictedMs = e.estimatedMs;
              }
              if (typeof e.costModelVersion === "number") {
                costModelVersion = e.costModelVersion;
              }
              if (typeof e.predictedSetupUnits === "number" && e.predictedSetupUnits >= 0) {
                predictedSetupUnits = e.predictedSetupUnits;
              }
              if (typeof e.predictedSlopeUnits === "number" && e.predictedSlopeUnits >= 0) {
                predictedSlopeUnits = e.predictedSlopeUnits;
              }
            } else {
              stampWrapped = true;
            }
            break;
          case "command_start":
            sawCommandEvents = true;
            cmdTotal = Math.max(cmdTotal, e.total);
            break;
          case "command_end":
            sawCommandEvents = true;
            cmdTotal = Math.max(cmdTotal, e.total);
            if (e.exitCode === 0) completed++;
            else failed++;
            if (e.failure !== undefined) ffmpegFailureKind = e.failure.kind;
            totalCommandMs += e.elapsedMs;
            maxCommandMs = Math.max(maxCommandMs, e.elapsedMs);
            break;
          case "render_cancelled":
            cancelled = true;
            break;
          default:
            break;
        }
      } catch {
        /* never break the render loop */
      }
    },
    recordRender: (report, extras) => {
      if (recordedOnce) return null;
      recordedOnce = true;
      try {
        const record = buildRenderRecord({
          surface: init.surface,
          ...(init.command !== undefined ? { command: init.command } : {}),
          ...(init.runId !== undefined ? { runId: init.runId } : {}),
          ...(init.recordId !== undefined ? { recordId: init.recordId } : {}),
          report,
          collected: {
            cancelled,
            ...(sawCommandEvents
              ? {
                  commandStats: {
                    total: cmdTotal,
                    completed,
                    failed,
                    totalCommandMs,
                    maxCommandMs,
                  },
                }
              : {}),
            ...(ffmpegFailureKind !== undefined ? { ffmpegFailureKind } : {}),
            templateLogs,
            ...(extras?.hasValidationErrors !== undefined
              ? { hasValidationErrors: extras.hasValidationErrors }
              : {}),
            ...(predictedMs !== undefined ? { predictedMs } : {}),
            ...(costModelVersion !== undefined ? { costModelVersion } : {}),
            ...(predictedSetupUnits !== undefined ? { predictedSetupUnits } : {}),
            ...(predictedSlopeUnits !== undefined ? { predictedSlopeUnits } : {}),
            ...(stampWrapped ? { stampWrapped } : {}),
          },
          ...(extras?.renderableKind !== undefined
            ? { renderableKind: extras.renderableKind }
            : {}),
        });
        if (record === null) return null;
        append(record);
        // Upstream error-report chokepoint (covers CLI + app + jobs).
        // Fully gated inside (standard mode + errorReports channel,
        // which is OFF by default) and never throws.
        maybeEnqueueErrorReportForRecord(record, {
          ...(init.settings !== undefined ? { settings: init.settings } : {}),
          ...(init.env !== undefined ? { env: init.env } : {}),
        });
        return record;
      } catch {
        return null; // recording must never fail a render
      }
    },
  };
}
