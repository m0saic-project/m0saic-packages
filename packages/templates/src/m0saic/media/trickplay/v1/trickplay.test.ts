import type {
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaMetadata,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { Trickplay, resolveTrickplayKnobs } from "./trickplay";

const CLIP_A = "/abs/media/alpha.mp4";
const CLIP_B = "/abs/media/beta.mp4";

function videoMeta(durationMs: number): MosaicMediaMetadata {
  return {
    kind: "video",
    width: 1280,
    height: 720,
    hasVideo: true,
    hasAudio: true,
    durationMs,
    fps: 30,
  };
}

function makeCtx(media?: Record<string, MosaicMediaMetadata>): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 2000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 2000 },
    media: Object.fromEntries(
      Object.entries(media ?? {}).map(([k, v]) => [asAssetId(k), v]),
    ),
  } as MosaicEngineContext;
}

describe("Trickplay template metadata", () => {
  it("registers the versioned id with core-tier capabilities", () => {
    expect(Trickplay.id).toBe("@m0saic/media/trickplay/v1");
    expect(Trickplay.version).toBe(1);
    expect(Trickplay.capabilities).toEqual({ tier: "core" });
  });

  it("declares outputHints.format image/png (the frozen 0.2.0 declaration; steps still carry per-step formats)", () => {
    expect(Trickplay.outputHints?.format).toEqual({ kind: "image", container: "png" });
  });

  it("has deterministic defaults", () => {
    expect(Trickplay.defaultProps).toEqual({
      intervalSec: 10,
      tileWidth: 320,
      cols: 10,
      rowsPerSheet: 10,
      outputFormat: "png",
    });
  });
});

describe("resolveTrickplayKnobs", () => {
  it("applies defaults and clamps out-of-range values", () => {
    expect(resolveTrickplayKnobs({})).toEqual({
      intervalSec: 10,
      tileWidth: 320,
      cols: 10,
      rowsPerSheet: 10,
      outputFormat: "png",
    });
    expect(resolveTrickplayKnobs({ intervalSec: 0.2, tileWidth: 8, cols: 99, rowsPerSheet: 0 })).toEqual({
      intervalSec: 1,
      tileWidth: 64,
      cols: 20,
      rowsPerSheet: 1,
      outputFormat: "png",
    });
  });

  it("falls back to png on an unknown outputFormat", () => {
    expect(
      resolveTrickplayKnobs({ outputFormat: "gif" as unknown as "png" }).outputFormat,
    ).toBe("png");
    expect(resolveTrickplayKnobs({ outputFormat: "mp4" }).outputFormat).toBe("mp4");
  });
});

describe("Trickplay render dispatch", () => {
  it("no inputs → a fail-fast error mosaic (single document, not a pipeline)", async () => {
    const out = await Trickplay.render({}, makeCtx());
    expect(out.kind).toBe("mosaic_document");
  });

  it("always returns an emit:multi pipeline, fanning inputs × sheets", async () => {
    // alpha: 300s @ 10s = 30 thumbs → 1 sheet (10×10 capacity).
    // beta: 1200s @ 10s = 120 thumbs → 2 sheets (100 + 20).
    const out = (await Trickplay.render(
      { sourceIds: [CLIP_A, CLIP_B] },
      makeCtx({ [CLIP_A]: videoMeta(300_000), [CLIP_B]: videoMeta(1_200_000) }),
    )) as MosaicDocumentPipeline;

    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.emit).toBe("multi");
    expect(out.steps.map((s) => s.name)).toEqual([
      "alpha__sheet_01",
      "beta__sheet_01",
      "beta__sheet_02",
    ]);
  });

  it("a single input still returns a pipeline (per-step canvas sizing)", async () => {
    const out = (await Trickplay.render(
      { sourceIds: [CLIP_A] },
      makeCtx({ [CLIP_A]: videoMeta(60_000) }),
    )) as MosaicDocumentPipeline;
    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.emit).toBe("multi");
    expect(out.steps).toHaveLength(1);
  });

  it("a bad input degrades to an error step without killing the batch", async () => {
    const out = (await Trickplay.render(
      { sourceIds: [CLIP_A, CLIP_B] },
      makeCtx({ [CLIP_B]: videoMeta(60_000) }), // CLIP_A unprobed
    )) as MosaicDocumentPipeline;
    expect(out.steps).toHaveLength(2);
    expect(out.steps.map((s) => s.name)).toEqual(["alpha__sheet_01", "beta__sheet_01"]);
  });
});
