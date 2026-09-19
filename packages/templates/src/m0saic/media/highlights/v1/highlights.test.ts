import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaMetadata,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { Highlights, resolveHighlightsKnobs } from "./highlights";

const CLIP = "/abs/media/hero_1.mp4";

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

const RANGES = [
  { startMs: 500, endMs: 2000 },
  { startMs: 3000, endMs: 4500, label: "finale" },
];

describe("Highlights template metadata", () => {
  it("registers the versioned id with core-tier capabilities", () => {
    expect(Highlights.id).toBe("@m0saic/media/highlights/v1");
    expect(Highlights.version).toBe(1);
    expect(Highlights.capabilities).toEqual({ tier: "core" });
  });

  it("declares outputHints.format video/mp4 (the frozen 0.2.0 declaration; steps still carry per-step formats)", () => {
    expect(Highlights.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
  });

  it("has deterministic defaults", () => {
    expect(Highlights.defaultProps).toEqual({ outputFormat: "mp4", muteAudio: false });
  });

  it("declares the time-ranges picker on the single ranges prop", () => {
    const control = Highlights.propsSchema?.ranges?.meta?.control;
    expect(control?.picker).toBe("time-ranges");
    expect(control?.videoFromProp).toBe("sourceId");
  });
});

describe("resolveHighlightsKnobs", () => {
  it("applies defaults and clamps maxWidth", () => {
    expect(resolveHighlightsKnobs({})).toEqual({ outputFormat: "mp4", muteAudio: false });
    expect(resolveHighlightsKnobs({ outputFormat: "webm", maxWidth: 50, muteAudio: true })).toEqual({
      outputFormat: "webm",
      maxWidth: 128,
      muteAudio: true,
    });
    expect(resolveHighlightsKnobs({ maxWidth: 99_999 }).maxWidth).toBe(3840);
  });
});

describe("Highlights render validation (fail-fast error mosaics)", () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, MosaicMediaMetadata>]> = [
    ["missing sourceId", { ranges: RANGES }, {}],
    ["missing ranges", { sourceId: CLIP }, { [CLIP]: videoMeta() }],
    ["empty ranges", { sourceId: CLIP, ranges: [] }, { [CLIP]: videoMeta() }],
    ["unparsable ranges", { sourceId: CLIP, ranges: "{bad" }, { [CLIP]: videoMeta() }],
    [
      "bad outputFormat",
      { sourceId: CLIP, ranges: RANGES, outputFormat: "gif" },
      { [CLIP]: videoMeta() },
    ],
    ["unprobed input", { sourceId: CLIP, ranges: RANGES }, {}],
    [
      "non-video input",
      { sourceId: CLIP, ranges: RANGES },
      { [CLIP]: videoMeta({ kind: "image" as MosaicMediaMetadata["kind"] }) },
    ],
    [
      "no probed duration",
      { sourceId: CLIP, ranges: RANGES },
      { [CLIP]: videoMeta({ durationMs: undefined }) },
    ],
  ];

  it.each(cases)("%s → error mosaic document", async (_name, props, media) => {
    const out = await Highlights.render(props as never, makeCtx(media));
    expect(out.kind).toBe("mosaic_document");
  });
});

describe("Highlights render happy path", () => {
  it("returns an emit:multi pipeline with one step per range and probed fps", async () => {
    const out = (await Highlights.render(
      { sourceId: CLIP, ranges: RANGES },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;

    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.emit).toBe("multi");
    expect(out.fps).toBe(30);
    expect(out.steps.map((s) => s.name)).toEqual(["hero_1__range_01", "hero_1__range_02"]);
    expect(out.steps.map((s) => s.durationMs)).toEqual([1500, 1500]);
  });

  it("a single range still returns a 1-step emit:multi pipeline (planner owns the collapse)", async () => {
    const out = (await Highlights.render(
      { sourceId: CLIP, ranges: [{ startMs: 1000, endMs: 2500 }] },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;
    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.emit).toBe("multi");
    expect(out.steps).toHaveLength(1);
  });

  it("rounds fractional probed fps and omits fps when unprobed", async () => {
    const ntsc = (await Highlights.render(
      { sourceId: CLIP, ranges: RANGES },
      makeCtx({ [CLIP]: videoMeta({ fps: 29.97 }) }),
    )) as MosaicDocumentPipeline;
    expect(ntsc.fps).toBe(30);

    const noFps = (await Highlights.render(
      { sourceId: CLIP, ranges: RANGES },
      makeCtx({ [CLIP]: videoMeta({ fps: undefined }) }),
    )) as MosaicDocumentPipeline;
    expect(noFps.fps).toBeUndefined();
  });

  it("fps-follow SURVIVES the registry wrapper (stamp preserves authored pipeline fps)", async () => {
    // The gate-20 stress-10 bug: `Highlights` here is the RAW object, but
    // every production path renders the registered instance, whose wrapper
    // stamps ctx.target timing over the renderable. The stamp used to
    // clobber the authored source-follow fps (60 → target 30); this locks
    // the wrapped path, not just the raw one.
    const { requireTemplate } = require("@m0saic/template-utils");
    const wrapped = requireTemplate("@m0saic/media/highlights/v1");
    const out = (await wrapped.render(
      { sourceId: CLIP, ranges: RANGES },
      makeCtx({ [CLIP]: videoMeta({ fps: 60 }) }),
    )) as MosaicDocumentPipeline;
    expect(out.fps).toBe(60); // ctx.target.fps is 30 — authored fps must win
  });

  it("accepts ranges as a JSON string (CLI/agent surface tolerance)", async () => {
    const out = (await Highlights.render(
      { sourceId: CLIP, ranges: JSON.stringify(RANGES) },
      makeCtx({ [CLIP]: videoMeta() }),
    )) as MosaicDocumentPipeline;
    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.steps).toHaveLength(2);
  });

  it("is deterministic: identical calls produce deep-equal pipelines", async () => {
    const ctxA = makeCtx({ [CLIP]: videoMeta() });
    const ctxB = makeCtx({ [CLIP]: videoMeta() });
    const a = await Highlights.render({ sourceId: CLIP, ranges: RANGES }, ctxA);
    const b = await Highlights.render({ sourceId: CLIP, ranges: RANGES }, ctxB);
    expect(a).toEqual(b);
  });
});

describe("Highlights cover (mosaic-branding band)", () => {
  it("brand band + the REAL ranges screenshot hero; asset path exists on disk", async () => {
    const ctx = makeCtx();
    const a = (await Highlights.renderCover!({}, ctx)) as MosaicDocument;
    const b = (await Highlights.renderCover!({}, ctx)) as MosaicDocument;
    expect(a.kind).toBe("mosaic_document");
    const s = JSON.stringify(a.sources);
    expect(s).toContain("Highlight Clips");
    expect(s).toContain("Mark ranges;");
    // The bundled ranges-picker screenshot rides the manifest alongside the
    // brand M; the file asset's path must exist (dist assets mirror) or the
    // hero renders black.
    const fileAssets = (Object.values(a.assets ?? {}) as Array<{ kind: string; path?: string }>).filter(
      (e) => e.kind === "file",
    );
    expect(fileAssets).toHaveLength(1);
    expect(require("fs").existsSync(String(fileAssets[0].path).replace("/dist/", "/src/"))).toBe(true);
    expect(a).toEqual(b);
    const { isValidM0String } = require("@m0saic/dsl");
    expect(isValidM0String(String(a.m0))).toBe(true);
  });
});
