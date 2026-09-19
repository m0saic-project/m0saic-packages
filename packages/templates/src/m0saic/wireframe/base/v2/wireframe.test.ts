import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicRenderableFile,
} from "@m0saic/types";
import { WireframeV2 } from "./wireframe";
import { resolvePropBindings } from "@m0saic/template-utils";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]>,
): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 1000, ...overrides },
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 1000,
      workspaceDir: "/tmp",
      ...overrides,
    },
    media: {},
  } as MosaicEngineContext;
}

function asDoc(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

describe("WireframeV2", () => {
  it("has the v2 id/version", () => {
    expect(WireframeV2.id).toBe("@m0saic/wireframe/base/v2");
    expect(WireframeV2.version).toBe(2);
  });

  it("builds a FLAT document — no nested children, one source per frame", async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "2(1,1)" }, makeCtx()));
    expect(doc.children).toBeUndefined();
    expect(doc.sources).toHaveLength(2);
  });

  it("debug mode: each frame is an inline-masked color tile (no text sources)", async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "2(1,1)" }, makeCtx()));
    for (const src of doc.sources) {
      expect(src.type).toBe("lavfi");
      const lavfi = src as MosaicLavfiSource;
      expect(lavfi.mask?.kind).toBe("inline-mask");
      // mask carries border ring + glyph outlines as SVG path data
      const localPath = (lavfi.mask as { localPath: string }).localPath;
      expect(typeof localPath).toBe("string");
      expect(localPath.length).toBeGreaterThan(0);
    }
  });

  it("thumb mode: flat color tiles with effects, no masks", async () => {
    const doc = asDoc(
      await WireframeV2.render({ M0String: "2(1,1)", preset: "thumb-dark" }, makeCtx()),
    );
    expect(doc.sources).toHaveLength(2);
    for (const src of doc.sources) {
      expect(src.type).toBe("lavfi");
      const lavfi = src as MosaicLavfiSource;
      expect(lavfi.mask).toBeUndefined();
      expect(lavfi.effects).toBeDefined();
    }
  });

  it("scales source count with the frame count (flat, no per-cell docs)", async () => {
    const doc = asDoc(
      await WireframeV2.render({ M0String: "4(1,1,1,1)" }, makeCtx()),
    );
    expect(doc.sources).toHaveLength(4);
    expect(doc.children).toBeUndefined();
  });

  // ── Label content / overflow API ──
  // The mask path bakes the border ring + glyph outlines as SVG path data, so
  // richer content ⇒ more glyphs ⇒ a longer path. We assert relative lengths
  // rather than exact geometry.
  function maskPathLen(doc: MosaicDocument, idx = 0): number {
    const src = doc.sources[idx] as MosaicLavfiSource;
    return ((src.mask as { localPath: string }).localPath ?? "").length;
  }

  // One big single-frame canvas so every content level comfortably fits.
  const bigCtx = () => makeCtx({ width: 1200, height: 800 });

  it('labelContent ladder is cumulative — "none" < "number" < "dimensions" < "aspect"', async () => {
    const none = asDoc(await WireframeV2.render({ M0String: "F", labelContent: "none" }, bigCtx()));
    const num = asDoc(await WireframeV2.render({ M0String: "F", labelContent: "number" }, bigCtx()));
    const dims = asDoc(await WireframeV2.render({ M0String: "F", labelContent: "dimensions" }, bigCtx()));
    const aspect = asDoc(await WireframeV2.render({ M0String: "F", labelContent: "aspect" }, bigCtx()));

    expect(maskPathLen(none)).toBeLessThan(maskPathLen(num));
    expect(maskPathLen(num)).toBeLessThan(maskPathLen(dims));
    expect(maskPathLen(dims)).toBeLessThan(maskPathLen(aspect));
  });

  it('"none" draws only the frame outline (no glyphs)', async () => {
    const none = asDoc(await WireframeV2.render({ M0String: "F", labelContent: "none" }, bigCtx()));
    // Border ring is two rects: an outer + inner contour, each 4 line segments.
    const path = ((none.sources[0] as MosaicLavfiSource).mask as { localPath: string }).localPath;
    // Ring path has exactly two "M" subpaths (outer + inner); glyphs would add more.
    expect((path.match(/M/g) ?? []).length).toBe(2);
  });

  it("defaults to dimensions (number + W×H), aspect is opt-in", async () => {
    const def = asDoc(await WireframeV2.render({ M0String: "F" }, bigCtx()));
    const dims = asDoc(await WireframeV2.render({ M0String: "F", labelContent: "dimensions" }, bigCtx()));
    expect(maskPathLen(def)).toBe(maskPathLen(dims));
  });

  it("degrades on tiny tiles — requested aspect falls back when it can't fit", async () => {
    // A 4-way row split of a short canvas → narrow tiles that can't hold 3 lines.
    const tiny = asDoc(
      await WireframeV2.render(
        { M0String: "4(1,1,1,1)", labelContent: "aspect", labelOverflow: "degrade" },
        makeCtx({ width: 400, height: 80 }),
      ),
    );
    const roomy = asDoc(
      await WireframeV2.render(
        { M0String: "F", labelContent: "aspect" },
        makeCtx({ width: 400, height: 300 }),
      ),
    );
    // The tiny tile shows strictly less than the fully-fitted aspect stack.
    expect(maskPathLen(tiny)).toBeLessThan(maskPathLen(roomy));
  });

  it("draws a uniform border weight across tiles of different sizes", async () => {
    // Mixed sizes in one canvas: left half is one big tile, right half is split
    // into smaller ones. With labelContent "none" each mask is just the border
    // ring (outer M + inner M); the inner ring's offset == the pen width, which
    // must be identical regardless of tile size.
    const doc = asDoc(
      await WireframeV2.render({ M0String: "2(F,2[F,F])", labelContent: "none" }, makeCtx()),
    );
    const innerInset = (src: MosaicLavfiSource): number => {
      const path = (src.mask as { localPath: string }).localPath;
      // Second "M x y" is the inner contour; its x is the border inset.
      const ms = [...path.matchAll(/M\s*(-?[\d.]+)/g)];
      return parseFloat(ms[1][1]);
    };
    const insets = doc.sources.map((s) => innerInset(s as MosaicLavfiSource));
    expect(insets).toHaveLength(3);
    // Every tile shares the same pen width (within sub-pixel rounding).
    for (const v of insets) expect(v).toBeCloseTo(insets[0], 5);
  });

  it("custom labels bypass the content ladder", async () => {
    const doc = asDoc(
      await WireframeV2.render(
        { M0String: "2(1,1)", labels: ["hello", "world"], labelContent: "aspect" },
        bigCtx(),
      ),
    );
    // Both tiles render (border + custom label glyphs).
    expect(doc.sources).toHaveLength(2);
    for (const src of doc.sources) {
      const path = ((src as MosaicLavfiSource).mask as { localPath: string }).localPath;
      expect(path.length).toBeGreaterThan(0);
    }
  });

  // ── Overlay obstruction: a tile whose label is covered by a higher-z tile
  //    (an overlay) suppresses that label, so it doesn't bleed through. ──
  const mCount = (src: MosaicLavfiSource): number =>
    (((src.mask as { localPath: string }).localPath ?? "").match(/M/g) ?? []).length;

  it("suppresses a base tile's label when an overlay covers it", async () => {
    // 3(0{2[1,-{2(1,1)}]},1,1): the `0{…}` passthrough donates forward into the
    // first `1` (tile 4, 720×720) and the overlay (tiles 1/2/3) paints over its
    // left half — covering tile 4's centered label. Sources are pushed in
    // logical order, so index 3 == tile 4 (the obstructed base).
    const doc = asDoc(
      await WireframeV2.render(
        { M0String: "3(0{2[1,-{2(1,1)}]},1,1)" },
        makeCtx({ width: 1080, height: 720 }),
      ),
    );
    expect(doc.sources).toHaveLength(5);
    // Tile 4 (the covered base): border ring only, no glyphs (exactly 2 "M").
    expect(mCount(doc.sources[3] as MosaicLavfiSource)).toBe(2);
    // The overlay tiles on top (1/2/3) and the unobstructed tile 5 keep labels.
    for (const idx of [0, 1, 2, 4]) {
      expect(mCount(doc.sources[idx] as MosaicLavfiSource)).toBeGreaterThan(2);
    }
  });

  it("does not suppress labels in an overlap-free partition", async () => {
    // No overlays ⇒ tiles never overlap ⇒ every label is drawn.
    const doc = asDoc(
      await WireframeV2.render({ M0String: "4(1,1,1,1)" }, makeCtx({ width: 1600, height: 400 })),
    );
    expect(doc.sources).toHaveLength(4);
    for (const src of doc.sources) {
      expect(mCount(src as MosaicLavfiSource)).toBeGreaterThan(2);
    }
  });

  it('background: "transparent" leaves the doc without a backgroundColor', async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "2(1,1)", background: "transparent" }, makeCtx()));
    expect(doc.backgroundColor).toBeUndefined();
  });

  it("debug background defaults to an opaque WHITE canvas (gate 29 take 4)", async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "2(1,1)" }, makeCtx()));
    expect(String(doc.backgroundColor)).toMatch(/^#ffffff/i);
  });

  it('background: "white" bakes an opaque white canvas', async () => {
    const doc = asDoc(
      await WireframeV2.render({ M0String: "2(1,1)", background: "white" }, makeCtx()),
    );
    expect(doc.backgroundColor).toBeDefined();
  });

  it("no backgroundImage on the doc by default", async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "2(1,1)" }, makeCtx()));
    expect(doc.backgroundImage).toBeUndefined();
    expect(Object.keys(doc.assets ?? {})).toHaveLength(0);
  });

  it("backgroundImage registers a file asset and points the doc at it", async () => {
    const doc = asDoc(
      await WireframeV2.render(
        { M0String: "2(1,1)", backgroundImage: "/abs/ref.png" },
        makeCtx(),
      ),
    );
    expect(doc.backgroundImage).toBeDefined();
    const assetId = doc.backgroundImage!.assetId;
    const asset = (doc.assets ?? {})[assetId];
    expect(asset).toMatchObject({ kind: "file", path: "/abs/ref.png", mediaType: "image" });
    // defaults: no opacity/fit emitted (engine applies its own defaults)
    expect(doc.backgroundImage!.opacity).toBeUndefined();
    expect(doc.backgroundImage!.fit).toBeUndefined();
  });

  it("backgroundImage accepts an inline data: URI as a data-uri asset", async () => {
    const uri = "data:image/png;base64,AAAA";
    const doc = asDoc(
      await WireframeV2.render(
        { M0String: "2(1,1)", backgroundImage: uri },
        makeCtx(),
      ),
    );
    const assetId = doc.backgroundImage!.assetId;
    expect((doc.assets ?? {})[assetId]).toMatchObject({
      kind: "data-uri",
      uri,
      mediaType: "image",
    });
  });

  it("backgroundImage carries opacity and fit through", async () => {
    const doc = asDoc(
      await WireframeV2.render(
        {
          M0String: "2(1,1)",
          backgroundImage: "/abs/ref.png",
          backgroundImageOpacity: 0.3,
          backgroundImageFit: "contain",
        },
        makeCtx(),
      ),
    );
    expect(doc.backgroundImage).toMatchObject({ opacity: 0.3, fit: "contain" });
  });

  it("fill prop sets a matte on the debug tile mask (translucent rect wash)", async () => {
    const doc = asDoc(
      await WireframeV2.render({ M0String: "2(1,1)", fill: 0.22 }, makeCtx()),
    );
    for (const s of doc.sources) {
      const mask = (s as MosaicLavfiSource).mask;
      expect(mask?.kind).toBe("inline-mask");
      expect((mask as { matte?: number }).matte).toBeCloseTo(0.22);
    }
  });

  it("no fill prop leaves the tile body transparent (no matte)", async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "2(1,1)" }, makeCtx()));
    for (const s of doc.sources) {
      const mask = (s as MosaicLavfiSource).mask;
      expect((mask as { matte?: number }).matte).toBeUndefined();
    }
  });

  it("keeps a hero's label when a corner overlay misses the label rows", async () => {
    // 1{4(4[1,-,-,-],-,-,-)}: a 1200×800 hero with a 300×200 overlay in the
    // top-left corner. The overlay clips the empty corner of the label's
    // bounding box but never a glyph ROW — per-line testing must keep the label.
    const doc = asDoc(
      await WireframeV2.render(
        { M0String: "1{4(4[1,-,-,-],-,-,-)}" },
        makeCtx({ width: 1200, height: 800 }),
      ),
    );
    expect(doc.sources).toHaveLength(2);
    // Hero (sources[0]) keeps its label; the corner overlay (sources[1]) too.
    expect(mCount(doc.sources[0] as MosaicLavfiSource)).toBeGreaterThan(2);
    expect(mCount(doc.sources[1] as MosaicLavfiSource)).toBeGreaterThan(2);
  });
});

