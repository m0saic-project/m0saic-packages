import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaSource,
  MosaicTextSource,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { finalizeRenderable } from "./finalizeRenderable";

function createMockContext(): MosaicEngineContext & { cache?: any } { return { mode: "render" as const,
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 5000,
      workspaceDir: "/tmp/m0saic-test",
    },
    target: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 5000,
    },
    media: {},
    cache: ({
      get: jest.fn(),
      set: jest.fn(),
      getOrCompute: jest.fn(),
    } as any),
  };
}

function createTextSource(overrides?: Partial<MosaicTextSource>): MosaicTextSource {
  return {
    type: "text",
    layers: [
      {
        content: { kind: "literal", text: "test" },
      },
    ],
    ...overrides,
  };
}

function createMediaSource(overrides?: Partial<MosaicMediaSource>): MosaicMediaSource {
  return {
    type: "media",
    mediaType: "video",
    assetId: "test_mp4" as any,
    ...overrides,
  };
}

function createDocument(overrides?: Partial<MosaicDocument>): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String("F", "test"),
    assets: {} as any,
    sources: [] as any,
    ...overrides,
  };
}

function createPipeline(overrides?: Partial<MosaicDocumentPipeline>): MosaicDocumentPipeline {
  return {
    kind: "mosaic_pipeline",
    version: 1,
    fps: 30 ,
    defaultTransition: { type: "cut" },
    steps: [],
    ...overrides,
  };
}

