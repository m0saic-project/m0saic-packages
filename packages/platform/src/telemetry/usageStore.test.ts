import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { MosaicUsageRecord } from "@m0saic/types";
import { MAX_TEMPLATES_USED } from "@m0saic/types";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import { getTelemetryUsageDir } from "./paths";
import {
  appendUsageRecord,
  clearUsageRecords,
  countUsageRecords,
  listUsageRecordsInWindow,
  tallyUsage,
  usageRecordFileForMs,
} from "./usageStore";

const originalEnv = process.env.M0SAIC_ROOT;
let fixture: string;

beforeEach(() => {
  fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const JUL_9 = Date.parse("2026-07-09T10:00:00.000Z");
const JUL_10 = Date.parse("2026-07-10T09:00:00.000Z");
const AUG_1 = Date.parse("2026-08-01T00:00:00.000Z");

const use = (over: Partial<MosaicUsageRecord> = {}): MosaicUsageRecord => ({
  schemaVersion: 1,
  atMs: JUL_10,
  surface: "app",
  feature: "page.make",
  ...over,
});

describe("usage month files", () => {
  it("appends one JSON line per event into usage/YYYY-MM.jsonl", () => {
    appendUsageRecord(use());
    const file = usageRecordFileForMs(JUL_10);
    expect(file).toBe(path.join(getTelemetryUsageDir(), "2026-07.jsonl"));
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(use());
    expect(countUsageRecords()).toBe(1);
  });

  it("lists [start, end) ascending across month files, skipping bad lines", () => {
    appendUsageRecord(use({ atMs: AUG_1, feature: "page.layout" }));
    appendUsageRecord(use({ atMs: JUL_10 }));
    appendUsageRecord(use({ atMs: JUL_9, feature: "session.start" }));
    fs.appendFileSync(usageRecordFileForMs(JUL_10), "not json\n", "utf8");
    fs.appendFileSync(
      usageRecordFileForMs(JUL_10),
      `${JSON.stringify({ ...use(), feature: "Not A Key" })}\n${JSON.stringify({ ...use(), schemaVersion: 99 })}\n`,
      "utf8",
    );
    const all = listUsageRecordsInWindow(0, AUG_1 + 1);
    expect(all.map((r) => r.feature)).toEqual(["session.start", "page.make", "page.layout"]);
    expect(listUsageRecordsInWindow(JUL_9, JUL_10).map((r) => r.feature)).toEqual(["session.start"]);
    expect(listUsageRecordsInWindow(JUL_10, JUL_10)).toEqual([]);
    expect(countUsageRecords()).toBe(3);
  });

  it("clears every month file, and is a no-op on a pristine root", () => {
    expect(clearUsageRecords()).toEqual({ filesDeleted: 0 });
    appendUsageRecord(use({ atMs: JUL_10 }));
    appendUsageRecord(use({ atMs: AUG_1 }));
    expect(clearUsageRecords()).toEqual({ filesDeleted: 2 });
    expect(countUsageRecords()).toBe(0);
    expect(fs.readdirSync(getTelemetryUsageDir())).toHaveLength(0);
  });
});

describe("tallyUsage", () => {
  it("omits every field for an empty window", () => {
    expect(tallyUsage([])).toEqual({});
  });

  it("counts features sparsely and keeps only first-party builtin template ids", () => {
    const t = tallyUsage([
      use({ feature: "page.make" }),
      use({ feature: "page.make" }),
      use({ feature: "template.open.builtin", templateId: "@m0saic/hero/github/v1", templateKind: "builtin" }),
      use({ feature: "template.open.builtin", templateId: "@m0saic/hero/github/v1", templateKind: "builtin" }),
      use({ feature: "template.open.builtin", templateId: "@m0saic/demos/v2", templateKind: "builtin" }),
      // community provenance with a first-party-looking id: counted, never named
      use({ feature: "template.open.community", templateId: "@m0saic/hero/github/v1", templateKind: "community" }),
      // builtin provenance with a foreign-shaped id: dropped from the map
      use({ feature: "template.open.builtin", templateId: "@m0saic-dev/hero/x/v1", templateKind: "builtin" }),
      use({ feature: "template.open.builtin", templateId: `@m0saic/${"a".repeat(80)}/v1`, templateKind: "builtin" }),
      use({ feature: "template.open.external", templateKind: "external" }),
    ]);
    expect(t.features).toEqual({
      "page.make": 2,
      "template.open.builtin": 5,
      "template.open.community": 1,
      "template.open.external": 1,
    });
    expect(t.templatesUsed).toEqual({ "@m0saic/hero/github/v1": 2, "@m0saic/demos/v2": 1 });
    expect(t).not.toHaveProperty("layoutShapes");
  });

  it("caps templatesUsed at the most-used 64 ids", () => {
    const records: MosaicUsageRecord[] = [];
    for (let i = 0; i < 70; i++) {
      for (let n = 0; n <= i; n++) {
        records.push(use({ feature: "template.open.builtin", templateId: `@m0saic/pack/t${i}/v1`, templateKind: "builtin" }));
      }
    }
    const t = tallyUsage(records);
    const kept = Object.keys(t.templatesUsed ?? {});
    expect(kept).toHaveLength(MAX_TEMPLATES_USED);
    expect(kept).toContain("@m0saic/pack/t69/v1");
    expect(kept).not.toContain("@m0saic/pack/t0/v1");
    expect(kept).not.toContain("@m0saic/pack/t5/v1");
    expect(t.templatesUsed?.["@m0saic/pack/t69/v1"]).toBe(70);
  });
});
