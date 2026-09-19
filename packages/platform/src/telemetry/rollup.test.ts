import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { MosaicRenderRecord } from "@m0saic/types";
import { asInstallId, defaultTelemetrySettings } from "@m0saic/types";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import { listOutbox, listSent, markSent, updateOutboxEntry } from "./outbox";
import { appendRenderRecord } from "./recordStore";
import { loadTelemetrySettings, saveTelemetrySettings, setTelemetryMode } from "./settingsStore";
import {
  PLAN_COMMAND_BUCKET_BOUNDS,
  RENDER_DURATION_BUCKET_BOUNDS_MS,
  bucketIndex,
  buildRollupEvent,
  isPartialRollup,
  maybeEnqueueDailyRollup,
  maybeEnqueueTodayRollup,
} from "./rollup";

const INSTALL = asInstallId("550e8400-e29b-41d4-a716-446655440000");
const CONSENT = defaultTelemetrySettings(INSTALL, "2026-07-01T00:00:00.000Z").consent;
const HOST = { os: "macos" as const, arch: "arm64", mosaicVersion: "0.1" };
const NOW = Date.parse("2026-07-10T12:00:00.000Z");

let seq = 0;
const rec = (over: Partial<MosaicRenderRecord> = {}): MosaicRenderRecord => {
  seq++;
  const finishedAt = over.finishedAt ?? "2026-07-09T10:00:00.000Z";
  return {
    schemaVersion: 1,
    recordId: `r-${seq}`,
    surface: "cli",
    startedAt: finishedAt,
    finishedAt,
    elapsedMs: 800,
    ok: true,
    exitCode: 0,
    outcome: "ok",
    errors: [],
    warningsCount: 0,
    ...over,
  };
};

describe("bucketIndex", () => {
  it("buckets durations on the documented bounds", () => {
    expect(bucketIndex(999, RENDER_DURATION_BUCKET_BOUNDS_MS)).toBe(0);
    expect(bucketIndex(1000, RENDER_DURATION_BUCKET_BOUNDS_MS)).toBe(1);
    expect(bucketIndex(29_999, RENDER_DURATION_BUCKET_BOUNDS_MS)).toBe(2);
    expect(bucketIndex(3_600_000, RENDER_DURATION_BUCKET_BOUNDS_MS)).toBe(6);
  });

  it("buckets command counts on the documented bounds", () => {
    expect(bucketIndex(1, PLAN_COMMAND_BUCKET_BOUNDS)).toBe(0);
    expect(bucketIndex(3, PLAN_COMMAND_BUCKET_BOUNDS)).toBe(1);
    expect(bucketIndex(9, PLAN_COMMAND_BUCKET_BOUNDS)).toBe(2);
    expect(bucketIndex(100, PLAN_COMMAND_BUCKET_BOUNDS)).toBe(5);
  });
});

describe("buildRollupEvent", () => {
  it("aggregates counts, buckets, kinds, and distinct templates (ids never leave)", () => {
    const event = buildRollupEvent({
      records: [
        rec({ elapsedMs: 500, templateId: "@m0saic/a/b/v1", commands: { total: 3, completed: 3, failed: 0, totalCommandMs: 400, maxCommandMs: 200 } }),
        rec({ elapsedMs: 12_000, templateId: "@m0saic/a/b/v1" }),
        rec({ elapsedMs: 700, outcome: "error_ffmpeg", ok: false, renderableKind: "mosaic_pipeline", commands: { total: 12, completed: 11, failed: 1, totalCommandMs: 900, maxCommandMs: 300 } }),
      ],
      windowStartMs: 0,
      windowEndMs: 1000,
      consent: CONSENT,
      host: HOST,
      timestampMs: NOW,
    });
    expect(event).not.toBeNull();
    expect(event?.metrics.rendersStarted).toBe(3);
    expect(event?.metrics.rendersByOutcome.ok).toBe(2);
    expect(event?.metrics.rendersByOutcome.error_ffmpeg).toBe(1);
    expect(event?.metrics.rendersByKind).toEqual({ mosaic_document: 2, mosaic_pipeline: 1 });
    expect(event?.metrics.ffmpegInvocations).toBe(15);
    expect(event?.metrics.renderDurationMsBuckets).toEqual([2, 0, 1, 0, 0, 0, 0]);
    expect(event?.metrics.planCommandCountBuckets).toEqual([0, 1, 0, 1, 0, 0]);
    expect(event?.metrics.distinctTemplatesUsed).toBe(1);
    const json = JSON.stringify(event);
    expect(json).not.toContain("@m0saic/a/b/v1");
    expect(json).not.toContain("outputPath");
  });

  it("returns null when the rollup channel or emission is off", () => {
    expect(
      buildRollupEvent({
        records: [rec()],
        windowStartMs: 0,
        windowEndMs: 1,
        consent: { ...CONSENT, channels: { ...CONSENT.channels, rollup: false } },
        host: HOST,
        timestampMs: NOW,
      }),
    ).toBeNull();
    expect(
      buildRollupEvent({
        records: [rec()],
        windowStartMs: 0,
        windowEndMs: 1,
        consent: { ...CONSENT, mode: "opted-out" },
        host: HOST,
        timestampMs: NOW,
      }),
    ).toBeNull();
  });
});

