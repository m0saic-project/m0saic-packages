import { isValidM0String } from "@m0saic/dsl";
import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicSource,
  MosaicTextSource,
} from "@m0saic/types";
import { getFrameCount } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { MetadataStampV1 } from "./metadata-stamp";

function makeCtx(media: Record<string, unknown> = {}): MosaicEngineContext {
  return {
    mode: "render",
    output: { width: 1920, height: 1080, fps: 30, durationMs: 10000, workspaceDir: "/tmp/m0saic-test" },
    target: { width: 1920, height: 1080, fps: 30, durationMs: 10000 },
    media,
  } as unknown as MosaicEngineContext;
}

const TAGGED = "/tmp/in/holiday.mp4";
const APPLE = "/tmp/in/iphone.mov";
const BARE = "/tmp/in/stripped.mp4";
const IMAGE = "/tmp/in/photo.jpg";

const MEDIA = {
  [TAGGED]: {
    kind: "video",
    width: 1280,
    height: 720,
    durationMs: 8000,
    fps: 30,
    originalFileName: "holiday.mp4",
    tags: { creation_time: "2024-03-11T18:22:04.000000Z" },
  },
  [APPLE]: {
    kind: "video",
    width: 1920,
    height: 1080,
    durationMs: 4000,
    fps: 30,
    originalFileName: "iphone.mov",
    tags: { creation_time: "2023-07-01T21:15:00.000000Z" },
    format: { tags: { "com.apple.quicktime.creationdate": "2023-07-01T23:15:00+0200" } },
  },
  [BARE]: {
    kind: "video",
    width: 640,
    height: 360,
    durationMs: 2000,
    fps: 25,
    originalFileName: "stripped.mp4",
  },
  [IMAGE]: { kind: "image", width: 3000, height: 2000 },
};

function isPipeline(r: unknown): r is MosaicDocumentPipeline {
  return (r as { kind?: string })?.kind === "mosaic_pipeline";
}

function isErrorMosaic(doc: MosaicDocument): boolean {
  // makeErrorMosaic docs carry a top-level text source with the message.
  return (doc.sources ?? []).some((s) => s.type === "text");
}

async function renderSteps(
  props: Parameters<typeof MetadataStampV1.render>[0],
  media: Record<string, unknown> = MEDIA,
) {
  const r = await MetadataStampV1.render(props, makeCtx(media));
  expect(isPipeline(r)).toBe(true);
  return (r as MosaicDocumentPipeline).steps as Array<{
    name: string;
    label?: string;
    durationMs: number;
    file: MosaicDocument;
  }>;
}

/** The literal text stamped into the wm_text child of a step doc. */
function stampedText(doc: MosaicDocument): string | undefined {
  const child = doc.children?.wm_text as MosaicDocument | undefined;
  const src = child?.sources?.[0] as MosaicTextSource | undefined;
  const content = src?.layers?.[0]?.content;
  return content && content.kind === "literal" ? content.text : undefined;
}

describe("MetadataStampV1 — fail-fast validation", () => {
  test("no inputs → error mosaic", async () => {
    const r = await MetadataStampV1.render({}, makeCtx());
    expect((r as MosaicDocument).kind).toBe("mosaic_document");
    expect(isErrorMosaic(r as MosaicDocument)).toBe(true);
  });

  test('stampField "custom" with empty customText → error mosaic', async () => {
    const r = await MetadataStampV1.render(
      { sourceIds: [TAGGED], stampField: "custom", customText: "  " },
      makeCtx(MEDIA),
    );
    expect(isErrorMosaic(r as MosaicDocument)).toBe(true);
  });

  test("unknown stampField / dateFormat → error mosaic", async () => {
    const bad1 = await MetadataStampV1.render(
      { sourceIds: [TAGGED], stampField: "codec" as never },
      makeCtx(MEDIA),
    );
    expect(isErrorMosaic(bad1 as MosaicDocument)).toBe(true);
    const bad2 = await MetadataStampV1.render(
      { sourceIds: [TAGGED], dateFormat: "QQQQ" as never },
      makeCtx(MEDIA),
    );
    expect(isErrorMosaic(bad2 as MosaicDocument)).toBe(true);
  });
});

