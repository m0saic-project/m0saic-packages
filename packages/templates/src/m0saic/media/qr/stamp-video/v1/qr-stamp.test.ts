import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  LuminanceBucket,
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicMediaSource,
  MosaicMosaicSource,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { QrStampVideo } from "./qr-stamp";

const TEMPLATE_ID = "@m0saic/media/qr/stamp-video/v1";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & {
    workspaceDir?: string;
  },
): MosaicEngineContext {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("qr-stamp-vid-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 5000,
      ...overrides,
    },
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 5000,
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

function mediaSources(doc: MosaicDocument): MosaicMediaSource[] {
  return (doc.sources ?? []).filter(
    (s): s is MosaicMediaSource => s.type === "media",
  );
}

/**
 * The QR variants are nested mosaic refs `qr_stamp_light` / `qr_stamp_dark`
 * / `qr_stamp_transparent` — all the things that used to be raster PNG
 * media sources are now self-contained child documents. The gleam stays
 * separately referenced under `qr_stamp_gleam`.
 */
function qrVariantSources(doc: MosaicDocument): MosaicMosaicSource[] {
  return (doc.sources ?? []).filter(
    (s): s is MosaicMosaicSource =>
      s.type === "mosaic" && /^qr_stamp_(light|dark|transparent)$/.test(s.ref),
  );
}

/**
 * Returns the MosaicMosaicSource pointing at the inner gleam doc (if
 * present) plus the inner doc itself.
 */
function gleamRef(doc: MosaicDocument): {
  parentSrc: MosaicMosaicSource | undefined;
  innerDoc: MosaicDocument | undefined;
} {
  const parentSrc = (doc.sources ?? []).find(
    (s): s is MosaicMosaicSource =>
      s.type === "mosaic" && s.ref === "qr_stamp_gleam",
  );
  const child = doc.children?.["qr_stamp_gleam"];
  const innerDoc =
    child && child.kind === "mosaic_document"
      ? (child as MosaicDocument)
      : undefined;
  return { parentSrc, innerDoc };
}

const VIDEO_PATH = "/tmp/fake-base.mp4";
const SYNTHETIC_BUCKETS: LuminanceBucket[] = [
  { startMs: 0, endMs: 1000, avgLuma: 50 },
  { startMs: 1000, endMs: 2000, avgLuma: 80 },
  { startMs: 2000, endMs: 3000, avgLuma: 200 },
  { startMs: 3000, endMs: 4000, avgLuma: 220 },
];

describe("QrStampVideo — template metadata", () => {
  it("has the expected id, label, version", () => {
    expect(QrStampVideo.id).toBe(TEMPLATE_ID);
    expect(QrStampVideo.version).toBe(1);
    expect(QrStampVideo.label).toContain("QR Stamp");
  });

  it("declares video output kind", () => {
    expect(QrStampVideo.outputHints?.format?.kind).toBe("video");
  });

  it("has the expected default props", () => {
    const d = QrStampVideo.defaultProps!;
    expect(d.text).toBe("https://www.m0saic.io");
    expect(d.cornerInsetPx).toBe(24);
    expect(d.mode).toBe("auto");
    expect(d.gleam).toBe(true);
  });

  it("includes free-tier-related tags", () => {
    expect(QrStampVideo.tags).toContain("watermark");
    expect(QrStampVideo.tags).toContain("free-tier");
  });
});

describe("QrStampVideo — render", () => {
  jest.setTimeout(30_000);

  it("returns an error mosaic when videoPath is missing (instead of throwing)", async () => {
    const file = await QrStampVideo.render({}, makeCtx());
    const doc = asDocument(file);
    expect(doc.sources?.length).toBe(1);
    const src = doc.sources![0] as { engine?: { renderStatus?: string } };
    expect(src.engine?.renderStatus).toBe("error");
  });

  it("mode=auto produces base + 2 QR sub-mosaics with adaptive alpha", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        {
          videoPath: VIDEO_PATH,
          mode: "auto",
          luminanceBuckets: SYNTHETIC_BUCKETS,
          gleam: false,
        },
        makeCtx(),
      ),
    );
    // Base media + 2 QR mosaic refs.
    const media = mediaSources(doc);
    expect(media).toHaveLength(1);
    expect(media[0]!.mediaType).toBe("video");
    expect(media[0]!.overlay).toBeUndefined();

    const variants = qrVariantSources(doc);
    expect(variants).toHaveLength(2);
    expect(variants[0]!.ref).toBe("qr_stamp_light");
    expect(variants[1]!.ref).toBe("qr_stamp_dark");
    expect(variants[0]!.placement?.fit).toBe("contain");

    // Adaptive alphas: complementary smoothstep shapes between variants.
    const a1 = variants[0]!.overlay!.alpha as string;
    const a2 = variants[1]!.overlay!.alpha as string;
    expect(a1).toMatch(/\(3-2\*/);
    expect(a2).toMatch(/\(3-2\*/);
    expect(a1).not.toEqual(a2);
  });

  it("each QR variant lives in doc.children as a lavfi-only sub-mosaic", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        {
          videoPath: VIDEO_PATH,
          mode: "auto",
          luminanceBuckets: SYNTHETIC_BUCKETS,
          gleam: false,
        },
        makeCtx(),
      ),
    );
    const lightChild = doc.children!.qr_stamp_light as MosaicDocument;
    const darkChild = doc.children!.qr_stamp_dark as MosaicDocument;
    expect(lightChild?.kind).toBe("mosaic_document");
    expect(darkChild?.kind).toBe("mosaic_document");
    // Sub-doc backgrounds carry the variant tint (with default 0.92 opacity).
    expect(lightChild.backgroundColor).toMatch(/^#ffffff(@\d+(\.\d+)?)?$/);
    expect(darkChild.backgroundColor).toMatch(/^#000000(@\d+(\.\d+)?)?$/);
    // No external PNG asset — modules are pure lavfi.
    expect(Object.keys(lightChild.assets ?? {})).toEqual([]);
    expect(Object.keys(darkChild.assets ?? {})).toEqual([]);
    for (const s of lightChild.sources ?? []) {
      const tile = s as MosaicLavfiSource;
      expect(tile.type).toBe("lavfi");
      expect(tile.color).toBe("#f97316");
    }
  });

  it("mode=light produces base + single QR sub-mosaic (no adaptive alpha)", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        {
          videoPath: VIDEO_PATH,
          mode: "light",
          entrance: false,
          gleam: false,
        },
        makeCtx(),
      ),
    );
    expect(mediaSources(doc)).toHaveLength(1);
    const variants = qrVariantSources(doc);
    expect(variants).toHaveLength(1);
    expect(variants[0]!.overlay?.alpha).toBeUndefined();
  });

  it("mode=dark produces a single QR sub-mosaic with no adaptive alpha", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        { videoPath: VIDEO_PATH, mode: "dark", entrance: false, gleam: false },
        makeCtx(),
      ),
    );
    expect(qrVariantSources(doc)).toHaveLength(1);
    expect(qrVariantSources(doc)[0]!.ref).toBe("qr_stamp_dark");
  });

  it("mode=transparent gives the sub-doc no backgroundColor (alpha survives)", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        {
          videoPath: VIDEO_PATH,
          mode: "transparent",
          entrance: false,
          gleam: false,
        },
        makeCtx(),
      ),
    );
    const variants = qrVariantSources(doc);
    expect(variants).toHaveLength(1);
    expect(variants[0]!.ref).toBe("qr_stamp_transparent");
    const child = doc.children!.qr_stamp_transparent as MosaicDocument;
    expect(child.backgroundColor).toBeUndefined();
  });

  it("entrance=true contributes a smoothstep factor to alpha; entrance=false omits it", async () => {
    const withEntrance = asDocument(
      await QrStampVideo.render(
        { videoPath: VIDEO_PATH, mode: "light", entrance: true, gleam: false },
        makeCtx(),
      ),
    );
    const withoutEntrance = asDocument(
      await QrStampVideo.render(
        { videoPath: VIDEO_PATH, mode: "light", entrance: false, gleam: false },
        makeCtx(),
      ),
    );
    const a1 = qrVariantSources(withEntrance)[0]!.overlay?.alpha;
    const a2 = qrVariantSources(withoutEntrance)[0]!.overlay?.alpha;
    expect(a1).toMatch(/\(3-2\*/);
    expect(a2).toBeUndefined();
  });

  it("gleam=true wraps the shine band in a nested mosaic for pixel-perfect clipping", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        {
          videoPath: VIDEO_PATH,
          mode: "light",
          entrance: false,
          gleam: true,
        },
        makeCtx(),
      ),
    );
    const { parentSrc, innerDoc } = gleamRef(doc);
    expect(parentSrc).toBeDefined();
    expect(parentSrc!.overlay?.blendMode).toBe("screen");
    expect(parentSrc!.overlay?.enable).toBe("lt(mod(t,6.000),0.900)");

    expect(innerDoc).toBeDefined();
    expect(innerDoc!.sources).toHaveLength(2);
    const lavfiBase = innerDoc!.sources![0]!;
    expect(lavfiBase.type).toBe("lavfi");
    const gleamImg = innerDoc!.sources![1]!;
    expect(gleamImg.type).toBe("media");
    expect((gleamImg as MosaicMediaSource).mediaType).toBe("image");
    expect((gleamImg as MosaicMediaSource).overlay?.xExpr).toBeDefined();
    expect((gleamImg as MosaicMediaSource).overlay!.xExpr!).toContain("mod(t,");
    expect((gleamImg as MosaicMediaSource).overlay?.enable).toBe(
      "lt(mod(t,6.000),0.900)",
    );
  });

  it("gleam + entrance compounds the enable gate (waits for entrance, then sweeps only)", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        {
          videoPath: VIDEO_PATH,
          mode: "light",
          entrance: true,
          entranceDurMs: 500,
          gleam: true,
        },
        makeCtx(),
      ),
    );
    const { parentSrc, innerDoc } = gleamRef(doc);
    const parentEnable = parentSrc?.overlay?.enable as string;
    expect(parentEnable).toContain("gte(t,0.500)");
    expect(parentEnable).toContain("lt(mod(t,");
    expect(parentEnable).toContain("*");
    const innerEnable = (innerDoc!.sources![1] as MosaicMediaSource).overlay
      ?.enable as string;
    expect(innerEnable).toContain("gte(t,0.500)");
    expect(innerEnable).toContain("lt(mod(t,");
    expect(innerEnable).toContain("*");
  });

  it("gleam=false omits the shine-band overlay entirely", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        {
          videoPath: VIDEO_PATH,
          mode: "light",
          entrance: false,
          gleam: false,
        },
        makeCtx(),
      ),
    );
    const { parentSrc } = gleamRef(doc);
    expect(parentSrc).toBeUndefined();
    for (const src of doc.sources ?? []) {
      if (src.type === "data") continue;
      expect(src.overlay?.blendMode).not.toBe("screen");
    }
  });

  it("gleam in auto mode sits on top of both QR variants via nested mosaic", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        {
          videoPath: VIDEO_PATH,
          mode: "auto",
          luminanceBuckets: SYNTHETIC_BUCKETS,
          entrance: false,
          gleam: true,
        },
        makeCtx(),
      ),
    );
    expect(qrVariantSources(doc)).toHaveLength(2);
    const allSources = doc.sources!;
    const gleamIdx = allSources.findIndex(
      (s) => s.type === "mosaic" && s.ref === "qr_stamp_gleam",
    );
    expect(gleamIdx).toBe(allSources.length - 1);
    const { parentSrc } = gleamRef(doc);
    expect(parentSrc?.overlay?.blendMode).toBe("screen");
  });

  it("m0 string nests one placeRect cell per overlay variant", async () => {
    const auto = asDocument(
      await QrStampVideo.render(
        {
          videoPath: VIDEO_PATH,
          mode: "auto",
          luminanceBuckets: SYNTHETIC_BUCKETS,
          entrance: false,
          gleam: false,
        },
        makeCtx(),
      ),
    );
    expect(auto.m0.match(/\}/g)?.length).toBeGreaterThanOrEqual(2);

    const light = asDocument(
      await QrStampVideo.render(
        { videoPath: VIDEO_PATH, mode: "light", entrance: false, gleam: false },
        makeCtx(),
      ),
    );
    expect(light.m0.endsWith("}")).toBe(true);
  });

  it("base asset points at videoPath", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        { videoPath: VIDEO_PATH, mode: "light", entrance: false, gleam: false },
        makeCtx(),
      ),
    );
    const baseSrc = mediaSources(doc)[0]!;
    const baseAsset = doc.assets[baseSrc.assetId];
    expect(baseAsset?.kind).toBe("file");
    expect(baseAsset?.kind === "file" ? baseAsset.path : "").toBe(VIDEO_PATH);
  });

  it("is deterministic — same inputs → identical overlay structure (alpha exprs equal)", async () => {
    const propsA = {
      videoPath: VIDEO_PATH,
      mode: "auto" as const,
      luminanceBuckets: SYNTHETIC_BUCKETS,
      entrance: false,
      gleam: false,
    };
    const docA = asDocument(await QrStampVideo.render(propsA, makeCtx()));
    const docB = asDocument(await QrStampVideo.render(propsA, makeCtx()));
    const vA = qrVariantSources(docA);
    const vB = qrVariantSources(docB);
    expect(vA[0]!.overlay!.alpha).toBe(vB[0]!.overlay!.alpha);
    expect(vA[1]!.overlay!.alpha).toBe(vB[1]!.overlay!.alpha);
  });

  it("cornerInsetPx (gutter) + stampSizePct propagate into placement.inset", async () => {
    const doc = asDocument(
      await QrStampVideo.render(
        {
          videoPath: VIDEO_PATH,
          mode: "light",
          cornerInsetPx: 48,
          stampSizePct: 20,
          entrance: false,
          gleam: false,
        },
        makeCtx({ width: 1000, height: 1000 }),
      ),
    );
    const stamp = qrVariantSources(doc)[0]!;
    const inset = stamp.placement?.inset as { right?: number; bottom?: number };
    expect(inset?.right).toBeCloseTo(48 / 248, 3);
    expect(inset?.bottom).toBeCloseTo(48 / 248, 3);
  });
});
