import type { MosaicRenderRecord } from "@m0saic/types";
import { summarizeRenderRecords } from "./summary";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

let seq = 0;
const rec = (over: Partial<MosaicRenderRecord> = {}): MosaicRenderRecord => {
  seq++;
  const finishedAt = over.finishedAt ?? "2026-07-10T10:00:00.000Z";
  return {
    schemaVersion: 1,
    recordId: `rec-${seq}`,
    surface: "cli",
    startedAt: finishedAt,
    finishedAt,
    elapsedMs: 1000,
    ok: true,
    exitCode: 0,
    outcome: "ok",
    errors: [],
    warningsCount: 0,
    ...over,
  };
};

describe("summarizeRenderRecords", () => {
  it("empty input produces a well-formed zero summary", () => {
    const s = summarizeRenderRecords([], { nowMs: NOW, days: 3 });
    expect(s.totals).toEqual({ renders: 0, ok: 0, failed: 0, cancelled: 0 });
    expect(s.successRate).toBeNull();
    expect(s.durationMs).toEqual({ avg: null, median: null, p90: null, max: null });
    expect(s.rendersLast7Days).toBe(0);
    expect(s.byDay).toEqual([
      { day: "2026-07-08", ok: 0, failed: 0, cancelled: 0 },
      { day: "2026-07-09", ok: 0, failed: 0, cancelled: 0 },
      { day: "2026-07-10", ok: 0, failed: 0, cancelled: 0 },
    ]);
    expect(s.recentDurations).toEqual([]);
    expect(s.topTemplates).toEqual([]);
    expect(s.surfaces).toEqual({ cli: 0, app: 0 });
  });

  it("cancelled renders are excluded from the success-rate denominator", () => {
    const s = summarizeRenderRecords(
      [
        rec({ outcome: "ok" }),
        rec({ outcome: "ok" }),
        rec({ outcome: "ok" }),
        rec({ outcome: "error_ffmpeg", ok: false }),
        rec({ outcome: "cancelled", ok: false }),
      ],
      { nowMs: NOW },
    );
    expect(s.totals).toEqual({ renders: 5, ok: 3, failed: 1, cancelled: 1 });
    expect(s.successRate).toBe(0.75);
  });

  it("duration stats cover OK renders only", () => {
    const s = summarizeRenderRecords(
      [
        rec({ elapsedMs: 100 }),
        rec({ elapsedMs: 200 }),
        rec({ elapsedMs: 300 }),
        rec({ elapsedMs: 400 }),
        rec({ elapsedMs: 99_999, outcome: "error_ffmpeg", ok: false }),
      ],
      { nowMs: NOW },
    );
    expect(s.durationMs).toEqual({ avg: 250, median: 200, p90: 400, max: 400 });
  });

  it("byDay buckets by UTC day, zero-filled, oldest first", () => {
    const s = summarizeRenderRecords(
      [
        rec({ finishedAt: "2026-07-10T01:00:00.000Z" }),
        rec({ finishedAt: "2026-07-10T02:00:00.000Z", outcome: "error_other", ok: false }),
        rec({ finishedAt: "2026-07-09T23:59:59.000Z", outcome: "cancelled", ok: false }),
        rec({ finishedAt: "2026-07-01T00:00:00.000Z" }),
      ],
      { nowMs: NOW, days: 3 },
    );
    expect(s.byDay).toEqual([
      { day: "2026-07-08", ok: 0, failed: 0, cancelled: 0 },
      { day: "2026-07-09", ok: 0, failed: 0, cancelled: 1 },
      { day: "2026-07-10", ok: 1, failed: 1, cancelled: 0 },
    ]);
    expect(s.rendersLast7Days).toBe(3);
  });

  it("recentDurations is time-ascending with outcome + templateId", () => {
    const s = summarizeRenderRecords(
      [
        rec({ finishedAt: "2026-07-10T02:00:00.000Z", elapsedMs: 2, templateId: "b" }),
        rec({ finishedAt: "2026-07-10T01:00:00.000Z", elapsedMs: 1 }),
        rec({
          finishedAt: "2026-07-10T03:00:00.000Z",
          elapsedMs: 3,
          outcome: "error_ffmpeg",
          ok: false,
        }),
      ],
      { nowMs: NOW },
    );
    expect(s.recentDurations.map((p) => p.elapsedMs)).toEqual([1, 2, 3]);
    expect(s.recentDurations[1].templateId).toBe("b");
    expect(s.recentDurations[0].templateId).toBeUndefined();
    expect(s.recentDurations[2].outcome).toBe("error_ffmpeg");
  });

  it("topTemplates ranks by count with avg + failures", () => {
    const s = summarizeRenderRecords(
      [
        rec({ templateId: "a", elapsedMs: 100 }),
        rec({ templateId: "a", elapsedMs: 300 }),
        rec({ templateId: "a", elapsedMs: 200, outcome: "error_template", ok: false }),
        rec({ templateId: "b", elapsedMs: 50 }),
        rec({}),
      ],
      { nowMs: NOW },
    );
    expect(s.topTemplates).toEqual([
      { templateId: "a", count: 3, avgMs: 200, failures: 1 },
      { templateId: "b", count: 1, avgMs: 50, failures: 0 },
    ]);
  });

  it("counts surfaces", () => {
    const s = summarizeRenderRecords(
      [rec({ surface: "cli" }), rec({ surface: "app" }), rec({ surface: "app" })],
      { nowMs: NOW },
    );
    expect(s.surfaces).toEqual({ cli: 1, app: 2 });
  });
});
