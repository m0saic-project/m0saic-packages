import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { MosaicAnalyticsRollupEvent, MosaicRenderRecord } from "@m0saic/types";
import { asInstallId, defaultTelemetrySettings } from "@m0saic/types";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import { listOutbox } from "./outbox";
import { UPSTREAM_FIELD_ANNOTATIONS, UPSTREAM_NEVER_SENT, UPSTREAM_ROLLUP_CADENCE, buildUpstreamPreview } from "./preview";
import { appendRenderRecord } from "./recordStore";
import { buildRollupEvent, maybeEnqueueDailyRollup, maybeEnqueueTodayRollup } from "./rollup";
import { runUpstreamMaintenance } from "./sender";
import { loadTelemetrySettings } from "./settingsStore";
import { recordFeatureUsage } from "./usageRecorder";

const originalEnv = process.env.M0SAIC_ROOT;
let fixture: string;

beforeEach(() => {
  fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-rollup-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const INSTALL = asInstallId("550e8400-e29b-41d4-a716-446655440000");
const CONSENT = defaultTelemetrySettings(INSTALL, "2026-07-01T00:00:00.000Z").consent;
const HOST = { os: "macos" as const, arch: "arm64", mosaicVersion: "0.1" };
const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const TODAY_START = Date.parse("2026-07-10T00:00:00.000Z");
const YESTERDAY_10 = Date.parse("2026-07-09T10:00:00.000Z");

let seq = 0;
const rec = (over: Partial<MosaicRenderRecord> = {}): MosaicRenderRecord => {
  seq++;
  const finishedAt = over.finishedAt ?? "2026-07-10T09:00:00.000Z";
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
    versions: { mosaic: "0.1.0" },
    errors: [],
    warningsCount: 0,
    ...over,
  };
};
const feature = (atMs: number, key = "page.make") =>
  recordFeatureUsage({ surface: "app", feature: key, env: {}, nowMs: atMs });
const rollups = () =>
  listOutbox().filter((e) => e.payload.kind === "rollup").map((e) => e.payload as MosaicAnalyticsRollupEvent);

describe("buildRollupEvent with usage", () => {
  it("spreads the tally into metrics, and adds nothing for an empty tally", () => {
    const withUsage = buildRollupEvent({
      records: [rec()],
      usage: [
        { schemaVersion: 1, atMs: NOW, surface: "app", feature: "page.make" },
        { schemaVersion: 1, atMs: NOW, surface: "app", feature: "template.open.builtin", templateId: "@m0saic/a/b/v1", templateKind: "builtin" },
        { schemaVersion: 1, atMs: NOW, surface: "app", feature: "share.layout.copy" },
      ],
      windowStartMs: 0, windowEndMs: 1000, consent: CONSENT, host: HOST, timestampMs: NOW,
    });
    expect(withUsage?.metrics.rendersStarted).toBe(1);
    expect(withUsage?.metrics.features).toEqual({ "page.make": 1, "template.open.builtin": 1, "share.layout.copy": 1 });
    expect(withUsage?.metrics.templatesUsed).toEqual({ "@m0saic/a/b/v1": 1 });
    expect(withUsage?.metrics).not.toHaveProperty("layoutShapes");

    const without = buildRollupEvent({ records: [rec()], windowStartMs: 0, windowEndMs: 1000, consent: CONSENT, host: HOST, timestampMs: NOW });
    expect(without?.metrics).not.toHaveProperty("features");
    expect(without?.metrics).not.toHaveProperty("templatesUsed");
    expect(without?.metrics).not.toHaveProperty("layoutShapes");
  });
});

describe("maybeEnqueueDailyRollup with usage", () => {
  it("a feature-only day is activity: it enqueues (zero renders), with the host's own version", () => {
    feature(YESTERDAY_10);
    feature(YESTERDAY_10 + 1000, "template.open.community");
    const res = maybeEnqueueDailyRollup({ nowMs: NOW, env: {}, currentVersion: "0.2.0" });
    expect(res.enqueued).toBe(true);
    const [payload] = rollups();
    expect(payload.windowStart).toBe(Date.parse("2026-07-09T00:00:00.000Z"));
    expect(payload.windowEnd).toBe(TODAY_START);
    expect(payload.metrics.rendersStarted).toBe(0);
    expect(payload.metrics.features).toEqual({ "page.make": 1, "template.open.community": 1 });
    expect(payload.host.mosaicVersion).toBe("0.2");
    expect(maybeEnqueueDailyRollup({ nowMs: NOW, env: {}, currentVersion: "0.2.0" })).toMatchObject({ enqueued: false, reason: "up-to-date" });
    expect(loadTelemetrySettings().upstream?.lastRollupDayUtc).toBe("2026-07-09");
  });

  it("a rendered day keeps the newest record's version over the host fallback", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-09T10:00:00.000Z", versions: { mosaic: "0.1.5" } }));
    feature(YESTERDAY_10);
    maybeEnqueueDailyRollup({ nowMs: NOW, env: {}, currentVersion: "0.2.0" });
    expect(rollups()[0].host.mosaicVersion).toBe("0.1");
  });

  it("still advances the marker on a truly empty window", () => {
    expect(maybeEnqueueDailyRollup({ nowMs: NOW, env: {}, currentVersion: "0.2.0" })).toMatchObject({ enqueued: false, reason: "empty-window" });
    expect(loadTelemetrySettings().upstream?.lastRollupDayUtc).toBe("2026-07-09");
  });
});

