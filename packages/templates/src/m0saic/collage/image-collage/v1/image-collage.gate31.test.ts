/**
 * Gate-31 (v1 prod cut) locks for `@m0saic/collage/image-collage/v1`:
 * the format stamp on every page doc, the user-facing description, and the
 * defaults the Make form opens on.
 */
import type { MosaicDocument, MosaicDocumentPipeline, MosaicEngineContext } from "@m0saic/types";
import { ImageCollage } from "./image-collage";

function ctxFor(width: number, height: number): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs: 1000 },
    output: { width, height, fps: 30, durationMs: 1000, workspaceDir: "/tmp" },
    media: {},
  } as unknown as MosaicEngineContext;
}

describe("ImageCollage — gate 31", () => {
  it("declares the image/png format on the sheet (gate-26 convention)", async () => {
    const doc = (await ImageCollage.render({}, ctxFor(1920, 1080))) as MosaicDocument;
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.format).toEqual({ kind: "image", container: "png" });
    expect(ImageCollage.outputHints?.format).toEqual({ kind: "image", container: "png" });
  });

  it("stamps the format on EVERY page of a paged set", async () => {
    const pipe = (await ImageCollage.render({ maxImagesPerSheet: 5 }, ctxFor(1920, 1080))) as MosaicDocumentPipeline;
    expect(pipe.kind).toBe("mosaic_pipeline");
    expect(pipe.emit).toBe("multi");
    expect(pipe.steps.length).toBeGreaterThan(1);
    for (const st of pipe.steps) {
      expect((st.file as MosaicDocument).format).toEqual({ kind: "image", container: "png" });
    }
  });

  it("reads as a user-facing blurb, not engineering-speak", () => {
    expect(ImageCollage.description).toMatch(/^Packs any set of photos/);
    expect(ImageCollage.description).not.toMatch(/layout contract|lattice/);
  });

  it("declares no cover (the demo set IS the default face) but DOES declare the tutorial (take 2)", () => {
    expect(ImageCollage.renderCover).toBeUndefined();
    expect(typeof ImageCollage.renderTutorial).toBe("function");
  });

  describe("tutorial (take 2 — founder: pick images or a folder, keep it simple)", () => {
    const designCtx = (w: number, h: number): MosaicEngineContext =>
      ({ ...ctxFor(w, h), mode: "design" }) as unknown as MosaicEngineContext;
    const asPipe = (f: unknown) => f as MosaicDocumentPipeline;

    it("is a three-beat pipeline with its own step timing (~13s), no emit:multi", async () => {
      const pipe = asPipe(await ImageCollage.renderTutorial!({} as never, designCtx(1920, 1080)));
      expect(pipe.kind).toBe("mosaic_pipeline");
      expect(pipe.emit).toBeUndefined();
      expect(pipe.steps.map((s) => s.name)).toEqual(["pick", "render", "pages"]);
      for (const s of pipe.steps) expect(s.durationMs).toBeGreaterThan(3000);
      expect(pipe.durationMs).toBe(pipe.steps.reduce((a, s) => a + s.durationMs, 0));
    });

    it("every beat is a full-canvas doc; the render beat inlines a live demo solve (12 tiles with inset gutters)", async () => {
      const pipe = asPipe(await ImageCollage.renderTutorial!({} as never, designCtx(1920, 1080)));
      for (const s of pipe.steps) {
        const d = s.file as MosaicDocument;
        expect(d.size).toEqual({ width: 1920, height: 1080 });
        expect(d.sources.length).toBeGreaterThan(5);
      }
      const render = pipe.steps[1].file as MosaicDocument;
      const tiles = render.sources.filter((src) => /tutorial img:\d+/.test((src as { editor?: { label?: string } }).editor?.label ?? ""));
      expect(tiles).toHaveLength(12);
      for (const t of tiles) expect((t as { placement?: { inset?: unknown } }).placement?.inset).toBeDefined();
      const pages = pipe.steps[2].file as MosaicDocument;
      const pageTiles = pages.sources.filter((src) => /tutorial img:\d+/.test((src as { editor?: { label?: string } }).editor?.label ?? ""));
      expect(pageTiles).toHaveLength(12); // 6 + 6 across the two page cards
    });

    it("is deterministic and media-free, and adapts to a portrait canvas", async () => {
      const a = JSON.stringify(await ImageCollage.renderTutorial!({} as never, designCtx(1920, 1080)));
      const b = JSON.stringify(await ImageCollage.renderTutorial!({} as never, designCtx(1920, 1080)));
      expect(a).toBe(b);
      expect(a).not.toMatch(/"type":"media"/);
      const portrait = asPipe(await ImageCollage.renderTutorial!({} as never, designCtx(1080, 1920)));
      expect(portrait.steps).toHaveLength(3);
      expect((portrait.steps[1].file as MosaicDocument).size).toEqual({ width: 1080, height: 1920 });
    });
  });
});
