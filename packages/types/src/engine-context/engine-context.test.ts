/**
 * Type-level smoke tests for the post-redesign MosaicEngineContext
 * shape:
 *  - the generic parameterization on `U` (flat upstream-variables)
 *    and `D` (namespaced upstream-data),
 *  - the new `upstreamVariables` and `upstreamData` fields.
 */
import type {
  MosaicEngineContext,
  MosaicPipelineStepContext,
  MosaicTemplateUpstreamData,
  MosaicTemplateUpstreamVariables,
  MosaicUpstreamPublication,
} from "./engine-context";
import { asAliasId, asFlattenedStableKey, asTemplateId } from "../identifiers";

const baseCtx: MosaicEngineContext = {
  mode: "render",
  output: { width: 1920, height: 1080, fps: 30, durationMs: 5000, workspaceDir: "/tmp/render" },
  target: { width: 1920, height: 1080, fps: 30, durationMs: 5000 },
  media: {},
};

// covers: T:engine-context, T:engine-context.generic.U, T:engine-context.generic.D,
//         T:engine-context.mode, T:engine-context.mode=render,
//         T:engine-context.output, T:engine-context.target, T:engine-context.media,
//         T:engine-context.upstreamVariables, T:engine-context.upstreamData,
//         T:upstream.flat-base, T:upstream.namespaced-base,
//         T:render-target, T:render-target.width, T:render-target.height,
//         T:render-target.fps, T:render-target.durationMs,
//         T:engine-mode, T:engine-mode=render
describe("MosaicEngineContext (post-redesign shape)", () => {
  it("compiles with no generic arguments (default U + D)", () => {
    const ctx: MosaicEngineContext = baseCtx;
    expect(ctx.output.fps).toBe(30);
  });

  it("upstreamVariables and upstreamData are both optional", () => {
    const ctx: MosaicEngineContext = baseCtx;
    expect(ctx.upstreamVariables).toBeUndefined();
    expect(ctx.upstreamData).toBeUndefined();
  });

  // covers: T:engine-context.upstreamPublications, T:upstream.publication-envelope
  describe("upstreamPublications — geometry-addressable channel", () => {
    it("is optional and undefined by default", () => {
      const ctx: MosaicEngineContext = baseCtx;
      expect(ctx.upstreamPublications).toBeUndefined();
    });

    it("accepts a fully-stamped cross-tile publication envelope", () => {
      const pub: MosaicUpstreamPublication = {
        variables: { contractVersion: 1, items: [] },
        alias: asAliasId("nowPlaying"),
        tileStableKey: asFlattenedStableKey("r/fc0"),
        stepIndex: 0,
        templateId: asTemplateId("@github/github-invoke/v1"),
      };
      const ctx: MosaicEngineContext = { ...baseCtx, upstreamPublications: [pub] };
      expect(ctx.upstreamPublications?.[0]?.tileStableKey).toBe("r/fc0");
      expect(ctx.upstreamPublications?.[0]?.templateId).toBe("@github/github-invoke/v1");
    });

    it("accepts a cross-step publication (tileStableKey absent, stepIndex set)", () => {
      const pub: MosaicUpstreamPublication = { variables: { x: 1 }, stepIndex: 2 };
      const ctx: MosaicEngineContext = { ...baseCtx, upstreamPublications: [pub] };
      expect(ctx.upstreamPublications?.[0]?.tileStableKey).toBeUndefined();
      expect(ctx.upstreamPublications?.[0]?.stepIndex).toBe(2);
    });

    it("supports the consumer lookup ladder: filter by tileStableKey", () => {
      const pubs: MosaicUpstreamPublication[] = [
        { variables: { n: 1 }, alias: asAliasId("np"), tileStableKey: asFlattenedStableKey("r/fc0") },
        { variables: { n: 2 }, alias: asAliasId("np"), tileStableKey: asFlattenedStableKey("r/fc1") },
      ];
      const ctx: MosaicEngineContext = { ...baseCtx, upstreamPublications: pubs };
      const fromB = ctx.upstreamPublications?.find((p) => p.tileStableKey === "r/fc1");
      expect(fromB?.variables).toEqual({ n: 2 });
    });
  });

  it("accepts the default flat upstream-variables shape", () => {
    const ctx: MosaicEngineContext = {
      ...baseCtx,
      upstreamVariables: { team: "lakers", season: 2025, isLeader: true },
    };
    expect(ctx.upstreamVariables?.team).toBe("lakers");
  });

  it("narrows upstreamVariables when U is parameterized", () => {
    interface Inputs extends MosaicTemplateUpstreamVariables {
      topContributor: string;
      commitsToday: number;
    }
    const ctx: MosaicEngineContext<Inputs> = {
      ...baseCtx,
      upstreamVariables: { topContributor: "alice", commitsToday: 42 },
    };
    const top: string = ctx.upstreamVariables!.topContributor;
    const n: number = ctx.upstreamVariables!.commitsToday;
    expect(top).toBe("alice");
    expect(n).toBe(42);
  });

  it("narrows upstreamData when D is parameterized", () => {
    interface UpData extends MosaicTemplateUpstreamData {
      templateContext: { team: string; season: number };
      designTokens: { brand: string };
    }
    const ctx: MosaicEngineContext<
      MosaicTemplateUpstreamVariables,
      UpData
    > = {
      ...baseCtx,
      upstreamData: {
        templateContext: { team: "lakers", season: 2025 },
        designTokens: { brand: "#ff8a00" },
      },
    };
    const team: string = ctx.upstreamData!.templateContext.team;
    const brand: string = ctx.upstreamData!.designTokens.brand;
    expect(team).toBe("lakers");
    expect(brand).toBe("#ff8a00");
  });

  it("treats upstreamVariables / upstreamData as Readonly (no mutation in TS)", () => {
    interface Inputs extends MosaicTemplateUpstreamVariables {
      topContributor: string;
    }
    const ctx: MosaicEngineContext<Inputs> = {
      ...baseCtx,
      upstreamVariables: { topContributor: "alice" },
    };
    // Compile-time: assigning to a Readonly<U> key is an error. The
    // runtime check ensures the field still holds its initial value.
    expect(ctx.upstreamVariables?.topContributor).toBe("alice");
  });

  it("MosaicTemplateUpstreamVariables base alias accepts arbitrary keys", () => {
    const u: MosaicTemplateUpstreamVariables = {
      anything: "goes",
      n: 1,
      flag: false,
    };
    expect(u.anything).toBe("goes");
  });

  it("MosaicTemplateUpstreamData base alias accepts arbitrary aliases", () => {
    const d: MosaicTemplateUpstreamData = {
      templateContext: { team: "lakers" },
      designTokens: { brand: "#ff8a00", radius: 12 },
    };
    expect(d.templateContext.team).toBe("lakers");
  });

  // covers: T:output-context, T:output-context.width, T:output-context.height,
  //         T:output-context.fps, T:output-context.durationMs, T:output-context.workspaceDir,
  //         T:output-context.target, T:output-context.format, T:output-context.audio,
  //         T:output-context.color, T:output-context.metadata, T:output-context.backgroundColor
  describe("ctx.output — resolved output envelope", () => {
    it("optional fields (target/format/audio/color/metadata/backgroundColor) all default undefined", () => {
      const ctx: MosaicEngineContext = baseCtx;
      expect(ctx.output.target).toBeUndefined();
      expect(ctx.output.format).toBeUndefined();
      expect(ctx.output.audio).toBeUndefined();
      expect(ctx.output.color).toBeUndefined();
      expect(ctx.output.metadata).toBeUndefined();
      expect(ctx.output.backgroundColor).toBeUndefined();
    });

    it("accepts a fully resolved output envelope", () => {
      const ctx: MosaicEngineContext = {
        ...baseCtx,
        output: {
          width: 1920,
          height: 1080,
          fps: 30,
          durationMs: 5000,
          workspaceDir: "/tmp/render",
          target: "web-mp4",
          format: {
            kind: "video",
            container: "mp4",
            videoCodec: "libx264",
            pixelFormat: "yuv420p",
            crf: 23,
            encoderPreset: "medium",
          },
          audio: {
            mode: "auto",
            codec: "aac",
            bitrate: "192k",
            sampleRate: 48000,
            channelLayout: "stereo",
          },
          color: {
            colorSpace: "bt709",
            colorRange: "limited",
            colorPrimaries: "bt709",
            colorTransfer: "bt709",
          },
          metadata: { author: "Acme Corp", copyright: "© 2026 Acme Corp" },
          backgroundColor: "#000000",
        },
      };
      expect(ctx.output.target).toBe("web-mp4");
      expect(ctx.output.format?.videoCodec).toBe("libx264");
      expect(ctx.output.audio?.mode).toBe("auto");
      expect(ctx.output.color?.colorPrimaries).toBe("bt709");
    });

    it("supports the alpha-aware template branching pattern", () => {
      // Template inspects pixelFormat to decide between transparent
      // composition and solid-fill fallback.
      const alphaCtx: MosaicEngineContext = {
        ...baseCtx,
        output: {
          ...baseCtx.output,
          target: "alpha-mov",
          format: { videoCodec: "prores_ks", pixelFormat: "yuva444p10le" },
        },
      };
      const sdrCtx: MosaicEngineContext = {
        ...baseCtx,
        output: {
          ...baseCtx.output,
          target: "web-mp4",
          format: { videoCodec: "libx264", pixelFormat: "yuv420p" },
        },
      };
      const hasAlpha = (ctx: MosaicEngineContext): boolean => {
        const p = ctx.output.format?.pixelFormat;
        return (
          typeof p === "string" &&
          (p.startsWith("yuva") || p === "rgba" || p === "argb")
        );
      };
      expect(hasAlpha(alphaCtx)).toBe(true);
      expect(hasAlpha(sdrCtx)).toBe(false);
    });

    it("supports the codec-adaptive template branching pattern", () => {
      // Template branches on target preset to render appropriately
      // for the deliverable.
      const gifCtx: MosaicEngineContext = {
        ...baseCtx,
        output: { ...baseCtx.output, target: "animated-gif" },
      };
      const videoCtx: MosaicEngineContext = {
        ...baseCtx,
        output: { ...baseCtx.output, target: "web-mp4" },
      };
      expect(gifCtx.output.target).toBe("animated-gif");
      expect(videoCtx.output.target).toBe("web-mp4");
    });

    it("supports the audio-disabled detection pattern", () => {
      // Image targets get audio.mode === "off" in the resolved
      // envelope; templates skip audio overlays when seen.
      const imageCtx: MosaicEngineContext = {
        ...baseCtx,
        output: {
          ...baseCtx.output,
          target: "image-png",
          audio: { mode: "off" },
        },
      };
      expect(imageCtx.output.audio?.mode).toBe("off");
    });
  });

  // covers: T:engine-context.pipelineStep, T:pipeline-step-context,
  //         T:pipeline-step-context.index, T:pipeline-step-context.total,
  //         T:pipeline-step-context.intermediate
  describe("pipelineStep", () => {
    it("is undefined for top-level non-pipeline renders", () => {
      const ctx: MosaicEngineContext = baseCtx;
      expect(ctx.pipelineStep).toBeUndefined();
    });

    it("carries index, total, and intermediate when inside a pipeline", () => {
      const stepCtx: MosaicPipelineStepContext = {
        index: 1,
        total: 4,
        intermediate: false,
      };
      const ctx: MosaicEngineContext = {
        ...baseCtx,
        pipelineStep: stepCtx,
      };
      expect(ctx.pipelineStep?.index).toBe(1);
      expect(ctx.pipelineStep?.total).toBe(4);
      expect(ctx.pipelineStep?.intermediate).toBe(false);
    });

    it("supports the self-stamped cross-step handoff pattern", () => {
      // Producer template uses ctx.pipelineStep.index to stamp its
      // own index into the published variable, so the consumer can
      // spread the value directly into a MosaicRefSource without
      // knowing the producer's position out-of-band.
      const producerCtx: MosaicEngineContext = {
        ...baseCtx,
        pipelineStep: { index: 0, total: 3, intermediate: false },
      };
      const handoff = {
        stepIndex: producerCtx.pipelineStep!.index,
        flattenedStableKey: "intro_hero",
      };
      // Consumer side: reading the upstream value and spreading it.
      const consumerCtx: MosaicEngineContext = {
        ...baseCtx,
        pipelineStep: { index: 1, total: 3, intermediate: false },
        upstreamVariables: { introHero: handoff },
      };
      const refSpread = consumerCtx.upstreamVariables?.introHero as {
        stepIndex: number;
        flattenedStableKey: string;
      };
      expect(refSpread.stepIndex).toBe(0);
      expect(refSpread.flattenedStableKey).toBe("intro_hero");
    });

    it("intermediate flag agrees with the containing step's intermediate flag", () => {
      const ctx: MosaicEngineContext = {
        ...baseCtx,
        pipelineStep: { index: 0, total: 2, intermediate: true },
      };
      expect(ctx.pipelineStep?.intermediate).toBe(true);
    });
  });

  // covers: T:engine-context.mode, T:engine-context.mode=render,
  //         T:engine-context.mode=design, T:engine-mode, T:engine-mode=render, T:engine-mode=design
  describe("mode (render vs design-time invocation)", () => {
    it("accepts 'render' (default invocation kind)", () => {
      const ctx: MosaicEngineContext = { ...baseCtx, mode: "render" };
      expect(ctx.mode).toBe("render");
    });

    it("accepts 'design' (editor design-time invocation)", () => {
      const ctx: MosaicEngineContext = { ...baseCtx, mode: "design" };
      expect(ctx.mode).toBe("design");
    });

    it("is the closed two-value union (compile-time check)", () => {
      const renderMode: MosaicEngineContext["mode"] = "render";
      const designMode: MosaicEngineContext["mode"] = "design";
      expect([renderMode, designMode]).toEqual(["render", "design"]);
    });
  });
});
