/**
 * Gate-29 (v1 prod cut) locks for `@m0saic/wireframe/base/v2`:
 * the format stamp, the paper-grid lattice (a preset that advertised a grid
 * nothing drew), m0 verbatim when it is off, no cover (dev template), and the
 * explicit grid-default props.
 */
import { isValidM0String } from "@m0saic/dsl";
import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicRenderableFile,
} from "@m0saic/types";
import { WireframeV2 } from "./wireframe";

function makeCtx(W = 1920, H = 1080): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs: 1000 },
    output: { width: W, height: H, fps: 30, durationMs: 1000, workspaceDir: "/tmp" },
    media: {},
  } as unknown as MosaicEngineContext;
}

function asDoc(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

describe("WireframeV2 — gate 29", () => {
  it("declares the image/png rgba format on the doc (gate-26 convention)", async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "F" }, makeCtx()));
    expect(doc.format).toEqual({ kind: "image", container: "png", pixelFormat: "rgba" });
  });

  it("keeps the caller's m0 VERBATIM when no paper grid is requested", async () => {
    const doc = asDoc(
      await WireframeV2.render({ M0String: "2(1,1){2[-,1]}", preset: "thumb-dark" }, makeCtx()),
    );
    expect(doc.m0).toBe("2(1,1){2[-,1]}");
    expect(doc.sources).toHaveLength(3);
  });

  it("grid-paper preset draws the lattice: one extra TOP-overlay source, translucent", async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "2(1,1)", preset: "grid-paper" }, makeCtx()));
    expect(doc.m0).toBe("2(1,1){1}");
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    expect(doc.sources).toHaveLength(3);
    const lattice = doc.sources[2] as MosaicLavfiSource;
    expect(lattice.type).toBe("lavfi");
    expect(lattice.mask?.kind).toBe("inline-mask");
    expect(lattice.overlay?.alpha).toBe("0.08");
    // thumb tiles stay flat colour tiles (no masks)
    expect((doc.sources[0] as MosaicLavfiSource).mask).toBeUndefined();
  });

  it("theme.paperGrid enables the lattice in debug mode and nests past a root overlay", async () => {
    const doc = asDoc(
      await WireframeV2.render(
        {
          M0String: "2(1,1){2[-,1]}",
          theme: { paperGrid: { enabled: true, stepFrac: 0.1, alpha: 0.3 } },
        },
        makeCtx(),
      ),
    );
    expect(doc.m0).toBe("2(1,1){2[-,1]{1}}");
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    expect(doc.sources).toHaveLength(4);
    expect((doc.sources[3] as MosaicLavfiSource).overlay?.alpha).toBe("0.3");
  });

  it("declares NO cover (founder ruling, take 3: dev template — the grid default is the face)", () => {
    expect(WireframeV2.renderCover).toBeUndefined();
  });
});

describe("WireframeV2 — explicit debug defaults (gate 29 take 2)", () => {
  it("defaultProps spell out the shipped debug style so the editor form reads it", () => {
    expect(WireframeV2.defaultProps).toEqual({
      M0String: "2(2[1,1],2[1,1])",
      mode: "debug",
      labelContent: "dimensions",
      labelOverflow: "degrade",
      unlabeledCells: "marks",
      background: "white",
      nullFrames: "hide",
      nullLabel: "null",
      fill: 0,
      backgroundImageFit: "cover", // the engine's background-image default, now visible
      preset: "none", // the visible unset state of the preset picker (default-props contract, 2026-09-05)
    });
  });

  it("renders byte-identical to the implicit defaults", async () => {
    const explicit = asDoc(await WireframeV2.render({ ...WireframeV2.defaultProps! } as never, makeCtx()));
    const implicit = asDoc(await WireframeV2.render({ M0String: "2(2[1,1],2[1,1])" }, makeCtx()));
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(implicit));
  });

  it("a chosen preset still decides thumb-vs-debug over the default mode", async () => {
    const thumb = asDoc(
      await WireframeV2.render(
        { ...WireframeV2.defaultProps!, M0String: "2(1,1)", preset: "thumb-dark" } as never,
        makeCtx(),
      ),
    );
    for (const src of thumb.sources) {
      expect((src as MosaicLavfiSource).mask).toBeUndefined(); // flat colour tiles, no glyph masks
    }
    const contrast = asDoc(
      await WireframeV2.render(
        { ...WireframeV2.defaultProps!, M0String: "2(1,1)", preset: "debug-contrast" } as never,
        makeCtx(),
      ),
    );
    expect((contrast.sources[0] as MosaicLavfiSource).mask?.kind).toBe("inline-mask");
  });

  it("mode alone (no preset) still switches: thumb → flat tiles", async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "2(1,1)", mode: "thumb" }, makeCtx()));
    expect((doc.sources[0] as MosaicLavfiSource).mask).toBeUndefined();
  });
});

