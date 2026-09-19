import type { MosaicRenderRecord, MosaicTelemetrySummary } from "@m0saic/types";

const DAY_MS = 86_400_000;
const DEFAULT_BY_DAY_DAYS = 14;
const MAX_BY_DAY_DAYS = 90;
const RECENT_DURATIONS_CAP = 200;
const TOP_TEMPLATES_CAP = 8;

const finishedMsOf = (r: MosaicRenderRecord): number => {
  const ms = Date.parse(r.finishedAt);
  return Number.isNaN(ms) ? 0 : ms;
};

const isFailedOutcome = (r: MosaicRenderRecord): boolean =>
  r.outcome !== "ok" && r.outcome !== "cancelled";

/** Nearest-rank quantile over an ascending-sorted array. */
const rank = (sortedAsc: readonly number[], q: number): number =>
  sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1))];

/**
 * Pure aggregation of local render records into the one payload the
 * Telemetry page / `m0saic telemetry` render from. Runs main-side /
 * in-process so IPC ships aggregates, not raw record lists.
 *
 * Conventions:
 *  - `successRate` = ok / (ok + failed); cancelled renders are
 *    excluded from the denominator. `null` when nothing decisive.
 *  - duration stats cover OK renders only (failed renders die at
 *    arbitrary points and would skew the distribution); the
 *    `recentDurations` scatter keeps every outcome, colored by it.
 *  - `byDay` covers the last `days` UTC days (default 14), oldest →
 *    newest, zero-filled.
 */
export function summarizeRenderRecords(
  records: readonly MosaicRenderRecord[],
  opts: { days?: number; nowMs?: number } = {},
): MosaicTelemetrySummary {
  const nowMs = opts.nowMs ?? Date.now();
  const days = Math.max(1, Math.min(opts.days ?? DEFAULT_BY_DAY_DAYS, MAX_BY_DAY_DAYS));

  let ok = 0;
  let cancelled = 0;
  for (const r of records) {
    if (r.outcome === "ok") ok++;
    else if (r.outcome === "cancelled") cancelled++;
  }
  const failed = records.length - ok - cancelled;
  const successRate = ok + failed > 0 ? ok / (ok + failed) : null;

  const okDurations = records
    .filter((r) => r.outcome === "ok")
    .map((r) => r.elapsedMs)
    .sort((a, b) => a - b);
  const durationMs =
    okDurations.length === 0
      ? { avg: null, median: null, p90: null, max: null }
      : {
          avg: Math.round(
            okDurations.reduce((s, v) => s + v, 0) / okDurations.length,
          ),
          median: rank(okDurations, 0.5),
          p90: rank(okDurations, 0.9),
          max: okDurations[okDurations.length - 1],
        };

  const rendersLast7Days = records.filter(
    (r) => finishedMsOf(r) >= nowMs - 7 * DAY_MS,
  ).length;

  const dayCounts = new Map<string, { ok: number; failed: number; cancelled: number }>();
  for (const r of records) {
    const day = new Date(finishedMsOf(r)).toISOString().slice(0, 10);
    const bucket = dayCounts.get(day) ?? { ok: 0, failed: 0, cancelled: 0 };
    if (r.outcome === "ok") bucket.ok++;
    else if (r.outcome === "cancelled") bucket.cancelled++;
    else bucket.failed++;
    dayCounts.set(day, bucket);
  }
  const byDay: MosaicTelemetrySummary["byDay"] = [];
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(nowMs - d * DAY_MS).toISOString().slice(0, 10);
    byDay.push({ day, ...(dayCounts.get(day) ?? { ok: 0, failed: 0, cancelled: 0 }) });
  }

  const recentDurations = [...records]
    .sort((a, b) => finishedMsOf(b) - finishedMsOf(a))
    .slice(0, RECENT_DURATIONS_CAP)
    .map((r) => ({
      t: finishedMsOf(r),
      elapsedMs: r.elapsedMs,
      outcome: r.outcome,
      ...(r.templateId !== undefined ? { templateId: r.templateId } : {}),
    }))
    .reverse();

  const byTemplate = new Map<
    string,
    { count: number; sumMs: number; failures: number }
  >();
  for (const r of records) {
    if (r.templateId === undefined) continue;
    const t = byTemplate.get(r.templateId) ?? { count: 0, sumMs: 0, failures: 0 };
    t.count++;
    t.sumMs += r.elapsedMs;
    if (isFailedOutcome(r)) t.failures++;
    byTemplate.set(r.templateId, t);
  }
  const topTemplates = [...byTemplate.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, TOP_TEMPLATES_CAP)
    .map(([templateId, t]) => ({
      templateId,
      count: t.count,
      avgMs: Math.round(t.sumMs / t.count),
      failures: t.failures,
    }));

  let cli = 0;
  let app = 0;
  for (const r of records) {
    if (r.surface === "cli") cli++;
    else app++;
  }

  return {
    totals: { renders: records.length, ok, failed, cancelled },
    successRate,
    durationMs,
    rendersLast7Days,
    byDay,
    recentDurations,
    topTemplates,
    surfaces: { cli, app },
  };
}
