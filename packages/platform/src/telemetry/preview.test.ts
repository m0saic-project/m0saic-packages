import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { MosaicRenderRecord } from "@m0saic/types";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import { appendRenderRecord } from "./recordStore";
import { maybeEnqueueDailyRollup } from "./rollup";
import { setTelemetryMode } from "./settingsStore";
import { buildUpstreamPreview } from "./preview";

const originalEnv = process.env.M0SAIC_ROOT;
let fixture: string;

beforeEach(() => {
  fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

let seq = 0;
const rec = (over: Partial<MosaicRenderRecord> = {}): MosaicRenderRecord => {
  seq++;
  const finishedAt = over.finishedAt ?? "2026-07-10T09:00:00.000Z";
  return {
    schemaVersion: 1,
    recordId: `r-${seq}`,
    surface: "cli",
    startedAt: finishedAt,
    finishedAt,
    elapsedMs: 700,
    ok: true,
    exitCode: 0,
    outcome: "ok",
    templateId: "@m0saic/a/b/v1",
    versions: { mosaic: "0.1.0", ffmpeg: "8.0" },
    errors: [],
    warningsCount: 0,
    ...over,
  };
};

describe("buildUpstreamPreview", () => {
  it("computes the live next-rollup over the pending window (single code path)", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-09T10:00:00.000Z" }));
    appendRenderRecord(rec({ finishedAt: "2026-07-10T10:00:00.000Z" }));
    const p = buildUpstreamPreview({ nowMs: NOW, env: {} });
    expect(p.upstreamAllowed).toBe(true);
    expect(p.endpoint.configured).toBe(false);
    // Day summary = full days only (07-09); today (07-10) is the live update.
    expect(p.nextRollup?.metrics.rendersStarted).toBe(1);
    expect(p.nextRollupWindow?.records).toBe(1);
    expect(p.nextRollup?.windowEnd).toBe(Date.parse("2026-07-10T00:00:00.000Z"));
    expect(p.todayRollup?.metrics.rendersStarted).toBe(1);
    expect(p.todayRollup?.windowStart).toBe(Date.parse("2026-07-10T00:00:00.000Z"));
    expect(p.todayRollup?.windowEnd).toBe(NOW);
    expect(p.queued).toHaveLength(0);
    expect(p.sent).toHaveLength(0);
    expect(p.neverSent.length).toBeGreaterThan(3);
    expect(p.rollupCadence.length).toBeGreaterThan(20);
    // The transparency invariant: no template ids or paths in the payload.
    expect(JSON.stringify(p.nextRollup)).not.toContain("@m0saic/a/b/v1");
    expect(JSON.stringify(p.todayRollup)).not.toContain("@m0saic/a/b/v1");
  });

  it("todayRollup is null when nothing rendered today; nextRollup null when no full day is pending", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-09T10:00:00.000Z" }));
    const p = buildUpstreamPreview({ nowMs: NOW, env: {} });
    expect(p.todayRollup).toBeNull();
    expect(p.nextRollup?.metrics.rendersStarted).toBe(1);
    const q = buildUpstreamPreview({ nowMs: Date.parse("2026-07-09T12:00:00.000Z"), env: {} });
    expect(q.nextRollup).toBeNull(); // 07-09 is "today" from that vantage
    expect(q.todayRollup?.metrics.rendersStarted).toBe(1);
  });

  it("after the daily enqueue, the queued ledger shows the entry and the window advances", () => {
    appendRenderRecord(rec({ finishedAt: "2026-07-09T10:00:00.000Z" }));
    maybeEnqueueDailyRollup({ nowMs: NOW, env: {} });
    const p = buildUpstreamPreview({ nowMs: NOW, env: {} });
    expect(p.queued).toHaveLength(1);
    expect(p.queued[0].kind).toBe("rollup");
    expect(p.nextRollup).toBeNull(); // nothing new since the enqueue
    expect(p.todayRollup).toBeNull();
  });

  it("builds an illustrative sample error report while the channel stays off", () => {
    appendRenderRecord(
      rec({
        finishedAt: "2026-07-10T11:00:00.000Z",
        ok: false,
        exitCode: 1,
        outcome: "error_ffmpeg",
        errorClass: "ffmpeg_unknown_encoder",
        errors: [{ code: "FFMPEG_EXIT", message: "secret message" }],
      }),
    );
    const p = buildUpstreamPreview({ nowMs: NOW, env: {} });
    expect(p.errorReportsEnabled).toBe(false);
    expect(p.sampleErrorReport?.kind).toBe("error_report");
    expect(JSON.stringify(p.sampleErrorReport)).not.toContain("secret message");
  });

  it("reflects non-standard modes as upstream-not-allowed with a null rollup", () => {
    appendRenderRecord(rec());
    setTelemetryMode("local");
    const p = buildUpstreamPreview({ nowMs: NOW, env: {} });
    expect(p.upstreamAllowed).toBe(false);
    expect(p.nextRollup).toBeNull(); // consent opted-out → builder nulls
  });
});
