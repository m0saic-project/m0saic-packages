import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaSource,
} from "@m0saic/types";
import { buildHighlightSteps, ERROR_STEP_MS } from "./pipeline";
import type { HighlightsKnobs } from "./plan";

function mediaSource(doc: MosaicDocument): MosaicMediaSource {
  return doc.sources[0] as MosaicMediaSource;
}

const INPUT = "/abs/media/hero_1.mp4";

const KNOBS: HighlightsKnobs = { outputFormat: "mp4", muteAudio: false };

function makeCtx(): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 2000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 2000 },
    media: {},
  } as MosaicEngineContext;
}

function build(overrides?: Partial<Parameters<typeof buildHighlightSteps>[0]>) {
  return buildHighlightSteps({
    inputPath: INPUT,
    stepBaseName: "hero_1",
    ranges: [
      { startMs: 500, endMs: 2000 },
      { startMs: 3000, endMs: 4500, label: "finale" },
    ],
    sourceDurationMs: 5730,
    sourceWidth: 1280,
    sourceHeight: 720,
    knobs: KNOBS,
    ctx: makeCtx(),
    ...overrides,
  });
}

describe("buildHighlightSteps", () => {
  it("builds one positional step per range with the full doc shape", () => {
    const steps = build();
    expect(steps.map((s) => s.name)).toEqual(["hero_1__range_01", "hero_1__range_02"]);
    expect(steps.map((s) => s.durationMs)).toEqual([1500, 1500]);
    expect(steps.map((s) => s.label)).toEqual(["hero_1_0.5s-2.0s", "finale"]);

    const doc = steps[0].file as MosaicDocument;
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.m0).toContain("1");
    expect(doc.size).toEqual({ width: 1280, height: 720 });
    expect(doc.backgroundColor).toBe("#000000");
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });

    const source = mediaSource(doc);
    expect(source.type).toBe("media");
    expect(source.playback).toEqual({ clipStartMs: 500, clipDurationMs: 1500, loopMode: "cut" });
    expect(source.audio).toBeUndefined(); // passthrough — audio follows the source
    expect(Object.values(doc.assets)[0]).toEqual({
      kind: "file",
      path: INPUT,
      mediaType: "video",
    });
  });

  it("hermetic per-step docs: steps share no object identity", () => {
    const steps = build();
    const a = steps[0].file as MosaicDocument;
    const b = steps[1].file as MosaicDocument;
    expect(a).not.toBe(b);
    expect(a.sources).not.toBe(b.sources);
  });

  it("muteAudio disables audio at BOTH levels: source (mix) and doc (deliverable -an)", () => {
    const steps = build({ knobs: { ...KNOBS, muteAudio: true } });
    const doc = steps[0].file as MosaicDocument;
    expect(mediaSource(doc).audio).toEqual({ enabled: false });
    // Doc-level is the one that strips the track — source-level alone
    // ships a silent placeholder (gate-20 battery finding).
    expect(doc.audio).toEqual({ mode: "off" });
  });

  it("audio passthrough default: NO doc-level audio config", () => {
    const doc = build()[0].file as MosaicDocument;
    expect(doc.audio).toBeUndefined();
  });

  it("webm knob lands on every step's format", () => {
    const steps = build({ knobs: { ...KNOBS, outputFormat: "webm" } });
    expect((steps[0].file as MosaicDocument).format).toEqual({
      kind: "video",
      container: "webm",
    });
  });

  it("maxWidth caps the canvas aspect-preservingly", () => {
    const steps = build({ knobs: { ...KNOBS, maxWidth: 640 } });
    expect((steps[0].file as MosaicDocument).size).toEqual({ width: 640, height: 360 });
  });

  it("an invalid range degrades to an error step that keeps its slot", () => {
    const steps = build({
      ranges: [
        { startMs: 2000, endMs: 500 }, // inverted
        { startMs: 3000, endMs: 4500 },
      ],
    });
    expect(steps).toHaveLength(2);
    expect(steps[0].name).toBe("hero_1__range_01");
    expect(steps[0].durationMs).toBe(ERROR_STEP_MS);
    expect(steps[1].name).toBe("hero_1__range_02");
    expect(steps[1].durationMs).toBe(1500);
  });

  it("clamps out-of-bounds ranges to the probed duration", () => {
    const steps = build({ ranges: [{ startMs: 4000, endMs: 99_000 }] });
    expect(steps[0].durationMs).toBe(1730);
    const source = mediaSource(steps[0].file as MosaicDocument);
    expect(source.playback).toEqual({
      clipStartMs: 4000,
      clipDurationMs: 1730,
      loopMode: "cut",
    });
  });

  it("preserves range order (never sorts)", () => {
    const steps = build({
      ranges: [
        { startMs: 3000, endMs: 4500 },
        { startMs: 500, endMs: 2000 },
      ],
    });
    const starts = steps.map(
      (s) => mediaSource(s.file as MosaicDocument).playback?.clipStartMs,
    );
    expect(starts).toEqual([3000, 500]);
  });
});
