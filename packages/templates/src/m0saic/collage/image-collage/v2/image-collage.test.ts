import type { MosaicDocument, MosaicDocumentPipeline } from "@m0saic/types";
import { ctxFor, handlesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { DEMO_IMAGES } from "../v1/demo-fixture";
import { ImageCollage } from "../v1/image-collage";
import { ImageCollageV2 } from "./image-collage";

const D = ImageCollageV2.defaultProps as Record<string, unknown>;
const IMG = (width: number, height: number) => ({ kind: "image", width, height });
const SET = Array.from({ length: 7 }, (_, i) => `/photos/p${i}.jpg`);
const MEDIA = Object.fromEntries(SET.map((p, i) => [p, IMG(1200 + 200 * (i % 3), 900 + 300 * (i % 2))]));
const MANY = Array.from({ length: 40 }, (_, i) => `/photos/m${i}.jpg`);
const MANY_MEDIA = Object.fromEntries(MANY.map((p, i) => [p, IMG(1600, i % 4 === 0 ? 2000 : 1200)]));
const SHEET = ["gutter", "margin", "cropBudget", "seed", "maxImagesPerSheet", "minCellPx", "maxCellPx", "gutterPx", "marginPx"];

vnextSuite({
  next: ImageCollageV2,
  prev: ImageCollage,
  cases: [
    { name: "seven photos", props: { sourceIds: SET }, media: MEDIA },
    { name: "seven photos, flush, portrait, another seed", props: { sourceIds: SET, gutterPx: 0, seed: 7, cropBudget: 0.5, background: "#FFFFFF" }, media: MEDIA, w: 1080, h: 1920 },
    { name: "forty photos page (uniform lattice)", props: { sourceIds: MANY }, media: MANY_MEDIA },
    { name: "forty photos page (independent lattice, 12 a sheet)", props: { sourceIds: MANY, maxImagesPerSheet: 12, pageLattice: "independent" }, media: MANY_MEDIA },
    { name: "a bad input is still the error card", props: { sourceIds: ["/photos/missing.jpg"] } },
  ],
  bound: [...SHEET, "sourceIds"],
  unbound: {},
});

describe("@m0saic/collage/image-collage/v2 — handles", () => {
  type Entry = { propKey: string; index?: number };
  const cellsOf = (doc: MosaicDocument) =>
    (doc.sources as Array<{ editor?: { label?: string; bindings?: Entry[] } }>).map((s) => ({ label: s.editor?.label, bindings: s.editor?.bindings ?? [] }));

  it("demo set: every tile is the ADD handle for the first photo, then the sheet's shape (v1 bound nothing)", async () => {
    const doc = (await ImageCollageV2.render({ ...D } as never, ctxFor(ImageCollageV2))) as MosaicDocument;
    const cells = cellsOf(doc);
    expect(cells).toHaveLength(DEMO_IMAGES.length);
    for (const cell of cells) {
      expect(cell.bindings[0]).toEqual({ propKey: "sourceIds", index: 0 });
      expect(cell.bindings.slice(1).map((b) => b.propKey)).toEqual(SHEET);
    }
  });

  it("real photos: the cell labelled img:k replaces sourceIds[k] — wherever the solver put it", async () => {
    const doc = (await ImageCollageV2.render({ ...D, sourceIds: SET } as never, ctxFor(ImageCollageV2, { media: MEDIA }))) as MosaicDocument;
    const cells = cellsOf(doc);
    expect(cells).toHaveLength(SET.length);
    for (const cell of cells) expect(cell.bindings[0]).toEqual({ propKey: "sourceIds", index: Number(cell.label!.slice("img:".length)) });
    expect(cells.map((c) => c.bindings[0].index!).sort((a, b) => a - b)).toEqual(SET.map((_, i) => i));
  });

  it("a blank entry is skipped by the pack, and the cells still name their own slot in the prop", async () => {
    const withBlank = [SET[0], "  ", SET[1], SET[2]];
    const doc = (await ImageCollageV2.render({ ...D, sourceIds: withBlank } as never, ctxFor(ImageCollageV2, { media: MEDIA }))) as MosaicDocument;
    const byLabel = Object.fromEntries(cellsOf(doc).map((c) => [c.label, c.bindings[0].index]));
    expect(byLabel).toEqual({ "img:0": 0, "img:1": 2, "img:2": 3 });
  });

  it("paged sets: indexes run on across the sheets; nothing is rejected", async () => {
    const ctx = ctxFor(ImageCollageV2, { media: MANY_MEDIA });
    const film = (await ImageCollageV2.render({ ...D, sourceIds: MANY } as never, ctx)) as MosaicDocumentPipeline;
    expect(film.steps.length).toBeGreaterThan(1);
    const indexes = film.steps.flatMap((st) => cellsOf(st.file as MosaicDocument).map((c) => c.bindings[0].index!));
    expect([...indexes].sort((a, b) => a - b)).toEqual(MANY.map((_, i) => i));
    expect(handlesOf(film, ImageCollageV2, ctx).rejected).toEqual([]);
  });
});
