// covers: github/weekly-pulse — the self-contained capability template. Replay
// default renders the 8-beat pipeline network-free; live fetch failure degrades
// to an error frame; malformed source fails fast.
import type { MosaicDocument, MosaicDocumentPipeline, MosaicEngineContext } from "@m0saic/types";
import { GithubWeeklyPulse } from "./weekly-pulse";
// Register the beats (+ the alpine leaves they nest) so buildPulsePipeline's
// renderNestedTemplate calls resolve — same set the runner test registers.
import "../../../hero/ffmpeg-pulse";
import "../../../alpine/stat-card/v1";
import "../../../alpine/donut/v1";
import "../../../alpine/heatmap/v1";
import "../../../alpine/contributor-table/v1";
import "../../../alpine/commit-feed/v1";
import "../../../alpine/line-chart/v1";

function makeCtx(W: number, H: number, durationMs = 9000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/gh-weekly-pulse" },
    media: {},
  } as unknown as MosaicEngineContext;
}

describe("@m0saic/github/weekly-pulse/v1", () => {
  it("is a registered capability-tier template", () => {
    expect(GithubWeeklyPulse.id).toBe("@m0saic/github/weekly-pulse/v1");
    expect(GithubWeeklyPulse.capabilities.tier).toBe("capability");
  });

  it("replay default renders the 8-beat pulse pipeline — network-free", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("NETWORK FORBIDDEN in replay mode");
    }) as typeof fetch;
    try {
      const out = (await GithubWeeklyPulse.render(GithubWeeklyPulse.defaultProps as never, makeCtx(640, 360))) as MosaicDocumentPipeline;
      expect(out.kind).toBe("mosaic_pipeline");
      expect(out.steps.length).toBe(8);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("live fetch failure degrades to an error frame (not a throw)", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      async text() { return "{}"; },
      async json() { return { message: "Not Found" }; },
      headers: { get: () => null },
    })) as unknown as typeof fetch;
    try {
      const out = (await GithubWeeklyPulse.render(
        { source: "live", repo: "o/nope", window: { startISO: "2026-07-06", endISO: "2026-07-12" } } as never,
        makeCtx(320, 180),
      )) as MosaicDocument;
      const src = out.sources[0] as { engine?: { renderStatus?: string; renderError?: { code?: string } } };
      expect(out.kind).toBe("mosaic_document");
      expect(src.engine?.renderStatus).toBe("error");
      expect(src.engine?.renderError?.code).toBe("GITHUB_FETCH_FAILED");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("rejects an unknown source (fail-fast on a malformed prop)", async () => {
    await expect(GithubWeeklyPulse.render({ source: "bogus" } as never, makeCtx(320, 180))).rejects.toThrow(/source must be/);
  });

  it("renderLite returns a network-free ready card (not a fetch, not a pipeline) by default", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("NETWORK FORBIDDEN on preview");
    }) as typeof fetch;
    try {
      const out = (await GithubWeeklyPulse.renderLite!({ source: "live", repo: "FFmpeg/FFmpeg" } as never, makeCtx(640, 360))) as MosaicDocument;
      expect(out.kind).toBe("mosaic_document");
      expect((out.sources[0] as { type?: string }).type).toBe("text"); // the friendly card
      expect((out.sources[0] as { engine?: { renderStatus?: string } }).engine?.renderStatus).toBeUndefined(); // not an error frame
    } finally {
      globalThis.fetch = original;
    }
  });

  it("renderLite with livePreview:true fetches (escape hatch) — degrades to an error frame on failure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false, status: 404, statusText: "Not Found",
      async text() { return "{}"; },
      async json() { return { message: "Not Found" }; },
      headers: { get: () => null },
    })) as unknown as typeof fetch;
    try {
      const out = (await GithubWeeklyPulse.renderLite!(
        { source: "live", repo: "o/nope", window: { startISO: "2026-07-06", endISO: "2026-07-12" }, livePreview: true } as never,
        makeCtx(320, 180),
      )) as MosaicDocument;
      expect((out.sources[0] as { engine?: { renderError?: { code?: string } } }).engine?.renderError?.code).toBe("GITHUB_FETCH_FAILED");
    } finally {
      globalThis.fetch = original;
    }
  });
});
