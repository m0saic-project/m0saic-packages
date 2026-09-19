import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaMetadata,
  MosaicMediaSource,
  MosaicRenderableFile,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { FrameStripper } from "./video-to-png-sequence";

function makeCtx(args?: {
  width?: number;
  height?: number;
  fps?: number;
  durationMs?: number;
  media?: Record<string, MosaicMediaMetadata>;
}): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: {
      width: args?.width ?? 1920,
      height: args?.height ?? 1080,
      fps: args?.fps ?? 30,
      durationMs: args?.durationMs ?? 1000,
    },
    output: {
      width: args?.width ?? 1920,
      height: args?.height ?? 1080,
      fps: args?.fps ?? 30,
      durationMs: args?.durationMs ?? 1000,
      workspaceDir: "/tmp",
    },
    media: (args?.media ?? {}) as MosaicEngineContext["media"],
  };
}

function isPipeline(file: MosaicRenderableFile): file is MosaicDocumentPipeline {
  return file.kind === "mosaic_pipeline";
}

function asPipeline(file: MosaicRenderableFile): MosaicDocumentPipeline {
  expect(isPipeline(file)).toBe(true);
  return file as MosaicDocumentPipeline;
}

const SAMPLE_PATH = "/abs/path/to/sample.mp4";
const OTHER_PATH = "/abs/path/to/other.mp4";

const SAMPLE_META: MosaicMediaMetadata = {
  kind: "video",
  width: 1280,
  height: 720,
  hasVideo: true,
  hasAudio: true,
  durationMs: 1000,
  fps: 24,
  originalFileName: "sample.mp4",
};

const OTHER_META: MosaicMediaMetadata = {
  kind: "video",
  width: 1920,
  height: 1080,
  hasVideo: true,
  hasAudio: true,
  durationMs: 500,
  fps: 30,
  originalFileName: "other.mp4",
};

