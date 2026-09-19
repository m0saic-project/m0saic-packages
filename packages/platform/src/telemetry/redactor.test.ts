import type {
  MosaicRenderRecord,
  MosaicTelemetryEvent,
  MosaicTelemetrySettingsFile,
} from "@m0saic/types";
import {
  asInstallId,
  asSpanId,
  asTraceId,
  defaultTelemetrySettings,
} from "@m0saic/types";
import { createInstallScrambler } from "./scrambler";
import {
  buildErrorReportFromRecord,
  codeChainStackHash,
  createTelemetryRedactor,
  maybeEnqueueErrorReportForRecord,
} from "./redactor";

const INSTALL = asInstallId("550e8400-e29b-41d4-a716-446655440000");
const HOST = { os: "macos" as const, arch: "arm64", mosaicVersion: "0.1" };
const SCRAMBLER = createInstallScrambler(INSTALL);

const settingsWith = (
  over: Partial<{ errorReports: boolean; mode: MosaicTelemetrySettingsFile["mode"] }>,
): MosaicTelemetrySettingsFile => {
  const s = defaultTelemetrySettings(INSTALL, "2026-07-01T00:00:00.000Z");
  return {
    ...s,
    mode: over.mode ?? "standard",
    consent: {
      ...s.consent,
      channels: { ...s.consent.channels, errorReports: over.errorReports ?? true },
    },
  };
};

const commandEnd = (exitCode: number): MosaicTelemetryEvent => ({
  kind: "runtime_command_end",
  tier: "m0saic",
  level: "info",
  category: "engine.runtime",
  traceId: asTraceId("550e8400-e29b-41d4-a716-446655440000"),
  spanId: asSpanId("650e8400-e29b-41d4-a716-446655440000"),
  timestamp: 1234,
  payload: {
    index: 0,
    total: 1,
    exitCode,
    elapsedMs: 50,
    ...(exitCode !== 0
      ? {
          failure: {
            kind: "missing-codec" as const,
            summary: "Unknown encoder",
            hints: [],
          },
        }
      : {}),
  },
});

const RECORD = (over: Partial<MosaicRenderRecord> = {}): MosaicRenderRecord => ({
  schemaVersion: 1,
  recordId: "r1",
  surface: "cli",
  startedAt: "2026-07-10T00:00:00.000Z",
  finishedAt: "2026-07-10T00:00:01.000Z",
  elapsedMs: 1000,
  ok: false,
  exitCode: 1,
  outcome: "error_ffmpeg",
  errorClass: "ffmpeg_unknown_encoder",
  ffmpegFailureKind: "missing-codec",
  versions: { mosaic: "0.1.0", ffmpeg: "8.0" },
  errors: [{ code: "FFMPEG_EXIT", message: "boom" }],
  warningsCount: 0,
  ...over,
});

describe("createTelemetryRedactor (the published contract)", () => {
  const redact = createTelemetryRedactor(HOST);

  it("maps a failed command_end onto error_report via the failure kind", () => {
    const out = redact(commandEnd(234), settingsWith({}).consent, SCRAMBLER);
    expect(out).toEqual({
      kind: "error_report",
      installId: INSTALL,
      timestamp: 1234,
      schemaVersion: 1,
      host: HOST,
      errorClass: "ffmpeg_unknown_encoder",
      ffmpegExitCode: 234,
      stackHash: "",
    });
  });

  it("is pure: same input → same output", () => {
    const consent = settingsWith({}).consent;
    expect(redact(commandEnd(234), consent, SCRAMBLER)).toEqual(
      redact(commandEnd(234), consent, SCRAMBLER),
    );
  });

  it("returns null for successful events, opted-out installs, and channel-off", () => {
    expect(redact(commandEnd(0), settingsWith({}).consent, SCRAMBLER)).toBeNull();
    expect(
      redact(
        commandEnd(234),
        { ...settingsWith({}).consent, mode: "opted-out" },
        SCRAMBLER,
      ),
    ).toBeNull();
    expect(
      redact(commandEnd(234), settingsWith({ errorReports: false }).consent, SCRAMBLER),
    ).toBeNull();
  });
});

describe("buildErrorReportFromRecord", () => {
  it("builds the exact payload from a failed record", () => {
    const consent = settingsWith({}).consent;
    const out = buildErrorReportFromRecord(RECORD(), consent, HOST);
    expect(out).toEqual({
      kind: "error_report",
      installId: INSTALL,
      timestamp: Date.parse("2026-07-10T00:00:01.000Z"),
      schemaVersion: 1,
      host: HOST,
      errorClass: "ffmpeg_unknown_encoder",
      ffmpegExitCode: 1,
      stackHash: codeChainStackHash(["FFMPEG_EXIT"]),
    });
    expect(JSON.stringify(out)).not.toContain("boom"); // messages never leave
  });

  it("nulls on success/cancelled and when gated", () => {
    const consent = settingsWith({}).consent;
    expect(buildErrorReportFromRecord(RECORD({ outcome: "ok", ok: true }), consent, HOST)).toBeNull();
    expect(
      buildErrorReportFromRecord(RECORD({ outcome: "cancelled" }), consent, HOST),
    ).toBeNull();
    expect(
      buildErrorReportFromRecord(RECORD(), settingsWith({ errorReports: false }).consent, HOST),
    ).toBeNull();
  });

  it("omits ffmpegExitCode for non-ffmpeg failures", () => {
    const out = buildErrorReportFromRecord(
      RECORD({ outcome: "error_other", errorClass: "other", errors: [{ code: "UNHANDLED_EXCEPTION", message: "x" }] }),
      settingsWith({}).consent,
      HOST,
    );
    expect(out).not.toBeNull();
    expect((out as { ffmpegExitCode?: number }).ffmpegExitCode).toBeUndefined();
  });
});

describe("codeChainStackHash", () => {
  it("is deterministic, order-sensitive, and empty for no codes", () => {
    expect(codeChainStackHash([])).toBe("");
    expect(codeChainStackHash(["A", "B"])).toBe(codeChainStackHash(["A", "B"]));
    expect(codeChainStackHash(["A", "B"])).not.toBe(codeChainStackHash(["B", "A"]));
    expect(codeChainStackHash(["A"])).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("maybeEnqueueErrorReportForRecord", () => {
  it("enqueues when standard + errorReports on (injected enqueue, no disk)", () => {
    const enqueued: unknown[] = [];
    const ok = maybeEnqueueErrorReportForRecord(RECORD(), {
      settings: settingsWith({ errorReports: true }),
      env: {},
      enqueue: (e) => void enqueued.push(e),
    });
    expect(ok).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  it("is fully gated: channel off (the default), non-standard mode, DNT", () => {
    const enqueue = jest.fn();
    expect(
      maybeEnqueueErrorReportForRecord(RECORD(), {
        settings: settingsWith({ errorReports: false }),
        env: {},
        enqueue,
      }),
    ).toBe(false);
    expect(
      maybeEnqueueErrorReportForRecord(RECORD(), {
        settings: settingsWith({ errorReports: true, mode: "local" }),
        env: {},
        enqueue,
      }),
    ).toBe(false);
    expect(
      maybeEnqueueErrorReportForRecord(RECORD(), {
        settings: settingsWith({ errorReports: true }),
        env: { DO_NOT_TRACK: "1" },
        enqueue,
      }),
    ).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never throws even when the enqueue target throws", () => {
    expect(
      maybeEnqueueErrorReportForRecord(RECORD(), {
        settings: settingsWith({ errorReports: true }),
        env: {},
        enqueue: () => {
          throw new Error("disk full");
        },
      }),
    ).toBe(false);
  });
});