describe("WireframeV2 — prop bindings (Make inline edit)", () => {
  const schema = WireframeV2.propsSchema;
  const bindingsOf = async (props: Parameters<typeof WireframeV2.render>[0]) => {
    const doc = asDoc(await WireframeV2.render(props, makeCtx()));
    return { doc, ...resolvePropBindings(doc, 1920, 1080, { propsSchema: schema }) };
  };

  it("debug cells bind labels[i] index-aligned with source order (root), with or without custom labels", async () => {
    const r = await bindingsOf({ M0String: "2(1,1)", labels: ["hello", "world"] });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp)).toEqual(["labels"]);
    expect(r.byProp.labels.map((b) => b.index)).toEqual([0, 1]);
    expect(r.byProp.labels.map((b) => b.sourceIndex)).toEqual([0, 1]);
    for (const b of r.byProp.labels) expect(b.childPath).toEqual([]);
    // no labels yet → the cells are still handles to ADD one
    const none = await bindingsOf({ M0String: "2(1,1)" });
    expect(none.rejected).toEqual([]);
    expect(none.byProp.labels.map((b) => b.index)).toEqual([0, 1]);
  });

  it("null tiles consume no index: 3(1,-,1) binds labels 0..1 on its two painted cells", async () => {
    const r = await bindingsOf({ M0String: "3(1,-,1)", labels: ["a", "b"] });
    expect(r.rejected).toEqual([]);
    expect(r.doc.sources).toHaveLength(2);
    expect(r.byProp.labels.map((b) => b.index)).toEqual([0, 1]);
    expect(new Set(r.byProp.labels.map((b) => b.stableKey)).size).toBe(2);
  });

  it("nested/overlay layouts: one binding per painted cell, in composite numbering order", async () => {
    const r = await bindingsOf({ M0String: "3(0{2[1,-{2(1,1)}]},1,1)" });
    expect(r.rejected).toEqual([]);
    const n = r.doc.sources.length;
    expect(n).toBeGreaterThan(2);
    expect(r.byProp.labels.map((b) => b.index)).toEqual([...Array(n).keys()]);
    expect(r.byProp.labels.map((b) => b.sourceIndex)).toEqual([...Array(n).keys()]);
  });

  it("heat cells (cellColors) stay bound at the root — nested heat+label child and flat heat tile alike", async () => {
    const r = await bindingsOf({ M0String: "2(1,1)", cellColors: ["#ff0000", "#00ff00"], labels: ["a", ""] });
    expect(r.rejected).toEqual([]);
    expect(r.doc.sources[0].type).toBe("mosaic");
    expect(r.doc.sources[1].type).toBe("lavfi");
    expect(r.byProp.labels.map((b) => [b.index, b.sourceIndex, b.childPath])).toEqual([
      [0, 0, []],
      [1, 1, []],
    ]);
  });

  it("thumb tiles carry no labels → unbound; the layer explode (dev pipeline) is not a bound surface", async () => {
    const thumb = await bindingsOf({ M0String: "2(1,1)", preset: "thumb-dark", labels: ["a", "b"] });
    expect(thumb.byProp).toEqual({});
    const pipe = await WireframeV2.render({ M0String: "3(1,-,1)", nullFrames: "show", labels: ["a", "b"] }, makeCtx());
    expect(pipe.kind).toBe("mosaic_pipeline");
    for (const step of (pipe as { steps: Array<{ file: MosaicDocument }> }).steps) {
      expect(resolvePropBindings(step.file, 1920, 1080, { propsSchema: schema }).byProp).toEqual({});
    }
  });
});

