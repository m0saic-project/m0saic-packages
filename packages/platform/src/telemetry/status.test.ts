import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isInstallId } from "@m0saic/types";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import { appendRenderRecord } from "./recordStore";
import {
  markFirstRunNoticeShown,
  setTelemetryMode,
} from "./settingsStore";
import { getTelemetryStatus } from "./status";
import { registerUpstreamDefaults, resetUpstreamDefaults } from "./upstreamDefaults";

const originalEnv = process.env.M0SAIC_ROOT;
let fixture: string;

beforeEach(() => {
  fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-status-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("getTelemetryStatus", () => {
  it("pristine root: mints settings and reports zero counts", () => {
    const s = getTelemetryStatus({});
    expect(s.effective).toEqual({
      mode: "standard",
      source: "file",
      dntDegraded: false,
    });
    expect(s.fileMode).toBe("standard");
    expect(isInstallId(s.installId)).toBe(true);
    expect(s.firstRunNoticeShown).toBe(false);
    expect(s.counts).toEqual({ total: 0, byOutcome: {}, usageEvents: 0 });
    expect(s.paths.root).toBe(path.join(fixture, "telemetry"));
    expect(s.paths.settingsFile.endsWith("settings.json")).toBe(true);
    expect(s.outbox).toEqual({ pending: 0, sentArchived: 0 });
    expect(s.endpoint).toEqual({ configured: false });
  });

  it("reports a configured endpoint from env", () => {
    const s = getTelemetryStatus({ M0SAIC_TELEMETRY_ENDPOINT: "http://x" });
    expect(s.endpoint).toEqual({ configured: true, source: "env" });
  });

  it("reports a host-registered default, and the off sentinel beats it", () => {
    registerUpstreamDefaults({ endpoint: "https://ingest.example/api/telemetry" });
    try {
      expect(getTelemetryStatus({}).endpoint).toEqual({ configured: true, source: "default" });
      expect(getTelemetryStatus({ M0SAIC_TELEMETRY_ENDPOINT: "off" }).endpoint).toEqual({
        configured: false,
        source: "off",
      });
    } finally {
      resetUpstreamDefaults();
    }
  });

  it("reflects the persisted mode and env override separately", () => {
    setTelemetryMode("ghost");
    const s = getTelemetryStatus({ M0SAIC_TELEMETRY: "standard" });
    expect(s.fileMode).toBe("ghost");
    expect(s.effective).toEqual({
      mode: "standard",
      source: "env",
      dntDegraded: false,
    });
  });

  it("shows DNT degradation", () => {
    const s = getTelemetryStatus({ DO_NOT_TRACK: "1" });
    expect(s.effective.mode).toBe("local");
    expect(s.effective.dntDegraded).toBe(true);
  });

  it("counts appended records and disk usage", () => {
    appendRenderRecord({
      schemaVersion: 1,
      recordId: "r1",
      surface: "cli",
      startedAt: "2026-07-10T00:00:00.000Z",
      finishedAt: "2026-07-10T00:00:01.000Z",
      elapsedMs: 1000,
      ok: true,
      exitCode: 0,
      outcome: "ok",
      errors: [],
      warningsCount: 0,
    });
    const s = getTelemetryStatus({});
    expect(s.counts.total).toBe(1);
    expect(s.counts.byOutcome.ok).toBe(1);
    expect(s.disk.files).toBeGreaterThanOrEqual(2); // settings.json + month file
    expect(s.disk.bytes).toBeGreaterThan(0);
  });

  it("reports the notice as shown after marking", () => {
    markFirstRunNoticeShown();
    expect(getTelemetryStatus({}).firstRunNoticeShown).toBe(true);
  });
});
