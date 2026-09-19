import { describe, expect, it, beforeEach } from "@jest/globals";
import { asAliasId, asAssetId, asTemplateId } from "@m0saic/types";
import type {
  ForensicWatermarkSidecar,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicRenderableFile,
} from "@m0saic/types";

import { ForensicWatermarkVideoV1, cellActivity, resolveOutputEnvelope } from "./forensic-watermark";

/** The engine's `ctx.analysis.cellLuminance` pass, faked. */
const cellLuminance = jest.fn();

const VIDEO = "/tmp/fake-base.mp4";

function makeCtx(opts: {
  width?: number;
  height?: number;
  durationMs?: number;
  fps?: number;
  /** Probed source metadata under VIDEO (what the host's ffprobe found). */
  media?: { width: number; height: number; fps?: number; durationMs?: number; kind?: string };
  analysis?: boolean;
  userIntent?: { fps?: number; durationMs?: number };
} = {}): MosaicEngineContext {
  const width = opts.width ?? 320;
  const height = opts.height ?? 180;
  const durationMs = opts.durationMs ?? 1000;
  const fps = opts.fps ?? 24;
  const media = opts.media
    ? {
        [asAssetId(VIDEO)]: {
          kind: opts.media.kind ?? "video",
          width: opts.media.width,
          height: opts.media.height,
          hasVideo: true,
          hasAudio: true,
          ...(opts.media.fps !== undefined ? { fps: opts.media.fps } : {}),
          ...(opts.media.durationMs !== undefined ? { durationMs: opts.media.durationMs } : {}),
        },
      }
    : {};
  return {
    mode: "render",
    target: { width, height, durationMs, fps },
    output: {
      width,
      height,
      fps,
      durationMs,
      target: "media",
      format: { kind: "video", container: "mp4", videoCodec: "libx264" },
      audio: undefined,
      color: undefined,
    },
    workspaceDir: ".",
    media,
    ...(opts.analysis === false ? {} : { analysis: { cellLuminance } }),
    ...(opts.userIntent ? { userIntent: opts.userIntent } : {}),
    aliases: { root: asAliasId("root") },
    refsByAlias: {},
    upstreamData: {},
    upstreamVariables: {},
    upstreamRoot: undefined,
    upstreamCollect: { variables: () => ({}), data: () => ({}) },
    diagnostics: [],
    secrets: { resolve: () => Promise.resolve(undefined) },
    templateRepoRoot: undefined,
    activeTemplateId: asTemplateId("@m0saic/forensic/watermark/video/v1"),
    invocationDepth: 0,
    sourcePath: undefined,
  } as unknown as MosaicEngineContext;
}

const HOST_16x9 = new Array(16 * 9).fill(128);

/** The happy path is a 1-step multi-emit pipeline; pull its step doc. */
function stepOf(r: MosaicRenderableFile): MosaicDocument {
  expect(r.kind).toBe("mosaic_pipeline");
  const p = r as MosaicDocumentPipeline;
  expect(p.emit).toBe("multi");
  expect(p.steps).toHaveLength(1);
  const step = p.steps[0]!;
  expect(step.file).toBeDefined();
  return step.file as MosaicDocument;
}

function sidecarOf(r: MosaicRenderableFile): ForensicWatermarkSidecar {
  const sc = (stepOf(r).sidecars as { watermark?: ForensicWatermarkSidecar } | undefined)?.watermark;
  expect(sc).toBeDefined();
  return sc!;
}

beforeEach(() => {
  cellLuminance.mockReset();
  cellLuminance.mockResolvedValue({ luminanceGrid: HOST_16x9.slice(), frameCount: 24 });
});

