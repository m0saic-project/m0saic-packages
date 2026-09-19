import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { getFrameCount, parseM0StringToRenderFrames } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { WatermarkV1 } from "./watermark";

function makeCtx(media: Record<string, unknown> = {}): MosaicEngineContext {
  return {
    mode: "render",
    output: { width: 1920, height: 1080, fps: 30, durationMs: 10000, workspaceDir: "/tmp/m0saic-test" },
    target: { width: 1920, height: 1080, fps: 30, durationMs: 10000 },
    media,
  } as unknown as MosaicEngineContext;
}

const VIDEO = "/tmp/in/clip.mp4";
const IMAGE = "/tmp/in/photo.jpg";
const LOGO = "/tmp/brand/logo.png";

const MEDIA = {
  [VIDEO]: { kind: "video", width: 1280, height: 720, durationMs: 8000, fps: 30 },
  [IMAGE]: { kind: "image", width: 3000, height: 2000 },
  [LOGO]: { kind: "image", width: 400, height: 100 },
};

function isPipeline(r: unknown): r is MosaicDocumentPipeline {
  return (r as { kind?: string })?.kind === "mosaic_pipeline";
}

function isErrorMosaic(doc: MosaicDocument): boolean {
  // `makeErrorMosaic` engine-marks its source `renderStatus: "error"` — the
  // same marker the UI uses to disable Make. The old "has a text source"
  // heuristic false-positives on the layout/geometry contract WIREFRAME, which
  // a PASSING contract returns in debug mode and which carries a text banner.
  return (doc.sources ?? []).some(
    (s) => (s as { engine?: { renderStatus?: string } }).engine?.renderStatus === "error",
  );
}