describe("WireframeV2 — nullFrames = LAYER EXPLODE (dev diagram piece 1, take 2)", () => {
  const asPipe = (f: MosaicRenderableFile): MosaicDocumentPipeline => {
    expect(f.kind).toBe("mosaic_pipeline");
    return f as MosaicDocumentPipeline;
  };
  const alphaOf = (src: unknown) => (src as MosaicLavfiSource).overlay?.alpha;

  it("hide (default) renders the single composite and skips null tiles — byte-identical to before", async () => {
    const doc = asDoc(await WireframeV2.render({ M0String: "3(1,-,1)" }, makeCtx()));
    expect(doc.m0).toBe("3(1,-,1)");
    expect(doc.sources).toHaveLength(2);
  });

  it("show returns an emit:multi pipeline with ONE still per overlay depth", async () => {
    const pipe = asPipe(await WireframeV2.render({ M0String: "2(1{2[-,1]},-)", nullFrames: "show" }, makeCtx()));
    expect(pipe.emit).toBe("multi");
    expect(pipe.steps.map((st) => st.name)).toEqual(["layer-0", "layer-1"]);
    expect(pipe.steps.map((st) => st.label)).toEqual(["Layer 0 of 2", "Layer 1 of 2"]);
    for (const st of pipe.steps) {
      const f = st.file as MosaicDocument;
      expect(f.size).toEqual({ width: 1920, height: 1080 });
      expect(f.format).toEqual({ kind: "image", container: "png", pixelFormat: "rgba" });
      expect(String(f.backgroundColor)).toMatch(/^#ffffff/i);
    }
  });

  it("each still swaps only ITS depth's holes to `1`, paints its cells, ghosts the other depths' cells", async () => {
    const pipe = asPipe(await WireframeV2.render({ M0String: "2(1{2[-,1]},-)", nullFrames: "show" }, makeCtx()));
    const [l0, l1] = pipe.steps.map((st) => st.file as MosaicDocument);
    // layer 0: base cell painted, right hole drawn, overlay hole stays `-`, overlay cell is a ghost
    expect(l0.m0).toBe("2(1{2[-,1]},1)");
    expect(l0.sources).toHaveLength(3);
    expect(alphaOf(l0.sources[0])).toBeUndefined(); // base cell (painted)
    expect(alphaOf(l0.sources[1])).toBe("0"); // overlay cell → ghost
    expect(alphaOf(l0.sources[2])).toBe("0.55"); // right hole → null cell
    // layer 1: overlay hole drawn, overlay cell painted, base cell is a ghost, right hole stays `-`
    expect(l1.m0).toBe("2(1{2[1,1]},-)");
    expect(l1.sources).toHaveLength(3);
    expect(alphaOf(l1.sources[0])).toBe("0"); // base → ghost
    expect(alphaOf(l1.sources[1])).toBe("0.55"); // overlay hole
    expect(alphaOf(l1.sources[2])).toBeUndefined(); // overlay cell (painted)
  });

  it('nullLabel "-" draws the m0 token instead of the word (different glyph outlines, same slots)', async () => {
    const word = asPipe(await WireframeV2.render({ M0String: "3(1,-,1)", nullFrames: "show" }, makeCtx()));
    const dash = asPipe(
      await WireframeV2.render({ M0String: "3(1,-,1)", nullFrames: "show", nullLabel: "-" }, makeCtx()),
    );
    const pathOf = (p: MosaicDocumentPipeline) =>
      ((p.steps[0].file as MosaicDocument).sources[1] as MosaicLavfiSource).mask as { localPath: string };
    expect(pathOf(word).localPath.length).toBeGreaterThan(0);
    expect(pathOf(dash).localPath.length).toBeGreaterThan(0);
    expect(pathOf(dash).localPath).not.toBe(pathOf(word).localPath);
    expect((dash.steps[0].file as MosaicDocument).m0).toBe("3(1,1,1)");
  });

  it("a flat layout explodes to a single layer-0 still with its holes drawn", async () => {
    const pipe = asPipe(await WireframeV2.render({ M0String: "3(1,-,1)", nullFrames: "show" }, makeCtx()));
    expect(pipe.steps).toHaveLength(1);
    const f = pipe.steps[0].file as MosaicDocument;
    expect(f.m0).toBe("3(1,1,1)");
    expect(alphaOf(f.sources[1])).toBe("0.55");
  });

  it("paper grid rides layer 0 only; thumb mode paints flat tiles and dashed-ring holes", async () => {
    const pipe = asPipe(
      await WireframeV2.render(
        { M0String: "2(1{2[-,1]},-)", nullFrames: "show", preset: "grid-paper" },
        makeCtx(),
      ),
    );
    const [l0, l1] = pipe.steps.map((st) => st.file as MosaicDocument);
    expect(l0.m0).toBe("2(1{2[-,1]},1){1}");
    expect(l0.sources).toHaveLength(4);
    expect(alphaOf(l0.sources[3])).toBe("0.08"); // lattice
    expect(l1.m0).toBe("2(1{2[1,1]},-)");
    expect((l0.sources[0] as MosaicLavfiSource).mask).toBeUndefined(); // thumb tile, flat
    expect((l0.sources[2] as MosaicLavfiSource).mask?.kind).toBe("inline-mask"); // hole ring
  });
});

