import { asInstallId } from "../identifiers/identifiers";
import {
  DEFAULT_ANALYTICS_CONSENT,
  isAnalyticsEmissionEnabled,
  type MosaicAnalyticsConsent,
} from "./consent";

const INSTALL = asInstallId("550e8400-e29b-41d4-a716-446655440000");

describe("DEFAULT_ANALYTICS_CONSENT", () => {
  it("starts undecided to mark that the user hasn't actively engaged with telemetry settings", () => {
    const c = DEFAULT_ANALYTICS_CONSENT(INSTALL);
    expect(c.mode).toBe("undecided");
    expect(c.installId).toBe(INSTALL);
    expect(c.decidedAt).toBeUndefined();
  });

  it("emits per defaults from an undecided install (opt-out, not opt-in, model)", () => {
    const c = DEFAULT_ANALYTICS_CONSENT(INSTALL);
    expect(isAnalyticsEmissionEnabled(c)).toBe(true);
  });

  it("defaults rollup + lifecycle on, error reports off", () => {
    const c = DEFAULT_ANALYTICS_CONSENT(INSTALL);
    expect(c.channels.rollup).toBe(true);
    expect(c.channels.lifecycle).toBe(true);
    expect(c.channels.errorReports).toBe(false);
  });

  it("defaults to deterministic scrambling", () => {
    expect(DEFAULT_ANALYTICS_CONSENT(INSTALL).scrambling).toBe("deterministic");
  });

  it("defaults to the most-private redaction treatments", () => {
    const c = DEFAULT_ANALYTICS_CONSENT(INSTALL);
    expect(c.redactions.templateIds).toBe("scramble");
    expect(c.redactions.filePaths).toBe("drop");
    expect(c.redactions.errorMessages).toBe("drop");
    expect(c.redactions.ffmpegArgs).toBe("drop");
    expect(c.redactions.stderrLines).toBe("drop");
  });
});

describe("isAnalyticsEmissionEnabled", () => {
  const at = (mode: MosaicAnalyticsConsent["mode"]): MosaicAnalyticsConsent => ({
    ...DEFAULT_ANALYTICS_CONSENT(INSTALL),
    mode,
  });

  it("permits emission when the install is undecided (opt-out model)", () => {
    expect(isAnalyticsEmissionEnabled(at("undecided"))).toBe(true);
  });

  it("permits emission when the install is opted-in", () => {
    expect(isAnalyticsEmissionEnabled(at("opted-in"))).toBe(true);
  });

  it("blocks emission only when the install is opted-out", () => {
    expect(isAnalyticsEmissionEnabled(at("opted-out"))).toBe(false);
  });
});
