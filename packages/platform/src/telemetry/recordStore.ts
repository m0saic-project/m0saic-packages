import * as fs from "fs";
import * as path from "path";
import type {
  MosaicRenderOutcome,
  MosaicRenderRecord,
  MosaicTelemetrySurface,
} from "@m0saic/types";
import { TELEMETRY_RENDER_RECORD_SCHEMA_VERSION } from "@m0saic/types";
import { ensureDir } from "../paths/m0saicRoot";
import { getTelemetryRendersDir, getTelemetryRoot } from "./paths";

const MONTH_FILE_RE = /^\d{4}-\d{2}\.jsonl$/;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;

/** Month file (`YYYY-MM.jsonl`, UTC) a record finishing at `ms` lands in. */
export function renderRecordFileForMs(ms: number): string {
  const iso = new Date(ms).toISOString();
  return path.join(getTelemetryRendersDir(), `${iso.slice(0, 7)}.jsonl`);
}

/**
 * Append one record as one JSON line. Single-line appends are
 * effectively atomic at these sizes; the tolerant reader below is
 * the backstop for anything that still interleaves (CLI + app can
 * write the same month file concurrently).
 *
 * Throws on fs failure — the recorder wraps this in its own
 * never-throws boundary.
 */
export function appendRenderRecord(record: MosaicRenderRecord): void {
  ensureDir(getTelemetryRendersDir());
  const finishedMs = Date.parse(record.finishedAt);
  const file = renderRecordFileForMs(
    Number.isNaN(finishedMs) ? Date.now() : finishedMs,
  );
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

/** Minimal shape check for one parsed JSONL line. */
const isRenderRecordLine = (v: unknown): v is MosaicRenderRecord => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.schemaVersion === TELEMETRY_RENDER_RECORD_SCHEMA_VERSION &&
    typeof o.recordId === "string" &&
    (o.surface === "cli" || o.surface === "app") &&
    typeof o.finishedAt === "string" &&
    typeof o.outcome === "string"
  );
};

/** Month files, newest first. Missing dir → empty. */
const listMonthFilesDesc = (): string[] => {
  const dir = getTelemetryRendersDir();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => MONTH_FILE_RE.test(n))
    .sort()
    .reverse()
    .map((n) => path.join(dir, n));
};

/**
 * Parse one month file into records, tolerating truncated / corrupt
 * lines (skipped, never thrown — the JobStore JSONL convention).
 */
const readMonthFile = (file: string): MosaicRenderRecord[] => {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const records: MosaicRenderRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRenderRecordLine(parsed)) records.push(parsed);
    } catch {
      /* skip bad line */
    }
  }
  return records;
};

export type ListRenderRecordsOptions = {
  /** Page size; default 50, capped at 500. */
  limit?: number;
  /** Only records that finished strictly before this epoch-ms (paging cursor). */
  beforeFinishedAtMs?: number;
  surface?: MosaicTelemetrySurface;
  outcome?: MosaicRenderOutcome;
};

const finishedMsOf = (r: MosaicRenderRecord): number => {
  const ms = Date.parse(r.finishedAt);
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * List records newest-first with filters + cursor paging. Reads
 * newest month files first and stops as soon as the page (plus the
 * one-extra `hasMore` probe) is satisfied.
 */
export function listRenderRecords(opts: ListRenderRecordsOptions = {}): {
  records: MosaicRenderRecord[];
  hasMore: boolean;
} {
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
  const matching: MosaicRenderRecord[] = [];
  for (const file of listMonthFilesDesc()) {
    const inFile = readMonthFile(file);
    // Appends are chronological; walk reversed for newest-first.
    for (let i = inFile.length - 1; i >= 0; i--) {
      const r = inFile[i];
      if (
        opts.beforeFinishedAtMs !== undefined &&
        finishedMsOf(r) >= opts.beforeFinishedAtMs
      ) {
        continue;
      }
      if (opts.surface !== undefined && r.surface !== opts.surface) continue;
      if (opts.outcome !== undefined && r.outcome !== opts.outcome) continue;
      matching.push(r);
      if (matching.length > limit) break;
    }
    if (matching.length > limit) break;
  }
  matching.sort((a, b) => finishedMsOf(b) - finishedMsOf(a));
  return { records: matching.slice(0, limit), hasMore: matching.length > limit };
}

/**
 * Records with `finishedAt` in `[startMs, endMs)`, ascending. Used by
 * the rollup window math — windows span a handful of days, so a full
 * month-file scan is fine.
 */
export function listRenderRecordsInWindow(
  startMs: number,
  endMs: number,
): MosaicRenderRecord[] {
  const out: MosaicRenderRecord[] = [];
  for (const file of listMonthFilesDesc()) {
    for (const r of readMonthFile(file)) {
      const ms = finishedMsOf(r);
      if (ms >= startMs && ms < endMs) out.push(r);
    }
  }
  out.sort((a, b) => finishedMsOf(a) - finishedMsOf(b));
  return out;
}

/** Totals across the whole store (all month files). */
export function countRenderRecords(): {
  total: number;
  byOutcome: Partial<Record<MosaicRenderOutcome, number>>;
} {
  let total = 0;
  const byOutcome: Partial<Record<MosaicRenderOutcome, number>> = {};
  for (const file of listMonthFilesDesc()) {
    for (const r of readMonthFile(file)) {
      total++;
      byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
    }
  }
  return { total, byOutcome };
}

/** Delete every month file. The settings file is untouched. */
export function clearRenderRecords(): { filesDeleted: number } {
  let filesDeleted = 0;
  for (const file of listMonthFilesDesc()) {
    try {
      fs.unlinkSync(file);
      filesDeleted++;
    } catch {
      /* best effort */
    }
  }
  return { filesDeleted };
}

/** Recursive disk footprint of everything under `<root>/telemetry/`. */
export function getTelemetryDiskUsage(): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size;
          files++;
        } catch {
          /* raced deletion — skip */
        }
      }
    }
  };
  walk(getTelemetryRoot());
  return { bytes, files };
}
