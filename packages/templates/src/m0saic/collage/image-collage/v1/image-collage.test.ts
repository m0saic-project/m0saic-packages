import type { MosaicDocument, MosaicEngineContext, MosaicMediaMetadata } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { DEMO_IMAGES } from "./demo-fixture";
import { ImageCollage } from "./image-collage";

const ctxFor = (
  w: number,
  h: number,
  media: Record<string, Partial<MosaicMediaMetadata>> = {},
): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs: 2000 };
  return {
    mode: "render",
    target: t,
    output: { ...t, workspaceDir: "/tmp/image-collage-test" },
    media,
  } as unknown as MosaicEngineContext;
};

const isErrorMosaic = (doc: MosaicDocument): boolean =>
  (doc.sources?.[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus === "error";

const IMG = (width: number, height: number): Partial<MosaicMediaMetadata> => ({ kind: "image", width, height });

describe("@m0saic/collage/image-collage/v1 — template shell", () => {
  it("metadata: id, PNG output, envelope adoption via debugLayout in the schema", () => {
    expect(String(ImageCollage.id)).toBe("@m0saic/collage/image-collage/v1");
    expect(ImageCollage.version).toBe(1);
    expect(ImageCollage.outputHints?.format).toEqual({ kind: "image", container: "png" });
    expect("debugLayout" in (ImageCollage.propsSchema ?? {})).toBe(true);
    expect(ImageCollage.defaultProps?.debugLayout).toBe(false);
    expect(ImageCollage.internal).toBeUndefined(); // curated, unlike the mock
  });

  it("schema UX: images/max-per-sheet/seed required with tuned defaults; fractional knobs are bounded sliders", () => {
    const schema = (ImageCollage.propsSchema ?? {}) as Record<string, {
      required?: boolean;
      meta?: { control?: { flavor?: string }; constraints?: { min?: number; max?: number } };
    }>;
    expect(schema.sourceIds?.required).toBe(true);
    expect(schema.maxImagesPerSheet?.required).toBe(true);
    expect(schema.seed?.required).toBe(true);
    expect(ImageCollage.defaultProps?.maxImagesPerSheet).toBe(30);
    expect(ImageCollage.defaultProps?.seed).toBe(1);
    // The values that used to blow the template out on a fat-fingered "2" are
    // now sliders with finite ranges — no free-form entry.
    for (const k of ["gutter", "margin", "cropBudget"] as const) {
      expect(schema[k]?.meta?.control?.flavor).toBe("slider");
      expect(typeof schema[k]?.meta?.constraints?.min).toBe("number");
      expect(typeof schema[k]?.meta?.constraints?.max).toBe("number");
    }
  });

  it("demo mode: no sourceIds packs the deterministic demo set", async () => {
    const doc = (await ImageCollage.render({}, ctxFor(1920, 1080))) as MosaicDocument;
    expect(isErrorMosaic(doc)).toBe(false);
    expect(doc.sources.length).toBe(DEMO_IMAGES.length);
    const labels = doc.sources
      .map((s) => (s as { editor?: { label?: string } }).editor?.label)
      .filter((l): l is string => !!l)
      .sort();
    expect(labels).toEqual(DEMO_IMAGES.map((_, i) => `img:${i}`).sort());
    expect(doc.backgroundColor).toBe("#101014");
    expect(doc.size).toEqual({ width: 1920, height: 1080 });
    expect(String(doc.m0).length).toBeLessThan(1000); // ratio m0, not a pixel bake
  });

  it("demo render is byte-deterministic", async () => {
    const a = await ImageCollage.render({ seed: 7 }, ctxFor(1920, 1080));
    const b = await ImageCollage.render({ seed: 7 }, ctxFor(1920, 1080));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("debugLayout: off → no stamp; on → verified contract stamp + backfilled labels", async () => {
    const off = (await ImageCollage.render({}, ctxFor(1920, 1080))) as MosaicDocument;
    expect(off.editor?.layoutContract).toBeUndefined();
    const on = (await ImageCollage.render({ debugLayout: true }, ctxFor(1920, 1080))) as MosaicDocument;
    const stamp = on.editor?.layoutContract;
    expect(stamp?.ok).toBe(true);
    expect(stamp?.violations).toEqual([]);
    // per-image aspects + lattice + coverage + equal-size classes all checked
    expect(stamp?.constraintCount).toBeGreaterThanOrEqual(DEMO_IMAGES.length + 2);
    // Since e5e70287 debug-on SHOWS the contract (the green wireframe with a
    // banner per rule) rather than the sheet itself; the crop labels live on
    // the real render (debug off).
    expect(Object.keys((off as { labels?: Record<string, string> }).labels ?? {}).length).toBe(DEMO_IMAGES.length);
  });

  it("the contract holds across canvases (regenerated per canvas — the whole point)", async () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080], [800, 600]] as const) {
      const doc = (await ImageCollage.render({ debugLayout: true }, ctxFor(w, h))) as MosaicDocument;
      expect(isErrorMosaic(doc)).toBe(false);
      expect(doc.editor?.layoutContract?.ok).toBe(true);
    }
  });

  it("media mode: probed images become cover media sources with a minted asset manifest", async () => {
    const media = {
      "/photos/a landscape.jpg": IMG(4000, 3000),
      "/photos/b-portrait.png": IMG(2000, 3000),
      "/photos/c_pano.jpg": IMG(6000, 2000),
    };
    const ids = Object.keys(media);
    const doc = (await ImageCollage.render(
      { sourceIds: ids, debugLayout: false, minCellPx: 200, maxCellPx: 900 },
      ctxFor(1920, 1080, media),
    )) as MosaicDocument;
    expect(isErrorMosaic(doc)).toBe(false);
    expect(doc.editor?.layoutContract).toBeUndefined(); // debug off → the sheet itself, no stamp
    expect(doc.sources.length).toBe(3);
    for (const s of doc.sources) {
      const src = s as { type: string; mediaType?: string; assetId?: string; placement?: { fit?: string } };
      expect(src.type).toBe("media");
      expect(src.mediaType).toBe("image");
      expect(src.placement?.fit).toBe("cover");
      expect(doc.assets[src.assetId as keyof typeof doc.assets]).toBeDefined();
    }
    expect(Object.keys(doc.assets).length).toBe(3);
  });

  it("fail-fast: unprobed input → error mosaic naming it", async () => {
    const doc = (await ImageCollage.render(
      { sourceIds: ["/photos/ghost.jpg"] },
      ctxFor(1920, 1080),
    )) as MosaicDocument;
    expect(isErrorMosaic(doc)).toBe(true);
  });

  it("fail-fast: non-image input → error mosaic", async () => {
    const doc = (await ImageCollage.render(
      { sourceIds: ["/video/clip.mp4"] },
      ctxFor(1920, 1080, { "/video/clip.mp4": { kind: "video", width: 1920, height: 1080 } }),
    )) as MosaicDocument;
    expect(isErrorMosaic(doc)).toBe(true);
  });

  it("fail-fast: explicit margin beyond the gutter → error mosaic", async () => {
    const doc = (await ImageCollage.render(
      { gutterPx: 10, marginPx: 40 },
      ctxFor(1920, 1080),
    )) as MosaicDocument;
    expect(isErrorMosaic(doc)).toBe(true);
  });

  it("fail-fast: impossible cell bounds → error mosaic pointing at paging", async () => {
    const doc = (await ImageCollage.render(
      { minCellPx: 1500, maxCellPx: 1600 },
      ctxFor(800, 600),
    )) as MosaicDocument;
    expect(isErrorMosaic(doc)).toBe(true);
  });

  it("flush collage: gutter 0 / margin 0 renders and holds its contract", async () => {
    const doc = (await ImageCollage.render(
      { gutterPx: 0, marginPx: 0, debugLayout: true },
      ctxFor(1920, 1080),
    )) as MosaicDocument;
    expect(isErrorMosaic(doc)).toBe(false);
    expect(doc.editor?.layoutContract?.ok).toBe(true);
  });

  it("margin ratio: fraction of the gutter, clamped to [0,1], drives the outer border", async () => {
    const flush = await ImageCollage.render({ margin: 0 }, ctxFor(1920, 1080));
    const full = await ImageCollage.render({ margin: 1 }, ctxFor(1920, 1080));
    const over = await ImageCollage.render({ margin: 5 }, ctxFor(1920, 1080));
    expect(isErrorMosaic(flush as MosaicDocument)).toBe(false);
    // margin 0 (flush to edge) vs 1 (margin = gutter) change the geometry …
    expect(JSON.stringify(flush)).not.toBe(JSON.stringify(full));
    // … and an out-of-range value clamps to 1 (identical to margin: 1).
    expect(JSON.stringify(over)).toBe(JSON.stringify(full));
  });

  it("seed changes the taste, not the guarantees", async () => {
    const docs = await Promise.all(
      [1, 2, 3].map((seed) => ImageCollage.render({ seed, debugLayout: true }, ctxFor(1920, 1080))),
    );
    for (const d of docs) expect((d as MosaicDocument).editor?.layoutContract?.ok).toBe(true);
  });

  it("crop accounting is surfaced: doc.labels per image + a page summary on the editor label", async () => {
    const doc = (await ImageCollage.render({}, ctxFor(1920, 1080))) as MosaicDocument;
    expect(doc.editor?.label).toMatch(/Image Collage · 12 images · mean crop \d+(\.\d+)?%/);
    const labels = Object.values((doc as { labels?: Record<string, string> }).labels ?? {});
    expect(labels.length).toBe(DEMO_IMAGES.length);
    for (const l of labels) expect(l).toMatch(/^img:\d+ · \dx\d · crop \d+%$/);
    // The enriched labels survive the debugLayout backfill (backfill fills, never clobbers).
    const dbg = (await ImageCollage.render({ debugLayout: true }, ctxFor(1920, 1080))) as MosaicDocument;
    for (const l of Object.values((dbg as { labels?: Record<string, string> }).labels ?? {}))
      expect(l).toMatch(/crop \d+%/);
  });

  it("paging: maxImagesPerSheet returns an emit:multi pipeline of contract-clean pages", async () => {
    // The sheets themselves (debug off) — shape, labels, sizes.
    const out = await ImageCollage.render({ maxImagesPerSheet: 5 }, ctxFor(1920, 1080));
    expect(out.kind).toBe("mosaic_pipeline");
    const pipe = out as unknown as { emit?: string; steps: Array<{ name?: string; durationMs: number; file: MosaicDocument }> };
    expect(pipe.emit).toBe("multi");
    expect(pipe.steps.map((s) => s.name)).toEqual(["page_01", "page_02", "page_03"]);
    // Global label continuity: every image lands exactly once across the set.
    const labels = pipe.steps
      .flatMap((s) => s.file.sources.map((x) => (x as { editor?: { label?: string } }).editor?.label))
      .filter((l): l is string => !!l)
      .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
    expect(labels).toEqual(DEMO_IMAGES.map((_, i) => `img:${i}`));
    for (const s of pipe.steps) {
      expect(s.file.editor?.layoutContract).toBeUndefined();
      expect(s.file.editor?.label).toMatch(/page \d\/3/);
      expect(s.file.size).toEqual({ width: 1920, height: 1080 });
    }
    // Debug on SHOWS each page's contract (green wireframe) — every page clean.
    const dbg = (await ImageCollage.render({ maxImagesPerSheet: 5, debugLayout: true }, ctxFor(1920, 1080))) as unknown as {
      steps: Array<{ file: MosaicDocument }>;
    };
    expect(dbg.steps).toHaveLength(3);
    for (const s of dbg.steps) expect(s.file.editor?.layoutContract?.ok).toBe(true);
  });

  it("paging: pageLattice knob — uniform shares a lattice, independent still covers", async () => {
    const uniform = (await ImageCollage.render({ maxImagesPerSheet: 5 }, ctxFor(1920, 1080))) as unknown as {
      steps: Array<{ file: MosaicDocument }>;
    };
    const m0Basis = (d: MosaicDocument) => String(d.m0).match(/^\d+[[(]/)?.[0];
    const bases = new Set(uniform.steps.map((s) => m0Basis(s.file)));
    expect(bases.size).toBe(1); // same lattice → same top-level split shape
    const independent = await ImageCollage.render(
      { maxImagesPerSheet: 5, pageLattice: "independent", debugLayout: true },
      ctxFor(1920, 1080),
    );
    expect(independent.kind).toBe("mosaic_pipeline");
  });

  it("paging: pipeline renders are deterministic", async () => {
    const a = await ImageCollage.render({ maxImagesPerSheet: 5, seed: 4 }, ctxFor(1920, 1080));
    const b = await ImageCollage.render({ maxImagesPerSheet: 5, seed: 4 }, ctxFor(1920, 1080));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("paging: page assets are scoped to that page's images", async () => {
    const media = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`/p/img-${i}.jpg`, IMG(1200 + i * 100, 900)]),
    );
    const out = await ImageCollage.render(
      { sourceIds: Object.keys(media), maxImagesPerSheet: 3, minCellPx: 200 },
      ctxFor(1920, 1080, media),
    );
    expect(out.kind).toBe("mosaic_pipeline");
    const pipe = out as unknown as { steps: Array<{ file: MosaicDocument }> };
    expect(pipe.steps.length).toBe(2);
    for (const s of pipe.steps) expect(Object.keys(s.file.assets).length).toBe(3);
    const allKeys = pipe.steps.flatMap((s) => Object.keys(s.file.assets)).sort();
    expect(new Set(allKeys).size).toBe(6);
  });

  it("small sets at DEFAULT cell bounds render (the taste bound yields to count)", async () => {
    const media = { "/a.jpg": IMG(3000, 2000), "/b.jpg": IMG(2000, 3000) };
    const doc = (await ImageCollage.render(
      { sourceIds: Object.keys(media), debugLayout: true },
      ctxFor(1600, 900, media),
    )) as MosaicDocument;
    expect(isErrorMosaic(doc)).toBe(false);
    expect(doc.editor?.layoutContract?.ok).toBe(true);
  });

  it("ctx.media is keyed by the RAW sourceId string (screencap convention)", async () => {
    const raw = "/some dir/with spaces/photo (1).jpg";
    const doc = (await ImageCollage.render(
      { sourceIds: [raw], minCellPx: 200, maxCellPx: 2000 },
      ctxFor(1200, 800, { [String(asAssetId(raw))]: IMG(3000, 2000) }),
    )) as MosaicDocument;
    expect(isErrorMosaic(doc)).toBe(false);
    // The OUTGOING asset key is a safe slug, not the raw path.
    const assetKey = Object.keys(doc.assets)[0];
    expect(assetKey).not.toContain(" ");
    expect((doc.assets as Record<string, { path?: string }>)[assetKey].path).toBe(raw);
  });
});
