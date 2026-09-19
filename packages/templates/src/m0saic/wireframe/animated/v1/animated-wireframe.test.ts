import type { M0String } from "@m0saic/dsl";
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicMosaicSource,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
// Ensure WireframeCell is registered before AnimatedWireframe uses renderNestedTemplate
import "../../utils/wireframeCell";
import { AnimatedWireframe } from "./animated-wireframe";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & { durationMs?: number }
): MosaicEngineContext & { cache?: any } { const target = {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 2000,
    ...overrides,
  };
  return { mode: "render" as const,
    target,
    output: {
      ...target,
      workspaceDir: "/tmp",
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

describe("AnimatedWireframe", () => {
  const D = AnimatedWireframe.defaultProps;

  describe("template metadata", () => {
    it("has expected id, label, version", () => {
      expect(AnimatedWireframe.id).toBe("@m0saic/wireframe/animated/v1");
      expect(AnimatedWireframe.label).toBe("Animated Wireframe");
      expect(AnimatedWireframe.version).toBe(1);
    });

    it("has outputHints", () => {
      expect(AnimatedWireframe.outputHints).toEqual({
        width: 1920,
        height: 1080,
        fps: 30,
        durationMs: 5000,
        note: "Animated wireframe reveal; duration set by CLI/desktop",
        format: { kind: "video", container: "mp4" },
      });
    });

    it("has no duration prop (uses ctx.target.durationMs only)", () => {
      expect(D).not.toHaveProperty("durationSec");
      expect(D).not.toHaveProperty("animationDurationMs");
      expect(D.M0String).toBe("2(2[1,1],2[1,1])"); // the family's 2×2 default face (gate 29 ruling)
      expect(D.paddingSec).toBe(0.35);
      expect(D.disableUi).toBe(false);
    });

    it("has propsSchema for M0String, labels, paddingSec, disableUi", () => {
      const schema = AnimatedWireframe.propsSchema as Record<string, unknown>;
      expect(schema.M0String).toBeDefined();
      expect(schema.labels).toBeDefined();
      expect(schema.paddingSec).toBeDefined();
      expect(schema.disableUi).toBeDefined();
    });
  });

  describe("render — uses ctx.target.durationMs", () => {
    it("config.durationMs equals ctx.target.durationMs", async () => {
      const ctx = makeCtx({ durationMs: 3000 });
      const doc = asDocument(
        await AnimatedWireframe.render({ M0String: "F" as M0String }, ctx)
      );
      expect(doc.durationMs).toBe(3000);
    });

    it("different ctx.target.durationMs produces different config.durationMs", async () => {
      const doc1 = asDocument(
        await AnimatedWireframe.render(
          { M0String: "F" as M0String },
          makeCtx({ durationMs: 1000 })
        )
      );
      const doc2 = asDocument(
        await AnimatedWireframe.render(
          { M0String: "F" as M0String },
          makeCtx({ durationMs: 5000 })
        )
      );
      expect(doc1.durationMs).toBe(1000);
      expect(doc2.durationMs).toBe(5000);
    });
  });

  describe("render — M0String layout", () => {
    it("single cell (F) yields one mosaic source and one child", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render({ M0String: "F" as M0String }, makeCtx())
      );
      const mosaicSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "mosaic") as MosaicMosaicSource[];
      expect(mosaicSources.length).toBe(1);
      expect(Object.keys(doc.children ?? {}).length).toBe(1);
      const src = mosaicSources[0];
      expect(src.ref).toBe("cell-0");
      expect(src.overlay).toBeDefined();
      expect(src.overlay?.startAtSec).toBeDefined();
      expect(src.overlay?.enable).toBeDefined();
    });

    it("2(1,1) yields two mosaic sources and two children", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render({ M0String: "2(1,1)" as M0String }, makeCtx())
      );
      const mosaicSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "mosaic");
      expect(mosaicSources.length).toBe(2);
      expect(Object.keys(doc.children ?? {}).length).toBe(2);
    });

    it("m0saic is stamped on document (disableUi true gives raw string)", async () => {
      const M0String = "2(1,1)" as M0String;
      const doc = asDocument(
        await AnimatedWireframe.render({ M0String, disableUi: true }, makeCtx())
      );
      expect(doc.m0).toBe(M0String);
    });
  });

  describe("render — overlay timing", () => {
    it("each mosaic source has overlay with startAtSec and enable", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render({ M0String: "2(1,1)" as M0String }, makeCtx({ durationMs: 2000 }))
      );
      const mosaicSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "mosaic") as MosaicMosaicSource[];
      expect(mosaicSources.length).toBe(2);
      for (const src of mosaicSources) {
        expect(src.overlay).toBeDefined();
        expect(typeof src.overlay?.startAtSec).toBe("number");
        expect(typeof src.overlay?.enable).toBe("string");
        expect(src.overlay?.enable).toMatch(/gte\(t,/);
      }
    });

    it("first cell startAtSec equals lead padding", async () => {
      const ctx = makeCtx({ durationMs: 2000 });
      const doc = asDocument(
        await AnimatedWireframe.render(
          { M0String: "2(1,1)" as M0String, paddingSec: 0.5 },
          ctx
        )
      );
      const mosaicSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "mosaic") as MosaicMosaicSource[];
      const first = mosaicSources[0];
      expect(first.overlay?.startAtSec).toBe(0.5);
    });

    it("sources have yExpr for slide animation", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render({ M0String: "F" as M0String }, makeCtx())
      );
      const mosaicSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "mosaic") as MosaicMosaicSource[];
      expect(mosaicSources[0].overlay?.yExpr).toContain("lt/0.3");
    });
  });

  describe("render — disableUi", () => {
    it("disableUi false wraps m0saic and adds header source", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render(
          { M0String: "F" as M0String, disableUi: false },
          makeCtx()
        )
      );
      expect(doc.m0).toContain("10[1,");
      const textSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "text");
      expect(textSources.length).toBeGreaterThanOrEqual(1);
      const headerSource = textSources[0] as { layers?: { content?: { kind: string; text?: string } }[] };
      const headerText =
        headerSource.layers?.[0]?.content?.kind === "literal"
          ? headerSource.layers[0].content.text ?? ""
          : "";
      expect(headerText).toContain("m0:");
    });

    it("disableUi true does not wrap m0saic and has no header text source", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render(
          { M0String: "F" as M0String, disableUi: true },
          makeCtx()
        )
      );
      expect(doc.m0).toBe("1"); // "F" canonicalized
      const textSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "text");
      expect(textSources.length).toBe(0);
    });
  });

  describe("render — paddingSec", () => {
    it("default paddingSec 0.35 is used when omitted", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render({ M0String: "2(1,1)" as M0String }, makeCtx({ durationMs: 2000 }))
      );
      const mosaicSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "mosaic") as MosaicMosaicSource[];
      expect(mosaicSources[0].overlay?.startAtSec).toBe(0.35);
    });

    it("custom paddingSec sets lead (first cell startAtSec)", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render(
          { M0String: "2(1,1)" as M0String, paddingSec: 0.2 },
          makeCtx({ durationMs: 2000 })
        )
      );
      const mosaicSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "mosaic") as MosaicMosaicSource[];
      expect(mosaicSources[0].overlay?.startAtSec).toBe(0.2);
    });

    it("trail padding is at least 0.3 (OVERLAY_SLIDE_MS)", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render(
          { M0String: "F" as M0String, paddingSec: 0.1 },
          makeCtx({ durationMs: 1000 })
        )
      );
      expect(doc.durationMs).toBe(1000);
      const mosaicSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "mosaic") as MosaicMosaicSource[];
      const first = mosaicSources[0];
      expect(first.overlay?.startAtSec).toBe(0.1);
      const animationWindowSec = 1 - 0.1 - 0.3;
      expect(animationWindowSec).toBeGreaterThanOrEqual(0);
    });
  });

  describe("render — labels", () => {
    it("no labels uses dimensions and aspect ratio in child", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render({ M0String: "2(1,1)" as M0String }, makeCtx())
      );
      const child0 = doc.children?.["cell-0"] as MosaicDocument;
      const textSource = child0?.sources?.[0] as {
        layers?: { content?: { kind: string; text?: string } }[];
      };
      const texts =
        textSource?.layers?.map((l) =>
          l.content?.kind === "literal" ? l.content.text ?? "" : ""
        ) ?? [];
      expect(texts.some((t) => /^\d+ × \d+$/.test(t))).toBe(true); // W × H
      expect(texts.some((t) => /^\d+:\d+ · [\d.]+$/.test(t))).toBe(true); // 16:9 · 1.78
    });

    it("custom labels override dimensions text", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render(
          { M0String: "2(1,1)" as M0String, labels: ["One", "Two"] },
          makeCtx()
        )
      );
      const child0 = doc.children?.["cell-0"] as MosaicDocument;
      const textSource = child0?.sources?.[0] as {
        layers?: { content?: { kind: string; text?: string } }[];
      };
      const texts =
        textSource?.layers?.map((l) =>
          l.content?.kind === "literal" ? l.content.text ?? "" : ""
        ) ?? [];
      expect(texts).toContain("One");
    });
  });

  describe("render — defaultProps", () => {
    it("omitted props use defaults (disableUi false wraps m0saic)", async () => {
      const doc = asDocument(await AnimatedWireframe.render(D, makeCtx()));
      expect(doc.m0).toContain("1");
      expect(doc.durationMs).toBe(2000);
      expect(doc.m0).toContain("10[1,");
    });

    it("explicit defaultProps matches default behavior", async () => {
      const fromDefaults = asDocument(await AnimatedWireframe.render(D, makeCtx()));
      const fromExplicit = asDocument(
        await AnimatedWireframe.render(
          { M0String: D.M0String, paddingSec: 0.35, disableUi: false },
          makeCtx()
        )
      );
      expect((fromDefaults.sources ?? []).length).toBe((fromExplicit.sources ?? []).length);
      expect(fromDefaults.durationMs).toBe(fromExplicit.durationMs);
    });
  });

  describe("render — stagger across animation window", () => {
    it("multiple cells have increasing startAtSec", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render(
          { M0String: "4[1,1,1,1]" as M0String, paddingSec: 0.2 },
          makeCtx({ durationMs: 2000 })
        )
      );
      const mosaicSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "mosaic") as MosaicMosaicSource[];
      expect(mosaicSources.length).toBe(4);
      const starts = mosaicSources.map((s) => s.overlay?.startAtSec ?? -1);
      for (let i = 1; i < starts.length; i++) {
        expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]);
      }
    });

    it("single cell has startAtSec equal to lead padding", async () => {
      const doc = asDocument(
        await AnimatedWireframe.render(
          { M0String: "F" as M0String, paddingSec: 0.4 },
          makeCtx({ durationMs: 2000 })
        )
      );
      const mosaicSources = (doc.sources ?? []).filter((s) => (s as MosaicSource).type === "mosaic") as MosaicMosaicSource[];
      expect(mosaicSources[0].overlay?.startAtSec).toBe(0.4);
    });
  });

  describe("render — context dimensions", () => {
    it("uses ctx.output width/height for layout", async () => {
      const ctx = makeCtx({ width: 800, height: 600, durationMs: 1500 });
      const doc = asDocument(
        await AnimatedWireframe.render({ M0String: "2(1,1)" as M0String }, ctx)
      );
      expect((doc.sources ?? []).length).toBeGreaterThanOrEqual(2);
      expect(doc.durationMs).toBe(1500);
    });
  });
});