describe("ForensicWatermarkVideoV1 — validation (error cards, never throws)", () => {
  it("rejects missing videoPath with an error mosaic", async () => {
    const doc = await ForensicWatermarkVideoV1.render({}, makeCtx());
    expect(doc.kind).toBe("mosaic_document");
    const sources = (doc as MosaicDocument).sources;
    expect(sources.length).toBeGreaterThan(0);
    expect((doc as MosaicDocument).sidecars).toBeUndefined();
    expect(cellLuminance).not.toHaveBeenCalled();
  });

  it("rejects malformed payloadHex", async () => {
    const doc = await ForensicWatermarkVideoV1.render(
      { videoPath: "/dev/null", payloadMode: "id32", payloadHex: "nothex!" },
      makeCtx(),
    );
    expect(doc.kind).toBe("mosaic_document");
    expect((doc as MosaicDocument).sidecars).toBeUndefined();
  });

  it("rejects payloadHex of wrong length for the mode", async () => {
    const doc = await ForensicWatermarkVideoV1.render(
      { videoPath: "/dev/null", payloadMode: "uuid128", payloadHex: "deadbeef" },
      makeCtx(),
    );
    expect(doc.kind).toBe("mosaic_document");
    expect((doc as MosaicDocument).sidecars).toBeUndefined();
  });

  it("rejects a non-video input the host probed as an image", async () => {
    const doc = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, gridCols: 16, gridRows: 9 },
      makeCtx({ media: { width: 800, height: 600, kind: "image" } }),
    );
    expect(doc.kind).toBe("mosaic_document");
    expect(JSON.stringify(doc)).toContain("needs a video input");
    expect(cellLuminance).not.toHaveBeenCalled();
  });

  it("renders an error card (no sidecar) when the host attached no analysis and no host grid was given", async () => {
    // A packaged desktop without a toolchain / internal tooling: say what is
    // missing instead of guessing at an `ffmpeg` on PATH.
    const doc = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, gridCols: 16, gridRows: 9 },
      makeCtx({ analysis: false }),
    );
    expect(doc.kind).toBe("mosaic_document");
    expect((doc as MosaicDocument).sidecars).toBeUndefined();
    expect(JSON.stringify(doc)).toContain("m0saic setup");
  });

  it("renders an error card when the engine probe fails", async () => {
    cellLuminance.mockRejectedValue(new Error("ffmpeg probe failed (exit 1): no such file"));
    const doc = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, gridCols: 16, gridRows: 9 },
      makeCtx(),
    );
    expect(doc.kind).toBe("mosaic_document");
    expect(JSON.stringify(doc)).toContain("host-luminance probe failed");
  });

  it("rejects an inverted adaptive curve", async () => {
    const doc = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, gridCols: 16, gridRows: 9, luminanceAdaptive: true, alphaMin: 0.05, alphaMax: 0.01, hostLuminanceGrid: HOST_16x9 },
      makeCtx(),
    );
    expect(doc.kind).toBe("mosaic_document");
    expect(JSON.stringify(doc)).toContain("alphaMin");
  });
});

