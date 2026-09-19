import * as path from "path";
import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { validateM0String } from "@m0saic/dsl";
import "../../../charts/bar-graph/v1"; // register the composed chart templates
import "../../../charts/stat-card/v1";
import { BenchmarkReport } from "./report";

const FIXTURE_DIR = path.join(__dirname, "assets", "sample-session");

function ctx(): MosaicEngineContext {
  return {
    mode: "render",
    target: { width: 1920, height: 1080, fps: 30, durationMs: 6000 },
    output: { target: undefined, format: undefined, audio: undefined, color: undefined },
  } as unknown as MosaicEngineContext;
}

describe("BenchmarkReport", () => {
  it("renders a valid dashboard from a session benchmark.json", async () => {
    const doc = (await BenchmarkReport.render({ dir: FIXTURE_DIR }, ctx())) as MosaicDocument;
    expect(doc.kind).toBe("mosaic_document");
    expect(validateM0String(doc.m0 as string).ok).toBe(true);
    // 3 header lines + M logo (image) + 3 composed stat-cards + 1 composed bar chart.
    expect(doc.sources).toHaveLength(8);
    const children = (doc as { children?: Record<string, unknown> }).children ?? {};
    expect(Object.keys(children).sort()).toEqual(["bars", "kpi-ok", "kpi-score", "kpi-time"]);
  });

  it("returns an instructional error card when no session is found", async () => {
    const doc = (await BenchmarkReport.render(
      { dir: "/nonexistent/definitely-not-a-session" },
      ctx(),
    )) as MosaicDocument;
    expect(doc.kind).toBe("mosaic_document");
    // makeErrorMosaic marks the source as an error so the UI disables Make.
    const src = (doc.sources as { engine?: { renderStatus?: string } }[]).find(
      (s) => s.engine?.renderStatus === "error",
    );
    expect(src).toBeTruthy();
  });
});