describe("MetadataStampV1 — creation-date stamping", () => {
  test("stamps the formatted creation_time at the input's own dims and duration", async () => {
    const steps = await renderSteps({ sourceIds: [TAGGED] });
    expect(steps).toHaveLength(1);
    const step = steps[0];
    expect(isErrorMosaic(step.file)).toBe(false);
    // base + chip + text cells
    expect(getFrameCount(String(step.file.m0))).toBe(3);
    expect(step.file.size).toEqual({ width: 1280, height: 720 });
    expect(step.durationMs).toBe(8000);
    expect(step.file.format).toEqual({ kind: "video", container: "mp4" });
    expect(stampedText(step.file)).toBe("2024-03-11");
    // chip is translucent via the constant-opacity fast path
    const chipSrc = step.file.sources[1] as Extract<MosaicSource, { type: "mosaic" }>;
    expect(chipSrc.ref).toBe("wm_chip");
    expect(chipSrc.visual?.opacity).toBeCloseTo(0.35);
    const textSrc = step.file.sources[2] as Extract<MosaicSource, { type: "mosaic" }>;
    expect(textSrc.ref).toBe("wm_text");
    expect(textSrc.visual?.opacity).toBeUndefined();
  });

  test("dateFormat preset is honored", async () => {
    const steps = await renderSteps({ sourceIds: [TAGGED], dateFormat: "MMM D, YYYY" });
    expect(stampedText(steps[0].file)).toBe("Mar 11, 2024");
  });

  test("Apple tag wins and renders at its own local offset", async () => {
    const steps = await renderSteps({ sourceIds: [APPLE], dateFormat: "YYYY-MM-DD HH:mm" });
    expect(stampedText(steps[0].file)).toBe("2023-07-01 23:15");
  });

  test("utcOffsetMinutes override re-bases the rendered date", async () => {
    // 18:22 UTC + 9h → next day in Tokyo.
    const steps = await renderSteps({ sourceIds: [TAGGED], utcOffsetMinutes: 540 });
    expect(stampedText(steps[0].file)).toBe("2024-03-12");
  });

  test("missing tag + empty fallback → clean passthrough (the no-op)", async () => {
    const steps = await renderSteps({ sourceIds: [BARE] });
    const doc = steps[0].file;
    expect(isErrorMosaic(doc)).toBe(false);
    expect(getFrameCount(String(doc.m0))).toBe(1);
    expect(doc.sources).toHaveLength(1);
    expect(doc.children).toBeUndefined();
    expect(doc.size).toEqual({ width: 640, height: 360 });
    expect(steps[0].durationMs).toBe(2000);
  });

  test("missing tag + fallbackText → the fallback is stamped", async () => {
    const steps = await renderSteps({ sourceIds: [BARE], fallbackText: "NYC 2019" });
    expect(stampedText(steps[0].file)).toBe("NYC 2019");
  });
});

describe("MetadataStampV1 — other stamp fields", () => {
  test('stampField "filename" stamps the basename without extension', async () => {
    const steps = await renderSteps({ sourceIds: [TAGGED], stampField: "filename" });
    expect(stampedText(steps[0].file)).toBe("holiday");
  });

  test('stampField "custom" stamps the same text on every input', async () => {
    const steps = await renderSteps({
      sourceIds: [TAGGED, BARE],
      stampField: "custom",
      customText: "Summer Trip",
    });
    expect(steps).toHaveLength(2);
    expect(stampedText(steps[0].file)).toBe("Summer Trip");
    expect(stampedText(steps[1].file)).toBe("Summer Trip");
  });

  test("chipOpacity 0 drops the chip layer (bare text)", async () => {
    const steps = await renderSteps({ sourceIds: [TAGGED], chipOpacity: 0 });
    const doc = steps[0].file;
    expect(getFrameCount(String(doc.m0))).toBe(2);
    expect(doc.children?.wm_chip).toBeUndefined();
    expect(doc.children?.wm_text).toBeDefined();
  });
});

describe("MetadataStampV1 — batch behavior", () => {
  test("N inputs → emit multi with unique step names", async () => {
    const r = await MetadataStampV1.render(
      { sourceIds: [TAGGED, APPLE, BARE] },
      makeCtx(MEDIA),
    );
    const pipe = r as MosaicDocumentPipeline;
    expect(pipe.emit).toBe("multi");
    expect(pipe.steps).toHaveLength(3);
    const names = pipe.steps.map((s) => s.name);
    expect(new Set(names).size).toBe(3);
  });

  test("one bad input degrades to an error step without killing the batch", async () => {
    const steps = await renderSteps({ sourceIds: [TAGGED, IMAGE] });
    expect(steps).toHaveLength(2);
    expect(isErrorMosaic(steps[0].file)).toBe(false);
    expect(isErrorMosaic(steps[1].file)).toBe(true);
  });

  test("unprobed input → error step", async () => {
    const steps = await renderSteps({ sourceIds: ["/tmp/in/nowhere.mp4"] });
    expect(isErrorMosaic(steps[0].file)).toBe(true);
  });
});