describe("finalizeRenderable", () => {
  describe("MosaicDocument", () => {
    test("applies default editor owner when not provided", () => {
      const ctx = createMockContext();
      const doc = createDocument();

      const result = finalizeRenderable(doc, ctx, {
        defaultRenderableOwner: "template",
      }) as MosaicDocument;

      expect(result.editor?.owner).toBe("template");
    });

    test("preserves explicit editor owner over default", () => {
      const ctx = createMockContext();
      const doc = createDocument({
        editor: { owner: "user" },
      });

      const result = finalizeRenderable(doc, ctx, {
        defaultRenderableOwner: "template",
      }) as MosaicDocument;

      expect(result.editor?.owner).toBe("user");
    });

    test("applies default engine status when not provided", () => {
      const ctx = createMockContext();
      const doc = createDocument();

      const result = finalizeRenderable(doc, ctx) as MosaicDocument;

      expect(result.engine?.renderStatus).toBe("ok");
    });

    test("preserves explicit engine status over default", () => {
      const ctx = createMockContext();
      const doc = createDocument({
        engine: { renderStatus: "error", renderError: { message: "test" } },
      });

      const result = finalizeRenderable(doc, ctx) as MosaicDocument;

      expect(result.engine?.renderStatus).toBe("error");
      expect(result.engine?.renderError?.message).toBe("test");
    });

    test("applies default source owner to all sources", () => {
      const ctx = createMockContext();
      const doc = createDocument({
        sources: [
            createTextSource(),
            createMediaSource(),
          ] as any,
      });

      const result = finalizeRenderable(doc, ctx, {
        defaultSourceOwner: "user",
      }) as MosaicDocument;

      expect((result.sources ?? [])).toHaveLength(2);
      expect((result.sources ?? [])[0].editor?.owner).toBe("user");
      expect((result.sources ?? [])[1].editor?.owner).toBe("user");
    });

    test("preserves explicit source owner over default", () => {
      const ctx = createMockContext();
      const doc = createDocument({
        sources: [
            createTextSource({ editor: { owner: "template" } }),
            createMediaSource(),
          ] as any,
      });

      const result = finalizeRenderable(doc, ctx, {
        defaultSourceOwner: "user",
      }) as MosaicDocument;

      expect((result.sources ?? [])[0].editor?.owner).toBe("template");
      expect((result.sources ?? [])[1].editor?.owner).toBe("user");
    });

    test("applies engine status to all sources", () => {
      const ctx = createMockContext();
      const doc = createDocument({
        sources: [
            createTextSource(),
            createMediaSource(),
          ] as any,
      });

      const result = finalizeRenderable(doc, ctx) as MosaicDocument;

      expect((result.sources ?? [])[0].engine?.renderStatus).toBe("ok");
      expect((result.sources ?? [])[1].engine?.renderStatus).toBe("ok");
    });

    test("preserves existing source engine status", () => {
      const ctx = createMockContext();
      const doc = createDocument({
        sources: [
            createTextSource({
              engine: { renderStatus: "error", renderError: { message: "source error" } },
            }),
          ] as any,
      });

      const result = finalizeRenderable(doc, ctx) as MosaicDocument;

      expect((result.sources ?? [])[0].engine?.renderStatus).toBe("error");
      expect((result.sources ?? [])[0].engine?.renderError?.message).toBe("source error");
    });

    test("handles empty sources array", () => {
      const ctx = createMockContext();
      const doc = createDocument({
        sources: [] as any,
      });

      const result = finalizeRenderable(doc, ctx) as MosaicDocument;

      expect((result.sources ?? [])).toHaveLength(0);
      expect(result.editor?.owner).toBeUndefined();
      expect(result.engine?.renderStatus).toBe("ok");
    });

    test("handles missing sources array", () => {
      const ctx = createMockContext();
      const doc = createDocument({
        sources: undefined as any as any,
      });

      const result = finalizeRenderable(doc, ctx) as MosaicDocument;

      expect((result.sources ?? [])).toHaveLength(0);
    });

    test("recursively finalizes nested children", () => {
      const ctx = createMockContext();
      const childDoc = createDocument();
      const doc = createDocument({
        children: {
          child1: childDoc,
        },
      });

      const result = finalizeRenderable(doc, ctx, {
        defaultRenderableOwner: "template",
        defaultSourceOwner: "user",
      }) as MosaicDocument;

      expect(result.children?.child1).toBeDefined();
      const finalizedChild = result.children!.child1 as MosaicDocument;
      expect(finalizedChild.editor?.owner).toBe("template");
      expect(finalizedChild.engine?.renderStatus).toBe("ok");
    });

    test("preserves all other document properties", () => {
      const ctx = createMockContext();
      const doc = createDocument({
        m0: toM0String("2(F,F)", "test"),
        sources: [] as any, fps: 60 as any, durationMs: 3000 as any ,
      });

      const result = finalizeRenderable(doc, ctx) as MosaicDocument;

      expect(result.m0).toBe("2(1,1)"); // "F" canonicalizes to "1"
      expect(result.version).toBe(1);
      // durationMs / fps live flat on the doc post-flatten.
      expect(result.durationMs).toBe(3000);
      expect(result.fps).toBe(60);
    });
  });

  describe("MosaicDocumentPipeline", () => {
    test("applies default editor owner when not provided", () => {
      const ctx = createMockContext();
      const pipeline = createPipeline();

      const result = finalizeRenderable(pipeline, ctx, {
        defaultRenderableOwner: "template",
      }) as MosaicDocumentPipeline;

      expect(result.editor?.owner).toBe("template");
    });

    test("preserves explicit editor owner over default", () => {
      const ctx = createMockContext();
      const pipeline = createPipeline({
        editor: { owner: "user" },
      });

      const result = finalizeRenderable(pipeline, ctx, {
        defaultRenderableOwner: "template",
      }) as MosaicDocumentPipeline;

      expect(result.editor?.owner).toBe("user");
    });

    test("applies default engine status when not provided", () => {
      const ctx = createMockContext();
      const pipeline = createPipeline();

      const result = finalizeRenderable(pipeline, ctx) as MosaicDocumentPipeline;

      expect(result.engine?.renderStatus).toBe("ok");
    });

    test("recursively finalizes step files", () => {
      const ctx = createMockContext();
      const stepDoc = createDocument();
      const pipeline = createPipeline({
        steps: [
          {
            durationMs: 1000,
            file: stepDoc,
          },
        ],
      });

      const result = finalizeRenderable(pipeline, ctx, {
        defaultRenderableOwner: "template",
        defaultSourceOwner: "user",
      }) as MosaicDocumentPipeline;

      expect(result.steps).toHaveLength(1);
      const finalizedStep = result.steps[0].file as MosaicDocument;
      expect(finalizedStep.editor?.owner).toBe("template");
      expect(finalizedStep.engine?.renderStatus).toBe("ok");
    });

    test("handles steps with ref instead of file", () => {
      const ctx = createMockContext();
      const pipeline = createPipeline({
        steps: [
          {
            ref: "step1",
            durationMs: 1000,
          },
        ],
      });

      const result = finalizeRenderable(pipeline, ctx) as MosaicDocumentPipeline;

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]).toHaveProperty("ref", "step1");
      expect(result.steps[0]).not.toHaveProperty("file");
    });

    test("handles steps with undefined file", () => {
      const ctx = createMockContext();
      const pipeline = createPipeline({
        steps: [
          {
            durationMs: 1000,
            file: undefined as any,
          },
        ],
      });

      const result = finalizeRenderable(pipeline, ctx) as MosaicDocumentPipeline;

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].file).toBeUndefined();
    });

    test("preserves all other pipeline properties", () => {
      const ctx = createMockContext();
      const pipeline = createPipeline({
        fps: 60 ,
        defaultTransition: { type: "fade", durationMs: 500 },
      });

      const result = finalizeRenderable(pipeline, ctx) as MosaicDocumentPipeline;

      expect(result.fps).toBe(60);
      expect(result.defaultTransition).toEqual({ type: "fade", durationMs: 500 });
      expect(result.version).toBe(1);
    });

    test("handles nested pipelines in steps", () => {
      const ctx = createMockContext();
      const nestedDoc = createDocument();
      const pipeline = createPipeline({
        steps: [
          {
            durationMs: 1000,
            file: nestedDoc,
          },
        ],
      });

      const result = finalizeRenderable(pipeline, ctx, {
        defaultRenderableOwner: "template",
      }) as MosaicDocumentPipeline;

      expect(result.steps).toHaveLength(1);
      const finalizedNested = result.steps[0].file as MosaicDocument;
      expect(finalizedNested.editor?.owner).toBe("template");
      expect(finalizedNested.engine?.renderStatus).toBe("ok");
    });
  });

  describe("edge cases", () => {
    test("handles empty options object", () => {
      const ctx = createMockContext();
      const doc = createDocument();

      const result = finalizeRenderable(doc, ctx, {}) as MosaicDocument;

      expect(result.editor?.owner).toBeUndefined();
      expect(result.engine?.renderStatus).toBe("ok");
    });

    test("handles undefined options", () => {
      const ctx = createMockContext();
      const doc = createDocument();

      const result = finalizeRenderable(doc, ctx) as MosaicDocument;

      expect(result.editor?.owner).toBeUndefined();
      expect(result.engine?.renderStatus).toBe("ok");
    });

    test("handles document with both sources and children", () => {
      const ctx = createMockContext();
      const childDoc = createDocument();
      const doc = createDocument({
        sources: [createTextSource()] as any,
        children: {
          child1: childDoc,
        },
      });

      const result = finalizeRenderable(doc, ctx, {
        defaultRenderableOwner: "template",
        defaultSourceOwner: "user",
      }) as MosaicDocument;

      expect((result.sources ?? [])[0].editor?.owner).toBe("user");
      expect((result.sources ?? [])[0].engine?.renderStatus).toBe("ok");
      expect((result.children!.child1 as MosaicDocument).editor?.owner).toBe("template");
    });
  });
});
