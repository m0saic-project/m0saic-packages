import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaMetadata,
  MosaicTextSidecar,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { grid } from "@m0saic/dsl-stdlib";
import {
  buildSheetM0,
  buildTrickplayStepsForInput,
  sheetStepName,
  IMAGE_STEP_MS,
  type TrickplayStepKnobs,
} from "./pipeline";

const INPUT = "/abs/media/clip.mp4";

const VIDEO_META: MosaicMediaMetadata = {
  kind: "video",
  width: 1280,
  height: 720,
  hasVideo: true,
  hasAudio: true,
  durationMs: 300_000,
  fps: 30,
};

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

// 15 thumbs into 4×2 sheets → steps of 8 + 7 (tileH = 160·720/1280 = 90).
const KNOBS: TrickplayStepKnobs = {
  intervalSec: 20,
  tileWidth: 160,
  cols: 4,
  rowsPerSheet: 2,
  outputFormat: "png",
};

function buildSteps(knobs: Partial<TrickplayStepKnobs> = {}) {
  return buildTrickplayStepsForInput({
    inputPath: INPUT,
    stepBaseName: "clip",
    knobs: { ...KNOBS, ...knobs },
    ctx: makeCtx({ [INPUT]: VIDEO_META }),
  });
}

describe("buildSheetM0", () => {
  it("matches grid() exactly for a full sheet", () => {
    expect(buildSheetM0(3, 4, 12)).toBe(String(grid({ rows: 3, cols: 4 }).m0));
    expect(buildSheetM0(1, 3, 3)).toBe(String(grid({ rows: 1, cols: 3 }).m0));
  });

  it("emits valid m0 with trailing holes for partial sheets", () => {
    for (const [rows, cols, n] of [
      [2, 4, 7],
      [1, 3, 2],
      [2, 1, 1],
      [3, 4, 9],
    ] as const) {
      const m0 = buildSheetM0(rows, cols, n);
      expect(isValidM0String(m0)).toBe(true);
      // Rendered-tile count == thumbCount; holes fill the remainder.
      expect((m0.match(/1/g) ?? []).length).toBe(n);
      expect((m0.match(/-/g) ?? []).length).toBe(rows * cols - n);
    }
    expect(buildSheetM0(2, 4, 7)).toBe("2[4(1,1,1,1),4(1,1,1,-)]");
    expect(buildSheetM0(3, 4, 9)).toBe("3[4(1,1,1,1),4(1,1,1,1),4(1,-,-,-)]");
  });
});

describe("sheetStepName", () => {
  it("appends a 1-based zero-padded sheet ordinal", () => {
    expect(sheetStepName("clip", 0)).toBe("clip__sheet_01");
    expect(sheetStepName("my-movie.v2", 11)).toBe("my-movie.v2__sheet_12");
  });
});

describe("buildTrickplayStepsForInput — sheets and cells", () => {
  it("fans one input out to one step per sheet with trimmed geometry", () => {
    const steps = buildSteps();
    expect(steps.map((s) => s.name)).toEqual(["clip__sheet_01", "clip__sheet_02"]);
    expect(steps.map((s) => s.label)).toEqual([
      "clip (sheet 1/2)",
      "clip (sheet 2/2)",
    ]);
    const [d1, d2] = steps.map((s) => s.file as MosaicDocument);
    expect(d1.sources).toHaveLength(8);
    expect(d2.sources).toHaveLength(7);
    expect(d1.size).toEqual({ width: 640, height: 180 });
    expect(d2.size).toEqual({ width: 640, height: 180 });
    expect(d1.backgroundColor).toBe("#000000");
    expect(String(d1.m0)).toBe(buildSheetM0(2, 4, 8));
    expect(String(d2.m0)).toBe("2[4(1,1,1,1),4(1,1,1,-)]");
    expect(isValidM0String(String(d2.m0))).toBe(true);
  });

  it("seeks each cell at the fixed cadence (freeze-frame playback in image mode)", () => {
    const steps = buildSteps();
    const d1 = steps[0].file as MosaicDocument;
    const d2 = steps[1].file as MosaicDocument;
    const frameMs = Math.round(1000 / 30);
    expect(d1.sources[0]).toMatchObject({
      type: "media",
      mediaType: "video",
      placement: { fit: "cover" },
      playback: { clipStartMs: 0, clipDurationMs: frameMs, loopMode: "freeze" },
      audio: { enabled: false },
    });
    expect(d1.sources[3]).toMatchObject({ playback: { clipStartMs: 60_000 } });
    // Sheet 2's first cell = global thumb 8 → 160s.
    expect(d2.sources[0]).toMatchObject({ playback: { clipStartMs: 160_000 } });
  });

  it("shares one asset-manifest entry across all cells", () => {
    const d1 = buildSteps()[0].file as MosaicDocument;
    const assetIds = Object.keys(d1.assets);
    expect(assetIds).toHaveLength(1);
    expect(d1.assets[asAssetId(assetIds[0])]).toMatchObject({
      kind: "file",
      path: INPUT,
      mediaType: "video",
    });
    for (const s of d1.sources) expect((s as { assetId?: string }).assetId).toBe(assetIds[0]);
  });
});