describe("maybeEnqueueTodayRollup with usage", () => {
  it("feature-only today enqueues; a later feature use supersedes; then up-to-date", () => {
    feature(TODAY_START + 3_600_000);
    expect(maybeEnqueueTodayRollup({ nowMs: NOW, env: {}, currentVersion: "0.2.0" })).toMatchObject({ enqueued: true });
    expect(rollups()[0]).toMatchObject({ windowStart: TODAY_START, windowEnd: NOW, metrics: { rendersStarted: 0, features: { "page.make": 1 } } });
    expect(rollups()[0].host.mosaicVersion).toBe("0.2");

    feature(NOW + 60_000);
    const later = NOW + 120_000;
    expect(maybeEnqueueTodayRollup({ nowMs: later, env: {}, currentVersion: "0.2.0" })).toMatchObject({ enqueued: true, superseded: 1 });
    expect(rollups()).toHaveLength(1);
    expect(rollups()[0]).toMatchObject({ windowEnd: later, metrics: { features: { "page.make": 2 } } });

    expect(maybeEnqueueTodayRollup({ nowMs: later + 1000, env: {}, currentVersion: "0.2.0" })).toMatchObject({ enqueued: false, reason: "up-to-date" });
  });

  it("a template open after the last render is new activity", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-10T09:00:00.000Z" }));
    maybeEnqueueTodayRollup({ nowMs: NOW, env: {}, currentVersion: "0.2.0" });
    expect(maybeEnqueueTodayRollup({ nowMs: NOW + 1000, env: {}, currentVersion: "0.2.0" })).toMatchObject({ enqueued: false, reason: "up-to-date" });
    feature(NOW + 1_800_000, "template.open.builtin");
    const res = maybeEnqueueTodayRollup({ nowMs: NOW + 3_600_000, env: {}, currentVersion: "0.2.0" });
    expect(res).toMatchObject({ enqueued: true, superseded: 1 });
    expect(rollups()[0].metrics).toMatchObject({ rendersStarted: 1, features: { "template.open.builtin": 1 } });
  });
});

describe("runUpstreamMaintenance threads the host version", () => {
  it("a feature-only yesterday reaches the outbox as a rollup stamped with currentVersion", () => {
    feature(YESTERDAY_10);
    runUpstreamMaintenance({ currentVersion: "0.3.1", env: {}, nowMs: NOW, flush: false });
    const summaries = rollups().filter((p) => p.windowEnd === TODAY_START);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].host.mosaicVersion).toBe("0.3");
    expect(summaries[0].metrics.features).toEqual({ "page.make": 1 });
  });
});

describe("buildUpstreamPreview with usage", () => {
  it("both rollup previews carry usage on render-free days, with the host's version", () => {
    feature(YESTERDAY_10);
    feature(TODAY_START + 3_600_000, "page.layout");
    const p = buildUpstreamPreview({ nowMs: NOW, env: {}, currentVersion: "0.2.0" });
    expect(p.nextRollup?.metrics).toMatchObject({ rendersStarted: 0, features: { "page.make": 1 } });
    expect(p.nextRollup?.host.mosaicVersion).toBe("0.2");
    expect(p.nextRollupWindow).toEqual({ windowStart: Date.parse("2026-07-09T00:00:00.000Z"), windowEnd: TODAY_START, records: 0 });
    expect(p.todayRollup?.metrics).toMatchObject({ rendersStarted: 0, features: { "page.layout": 1 } });
    expect(p.todayRollup?.host.mosaicVersion).toBe("0.2");
  });

  it("annotates every usage field and the never-sent copy names layout strings", () => {
    for (const key of ["metrics.features", "metrics.templatesUsed"]) {
      expect(UPSTREAM_FIELD_ANNOTATIONS[key]).toEqual(expect.any(String));
    }
    expect(UPSTREAM_NEVER_SENT.some((line) => line.includes("layout strings") && line.includes("share"))).toBe(true);
    expect(UPSTREAM_ROLLUP_CADENCE).toContain("feature");
  });
});
