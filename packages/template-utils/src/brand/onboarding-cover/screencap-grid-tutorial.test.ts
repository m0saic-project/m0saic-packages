// Ported beside the template-utils copy from
// `packages/templates/src/m0saic/media/screencap_grid/v2/screencap-grid-tutorial.test.ts`
// (import paths only).
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTextSource,
} from "@m0saic/types";
import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";
import { renderScreencapGridV2Tutorial } from "./screencap-grid-tutorial";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]>,
): MosaicEngineContext {
  const target = {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
    ...overrides,
  };
  return {
    mode: "design" as const,
    target,
    output: { ...target, workspaceDir: "" },
    media: {},
  };
}

const STEP_NAMES = [
  "idea",
  "sources",
  "batch",
  "output",
  "layout",
  "tiles",
  "details",
  "custom-grid",
];
const SUPPORTED_COPY = /^[\x20-\x7E·—×]*$/u;

function sourceLabel(source: MosaicSource): string | undefined {
  return source.editor?.label;
}

function documentAt(
  pipeline: ReturnType<typeof renderScreencapGridV2Tutorial>,
  name: string,
): MosaicDocument {
  const step = pipeline.steps.find((candidate) => candidate.name === name);
  if (!step?.file || step.file.kind !== "mosaic_document") {
    throw new Error(`missing tutorial document ${name}`);
  }
  return step.file;
}

function framesFor(doc: MosaicDocument) {
  return parseM0StringToRenderFrames(
    doc.m0,
    doc.size?.width ?? 1920,
    doc.size?.height ?? 1080,
  );
}

