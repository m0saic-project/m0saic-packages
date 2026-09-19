import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { BrandQr } from "./qr";

const QR_TEMPLATE_ID = "@m0saic/media/qr/basic/v1";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & { workspaceDir?: string },
): MosaicEngineContext & { cache?: any } {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("qr-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 2000,
      ...overrides,
    },
    output: {
      width: 1080,
      height: 1080,
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

function asLavfiSource(src: MosaicSource): MosaicLavfiSource {
  expect(src.type).toBe("lavfi");
  return src as MosaicLavfiSource;
}

describe("BrandQr", () => {
  const D = BrandQr.defaultProps!;

  describe("template metadata", () => {
    it("has expected id, label, version", () => {
      expect(BrandQr.id).toBe(QR_TEMPLATE_ID);
      expect(BrandQr.label).toBe("Brand QR (v1, deprecated)");
      expect(BrandQr.version).toBe(1);
    });

    it("has outputHints with rgba pixel format for alpha support", () => {
      expect(BrandQr.outputHints?.width).toBe(1080);
      expect(BrandQr.outputHints?.height).toBe(1080);
      expect(BrandQr.outputHints?.fps).toBe(30);
      expect(BrandQr.outputHints?.durationMs).toBe(2000);
      expect(BrandQr.outputHints?.format).toEqual({
        kind: "image",
        container: "png",
        pixelFormat: "rgba",
      });
    });

    it("has propsSchema and defaultProps", () => {
      expect(BrandQr.propsSchema).toBeDefined();
      expect(D.text).toBe("https://www.m0saic.io");
      expect(D.mode).toBe("dark");
    });

    it("has tags", () => {
      expect(BrandQr.tags).toContain("brand");
      expect(BrandQr.tags).toContain("qr");
    });
  });

  describe("render — in-house qrToM0 (no PNG raster)", () => {
    it("omitted text uses default and produces a colour-tile mosaic", async () => {
      const doc = asDocument(
        await BrandQr.render({ mode: "light" }, makeCtx()),
      );
      expect(isErrorDocument(doc)).toBe(false);
      expect((doc.sources ?? []).length).toBeGreaterThan(1);
    });

    it("emits one brand-orange lavfi source per dark module — no file assets", async () => {
      const doc = asDocument(
        await BrandQr.render({ text: "https://example.com" }, makeCtx()),
      );
      expect(isErrorDocument(doc)).toBe(false);
      const sources = doc.sources ?? [];
      // QR modules in the 30-100 range; far more than the old single PNG source.
      expect(sources.length).toBeGreaterThan(30);
      for (const s of sources) {
        const tile = asLavfiSource(s);
        expect(tile.color).toBe("#f97316");
      }
      // No file assets — the entire QR lives inside the m0 + lavfi sources.
      expect(Object.keys(doc.assets ?? {})).toEqual([]);
    });

    it("m0 is the QR module grid (not a single tile)", async () => {
      const doc = asDocument(
        await BrandQr.render({ text: "https://test.com" }, makeCtx()),
      );
      // qrToM0 emits `N[N(...), ...]` — a nested grid, never the legacy "1".
      expect(typeof doc.m0).toBe("string");
      expect(String(doc.m0)).not.toBe("1");
      expect(String(doc.m0)).toMatch(/^\d+\[\d+\(/);
    });

    it("uses ctx.target.durationMs for config.durationMs (stamped by defineMosaicTemplate)", async () => {
      const ctx = makeCtx({ durationMs: 5000 });
      const doc = asDocument(
        await BrandQr.render({ text: "https://test.com" }, ctx),
      );
      expect(doc.durationMs).toBe(5000);
    });

    it("mode=light sets a white backgroundColor", async () => {
      const doc = asDocument(
        await BrandQr.render(
          { text: "https://x.co", mode: "light", transparentBackground: false },
          makeCtx(),
        ),
      );
      expect(doc.backgroundColor).toBe("#ffffff@1.0");
    });

    it("mode=dark sets a black backgroundColor", async () => {
      const doc = asDocument(
        await BrandQr.render(
          { text: "https://x.co", mode: "dark", transparentBackground: false },
          makeCtx(),
        ),
      );
      expect(doc.backgroundColor).toBe("#000000@1.0");
    });

    it("transparentBackground omits the backgroundColor so alpha survives", async () => {
      const doc = asDocument(
        await BrandQr.render(
          { text: "https://x.co", mode: "light", transparentBackground: true },
          makeCtx(),
        ),
      );
      expect(doc.backgroundColor).toBeUndefined();
    });
  });
});