describe("maybeEnqueueDailyRollup (temp root)", () => {
  const originalEnv = process.env.M0SAIC_ROOT;
  let fixture: string;

  beforeEach(() => {
    fixture = path.join(
      os.tmpdir(),
      `${M0SAIC_TMP_PREFIX}telemetry-rollup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.M0SAIC_ROOT = fixture;
  });

  afterEach(() => {
    if (fs.existsSync(fixture)) fs.rmSync(fixture, { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.M0SAIC_ROOT;
    else process.env.M0SAIC_ROOT = originalEnv;
  });

  it("enqueues ONE rollup covering the pending window, then reports up-to-date", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-08T10:00:00.000Z" }));
    appendRenderRecord(rec({ finishedAt: "2026-07-09T10:00:00.000Z", outcome: "error_other", ok: false }));
    appendRenderRecord(rec({ finishedAt: "2026-07-10T10:00:00.000Z" })); // today — NOT in window

    const first = maybeEnqueueDailyRollup({ nowMs: NOW, env: {} });
    expect(first.enqueued).toBe(true);
    const queued = listOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].kind).toBe("rollup");
    const payload = queued[0].payload as { metrics: { rendersStarted: number }; windowEnd: number };
    expect(payload.metrics.rendersStarted).toBe(2);
    expect(payload.windowEnd).toBe(Date.parse("2026-07-10T00:00:00.000Z"));
    expect(loadTelemetrySettings().upstream?.lastRollupDayUtc).toBe("2026-07-09");

    expect(maybeEnqueueDailyRollup({ nowMs: NOW, env: {} })).toEqual({
      enqueued: false,
      reason: "up-to-date",
    });
    expect(listOutbox()).toHaveLength(1);
  });

  it("advances the marker on empty windows without enqueueing", () => {
    const res = maybeEnqueueDailyRollup({ nowMs: NOW, env: {} });
    expect(res).toEqual({ enqueued: false, reason: "empty-window" });
    expect(listOutbox()).toHaveLength(0);
    expect(loadTelemetrySettings().upstream?.lastRollupDayUtc).toBe("2026-07-09");
  });

  it("is gated off in local mode / by DNT / by channel", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-09T10:00:00.000Z" }));
    setTelemetryMode("local");
    expect(maybeEnqueueDailyRollup({ nowMs: NOW, env: {} }).reason).toBe("upstream-off");
    setTelemetryMode("standard");
    expect(maybeEnqueueDailyRollup({ nowMs: NOW, env: { DO_NOT_TRACK: "1" } }).reason).toBe(
      "upstream-off",
    );
    const s = loadTelemetrySettings();
    saveTelemetrySettings({
      ...s,
      consent: { ...s.consent, channels: { ...s.consent.channels, rollup: false } },
    });
    expect(maybeEnqueueDailyRollup({ nowMs: NOW, env: {} }).reason).toBe("channel-off");
    expect(listOutbox()).toHaveLength(0);
  });
});

describe("maybeEnqueueTodayRollup (temp root)", () => {
  const originalEnv = process.env.M0SAIC_ROOT;
  let fixture: string;

  beforeEach(() => {
    fixture = path.join(
      os.tmpdir(),
      `${M0SAIC_TMP_PREFIX}telemetry-today-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.M0SAIC_ROOT = fixture;
  });

  afterEach(() => {
    if (fs.existsSync(fixture)) fs.rmSync(fixture, { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.M0SAIC_ROOT;
    else process.env.M0SAIC_ROOT = originalEnv;
  });

  const TODAY_START = Date.parse("2026-07-10T00:00:00.000Z");
  const rollupPayload = (e: { payload: unknown }) =>
    e.payload as { windowStart: number; windowEnd: number; metrics: { rendersStarted: number } };

  it("enqueues today-so-far: window [todayStart, now), marker untouched, then up-to-date", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-10T09:00:00.000Z" }));
    appendRenderRecord(rec({ finishedAt: "2026-07-10T10:00:00.000Z" }));
    const first = maybeEnqueueTodayRollup({ nowMs: NOW, env: {} });
    expect(first.enqueued).toBe(true);
    expect(first.superseded).toBe(0);
    const queued = listOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].channel).toBe("rollup");
    expect(rollupPayload(queued[0])).toMatchObject({
      windowStart: TODAY_START,
      windowEnd: NOW,
      metrics: { rendersStarted: 2 },
    });
    expect(isPartialRollup(queued[0].payload)).toBe(true);
    expect(loadTelemetrySettings().upstream?.lastRollupDayUtc).toBeUndefined();

    expect(maybeEnqueueTodayRollup({ nowMs: NOW + 60_000, env: {} })).toEqual({
      enqueued: false,
      reason: "up-to-date",
    });
    expect(listOutbox()).toHaveLength(1);
  });

  it("a newer render supersedes the pending update: one pending, counts grow, backoff carried", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-10T09:00:00.000Z" }));
    maybeEnqueueTodayRollup({ nowMs: NOW, env: {} });
    const pending = listOutbox()[0];
    updateOutboxEntry({ ...pending, attempts: 2, nextAttemptAtMs: NOW + 7_200_000 });

    appendRenderRecord(rec({ finishedAt: "2026-07-10T12:30:00.000Z", outcome: "error_ffmpeg", ok: false }));
    const later = NOW + 3_600_000;
    const res = maybeEnqueueTodayRollup({ nowMs: later, env: {} });
    expect(res).toMatchObject({ enqueued: true, superseded: 1 });
    const queued = listOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].id).not.toBe(pending.id);
    expect(queued[0]).toMatchObject({ attempts: 2, nextAttemptAtMs: NOW + 7_200_000 });
    expect(rollupPayload(queued[0])).toMatchObject({
      windowStart: TODAY_START,
      windowEnd: later,
      metrics: { rendersStarted: 2 },
    });
  });

  it("counts a render finished in the same millisecond as the maintenance clock", () => {
    appendRenderRecord(rec({ finishedAt: new Date(NOW).toISOString() }));
    const res = maybeEnqueueTodayRollup({ nowMs: NOW, env: {} });
    expect(res.enqueued).toBe(true);
    expect(rollupPayload(listOutbox()[0]).metrics.rendersStarted).toBe(1);
  });

  it("a sent update counts as coverage until a newer render lands", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-10T09:00:00.000Z" }));
    maybeEnqueueTodayRollup({ nowMs: NOW, env: {} });
    markSent(listOutbox()[0], NOW);
    expect(maybeEnqueueTodayRollup({ nowMs: NOW + 1000, env: {} }).reason).toBe("up-to-date");
    appendRenderRecord(rec({ finishedAt: "2026-07-10T13:00:00.000Z" }));
    expect(maybeEnqueueTodayRollup({ nowMs: NOW + 7_200_000, env: {} }).enqueued).toBe(true);
    expect(listOutbox()).toHaveLength(1);
    expect(listSent()).toHaveLength(1);
  });

  it("reports empty-window with nothing rendered today, and is gated like the daily enqueue", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-09T10:00:00.000Z" }));
    expect(maybeEnqueueTodayRollup({ nowMs: NOW, env: {} })).toEqual({
      enqueued: false,
      reason: "empty-window",
    });
    appendRenderRecord(rec({ finishedAt: "2026-07-10T10:00:00.000Z" }));
    setTelemetryMode("local");
    expect(maybeEnqueueTodayRollup({ nowMs: NOW, env: {} }).reason).toBe("upstream-off");
    setTelemetryMode("standard");
    expect(maybeEnqueueTodayRollup({ nowMs: NOW, env: { DO_NOT_TRACK: "1" } }).reason).toBe(
      "upstream-off",
    );
    const s = loadTelemetrySettings();
    saveTelemetrySettings({
      ...s,
      consent: { ...s.consent, channels: { ...s.consent.channels, rollup: false } },
    });
    expect(maybeEnqueueTodayRollup({ nowMs: NOW, env: {} }).reason).toBe("channel-off");
    expect(listOutbox()).toHaveLength(0);
  });

  it("the next day's summary supersedes yesterday's pending update", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-09T10:00:00.000Z" }));
    const yesterdayNoon = Date.parse("2026-07-09T12:00:00.000Z");
    expect(maybeEnqueueTodayRollup({ nowMs: yesterdayNoon, env: {} }).enqueued).toBe(true);
    expect(listOutbox()).toHaveLength(1);

    const daily = maybeEnqueueDailyRollup({ nowMs: NOW, env: {} });
    expect(daily.enqueued).toBe(true);
    const queued = listOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].id).toBe(daily.entryId);
    expect(isPartialRollup(queued[0].payload)).toBe(false);
    expect(rollupPayload(queued[0])).toMatchObject({ windowEnd: TODAY_START, metrics: { rendersStarted: 1 } });
  });
});
