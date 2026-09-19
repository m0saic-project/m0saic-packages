import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isInstallId } from "@m0saic/types";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import { getTelemetrySettingsPath } from "./paths";
import {
  getEffectiveTelemetryMode,
  loadTelemetrySettings,
  markFirstRunNoticeShown,
  saveTelemetrySettings,
  setTelemetryMode,
} from "./settingsStore";

const originalEnv = process.env.M0SAIC_ROOT;
let fixture: string;

beforeEach(() => {
  fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("loadTelemetrySettings", () => {
  it("mints a default file with a valid installId on first touch", () => {
    const s = loadTelemetrySettings();
    expect(s.mode).toBe("standard");
    expect(s.consent.mode).toBe("undecided");
    expect(isInstallId(s.consent.installId)).toBe(true);
    expect(fs.existsSync(getTelemetrySettingsPath())).toBe(true);
  });

  it("is stable: the second load returns the same installId", () => {
    const first = loadTelemetrySettings();
    const second = loadTelemetrySettings();
    expect(second.consent.installId).toBe(first.consent.installId);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("round-trips through saveTelemetrySettings", () => {
    const s = loadTelemetrySettings();
    saveTelemetrySettings({ ...s, lastSeenVersion: "0.1.0" });
    expect(loadTelemetrySettings().lastSeenVersion).toBe("0.1.0");
  });

  it("recovers from corrupt JSON: .bak + fresh mint (new installId)", () => {
    const first = loadTelemetrySettings();
    fs.writeFileSync(getTelemetrySettingsPath(), "{not json", "utf8");
    const second = loadTelemetrySettings();
    expect(isInstallId(second.consent.installId)).toBe(true);
    expect(second.consent.installId).not.toBe(first.consent.installId);
    expect(fs.existsSync(`${getTelemetrySettingsPath()}.bak`)).toBe(true);
  });

  it("recovers from structurally-invalid JSON the same way", () => {
    loadTelemetrySettings();
    fs.writeFileSync(
      getTelemetrySettingsPath(),
      JSON.stringify({ schemaVersion: 99, mode: "loud" }),
      "utf8",
    );
    const s = loadTelemetrySettings();
    expect(s.mode).toBe("standard");
    expect(fs.existsSync(`${getTelemetrySettingsPath()}.bak`)).toBe(true);
  });
});

describe("setTelemetryMode", () => {
  it("standard keeps consent opted-in and stamps decidedAt", () => {
    const s = setTelemetryMode("standard", "2026-07-10T01:00:00.000Z");
    expect(s.mode).toBe("standard");
    expect(s.consent.mode).toBe("opted-in");
    expect(s.consent.decidedAt).toBe("2026-07-10T01:00:00.000Z");
  });

  it("local and ghost flip consent to opted-out", () => {
    expect(setTelemetryMode("local").consent.mode).toBe("opted-out");
    expect(setTelemetryMode("ghost").consent.mode).toBe("opted-out");
  });

  it("persists: a later load sees the new mode", () => {
    setTelemetryMode("ghost");
    expect(loadTelemetrySettings().mode).toBe("ghost");
  });

  it("preserves installId across mode flips", () => {
    const before = loadTelemetrySettings().consent.installId;
    setTelemetryMode("local");
    setTelemetryMode("standard");
    expect(loadTelemetrySettings().consent.installId).toBe(before);
  });
});

describe("markFirstRunNoticeShown", () => {
  it("stamps once and is idempotent (first stamp wins)", () => {
    const first = markFirstRunNoticeShown("2026-07-10T02:00:00.000Z");
    expect(first.firstRunNoticeAt).toBe("2026-07-10T02:00:00.000Z");
    const second = markFirstRunNoticeShown("2026-07-11T02:00:00.000Z");
    expect(second.firstRunNoticeAt).toBe("2026-07-10T02:00:00.000Z");
  });
});

describe("getEffectiveTelemetryMode", () => {
  it("reads the file mode when no env override", () => {
    setTelemetryMode("local");
    expect(getEffectiveTelemetryMode({})).toEqual({
      mode: "local",
      source: "file",
      dntDegraded: false,
    });
  });

  it("a valid env override short-circuits WITHOUT touching the file", () => {
    const eff = getEffectiveTelemetryMode({ M0SAIC_TELEMETRY: "ghost" });
    expect(eff).toEqual({ mode: "ghost", source: "env", dntDegraded: false });
    expect(fs.existsSync(getTelemetrySettingsPath())).toBe(false);
  });

  it("accepts the local-only alias from env", () => {
    expect(getEffectiveTelemetryMode({ M0SAIC_TELEMETRY: "local-only" }).mode).toBe(
      "local",
    );
  });

  it("an invalid env value falls through to the file (and mints it)", () => {
    const eff = getEffectiveTelemetryMode({ M0SAIC_TELEMETRY: "bogus" });
    expect(eff.source).not.toBe("env");
    expect(fs.existsSync(getTelemetrySettingsPath())).toBe(true);
  });

  it("DO_NOT_TRACK degrades standard to local", () => {
    setTelemetryMode("standard");
    expect(getEffectiveTelemetryMode({ DO_NOT_TRACK: "1" })).toEqual({
      mode: "local",
      source: "file",
      dntDegraded: true,
    });
  });

  it("DO_NOT_TRACK leaves ghost alone (env path too)", () => {
    expect(
      getEffectiveTelemetryMode({ M0SAIC_TELEMETRY: "ghost", DO_NOT_TRACK: "1" }),
    ).toEqual({ mode: "ghost", source: "env", dntDegraded: false });
  });
});