describe("ForensicWatermarkVideoV1 — happy path", () => {
  it("produces a 1-step multi-emit pipeline whose step carries sidecar.watermark", async () => {
    const r = await ForensicWatermarkVideoV1.render(
      {
        videoPath: VIDEO,
        payloadMode: "id32",
        payloadHex: "deadbeef",
        keyHex: "12345678",
        gridCols: 16,
        gridRows: 9,
        alphaBase: 0.012,
        hostLuminanceGrid: HOST_16x9,
      },
      makeCtx({ width: 320, height: 180, durationMs: 1000, fps: 24 }),
    );
    const step = stepOf(r);
    expect(step.format).toEqual({ kind: "video", container: "mp4" });
    expect(step.sources).toHaveLength(2);
    const sidecar = sidecarOf(r);
    expect(sidecar.version).toBe("watermark/v1");
    expect(sidecar.algorithm).toBe("spatio-temporal-ab-bch");
    expect(sidecar.payload.mode).toBe("id32");
    expect(sidecar.payload.bits).toBe(32);
    expect(sidecar.payload.valueHex).toBe("deadbeef");
    expect(sidecar.grid.cols).toBe(16);
    expect(sidecar.grid.rows).toBe(9);
    expect(sidecar.key.seedHex).toBe("12345678");
    expect(sidecar.ecc.n).toBe(127);
    // Gate-34 tuned defaults: adaptive α on, texture mask, soft edges.
    expect(sidecar.embed).toEqual({ alphaBase: 0.012, alphaMin: 0.004, alphaMax: 0.02, luminanceAdaptive: true });
    expect(sidecar.hostReference.luminanceGrid).toEqual([HOST_16x9]);
  });

  it("falls back to the target envelope when the host probed no media (render dims + frame count in the sidecar)", async () => {
    const r = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, payloadHex: "00000001", keyHex: "abcdef01", gridCols: 16, gridRows: 9, hostLuminanceGrid: HOST_16x9 },
      makeCtx({ width: 320, height: 180, durationMs: 2000, fps: 30 }),
    );
    const step = stepOf(r);
    expect(step.size).toEqual({ width: 320, height: 180 });
    expect(step.fps).toBe(30);
    expect(step.durationMs).toBe(2000);
    const sidecar = sidecarOf(r);
    expect(sidecar.render).toEqual({ width: 320, height: 180, fps: 30, durationMs: 2000 });
    expect(sidecar.slots.framesPerSlot).toBe(60);
  });

  it("FOLLOWS the source: output size / fps / duration come from the probed video, not the 1920×1080 / 10 s hints", async () => {
    const r = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, gridCols: 16, gridRows: 9, hostLuminanceGrid: HOST_16x9 },
      makeCtx({
        width: 1920, height: 1080, durationMs: 10_000, fps: 30,
        media: { width: 1280, height: 720, fps: 25, durationMs: 12_160 },
      }),
    );
    const step = stepOf(r);
    expect(step.size).toEqual({ width: 1280, height: 720 });
    expect(step.fps).toBe(25);
    expect(step.durationMs).toBe(12_160);
    const p = r as MosaicDocumentPipeline;
    expect(p.fps).toBe(25);
    expect(p.steps[0]!.durationMs).toBe(12_160);
    expect(p.steps[0]!.name).toBeTruthy();
    const sidecar = sidecarOf(r);
    expect(sidecar.render).toEqual({ width: 1280, height: 720, fps: 25, durationMs: 12_160 });
    expect(sidecar.slots.framesPerSlot).toBe(304);
  });

  it("an EXPLICIT user duration / fps ask still wins over the follow", async () => {
    const r = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, gridCols: 16, gridRows: 9, hostLuminanceGrid: HOST_16x9 },
      makeCtx({
        width: 1920, height: 1080, durationMs: 3000, fps: 24,
        media: { width: 1280, height: 720, fps: 25, durationMs: 12_160 },
        userIntent: { durationMs: 3000, fps: 24 },
      }),
    );
    const step = stepOf(r);
    expect(step.size).toEqual({ width: 1280, height: 720 });
    expect(step.durationMs).toBe(3000);
    expect(step.fps).toBe(24);
  });

  it("even-rounds odd probed dimensions (yuv420p needs even sizes)", () => {
    const env = resolveOutputEnvelope(
      { kind: "video", width: 1279, height: 719, fps: 29.97, durationMs: 5733.33, hasVideo: true, hasAudio: false },
      { target: { width: 1920, height: 1080, fps: 30, durationMs: 10_000 } } as never,
    );
    expect(env).toEqual({ width: 1280, height: 720, fps: 30, durationMs: 5733, followed: true });
  });

  it("probes the SOURCE through ctx.analysis.cellLuminance with the render's envelope (cover-fit + hold, rate + duration pinned)", async () => {
    const r = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, gridCols: 16, gridRows: 9, luminanceAdaptive: false },
      makeCtx({ media: { width: 1280, height: 720, fps: 25, durationMs: 4000 } }),
    );
    expect(cellLuminance).toHaveBeenCalledTimes(1);
    expect(cellLuminance.mock.calls[0]).toEqual([
      VIDEO,
      { cols: 16, rows: 9, coverTo: { width: 1280, height: 720 }, holdLastFrame: true, fps: 25, durationMs: 4000 },
    ]);
    expect(sidecarOf(r).hostReference.luminanceGrid).toEqual([HOST_16x9]);
  });

  it("uses the same keyHex twice → identical sidecar.key", async () => {
    const args = {
      videoPath: VIDEO,
      payloadMode: "id32" as const,
      payloadHex: "cafebabe",
      keyHex: "12345678",
      gridCols: 16,
      gridRows: 9,
      hostLuminanceGrid: HOST_16x9,
    };
    const a = sidecarOf(await ForensicWatermarkVideoV1.render(args, makeCtx({ width: 256, height: 144 }))).key.seedHex;
    const b = sidecarOf(await ForensicWatermarkVideoV1.render(args, makeCtx({ width: 256, height: 144 }))).key.seedHex;
    expect(a).toBe(b);
  });

  it("auto-derives keyHex from payloadHex when keyHex omitted", async () => {
    const base = { videoPath: VIDEO, payloadMode: "id32" as const, gridCols: 16, gridRows: 9, hostLuminanceGrid: HOST_16x9 };
    const a = sidecarOf(await ForensicWatermarkVideoV1.render({ ...base, payloadHex: "babecafe" }, makeCtx())).key.seedHex;
    const b = sidecarOf(await ForensicWatermarkVideoV1.render({ ...base, payloadHex: "babecafe" }, makeCtx())).key.seedHex;
    expect(a).toBe(b);
    // Different payload → different auto-derived key.
    const c = sidecarOf(await ForensicWatermarkVideoV1.render({ ...base, payloadHex: "deadbeef" }, makeCtx())).key.seedHex;
    expect(a).not.toBe(c);
  });
});

