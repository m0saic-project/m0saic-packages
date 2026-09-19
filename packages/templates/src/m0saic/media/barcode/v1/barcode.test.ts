import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTextSource,
} from "@m0saic/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { Barcode } from "./barcode";

const TEMPLATE_ID = "@m0saic/media/barcode/v1";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & { workspaceDir?: string },
): MosaicEngineContext & { cache?: any } {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("barcode-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1080,
      height: 420,
      fps: 30,
      durationMs: 2000,
      ...overrides,
    },
    output: {
      width: 1080,
      height: 420,
      fps: 30,
      durationMs: 2000,
      workspaceDir: ws,
      ...overrides,
    },
    media: {},
    cache: {
      get: () => undefined,
      set: () => {},
      getOrCompute: async (_k: string, fn: () => any) => fn(),
    } as any,
  };
}

function asDocument(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

function isErrorDocument(doc: MosaicDocument): boolean {
  return (
    (doc.sources ?? []).length === 1 &&
    "engine" in (doc.sources ?? [])[0] &&
    ((doc.sources ?? [])[0] as { engine?: { renderStatus?: string } }).engine
      ?.renderStatus === "error"
  );
}

function isLavfi(src: MosaicSource): src is MosaicLavfiSource {
  return src.type === "lavfi";
}

function isText(src: MosaicSource): src is MosaicTextSource {
  return src.type === "text";
}

describe("Barcode", () => {
  const D = Barcode.defaultProps!;

  describe("template metadata", () => {
    it("has expected id, label, version", () => {
      expect(Barcode.id).toBe(TEMPLATE_ID);
      expect(Barcode.label).toBe("Barcode");
      expect(Barcode.version).toBe(1);
    });

    it("has outputHints with rgba pixel format for alpha support", () => {
      expect(Barcode.outputHints?.fps).toBe(30);
      expect(Barcode.outputHints?.durationMs).toBe(2000);
      expect(Barcode.outputHints?.format).toEqual({
        kind: "image",
        container: "png",
        pixelFormat: "rgba",
      });
    });

    it("has propsSchema and defaults", () => {
      expect(Barcode.propsSchema).toBeDefined();
      expect(D.text).toBe("M0SAIC");
      expect(D.format).toBe("code128");
      expect(D.mode).toBe("light");
      expect(D.showHumanReadable).toBe(true);
    });

    it("has tags", () => {
      expect(Barcode.tags).toContain("media");
      expect(Barcode.tags).toContain("barcode");
    });
  });

  describe("render — Code 128 default", () => {
    it("omitted text uses default and produces a non-empty source array", async () => {
      const doc = asDocument(await Barcode.render({}, makeCtx()));
      expect(isErrorDocument(doc)).toBe(false);
      expect((doc.sources ?? []).length).toBeGreaterThan(1);
    });

    it("every bar source is a brand-orange lavfi tile; HRI source is a text source", async () => {
      const doc = asDocument(
        await Barcode.render({ text: "HELLO" }, makeCtx()),
      );
      expect(isErrorDocument(doc)).toBe(false);
      const sources = doc.sources ?? [];
      // showHumanReadable defaults to true → exactly 1 text source (Code 128
      // single HRI frame), the rest are lavfi bars.
      const textSources = sources.filter(isText);
      const lavfiSources = sources.filter(isLavfi);
      expect(textSources).toHaveLength(1);
      expect(lavfiSources.length).toBeGreaterThan(10);
      // sources[0] is the background base tile (solid modes paint the quiet
      // zone as a real source — template_invocation flattening drops
      // doc.backgroundColor, candidate 2026-08-06); every OTHER lavfi tile is
      // a brand-orange bar.
      expect(lavfiSources[0].color).toBe("#ffffff@1.0");
      for (const tile of lavfiSources.slice(1)) {
        expect(tile.color).toBe("#f97316");
      }
      // The text source carries the payload.
      expect(textSources[0].layers?.[0]?.content).toMatchObject({
        kind: "literal",
        text: "HELLO",
      });
    });

    it("HRI text source carries a monospace fontFamily stack", async () => {
      const doc = asDocument(
        await Barcode.render({ text: "HELLO" }, makeCtx()),
      );
      const text = (doc.sources ?? []).find(isText)!;
      const family = (text as MosaicTextSource).layers?.[0]?.style?.fontFamily;
      expect(family).toBeDefined();
      // First entry is OCR-B (the printed-barcode convention); stack falls
      // back to widely-available monospaces.
      expect(family).toMatch(/^OCR-B/);
      expect(family).toMatch(/monospace$/);
    });

    it("m0 is the bar grid (not a single tile)", async () => {
      const doc = asDocument(
        await Barcode.render({ text: "HELLO" }, makeCtx()),
      );
      expect(typeof doc.m0).toBe("string");
      expect(String(doc.m0)).not.toBe("1");
    });

    it("document size matches the renderable's natural canvas dims", async () => {
      const doc = asDocument(
        await Barcode.render({ text: "HELLO" }, makeCtx()),
      );
      expect(doc.size?.width).toBeGreaterThan(0);
      expect(doc.size?.height).toBeGreaterThan(0);
      // Aspect should be wider than tall for a 1D barcode.
      expect(doc.size!.width).toBeGreaterThan(doc.size!.height);
    });
  });

  describe("render — backgrounds", () => {
    it("mode=light sets a white backgroundColor with opaque-alpha suffix", async () => {
      const doc = asDocument(
        await Barcode.render(
          { mode: "light", transparentBackground: false },
          makeCtx(),
        ),
      );
      // `@1.0` suffix is intentional — keeps the bg opaque on the rgba
      // output format. See barcode.ts BG_LIGHT comment for the engine
      // branch that defaults alpha-output backgrounds to fully transparent.
      expect(doc.backgroundColor).toBe("#ffffff@1.0");
    });

    it("mode=dark sets a black backgroundColor with opaque-alpha suffix", async () => {
      const doc = asDocument(
        await Barcode.render(
          { mode: "dark", transparentBackground: false },
          makeCtx(),
        ),
      );
      expect(doc.backgroundColor).toBe("#000000@1.0");
    });

    it("transparentBackground omits the backgroundColor so alpha survives", async () => {
      const doc = asDocument(
        await Barcode.render(
          { mode: "light", transparentBackground: true },
          makeCtx(),
        ),
      );
      expect(doc.backgroundColor).toBeUndefined();
    });

    it("HRI text source backgroundColor tracks the document background", async () => {
      const light = asDocument(
        await Barcode.render({ mode: "light", transparentBackground: false }, makeCtx()),
      );
      const dark = asDocument(
        await Barcode.render({ mode: "dark", transparentBackground: false }, makeCtx()),
      );
      const trans = asDocument(
        await Barcode.render({ mode: "light", transparentBackground: true }, makeCtx()),
      );
      const lightText = (light.sources ?? []).find(isText)!;
      const darkText = (dark.sources ?? []).find(isText)!;
      const transText = (trans.sources ?? []).find(isText)!;
      expect((lightText as MosaicTextSource).visual?.backgroundColor).toBe("#ffffff@1.0");
      expect((darkText as MosaicTextSource).visual?.backgroundColor).toBe("#000000@1.0");
      expect((transText as MosaicTextSource).visual?.backgroundColor).toBeUndefined();
    });
  });

  describe("render — showHumanReadable toggle", () => {
    it("showHumanReadable: false produces bars only (no text sources)", async () => {
      const doc = asDocument(
        await Barcode.render({ showHumanReadable: false }, makeCtx()),
      );
      const sources = doc.sources ?? [];
      const textSources = sources.filter(isText);
      expect(textSources).toHaveLength(0);
    });

    it("showHumanReadable: true (default) adds exactly one Code 128 HRI text source", async () => {
      const off = asDocument(
        await Barcode.render({ showHumanReadable: false }, makeCtx()),
      );
      const on = asDocument(
        await Barcode.render({ showHumanReadable: true }, makeCtx()),
      );
      expect((on.sources ?? []).length).toBe((off.sources ?? []).length + 1);
    });
  });

  describe("render — format dispatch", () => {
    it("EAN-13 with default HRI produces 3 text sources (leading + left + right)", async () => {
      const doc = asDocument(
        await Barcode.render(
          { format: "ean13", text: "5901234123457" },
          makeCtx(),
        ),
      );
      expect(isErrorDocument(doc)).toBe(false);
      const textSources = (doc.sources ?? []).filter(isText);
      expect(textSources).toHaveLength(3);
      // HRI text matches EAN-13 1-6-6 grouping.
      expect(textSources[0].layers?.[0]?.content).toMatchObject({ text: "5" });
      expect(textSources[1].layers?.[0]?.content).toMatchObject({ text: "901234" });
      expect(textSources[2].layers?.[0]?.content).toMatchObject({ text: "123457" });
    });

    it("UPC-A with default HRI produces 4 text sources (1-5-5-1)", async () => {
      const doc = asDocument(
        await Barcode.render(
          { format: "upca", text: "036000291452" },
          makeCtx(),
        ),
      );
      expect(isErrorDocument(doc)).toBe(false);
      const textSources = (doc.sources ?? []).filter(isText);
      expect(textSources).toHaveLength(4);
      expect(textSources[0].layers?.[0]?.content).toMatchObject({ text: "0" });
      expect(textSources[1].layers?.[0]?.content).toMatchObject({ text: "36000" });
      expect(textSources[2].layers?.[0]?.content).toMatchObject({ text: "29145" });
      expect(textSources[3].layers?.[0]?.content).toMatchObject({ text: "2" });
    });
  });

  describe("render — error handling", () => {
    it("EAN-13 with wrong check digit produces an error mosaic", async () => {
      const doc = asDocument(
        await Barcode.render(
          { format: "ean13", text: "5901234123450" },
          makeCtx(),
        ),
      );
      expect(isErrorDocument(doc)).toBe(true);
    });

    it("UPC-A with non-digit input produces an error mosaic", async () => {
      const doc = asDocument(
        await Barcode.render(
          { format: "upca", text: "ABCDEFGHIJK" },
          makeCtx(),
        ),
      );
      expect(isErrorDocument(doc)).toBe(true);
    });
  });
});
