import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { asInstallId } from "@m0saic/types";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import { enqueueOutbox, listOutbox, listSent } from "./outbox";
import { appendRenderRecord } from "./recordStore";
import { setTelemetryMode } from "./settingsStore";
import {
  flushOutbox,
  resolveUpstreamEndpoint,
  resolveUpstreamIngestKey,
  runUpstreamMaintenance,
} from "./sender";
import { registerUpstreamDefaults, resetUpstreamDefaults } from "./upstreamDefaults";

const originalEnv = process.env.M0SAIC_ROOT;
let fixture: string;

beforeEach(() => {
  fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-sender-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const seed = () =>
  enqueueOutbox(
    {
      kind: "install_completed",
      installId: asInstallId("550e8400-e29b-41d4-a716-446655440000"),
      timestamp: 1,
      schemaVersion: 1,
      host: { os: "macos", arch: "arm64", mosaicVersion: "0.1" },
    },
    { channel: "immediate", nowMs: 1000 },
  );

const okFetch = (calls: Array<{ url: string; body: string }>) =>
  (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body) });
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;

describe("resolveUpstreamEndpoint", () => {
  it("env beats settings; absent means dormant", () => {
    expect(resolveUpstreamEndpoint({ env: {} })).toEqual({});
    expect(
      resolveUpstreamEndpoint({ env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x" } }),
    ).toEqual({ endpoint: "http://x", source: "env" });
  });
});

describe("flushOutbox", () => {
  it("is DORMANT with no endpoint: nothing sent, outbox untouched", async () => {
    seed();
    const res = await flushOutbox({ env: {}, nowMs: 5000 });
    expect(res).toMatchObject({ sent: 0, failed: 0, skipped: 1, reason: "dormant-no-endpoint" });
    expect(listOutbox()).toHaveLength(1);
    expect(listSent()).toHaveLength(0);
  });

  it("refuses to send under DNT even with an endpoint", async () => {
    seed();
    const calls: Array<{ url: string; body: string }> = [];
    const res = await flushOutbox({
      env: { DO_NOT_TRACK: "1", M0SAIC_TELEMETRY_ENDPOINT: "http://x" },
      fetchImpl: okFetch(calls),
      nowMs: 5000,
    });
    expect(res.reason).toBe("upstream-off");
    expect(calls).toHaveLength(0);
    expect(listOutbox()).toHaveLength(1);
  });

  it("refuses in local/ghost modes", async () => {
    seed();
    setTelemetryMode("local");
    const res = await flushOutbox({
      env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x" },
      nowMs: 5000,
    });
    expect(res.reason).toBe("upstream-off");
  });

  it("sends due entries, archives to sent/, and the posted body is the exact payload", async () => {
    const entry = seed();
    const calls: Array<{ url: string; body: string }> = [];
    const res = await flushOutbox({
      env: { M0SAIC_TELEMETRY_ENDPOINT: "http://ingest.local/t" },
      fetchImpl: okFetch(calls),
      nowMs: 5000,
    });
    expect(res).toMatchObject({ attempted: 1, sent: 1, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://ingest.local/t");
    expect(JSON.parse(calls[0].body)).toEqual(entry.payload);
    expect(listOutbox()).toHaveLength(0);
    expect(listSent()).toHaveLength(1);
    expect(listSent()[0].id).toBe(entry.id);
  });

  it("failure → exponential backoff, then respected on the next pass", async () => {
    seed();
    const failFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const first = await flushOutbox({
      env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x" },
      fetchImpl: failFetch,
      nowMs: 10_000,
    });
    expect(first).toMatchObject({ attempted: 1, failed: 1 });
    const entry = listOutbox()[0];
    expect(entry.attempts).toBe(1);
    expect(entry.nextAttemptAtMs).toBe(10_000 + 3_600_000);

    const second = await flushOutbox({
      env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x" },
      fetchImpl: failFetch,
      nowMs: 20_000, // before backoff expiry
    });
    expect(second).toMatchObject({ attempted: 0, skipped: 1 });
  });
});

describe("runUpstreamMaintenance", () => {
  it("enqueues lifecycle sync and never throws (flush disabled)", () => {
    runUpstreamMaintenance({ currentVersion: "0.1.0", env: {}, nowMs: 1000, flush: false });
    const kinds = listOutbox().map((e) => e.kind);
    expect(kinds).toContain("install_completed");
  });
});

type Captured = { url: string; body: string; headers: Record<string, string> };
const captureFetch = (calls: Captured[], status = 200) =>
  (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: String(init?.body),
      headers: { ...(init?.headers as Record<string, string>) },
    });
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as typeof fetch;

const seedRollup = (nowMs: number) =>
  enqueueOutbox(
    {
      kind: "rollup",
      installId: asInstallId("550e8400-e29b-41d4-a716-446655440000"),
      timestamp: nowMs,
      schemaVersion: 1,
      windowStart: 0,
      windowEnd: nowMs,
      host: { os: "macos", arch: "arm64", mosaicVersion: "0.2" },
      metrics: {
        rendersStarted: 1,
        rendersByOutcome: {
          ok: 1, cancelled: 0, error_plan_build: 0, error_validation: 0,
          error_ffmpeg: 0, error_template: 0, error_other: 0,
        },
        rendersByKind: { mosaic_document: 1, mosaic_pipeline: 0 },
        ffmpegInvocations: 1,
        renderDurationMsBuckets: [1, 0, 0, 0, 0, 0, 0],
        distinctTemplatesUsed: 1,
      },
    },
    { channel: "rollup", nowMs },
  );

describe("endpoint + key resolution", () => {
  afterEach(() => resetUpstreamDefaults());

  it("the off sentinel forces dormant; a registered default is the last fallback; env still wins", () => {
    expect(resolveUpstreamEndpoint({ env: { M0SAIC_TELEMETRY_ENDPOINT: "OFF" } })).toEqual({ source: "off" });
    registerUpstreamDefaults({ endpoint: "https://d.example/t", ingestKey: "k-default" });
    expect(resolveUpstreamEndpoint({ env: {} })).toEqual({ endpoint: "https://d.example/t", source: "default" });
    expect(resolveUpstreamEndpoint({ env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x" } })).toEqual({
      endpoint: "http://x",
      source: "env",
    });
    expect(resolveUpstreamIngestKey({ env: {} })).toBe("k-default");
    expect(resolveUpstreamIngestKey({ env: { M0SAIC_TELEMETRY_INGEST_KEY: " k-env " } })).toBe("k-env");
    resetUpstreamDefaults();
    expect(resolveUpstreamIngestKey({ env: {} })).toBeUndefined();
    expect(resolveUpstreamEndpoint({ env: {} })).toEqual({});
  });
});

describe("flushOutbox — headers, drop vs retry, circuit-break, gates", () => {
  afterEach(() => resetUpstreamDefaults());

  it("sends the event id + ingest key headers and the exact payload", async () => {
    const entry = seed();
    const calls: Captured[] = [];
    await flushOutbox({
      env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x", M0SAIC_TELEMETRY_INGEST_KEY: "k-env" },
      fetchImpl: captureFetch(calls),
      nowMs: 5000,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers).toEqual({
      "content-type": "application/json",
      "x-m0saic-event-id": entry.id,
      "x-m0saic-ingest-key": "k-env",
    });
    expect(JSON.parse(calls[0].body)).toEqual(entry.payload);
  });

  it("uses a registered default endpoint + key, and omits the key header when none resolves", async () => {
    seed();
    const calls: Captured[] = [];
    registerUpstreamDefaults({ endpoint: "https://d.example/t", ingestKey: "k-default" });
    const res = await flushOutbox({ env: {}, fetchImpl: captureFetch(calls), nowMs: 5000 });
    expect(res).toMatchObject({ sent: 1, endpoint: "https://d.example/t" });
    expect(calls[0].headers["x-m0saic-ingest-key"]).toBe("k-default");

    seed();
    resetUpstreamDefaults();
    const bare: Captured[] = [];
    await flushOutbox({ env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x" }, fetchImpl: captureFetch(bare), nowMs: 6000 });
    expect(bare[0].headers["x-m0saic-ingest-key"]).toBeUndefined();
  });

  it("the off sentinel is dormant even with a registered default", async () => {
    seed();
    registerUpstreamDefaults({ endpoint: "https://d.example/t" });
    const calls: Captured[] = [];
    const res = await flushOutbox({
      env: { M0SAIC_TELEMETRY_ENDPOINT: "off" },
      fetchImpl: captureFetch(calls),
      nowMs: 5000,
    });
    expect(res.reason).toBe("endpoint-off");
    expect(calls).toHaveLength(0);
    expect(listOutbox()).toHaveLength(1);
  });

  it("CI is exempt unless the operator pointed the sender somewhere via env", async () => {
    seed();
    registerUpstreamDefaults({ endpoint: "https://d.example/t" });
    const calls: Captured[] = [];
    expect((await flushOutbox({ env: { CI: "true" }, fetchImpl: captureFetch(calls), nowMs: 5000 })).reason).toBe(
      "ci-exempt",
    );
    expect(calls).toHaveLength(0);
    const explicit = await flushOutbox({
      env: { CI: "true", M0SAIC_TELEMETRY_ENDPOINT: "http://x" },
      fetchImpl: captureFetch(calls),
      nowMs: 5000,
    });
    expect(explicit.sent).toBe(1);
  });

  it("4xx for the body itself → archived as rejected, never retried", async () => {
    const entry = seed();
    const calls: Captured[] = [];
    const res = await flushOutbox({
      env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x" },
      fetchImpl: captureFetch(calls, 422),
      nowMs: 5000,
    });
    expect(res).toMatchObject({ attempted: 1, sent: 0, failed: 0, rejected: 1 });
    expect(listOutbox()).toHaveLength(0);
    expect(listSent()[0]).toMatchObject({ id: entry.id, rejected: { status: 422 } });
  });

  it("401 / 429 / 500 keep the payload and back off", async () => {
    for (const status of [401, 429, 500]) {
      seed();
      const res = await flushOutbox({
        env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x" },
        fetchImpl: captureFetch([], status),
        nowMs: 5000,
      });
      expect(res).toMatchObject({ attempted: 1, failed: 1, rejected: 0 });
      const pending = listOutbox();
      expect(pending).toHaveLength(1);
      expect(pending[0].attempts).toBe(1);
      expect(listSent()).toHaveLength(0);
      fs.rmSync(path.join(fixture, "telemetry", "outbox"), { recursive: true, force: true });
    }
  });

  it("a thrown fetch backs off that entry and ends the pass (one timeout, not one per entry)", async () => {
    seed();
    seedRollup(2000);
    let calls = 0;
    const dead = (async () => {
      calls++;
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const res = await flushOutbox({
      env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x" },
      fetchImpl: dead,
      nowMs: 5000,
    });
    expect(calls).toBe(1);
    expect(res).toMatchObject({ attempted: 1, failed: 1, skipped: 1 });
    const pending = listOutbox();
    expect(pending.map((e) => e.attempts)).toEqual([1, 0]);
  });

  it("deadlineMs bounds the pass", async () => {
    seed();
    seedRollup(2000);
    const calls: Captured[] = [];
    const res = await flushOutbox({
      env: { M0SAIC_TELEMETRY_ENDPOINT: "http://x" },
      fetchImpl: captureFetch(calls),
      nowMs: 5000,
      deadlineMs: -1,
    });
    expect(res).toMatchObject({ attempted: 0, skipped: 2 });
    expect(listOutbox()).toHaveLength(2);
  });
});

describe("runUpstreamMaintenance — today so far", () => {
  it("enqueues the running rollup for today after a render, alongside lifecycle", () => {
    const NOW = Date.parse("2026-07-10T12:00:00.000Z");
    appendRenderRecord({
      schemaVersion: 1,
      recordId: "r-today",
      surface: "cli",
      startedAt: "2026-07-10T11:00:00.000Z",
      finishedAt: "2026-07-10T11:00:00.000Z",
      elapsedMs: 800,
      ok: true,
      exitCode: 0,
      outcome: "ok",
      errors: [],
      warningsCount: 0,
    });
    runUpstreamMaintenance({ currentVersion: "0.2.0", env: {}, nowMs: NOW, flush: false });
    const queued = listOutbox();
    expect(queued.map((e) => e.kind).sort()).toEqual(["install_completed", "rollup"]);
    const rollup = queued.find((e) => e.kind === "rollup")!.payload as { windowStart: number; windowEnd: number };
    expect(rollup).toMatchObject({ windowStart: Date.parse("2026-07-10T00:00:00.000Z"), windowEnd: NOW });
  });
});
