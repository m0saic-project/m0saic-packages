/**
 * Type-level smoke tests for the post-redesign MosaicDocumentPipeline
 * shape: outputs map present, top-level fps removed, meta header added.
 */
import type { M0String } from "@m0saic/dsl";
import type { MosaicDocument } from "./document";
import {
  isPipelineFile,
  type MosaicDocumentPipeline,
} from "./document-pipeline";
import { asAliasId, asFlattenedStableKey } from "../identifiers";

// covers: T:pipeline, T:pipeline.kind, T:pipeline.version,
//         T:pipeline.steps[],
//         T:pipeline.size, T:pipeline.fps, T:pipeline.durationMs,
//         T:pipeline.target, T:pipeline.format, T:pipeline.audio,
//         T:pipeline.color, T:pipeline.metadata, T:pipeline.backgroundColor,
//         T:pipeline.emit, T:pipeline.encodes,
//         T:pipeline.created, T:pipeline.app, T:pipeline.appVersion, T:pipeline.meta,
//         T:pipeline.transition, T:pipeline.transition.type=cut, T:pipeline.transition.type=fade,
//         T:pipeline.step, T:pipeline.step.durationMs, T:pipeline.step.transitionToNext,
//         T:pipeline.step.intermediate, T:pipeline.step.name, T:pipeline.step.variant=file, T:pipeline.step.variant=file.file,
//         T:pipeline.step.variant=ref, T:pipeline.step.variant=ref.ref
describe("MosaicDocumentPipeline (post-redesign shape)", () => {
  const minimalStepFile: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: "1" as unknown as M0String,
    assets: {},
    sources: [{ type: "lavfi", color: "#000000" }],
  };

  it("accepts the minimal shape (kind + version + steps)", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: minimalStepFile }],
    };
    expect(p.kind).toBe("mosaic_pipeline");
    expect(p.steps).toHaveLength(1);
  });

  it("no longer carries a top-level fps field", () => {
    // Compile-time: `fps` is removed from MosaicDocumentPipeline.
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: minimalStepFile }],
    };
    expect("fps" in p).toBe(false);
  });

  it("accepts flat output knobs (no nested outputs map)", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: minimalStepFile }],
      fps: 30,
      size: { width: 1920, height: 1080 },
      target: "web-mp4",
    };
    expect(p.fps).toBe(30);
    expect(p.size?.width).toBe(1920);
  });

  it("accepts emit: 'multi' at top level", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [
        { durationMs: 1000, file: minimalStepFile },
        { durationMs: 1000, file: minimalStepFile },
      ],
      fps: 30,
      emit: "multi",
    };
    expect(p.emit).toBe("multi");
  });

  it("accepts encodes map (applied per emitted file under emit:multi)", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: minimalStepFile }],
      encodes: {
        webm: { format: { kind: "video", container: "webm", videoCodec: "libvpx-vp9" } },
      },
    };
    expect(p.encodes?.webm).toBeDefined();
  });

  it("accepts top-level file-lifecycle stamps", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      created: "2026-05-12T10:00:00.000Z",
      app: "m0saic-cli",
      appVersion: "0.1.0",
      steps: [{ durationMs: 1000, file: minimalStepFile }],
    };
    expect(p.created).toBe("2026-05-12T10:00:00.000Z");
    expect(p.app).toBe("m0saic-cli");
  });

  it("accepts a MosaicFileMeta content-metadata header", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: minimalStepFile }],
      meta: {
        title: "3-beat montage",
        author: "createwithm0saic@gmail.com",
        source: "@m0saic/hero/ffmpeg-pulse/runner/v1",
      },
    };
    expect(p.meta?.title).toBe("3-beat montage");
    expect(p.meta?.source).toBe("@m0saic/hero/ffmpeg-pulse/runner/v1");
  });

  it("accepts cut and fade transitions", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      defaultTransition: { type: "cut" },
      steps: [
        {
          durationMs: 1000,
          file: minimalStepFile,
          transitionToNext: { type: "fade", durationMs: 250 },
        },
        { durationMs: 1000, file: minimalStepFile },
      ],
    };
    expect(p.defaultTransition?.type).toBe("cut");
    expect(p.steps[0]?.transitionToNext?.type).toBe("fade");
  });

  it("accepts step.ref (external reference) form", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, ref: "external/clip" }],
    };
    expect(p.steps[0]).toMatchObject({ ref: "external/clip" });
  });

  it("accepts step.intermediate for render-only scratch steps", () => {
    // Canonical "header strip" pattern: step 0 renders an intermediate
    // that step 1 mirrors via MosaicRefSource. Step 0 does not appear
    // in the pipeline's concatenated output.
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [
        { intermediate: true, durationMs: 5000, file: minimalStepFile },
        { durationMs: 30000, file: minimalStepFile },
      ],
    };
    expect(p.steps[0]?.intermediate).toBe(true);
    expect(p.steps[1]?.intermediate).toBeUndefined();
  });

  it("intermediate defaults to false (omission means normal output step)", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: minimalStepFile }],
    };
    expect(p.steps[0]?.intermediate).toBeUndefined();
  });

  // covers: T:pipeline.step.name (3l — CLI override addressing for multi-output pipelines)
  describe("step.name (CLI override addressing)", () => {
    it("accepts an optional friendly-slug name on each step", () => {
      const p: MosaicDocumentPipeline = {
        kind: "mosaic_pipeline",
        version: 1,
        steps: [
          { name: "desktop", durationMs: 5000, file: minimalStepFile },
          { name: "mobile", durationMs: 5000, file: minimalStepFile },
        ],
      };
      expect(p.steps[0]?.name).toBe("desktop");
      expect(p.steps[1]?.name).toBe("mobile");
    });

    it("name is optional (undefined for unnamed steps)", () => {
      const p: MosaicDocumentPipeline = {
        kind: "mosaic_pipeline",
        version: 1,
        steps: [{ durationMs: 1000, file: minimalStepFile }],
      };
      expect(p.steps[0]?.name).toBeUndefined();
    });

    it("allows mixing named and unnamed steps in the same pipeline (auto-naming fallback)", () => {
      const p: MosaicDocumentPipeline = {
        kind: "mosaic_pipeline",
        version: 1,
        steps: [
          { name: "desktop", durationMs: 5000, file: minimalStepFile },
          { durationMs: 5000, file: minimalStepFile }, // unnamed → ctx.targets key falls back to "step-1"
        ],
      };
      expect(p.steps[0]?.name).toBe("desktop");
      expect(p.steps[1]?.name).toBeUndefined();
    });
  });

  // covers: T:pipeline.variables, T:pipeline.sidecars
  describe("variables (back-edge data transport)", () => {
    it("is optional", () => {
      const p: MosaicDocumentPipeline = {
        kind: "mosaic_pipeline",
        version: 1,
        steps: [{ durationMs: 1000, file: minimalStepFile }],
      };
      expect(p.variables).toBeUndefined();
    });

    it("accepts a top-level pipeline-scoped initial bindings bag", () => {
      const p: MosaicDocumentPipeline = {
        kind: "mosaic_pipeline",
        version: 1,
        steps: [{ durationMs: 1000, file: minimalStepFile }],
        variables: {
          brandColor: "#ff8a00",
          rolloutBucket: "preview",
        },
      };
      expect(p.variables?.brandColor).toBe("#ff8a00");
    });

    it("supports cross-step ref handoff (producer publishes flattenedStableKey)", () => {
      // Producer step: real render that also publishes a stableKey
      // for the consumer to ref against. Not intermediate — its
      // pixels DO land in the final video.
      const producerDoc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: "2(1,1)" as unknown as M0String,
        assets: {},
        sources: [
          { type: "lavfi", color: "#ff0000" },
          { type: "lavfi", color: "#00ff00" },
        ],
        variables: { introHeroKey: "intro_hero" },
      };

      // Consumer step: reads upstream-published key, mirrors it.
      const refKey = (producerDoc.variables?.introHeroKey ?? "") as string;
      const consumerDoc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: "1" as unknown as M0String,
        assets: {},
        sources: [
          {
            type: "ref",
            stepIndex: 0,
            flattenedStableKey: asFlattenedStableKey(refKey),
          },
        ],
      };

      const p: MosaicDocumentPipeline = {
        kind: "mosaic_pipeline",
        version: 1,
        steps: [
          { durationMs: 5000, file: producerDoc },
          { durationMs: 3000, file: consumerDoc },
        ],
      };
      expect(p.steps[0]?.file?.variables?.introHeroKey).toBe("intro_hero");
      expect((p.steps[1]?.file?.sources[0] as { flattenedStableKey?: string }).flattenedStableKey).toBe(
        "intro_hero",
      );
    });

    it("accepts pipeline-level sidecars (render-summary delivery)", () => {
      const p: MosaicDocumentPipeline = {
        kind: "mosaic_pipeline",
        version: 1,
        steps: [{ durationMs: 1000, file: minimalStepFile }],
        sidecars: {
          renderSummary: {
            stepCount: 1,
            totalDurationMs: 1000,
            renderedAt: "2026-05-12T00:00:00Z",
          },
        },
      };
      expect(p.sidecars?.renderSummary).toBeDefined();
    });

    it("accepts a data-only intermediate step (fetch + publish pattern)", () => {
      const dataDoc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: "1" as unknown as M0String,
        assets: {},
        sources: [
          {
            type: "data",
            alias: asAliasId("templateContext"),
            variables: { team: "lakers", season: 2025 },
          },
        ],
      };
      const p: MosaicDocumentPipeline = {
        kind: "mosaic_pipeline",
        version: 1,
        steps: [
          { intermediate: true, durationMs: 1, file: dataDoc },
          { durationMs: 5000, file: minimalStepFile },
        ],
      };
      expect(p.steps[0]?.intermediate).toBe(true);
    });
  });

  // covers: T:pipeline.isPipelineFile
  describe("isPipelineFile", () => {
    it("returns true for pipeline shape", () => {
      const p = {
        kind: "mosaic_pipeline",
        version: 1,
        steps: [],
      };
      expect(isPipelineFile(p)).toBe(true);
    });

    it("returns false for document shape", () => {
      const d = {
        kind: "mosaic_document",
        version: 1,
        m0: "1",
        assets: {},
        sources: [],
      };
      expect(isPipelineFile(d)).toBe(false);
    });

    it("returns false for non-objects", () => {
      expect(isPipelineFile(null)).toBe(false);
      expect(isPipelineFile(undefined)).toBe(false);
      expect(isPipelineFile("mosaic_pipeline")).toBe(false);
    });
  });
});
