import * as fs from "fs";
import * as path from "path";
import type { MosaicUsageRecord } from "@m0saic/types";
import {
  FIRST_PARTY_TEMPLATE_ID_RE,
  MAX_TEMPLATE_ID_CHARS,
  MAX_TEMPLATES_USED,
  TELEMETRY_USAGE_RECORD_SCHEMA_VERSION,
  isFeatureKeyShaped,
} from "@m0saic/types";
import { ensureDir } from "../paths/m0saicRoot";
import { getTelemetryUsageDir } from "./paths";

/**
 * Local feature-usage store — `usage/YYYY-MM.jsonl`, one line per event,
 * the same month-file pattern as `renders/` (append-only, tolerant
 * reader, safe for CLI + app + worker appending concurrently). Never
 * leaves the machine as lines; the rollup tallies it into counts.
 */
const MONTH_FILE_RE = /^\d{4}-\d{2}\.jsonl$/;

export function usageRecordFileForMs(ms: number): string {
  const iso = new Date(ms).toISOString();
  return path.join(getTelemetryUsageDir(), `${iso.slice(0, 7)}.jsonl`);
}

/** Append one usage line. Throws on fs failure — the recorder wraps it. */
export function appendUsageRecord(record: MosaicUsageRecord): void {
  ensureDir(getTelemetryUsageDir());
  fs.appendFileSync(usageRecordFileForMs(record.atMs), `${JSON.stringify(record)}\n`, "utf8");
}

const isUsageLine = (v: unknown): v is MosaicUsageRecord => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.schemaVersion === TELEMETRY_USAGE_RECORD_SCHEMA_VERSION &&
    typeof o.atMs === "number" &&
    (o.surface === "cli" || o.surface === "app") &&
    isFeatureKeyShaped(o.feature)
  );
};

const listMonthFilesDesc = (): string[] => {
  const dir = getTelemetryUsageDir();
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

const readMonthFile = (file: string): MosaicUsageRecord[] => {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: MosaicUsageRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isUsageLine(parsed)) out.push(parsed);
    } catch {
      /* skip bad line */
    }
  }
  return out;
};

/** Usage events with `atMs` in `[startMs, endMs)`, ascending. */
export function listUsageRecordsInWindow(startMs: number, endMs: number): MosaicUsageRecord[] {
  const out: MosaicUsageRecord[] = [];
  for (const file of listMonthFilesDesc()) {
    for (const r of readMonthFile(file)) {
      if (r.atMs >= startMs && r.atMs < endMs) out.push(r);
    }
  }
  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}

/** Total usage events on disk (all month files). */
export function countUsageRecords(): number {
  let n = 0;
  for (const file of listMonthFilesDesc()) n += readMonthFile(file).length;
  return n;
}

/** Delete every usage month file. */
export function clearUsageRecords(): { filesDeleted: number } {
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

const bucketIndex = (value: number, bounds: readonly number[]): number => {
  for (let i = 0; i < bounds.length; i++) if (value < bounds[i]) return i;
  return bounds.length;
};

/** What a window's usage lines contribute to the rollup — pure. */
export type UsageTally = {
  features?: Record<string, number>;
  templatesUsed?: Record<string, number>;
};

/**
 * Aggregate usage lines into the rollup's optional fields. Empty fields
 * are omitted, so a window with no usage adds nothing to the payload.
 * `templatesUsed` keeps only first-party ids (`templateKind === "builtin"`,
 * shape-checked) and caps at the 64 most-used.
 */
export function tallyUsage(records: readonly MosaicUsageRecord[]): UsageTally {
  const features: Record<string, number> = {};
  const templates: Record<string, number> = {};
  let featureCount = 0;
  for (const r of records) {
    features[r.feature] = (features[r.feature] ?? 0) + 1;
    featureCount++;
    if (
      r.templateKind === "builtin" &&
      r.templateId !== undefined &&
      r.templateId.length <= MAX_TEMPLATE_ID_CHARS &&
      FIRST_PARTY_TEMPLATE_ID_RE.test(r.templateId)
    ) {
      templates[r.templateId] = (templates[r.templateId] ?? 0) + 1;
    }
  }
  const templateEntries = Object.entries(templates)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TEMPLATES_USED);
  return {
    ...(featureCount > 0 ? { features } : {}),
    ...(templateEntries.length > 0 ? { templatesUsed: Object.fromEntries(templateEntries) } : {}),
  };
}
