import * as path from "path";
import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, handlesOf, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import "../../../charts/bar-graph/v1"; // the composed chart templates
import "../../../charts/stat-card/v1";
import { BenchmarkReport } from "../v1/report";
import { BenchmarkReportV2 } from "./report";

const SESSION = path.join(__dirname, "..", "v1", "assets", "sample-session");
const NOWHERE = "/nonexistent/definitely-not-a-session";

vnextSuite({
  next: BenchmarkReportV2,
  prev: BenchmarkReport,
  // The default (`dir: "."`) finds no session from the test's cwd: v1 drew an
  // error card there, v2 the pick-a-folder card — its own test, below.
  defaultsParity: false,
  cases: [
    { name: "the sample session", props: { dir: SESSION } },
    { name: "the sample session, short intro, 720p", props: { dir: SESSION, introFrac: 0.2 }, w: 1280, h: 720 },
    { name: "pointed straight at the benchmark.json", props: { dir: path.join(SESSION, "benchmark.json") } },
  ],
  bound: ["dir"],
  unbound: { introFrac: "timing" },
});

describe("@m0saic/benchmark/report/v2 — handles", () => {
  type Bound = { editor?: { binding?: { propKey: string } } };

  it("no session yet: an INCOMPLETE card that takes the folder (v1: an error card, nothing to click)", async () => {
    const ctx = ctxFor(BenchmarkReportV2);
    const doc = (await BenchmarkReportV2.render({ dir: NOWHERE } as never, ctx)) as MosaicDocument;
    expect(renderStatusOf(doc)).toBe("incomplete");
    expect((doc.sources as Bound[]).map((s) => s.editor?.binding)).toEqual([{ propKey: "dir" }]);
    expect(handlesOf(doc, BenchmarkReportV2, ctx).rejected).toEqual([]);
    const before = (await BenchmarkReport.render({ dir: NOWHERE } as never, ctx)) as MosaicDocument;
    expect(renderStatusOf(before)).toBe("error");
  });

  it("with a session: each header line is the handle that swaps the session folder; the composed charts are not", async () => {
    const ctx = ctxFor(BenchmarkReportV2);
    const doc = (await BenchmarkReportV2.render({ dir: SESSION } as never, ctx)) as MosaicDocument;
    expect((doc.sources as Bound[]).map((s) => s.editor?.binding?.propKey ?? null)).toEqual(["dir", "dir", "dir", null, null, null, null, null]);
    expect(handlesOf(doc, BenchmarkReportV2, ctx).rejected).toEqual([]);
  });

  it("a session that cannot be read is still an error (something broke — nothing is missing)", async () => {
    const doc = (await BenchmarkReportV2.render({ dir: path.join(__dirname, "report.ts") } as never, ctxFor(BenchmarkReportV2))) as MosaicDocument;
    expect(["error", "incomplete"]).toContain(renderStatusOf(doc));
  });
});