describe("ForensicWatermarkVideoV1 — adaptive α (the alphaMin / alphaMax knobs are wired)", () => {
  // A host grid with a dark band, a mid-grey band and a bright band.
  const HOST_BANDS = Array.from({ length: 16 * 9 }, (_, i) => (i < 48 ? 10 : i < 96 ? 128 : 245));

  it("off: every cell embeds at alphaBase and the sidecar says so", async () => {
    const sc = sidecarOf(
      await ForensicWatermarkVideoV1.render(
        { videoPath: VIDEO, gridCols: 16, gridRows: 9, alphaBase: 0.012, luminanceAdaptive: false, hostLuminanceGrid: HOST_BANDS },
        makeCtx(),
      ),
    );
    expect(sc.embed).toEqual({ alphaBase: 0.012, alphaMin: 0.004, alphaMax: 0.02, luminanceAdaptive: false });
  });

  it("on: the sidecar records the curve and the mask fingerprint changes with the host grid", async () => {
    const on = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, keyHex: "0000abcd", gridCols: 16, gridRows: 9, luminanceAdaptive: true, hostLuminanceGrid: HOST_BANDS },
      makeCtx(),
    );
    const off = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, keyHex: "0000abcd", gridCols: 16, gridRows: 9, luminanceAdaptive: false, hostLuminanceGrid: HOST_BANDS },
      makeCtx(),
    );
    expect(sidecarOf(on).embed.luminanceAdaptive).toBe(true);
    // Same payload + key + grid: only the per-cell α differs, so the two
    // renders must materialize DIFFERENT mask PNGs (content-addressed).
    const maskPath = (r: MosaicRenderableFile) =>
      (stepOf(r).assets as Record<string, { path: string }>)[asAssetId("forensic_v1_mask")]!.path;
    expect(maskPath(on)).not.toBe(maskPath(off));
    // And the decoder-facing record is otherwise identical.
    expect(sidecarOf(on).key).toEqual(sidecarOf(off).key);
    expect(sidecarOf(on).hostReference).toEqual(sidecarOf(off).hostReference);
  });
});

