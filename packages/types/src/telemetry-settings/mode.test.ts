import {
  DEFAULT_TELEMETRY_MODE,
  MOSAIC_TELEMETRY_MODES,
  isLocalRecordingEnabled,
  isMosaicTelemetryMode,
  isUpstreamAllowed,
  normalizeTelemetryModeInput,
  resolveEffectiveTelemetryMode,
} from "./mode";

describe("isMosaicTelemetryMode", () => {
  it("accepts every canonical mode", () => {
    for (const m of MOSAIC_TELEMETRY_MODES) {
      expect(isMosaicTelemetryMode(m)).toBe(true);
    }
  });

  it("rejects aliases, junk, and non-strings", () => {
    expect(isMosaicTelemetryMode("local-only")).toBe(false);
    expect(isMosaicTelemetryMode("Standard")).toBe(false);
    expect(isMosaicTelemetryMode("")).toBe(false);
    expect(isMosaicTelemetryMode(undefined)).toBe(false);
    expect(isMosaicTelemetryMode(1)).toBe(false);
  });
});

describe("normalizeTelemetryModeInput", () => {
  it("passes canonical values through", () => {
    expect(normalizeTelemetryModeInput("standard")).toBe("standard");
    expect(normalizeTelemetryModeInput("local")).toBe("local");
    expect(normalizeTelemetryModeInput("ghost")).toBe("ghost");
  });

  it("accepts the local-only alias and mixed case", () => {
    expect(normalizeTelemetryModeInput("local-only")).toBe("local");
    expect(normalizeTelemetryModeInput("Local-Only")).toBe("local");
    expect(normalizeTelemetryModeInput(" GHOST ")).toBe("ghost");
  });

  it("returns undefined for anything else", () => {
    expect(normalizeTelemetryModeInput("off")).toBeUndefined();
    expect(normalizeTelemetryModeInput("")).toBeUndefined();
    expect(normalizeTelemetryModeInput("locals")).toBeUndefined();
  });
});

describe("resolveEffectiveTelemetryMode", () => {
  it("defaults to standard from nothing", () => {
    expect(resolveEffectiveTelemetryMode({})).toEqual({
      mode: DEFAULT_TELEMETRY_MODE,
      source: "default",
      dntDegraded: false,
    });
  });

  it("file mode beats the default", () => {
    expect(resolveEffectiveTelemetryMode({ fileMode: "ghost" })).toEqual({
      mode: "ghost",
      source: "file",
      dntDegraded: false,
    });
  });

  it("env mode beats the file mode", () => {
    expect(
      resolveEffectiveTelemetryMode({ fileMode: "standard", envMode: "ghost" }),
    ).toEqual({ mode: "ghost", source: "env", dntDegraded: false });
  });

  it("env accepts the local-only alias", () => {
    expect(
      resolveEffectiveTelemetryMode({ fileMode: "standard", envMode: "local-only" }),
    ).toEqual({ mode: "local", source: "env", dntDegraded: false });
  });

  it("an unparseable env value is ignored, falling to the file mode", () => {
    expect(
      resolveEffectiveTelemetryMode({ fileMode: "local", envMode: "bogus" }),
    ).toEqual({ mode: "local", source: "file", dntDegraded: false });
  });

  it("DO_NOT_TRACK degrades standard to local without changing the source", () => {
    expect(
      resolveEffectiveTelemetryMode({ fileMode: "standard", doNotTrack: "1" }),
    ).toEqual({ mode: "local", source: "file", dntDegraded: true });
    expect(resolveEffectiveTelemetryMode({ doNotTrack: "true" })).toEqual({
      mode: "local",
      source: "default",
      dntDegraded: true,
    });
    expect(resolveEffectiveTelemetryMode({ doNotTrack: "TRUE" }).mode).toBe(
      "local",
    );
  });

  it("DO_NOT_TRACK leaves local and ghost untouched", () => {
    expect(
      resolveEffectiveTelemetryMode({ fileMode: "local", doNotTrack: "1" }),
    ).toEqual({ mode: "local", source: "file", dntDegraded: false });
    expect(
      resolveEffectiveTelemetryMode({ fileMode: "ghost", doNotTrack: "1" }),
    ).toEqual({ mode: "ghost", source: "file", dntDegraded: false });
  });

  it("unset / falsy DO_NOT_TRACK values do not degrade", () => {
    for (const v of [undefined, "", "0", "false", "no"]) {
      expect(
        resolveEffectiveTelemetryMode({ fileMode: "standard", doNotTrack: v })
          .dntDegraded,
      ).toBe(false);
    }
  });

  it("DO_NOT_TRACK also degrades an env-forced standard", () => {
    expect(
      resolveEffectiveTelemetryMode({
        fileMode: "ghost",
        envMode: "standard",
        doNotTrack: "1",
      }),
    ).toEqual({ mode: "local", source: "env", dntDegraded: true });
  });
});

describe("mode axis helpers", () => {
  it("standard and local record locally; ghost does not", () => {
    expect(isLocalRecordingEnabled("standard")).toBe(true);
    expect(isLocalRecordingEnabled("local")).toBe(true);
    expect(isLocalRecordingEnabled("ghost")).toBe(false);
  });

  it("only standard allows upstream", () => {
    expect(isUpstreamAllowed("standard")).toBe(true);
    expect(isUpstreamAllowed("local")).toBe(false);
    expect(isUpstreamAllowed("ghost")).toBe(false);
  });
});
