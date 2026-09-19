import type {
  MosaicDocumentPipeline,
  MosaicEngineContext,
} from "@m0saic/types";
import { computePipelineTimeline } from "@m0saic/types";
import { FfmpegPulseRunner, runnerPreviewStub } from "./runner";
// Register every beat + the alpine leaves the beats nest, so the runner's
// internal renderNestedTemplate calls resolve.
import "../../index"; // beats + runner + title/scatter-bake
import "../../../../alpine/stat-card/v1";
import "../../../../alpine/donut/v1";
import "../../../../alpine/heatmap/v1";
import "../../../../alpine/contributor-table/v1";
import "../../../../alpine/commit-feed/v1";
import "../../../../alpine/line-chart/v1";
import { MOCK_FFMPEG_PULSE } from "../../_shared/pulse-data";

function makeCtx(W: number, H: number, durationMs = 9000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/pulse-runner" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = (W: number, H: number, props: Record<string, unknown> = {}) =>
  FfmpegPulseRunner.render(
    { ...(FfmpegPulseRunner.defaultProps as object), ...props } as never,
    makeCtx(W, H),
  ) as Promise<MosaicDocumentPipeline>;

describe("FfmpegPulseRunner — requireUpstream (data-connected safety)", () => {
  it("returns a visible error frame (not the mock pipeline) when requireUpstream and no upstream", async () => {
    const doc = await FfmpegPulseRunner.render(
      { ...(FfmpegPulseRunner.defaultProps as object), requireUpstream: true } as never,
      makeCtx(640, 360),
    );
    expect((doc as { kind?: string }).kind).toBe("mosaic_document"); // an error mosaic, NOT the 8-beat pipeline
    const src = (doc as { sources?: Array<{ engine?: { renderStatus?: string; renderError?: { code?: string } } }> }).sources?.[0];
    expect(src?.engine?.renderStatus).toBe("error");
    expect(src?.engine?.renderError?.code).toBe("MISSING_UPSTREAM_WEEKLY_PULSE");
  });

  it("renders the normal pipeline when requireUpstream and upstream IS present", async () => {
    const ctx = { ...makeCtx(640, 360), upstreamData: { weeklyPulse: MOCK_FFMPEG_PULSE } } as MosaicEngineContext;
    const out = await FfmpegPulseRunner.render(
      { ...(FfmpegPulseRunner.defaultProps as object), requireUpstream: true } as never,
      ctx,
    );
    expect((out as { kind?: string }).kind).toBe("mosaic_pipeline");
  });
});

/** Count sources across every beat's NESTED children that carry a time-varying
 *  overlay.alpha — the per-pixel geq fade that `renderMode: "premium"` opts the
 *  leaf charts into. `light` leaves reveal via `overlay.enable` (no alpha), so
 *  this count isolates the render-mode effect from the beat-level chrome fades
 *  (which live on the beat doc's own sources, not its children). */
function nestedAlphaCount(pipeline: MosaicDocumentPipeline): number {
  let n = 0;
  for (const step of pipeline.steps ?? []) {
    const file = step.file as { children?: Record<string, unknown> };
    for (const child of Object.values(file?.children ?? {})) {
      const srcs = (child as { sources?: Array<{ overlay?: { alpha?: unknown } }> })?.sources ?? [];
      for (const s of srcs) {
        if (typeof s?.overlay?.alpha === "string" && s.overlay.alpha.length > 0) n++;
      }
    }
  }
  return n;
}

describe("FfmpegPulseRunner — metadata + renderMode knob", () => {
  it("is the registered pulse runner with a renderMode prop (light | premium, default premium)", () => {
    expect(FfmpegPulseRunner.id).toBe("@m0saic/hero/ffmpeg-pulse/runner/v1");
    expect(FfmpegPulseRunner.version).toBe(1);
    expect(FfmpegPulseRunner.tags).toEqual(expect.arrayContaining(["hero", "ffmpeg-pulse", "runner", "pipeline"]));

    const rm = (FfmpegPulseRunner.propsSchema as Record<string, any>).renderMode;
    expect(rm).toBeTruthy();
    expect(rm.meta.constraints.oneOf).toEqual(["light", "premium"]);
    expect((FfmpegPulseRunner.defaultProps as { renderMode?: string }).renderMode).toBe("premium");
  });
});

describe("FfmpegPulseRunner — renderLite (web-safe preview)", () => {
  it("composes the real 8-beat pipeline when the beats are registered (desktop)", async () => {
    // This suite imports every beat, so renderLite takes the real path.
    const out = await FfmpegPulseRunner.renderLite!(
      FfmpegPulseRunner.defaultProps as never,
      makeCtx(1280, 720),
    );
    expect((out as MosaicDocumentPipeline).kind).toBe("mosaic_pipeline");
    expect((out as MosaicDocumentPipeline).steps.length).toBe(8);
  });

  it("runnerPreviewStub returns a self-contained stand-in mosaic (the web fallback)", () => {
    // The renderLite branch taken on the web build, where the node-only beat
    // templates aren't registered: a single stub document, no nested composition.
    const stub = runnerPreviewStub(makeCtx(1920, 1080)) as {
      kind: string;
      sources?: Array<{ layers?: Array<{ content?: { text?: string } }> }>;
    };
    expect(stub.kind).toBe("mosaic_document");
    const text = JSON.stringify(stub);
    expect(text).toContain("Weekly Pulse - Runner");
  });
});

describe("FfmpegPulseRunner — the pipeline stitches to its advertised length", () => {
  const HINTED_MS = 38000; // outputHints.durationMs — what the hero promises

  it("carries each crossfade on the beat that fades out, so the stitch lands on 38s", async () => {
    const crossfadeMs = 350;
    const p = await render(1280, 720, { crossfadeMs });

    const timeline = computePipelineTimeline(p, {
      targetSize: { width: 1280, height: 720 },
    })!;

    // 8 beats, 7 crossfades. Each fade OVERLAPS its two beats, so the
    // steps must sum to 38000 + 7×350 for the stitch to come out at
    // 38000. Asserting the plain sum instead is what let this render
    // 35550ms while declaring 38000ms.
    const sum = p.steps.reduce((acc, s) => acc + s.durationMs, 0);
    const fades = p.steps.filter((s) => s.transitionToNext).length;
    expect(fades).toBe(7);
    expect(sum).toBe(HINTED_MS + fades * crossfadeMs);
    expect(timeline.naturalDurationMs).toBe(HINTED_MS);
  });

  it("lands on the same total with crossfades disabled", async () => {
    const p = await render(1280, 720, { crossfadeMs: 0 });
    expect(p.steps.some((s) => s.transitionToNext)).toBe(false);
    expect(
      computePipelineTimeline(p, { targetSize: { width: 1280, height: 720 } })!
        .naturalDurationMs,
    ).toBe(HINTED_MS);
  });

  it("holds for a non-default crossfade", async () => {
    const p = await render(1280, 720, { crossfadeMs: 800 });
    expect(
      computePipelineTimeline(p, { targetSize: { width: 1280, height: 720 } })!
        .naturalDurationMs,
    ).toBe(HINTED_MS);
  });
});

describe("FfmpegPulseRunner — renderMode propagates to every beat", () => {
  it("emits an 8-step pipeline; the default (premium) puts the nested chart leaves on the geq path", async () => {
    const premiumA = await render(1280, 720);
    const premiumB = await render(1280, 720);
    const light = await render(1280, 720, { renderMode: "light" });

    // Shape: a cross-faded pipeline, one step per beat.
    expect(premiumA.kind).toBe("mosaic_pipeline");
    expect(premiumA.steps.length).toBe(8);
    expect(light.steps.length).toBe(8);

    // Deterministic given identical inputs.
    expect(JSON.stringify(premiumA)).toBe(JSON.stringify(premiumB));

    // The knob actually changes output (propagation is real, not a no-op)…
    expect(JSON.stringify(light)).not.toBe(JSON.stringify(premiumA));
    // …and specifically the default (premium) flips the nested chart leaves onto
    // the geq alpha-fade path: it carries strictly more time-varying child alpha
    // than light (which reveals those leaves via free enable-gate pops instead).
    expect(nestedAlphaCount(premiumA)).toBeGreaterThan(nestedAlphaCount(light));
  });
});
