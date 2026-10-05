import type { MosaicDocumentPipeline } from "@m0saic/types";
import { ctxFor, handlesOf, vnextSuite } from "../../../../../__tests__/vnextSuite";
// Register every beat + the alpine leaves the beats nest, so the sequencer's
// renderNestedTemplate calls resolve.
import "../../index";
import "../../../../alpine/stat-card/v1";
import "../../../../alpine/donut/v1";
import "../../../../alpine/heatmap/v1";
import "../../../../alpine/contributor-table/v1";
import "../../../../alpine/commit-feed/v1";
import "../../../../alpine/line-chart/v1";
import { FfmpegPulseRunner } from "../v1/runner";
import { FfmpegPulseRunnerV2 } from "./runner";

const D = FfmpegPulseRunnerV2.defaultProps as Record<string, unknown>;

vnextSuite({
  next: FfmpegPulseRunnerV2,
  prev: FfmpegPulseRunner,
  cases: [
    { name: "light mode, hard cuts, portrait", props: { renderMode: "light", crossfadeMs: 0 }, w: 1080, h: 1920 },
    { name: "own beat timings", props: { timings: { title: 2000, fin: 1500 }, crossfadeMs: 500 }, w: 1280, h: 720 },
    { name: "requireUpstream with no upstream is still the error frame", props: { requireUpstream: true }, w: 640, h: 360 },
  ],
  bound: [],
  unbound: { crossfadeMs: "timing" },
});

describe("@m0saic/hero/ffmpeg-pulse/runner/v2", () => {
  it("is the same eight-beat film, and no beat's own binding leaks into the runner", async () => {
    const ctx = ctxFor(FfmpegPulseRunnerV2, { w: 1280, h: 720 });
    const film = (await FfmpegPulseRunnerV2.render({ ...D } as never, ctx)) as MosaicDocumentPipeline;
    expect(film.kind).toBe("mosaic_pipeline");
    expect(film.steps).toHaveLength(8);
    const h = handlesOf(film, FfmpegPulseRunnerV2, ctx);
    expect(h.keys).toEqual([]);
    expect(h.rejected).toEqual([]);
  });
});
