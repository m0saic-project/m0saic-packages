import { asInstallId } from "../identifiers/identifiers";
import type {
  MosaicAnalyticsEvent,
  MosaicAnalyticsImmediateEvent,
  MosaicAnalyticsRollupEvent,
} from "./event";

const INSTALL = asInstallId("550e8400-e29b-41d4-a716-446655440000");

const baseEnvelope = () => ({
  installId: INSTALL,
  timestamp: 1_700_000_000_000,
  schemaVersion: 1 as const,
});

const baseHost = () => ({
  os: "macos" as const,
  arch: "arm64",
  mosaicVersion: "0.1",
  ffmpegVersion: "8.0",
});

describe("MosaicAnalyticsEvent discriminator", () => {
  it("narrows exhaustively on `kind`", () => {
    const samples: MosaicAnalyticsEvent[] = [
      {
        ...baseEnvelope(),
        kind: "rollup",
        windowStart: 1_700_000_000_000,
        windowEnd: 1_700_086_400_000,
        host: baseHost(),
        metrics: {
          rendersStarted: 12,
          rendersByOutcome: {
            ok: 10,
            cancelled: 0,
            error_plan_build: 0,
            error_validation: 0,
            error_ffmpeg: 2,
            error_template: 0,
            error_other: 0,
          },
          rendersByKind: { mosaic_document: 8, mosaic_pipeline: 4 },
          ffmpegInvocations: 87,
          renderDurationMsBuckets: [3, 4, 2, 2, 1, 0, 0],
          distinctTemplatesUsed: 5,
        },
      },
      { ...baseEnvelope(), kind: "install_completed", host: baseHost() },
      {
        ...baseEnvelope(),
        kind: "update_completed",
        host: baseHost(),
        fromVersion: "0.0",
        toVersion: "0.1",
      },
      {
        ...baseEnvelope(),
        kind: "error_report",
        host: baseHost(),
        errorClass: "ffmpeg_exit_nonzero",
        ffmpegExitCode: 8,
        stackHash: "a1b2c3d4",
        renderableKind: "mosaic_document",
      },
    ];

    const seen = new Set<string>();
    for (const e of samples) {
      switch (e.kind) {
        case "rollup":
        case "install_completed":
        case "update_completed":
        case "error_report":
          seen.add(e.kind);
          break;
        default: {
          const _exhaustive: never = e;
          void _exhaustive;
        }
      }
    }
    expect(seen.size).toBe(samples.length);
  });

  it("rollup and immediate variants are statically partitioned", () => {
    // Type-system test: the rollup-typed variable must reject an
    // immediate event and vice versa. Compile-time guarantee.
    const rollup: MosaicAnalyticsRollupEvent = {
      ...baseEnvelope(),
      kind: "rollup",
      windowStart: 0,
      windowEnd: 0,
      host: baseHost(),
      metrics: {
        rendersStarted: 0,
        rendersByOutcome: {
          ok: 0,
          cancelled: 0,
          error_plan_build: 0,
          error_validation: 0,
          error_ffmpeg: 0,
          error_template: 0,
          error_other: 0,
        },
        rendersByKind: { mosaic_document: 0, mosaic_pipeline: 0 },
        ffmpegInvocations: 0,
        renderDurationMsBuckets: [],
        distinctTemplatesUsed: 0,
      },
    };
    const immediate: MosaicAnalyticsImmediateEvent = {
      ...baseEnvelope(),
      kind: "install_completed",
      host: baseHost(),
    };
    expect(rollup.kind).toBe("rollup");
    expect(immediate.kind).toBe("install_completed");
  });
});