describe("buildTrickplayStepsForInput — formats and durations", () => {
  it("png mode: image steps with IMAGE_STEP_MS duration", () => {
    const steps = buildSteps();
    for (const s of steps) {
      expect(s.durationMs).toBe(IMAGE_STEP_MS);
      expect((s.file as MosaicDocument).format).toEqual({ kind: "image", container: "png" });
    }
  });

  it("jpeg mode: per-step jpeg container, sidecars still emitted", () => {
    const steps = buildSteps({ outputFormat: "jpeg" });
    expect((steps[0].file as MosaicDocument).format).toEqual({
      kind: "image",
      container: "jpeg",
    });
    expect((steps[0].file as MosaicDocument).sidecars).toBeDefined();
  });

  it("mp4 mode: video steps playing from each seek, target duration, no sidecars", () => {
    const steps = buildSteps({ outputFormat: "mp4" });
    const d1 = steps[0].file as MosaicDocument;
    expect(d1.format).toEqual({ kind: "video", container: "mp4" });
    expect(steps[0].durationMs).toBe(2000); // ctx.target.durationMs
    expect(d1.sources[0]).toMatchObject({ playback: { clipStartMs: 0 } });
    expect((d1.sources[0] as { playback?: { loopMode?: string } }).playback?.loopMode).toBeUndefined();
    expect(d1.sidecars).toBeUndefined();
    expect((steps[1].file as MosaicDocument).sidecars).toBeUndefined();
  });
});

describe("buildTrickplayStepsForInput — index sidecars", () => {
  it("attaches the per-input manifest + VTT to the FIRST sheet step only", () => {
    const steps = buildSteps();
    const d1 = steps[0].file as MosaicDocument;
    const d2 = steps[1].file as MosaicDocument;
    expect(Object.keys(d1.sidecars ?? {}).sort()).toEqual(["storyboard", "trickplay"]);
    expect(d2.sidecars).toBeUndefined();

    const storyboard = d1.sidecars!.storyboard as MosaicTextSidecar;
    expect(storyboard.kind).toBe("text");
    expect(storyboard.ext).toBe("vtt");
    expect(storyboard.content.startsWith("WEBVTT\n")).toBe(true);
    expect(storyboard.content).toContain("{{stepOutput:clip__sheet_01}}#xywh=0,0,160,90");
    expect(storyboard.content).toContain("{{stepOutput:clip__sheet_02}}#xywh=0,0,160,90");

    const manifest = d1.sidecars!.trickplay as Record<string, unknown>;
    expect(manifest).toMatchObject({
      version: 1,
      input: INPUT,
      durationMs: 300_000,
      intervalMs: 20_000,
      thumbnailCount: 15,
      jellyfin: { Width: 160, Height: 90, TileWidth: 4, TileHeight: 2, ThumbnailCount: 15, Interval: 20_000 },
      dashIf: { schemeIdUri: "http://dashif.org/guidelines/thumbnail_tile", value: "4x2" },
    });
    expect((manifest.sheets as unknown[]).length).toBe(2);
    expect((manifest.sheets as Array<{ file: string }>)[1].file).toBe(
      "{{stepOutput:clip__sheet_02}}",
    );
  });
});

describe("buildTrickplayStepsForInput — error steps", () => {
  const expectSingleErrorStep = (
    steps: ReturnType<typeof buildTrickplayStepsForInput>,
  ) => {
    expect(steps).toHaveLength(1);
    expect(steps[0].name).toBe("clip__sheet_01");
    const doc = steps[0].file as MosaicDocument;
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.sidecars).toBeUndefined();
  };

  it("no probed metadata → one error step", () => {
    expectSingleErrorStep(
      buildTrickplayStepsForInput({
        inputPath: INPUT,
        stepBaseName: "clip",
        knobs: KNOBS,
        ctx: makeCtx({}),
      }),
    );
  });

  it("non-video input → one error step", () => {
    expectSingleErrorStep(
      buildTrickplayStepsForInput({
        inputPath: INPUT,
        stepBaseName: "clip",
        knobs: KNOBS,
        ctx: makeCtx({ [INPUT]: { ...VIDEO_META, kind: "image" } }),
      }),
    );
  });

  it("video without duration → one error step", () => {
    const noDur = { ...VIDEO_META };
    delete (noDur as { durationMs?: number }).durationMs;
    expectSingleErrorStep(
      buildTrickplayStepsForInput({
        inputPath: INPUT,
        stepBaseName: "clip",
        knobs: KNOBS,
        ctx: makeCtx({ [INPUT]: noDur }),
      }),
    );
  });
});
