import type {
  MosaicAnalyticsConsent,
  MosaicAnalyticsEvent,
  MosaicAnalyticsRollupEvent,
  MosaicHostFingerprint,
  MosaicOutboxEntry,
  MosaicRenderOutcome,
  MosaicRenderRecord,
  MosaicRenderableKind,
  MosaicUsageRecord,
} from "@m0saic/types";
import { isAnalyticsEmissionEnabled, isUpstreamAllowed } from "@m0saic/types";
import { buildHostFingerprint } from "./hostFingerprint";
import { enqueueOutbox, listOutbox, listSent, removeOutboxEntry } from "./outbox";
import { listRenderRecordsInWindow } from "./recordStore";
import { listUsageRecordsInWindow, tallyUsage } from "./usageStore";
import {
  getEffectiveTelemetryMode,
  loadTelemetrySettings,
  saveTelemetrySettings,
} from "./settingsStore";

/**
 * Rollup channel — local render records aggregated into ONE
 * `MosaicAnalyticsRollupEvent` per window. Rollups deliberately BYPASS
 * the redactor (their inputs are already the closed-enum record fields;
 * the event type has no slot for anything richer).
 *
 * Two cadences share one payload shape:
 *
 *  - **Day summary** (`maybeEnqueueDailyRollup`) — every full UTC day
 *    since the last enqueued day, `windowEnd` = a UTC midnight. Advances
 *    the `lastRollupDayUtc` marker.
 *  - **Today so far** (`maybeEnqueueTodayRollup`) — `[todayStart, now)`,
 *    re-enqueued after each render or feature use with the latest counts; at most ONE
 *    pending per day (the previous one is removed, its retry bookkeeping
 *    carried). Upstream, updates for the same `windowStart` supersede
 *    each other and tomorrow's day summary supersedes them all, so a
 *    one-day user's renders are counted without any per-render event.
 */

/** `[<1s, 1-5s, 5-30s, 30s-2m, 2-10m, 10-30m, 30m+]` (7 buckets). */
export const RENDER_DURATION_BUCKET_BOUNDS_MS: readonly number[] = [
  1_000, 5_000, 30_000, 120_000, 600_000, 1_800_000,
];

/** `[1, 2-3, 4-9, 10-29, 30-99, 100+]` (6 buckets). */
export const PLAN_COMMAND_BUCKET_BOUNDS: readonly number[] = [2, 4, 10, 30, 100];

/** Index of `value` in the exponential bucket list defined by `bounds`. */
export const bucketIndex = (value: number, bounds: readonly number[]): number => {
  for (let i = 0; i < bounds.length; i++) {
    if (value < bounds[i]) return i;
  }
  return bounds.length;
};

const DAY_MS = 86_400_000;
const dayUtcOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayStartMs = (dayUtc: string): number => Date.parse(`${dayUtc}T00:00:00.000Z`);

/** Start (epoch ms) of the UTC day containing `ms`. */
export const utcDayStartMs = (ms: number): number => dayStartMs(dayUtcOf(ms));