describe("ForensicWatermarkVideoV1 — texture mask + soft edges", () => {
  it("cellActivity: spread of each cell's 2×2 sub-cells", () => {
    // 2 cols × 1 row → fine grid 4 × 2
    const fine = [10, 20, 100, 100, 30, 10, 100, 100];
    expect(cellActivity(fine, 2, 1)).toEqual([20, 0]);
  });

  it("adaptive α probes the source TWICE — the 1× reference and a 2× texture grid", async () => {
    cellLuminance.mockImplementation(async (_p: string, o: { cols: number; rows: number }) => ({
      luminanceGrid: new Array(o.cols * o.rows).fill(128),
      frameCount: 10,
    }));
    const r = await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, gridCols: 16, gridRows: 9, luminanceAdaptive: true },
      makeCtx({ media: { width: 1280, height: 720, fps: 25, durationMs: 4000 } }),
    );
    expect(cellLuminance).toHaveBeenCalledTimes(2);
    expect(cellLuminance.mock.calls[0]![1]).toMatchObject({ cols: 16, rows: 9 });
    expect(cellLuminance.mock.calls[1]![1]).toMatchObject({ cols: 32, rows: 18, coverTo: { width: 1280, height: 720 } });
    // The decoder-facing reference is the 1× grid only.
    expect(sidecarOf(r).hostReference.luminanceGrid[0]).toHaveLength(16 * 9);
  });

  it("non-adaptive probes once (no texture pass)", async () => {
    await ForensicWatermarkVideoV1.render(
      { videoPath: VIDEO, gridCols: 16, gridRows: 9, luminanceAdaptive: false },
      makeCtx({ media: { width: 1280, height: 720, fps: 25, durationMs: 4000 } }),
    );
    expect(cellLuminance).toHaveBeenCalledTimes(1);
  });

  it("edgeSoftness is part of the mask's content address", async () => {
    const base = { videoPath: VIDEO, keyHex: "0000abcd", gridCols: 16, gridRows: 9, hostLuminanceGrid: HOST_16x9 };
    const hard = await ForensicWatermarkVideoV1.render({ ...base, edgeSoftness: 0 }, makeCtx());
    const soft = await ForensicWatermarkVideoV1.render({ ...base, edgeSoftness: 0.2 }, makeCtx());
    const maskPath = (r: MosaicRenderableFile) =>
      (stepOf(r).assets as Record<string, { path: string }>)[asAssetId("forensic_v1_mask")]!.path;
    expect(maskPath(hard)).not.toBe(maskPath(soft));
    // Softness never touches the decoder's recipe.
    expect(sidecarOf(hard)).toEqual(sidecarOf(soft));
  });
});

describe("ForensicWatermarkVideoV1 — renderLite (design-mode stand-in)", () => {
  it("is declared, so selecting the template in Make never probes the source", () => {
    expect(typeof ForensicWatermarkVideoV1.renderLite).toBe("function");
  });

  it("shows the picked video above a NOT YET EMBEDDED band, with no sidecar and no probe", () => {
    const doc = ForensicWatermarkVideoV1.renderLite!(
      { videoPath: VIDEO, payloadHex: "deadbeef" },
      makeCtx({ width: 1280, height: 720 }),
    ) as MosaicDocument;
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.sidecars).toBeUndefined();
    expect(cellLuminance).not.toHaveBeenCalled();
    expect(doc.assets?.[asAssetId("forensic_v1_base")]).toEqual({ kind: "file", path: VIDEO, mediaType: "video" });
    const json = JSON.stringify(doc.sources);
    expect(json).toContain("NOT YET EMBEDDED");
    expect(json).toContain("deadbeef");
  });

  it("falls back to the instructional card without a video", () => {
    const doc = ForensicWatermarkVideoV1.renderLite!({}, makeCtx()) as MosaicDocument;
    expect(doc.kind).toBe("mosaic_document");
    expect(Object.keys(doc.assets ?? {})).toHaveLength(0);
  });
});
