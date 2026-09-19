import { isValidM0String } from "@m0saic/dsl";
import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import { STYLED_QR_CENTER_KEY, STYLED_QR_CUTOUT_MIN_VERSION, buildStyledQrDoc, styledQrModuleRadius } from "./styledQr";
import { stampQrOnMedia } from "./stampQr";

const TEXT = "https://m0saic.io";
const ORANGE = "#f97316" as const;

const center = (bg: string | undefined): MosaicDocument => ({
  kind: "mosaic_document",
  version: 1,
  m0: "1" as never,
  sources: [{ type: "lavfi", color: ORANGE } as MosaicSource],
  assets: {},
  size: { width: 272, height: 272 },
  ...(bg ? { backgroundColor: bg as never } : {}),
});

type Tile = { type: string; color?: string; effects?: { rounding?: { borderRadius?: number } }; ref?: string };

describe("buildStyledQrDoc — the branded QR, shared", () => {
  test("named module styles map to the QR Code template's radii", () => {
    expect(styledQrModuleRadius("circle")).toBe(1);
    expect(styledQrModuleRadius("roundedSquare")).toBe(0.3);
    expect(styledQrModuleRadius("square")).toBe(0);
  });

  test("data modules are rounded, the eye block is pre-styled, the centre splice references the child", () => {
    const r = buildStyledQrDoc({ text: TEXT, moduleColor: ORANGE, backgroundColor: "#ffffff", center: { width: 272, height: 272, paddingPct: 8, doc: center("#ffffff") } });
    expect(isValidM0String(String(r.doc.m0))).toBe(true);
    const src = r.doc.sources as Tile[];
    // every data module is a circle dot in the module colour
    for (const t of src.slice(0, r.dataCellEnd)) {
      expect(t.type).toBe("lavfi");
      expect(t.color).toBe(ORANGE);
      expect(t.effects?.rounding?.borderRadius).toBe(1);
    }
    // three eye layers per finder, then the centre
    expect(src.length - r.dataCellEnd).toBe(3 * 3 + 1);
    const last = src[src.length - 1];
    expect(last.type).toBe("mosaic");
    expect(last.ref).toBe(STYLED_QR_CENTER_KEY);
    expect(r.doc.children?.[STYLED_QR_CENTER_KEY]).toBeDefined();
    // a carved code floors the version so it still scans
    expect(r.canvasW).toBe(r.canvasH);
    // the card is OPAQUE on every render path (solidBackground)
    expect(String(r.doc.backgroundColor)).toMatch(/@1/);
  });

  test("no centre → no child, no splice; transparent card → no backgroundColor", () => {
    const r = buildStyledQrDoc({ text: TEXT, moduleColor: ORANGE });
    expect(r.doc.children).toBeUndefined();
    expect(r.doc.backgroundColor).toBeUndefined();
    const src = r.doc.sources as Tile[];
    expect(src.length - r.dataCellEnd).toBe(9);
    expect(src.every((t) => t.type === "lavfi")).toBe(true);
  });

  test("square style = radius 0 everywhere, but still the eye construction", () => {
    const r = buildStyledQrDoc({ text: TEXT, moduleColor: ORANGE, moduleBorderRadius: 0, eyeOuterBorderRadius: 0, eyeInnerDotBorderRadius: 0 });
    const src = r.doc.sources as Tile[];
    expect(src.slice(0, r.dataCellEnd).every((t) => t.effects?.rounding?.borderRadius === 0)).toBe(true);
    expect(src.length - r.dataCellEnd).toBe(9);
  });

  test("a centre without an explicit version forces the ECC-H cutout floor", () => {
    const plain = buildStyledQrDoc({ text: TEXT, moduleColor: ORANGE });
    const carved = buildStyledQrDoc({ text: TEXT, moduleColor: ORANGE, center: { width: 272, height: 272, doc: center(undefined) } });
    expect(carved.canvasW).toBeGreaterThan(plain.canvasW);
    expect(STYLED_QR_CUTOUT_MIN_VERSION).toBe(6);
  });

  test("deterministic", () => {
    const a = buildStyledQrDoc({ text: TEXT, moduleColor: ORANGE, backgroundColor: "#000000" });
    const b = buildStyledQrDoc({ text: TEXT, moduleColor: ORANGE, backgroundColor: "#000000" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("stampQrOnMedia — qr look", () => {
  const baseDoc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: "F" as never,
    sources: [{ type: "lavfi", color: "#123456" } as MosaicSource],
    assets: {},
    size: { width: 1920, height: 1080 },
  };

  test("without `qr` the variants are the plain matrix (byte-for-byte the old shape)", () => {
    const doc = stampQrOnMedia({ baseDoc, text: TEXT, mode: "light", animation: "none" });
    const kid = doc.children?.qr_stamp_light as MosaicDocument;
    const src = kid.sources as Tile[];
    expect(src.every((t) => t.type === "lavfi" && !t.effects)).toBe(true);
    expect(kid.children).toBeUndefined();
    expect(kid.backgroundColor).toBe("#ffffff");
  });

  test("with `qr` each variant is the branded code, its centre built for its own card colour", () => {
    const seen: (string | undefined)[] = [];
    const doc = stampQrOnMedia({
      baseDoc,
      text: TEXT,
      mode: "auto",
      luminanceBuckets: [],
      animation: "none",
      qr: {
        moduleBorderRadius: 1,
        eyeOuterBorderRadius: 0.3,
        eyeInnerDotBorderRadius: 0.5,
        center: { width: 272, height: 272, paddingPct: 8, docFor: (bg) => { seen.push(bg); return center(bg); } },
      },
    });
    expect(seen).toEqual(["#ffffff", "#000000"]);
    for (const v of ["light", "dark"] as const) {
      const kid = doc.children?.[`qr_stamp_${v}`] as MosaicDocument;
      const src = kid.sources as Tile[];
      expect(src[0].effects?.rounding?.borderRadius).toBe(1);
      expect(src[src.length - 1].ref).toBe(STYLED_QR_CENTER_KEY);
      expect(kid.children?.[STYLED_QR_CENTER_KEY]).toBeDefined();
      expect(String(kid.backgroundColor)).toMatch(/@1/);
    }
    // the transparent card gets a transparent centre
    const t = stampQrOnMedia({ baseDoc, text: TEXT, mode: "transparent", animation: "none", qr: { center: { width: 272, height: 272, docFor: (bg) => center(bg) } } });
    const kid = t.children?.qr_stamp_transparent as MosaicDocument;
    expect(kid.backgroundColor).toBeUndefined();
    expect((kid.children?.[STYLED_QR_CENTER_KEY] as MosaicDocument).backgroundColor).toBeUndefined();
  });
});