const finishedMs = (r: MosaicRenderRecord): number => {
  const ms = Date.parse(r.finishedAt);
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * A today-so-far update rather than a day summary: its window ends at
 * the time of the last render, not at a UTC midnight. Used for ledger
 * labels ("today so far" vs "day summary") and for supersession.
 */
export const isPartialRollup = (payload: MosaicAnalyticsEvent): boolean =>
  payload.kind === "rollup" && payload.windowEnd % DAY_MS !== 0;

/**
 * Aggregate records into the rollup event. Pure given its inputs.
 * Returns null when consent forbids the rollup channel. Counts only —
 * no ids, no paths, no durations beyond bucket tallies.
 *
 * Records without a `renderableKind` count as `mosaic_document` (the
 * common case; the CLI doesn't stamp kinds yet).
 */
export function buildRollupEvent(opts: {
  records: readonly MosaicRenderRecord[];
  /** Feature-usage lines in the same window; tallied into `features` / `templatesUsed`. */
  usage?: readonly MosaicUsageRecord[];
  windowStartMs: number;
  windowEndMs: number;
  consent: MosaicAnalyticsConsent;
  host: MosaicHostFingerprint;
  timestampMs: number;
}): MosaicAnalyticsRollupEvent | null {
  const { records, consent } = opts;
  const usageTally = tallyUsage(opts.usage ?? []);
  if (!isAnalyticsEmissionEnabled(consent)) return null;
  if (!consent.channels.rollup) return null;

  const rendersByOutcome: Record<MosaicRenderOutcome, number> = {
    ok: 0,
    cancelled: 0,
    error_plan_build: 0,
    error_validation: 0,
    error_ffmpeg: 0,
    error_template: 0,
    error_other: 0,
  };
  const rendersByKind: Record<MosaicRenderableKind, number> = {
    mosaic_document: 0,
    mosaic_pipeline: 0,
  };
  const durationBuckets = new Array<number>(
    RENDER_DURATION_BUCKET_BOUNDS_MS.length + 1,
  ).fill(0);
  const commandBuckets = new Array<number>(
    PLAN_COMMAND_BUCKET_BOUNDS.length + 1,
  ).fill(0);
  let ffmpegInvocations = 0;
  let sawCommandCounts = false;
  const distinctTemplates = new Set<string>();

  for (const r of records) {
    rendersByOutcome[r.outcome] = (rendersByOutcome[r.outcome] ?? 0) + 1;
    rendersByKind[r.renderableKind ?? "mosaic_document"] += 1;
    durationBuckets[bucketIndex(r.elapsedMs, RENDER_DURATION_BUCKET_BOUNDS_MS)] += 1;
    if (r.commands !== undefined) {
      sawCommandCounts = true;
      ffmpegInvocations += r.commands.total;
      commandBuckets[bucketIndex(r.commands.total, PLAN_COMMAND_BUCKET_BOUNDS)] += 1;
    }
    if (r.templateId !== undefined) distinctTemplates.add(r.templateId);
  }

  return {
    kind: "rollup",
    installId: consent.installId,
    timestamp: opts.timestampMs,
    schemaVersion: 1,
    windowStart: opts.windowStartMs,
    windowEnd: opts.windowEndMs,
    host: opts.host,
    metrics: {
      rendersStarted: records.length,
      rendersByOutcome,
      rendersByKind,
      ffmpegInvocations,
      renderDurationMsBuckets: durationBuckets,
      distinctTemplatesUsed: distinctTemplates.size,
      ...(sawCommandCounts ? { planCommandCountBuckets: commandBuckets } : {}),
      ...usageTally,
    },
  };
}

/**
 * The pending rollup window: from the day after the last enqueued day
 * (or the earliest record when none was ever enqueued) to `endMs`.
 */
export function pendingRollupWindowStartMs(opts: {
  lastRollupDayUtc?: string;
  earliestRecordMs?: number;
}): number | undefined {
  if (opts.lastRollupDayUtc !== undefined) {
    return dayStartMs(opts.lastRollupDayUtc) + DAY_MS;
  }
  if (opts.earliestRecordMs !== undefined) {
    return dayStartMs(dayUtcOf(opts.earliestRecordMs));
  }
  return undefined;
}

/**
 * Host fingerprint derived from a window's newest record (honest source),
 * falling back to the host's own version for a render-free window (a
 * feature-only day must not report as version "0.0").
 */
export const hostFromRecords = (
  records: readonly MosaicRenderRecord[],
  fallback: { mosaicVersion?: string } = {},
): MosaicHostFingerprint => {
  const newest = records.length > 0 ? records[records.length - 1] : undefined;
  return buildHostFingerprint({
    mosaicVersion: newest?.versions?.mosaic ?? fallback.mosaicVersion ?? "0.0",
    ...(newest?.versions?.ffmpeg !== undefined
      ? { ffmpegVersion: newest.versions.ffmpeg }
      : {}),
  });
};

const newestMs = (records: readonly MosaicRenderRecord[], usage: readonly MosaicUsageRecord[]): number =>
  Math.max(
    records.length > 0 ? finishedMs(records[records.length - 1]) : 0,
    usage.length > 0 ? usage[usage.length - 1].atMs : 0,
  );

const earliestMs = (records: readonly MosaicRenderRecord[], usage: readonly MosaicUsageRecord[]): number =>
  Math.min(
    records.length > 0 ? finishedMs(records[0]) : Number.POSITIVE_INFINITY,
    usage.length > 0 ? usage[0].atMs : Number.POSITIVE_INFINITY,
  );

type RollupGate =
  | { ok: true; settings: ReturnType<typeof loadTelemetrySettings> }
  | { ok: false; reason: "upstream-off" | "channel-off" };

const rollupGate = (env: NodeJS.ProcessEnv | undefined): RollupGate => {
  const effective = getEffectiveTelemetryMode(env);
  if (!isUpstreamAllowed(effective.mode)) return { ok: false, reason: "upstream-off" };
  const settings = loadTelemetrySettings();
  if (!isAnalyticsEmissionEnabled(settings.consent) || !settings.consent.channels.rollup) {
    return { ok: false, reason: "channel-off" };
  }
  return { ok: true, settings };
};

/** Pending today-so-far entries for the day starting at `dayStartMs`. */
const pendingPartialsFor = (dayStart: number): MosaicOutboxEntry[] =>
  listOutbox().filter(
    (e) =>
      e.payload.kind === "rollup" &&
      isPartialRollup(e.payload) &&
      e.payload.windowStart === dayStart,
  );

/**
 * Once-per-UTC-day rollup enqueue (sync, disk-only — the network flush
 * is the sender's job). Covers all full days since the last enqueue in
 * ONE window (offline gaps batch, per the event contract). Gated on
 * effective-standard + rollup channel; advances the day marker even
 * for empty windows so idle days aren't rescanned. Pending today-so-far
 * updates that the summary now covers are removed (superseded).
 */
export function maybeEnqueueDailyRollup(
  opts: { nowMs?: number; env?: NodeJS.ProcessEnv; currentVersion?: string } = {},
): { enqueued: boolean; reason?: string; entryId?: string } {
  const nowMs = opts.nowMs ?? Date.now();
  const gate = rollupGate(opts.env);
  if (!gate.ok) return { enqueued: false, reason: gate.reason };
  const { settings } = gate;

  const todayStartMs = utcDayStartMs(nowMs);
  const lastDay = settings.upstream?.lastRollupDayUtc;
  if (lastDay !== undefined && dayStartMs(lastDay) + DAY_MS >= todayStartMs) {
    return { enqueued: false, reason: "up-to-date" };
  }

  const scanStart =
    lastDay !== undefined ? dayStartMs(lastDay) + DAY_MS : 0;
  const records = listRenderRecordsInWindow(scanStart, todayStartMs);
  const usage = listUsageRecordsInWindow(scanStart, todayStartMs);
  const yesterdayUtc = dayUtcOf(todayStartMs - DAY_MS);
  const advance = () =>
    saveTelemetrySettings({
      ...settings,
      upstream: { ...settings.upstream, lastRollupDayUtc: yesterdayUtc },
    });

  // Renders AND feature usage count as activity — a render-free day with
  // template opens must not advance the marker and lose its counters.
  if (records.length === 0 && usage.length === 0) {
    advance();
    return { enqueued: false, reason: "empty-window" };
  }

  const windowStartMs =
    pendingRollupWindowStartMs({
      ...(lastDay !== undefined ? { lastRollupDayUtc: lastDay } : {}),
      earliestRecordMs: earliestMs(records, usage),
    }) ?? todayStartMs - DAY_MS;

  const event = buildRollupEvent({
    records,
    usage,
    windowStartMs,
    windowEndMs: todayStartMs,
    consent: settings.consent,
    host: hostFromRecords(records, { mosaicVersion: opts.currentVersion }),
    timestampMs: nowMs,
  });
  if (event === null) return { enqueued: false, reason: "channel-off" };

  const entry = enqueueOutbox(event, { channel: "rollup", nowMs });
  // The summary covers every partial whose day lies inside its window.
  for (const e of listOutbox()) {
    if (
      e.id !== entry.id &&
      e.payload.kind === "rollup" &&
      isPartialRollup(e.payload) &&
      e.payload.windowStart >= windowStartMs &&
      e.payload.windowEnd <= todayStartMs
    ) {
      removeOutboxEntry(e.id);
    }
  }
  advance();
  return { enqueued: true, entryId: entry.id };
}

/**
 * Today-so-far enqueue (sync, disk-only). Builds the running rollup for
 * `[todayStart, now)` when today has renders newer than whatever is
 * already pending or sent for today, removes the previous pending
 * update for today (carrying its retry bookkeeping), and enqueues the
 * fresh one. Never touches `lastRollupDayUtc` — the day summary owns
 * that. Same gates as the daily enqueue.
 */
export function maybeEnqueueTodayRollup(
  opts: { nowMs?: number; env?: NodeJS.ProcessEnv; currentVersion?: string } = {},
): { enqueued: boolean; reason?: string; entryId?: string; superseded?: number } {
  const nowMs = opts.nowMs ?? Date.now();
  const gate = rollupGate(opts.env);
  if (!gate.ok) return { enqueued: false, reason: gate.reason };
  const { settings } = gate;

  const todayStartMs = utcDayStartMs(nowMs);
  // Inclusive of `nowMs`: the host records a render and runs maintenance
  // in the same tick, so the newest record can share the millisecond.
  const records = listRenderRecordsInWindow(todayStartMs, nowMs + 1);
  const usage = listUsageRecordsInWindow(todayStartMs, nowMs + 1);
  if (records.length === 0 && usage.length === 0) return { enqueued: false, reason: "empty-window" };

  const pending = pendingPartialsFor(todayStartMs);
  const coveredUntil = Math.max(
    todayStartMs,
    ...[...pending, ...listSent()]
      .filter((e) => e.payload.kind === "rollup" && e.payload.windowStart === todayStartMs)
      .map((e) => (e.payload.kind === "rollup" ? e.payload.windowEnd : 0)),
  );
  // Activity = renders ∪ feature usage; a template open after the last
  // render is new activity and must produce a fresh update.
  if (newestMs(records, usage) < coveredUntil) {
    return { enqueued: false, reason: "up-to-date" };
  }

  const event = buildRollupEvent({
    records,
    usage,
    windowStartMs: todayStartMs,
    windowEndMs: nowMs,
    consent: settings.consent,
    host: hostFromRecords(records, { mosaicVersion: opts.currentVersion }),
    timestampMs: nowMs,
  });
  if (event === null) return { enqueued: false, reason: "channel-off" };

  const carry =
    pending.length === 0
      ? undefined
      : {
          attempts: Math.max(...pending.map((e) => e.attempts)),
          nextAttemptAtMs: Math.max(...pending.map((e) => e.nextAttemptAtMs)),
        };
  for (const e of pending) removeOutboxEntry(e.id);
  const entry = enqueueOutbox(event, {
    channel: "rollup",
    nowMs,
    ...(carry !== undefined ? { carry } : {}),
  });
  return { enqueued: true, entryId: entry.id, superseded: pending.length };
}
