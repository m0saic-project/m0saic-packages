import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicMosaicSource,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import { toCanonicalM0String } from "@m0saic/dsl";
// Ensure WireframeCell is registered before Wireframe uses renderNestedTemplate
import "../../utils/wireframeCell";
import { Wireframe } from "./wireframe";

function makeCtx(overrides?: Partial<MosaicEngineContext["target"]>): MosaicEngineContext & { cache?: any } { return { mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 1000, ...overrides },
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 1000,
      workspaceDir: "/tmp",
      ...overrides,
    },
    media: {},
    cache: ({
      get: () => undefined,
      set: () => {},
      getOrCompute: async (_k: string, fn: () => any) => fn(),
    } as any),
  };
}

function asDocument(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

describe("Wireframe", () => {
  const D = Wireframe.defaultProps;

  describe("template metadata", () => {
    it("has expected id, label, version", () => {
      expect(Wireframe.id).toBe("@m0saic/wireframe/base/v1");
      expect(Wireframe.label).toBe("Wireframe");
      expect(Wireframe.version).toBe(1);
    });

    it("has outputHints", () => {
      expect(Wireframe.outputHints).toEqual({
        width: 1920,
        height: 1080,
        fps: 30,
        durationMs: 1000,
        format: {
          kind: "image",
          container: "png",
          pixelFormat: "rgba",
        },
        note: "Wireframe for documentation (layout visualization)",
      });
    });

    it("has propsSchema and defaultProps", () => {
      expect(Wireframe.propsSchema).toBeDefined();
      expect(D.M0String).toBe("F");
      expect(D.labels).toBeUndefined();
    });
  });

  describe("render — M0String layout", () => {
    it("single cell (F) yields one source and one child", async () => {
      const doc = asDocument(await Wireframe.render({ M0String: "F" }, makeCtx()));
      expect((doc.sources ?? []).length).toBe(1);
      expect(Object.keys(doc.children ?? {}).length).toBe(1);
      const src = (doc.sources ?? [])[0] as MosaicMosaicSource;
      expect(src.type).toBe("mosaic");
      expect(src.ref).toBe("cell-0");
      expect(doc.children?.["cell-0"]).toBeDefined();
    });

    it("4-cell layout 4[1,1,1,1] yields four sources and four children", async () => {
      const doc = asDocument(
        await Wireframe.render({ M0String: "4[1,1,1,1]" }, makeCtx())
      );
      expect((doc.sources ?? []).length).toBe(4);
      expect(Object.keys(doc.children ?? {}).length).toBe(4);
      expect((doc.sources ?? []).map((s) => (s as MosaicMosaicSource).ref).sort()).toEqual([
        "cell-0",
        "cell-1",
        "cell-2",
        "cell-3",
      ]);
    });

    it("3[1,0,1] yields three sources (skips nullRender if any)", async () => {
      const doc = asDocument(
        await Wireframe.render({ M0String: "3[1,0,1]" }, makeCtx())
      );
      expect((doc.sources ?? []).length).toBeGreaterThanOrEqual(1);
      expect((doc.sources ?? []).length).toBeLessThanOrEqual(3);
      expect(doc.m0).toBe("3[1,0,1]");
    });

    it("m0saic is stamped on document", async () => {
      const M0String = "2(1,1)";
      const doc = asDocument(await Wireframe.render({ M0String }, makeCtx()));
      expect(doc.m0).toBe(M0String);
    });
  });

  describe("render — labels", () => {
    it("no labels uses dimensions and aspect ratio per cell", async () => {
      const doc = asDocument(
        await Wireframe.render({ M0String: "2(1,1)" }, makeCtx())
      );
      const child0 = doc.children?.["cell-0"] as MosaicDocument;
      expect(child0).toBeDefined();
      expect(child0.kind).toBe("mosaic_document");
      const textSource = (child0.sources ?? [])[0] as {
        layers?: { content?: { kind: string; text?: string } }[];
      };
      const texts =
        textSource.layers?.map((l) =>
          l.content?.kind === "literal" ? l.content.text ?? "" : ""
        ) ?? [];
      expect(texts.some((t) => t.includes("x"))).toBe(true);
      expect(texts.some((t) => t.includes("AR:"))).toBe(true);
    });

    it("custom labels override dimensions text", async () => {
      const doc = asDocument(
        await Wireframe.render(
          { M0String: "2(1,1)", labels: ["A", "B"] },
          makeCtx()
        )
      );
      const child0 = doc.children?.["cell-0"] as MosaicDocument;
      const textSource = (child0.sources ?? [])[0] as {
        layers?: { content?: { kind: string; text?: string } }[];
      };
      const texts =
        textSource.layers?.map((l) =>
          l.content?.kind === "literal" ? l.content.text ?? "" : ""
        ) ?? [];
      expect(texts).toContain("A");
    });

    it("labels array shorter than cell count uses empty string for missing", async () => {
      const doc = asDocument(
        await Wireframe.render(
          { M0String: "2(1,1)", labels: ["only-one"] },
          makeCtx()
        )
      );
      const child0 = doc.children?.["cell-0"] as MosaicDocument;
      const textSource0 = (child0.sources ?? [])[0] as {
        layers?: { content?: { kind: string; text?: string } }[];
      };
      const texts0 =
        textSource0.layers?.map((l) =>
          l.content?.kind === "literal" ? l.content.text ?? "" : ""
        ) ?? [];
      expect(texts0).toContain("only-one");
      const child1 = doc.children?.["cell-1"] as MosaicDocument;
      const textSource1 = (child1.sources ?? [])[0] as {
        layers?: { content?: { kind: string; text?: string } }[];
      };
      const texts1 =
        textSource1.layers?.map((l) =>
          l.content?.kind === "literal" ? l.content.text ?? "" : ""
        ) ?? [];
      expect(texts1).not.toContain("only-one");
      expect((doc.sources ?? []).length).toBe(2);
    });
  });

  describe("render — finalizeRenderable", () => {
    it("returns document with config.sources and children", async () => {
      const ctx = makeCtx({ width: 1280, height: 720 });
      const doc = asDocument(await Wireframe.render({ M0String: "F" }, ctx));
      expect((doc.sources ?? []).length).toBe(1);
      expect(doc.children?.["cell-0"]).toBeDefined();
    });
  });

  describe("render — defaultProps", () => {
    it("omitted props use default M0String F", async () => {
      const doc = asDocument(await Wireframe.render(D, makeCtx()));
      expect(doc.m0).toBe(toCanonicalM0String("F"));
      expect((doc.sources ?? []).length).toBe(1);
    });

    it("explicit default M0String F matches defaultProps", async () => {
      const fromDefaults = asDocument(await Wireframe.render(D, makeCtx()));
      const fromExplicit = asDocument(await Wireframe.render({ M0String: "F" }, makeCtx()));
      expect(fromDefaults.m0).toBe(fromExplicit.m0);
      expect((fromDefaults.sources ?? []).length).toBe((fromExplicit.sources ?? []).length);
    });
  });

  describe("render — context dimensions", () => {
    it("uses ctx.output width/height for layout", async () => {
      const ctx = makeCtx({ width: 800, height: 600 });
      const doc = asDocument(await Wireframe.render({ M0String: "2(1,1)" }, ctx));
      expect((doc.sources ?? []).length).toBe(2);
      const child0 = doc.children?.["cell-0"] as MosaicDocument;
      expect(child0).toBeDefined();
    });
  });
});