describe("WatermarkV1", () => {
  test("no inputs → error mosaic", async () => {
    const r = await WatermarkV1.render({ content: "text" }, makeCtx());
    expect((r as MosaicDocument).kind).toBe("mosaic_document");
    expect(isErrorMosaic(r as MosaicDocument)).toBe(true);
  });

  test("logo content without image → error mosaic", async () => {
    const r = await WatermarkV1.render({ sourceIds: [VIDEO], content: "logo" }, makeCtx(MEDIA));
    expect(isErrorMosaic(r as MosaicDocument)).toBe(true);
  });

  test("bad layoutM0 → error mosaic (whole render)", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", layoutM0: "2(F,F)" },
      makeCtx(MEDIA),
    );
    expect(isErrorMosaic(r as MosaicDocument)).toBe(true);
  });

  test("unknown mode string → clear error mosaic", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", mode: "sparkle" as never },
      makeCtx(MEDIA),
    );
    expect(isErrorMosaic(r as MosaicDocument)).toBe(true);
  });

  test("adaptive auto with buckets → two crossfading layers on the video step", async () => {
    const lumaByInput = {
      [VIDEO]: {
        buckets: [
          { startMs: 0, endMs: 4000, avgLuma: 210 },
          { startMs: 4000, endMs: 8000, avgLuma: 40 },
        ],
        overallAvgLuma: 125,
        durationMs: 8000,
      },
    };
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", mode: "adaptive", lumaByInput },
      makeCtx(MEDIA),
    );
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    expect(isErrorMosaic(step.file)).toBe(false);
    // base + two variant cells
    expect(getFrameCount(String(step.file.m0))).toBe(3);
    const [light, dark] = step.file.sources.slice(1) as Array<
      Extract<MosaicSource, { type: "mosaic" }>
    >;
    expect(light.ref).toBe("wm_light");
    expect(dark.ref).toBe("wm_dark");
    expect(light.overlay?.alpha).toBeDefined();
    expect(dark.overlay?.alpha).toBeDefined();
    // never pair enable with a ramped alpha (it hard-cuts the ramp)
    expect(light.overlay?.enable).toBeUndefined();
    expect(dark.overlay?.enable).toBeUndefined();
  });

  test("adaptive auto PULLS luma via ctx.analysis when the host attaches it", async () => {
    const regionLuminance = jest.fn().mockResolvedValue({
      buckets: [
        { startMs: 0, endMs: 4000, avgLuma: 210 },
        { startMs: 4000, endMs: 8000, avgLuma: 40 },
      ],
      overallAvgLuma: 125,
      durationMs: 8000,
    });
    const ctx = { ...makeCtx(MEDIA), analysis: { regionLuminance } } as MosaicEngineContext;
    const r = await WatermarkV1.render({ sourceIds: [VIDEO], content: "text", mode: "adaptive" }, ctx);
    // one probe per input, fractional clamped region, video smoothing
    expect(regionLuminance).toHaveBeenCalledTimes(1);
    const [pathArg, region, opts] = regionLuminance.mock.calls[0];
    expect(pathArg).toBe(VIDEO);
    expect(region.xPct).toBeGreaterThanOrEqual(0);
    expect(region.xPct + region.wPct).toBeLessThanOrEqual(1);
    expect(opts).toMatchObject({ bucketMs: 500, smoothingMs: 1500 });
    // pulled buckets drive the two crossfading variant layers
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    expect(getFrameCount(String(step.file.m0))).toBe(3);
    expect(step.file.children?.wm_light).toBeDefined();
    expect(step.file.children?.wm_dark).toBeDefined();
  });

  test("adaptive static/single modes never touch ctx.analysis (laziness)", async () => {
    const regionLuminance = jest.fn();
    const ctx = { ...makeCtx(MEDIA), analysis: { regionLuminance } } as MosaicEngineContext;
    await WatermarkV1.render({ sourceIds: [VIDEO], content: "text" }, ctx);
    await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", mode: "adaptive", variant: "single" },
      ctx,
    );
    expect(regionLuminance).not.toHaveBeenCalled();
  });

  test("lumaByInput prop override wins over ctx.analysis", async () => {
    const regionLuminance = jest.fn();
    const ctx = { ...makeCtx(MEDIA), analysis: { regionLuminance } } as MosaicEngineContext;
    const lumaByInput = {
      [VIDEO]: { buckets: [{ startMs: 0, endMs: 8000, avgLuma: 210 }], overallAvgLuma: 210, durationMs: 8000 },
    };
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", mode: "adaptive", lumaByInput },
      ctx,
    );
    expect(regionLuminance).not.toHaveBeenCalled();
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    expect(isErrorMosaic(step.file)).toBe(false);
  });

  test("probe failure degrades that step to single-variant, render survives", async () => {
    const regionLuminance = jest.fn().mockRejectedValue(new Error("boom"));
    const ctx = { ...makeCtx(MEDIA), analysis: { regionLuminance } } as MosaicEngineContext;
    const r = await WatermarkV1.render({ sourceIds: [VIDEO], content: "text", mode: "adaptive" }, ctx);
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    expect(isErrorMosaic(step.file)).toBe(false);
    expect(getFrameCount(String(step.file.m0))).toBe(2); // single primary layer
  });

  test("adaptive without lumaByInput degrades to a single primary layer", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", mode: "adaptive" },
      makeCtx(MEDIA),
    );
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    expect(isErrorMosaic(step.file)).toBe(false);
    expect(getFrameCount(String(step.file.m0))).toBe(2);
    const stamp = step.file.sources[1] as Extract<MosaicSource, { type: "mosaic" }>;
    expect(stamp.ref).toBe("wm_wm");
    expect(stamp.overlay?.alpha).toBeDefined(); // entrance fade × opacity
  });

  test("adaptive windowed video → trapezoid window alpha", async () => {
    const lumaByInput = {
      [VIDEO]: {
        buckets: [{ startMs: 0, endMs: 8000, avgLuma: 210 }],
        overallAvgLuma: 210,
        durationMs: 8000,
      },
    };
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", mode: "adaptive", windowing: "windows", lumaByInput },
      makeCtx(MEDIA),
    );
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    const stamp = step.file.sources[1] as Extract<MosaicSource, { type: "mosaic" }>;
    expect(stamp.overlay?.alpha).toContain("clip((t-");
  });

  test("adaptive image step picks one artwork from overall luma", async () => {
    const lumaByInput = {
      [IMAGE]: { buckets: [], overallAvgLuma: 220, durationMs: 0 },
    };
    const r = await WatermarkV1.render(
      {
        sourceIds: [IMAGE],
        content: "text",
        mode: "adaptive",
        textColorOnLight: "#222222",
        lumaByInput,
      },
      makeCtx(MEDIA),
    );
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    expect(getFrameCount(String(step.file.m0))).toBe(2);
    const stamp = step.file.sources[1] as Extract<MosaicSource, { type: "mosaic" }>;
    expect(stamp.visual?.opacity).toBe(0.85); // constant — no time axis
    // bright image → on-light artwork → dark text color in the child
    const child = step.file.children?.wm_wm as MosaicDocument;
    const textSource = child.sources[0] as { layers?: Array<{ style?: { fontColor?: string } }> };
    expect(textSource.layers?.[0]?.style?.fontColor).toBe("#222222");
  });

  test("one video input → 1-step emit:multi pipeline sized to the input", async () => {
    const r = await WatermarkV1.render({ sourceIds: [VIDEO], content: "text" }, makeCtx(MEDIA));
    expect(isPipeline(r)).toBe(true);
    const pipe = r as MosaicDocumentPipeline;
    expect(pipe.emit).toBe("multi");
    expect(pipe.steps).toHaveLength(1);
    const step = pipe.steps[0] as { durationMs: number; label?: string; file: MosaicDocument };
    expect(step.durationMs).toBe(8000);
    expect(step.label).toBe("clip");
    expect(step.file.size).toEqual({ width: 1280, height: 720 });
    expect(step.file.format).toEqual({ kind: "video", container: "mp4" });
    // base + one stamp cell
    expect(getFrameCount(String(step.file.m0))).toBe(2);
    const stamp = step.file.sources[1] as Extract<MosaicSource, { type: "mosaic" }>;
    expect(stamp.type).toBe("mosaic");
    expect(stamp.visual?.opacity).toBe(0.85);
    expect(step.file.children?.wm_wm).toBeDefined();
  });

  test("mixed inputs → per-step formats (jpg → jpeg via match) and per-step dims", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO, IMAGE], content: "logo", image: LOGO },
      makeCtx(MEDIA),
    );
    const pipe = r as MosaicDocumentPipeline;
    expect(pipe.steps).toHaveLength(2);
    const [v, img] = pipe.steps as Array<{ durationMs: number; file: MosaicDocument }>;
    expect(v.file.format).toEqual({ kind: "video", container: "mp4" });
    expect(img.file.format).toEqual({ kind: "image", container: "jpeg" });
    expect(img.file.size).toEqual({ width: 3000, height: 2000 });
    expect(img.durationMs).toBe(40);
    // logo child carries the logo asset hermetically
    const child = img.file.children?.wm_wm as MosaicDocument | undefined;
    expect(child?.assets?.[asAssetId("wm_logo")]).toMatchObject({ path: LOGO, mediaType: "image" });
  });

  test("imageOutputFormat png forces png for jpg inputs", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: [IMAGE], content: "text", imageOutputFormat: "png" },
      makeCtx(MEDIA),
    );
    const pipe = r as MosaicDocumentPipeline;
    expect((pipe.steps[0] as { file: MosaicDocument }).file.format).toEqual({
      kind: "image",
      container: "png",
    });
  });

  test("unknown input degrades to a per-step error mosaic, batch survives", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: ["/tmp/in/missing.mp4", VIDEO], content: "text" },
      makeCtx(MEDIA),
    );
    const pipe = r as MosaicDocumentPipeline;
    expect(pipe.steps).toHaveLength(2);
    const bad = pipe.steps[0] as { durationMs: number; file: MosaicDocument };
    expect(isErrorMosaic(bad.file)).toBe(true);
    expect(bad.durationMs).toBe(1000);
    const good = pipe.steps[1] as { file: MosaicDocument };
    expect(isErrorMosaic(good.file)).toBe(false);
  });

  test("layoutM0 hatch places the stamp cell exactly", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", layoutM0: "4(-,-,-,F)" },
      makeCtx(MEDIA),
    );
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    // 1280 wide → last quarter = x 960, w 320, full height 720. Assert
    // the parsed rect, not the string — auto-compact may rewrite the m0
    // into an equivalent shorter form.
    expect(getFrameCount(String(step.file.m0))).toBe(2);
    const frames = parseM0StringToRenderFrames(String(step.file.m0), 1280, 720);
    const cell = frames.find((f) => f.width < 1280);
    expect(cell).toMatchObject({ x: 960, width: 320, y: 0, height: 720 });
  });

  test("page mode: one full-canvas pattern child with rotated instance cells", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", mode: "page", angleDeg: -30, opacity: 0.25 },
      makeCtx(MEDIA),
    );
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    // parent: base F + ONE pattern cell (depth 1)
    expect(getFrameCount(String(step.file.m0))).toBe(2);
    const patternSource = step.file.sources[1] as Extract<MosaicSource, { type: "mosaic" }>;
    expect(patternSource.ref).toBe("wm_pattern");
    expect(patternSource.visual?.opacity).toBe(0.25);
    expect(patternSource.editor?.label).toBe("wm:pattern");
    const pattern = step.file.children?.wm_pattern as MosaicDocument;
    expect(pattern.size).toEqual({ width: 1280, height: 720 });
    expect(pattern.sources.length).toBeGreaterThan(1);
    expect(pattern.sources.length).toBeLessThanOrEqual(24);
    for (const s of pattern.sources) {
      expect((s as { effects?: { rotate?: number } }).effects?.rotate).toBe(-30);
      expect((s as { ref?: string }).ref).toBe("wm_content");
    }
    expect(pattern.children?.wm_content).toBeDefined();
  });

  test("page mode with logo: cells reference one shared cell-sized instance carrying the logo", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: [IMAGE], content: "logo", image: LOGO, mode: "page" },
      makeCtx(MEDIA),
    );
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    const pattern = step.file.children?.wm_pattern as MosaicDocument;
    for (const s of pattern.sources) expect(s.type).toBe("mosaic");
    const instance = pattern.children?.wm_content as MosaicDocument;
    expect(instance).toBeDefined();
    // padded wrapper (angle −30 → envelope > content) nests the logo art
    const art = (instance.children?.wm_art ?? instance) as MosaicDocument;
    expect(art.assets?.[asAssetId("wm_logo")]).toMatchObject({ path: LOGO });
  });

  test("lockup content renders a two-piece child", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "lockup", image: LOGO, text: "yourbrand.com" },
      makeCtx(MEDIA),
    );
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    const child = step.file.children?.wm_wm as MosaicDocument;
    expect(child.sources).toHaveLength(2);
    expect(child.sources[0]!.type).toBe("media");
    expect(child.sources[1]!.type).toBe("text");
  });

  test("lockup without image → error mosaic", async () => {
    const r = await WatermarkV1.render({ sourceIds: [VIDEO], content: "lockup" }, makeCtx(MEDIA));
    expect(isErrorMosaic(r as MosaicDocument)).toBe(true);
  });

  test("debugLayout renders without a contract violation", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", debugLayout: true },
      makeCtx(MEDIA),
    );
    const step = (r as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    // a violation replaces the doc with a LAYOUT_CONTRACT error mosaic
    expect(isErrorMosaic(step.file)).toBe(false);
    const rPage = await WatermarkV1.render(
      { sourceIds: [VIDEO], content: "text", mode: "page", debugLayout: true },
      makeCtx(MEDIA),
    );
    const pageStep = (rPage as MosaicDocumentPipeline).steps[0] as { file: MosaicDocument };
    expect(isErrorMosaic(pageStep.file)).toBe(false);
  });

  test("determinism: same props → deep-equal pipelines", async () => {
    const props = { sourceIds: [VIDEO, IMAGE], content: "text" as const, position: "top-left" as const };
    const a = await WatermarkV1.render(props, makeCtx(MEDIA));
    const b = await WatermarkV1.render(props, makeCtx(MEDIA));
    expect(a).toEqual(b);
  });

  test("step names dedupe shared basenames", async () => {
    const r = await WatermarkV1.render(
      { sourceIds: ["/a/clip.mp4", "/b/clip.mp4"], content: "text" },
      makeCtx({
        "/a/clip.mp4": { kind: "video", width: 640, height: 360, durationMs: 1000 },
        "/b/clip.mp4": { kind: "video", width: 640, height: 360, durationMs: 1000 },
      }),
    );
    const pipe = r as MosaicDocumentPipeline;
    const names = (pipe.steps as Array<{ name?: string }>).map((s) => s.name);
    expect(new Set(names).size).toBe(2);
  });
});

