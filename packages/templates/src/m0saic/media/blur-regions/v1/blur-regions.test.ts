import { isValidM0String } from "@m0saic/dsl";
import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaMetadata,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { BlurRegions } from "./blur-regions";
import { IMAGE_STILL_MS } from "./plan";

const CLIP = "/abs/media/hero_1.mp4";
const STILL = "/abs/media/poster.png";

function videoMeta(overrides?: Partial<MosaicMediaMetadata>): MosaicMediaMetadata {
  return {
    kind: "video",
    width: 1280,
    height: 720,
    hasVideo: true,
    hasAudio: true,
    durationMs: 5730,
    fps: 30,
    ...overrides,
  } as MosaicMediaMetadata;
}

function imageMeta(): MosaicMediaMetadata {
  return {
    kind: "image",
    width: 1024,
    height: 1024,
    hasVideo: false,
    hasAudio: false,
  } as MosaicMediaMetadata;
}

function makeCtx(media?: Record<string, MosaicMediaMetadata>): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 2000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 2000 },
    media: Object.fromEntries(
      Object.entries(media ?? {}).map(([k, v]) => [asAssetId(k), v]),
    ),
  } as MosaicEngineContext;
}

const REGIONS = {
  regions: [
    { x: 64, y: 48, w: 240, h: 160 },
    { x: 400, y: 300, w: 200, h: 120 },
  ],
};

function isErrorMosaic(doc: MosaicDocument): boolean {
  const src = doc.sources[0] as Record<string, any> | undefined;
  return src?.type === "text" && src?.engine?.renderStatus === "error";
}

describe("BlurRegions template metadata", () => {
  it("registers the versioned id with core-tier capabilities", () => {
    expect(BlurRegions.id).toBe("@m0saic/media/blur-regions/v1");
    expect(BlurRegions.version).toBe(1);
    expect(BlurRegions.capabilities).toEqual({ tier: "core" });
  });

  it("declares outputHints.format video/mp4 (the frozen 0.2.0 declaration)", () => {
    expect(BlurRegions.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
  });

  it("has deterministic defaults (geometry: real m0 via inset)", () => {
    expect(BlurRegions.defaultProps).toEqual({ mode: "blur", strength: 24, geometry: "inset" });
  });

  it("declares the regions picker with the full draw-tool set", () => {
    const control = BlurRegions.propsSchema?.regions?.meta?.control;
    expect(control?.picker).toBe("regions");
    expect(control?.regions).toEqual({
      max: 50,
      shapes: ["rect", "ellipse", "polygon", "lasso", "brush"],
    });
  });

  it("regions is optional (base case) but pinned primary in the editor", () => {
    expect(BlurRegions.propsSchema?.regions?.required).toBe(false);
    expect(BlurRegions.propsSchema?.regions?.meta?.ui?.primary).toBe(true);
  });

  it("accepts video AND image sources", () => {
    expect(BlurRegions.propsSchema?.sourceId?.meta?.control?.accept).toEqual([
      "video",
      "image",
    ]);
  });
});

describe("BlurRegions render validation (fail-fast error mosaics)", () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, MosaicMediaMetadata>]> = [
    ["missing sourceId", { regions: REGIONS }, {}],
    ["unparsable regions", { sourceId: CLIP, regions: "{bad" }, { [CLIP]: videoMeta() }],
    [
      "bad mode",
      { sourceId: CLIP, regions: REGIONS, mode: "mosaic" },
      { [CLIP]: videoMeta() },
    ],
    [
      "bad geometry",
      { sourceId: CLIP, regions: REGIONS, geometry: "hologram" },
      { [CLIP]: videoMeta() },
    ],
    ["unprobed input", { sourceId: CLIP, regions: REGIONS }, {}],
    [
      "audio input",
      { sourceId: CLIP, regions: REGIONS },
      { [CLIP]: videoMeta({ kind: "audio" as MosaicMediaMetadata["kind"] }) },
    ],
    [
      "video with no probed duration",
      { sourceId: CLIP, regions: REGIONS },
      { [CLIP]: videoMeta({ durationMs: undefined }) },
    ],
    [
      // Privacy posture: a region entirely outside the canvas FAILS the
      // whole render — never silently dropped.
      "region entirely outside the canvas",
      { sourceId: CLIP, regions: { regions: [{ x: 5000, y: 0, w: 100, h: 100 }] } },
      { [CLIP]: videoMeta() },
    ],
  ];

  it.each(cases)("%s → error mosaic document", async (_name, props, media) => {
    const out = (await BlurRegions.render(props as never, makeCtx(media))) as MosaicDocument;
    expect(out.kind).toBe("mosaic_document");
    expect(isErrorMosaic(out)).toBe(true);
  });
});

