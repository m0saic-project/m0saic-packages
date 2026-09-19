import type {
  LuminanceBucket,
  MosaicDocument,
  MosaicMosaicSource,
  MosaicSource,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { stampQrOnMedia } from "./stampQr";

function makeBaseDoc(): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String("F", "stampQr-base"),
    sources: [
      {
        type: "media",
        mediaType: "video",
        assetId: "base" as never,
        placement: { fit: "cover" },
      },
    ],
    assets: {} as MosaicDocument["assets"],
    size: { width: 1920, height: 1080 },
  };
}

const BUCKETS: LuminanceBucket[] = [
  { startMs: 0, endMs: 1500, avgLuma: 40 },
  { startMs: 1500, endMs: 3000, avgLuma: 220 },
];

describe("stampQrOnMedia — inputs", () => {
  test("throws on missing text", () => {
    expect(() =>
      stampQrOnMedia({ baseDoc: makeBaseDoc(), text: "" }),
    ).toThrow(/text/);
  });

  test("throws on missing base sources", () => {
    const bad = makeBaseDoc();
    bad.sources = [];
    expect(() =>
      stampQrOnMedia({ baseDoc: bad, text: "https://m0saic.io" }),
    ).toThrow(/sources/);
  });
});

describe("stampQrOnMedia — mode = auto (2 variants)", () => {
  const doc = stampQrOnMedia({
    baseDoc: makeBaseDoc(),
    text: "https://m0saic.io",
    mode: "auto",
    luminanceBuckets: BUCKETS,
    animation: "none",
  });

  test("returns a mosaic_document", () => {
    expect(doc.kind).toBe("mosaic_document");
  });

  test("base media is sources[0]", () => {
    const sources = doc.sources ?? [];
    expect(sources[0]!.type).toBe("media");
  });

  test("emits one mosaic source per variant referencing a child", () => {
    const sources = doc.sources ?? [];
    const variants = sources.filter(
      (s): s is MosaicMosaicSource => s.type === "mosaic",
    );
    expect(variants).toHaveLength(2);
    expect(variants[0]!.ref).toBe("qr_stamp_light");
    expect(variants[1]!.ref).toBe("qr_stamp_dark");
    expect(doc.children?.qr_stamp_light).toBeDefined();
    expect(doc.children?.qr_stamp_dark).toBeDefined();
  });

  test("variant children carry the right backgroundColor", () => {
    expect((doc.children!.qr_stamp_light as MosaicDocument).backgroundColor).toBe(
      "#ffffff",
    );
    expect((doc.children!.qr_stamp_dark as MosaicDocument).backgroundColor).toBe(
      "#000000",
    );
  });

  test("adaptive alpha exprs differ between variants (complementary)", () => {
    const sources = doc.sources ?? [];
    const light = sources.find(
      (s): s is MosaicMosaicSource =>
        s.type === "mosaic" && s.ref === "qr_stamp_light",
    )!;
    const dark = sources.find(
      (s): s is MosaicMosaicSource =>
        s.type === "mosaic" && s.ref === "qr_stamp_dark",
    )!;
    expect(light.overlay?.alpha).toBeDefined();
    expect(dark.overlay?.alpha).toBeDefined();
    expect(light.overlay!.alpha).not.toBe(dark.overlay!.alpha);
    // Smoothstep signature from buildAdaptiveAlphaExpr.
    expect(light.overlay!.alpha as string).toMatch(/\(3-2\*/);
  });
});

describe("stampQrOnMedia — mode = light / dark / transparent", () => {
  test("light = single variant, white background, no adaptive alpha", () => {
    const doc = stampQrOnMedia({
      baseDoc: makeBaseDoc(),
      text: "https://m0saic.io",
      mode: "light",
      animation: "none",
    });
    const variants = (doc.sources ?? []).filter(
      (s): s is MosaicMosaicSource => s.type === "mosaic",
    );
    expect(variants).toHaveLength(1);
    expect(variants[0]!.ref).toBe("qr_stamp_light");
    expect(variants[0]!.overlay?.alpha).toBeUndefined();
    expect(
      (doc.children!.qr_stamp_light as MosaicDocument).backgroundColor,
    ).toBe("#ffffff");
  });

  test("dark = single variant, black background", () => {
    const doc = stampQrOnMedia({
      baseDoc: makeBaseDoc(),
      text: "https://m0saic.io",
      mode: "dark",
      animation: "none",
    });
    expect(
      (doc.children!.qr_stamp_dark as MosaicDocument).backgroundColor,
    ).toBe("#000000");
  });

  test("transparent = single variant, no backgroundColor on child", () => {
    const doc = stampQrOnMedia({
      baseDoc: makeBaseDoc(),
      text: "https://m0saic.io",
      mode: "transparent",
      animation: "none",
    });
    const child = doc.children!.qr_stamp_transparent as MosaicDocument;
    expect(child).toBeDefined();
    expect(child.backgroundColor).toBeUndefined();
  });
});

describe("stampQrOnMedia — animation", () => {
  test("fade-in attaches a smoothstep entrance factor to the alpha", () => {
    const doc = stampQrOnMedia({
      baseDoc: makeBaseDoc(),
      text: "https://m0saic.io",
      mode: "light",
      animation: "fade-in",
      entranceDurMs: 500,
    });
    const variant = (doc.sources ?? []).find(
      (s): s is MosaicMosaicSource => s.type === "mosaic",
    )!;
    expect(variant.overlay?.alpha as string).toContain("(3-2*");
  });

  test("none leaves the alpha unset when mode is also non-auto", () => {
    const doc = stampQrOnMedia({
      baseDoc: makeBaseDoc(),
      text: "https://m0saic.io",
      mode: "light",
      animation: "none",
    });
    const variant = (doc.sources ?? []).find(
      (s): s is MosaicMosaicSource => s.type === "mosaic",
    )!;
    expect(variant.overlay?.alpha).toBeUndefined();
  });
});

describe("stampQrOnMedia — layout", () => {
  test("m0 nests one overlay cell per variant", () => {
    const auto = stampQrOnMedia({
      baseDoc: makeBaseDoc(),
      text: "https://m0saic.io",
      mode: "auto",
      luminanceBuckets: BUCKETS,
      animation: "none",
    });
    // Two `}` close-braces — one per overlay layer.
    expect(String(auto.m0).match(/\}/g)?.length).toBe(2);

    const light = stampQrOnMedia({
      baseDoc: makeBaseDoc(),
      text: "https://m0saic.io",
      mode: "light",
      animation: "none",
    });
    expect(String(light.m0).endsWith("}")).toBe(true);
  });

  test("variant placement uses bottom-right inset", () => {
    const doc = stampQrOnMedia({
      baseDoc: makeBaseDoc(),
      text: "https://m0saic.io",
      mode: "light",
      animation: "none",
    });
    const variant = (doc.sources ?? []).find(
      (s): s is MosaicMosaicSource => s.type === "mosaic",
    )!;
    expect(variant.placement?.fit).toBe("contain");
    const inset = variant.placement?.inset as
      | { right?: number; bottom?: number }
      | undefined;
    expect(inset?.right).toBeGreaterThan(0);
    expect(inset?.bottom).toBeGreaterThan(0);
  });
});

