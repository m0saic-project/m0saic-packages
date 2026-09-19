import { asInstallId } from "../identifiers/identifiers";
import type { MosaicOutboxEntry } from "./upstream";
import {
  TELEMETRY_OUTBOX_ENTRY_SCHEMA_VERSION,
  isMosaicOutboxEntry,
} from "./upstream";

const ENTRY: MosaicOutboxEntry = {
  schemaVersion: TELEMETRY_OUTBOX_ENTRY_SCHEMA_VERSION,
  id: "1752160000000-rollup-a1",
  channel: "rollup",
  kind: "rollup",
  createdAt: "2026-07-10T00:00:00.000Z",
  attempts: 0,
  nextAttemptAtMs: 0,
  payload: {
    kind: "rollup",
    installId: asInstallId("550e8400-e29b-41d4-a716-446655440000"),
    timestamp: 1752160000000,
    schemaVersion: 1,
    windowStart: 0,
    windowEnd: 1,
    host: { os: "macos", arch: "arm64", mosaicVersion: "0.1" },
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
      renderDurationMsBuckets: [0, 0, 0, 0, 0, 0, 0],
      distinctTemplatesUsed: 0,
    },
  },
};

describe("isMosaicOutboxEntry", () => {
  it("accepts a well-formed entry", () => {
    expect(isMosaicOutboxEntry(ENTRY)).toBe(true);
  });

  it("accepts a sent entry (extra fields tolerated)", () => {
    expect(isMosaicOutboxEntry({ ...ENTRY, sentAt: "2026-07-10T01:00:00.000Z" })).toBe(
      true,
    );
  });

  it("rejects junk", () => {
    expect(isMosaicOutboxEntry(null)).toBe(false);
    expect(isMosaicOutboxEntry({})).toBe(false);
    expect(isMosaicOutboxEntry({ ...ENTRY, schemaVersion: 2 })).toBe(false);
    expect(isMosaicOutboxEntry({ ...ENTRY, channel: "sideband" })).toBe(false);
    expect(isMosaicOutboxEntry({ ...ENTRY, payload: null })).toBe(false);
  });
});