describe("BlurRegions render happy path", () => {
  const stepDoc = (out: MosaicDocumentPipeline): Record<string, any> =>
    out.steps[0].file as Record<string, any>;

  it("returns a 1-step emit:multi pipeline with probed canvas/duration/fps and REAL region geometry", async () => {
    const out = (await BlurRegions.render(
      { sourceId: CLIP, regions: REGIONS },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;

    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.emit).toBe("multi");
    expect(out.fps).toBe(30);
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0].durationMs).toBe(5730);

    const file = stepDoc(out);
    expect(file.size).toEqual({ width: 1280, height: 720 });
    // Default geometry "inset": base + one CELL per region, no mask.
    expect(file.sources).toHaveLength(3);
    const regions = (file.sources as Record<string, any>[]).filter(
      (s) => s.editor?.label === "blur-regions:region",
    );
    expect(regions).toHaveLength(2);
    expect(regions.map((r) => r.placement?.sourceRect)).toEqual(
      expect.arrayContaining(REGIONS.regions),
    );
    for (const r of regions) {
      expect(r.mask).toBeUndefined();
      expect(r.effects).toEqual({ blur: 24 });
    }
  });

  it('geometry: "mask" keeps the single masked overlay construction', async () => {
    const out = (await BlurRegions.render(
      { sourceId: CLIP, regions: REGIONS, geometry: "mask" },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;
    const file = stepDoc(out);
    expect(file.m0).toBe("1{1}");
    expect(file.sources).toHaveLength(2);
    const overlay = file.sources[1] as Record<string, any>;
    expect(overlay.effects).toEqual({ blur: 24 });
    expect(overlay.mask.kind).toBe("inline-mask");
    expect(overlay.mask.localPath).toBe("M64 48H304V208H64Z M400 300H600V420H400Z");
  });

  it("m0-native regions: leaf cells become the regions (wrapper and bare string)", async () => {
    for (const regions of [{ m0: "1" }, "1"]) {
      const out = (await BlurRegions.render(
        { sourceId: CLIP, regions: regions as never },
        makeCtx({ [CLIP]: videoMeta() }),
      )) as MosaicDocumentPipeline;
      expect(out.kind).toBe("mosaic_pipeline");
      const file = stepDoc(out);
      // "1" = one full-canvas leaf → base + one full-canvas region.
      expect(file.sources).toHaveLength(2);
      const region = (file.sources as Record<string, any>[]).find(
        (s) => s.editor?.label === "blur-regions:region",
      )!;
      expect(region.effects).toEqual({ blur: 24 });
      expect(region.placement?.sourceRect).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    }
  });

  it("rescales regions authored against a different canvas", async () => {
    const out = (await BlurRegions.render(
      {
        sourceId: CLIP,
        geometry: "mask",
        regions: {
          canvas: { w: 2560, h: 1440 },
          regions: [{ x: 1280, y: 720, w: 640, h: 360 }],
        },
      },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;
    const overlay = stepDoc(out).sources[1] as Record<string, any>;
    expect(overlay.mask.localPath).toBe("M640 360H960V540H640Z");
  });

  it("clamps overshoot instead of failing", async () => {
    const out = (await BlurRegions.render(
      {
        sourceId: CLIP,
        geometry: "mask",
        regions: { regions: [{ x: 1200, y: 600, w: 400, h: 400 }] },
      },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;
    expect(out.kind).toBe("mosaic_pipeline");
    const overlay = stepDoc(out).sources[1] as Record<string, any>;
    expect(overlay.mask.localPath).toBe("M1200 600H1280V720H1200Z");
  });

  it("accepts a bare region array and a JSON string (CLI/agent tolerance)", async () => {
    const bare = (await BlurRegions.render(
      { sourceId: CLIP, regions: REGIONS.regions },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;
    expect(bare.kind).toBe("mosaic_pipeline");

    const str = (await BlurRegions.render(
      { sourceId: CLIP, regions: JSON.stringify(REGIONS) },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;
    expect(str).toEqual(bare);
  });

  it("missing/empty regions render the untouched media (drawing base case)", async () => {
    const emptyShapes: unknown[] = [undefined, {}, { regions: [] }, []];
    for (const regions of emptyShapes) {
      const out = (await BlurRegions.render(
        { sourceId: CLIP, ...(regions !== undefined ? { regions } : {}) } as never,
        makeCtx({ [CLIP]: videoMeta() }),
      )) as MosaicDocumentPipeline;
      expect(out.kind).toBe("mosaic_pipeline");
      const file = stepDoc(out);
      expect(file.m0).toBe("1"); // single cell — no overlay layer
      expect(file.sources).toHaveLength(1);
      expect((file.sources[0] as Record<string, any>).mask).toBeUndefined();
      expect(out.steps[0].durationMs).toBe(5730);
    }
  });

  it("image inputs render a single still frame with a matched container", async () => {
    const out = (await BlurRegions.render(
      { sourceId: STILL, regions: { regions: [{ x: 100, y: 100, w: 200, h: 200 }] } },
      makeCtx({ [STILL]: imageMeta() }),
    )) as MosaicDocumentPipeline;
    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.fps).toBeUndefined();
    expect(out.steps[0].durationMs).toBe(IMAGE_STILL_MS);
    const file = stepDoc(out);
    expect(file.size).toEqual({ width: 1024, height: 1024 });
    expect(file.format).toEqual({ kind: "image", container: "png" });
    expect((file.sources[0] as Record<string, any>).mediaType).toBe("image");
  });

  it("rect-local masks ride into both geometry families", async () => {
    const ELLIPSE = "M120 0A120 80 0 1 0 120 160A120 80 0 1 0 120 0Z";
    const regions = {
      regions: [
        { x: 64, y: 48, w: 240, h: 160, maskPath: ELLIPSE },
        { x: 400, y: 300, w: 200, h: 120 },
      ],
    };

    // inset (real geometry): the masked region's CELL carries the mask,
    // bounds = the authored rect (the path's design space).
    const inset = (await BlurRegions.render(
      { sourceId: CLIP, regions },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;
    const cells = (stepDoc(inset).sources as Record<string, any>[]).filter(
      (s) => s.editor?.label === "blur-regions:region",
    );
    const maskedCell = cells.find((s) => s.placement?.sourceRect?.x === 64)!;
    expect(maskedCell.mask).toEqual({
      kind: "inline-mask",
      localPath: ELLIPSE,
      bounds: { x: 0, y: 0, width: 240, height: 160 },
    });
    const plainCell = cells.find((s) => s.placement?.sourceRect?.x === 400)!;
    expect(plainCell.mask).toBeUndefined();

    // mask geometry: plain rect stays a subpath; masked region becomes a
    // placed part in the ONE composite mask.
    const masked = (await BlurRegions.render(
      { sourceId: CLIP, regions, geometry: "mask" },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;
    const overlay = stepDoc(masked).sources[1] as Record<string, any>;
    expect(overlay.mask.localPath).toBe("M400 300H600V420H400Z");
    expect(overlay.mask.parts).toEqual([
      {
        d: ELLIPSE,
        translate: { x: 64, y: 48 },
        // Clipped to the region rect — inset/exact get this cut for free
        // from real cell edges; the composite must match.
        clip: { x: 64, y: 48, width: 240, height: 160 },
      },
    ]);
  });

  it("is deterministic: identical calls produce deep-equal documents", async () => {
    const a = await BlurRegions.render(
      { sourceId: CLIP, regions: REGIONS, mode: "pixelate", strength: 20 },
      makeCtx({ [CLIP]: videoMeta() }),
    );
    const b = await BlurRegions.render(
      { sourceId: CLIP, regions: REGIONS, mode: "pixelate", strength: 20 },
      makeCtx({ [CLIP]: videoMeta() }),
    );
    expect(a).toEqual(b);
  });
});

describe("BlurRegions — first-open cover (mosaic-branding band)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("brand band + real-material hero, valid and deterministic", async () => {
    expect(typeof BlurRegions.renderCover).toBe("function");
    const a = (await BlurRegions.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await BlurRegions.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(String(a.m0))).toBe(true);
    const s = JSON.stringify(a.sources);
    expect(s).toContain("Easy Blur");
    expect(s).not.toContain("START HERE");
    expect(a.m0).toBe(b.m0);
  });
});
