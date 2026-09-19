import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicTextSource,
} from "@m0saic/types";
import { toCanonicalM0String } from "@m0saic/dsl";
import { WireframeCell } from "./wireframeCell";

function makeCtx(overrides?: Partial<MosaicEngineContext["target"]>): MosaicEngineContext & { cache?: any } { return { mode: "render" as const,
    target: { width: 640, height: 480, fps: 30, durationMs: 1000, ...overrides },
    output: {
      width: 640,
      height: 480,
      fps: 30,
      durationMs: 1000,
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

function getCellSource(doc: MosaicDocument): MosaicTextSource {
  expect((doc.sources ?? []).length).toBe(1);
  const src = (doc.sources ?? [])[0];
  expect(src.type).toBe("text");
  return src as MosaicTextSource;
}

function getLayerText(layer: { content?: { kind: string; text?: string } }): string {
  return layer.content?.kind === "literal" ? layer.content.text ?? "" : "";
}

describe("WireframeCell", () => {
  const D = WireframeCell.defaultProps;

  describe("template metadata", () => {
    it("has expected id, label, version", () => {
      expect(WireframeCell.id).toBe("@m0saic/wireframe/cell/v1");
      expect(WireframeCell.label).toBe("Wireframe Cell");
      expect(WireframeCell.version).toBe(1);
    });

    it("is internal and has outputHints", () => {
      expect(WireframeCell.internal).toBe(true);
      expect(WireframeCell.outputHints).toEqual({
        width: 640,
        height: 480,
        fps: 30,
        durationMs: 1000,
        note: "Single wireframe cell for documentation",
      });
    });

    it("has propsSchema for all schema props", () => {
      expect(WireframeCell.propsSchema).toBeDefined();
      const schema = WireframeCell.propsSchema as Record<string, unknown>;
      expect(schema.orderString).toBeDefined();
      expect(schema.showOrderString).toBeDefined();
      expect(schema.text).toBeDefined();
      expect(schema.textSize).toBeDefined();
    });

    it("has defaultProps with expected defaults", () => {
      expect(D.orderString).toBe("1");
      expect(D.showOrderString).toBe(true);
      expect(D.text).toBe("");
      expect(D.textSize).toBe(64);
      expect(D.baseFrameStyle).toBeDefined();
      expect(D.textStyle).toBeDefined();
    });
  });

  describe("render — document shape", () => {
    it("returns a mosaic_document with single text source", async () => {
      const doc = asDocument(await WireframeCell.render(D, makeCtx()));
      expect(doc.kind).toBe("mosaic_document");
      expect(doc.version).toBe(1);
      expect(doc.m0).toBe(toCanonicalM0String("F"));
      expect((doc.sources ?? []).length).toBe(1);
      const src = getCellSource(doc);
      expect(src.type).toBe("text");
      expect(src.visual?.backgroundColor).toBe("#ffffff");
      expect(src.layers).toBeDefined();
    });

    it("returns document with config.sources and single text source", async () => {
      const ctx = makeCtx({ width: 1920, height: 1080 });
      const doc = asDocument(await WireframeCell.render(D, ctx));
      expect((doc.sources ?? []).length).toBe(1);
      expect((doc.sources ?? [])[0].type).toBe("text");
    });
  });

  describe("render — orderString and showOrderString", () => {
    it("default props include order label in layers", async () => {
      const doc = asDocument(await WireframeCell.render(D, makeCtx()));
      const src = getCellSource(doc);
      const orderLayer = src.layers?.find((l) => getLayerText(l) === "1");
      expect(orderLayer).toBeDefined();
      expect(orderLayer?.placement?.hAlign).toBe("left");
      expect(orderLayer?.placement?.vAlign).toBe("top");
    });

    it("custom orderString appears in layers", async () => {
      const doc = asDocument(
        await WireframeCell.render({ ...D, orderString: "A1" }, makeCtx())
      );
      const src = getCellSource(doc);
      const orderLayer = src.layers?.find((l) => getLayerText(l) === "A1");
      expect(orderLayer).toBeDefined();
    });

    it("showOrderString false omits order label from layers", async () => {
      const doc = asDocument(
        await WireframeCell.render({ ...D, showOrderString: false }, makeCtx())
      );
      const src = getCellSource(doc);
      const orderLayer = src.layers?.find((l) => getLayerText(l) === D.orderString);
      expect(orderLayer).toBeUndefined();
    });

    it("showOrderString true (explicit) includes order label", async () => {
      const doc = asDocument(
        await WireframeCell.render({ ...D, showOrderString: true }, makeCtx())
      );
      const src = getCellSource(doc);
      expect(src.layers?.some((l) => getLayerText(l) === "1")).toBe(true);
    });
  });

  describe("render — text (geometry overlay)", () => {
    it("empty text yields no geometry layers", async () => {
      const doc = asDocument(await WireframeCell.render({ ...D, text: "" }, makeCtx()));
      const src = getCellSource(doc);
      const textLayers =
        src.layers?.filter((l) => getLayerText(l) !== D.orderString) ?? [];
      expect(textLayers.length).toBe(0);
    });

    it("single-line text adds one geometry layer", async () => {
      const doc = asDocument(
        await WireframeCell.render({ ...D, text: "100x100" }, makeCtx())
      );
      const src = getCellSource(doc);
      const geomLayer = src.layers?.find((l) => getLayerText(l) === "100x100");
      expect(geomLayer).toBeDefined();
      expect(geomLayer?.placement?.yExpr).toBeDefined();
    });

    it("multi-line text adds one layer per line", async () => {
      const doc = asDocument(
        await WireframeCell.render(
          { ...D, text: "1920x1080\nAR: 1.78" },
          makeCtx()
        )
      );
      const src = getCellSource(doc);
      const lines = ["1920x1080", "AR: 1.78"];
      for (const line of lines) {
        expect(src.layers?.some((l) => getLayerText(l) === line)).toBe(true);
      }
    });

    it("trimmed text ignores surrounding whitespace", async () => {
      const doc = asDocument(
        await WireframeCell.render({ ...D, text: "  foo  " }, makeCtx())
      );
      const src = getCellSource(doc);
      expect(src.layers?.some((l) => getLayerText(l) === "foo")).toBe(true);
    });
  });

  describe("render — textSize", () => {
    it("default textSize 64 is scaled by INDEX_FONT_SCALE", async () => {
      const doc = asDocument(await WireframeCell.render(D, makeCtx()));
      const src = getCellSource(doc);
      const orderLayer = src.layers?.find((l) => getLayerText(l) === "1");
      // round(64 * 0.9) = 58, clamped to [10, 120]
      expect(orderLayer?.style?.fontSize).toBe(58);
    });

    it("custom textSize scales base and overlay font", async () => {
      const doc = asDocument(
        await WireframeCell.render({ ...D, textSize: 48 }, makeCtx())
      );
      const src = getCellSource(doc);
      const orderLayer = src.layers?.find((l) => getLayerText(l) === "1");
      // round(48 * 0.9) = 43
      expect(orderLayer?.style?.fontSize).toBe(43);
    });

    it("textSize at schema min (8) is clamped to INDEX_FONT_MIN", async () => {
      const doc = asDocument(
        await WireframeCell.render({ ...D, textSize: 8 }, makeCtx())
      );
      const src = getCellSource(doc);
      const orderLayer = src.layers?.find((l) => getLayerText(l) === "1");
      // round(8 * 0.9) = 7, clamped to min 10
      expect(orderLayer?.style?.fontSize).toBe(10);
    });

    it("textSize at schema max (200) is clamped to INDEX_FONT_MAX", async () => {
      const doc = asDocument(
        await WireframeCell.render({ ...D, textSize: 200 }, makeCtx())
      );
      const src = getCellSource(doc);
      const orderLayer = src.layers?.find((l) => getLayerText(l) === "1");
      // round(200 * 0.9) = 180, clamped to max 120
      expect(orderLayer?.style?.fontSize).toBe(120);
    });
  });

  describe("render — baseFrameStyle and textStyle", () => {
    it("baseFrameStyle overrides default base style (textSize set so fontSize is not overwritten)", async () => {
      const doc = asDocument(
        await WireframeCell.render(
          {
            ...D,
            textSize: 32,
            baseFrameStyle: {
              fontSize: 32,
              fontColor: "#ff0000",
              fontFamily: "Arial",
              borderWidth: 0.01,
              borderColor: "#00ff00",
            },
          },
          makeCtx()
        )
      );
      const src = getCellSource(doc);
      const orderLayer = src.layers?.find((l) => getLayerText(l) === "1");
      // round(32 * 0.9) = 29, clamped to [10, 120]
      expect(orderLayer?.style?.fontSize).toBe(29);
      expect(orderLayer?.style?.fontColor).toBe("#ff0000");
    });

    it("textStyle overrides default overlay text style (fontColor)", async () => {
      const doc = asDocument(
        await WireframeCell.render(
          { ...D, text: "dim", textStyle: { fontSize: 24, fontColor: "#0000ff" } },
          makeCtx()
        )
      );
      const src = getCellSource(doc);
      const geomLayer = src.layers?.find((l) => getLayerText(l) === "dim");
      expect(geomLayer?.style?.fontColor).toBe("#0000ff");
      expect(geomLayer?.style?.fontSize).toBeDefined();
    });
  });

  describe("render — combinations", () => {
    it("orderString + text + textSize + showOrderString true", async () => {
      const doc = asDocument(
        await WireframeCell.render(
          {
            orderString: "3",
            showOrderString: true,
            text: "640x480\nAR: 1.33",
            textSize: 32,
          },
          makeCtx()
        )
      );
      const src = getCellSource(doc);
      expect(src.layers?.find((l) => getLayerText(l) === "3")).toBeDefined();
      expect(src.layers?.find((l) => getLayerText(l) === "640x480")).toBeDefined();
      expect(src.layers?.find((l) => getLayerText(l) === "AR: 1.33")).toBeDefined();
    });

    it("minimal props (only required orderString) uses defaults", async () => {
      const doc = asDocument(
        await WireframeCell.render({ orderString: "1" }, makeCtx())
      );
      expect((doc.sources ?? []).length).toBe(1);
      const src = getCellSource(doc);
      expect(src.layers?.some((l) => getLayerText(l) === "1")).toBe(true);
    });
  });
});
