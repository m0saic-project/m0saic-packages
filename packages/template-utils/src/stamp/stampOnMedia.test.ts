import type { MosaicAssetManifest, MosaicDocument, MosaicSource } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { getFrameCount } from "@m0saic/dsl";
import { stampOnMedia, type StampLayer } from "./stampOnMedia";

const baseAssetId = asAssetId("wm_base");

function makeBaseSource(): MosaicSource {
  return { type: "media", mediaType: "video", assetId: baseAssetId, placement: { fit: "cover" } };
}

function makeBaseAssets(): MosaicAssetManifest {
  return { [baseAssetId]: { kind: "file", path: "/tmp/in.mp4", mediaType: "video" } } as MosaicAssetManifest;
}

function makeChild(): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "F" as MosaicDocument["m0"],
    sources: [],
    assets: {} as MosaicAssetManifest,
    size: { width: 200, height: 100 },
  };
}

const rect = { x: 1702, y: 959, w: 194, h: 97 };
const canvas = { canvasW: 1920, canvasH: 1080 };

describe("stampOnMedia", () => {
  test("single constant-opacity layer → visual.opacity, no overlay", () => {
    const doc = stampOnMedia({
      baseSource: makeBaseSource(),
      baseAssets: makeBaseAssets(),
      ...canvas,
      rect,
      layers: [{ child: makeChild(), opacity: 0.85, key: "wm" }],
    });
    expect(doc.sources).toHaveLength(2);
    expect(doc.sources[0]).toEqual(makeBaseSource());
    const stamp = doc.sources[1] as Extract<MosaicSource, { type: "mosaic" }>;
    expect(stamp.type).toBe("mosaic");
    expect(stamp.ref).toBe("wm_wm");
    expect(stamp.visual?.opacity).toBe(0.85);
    expect(stamp.overlay).toBeUndefined();
    expect(stamp.editor?.label).toBe("wm:wm");
    expect(doc.children?.wm_wm).toBeDefined();
    expect(getFrameCount(String(doc.m0))).toBe(2);
    expect(doc.size).toEqual({ width: 1920, height: 1080 });
  });

  test("alphaExpr layer → overlay.alpha, no visual.opacity", () => {
    const doc = stampOnMedia({
      baseSource: makeBaseSource(),
      baseAssets: makeBaseAssets(),
      ...canvas,
      rect,
      layers: [{ child: makeChild(), alphaExpr: "min(1,max(0,t))", key: "light" }],
    });
    const stamp = doc.sources[1] as Extract<MosaicSource, { type: "mosaic" }>;
    expect(stamp.overlay?.alpha).toBe("min(1,max(0,t))");
    expect(stamp.visual).toBeUndefined();
  });

  test("two layers → two children, two overlay cells, paint order preserved", () => {
    const doc = stampOnMedia({
      baseSource: makeBaseSource(),
      baseAssets: makeBaseAssets(),
      ...canvas,
      rect,
      layers: [
        { child: makeChild(), alphaExpr: "0.5", key: "light" },
        { child: makeChild(), alphaExpr: "0.5", key: "dark" },
      ],
    });
    expect(doc.sources).toHaveLength(3);
    expect((doc.sources[1] as { ref?: string }).ref).toBe("wm_light");
    expect((doc.sources[2] as { ref?: string }).ref).toBe("wm_dark");
    expect(Object.keys(doc.children ?? {})).toEqual(["wm_light", "wm_dark"]);
    expect(getFrameCount(String(doc.m0))).toBe(3);
  });

  test("determinism: same inputs → deep-equal docs", () => {
    const build = () =>
      stampOnMedia({
        baseSource: makeBaseSource(),
        baseAssets: makeBaseAssets(),
        ...canvas,
        rect,
        layers: [{ child: makeChild(), opacity: 0.5, key: "wm" }],
      });
    expect(build()).toEqual(build());
  });

  test("validation throws", () => {
    const ok = {
      baseSource: makeBaseSource(),
      baseAssets: makeBaseAssets(),
      ...canvas,
      rect,
    };
    expect(() => stampOnMedia({ ...ok, layers: [] })).toThrow(/layers/);
    expect(() =>
      stampOnMedia({ ...ok, rect: { ...rect, w: 0 }, layers: [{ child: makeChild(), key: "wm" }] }),
    ).toThrow(/positive dimensions/);
    expect(() =>
      stampOnMedia({
        ...ok,
        layers: [
          { child: makeChild(), key: "wm" },
          { child: makeChild(), key: "wm" },
        ],
      }),
    ).toThrow(/unique/);
    const sizeless = { ...makeChild() };
    delete (sizeless as Partial<MosaicDocument>).size;
    expect(() => stampOnMedia({ ...ok, layers: [{ child: sizeless, key: "wm" }] })).toThrow(/size/);
  });
});
