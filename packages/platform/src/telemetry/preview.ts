import type { MosaicUpstreamPreview } from "@m0saic/types";
import { isUpstreamAllowed } from "@m0saic/types";
import { listOutbox, listSent } from "./outbox";
import { listRenderRecordsInWindow } from "./recordStore";
import { buildErrorReportFromRecord, hostFromRecord } from "./redactor";
import {
  buildRollupEvent,
  hostFromRecords,
  pendingRollupWindowStartMs,
  utcDayStartMs,
} from "./rollup";
import { resolveUpstreamEndpoint } from "./sender";
import { getEffectiveTelemetryMode, loadTelemetrySettings } from "./settingsStore";
import { listUsageRecordsInWindow } from "./usageStore";

/** The always-true exclusion list (shared by the page and the CLI). */
export const UPSTREAM_NEVER_SENT: readonly string[] = [
  "file paths or file names",
  "template source, props, or your media (built-in template ids are counted by name; community and third-party templates are counted, never named)",
  "ffmpeg arguments or stderr",
  "error messages or stack traces (only closed error classes + a hash)",
  "your layout strings, canvas sizes or layout shapes — creating a Layout share link only adds one to a share count",
  "personal identifiers — the anonymous install id is the only identifier",
];

/** One sentence on cadence, shown beside the rollup JSON in both UIs. */
export const UPSTREAM_ROLLUP_CADENCE =
  "One day summary per UTC day, plus a today-so-far update after each render or feature use; " +
  "each update replaces the previous one for that day upstream, and the day summary replaces them all. " +
  "Feature-use counts and built-in template opens ride the same rollups.";

/** Plain-English annotation per rollup-payload field (sent / meaning). */
export const UPSTREAM_FIELD_ANNOTATIONS: Readonly<Record<string, string>> = {
  installId: "anonymous per-install UUID — the only persistent identifier",
  timestamp: "when this payload was assembled (epoch ms)",
  schemaVersion: "payload schema version",
  windowStart: "aggregation window start (epoch ms) — a UTC midnight",
  windowEnd:
    "aggregation window end (epoch ms) — a UTC midnight for day summaries; the time of the last render for today-so-far updates, which replace each other for the same day",
  "host.os": "coarse OS bucket (macos / windows / linux / other)",
  "host.arch": "CPU architecture string",
  "host.mosaicVersion": "m0saic version, floored to major.minor",
  "host.ffmpegVersion": "ffmpeg version, floored to major.minor",
  "metrics.rendersStarted": "count of renders in the window",
  "metrics.rendersByOutcome": "counts per closed outcome enum",
  "metrics.rendersByKind": "document vs pipeline counts",
  "metrics.ffmpegInvocations": "total ffmpeg subprocess count",
  "metrics.renderDurationMsBuckets":
    "duration histogram [<1s, 1-5s, 5-30s, 30s-2m, 2-10m, 10-30m, 30m+] — counts only",
  "metrics.distinctTemplatesUsed": "COUNT of distinct templates — ids never leave",
  "metrics.planCommandCountBuckets":
    "per-render command-count histogram [1, 2-3, 4-9, 10-29, 30-99, 100+]",
  "metrics.features": "feature-use counts for the window — closed key enum, counts only, never timestamps",
  "metrics.templatesUsed":
    "built-in (first-party) template ids opened, with counts — community and third-party templates are counted under features, never named",
  errorClass: "closed error-class enum (error reports)",
  ffmpegExitCode: "raw ffmpeg exit code (error reports)",
  stackHash: "12-hex hash of error CODES for de-dup — never messages or frames",
  renderableKind: "document vs pipeline (error reports)",
};

/**
 * The exact-transparency payload. INVARIANT: `nextRollup`, `todayRollup`
 * and `sampleErrorReport` come from the SAME builders the real pipeline
 * enqueues from (`buildRollupEvent`, `buildErrorReportFromRecord`) —
 * the preview cannot drift from what would actually be sent. `queued`
 * and `sent` are the literal on-disk ledger entries.
 */