describe("FrameStripper template", () => {
  describe("metadata", () => {
    it("has the expected id, label, version, and tags", () => {
      expect(FrameStripper.id).toBe("@m0saic/media/video_to_png_sequence/v1");
      expect(FrameStripper.label).toBe("Frame Stripper");
      expect(FrameStripper.version).toBe(1);
      expect(FrameStripper.tags).toEqual(
        expect.arrayContaining(["media", "frames", "png-sequence", "extract"]),
      );
    });

    it("advertises image/png output via outputHints", () => {
      expect(FrameStripper.outputHints?.format).toEqual({
        kind: "image",
        container: "png",
      });
    });

    it("declares a single required sourceIds (Source(s)), clip range, and maxFrames props", () => {
      const schema = FrameStripper.propsSchema as Record<string, { type?: string; required?: boolean; meta?: { control?: { picker?: string; videoFromProp?: string } } }>;
      // `sourceId` was folded into the unified `sourceIds` field.
      expect(schema.sourceId).toBeUndefined();
      expect(schema.sourceIds?.type).toBe("media[]");
      expect(schema.sourceIds?.required).toBe(true);
      expect(schema.clipStartMs?.type).toBe("number");
      expect(schema.clipEndMs?.type).toBe("number");
      expect(schema.maxFrames?.type).toBe("number");
    });

    it("wires the clip-range props through the Make-page time-range picker", () => {
      // The picker reads the video off `sourceIds` (first input) so the
      // section editor surfaces in the right input.
      const schema = FrameStripper.propsSchema as Record<string, { meta?: { control?: { picker?: string; videoFromProp?: string } } }>;
      expect(schema.clipStartMs?.meta?.control?.picker).toBe("time-range");
      expect(schema.clipStartMs?.meta?.control?.videoFromProp).toBe("sourceIds");
      expect(schema.clipEndMs?.meta?.control?.picker).toBe("time-range");
      expect(schema.clipEndMs?.meta?.control?.videoFromProp).toBe("sourceIds");
    });
  });

  describe("render — fail-fast", () => {
    it("returns an error mosaic_document when no source is provided", async () => {
      const file = await FrameStripper.render({}, makeCtx());
      expect(file.kind).toBe("mosaic_document");
    });
  });

  describe("render — single input", () => {
    it("emits a mosaic_pipeline with emit:multi", async () => {
      const ctx = makeCtx({
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      const pipe = asPipeline(
        await FrameStripper.render({ sourceIds: [SAMPLE_PATH] }, ctx),
      );
      expect(pipe.emit).toBe("multi");
      expect(pipe.version).toBe(1);
      expect(pipe.steps.length).toBeGreaterThan(0);
    });

    it("emits one step per source frame at the resolved fps", async () => {
      const ctx = makeCtx({
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      // Force ctx.target fps/durationMs to undefined so the template falls
      // through to meta. 1000ms @ 24fps → 24 frames.
      ctx.target = { width: 1920, height: 1080 } as MosaicEngineContext["target"];
      const pipe = asPipeline(
        await FrameStripper.render({ sourceIds: [SAMPLE_PATH] }, ctx),
      );
      expect(pipe.steps.length).toBe(24);
    });

    it("uses the input's natural fps + duration (meta wins over ctx.target)", async () => {
      // ctx.target carries the editor-canvas fps/duration, which is short
      // by default. A frame-stripper must cover the WHOLE input, so the
      // probed meta (24fps, 1000ms) wins over ctx.target (30fps, 2000ms)
      // → 24 frames, not 60.
      const ctx = makeCtx({
        fps: 30,
        durationMs: 2000,
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      const pipe = asPipeline(
        await FrameStripper.render({ sourceIds: [SAMPLE_PATH] }, ctx),
      );
      expect(pipe.steps.length).toBe(24);
    });

    it("does not truncate a long input to a short ctx.target duration", async () => {
      // Regression for the "only the first ~5s" bug: a 60s input under a
      // 5s default canvas must still strip all 60s of frames.
      const LONG_META: MosaicMediaMetadata = {
        ...SAMPLE_META,
        durationMs: 60_000,
        fps: 30,
      };
      const ctx = makeCtx({
        fps: 30,
        durationMs: 5000, // short editor-canvas default
        media: { [asAssetId(SAMPLE_PATH)]: LONG_META },
      });
      const pipe = asPipeline(
        await FrameStripper.render({ sourceIds: [SAMPLE_PATH] }, ctx),
      );
      expect(pipe.steps.length).toBe(1800); // 60s @ 30fps, not 150 (5s)
    });

    it("each step is a mosaic_document with image/png format and one media source", async () => {
      const ctx = makeCtx({
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      const pipe = asPipeline(
        await FrameStripper.render({ sourceIds: [SAMPLE_PATH] }, ctx),
      );
      expect(pipe.steps.length).toBe(24); // meta: 1000ms @ 24fps
      for (const step of pipe.steps) {
        const doc = (step as { file: MosaicDocument }).file;
        expect(doc.kind).toBe("mosaic_document");
        expect(doc.format).toEqual({ kind: "image", container: "png" });
        const sources = (doc.sources ?? []) as MosaicMediaSource[];
        expect(sources).toHaveLength(1);
        expect(sources[0].type).toBe("media");
        expect(sources[0].mediaType).toBe("video");
        expect(sources[0].audio).toEqual({ enabled: false });
      }
    });

    it("seeks each step to its frame timestamp via clipStartMs", async () => {
      const ctx = makeCtx({
        fps: 24,
        durationMs: 1000,
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      const pipe = asPipeline(
        await FrameStripper.render({ sourceIds: [SAMPLE_PATH] }, ctx),
      );
      const frameMs = 1000 / 24;
      for (let i = 0; i < pipe.steps.length; i++) {
        const doc = (pipe.steps[i] as { file: MosaicDocument }).file;
        const src = (doc.sources?.[0] ?? {}) as MosaicMediaSource;
        expect(src.playback?.clipStartMs).toBe(Math.round(i * frameMs));
        expect(src.playback?.loopMode).toBe("freeze");
      }
    });

    it("step names carry the input slug and zero-pad the frame index", async () => {
      const ctx = makeCtx({
        fps: 30,
        durationMs: 400,
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      const pipe = asPipeline(
        await FrameStripper.render({ sourceIds: [SAMPLE_PATH] }, ctx),
      );
      // All step names share the same slug prefix and end with _frame_<NNNN>.
      for (const step of pipe.steps) {
        expect(step.name).toMatch(/^[a-zA-Z0-9_-]+_frame_\d{4}$/);
      }
      const names = pipe.steps.map((s) => s.name ?? "");
      expect(names).toEqual([...names].sort());
    });

    it("uses native dims for each step's canvas when meta has them", async () => {
      const ctx = makeCtx({
        fps: 30,
        durationMs: 100,
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      const pipe = asPipeline(
        await FrameStripper.render({ sourceIds: [SAMPLE_PATH] }, ctx),
      );
      for (const step of pipe.steps) {
        const doc = (step as { file: MosaicDocument }).file;
        expect(doc.size).toEqual({ width: 1280, height: 720 });
      }
    });

    it("respects clipStartMs + clipEndMs (frames within the section only)", async () => {
      // meta: 24fps, 1000ms total. Section [400, 1000) = 600ms →
      // round(600 / (1000/24)) = round(14.4) = 14 frames.
      const ctx = makeCtx({
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      const pipe = asPipeline(
        await FrameStripper.render(
          { sourceIds: [SAMPLE_PATH], clipStartMs: 400, clipEndMs: 1000 },
          ctx,
        ),
      );
      expect(pipe.steps.length).toBe(14);
      // First step seeks to clipStartMs (400), not 0.
      const first = (pipe.steps[0] as { file: MosaicDocument }).file;
      expect((first.sources?.[0] as MosaicMediaSource).playback?.clipStartMs).toBe(400);
      // Subsequent steps offset by frame duration from the section start.
      const second = (pipe.steps[1] as { file: MosaicDocument }).file;
      expect((second.sources?.[0] as MosaicMediaSource).playback?.clipStartMs).toBe(
        400 + Math.round(1000 / 24),
      );
    });

    it("clamps clipStart / clipEnd to the input's natural duration", async () => {
      // meta: 24fps, 1000ms total. clipEndMs=5000 is past the end → clamps to 1000.
      const ctx = makeCtx({
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      const pipe = asPipeline(
        await FrameStripper.render(
          { sourceIds: [SAMPLE_PATH], clipStartMs: 0, clipEndMs: 5000 },
          ctx,
        ),
      );
      expect(pipe.steps.length).toBe(24); // entire 1000ms @ 24fps
    });

    it("rejects clipEndMs <= clipStartMs with an error mosaic", async () => {
      const ctx = makeCtx({
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      const file = await FrameStripper.render(
        { sourceIds: [SAMPLE_PATH], clipStartMs: 500, clipEndMs: 500 },
        ctx,
      );
      expect(file.kind).toBe("mosaic_document"); // error mosaic, not pipeline
    });

    it("caps the step count at maxFrames when set", async () => {
      const ctx = makeCtx({
        fps: 30,
        durationMs: 2000,
        media: { [asAssetId(SAMPLE_PATH)]: SAMPLE_META },
      });
      const pipe = asPipeline(
        await FrameStripper.render(
          { sourceIds: [SAMPLE_PATH], maxFrames: 10 },
          ctx,
        ),
      );
      expect(pipe.steps.length).toBe(10);
    });
  });

  describe("render — multi input", () => {
    it("emits steps for every frame of every input", async () => {
      // sample: 24 frames; other: 30fps × 500ms = 15 frames → 39 total
      // (ctx.target is unset for fps/durationMs so each input falls to meta)
      const ctx = makeCtx({
        media: {
          [asAssetId(SAMPLE_PATH)]: SAMPLE_META,
          [asAssetId(OTHER_PATH)]: OTHER_META,
        },
      });
      ctx.target = { width: 1920, height: 1080 } as MosaicEngineContext["target"];

      const pipe = asPipeline(
        await FrameStripper.render(
          { sourceIds: [SAMPLE_PATH, OTHER_PATH] },
          ctx,
        ),
      );
      expect(pipe.steps.length).toBe(24 + 15);
    });

    it("prefixes step names by input slug so files from different videos don't collide", async () => {
      const ctx = makeCtx({
        fps: 10,
        durationMs: 100,
        media: {
          [asAssetId(SAMPLE_PATH)]: SAMPLE_META,
          [asAssetId(OTHER_PATH)]: OTHER_META,
        },
      });
      const pipe = asPipeline(
        await FrameStripper.render(
          { sourceIds: [SAMPLE_PATH, OTHER_PATH] },
          ctx,
        ),
      );
      const names = pipe.steps.map((s) => s.name ?? "");
      // Every name is unique (engine rejects duplicates).
      expect(new Set(names).size).toBe(names.length);
      // Names from the two inputs use different slug prefixes.
      expect(names.some((n) => n.includes("sample"))).toBe(true);
      expect(names.some((n) => n.includes("other"))).toBe(true);
    });

    it("dedupes step-name prefixes when inputs share a basename", async () => {
      const PATH_A = "/dir-a/clip.mp4";
      const PATH_B = "/dir-b/clip.mp4";
      const ctx = makeCtx({
        media: {
          [asAssetId(PATH_A)]: SAMPLE_META, // each: 24fps × 1000ms = 24 frames
          [asAssetId(PATH_B)]: SAMPLE_META,
        },
      });
      const pipe = asPipeline(
        await FrameStripper.render({ sourceIds: [PATH_A, PATH_B] }, ctx),
      );
      const names = pipe.steps.map((s) => s.name ?? "");
      expect(new Set(names).size).toBe(names.length);
      // The second occurrence carries a numeric suffix on the slug.
      expect(names.some((n) => /clip(\.mp4)?_2_frame_/.test(n))).toBe(true);
    });

    it("uses each input's own native canvas + fps", async () => {
      const ctx = makeCtx({
        media: {
          [asAssetId(SAMPLE_PATH)]: SAMPLE_META,
          [asAssetId(OTHER_PATH)]: OTHER_META,
        },
      });
      ctx.target = { width: 1920, height: 1080 } as MosaicEngineContext["target"];

      const pipe = asPipeline(
        await FrameStripper.render(
          { sourceIds: [SAMPLE_PATH, OTHER_PATH] },
          ctx,
        ),
      );
      // First 24 steps come from SAMPLE_META (24fps, 1280×720).
      const fromSample = (pipe.steps[0] as { file: MosaicDocument }).file;
      expect(fromSample.size).toEqual({ width: 1280, height: 720 });
      expect(fromSample.fps).toBe(24);
      // The first step from the other input (index 24) is OTHER_META.
      const fromOther = (pipe.steps[24] as { file: MosaicDocument }).file;
      expect(fromOther.size).toEqual({ width: 1920, height: 1080 });
      expect(fromOther.fps).toBe(30);
    });

    it("maxFrames is applied per input, not globally", async () => {
      const ctx = makeCtx({
        media: {
          [asAssetId(SAMPLE_PATH)]: SAMPLE_META,
          [asAssetId(OTHER_PATH)]: OTHER_META,
        },
      });
      ctx.target = { width: 1920, height: 1080 } as MosaicEngineContext["target"];

      const pipe = asPipeline(
        await FrameStripper.render(
          { sourceIds: [SAMPLE_PATH, OTHER_PATH], maxFrames: 5 },
          ctx,
        ),
      );
      // 5 from sample + 5 from other = 10 total.
      expect(pipe.steps.length).toBe(10);
    });

  });
});