describe("stampQrOnMedia — determinism", () => {
  test("identical inputs produce identical m0 + alpha exprs", () => {
    const opts = {
      baseDoc: makeBaseDoc(),
      text: "https://m0saic.io",
      mode: "auto" as const,
      luminanceBuckets: BUCKETS,
      animation: "none" as const,
    };
    const a = stampQrOnMedia(opts);
    const b = stampQrOnMedia(opts);
    expect(String(a.m0)).toBe(String(b.m0));
    const aLight = (a.sources ?? []).find(
      (s: MosaicSource): s is MosaicMosaicSource =>
        s.type === "mosaic" && s.ref === "qr_stamp_light",
    )!;
    const bLight = (b.sources ?? []).find(
      (s: MosaicSource): s is MosaicMosaicSource =>
        s.type === "mosaic" && s.ref === "qr_stamp_light",
    )!;
    expect(aLight.overlay?.alpha).toBe(bLight.overlay?.alpha);
  });
});

describe("gate-23: position knob is WIRED (all four corners)", () => {
  const { resolveDocFrames } = require("../geometry-contract/frameResolution");
  const base = {
    kind: "mosaic_document", version: 1, m0: "F",
    sources: [{ type: "lavfi", lavfi: "color=c=black" }],
    assets: {}, size: { width: 1920, height: 1080 },
  } as never;

  function stampCellCenter(position: "br" | "bl" | "tr" | "tl") {
    const doc = stampQrOnMedia({ baseDoc: base, text: "https://www.m0saic.io", position, mode: "light", canvasW: 1920, canvasH: 1080 });
    const rd = resolveDocFrames(doc, 1920, 1080);
    // frame 0 = base F; frame 1 = the stamp cell.
    const f = rd.framesByLogical[1];
    return { x: f.x + f.width / 2, y: f.y + f.height / 2 };
  }

  it("each corner lands its cell in the right quadrant (br byte-path unchanged)", () => {
    const br = stampCellCenter("br");
    expect(br.x).toBeGreaterThan(960); expect(br.y).toBeGreaterThan(540);
    const bl = stampCellCenter("bl");
    expect(bl.x).toBeLessThan(960); expect(bl.y).toBeGreaterThan(540);
    const tr = stampCellCenter("tr");
    expect(tr.x).toBeGreaterThan(960); expect(tr.y).toBeLessThan(540);
    const tl = stampCellCenter("tl");
    expect(tl.x).toBeLessThan(960); expect(tl.y).toBeLessThan(540);
  });
});