export function buildUpstreamPreview(
  opts: { nowMs?: number; env?: NodeJS.ProcessEnv; currentVersion?: string } = {},
): MosaicUpstreamPreview {
  const nowMs = opts.nowMs ?? Date.now();
  const settings = loadTelemetrySettings();
  const effective = getEffectiveTelemetryMode(opts.env);
  const endpointInfo = resolveUpstreamEndpoint({ env: opts.env, settings });
  const todayStartMs = utcDayStartMs(nowMs);

  // Day summary still pending: every full day since the last enqueued
  // day, up to (not including) today — exactly what the daily enqueue
  // would produce next.
  const allSoFar = listRenderRecordsInWindow(0, nowMs + 1);
  const windowStart = pendingRollupWindowStartMs({
    ...(settings.upstream?.lastRollupDayUtc !== undefined
      ? { lastRollupDayUtc: settings.upstream.lastRollupDayUtc }
      : {}),
    ...(allSoFar.length > 0
      ? { earliestRecordMs: Date.parse(allSoFar[0].finishedAt) || 0 }
      : {}),
  });
  const allUsage = listUsageRecordsInWindow(0, nowMs + 1);
  const usageStart = pendingRollupWindowStartMs({
    ...(settings.upstream?.lastRollupDayUtc !== undefined
      ? { lastRollupDayUtc: settings.upstream.lastRollupDayUtc }
      : {}),
    ...(allUsage.length > 0 ? { earliestRecordMs: allUsage[0].atMs } : {}),
  });
  const pendingStart =
    windowStart === undefined
      ? usageStart
      : usageStart === undefined
        ? windowStart
        : Math.min(windowStart, usageStart);
  const windowRecords =
    pendingStart === undefined || pendingStart >= todayStartMs
      ? []
      : allSoFar.filter((r) => {
          const ms = Date.parse(r.finishedAt) || 0;
          return ms >= pendingStart && ms < todayStartMs;
        });
  const windowUsage =
    pendingStart === undefined || pendingStart >= todayStartMs
      ? []
      : allUsage.filter((u) => u.atMs >= pendingStart && u.atMs < todayStartMs);
  const fallback = { mosaicVersion: opts.currentVersion };

  const nextRollup =
    pendingStart === undefined || (windowRecords.length === 0 && windowUsage.length === 0)
      ? null
      : buildRollupEvent({
          records: windowRecords,
          usage: windowUsage,
          windowStartMs: pendingStart,
          windowEndMs: todayStartMs,
          consent: settings.consent,
          host: hostFromRecords(windowRecords, fallback),
          timestampMs: nowMs,
        });

  // Today so far — what the next post-render / post-feature update would carry.
  const todayRecords = allSoFar.filter((r) => (Date.parse(r.finishedAt) || 0) >= todayStartMs);
  const todayUsage = allUsage.filter((u) => u.atMs >= todayStartMs);
  const todayRollup =
    todayRecords.length === 0 && todayUsage.length === 0
      ? null
      : buildRollupEvent({
          records: todayRecords,
          usage: todayUsage,
          windowStartMs: todayStartMs,
          windowEndMs: nowMs,
          consent: settings.consent,
          host: hostFromRecords(todayRecords, fallback),
          timestampMs: nowMs,
        });

  // Sample error report from the latest failed record — ILLUSTRATIVE:
  // built with the errorReports channel forced on so the user can see
  // the shape while the channel (off by default) stays off; the real
  // enabled state travels separately as `errorReportsEnabled`.
  const latestFailed = [...allSoFar]
    .reverse()
    .find((r) => r.outcome !== "ok" && r.outcome !== "cancelled");
  const sampleErrorReport =
    latestFailed === undefined
      ? null
      : buildErrorReportFromRecord(
          latestFailed,
          {
            ...settings.consent,
            channels: { ...settings.consent.channels, errorReports: true },
          },
          hostFromRecord(latestFailed),
        );

  return {
    generatedAt: new Date(nowMs).toISOString(),
    upstreamAllowed: isUpstreamAllowed(effective.mode),
    channels: settings.consent.channels,
    endpoint: {
      configured: endpointInfo.endpoint !== undefined,
      ...(endpointInfo.source !== undefined ? { source: endpointInfo.source } : {}),
    },
    nextRollup,
    ...(nextRollup !== null && pendingStart !== undefined
      ? {
          nextRollupWindow: {
            windowStart: pendingStart,
            windowEnd: todayStartMs,
            records: windowRecords.length,
          },
        }
      : {}),
    todayRollup,
    sampleErrorReport,
    errorReportsEnabled: settings.consent.channels.errorReports,
    queued: listOutbox(),
    sent: listSent(),
    neverSent: UPSTREAM_NEVER_SENT,
    fieldAnnotations: UPSTREAM_FIELD_ANNOTATIONS,
    rollupCadence: UPSTREAM_ROLLUP_CADENCE,
  };
}
