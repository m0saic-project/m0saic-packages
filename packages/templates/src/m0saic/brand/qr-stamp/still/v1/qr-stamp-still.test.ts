import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaSource,
  MosaicMosaicSource,
  MosaicLavfiSource,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { QrStampStill, resolveStillVariant } from "./qr-stamp-still";

const TEMPLATE_ID = "@m0saic/brand/qr-stamp/still/v1";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & {
    workspaceDir?: string;
  },
): MosaicEngineContext {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("qr-stamp-still-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 2000,
      ...overrides,
    },
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 2000,
      workspaceDir: ws,
      ...overrides,
    },
    media: {},
  };
}

function asDocument(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

function asMediaSource(src: MosaicSource): MosaicMediaSource {
  expect(src.type).toBe("media");
  return src as MosaicMediaSource;
}

function asMosaicSource(src: MosaicSource): MosaicMosaicSource {
  expect(src.type).toBe("mosaic");
  return src as MosaicMosaicSource;
}

const IMAGE_PATH = "/tmp/fake-base.png";

describe("resolveStillVariant", () => {
  it('returns the explicit variant when mode is "light" | "dark" | "transparent"', () => {
    expect(resolveStillVariant("light", undefined, 128)).toBe("light");
    expect(resolveStillVariant("dark", undefined, 128)).toBe("dark");
    expect(resolveStillVariant("transparent", undefined, 128)).toBe(
      "transparent",
    );
  });

  it('picks light when luma is above threshold ("auto" mode)', () => {
    expect(resolveStillVariant("auto", 200, 128)).toBe("light");
  });

  it('picks dark when luma is at or below threshold ("auto" mode)', () => {
    expect(resolveStillVariant("auto", 80, 128)).toBe("dark");
    expect(resolveStillVariant("auto", 128, 128)).toBe("dark");
  });

  it('falls back to light deterministically when "auto" is set without a luma sample', () => {
    expect(resolveStillVariant("auto", undefined, 128)).toBe("light");
  });
});

describe("QrStampStill — template metadata", () => {
  it("has the expected id, label, version", () => {
    expect(QrStampStill.id).toBe(TEMPLATE_ID);
    expect(QrStampStill.version).toBe(1);
  });

  it("declares image output kind with alpha", () => {
    expect(QrStampStill.outputHints?.format?.kind).toBe("image");
    expect(QrStampStill.outputHints?.format?.container).toBe("png");
    expect(
      (QrStampStill.outputHints?.format as { pixelFormat?: string } | undefined)
        ?.pixelFormat,
    ).toBe("rgba");
  });
});

describe("QrStampStill — render", () => {
  jest.setTimeout(30_000);

  it("returns an error mosaic when imagePath is missing (instead of throwing)", async () => {
    const file = await QrStampStill.render({}, makeCtx());
    const doc = asDocument(file);
    expect(doc.sources?.length).toBe(1);
    const src = doc.sources![0] as { engine?: { renderStatus?: string } };
    expect(src.engine?.renderStatus).toBe("error");
  });

  // Tests that check the LIVE-GEN branch pass a custom URL so the
  // bundled-static optimization (URL = default + non-transparent) doesn't
  // fire. The bundled-static branch emits 2 media sources and no QR child;
  // the live-gen branch emits a nested QR child as expected below.
  const CUSTOM_URL = "https://example.com";

  it("emits a 2-source mosaic: base media + nested QR sub-document", async () => {
    const doc = asDocument(
      await QrStampStill.render(
        { imagePath: IMAGE_PATH, text: CUSTOM_URL, mode: "light" },
        makeCtx(),
      ),
    );
    const sources = doc.sources ?? [];
    expect(sources).toHaveLength(2);
    asMediaSource(sources[0]); // base image
    const stamp = asMosaicSource(sources[1]); // QR child
    expect(stamp.ref).toBe("qr");
    expect(doc.children?.qr).toBeDefined();
  });

  it("QR child is a self-contained mosaic of lavfi color tiles (no PNG asset)", async () => {
    const doc = asDocument(
      await QrStampStill.render(
        { imagePath: IMAGE_PATH, text: CUSTOM_URL, mode: "light" },
        makeCtx(),
      ),
    );
    const child = doc.children!.qr as MosaicDocument;
    expect(child.kind).toBe("mosaic_document");
    expect(Object.keys(child.assets ?? {})).toEqual([]);
    const childSources = child.sources ?? [];
    expect(childSources.length).toBeGreaterThan(30);
    for (const s of childSources) {
      const tile = s as MosaicLavfiSource;
      expect(tile.type).toBe("lavfi");
      expect(tile.color).toBe("#f97316");
    }
  });

  it("auto + high luma → light variant (white sub-doc background)", async () => {
    const doc = asDocument(
      await QrStampStill.render(
        { imagePath: IMAGE_PATH, text: CUSTOM_URL, mode: "auto", overallLumaForAuto: 200 },
        makeCtx(),
      ),
    );
    const child = doc.children!.qr as MosaicDocument;
    expect(child.backgroundColor).toMatch(/^#ffffff([0-9a-f]{2}|@\d+(\.\d+)?)?$/i);
  });

  it("auto + low luma → dark variant (black sub-doc background)", async () => {
    const doc = asDocument(
      await QrStampStill.render(
        { imagePath: IMAGE_PATH, text: CUSTOM_URL, mode: "auto", overallLumaForAuto: 40 },
        makeCtx(),
      ),
    );
    const child = doc.children!.qr as MosaicDocument;
    expect(child.backgroundColor).toMatch(/^#000000([0-9a-f]{2}|@\d+(\.\d+)?)?$/i);
  });

  it("forced mode wins over the auto threshold", async () => {
    const doc = asDocument(
      await QrStampStill.render(
        { imagePath: IMAGE_PATH, text: CUSTOM_URL, mode: "dark", overallLumaForAuto: 240 },
        makeCtx(),
      ),
    );
    const child = doc.children!.qr as MosaicDocument;
    expect(child.backgroundColor).toMatch(/^#000000([0-9a-f]{2}|@\d+(\.\d+)?)?$/i);
  });

  it("transparent mode → no backgroundColor on the sub-doc", async () => {
    const doc = asDocument(
      await QrStampStill.render(
        { imagePath: IMAGE_PATH, mode: "transparent" },
        makeCtx(),
      ),
    );
    const child = doc.children!.qr as MosaicDocument;
    expect(child.backgroundColor).toBeUndefined();
  });

  it("bgOpacity controls the sub-doc background alpha suffix", async () => {
    const doc = asDocument(
      await QrStampStill.render(
        { imagePath: IMAGE_PATH, text: CUSTOM_URL, mode: "light", bgOpacity: 0.8 },
        makeCtx(),
      ),
    );
    const child = doc.children!.qr as MosaicDocument;
    // bgOpacity=0.8 → either "#ffffff@0.8" (legacy) or "#ffffffcc" (8-digit hex).
    expect(child.backgroundColor).toMatch(/^(#ffffff@0\.8|#ffffffcc)$/i);
  });

  it("overlay placement uses bottom-right via placement.inset (m0 cell-positioned)", async () => {
    const doc = asDocument(
      await QrStampStill.render(
        {
          imagePath: IMAGE_PATH,
          text: CUSTOM_URL,
          mode: "light",
          cornerInsetPx: 40,
          stampSizePct: 12,
        },
        makeCtx({ width: 1920, height: 1080 }),
      ),
    );
    const stamp = asMosaicSource((doc.sources ?? [])[1]);
    expect(stamp.placement?.fit).toBe("contain");
    const hAlign = (stamp.placement as { hAlign?: string }).hAlign;
    const vAlign = (stamp.placement as { vAlign?: string }).vAlign;
    expect(hAlign).toBe("left");
    expect(vAlign).toBe("top");
    const inset = stamp.placement?.inset as { right?: number; bottom?: number };
    expect(inset?.right).toBeGreaterThan(0);
    expect(inset?.bottom).toBeGreaterThan(0);
  });

  it("m0 string ends in exactly one overlay-closing brace (1 layer)", async () => {
    const doc = asDocument(
      await QrStampStill.render(
        { imagePath: IMAGE_PATH, mode: "light" },
        makeCtx(),
      ),
    );
    expect(doc.m0.endsWith("}")).toBe(true);
    expect(doc.m0.match(/\}$/)).not.toBeNull();
  });
});