describe("renderScreencapGridV2Tutorial", () => {
  it("returns the designed eight-page sequence in teaching order", () => {
    const pipeline = renderScreencapGridV2Tutorial(makeCtx());
    expect(pipeline.kind).toBe("mosaic_pipeline");
    expect(pipeline.steps.map((step) => step.name)).toEqual(STEP_NAMES);
    expect(pipeline.emit).toBeUndefined();
  });

  it("owns a fixed 33-second pace independent of form duration", () => {
    const short = renderScreencapGridV2Tutorial(
      makeCtx({ durationMs: 1000 }),
    );
    const long = renderScreencapGridV2Tutorial(
      makeCtx({ durationMs: 600_000 }),
    );
    expect(short.durationMs).toBe(long.durationMs);
    expect(short.durationMs).toBe(33_000);
    expect(short.durationMs).toBe(
      short.steps.reduce((sum, step) => sum + step.durationMs, 0),
    );
    for (const step of short.steps) {
      expect(step.durationMs).toBeGreaterThan(0);
    }
  });

  it("emits valid leaf-aligned documents at landscape, portrait, and compact sizes", () => {
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 640, height: 360 },
      { width: 360, height: 640 },
    ]) {
      const pipeline = renderScreencapGridV2Tutorial(makeCtx(size));
      for (const step of pipeline.steps) {
        expect(step.file?.kind).toBe("mosaic_document");
        const doc = step.file as MosaicDocument;
        expect(doc.size).toEqual(size);
        expect(isValidM0String(doc.m0)).toBe(true);
        expect(framesFor(doc).length).toBe(doc.sources.length);
      }
    }
  });

  it("teaches directory input, multi-file fan-out, both outputs, all primary groups, and custom m0", () => {
    const pipeline = renderScreencapGridV2Tutorial(makeCtx());
    const text = pipeline.steps
      .flatMap((step) => (step.file as MosaicDocument).sources)
      .filter(
        (source): source is MosaicTextSource => source.type === "text",
      )
      .flatMap((source) =>
        source.layers.map((layer) =>
          layer.content.kind === "literal" ? layer.content.text : "",
        ),
      )
      .join(" ");
    for (const concept of [
      "Source(s)",
      "directory",
      "multi-select",
      "N inputs",
      "N outputs",
      "PNG",
      "MP4",
      "Rows",
      "Cols",
      "Gap",
      "Fit",
      "Info Pane",
      "timestamp corner",
      "Custom Grid",
      "authored m0",
    ]) {
      expect(text).toContain(concept);
    }
  });

  it("draws the layout page as sixteen real footage windows in four row bands", () => {
    const doc = documentAt(
      renderScreencapGridV2Tutorial(makeCtx()),
      "layout",
    );
    const frames = framesFor(doc);
    const windows = doc.sources
      .map((source, index) =>
        (sourceLabel(source) ?? "").startsWith("layout tile") ? index : -1,
      )
      .filter((index) => index >= 0);
    expect(windows).toHaveLength(16);
    for (const index of windows) {
      const src = doc.sources[index] as {
        placement?: { sourceRect?: { w: number; h: number } };
      };
      expect(src.placement?.sourceRect).toBeDefined();
    }
    // Four row bands (coarse buckets absorb the highlight frame's inset).
    const bands = new Set(windows.map((index) => Math.round(frames[index].y / 60)));
    expect(bands.size).toBe(4);
  });

  it("shows the REAL pane strip above three chip-bearing footage strips", () => {
    const doc = documentAt(
      renderScreencapGridV2Tutorial(makeCtx()),
      "details",
    );
    const frames = framesFor(doc);
    const paneIndex = doc.sources.findIndex(
      (source) => sourceLabel(source) === "real info pane strip",
    );
    expect(paneIndex).toBeGreaterThanOrEqual(0);
    const paneSrc = doc.sources[paneIndex] as {
      placement?: { sourceRect?: { y: number } };
    };
    // The pane visual is the registered render's own pane pixels.
    expect(paneSrc.placement?.sourceRect?.y).toBe(0);

    const chipIndexes = doc.sources
      .map((source, index) =>
        (sourceLabel(source) ?? "").startsWith("chip 00:") ? index : -1,
      )
      .filter((index) => index >= 0);
    expect(chipIndexes).toHaveLength(3);
    const pane = frames[paneIndex];
    for (const chipIndex of chipIndexes) {
      const tile = frames[chipIndex - 1];
      const chip = frames[chipIndex];
      expect(pane.y + pane.height).toBeLessThanOrEqual(tile.y);
      expect(chip.x).toBeGreaterThanOrEqual(tile.x);
      expect(chip.y).toBeGreaterThanOrEqual(tile.y);
      expect(chip.x + chip.width).toBeLessThanOrEqual(tile.x + tile.width + 1);
      expect(chip.y + chip.height).toBeLessThanOrEqual(tile.y + tile.height + 1);
      expect(tile.height).toBeGreaterThan(chip.height);
    }
  });

  it("shows multi-file fan-out as aligned source and output rows", () => {
    const doc = documentAt(
      renderScreencapGridV2Tutorial(makeCtx()),
      "batch",
    );
    const frames = framesFor(doc);
    const sourceFrames = doc.sources
      .map((source, index) =>
        sourceLabel(source) === "source file" ? frames[index] : null,
      )
      .filter((frame): frame is NonNullable<typeof frame> => frame != null);
    const outputFrames = doc.sources
      .map((source, index) =>
        sourceLabel(source) === "output file" ? frames[index] : null,
      )
      .filter((frame): frame is NonNullable<typeof frame> => frame != null);
    expect(sourceFrames).toHaveLength(3);
    expect(outputFrames).toHaveLength(3);
    expect(new Set(sourceFrames.map((frame) => frame.y)).size).toBe(1);
    expect(new Set(outputFrames.map((frame) => frame.y)).size).toBe(1);
    expect(outputFrames[0].y).toBeGreaterThan(sourceFrames[0].y);
  });

  it("stacks a real PNG sheet card over six playing MP4 windows", () => {
    const doc = documentAt(
      renderScreencapGridV2Tutorial(makeCtx()),
      "output",
    );
    const frames = framesFor(doc);
    const pngIndex = doc.sources.findIndex(
      (source) => sourceLabel(source) === "png",
    );
    const mp4Index = doc.sources.findIndex(
      (source) => sourceLabel(source) === "mp4",
    );
    expect(pngIndex).toBeGreaterThanOrEqual(0);
    expect(mp4Index).toBeGreaterThan(pngIndex);
    // Cards are stacked now (side-by-side made the playing tiles portrait).
    expect(frames[mp4Index].y).toBeGreaterThan(frames[pngIndex].y);

    const sheet = doc.sources.filter(
      (source) => sourceLabel(source) === "png contact sheet",
    );
    expect(sheet).toHaveLength(1);
    const playing = doc.sources.filter(
      (source) => sourceLabel(source) === "playing tile",
    );
    expect(playing).toHaveLength(6);
  });

  it("shows cover filling and contain letterboxing the same real frame", () => {
    const doc = documentAt(
      renderScreencapGridV2Tutorial(makeCtx()),
      "tiles",
    );
    const frames = framesFor(doc);
    const coverIndex = doc.sources.findIndex(
      (source) => sourceLabel(source) === "cover cropped frame",
    );
    const containIndex = doc.sources.findIndex(
      (source) => sourceLabel(source) === "contain letterboxed frame",
    );
    expect(coverIndex).toBeGreaterThanOrEqual(0);
    expect(containIndex).toBeGreaterThan(coverIndex);
    // Stacked cards: contain sits below cover; its letterbox bands squeeze
    // the visible frame narrower than the cover row's full-bleed window.
    expect(frames[containIndex].y).toBeGreaterThan(frames[coverIndex].y);
    expect(frames[containIndex].width).toBeLessThan(frames[coverIndex].width);
  });

  it("shows custom m0 as unequal real cells in document order", () => {
    const doc = documentAt(
      renderScreencapGridV2Tutorial(makeCtx()),
      "custom-grid",
    );
    const frames = framesFor(doc);
    const cell = (number: string) => {
      const index = doc.sources.findIndex(
        (source) => sourceLabel(source) === `custom cell ${number}`,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      return frames[index];
    };
    const first = cell("1");
    const second = cell("2");
    const third = cell("3");
    expect(first.height).toBeGreaterThan(second.height);
    expect(second.y).toBeLessThan(third.y);
    expect(second.x).toBeGreaterThan(first.x);
  });

  it("uses static SVG text, verified glyphs, and subtle canonical entrances", () => {
    const pipeline = renderScreencapGridV2Tutorial(makeCtx());
    for (const step of pipeline.steps) {
      const doc = step.file as MosaicDocument;
      const textSources = doc.sources.filter(
        (source): source is MosaicTextSource => source.type === "text",
      );
      expect(textSources.length).toBeGreaterThan(4);
      for (const source of textSources) {
        expect(source.rasterizer).toBe("svg");
        expect(source.layers).toHaveLength(1);
        const content = source.layers[0].content;
        const text = content.kind === "literal" ? content.text : "";
        expect(text).toMatch(SUPPORTED_COPY);
        expect(text).not.toContain("→");
      }
      expect(
        doc.sources.some(
          (source) =>
            "overlay" in source && source.overlay?.alpha != null,
        ),
      ).toBe(true);
    }
  });

  it("is deterministic and never emits an error page", () => {
    const first = renderScreencapGridV2Tutorial(makeCtx());
    const second = renderScreencapGridV2Tutorial(makeCtx());
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain('"renderStatus":"error"');
  });
});
