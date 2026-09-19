import { asInstallId } from "../identifiers/identifiers";
import {
  TELEMETRY_SETTINGS_SCHEMA_VERSION,
  defaultTelemetrySettings,
  isMosaicTelemetrySettingsFile,
} from "./settings";

const INSTALL = asInstallId("550e8400-e29b-41d4-a716-446655440000");
const NOW = "2026-07-10T00:00:00.000Z";

describe("defaultTelemetrySettings", () => {
  it("mints a standard-mode file with undecided consent (informed-consent tracking)", () => {
    const s = defaultTelemetrySettings(INSTALL, NOW);
    expect(s.schemaVersion).toBe(TELEMETRY_SETTINGS_SCHEMA_VERSION);
    expect(s.mode).toBe("standard");
    expect(s.consent.mode).toBe("undecided");
    expect(s.consent.installId).toBe(INSTALL);
    expect(s.createdAt).toBe(NOW);
    expect(s.consent.decidedAt).toBeUndefined();
    expect(s.firstRunNoticeAt).toBeUndefined();
    expect(s.lastSeenVersion).toBeUndefined();
  });

  it("carries the DEFAULT_ANALYTICS_CONSENT channel posture", () => {
    const s = defaultTelemetrySettings(INSTALL, NOW);
    expect(s.consent.channels).toEqual({
      rollup: true,
      errorReports: false,
      lifecycle: true,
    });
    expect(s.consent.scrambling).toBe("deterministic");
    expect(s.consent.redactions.filePaths).toBe("drop");
  });
});

describe("isMosaicTelemetrySettingsFile", () => {
  const valid = () => defaultTelemetrySettings(INSTALL, NOW);

  it("accepts a freshly-minted default file", () => {
    expect(isMosaicTelemetrySettingsFile(valid())).toBe(true);
  });

  it("accepts a file with optional bookkeeping fields set", () => {
    expect(
      isMosaicTelemetrySettingsFile({
        ...valid(),
        lastSeenVersion: "0.1.0",
        firstRunNoticeAt: NOW,
      }),
    ).toBe(true);
  });

  it("tolerates unknown extra fields (forward compatibility)", () => {
    expect(
      isMosaicTelemetrySettingsFile({ ...valid(), futureField: 42 }),
    ).toBe(true);
  });

  it("rejects non-objects and empty objects", () => {
    expect(isMosaicTelemetrySettingsFile(undefined)).toBe(false);
    expect(isMosaicTelemetrySettingsFile(null)).toBe(false);
    expect(isMosaicTelemetrySettingsFile("{}")).toBe(false);
    expect(isMosaicTelemetrySettingsFile({})).toBe(false);
  });

  it("rejects a wrong schemaVersion", () => {
    expect(isMosaicTelemetrySettingsFile({ ...valid(), schemaVersion: 2 })).toBe(
      false,
    );
  });

  it("rejects an invalid mode", () => {
    expect(
      isMosaicTelemetrySettingsFile({ ...valid(), mode: "local-only" }),
    ).toBe(false);
  });

  it("rejects a missing / malformed consent block", () => {
    const { consent: _dropped, ...noConsent } = valid();
    expect(isMosaicTelemetrySettingsFile(noConsent)).toBe(false);
    expect(
      isMosaicTelemetrySettingsFile({
        ...valid(),
        consent: { ...valid().consent, installId: "not-a-uuid" },
      }),
    ).toBe(false);
    expect(
      isMosaicTelemetrySettingsFile({
        ...valid(),
        consent: { ...valid().consent, mode: "maybe" },
      }),
    ).toBe(false);
    expect(
      isMosaicTelemetrySettingsFile({
        ...valid(),
        consent: { ...valid().consent, channels: undefined },
      }),
    ).toBe(false);
  });

  it("rejects a missing createdAt", () => {
    const { createdAt: _dropped, ...noCreatedAt } = valid();
    expect(isMosaicTelemetrySettingsFile(noCreatedAt)).toBe(false);
  });
});
