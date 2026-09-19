import * as crypto from "crypto";
import type {
  MosaicAnalyticsConsent,
  MosaicAnalyticsImmediateEvent,
  MosaicAnalyticsRedactor,
  MosaicHostFingerprint,
  MosaicRenderRecord,
  MosaicTelemetrySettingsFile,
} from "@m0saic/types";
import {
  FFMPEG_FAILURE_KIND_TO_ERROR_CLASS,
  isAnalyticsEmissionEnabled,
  isUpstreamAllowed,
  resolveEffectiveTelemetryMode,
} from "@m0saic/types";
import { buildHostFingerprint } from "./hostFingerprint";
import { enqueueOutbox } from "./outbox";
import {
  DO_NOT_TRACK_ENV,
  TELEMETRY_MODE_ENV,
  getEffectiveTelemetryMode,
  loadTelemetrySettings,
} from "./settingsStore";

/**
 * Deterministic de-dup hash for an error's code chain (the analytics
 * `stackHash` slot: frame NAMES analog — never the frames/messages).
 * Empty string when there is nothing to hash, per the event contract.
 */
export const codeChainStackHash = (codes: readonly string[]): string =>
  codes.length === 0
    ? ""
    : crypto.createHash("sha256").update(codes.join("|")).digest("hex").slice(0, 12);

/**
 * The concrete `MosaicAnalyticsRedactor` (the published contract in
 * `@m0saic/types/analytics/redactor`). A factory: the returned
 * function is PURE per the contract (no I/O, no clock — the envelope
 * timestamp is the event's own) with the host fingerprint captured as
 * a constant.
 *
 * Today exactly one telemetry family redacts into an analytics event:
 * failed runtime events → `error_report` (errorReports channel).
 * Rollups and lifecycle events bypass the redactor by design (see the
 * contract's "Direct-emit events" note). The scrambler parameter is
 * accepted per the contract; no current analytics slot carries a
 * scrambled id — the type-level firewall has no field for one.
 */
export function createTelemetryRedactor(
  host: MosaicHostFingerprint,
): MosaicAnalyticsRedactor {
  return (event, consent, _scrambler) => {
    if (!isAnalyticsEmissionEnabled(consent)) return null;
    if (!consent.channels.errorReports) return null;

    if (event.kind === "runtime_command_end" && event.payload.exitCode !== 0) {
      const kind = event.payload.failure?.kind;
      return {
        kind: "error_report",
        installId: consent.installId,
        timestamp: event.timestamp,
        schemaVersion: 1,
        host,
        errorClass:
          kind !== undefined
            ? FFMPEG_FAILURE_KIND_TO_ERROR_CLASS[kind]
            : "ffmpeg_exit_nonzero",
        ffmpegExitCode: event.payload.exitCode,
        stackHash: "",
      };
    }
    if (event.kind === "runtime_render_end" && event.payload.exitCode !== 0) {
      return {
        kind: "error_report",
        installId: consent.installId,
        timestamp: event.timestamp,
        schemaVersion: 1,
        host,
        errorClass: "ffmpeg_exit_nonzero",
        ffmpegExitCode: event.payload.exitCode,
        stackHash: "",
      };
    }
    return null;
  };
}

/**
 * Error report from a finished render RECORD — the shape the actual
 * enqueue path and the transparency preview share (exact by
 * construction). Pure; consent-gated like the redactor. Null on
 * success/cancelled or when the channel/emission is off.
 */
export function buildErrorReportFromRecord(
  record: MosaicRenderRecord,
  consent: MosaicAnalyticsConsent,
  host: MosaicHostFingerprint,
): MosaicAnalyticsImmediateEvent | null {
  if (!isAnalyticsEmissionEnabled(consent)) return null;
  if (!consent.channels.errorReports) return null;
  if (record.outcome === "ok" || record.outcome === "cancelled") return null;
  const timestamp = Date.parse(record.finishedAt);
  return {
    kind: "error_report",
    installId: consent.installId,
    timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
    schemaVersion: 1,
    host,
    errorClass: record.errorClass ?? "other",
    ...(record.outcome === "error_ffmpeg" && record.exitCode !== 0
      ? { ffmpegExitCode: record.exitCode }
      : {}),
    stackHash: codeChainStackHash(record.errors.map((e) => e.code)),
    ...(record.renderableKind !== undefined
      ? { renderableKind: record.renderableKind }
      : {}),
  };
}

/** Host fingerprint from a record's own version stamps. */
export const hostFromRecord = (record: MosaicRenderRecord): MosaicHostFingerprint =>
  buildHostFingerprint({
    mosaicVersion: record.versions?.mosaic ?? "0.0",
    ...(record.versions?.ffmpeg !== undefined
      ? { ffmpegVersion: record.versions.ffmpeg }
      : {}),
  });

/**
 * The live error-report enqueue chokepoint — called by the recorder
 * after every appended record, covering CLI + app + jobs at once.
 * Fully gated (effective-standard + errorReports channel, which is
 * OFF by default) and never throws. Injectables mirror the recorder's
 * so injected-settings recorders never touch the real disk here.
 */
export function maybeEnqueueErrorReportForRecord(
  record: MosaicRenderRecord,
  opts: {
    settings?: MosaicTelemetrySettingsFile;
    env?: NodeJS.ProcessEnv;
    enqueue?: (event: MosaicAnalyticsImmediateEvent) => void;
  } = {},
): boolean {
  try {
    const env = opts.env ?? process.env;
    const effective =
      opts.settings !== undefined
        ? resolveEffectiveTelemetryMode({
            fileMode: opts.settings.mode,
            envMode: env[TELEMETRY_MODE_ENV],
            doNotTrack: env[DO_NOT_TRACK_ENV],
          })
        : getEffectiveTelemetryMode(env);
    if (!isUpstreamAllowed(effective.mode)) return false;
    const settings = opts.settings ?? loadTelemetrySettings();
    if (!settings.consent.channels.errorReports) return false;
    const event = buildErrorReportFromRecord(
      record,
      settings.consent,
      hostFromRecord(record),
    );
    if (event === null) return false;
    const enqueue =
      opts.enqueue ??
      ((payload: MosaicAnalyticsImmediateEvent) =>
        void enqueueOutbox(payload, { channel: "immediate" }));
    enqueue(event);
    return true;
  } catch {
    return false; // never break a render on upstream plumbing
  }
}