// ── Unlabeled cells: labeling SOME frames keeps the debug marks on the rest ──
describe("WireframeV2 — unlabeledCells", () => {
  const bigCtx = () => makeCtx({ width: 1920, height: 1080 });
  const ringOnly = 2; // border ring = exactly two "M" moves; any glyph adds more
  const mCountOf = (doc: MosaicDocument, i: number): number =>
    ((((doc.sources[i] as MosaicLavfiSource).mask as { localPath: string }).localPath ?? "").match(/M/g) ?? []).length;

  it("default: a labeled cell shows its label, unlabeled cells keep number / dims", async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "2(1,1)", labels: ["hello"] }, bigCtx()));
    expect(doc.sources).toHaveLength(2);
    expect(mCountOf(doc, 0)).toBeGreaterThan(ringOnly); // "hello"
    expect(mCountOf(doc, 1)).toBeGreaterThan(ringOnly); // "2" + "960 × 540" marks
    // byte-identical to the same cell rendered with NO labels at all
    const bare = asDoc(await WireframeV2.render({ M0String: "2(1,1)" }, bigCtx()));
    expect((doc.sources[1] as MosaicLavfiSource).mask).toEqual((bare.sources[1] as MosaicLavfiSource).mask);
    // a blank label entry counts as "no label" too
    const blank = asDoc(await WireframeV2.render({ M0String: "2(1,1)", labels: ["hello", "  "] }, bigCtx()));
    expect((blank.sources[1] as MosaicLavfiSource).mask).toEqual((bare.sources[1] as MosaicLavfiSource).mask);
  });

  it('"empty" opts back into blank unlabeled cells (labels are the only text)', async () => {
    const doc = asDoc(
      await WireframeV2.render({ M0String: "2(1,1)", labels: ["hello"], unlabeledCells: "empty" }, bigCtx()),
    );
    expect(mCountOf(doc, 0)).toBeGreaterThan(ringOnly);
    expect(mCountOf(doc, 1)).toBe(ringOnly);
    // with no labels at all, "empty" changes nothing — marks stay
    const none = asDoc(await WireframeV2.render({ M0String: "2(1,1)", unlabeledCells: "empty" }, bigCtx()));
    expect(mCountOf(none, 1)).toBeGreaterThan(ringOnly);
  });

  it("the layer-explode stills follow the same rule", async () => {
    const pipe = (await WireframeV2.render(
      { M0String: "2(1,1)", labels: ["hello"], nullFrames: "show" },
      bigCtx(),
    )) as { kind: string; steps?: Array<{ file?: MosaicDocument }> };
    const step0 = pipe.steps?.[0]?.file;
    expect(step0).toBeTruthy();
    expect(mCountOf(step0!, 1)).toBeGreaterThan(ringOnly);
    const pipeEmpty = (await WireframeV2.render(
      { M0String: "2(1,1)", labels: ["hello"], nullFrames: "show", unlabeledCells: "empty" },
      bigCtx(),
    )) as { steps?: Array<{ file?: MosaicDocument }> };
    expect(mCountOf(pipeEmpty.steps![0].file!, 1)).toBe(ringOnly);
  });
});