describe("WatermarkV1 — prop bindings (Make inline edit)", () => {
  const schema = WatermarkV1.propsSchema;
  const stepDoc = async (props: Parameters<typeof WatermarkV1.render>[0]): Promise<MosaicDocument> => {
    const r = await WatermarkV1.render(props, makeCtx(MEDIA));
    expect(isPipeline(r)).toBe(true);
    return (r as MosaicDocumentPipeline).steps[0].file as MosaicDocument;
  };
  // VIDEO steps render at the input's own dims (1280×720).
  const bindingsOf = (doc: MosaicDocument) => resolvePropBindings(doc, 1280, 720, { propsSchema: schema });
  const labelIn = (doc: MosaicDocument, childPath: string[], i: number): string | undefined => {
    const owner = childPath.reduce((d, ref) => (d.children as Record<string, MosaicDocument>)[ref], doc);
    return (owner.sources[i] as { editor?: { label?: string } }).editor?.label;
  };

  test("static text stamp: ONE wordmark rect binds `text` + `textColor` (wm_wm child)", async () => {
    const doc = await stepDoc({ sourceIds: [VIDEO], content: "text", text: "yourbrand.com" });
    const r = bindingsOf(doc);
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["text", "textColor"]);
    expect(r.byProp.text).toHaveLength(1);
    const b = r.byProp.text[0];
    expect("index" in b).toBe(false);
    expect(b.kind).toBe("string");
    expect(b.childPath).toEqual(["wm_wm"]);
    expect(labelIn(doc, b.childPath, b.sourceIndex)).toBe("wm:text");
    // textColor inks that SAME rect — stacked second entry; the on-light variant is not on screen
    expect(r.byProp.textColor).toHaveLength(1);
    expect(r.byProp.textColor[0].kind).toBe("color");
    expect(r.byProp.textColor[0].childPath).toEqual(["wm_wm"]);
    expect(r.byProp.textColor[0].sourceIndex).toBe(b.sourceIndex);
    expect(r.byProp.textColorOnLight).toBeUndefined();
  });

  test("adaptive auto with buckets: the light + dark layers each bind `text`; light → textColorOnLight, dark → textColor", async () => {
    const lumaByInput = {
      [VIDEO]: {
        buckets: [
          { startMs: 0, endMs: 4000, avgLuma: 210 },
          { startMs: 4000, endMs: 8000, avgLuma: 40 },
        ],
        overallAvgLuma: 125,
        durationMs: 8000,
      },
    };
    const doc = await stepDoc({ sourceIds: [VIDEO], content: "text", mode: "adaptive", lumaByInput });
    const r = bindingsOf(doc);
    expect(r.rejected).toEqual([]);
    expect(r.byProp.text.map((b) => b.childPath)).toEqual([["wm_light"], ["wm_dark"]]);
    for (const b of r.byProp.text) expect(labelIn(doc, b.childPath, b.sourceIndex)).toBe("wm:text");
    // each layer's wordmark is inked by ITS variant's colour prop
    expect(r.byProp.textColorOnLight.map((b) => b.childPath)).toEqual([["wm_light"]]);
    expect(r.byProp.textColor.map((b) => b.childPath)).toEqual([["wm_dark"]]);
    for (const b of [...r.byProp.textColor, ...r.byProp.textColorOnLight]) {
      expect(b.kind).toBe("color");
      expect(labelIn(doc, b.childPath, b.sourceIndex)).toBe("wm:text");
    }
  });

  test("adaptive auto on a bright IMAGE picks the on-light artwork → its one `wm` layer binds textColorOnLight", async () => {
    const lumaByInput = { [IMAGE]: { buckets: [], overallAvgLuma: 230, durationMs: 0 } };
    const doc = await stepDoc({ sourceIds: [IMAGE], content: "text", mode: "adaptive", variant: "auto", lumaByInput });
    // IMAGE steps render at the input's own dims (3000×2000).
    const r = resolvePropBindings(doc, 3000, 2000, { propsSchema: schema });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["text", "textColorOnLight"]);
    expect(r.byProp.textColorOnLight).toHaveLength(1);
    expect(r.byProp.textColorOnLight[0].kind).toBe("color");
    expect(r.byProp.textColorOnLight[0].childPath).toEqual(["wm_wm"]);
    expect(r.byProp.textColorOnLight[0].sourceIndex).toBe(r.byProp.text[0].sourceIndex);
    expect(r.byProp.textColor).toBeUndefined();
  });

  test("lockup binds only the wordmark rect; logo-only content has no text rect → nothing bound", async () => {
    const lockup = bindingsOf(await stepDoc({ sourceIds: [VIDEO], content: "lockup", image: LOGO, text: "yourbrand.com" }));
    expect(lockup.rejected).toEqual([]);
    expect(lockup.byProp.text).toHaveLength(1);
    expect(lockup.byProp.text[0].childPath).toEqual(["wm_wm"]);
    expect(lockup.byProp.textColor).toHaveLength(1);
    expect(lockup.byProp.textColor[0].kind).toBe("color");
    expect(lockup.byProp.textColor[0].sourceIndex).toBe(lockup.byProp.text[0].sourceIndex);
    const logo = bindingsOf(await stepDoc({ sourceIds: [VIDEO], content: "logo", image: LOGO }));
    expect(logo.byProp).toEqual({});
  });

  test("page mode (the tiled scatter) is deliberately unbound — no single rect shows the prop", async () => {
    const doc = await stepDoc({ sourceIds: [VIDEO], content: "text", mode: "page", angleDeg: -30 });
    const r = bindingsOf(doc);
    expect(r.rejected).toEqual([]);
    expect(r.byProp).toEqual({});
  });
});
