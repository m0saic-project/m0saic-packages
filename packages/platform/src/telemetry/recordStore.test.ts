import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { MosaicRenderRecord } from "@m0saic/types";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import { getTelemetryRendersDir } from "./paths";
import {
  appendRenderRecord,
  clearRenderRecords,
  countRenderRecords,
  getTelemetryDiskUsage,
  listRenderRecords,
  renderRecordFileForMs,
} from "./recordStore";

const originalEnv = process.env.M0SAIC_ROOT;
let fixture: string;

beforeEach(() => {
  fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-records-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

let seq = 0;
const record = (over: Partial<MosaicRenderRecord> = {}): MosaicRenderRecord => {
  seq++;
  const finishedAt = over.finishedAt ?? "2026-07-10T12:00:00.000Z";
  const startedMs = Date.parse(finishedAt) - 1000;
  return {
    schemaVersion: 1,
    recordId: `rec-${seq}`,
    surface: "cli",
    startedAt: new Date(startedMs).toISOString(),
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

describe("renderRecordFileForMs", () => {
  it("names the UTC month file", () => {
    expect(renderRecordFileForMs(Date.parse("2026-07-10T12:00:00.000Z"))).toBe(
      path.join(getTelemetryRendersDir(), "2026-07.jsonl"),
    );
    expect(renderRecordFileForMs(Date.parse("2025-12-31T23:59:59.000Z"))).toBe(
      path.join(getTelemetryRendersDir(), "2025-12.jsonl"),
    );
  });
});

describe("append + list round trip", () => {
  it("lists appended records newest-first", () => {
    appendRenderRecord(record({ finishedAt: "2026-07-10T10:00:00.000Z" }));
    appendRenderRecord(record({ finishedAt: "2026-07-10T11:00:00.000Z" }));
    appendRenderRecord(record({ finishedAt: "2026-07-10T12:00:00.000Z" }));
    const { records, hasMore } = listRenderRecords();
    expect(records.map((r) => r.finishedAt)).toEqual([
      "2026-07-10T12:00:00.000Z",
      "2026-07-10T11:00:00.000Z",
      "2026-07-10T10:00:00.000Z",
    ]);
    expect(hasMore).toBe(false);
  });

  it("spans month files (newest month first)", () => {
    appendRenderRecord(record({ finishedAt: "2026-06-15T10:00:00.000Z" }));
    appendRenderRecord(record({ finishedAt: "2026-07-01T10:00:00.000Z" }));
    expect(fs.existsSync(path.join(getTelemetryRendersDir(), "2026-06.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(getTelemetryRendersDir(), "2026-07.jsonl"))).toBe(true);
    const { records } = listRenderRecords();
    expect(records.map((r) => r.finishedAt)).toEqual([
      "2026-07-01T10:00:00.000Z",
      "2026-06-15T10:00:00.000Z",
    ]);
  });

  it("skips corrupt and truncated lines without failing", () => {
    appendRenderRecord(record({ finishedAt: "2026-07-10T10:00:00.000Z" }));
    const file = path.join(getTelemetryRendersDir(), "2026-07.jsonl");
    fs.appendFileSync(file, "{truncated-not-json\n", "utf8");
    fs.appendFileSync(file, `${JSON.stringify({ schemaVersion: 42 })}\n`, "utf8");
    appendRenderRecord(record({ finishedAt: "2026-07-10T11:00:00.000Z" }));
    const { records } = listRenderRecords();
    expect(records).toHaveLength(2);
  });

  it("filters by surface and outcome", () => {
    appendRenderRecord(record({ surface: "cli", outcome: "ok" }));
    appendRenderRecord(record({ surface: "app", outcome: "ok" }));
    appendRenderRecord(
      record({ surface: "app", outcome: "error_ffmpeg", ok: false, exitCode: 1 }),
    );
    expect(listRenderRecords({ surface: "app" }).records).toHaveLength(2);
    expect(listRenderRecords({ outcome: "error_ffmpeg" }).records).toHaveLength(1);
    expect(
      listRenderRecords({ surface: "cli", outcome: "error_ffmpeg" }).records,
    ).toHaveLength(0);
  });

  it("pages via limit + beforeFinishedAtMs cursor", () => {
    for (let h = 1; h <= 5; h++) {
      appendRenderRecord(
        record({ finishedAt: `2026-07-10T0${h}:00:00.000Z` }),
      );
    }
    const page1 = listRenderRecords({ limit: 2 });
    expect(page1.records.map((r) => r.finishedAt)).toEqual([
      "2026-07-10T05:00:00.000Z",
      "2026-07-10T04:00:00.000Z",
    ]);
    expect(page1.hasMore).toBe(true);

    const cursor = Date.parse(page1.records[1].finishedAt);
    const page2 = listRenderRecords({ limit: 2, beforeFinishedAtMs: cursor });
    expect(page2.records.map((r) => r.finishedAt)).toEqual([
      "2026-07-10T03:00:00.000Z",
      "2026-07-10T02:00:00.000Z",
    ]);
    expect(page2.hasMore).toBe(true);

    const page3 = listRenderRecords({
      limit: 2,
      beforeFinishedAtMs: Date.parse(page2.records[1].finishedAt),
    });
    expect(page3.records).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
  });

  it("returns empty from a pristine root", () => {
    expect(listRenderRecords()).toEqual({ records: [], hasMore: false });
  });
});

describe("countRenderRecords", () => {
  it("tallies totals and outcomes across files", () => {
    appendRenderRecord(record({ finishedAt: "2026-06-15T10:00:00.000Z" }));
    appendRenderRecord(record({ finishedAt: "2026-07-01T10:00:00.000Z" }));
    appendRenderRecord(
      record({ outcome: "error_ffmpeg", ok: false, exitCode: 1 }),
    );
    expect(countRenderRecords()).toEqual({
      total: 3,
      byOutcome: { ok: 2, error_ffmpeg: 1 },
    });
  });

  it("is zero on a pristine root", () => {
    expect(countRenderRecords()).toEqual({ total: 0, byOutcome: {} });
  });
});

describe("clearRenderRecords + disk usage", () => {
  it("deletes month files only and reports usage before/after", () => {
    appendRenderRecord(record({ finishedAt: "2026-06-15T10:00:00.000Z" }));
    appendRenderRecord(record({ finishedAt: "2026-07-01T10:00:00.000Z" }));
    const before = getTelemetryDiskUsage();
    expect(before.files).toBe(2);
    expect(before.bytes).toBeGreaterThan(0);

    expect(clearRenderRecords()).toEqual({ filesDeleted: 2 });
    expect(countRenderRecords().total).toBe(0);
    const after = getTelemetryDiskUsage();
    expect(after.files).toBe(0);
  });

  it("disk usage is zero on a pristine root", () => {
    expect(getTelemetryDiskUsage()).toEqual({ bytes: 0, files: 0 });
  });
});