describe("MetadataStampV1 — template metadata", () => {
  test("id / tier / outputHints.format video/mp4", () => {
    expect(MetadataStampV1.id).toBe("@m0saic/media/metadata-stamp/v1");
    expect(MetadataStampV1.version).toBe(1);
    expect(MetadataStampV1.capabilities).toEqual({ tier: "core" });
    // The frozen 0.2.0 declaration carries a template-level format hint
    // (video/mp4); steps still declare their per-doc format.
    expect(MetadataStampV1.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
  });

  test("optional props all have deterministic defaults", () => {
    const d = MetadataStampV1.defaultProps as Record<string, unknown>;
    expect(d.stampField).toBe("creation-date");
    expect(d.dateFormat).toBe("YYYY-MM-DD");
    expect(d.fallbackText).toBe("");
    expect(d.position).toBe("bottom-left");
  });
});

describe("MetadataStampV1 — first-open cover (mosaic-branding band)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("brand band + real-material hero, valid and deterministic", async () => {
    expect(typeof MetadataStampV1.renderCover).toBe("function");
    const a = (await MetadataStampV1.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await MetadataStampV1.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(String(a.m0))).toBe(true);
    const s = JSON.stringify(a.sources);
    expect(s).toContain("Metadata Stamp");
    expect(s).not.toContain("START HERE");
    expect(a.m0).toBe(b.m0);
    // The demo chip is stamped onto the REAL still — the chip text rides the
    // stamp machinery's nested children (wm_chip/wm_text), same as production.
    expect(s).toContain("wm_chip");
    expect(JSON.stringify((a as { children?: unknown }).children ?? {})).toContain("2024-07-15");
  });
});

describe("MetadataStampV1 — prop bindings (Make inline edit)", () => {
  const schema = MetadataStampV1.propsSchema;
  // Step docs render at the INPUT's own dims (TAGGED = 1280×720).
  const bindingsOf = (doc: MosaicDocument, w = 1280, h = 720) =>
    resolvePropBindings(doc, w, h, { propsSchema: schema });

  test("the chip's ONE text rect binds customText + fontColor (wm_text child), the chip tile binds chipColor (wm_chip) — on every stamp field", async () => {
    const cases: Array<Parameters<typeof MetadataStampV1.render>[0]> = [
      { sourceIds: [TAGGED] },
      { sourceIds: [TAGGED], stampField: "filename" },
      { sourceIds: [TAGGED], stampField: "custom", customText: "Summer Trip" },
      { sourceIds: [BARE], fallbackText: "NYC 2019" },
    ];
    for (const p of cases) {
      const steps = await renderSteps(p);
      const doc = steps[0].file;
      const r = bindingsOf(doc, doc.size!.width, doc.size!.height);
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp).sort()).toEqual(["chipColor", "customText", "fontColor"]);
      expect(r.byProp.customText).toHaveLength(1);
      const b = r.byProp.customText[0];
      expect("index" in b).toBe(false);
      expect(b.kind).toBe("string");
      expect(b.childPath).toEqual(["wm_text"]);
      const child = doc.children?.wm_text as MosaicDocument;
      expect((child.sources[b.sourceIndex] as { editor?: { label?: string } }).editor?.label).toBe("mstamp:text");
      // fontColor inks that SAME rect — a stacked second entry (text first, colour second)
      expect(r.byProp.fontColor).toHaveLength(1);
      expect(r.byProp.fontColor[0].kind).toBe("color");
      expect(r.byProp.fontColor[0].childPath).toEqual(["wm_text"]);
      expect(r.byProp.fontColor[0].sourceIndex).toBe(b.sourceIndex);
      // chipColor paints the ONE chip tile in the wm_chip child
      expect(r.byProp.chipColor).toHaveLength(1);
      expect(r.byProp.chipColor[0].kind).toBe("color");
      expect(r.byProp.chipColor[0].childPath).toEqual(["wm_chip"]);
      const chip = doc.children?.wm_chip as MosaicDocument;
      expect((chip.sources[r.byProp.chipColor[0].sourceIndex] as { editor?: { label?: string } }).editor?.label).toBe("mstamp:chip");
    }
  });

  test("clean passthrough (no tag, no fallback) has no chip → no binding; chipOpacity 0 keeps text + fontColor, drops chipColor", async () => {
    const bare = await renderSteps({ sourceIds: [BARE] });
    expect(bindingsOf(bare[0].file, 640, 360).byProp).toEqual({});
    const noChip = bindingsOf((await renderSteps({ sourceIds: [TAGGED], chipOpacity: 0 }))[0].file);
    expect(noChip.rejected).toEqual([]);
    expect(noChip.byProp.customText).toHaveLength(1);
    expect(noChip.byProp.fontColor).toHaveLength(1);
    // no chip tile → nothing on screen shows chipColor
    expect(noChip.byProp.chipColor).toBeUndefined();
  });

  test("the first-open cover's demo chip (fixed date, no prop) is NOT bound", async () => {
    const cover = (await MetadataStampV1.renderCover!({} as never, makeCtx())) as MosaicDocument;
    expect(resolvePropBindings(cover, 1920, 1080, { propsSchema: schema }).byProp).toEqual({});
  });
});
