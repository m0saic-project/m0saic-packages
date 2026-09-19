import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import { loadTelemetrySettings, setTelemetryMode } from "./settingsStore";
import { recordFeatureUsage } from "./usageRecorder";
import { countUsageRecords, listUsageRecordsInWindow } from "./usageStore";

const originalEnv = process.env.M0SAIC_ROOT;
let fixture: string;

beforeEach(() => {
  fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-usage-rec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const NOW = Date.parse("2026-07-10T12:34:56.789Z");
const telemetryDir = () => path.join(fixture, "telemetry");

describe("recordFeatureUsage", () => {
  it("writes one usage line and returns it", () => {
    const r = recordFeatureUsage({ surface: "app", feature: "page.make", env: {}, nowMs: NOW });
    expect(r).toEqual({ schemaVersion: 1, atMs: NOW, surface: "app", feature: "page.make" });
    expect(listUsageRecordsInWindow(0, NOW + 1)).toEqual([r]);
  });

  it("is inert in ghost mode: nothing on disk, not even settings", () => {
    const r = recordFeatureUsage({ surface: "cli", feature: "cli.command.make", env: { M0SAIC_TELEMETRY: "ghost" }, nowMs: NOW });
    expect(r).toBeNull();
    expect(fs.existsSync(telemetryDir())).toBe(false);
  });

  it("still records in local-only mode (the rollup decides what leaves)", () => {
    setTelemetryMode("local");
    expect(recordFeatureUsage({ surface: "app", feature: "page.layout", env: {}, nowMs: NOW })).not.toBeNull();
    expect(countUsageRecords()).toBe(1);
  });

  it("drops anything that is not key-shaped, without touching the store", () => {
    for (const bad of ["Page.Make", "page", "page.make/x", "/Users/me/file.mp4", "x".repeat(50)]) {
      expect(recordFeatureUsage({ surface: "app", feature: bad, env: {}, nowMs: NOW })).toBeNull();
    }
    expect(fs.existsSync(path.join(telemetryDir(), "usage"))).toBe(false);
  });

  it("keeps a template id only for builtin provenance with a first-party shape", () => {
    const builtin = recordFeatureUsage({
      surface: "app", feature: "template.open.builtin", templateId: "@m0saic/hero/github/v1", templateKind: "builtin", env: {}, nowMs: NOW,
    });
    expect(builtin).toMatchObject({ templateId: "@m0saic/hero/github/v1", templateKind: "builtin" });
    const community = recordFeatureUsage({
      surface: "app", feature: "template.open.community", templateId: "@m0saic/hero/github/v1", templateKind: "community", env: {}, nowMs: NOW,
    });
    expect(community).toEqual({ schemaVersion: 1, atMs: NOW, surface: "app", feature: "template.open.community", templateKind: "community" });
    const foreign = recordFeatureUsage({
      surface: "app", feature: "template.open.builtin", templateId: "@m0saic-dev/hero/x/v1", templateKind: "builtin", env: {}, nowMs: NOW,
    });
    expect(foreign).not.toHaveProperty("templateId");
    expect(JSON.stringify(listUsageRecordsInWindow(0, NOW + 1))).not.toContain("@m0saic-dev");
  });

  it("never throws: an append failure reports null", () => {
    const r = recordFeatureUsage({
      surface: "app", feature: "page.make", env: {}, nowMs: NOW,
      append: () => { throw new Error("disk full"); },
    });
    expect(r).toBeNull();
  });
});

describe("channel defaults", () => {
  it("a fresh settings file carries exactly the three channels", () => {
    expect(loadTelemetrySettings().consent.channels).toEqual({ rollup: true, errorReports: false, lifecycle: true });
  });
});
