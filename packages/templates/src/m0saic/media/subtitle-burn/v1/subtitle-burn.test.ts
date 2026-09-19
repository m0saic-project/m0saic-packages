import type {
  MosaicDataSource,
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaMetadata,
  MosaicSubtitleCue,
  MosaicSubtitleTrack,
  MosaicTelemetryEvent,
  MosaicTelemetrySink,
  MosaicTextSource,
  MosaicMediaSource,
} from "@m0saic/types";
import {
  SubtitleBurn,
  offsetCuesToOutput,
  selectSubtitleTrack,
  fitCueText,
} from "./subtitle-burn";
import { textEmUnits } from "@m0saic/template-utils";

async function renderDoc(
  props: Parameters<typeof SubtitleBurn.render>[0],
  ctx: MosaicEngineContext,
): Promise<MosaicDocument> {
  const out = await SubtitleBurn.render(props, ctx);
  if (out.kind !== "mosaic_document") {
    throw new Error("SubtitleBurn returned non-document; v1 always produces a MosaicDocument.");
  }
  return out;
}

function makeMeta(
  cues: MosaicSubtitleCue[] | undefined,
  partial?: Partial<MosaicMediaMetadata>,
): MosaicMediaMetadata {
  return {
    kind: "video",
    width: 1920,
    height: 1080,
    hasVideo: true,
    hasAudio: true,
    durationMs: 30000,
    fps: 30,
    originalFileName: "clip.mkv",
    subtitles: cues
      ? [{ stream: { streamIndex: 2, codecName: "mov_text", language: "eng" }, cues }]
      : undefined,
    ...partial,
  };
}

function makeTrack(
  language: string,
  cues: MosaicSubtitleCue[],
  flags: { default?: boolean; forced?: boolean } = {},
  streamIndex = 2,
): MosaicSubtitleTrack {
  return {
    stream: {
      streamIndex,
      codecName: "subrip",
      language,
      default: flags.default,
      forced: flags.forced,
    },
    cues,
  };
}

function makeCtx(
  media: Record<string, MosaicMediaMetadata>,
  durationMs = 30000,
  telemetry?: MosaicTelemetrySink,
): MosaicEngineContext {
  return {
    mode: "render",
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs,
      workspaceDir: "/tmp/m0saic-test",
    },
    target: { width: 1920, height: 1080, fps: 30, durationMs },
    media: media as any,
    telemetry,
  };
}

function makeCapturingSink(): {
  sink: MosaicTelemetrySink;
  events: MosaicTelemetryEvent[];
} {
  const events: MosaicTelemetryEvent[] = [];
  return { events, sink: { emit: (e) => events.push(e) } };
}

function templateEventNames(events: MosaicTelemetryEvent[]): string[] {
  return events
    .filter((e) => e.kind === "template_log")
    .map((e) => {
      if (e.kind !== "template_log") return null;
      const data = e.payload.data ?? {};
      return typeof data.event === "string" ? data.event : null;
    })
    .filter((s): s is string => s !== null);
}

describe("SubtitleBurn template", () => {
  it("emits a text source with one layer per cue when subtitles are present", async () => {
    const cues: MosaicSubtitleCue[] = [
      { startMs: 1000, endMs: 4000, text: "First cue" },
      { startMs: 5000, endMs: 8000, text: "Second cue" },
      { startMs: 10000, endMs: 13000, text: "Third cue" },
    ];
    const ctx = makeCtx({ "/path/clip.mkv": makeMeta(cues) });

    const doc = await renderDoc(
      { sourceId: "/path/clip.mkv" },
      ctx,
    );

    expect(doc.sources.length).toBe(2);
    expect(doc.sources[0].type).toBe("media");
    const text = doc.sources[1] as MosaicTextSource;
    expect(text.type).toBe("text");
    expect(text.renderMode).toEqual({ kind: "video" });
    expect(text.layers.length).toBe(3);
    expect(text.layers[0].overlay?.enable).toBe("between(t,1.000,4.000)");
    expect(text.layers[1].overlay?.enable).toBe("between(t,5.000,8.000)");
    expect(text.layers[2].overlay?.enable).toBe("between(t,10.000,13.000)");
  });

  it("falls through to pass-through (no text source) when the source has no subtitles", async () => {
    const ctx = makeCtx({ "/path/clip.mp4": makeMeta(undefined) });

    const doc = await renderDoc(
      { sourceId: "/path/clip.mp4" },
      ctx,
    );

    expect(doc.sources.length).toBe(1);
    expect(doc.sources[0].type).toBe("media");
    // m0 is a canonicalized handle (not the raw "F"); we just assert
    // pass-through shape via the single media source above.
  });

  it("clamps cues to the USER's explicit duration window (duration-follow otherwise keeps them)", async () => {
    const cues: MosaicSubtitleCue[] = [
      { startMs: 1000, endMs: 4000, text: "in window" },
      { startMs: 8000, endMs: 12000, text: "spans the edge" },
      { startMs: 15000, endMs: 20000, text: "past the end" },
    ];
    // Gate 26: with no explicit user duration the doc now FOLLOWS the
    // source length (all three cues survive), so the clamp contract is
    // exercised under an explicit userIntent duration.
    const ctx = makeCtx({ "/path/clip.mkv": makeMeta(cues) }, 10000);
    (ctx as { userIntent?: { durationMs?: number } }).userIntent = { durationMs: 10000 };

    const doc = await renderDoc(
      { sourceId: "/path/clip.mkv" },
      ctx,
    );

    const text = doc.sources[1] as MosaicTextSource;
    expect(text.layers.length).toBe(2);
    expect(text.layers[0].overlay?.enable).toBe("between(t,1.000,4.000)");
    // Clamped: end = 10s (the user's window)
    expect(text.layers[1].overlay?.enable).toBe("between(t,8.000,10.000)");
  });

  it("auto-resolves sourceId to the first video with subtitles when not specified", async () => {
    const ctx = makeCtx({
      "/path/silent.mp4": makeMeta(undefined),
      "/path/has-subs.mkv": makeMeta([
        { startMs: 0, endMs: 2000, text: "Auto-picked" },
      ]),
    });

    const doc = await renderDoc({}, ctx);
    const text = doc.sources[1] as MosaicTextSource;
    expect(text.layers.length).toBe(1);
    expect(text.layers[0].content).toEqual({ kind: "literal", text: "Auto-picked" });
    // The media source assetId is derived from "/path/has-subs.mkv"
    const media = doc.sources[0] as MosaicMediaSource;
    expect(media.type).toBe("media");
  });

  it("places subtitles at the top when placement='top'", async () => {
    const cues: MosaicSubtitleCue[] = [
      { startMs: 0, endMs: 1000, text: "up top" },
    ];
    const ctx = makeCtx({ "/c.mkv": makeMeta(cues) });

    const doc = await renderDoc(
      { sourceId: "/c.mkv", placement: "top" },
      ctx,
    );

    const text = doc.sources[1] as MosaicTextSource;
    expect(text.layers[0].placement?.vAlign).toBe("top");
  });

  it("returns an error mosaic when ctx.media has no video source at all", async () => {
    const ctx = makeCtx({});
    const doc = await renderDoc({}, ctx);
    // makeErrorMosaic still produces a MosaicDocument; smoke check it didn't throw.
    expect(doc.kind).toBe("mosaic_document");
  });
});

describe("selectSubtitleTrack", () => {
  const eng = makeTrack("eng", [{ startMs: 0, endMs: 1000, text: "en" }]);
  const spa = makeTrack("spa", [{ startMs: 0, endMs: 1000, text: "es" }], {}, 3);
  const fra = makeTrack("fra", [{ startMs: 0, endMs: 1000, text: "fr" }], { default: true }, 4);

  it("returns undefined when there are no tracks", () => {
    expect(selectSubtitleTrack(undefined, {})).toEqual({ track: undefined, rule: "no-tracks" });
    expect(selectSubtitleTrack([], {})).toEqual({ track: undefined, rule: "no-tracks" });
  });

  it("uses trackIndex as the highest-priority override", () => {
    const r = selectSubtitleTrack([eng, spa, fra], {
      trackIndex: 1,
      languageCode: "eng", // ignored
    });
    expect(r.track).toBe(spa);
    expect(r.rule).toBe("explicit-index");
  });

  it("matches by languageCode (3-letter)", () => {
    const r = selectSubtitleTrack([eng, spa, fra], { languageCode: "spa" });
    expect(r.track).toBe(spa);
    expect(r.rule).toBe("language-match");
  });

  it("matches by languageCode (2-letter via normalization)", () => {
    const r = selectSubtitleTrack([eng, spa, fra], { languageCode: "fr" });
    expect(r.track).toBe(fra);
    expect(r.rule).toBe("language-match");
  });

  it("matches by languageCode (locale suffix stripped)", () => {
    const r = selectSubtitleTrack([eng, spa, fra], { languageCode: "en-US" });
    expect(r.track).toBe(eng);
    expect(r.rule).toBe("language-match");
  });

  it("falls back to default-flagged track when languageCode misses (fallbackToDefault default true)", () => {
    const r = selectSubtitleTrack([eng, spa, fra], { languageCode: "jpn", fallbackToDefault: true });
    expect(r.track).toBe(fra);
    expect(r.rule).toBe("default-flagged");
  });

  it("falls back to first track when languageCode misses and no default is flagged", () => {
    const r = selectSubtitleTrack([eng, spa], { languageCode: "jpn", fallbackToDefault: true });
    expect(r.track).toBe(eng);
    expect(r.rule).toBe("first-track");
  });

  it("returns undefined when languageCode misses and fallbackToDefault is false", () => {
    const r = selectSubtitleTrack([eng, spa, fra], { languageCode: "jpn", fallbackToDefault: false });
    expect(r.track).toBeUndefined();
    expect(r.rule).toBe("language-miss-strict");
  });

  it("with no preference set, picks the default-flagged track", () => {
    const r = selectSubtitleTrack([eng, spa, fra], {});
    expect(r.track).toBe(fra);
    expect(r.rule).toBe("default-flagged");
  });

  it("with no preference and no default flag, picks the first track", () => {
    const r = selectSubtitleTrack([eng, spa], {});
    expect(r.track).toBe(eng);
    expect(r.rule).toBe("first-track");
  });
});

describe("SubtitleBurn — language selection (rendered)", () => {
  it("renders cues from the language-matched track", async () => {
    const meta = makeMeta(undefined);
    meta.subtitles = [
      makeTrack("eng", [{ startMs: 0, endMs: 1000, text: "english cue" }]),
      makeTrack("spa", [{ startMs: 0, endMs: 1000, text: "spanish cue" }], {}, 3),
    ];
    const ctx = makeCtx({ "/c.mkv": meta });

    const doc = await renderDoc(
      { sourceId: "/c.mkv", languageCode: "spa" },
      ctx,
    );

    const text = doc.sources[1] as MosaicTextSource;
    expect(text.layers[0].content).toEqual({ kind: "literal", text: "spanish cue" });
  });

  it("passes through when languageCode misses and fallbackToDefault=false", async () => {
    const meta = makeMeta(undefined);
    meta.subtitles = [
      makeTrack("eng", [{ startMs: 0, endMs: 1000, text: "english cue" }]),
    ];
    const ctx = makeCtx({ "/c.mkv": meta });

    const doc = await renderDoc(
      { sourceId: "/c.mkv", languageCode: "jpn", fallbackToDefault: false },
      ctx,
    );

    expect(doc.sources.length).toBe(1);
    expect(doc.sources[0].type).toBe("media");
  });

  it("falls back to default-flagged track when languageCode misses (default behavior)", async () => {
    const meta = makeMeta(undefined);
    meta.subtitles = [
      makeTrack("eng", [{ startMs: 0, endMs: 1000, text: "english fallback" }], {
        default: true,
      }),
      makeTrack("spa", [{ startMs: 0, endMs: 1000, text: "spanish cue" }], {}, 3),
    ];
    const ctx = makeCtx({ "/c.mkv": meta });

    const doc = await renderDoc({ sourceId: "/c.mkv", languageCode: "jpn" }, ctx);
    const text = doc.sources[1] as MosaicTextSource;
    expect(text.layers[0].content).toEqual({ kind: "literal", text: "english fallback" });
  });
});

describe("SubtitleBurn — cue emission (emitCues)", () => {
  it("appends a MosaicDataSource with alias 'subtitleCues' when emitCues:true and a track is selected", async () => {
    const cues: MosaicSubtitleCue[] = [
      { startMs: 1000, endMs: 4000, text: "First" },
      { startMs: 5000, endMs: 7000, text: "Second" },
    ];
    const ctx = makeCtx({ "/c.mkv": makeMeta(cues) });
    const doc = await renderDoc({ sourceId: "/c.mkv", emitCues: true }, ctx);

    const dataSource = doc.sources.find((s) => s.type === "data") as
      | MosaicDataSource
      | undefined;
    expect(dataSource).toBeDefined();
    expect(String(dataSource!.alias)).toBe("subtitleCues");
    expect(dataSource!.variables.language).toBe("eng");
    expect(dataSource!.variables.codec).toBe("mov_text");
    expect((dataSource!.variables.cues as MosaicSubtitleCue[]).length).toBe(2);
    // No preference set + fixture has no default flag → rule is "first-track".
    expect(dataSource!.variables.selectionRule).toBe("first-track");
  });

  it("populates doc.sidecars.cues with the same shape when emitCues:true", async () => {
    const cues: MosaicSubtitleCue[] = [
      { startMs: 0, endMs: 1000, text: "x" },
    ];
    const ctx = makeCtx({ "/c.mkv": makeMeta(cues) });
    const doc = await renderDoc({ sourceId: "/c.mkv", emitCues: true }, ctx);

    expect(doc.sidecars).toBeDefined();
    expect(doc.sidecars!.cues).toBeDefined();
    const sidecarPayload = doc.sidecars!.cues as Record<string, unknown>;
    expect(sidecarPayload.language).toBe("eng");
    expect(sidecarPayload.codec).toBe("mov_text");
    expect((sidecarPayload.cues as MosaicSubtitleCue[]).length).toBe(1);
  });

  it("emits NEITHER channel when emitCues is omitted (default false)", async () => {
    const cues: MosaicSubtitleCue[] = [
      { startMs: 0, endMs: 1000, text: "x" },
    ];
    const ctx = makeCtx({ "/c.mkv": makeMeta(cues) });
    const doc = await renderDoc({ sourceId: "/c.mkv" }, ctx);

    expect(doc.sources.find((s) => s.type === "data")).toBeUndefined();
    expect(doc.sidecars).toBeUndefined();
  });

  it("emits NEITHER channel when emitCues:true but no track is selected (pass-through case)", async () => {
    // No subtitle tracks at all
    const ctx = makeCtx({ "/c.mp4": makeMeta(undefined) });
    const doc = await renderDoc({ sourceId: "/c.mp4", emitCues: true }, ctx);

    expect(doc.sources.find((s) => s.type === "data")).toBeUndefined();
    expect(doc.sidecars).toBeUndefined();
  });

  it("stamps the selection rule into the published payload (language-match)", async () => {
    const meta = makeMeta(undefined);
    meta.subtitles = [
      makeTrack("eng", [{ startMs: 0, endMs: 500, text: "en" }]),
      makeTrack("fra", [{ startMs: 0, endMs: 500, text: "fr" }], {}, 3),
    ];
    const ctx = makeCtx({ "/c.mkv": meta });
    const doc = await renderDoc(
      { sourceId: "/c.mkv", languageCode: "fre", emitCues: true },
      ctx,
    );

    const dataSource = doc.sources.find((s) => s.type === "data") as MosaicDataSource;
    expect(dataSource.variables.selectionRule).toBe("language-match");
    expect(dataSource.variables.language).toBe("fra");
  });
});

describe("offsetCuesToOutput", () => {
  const cs = (startMs: number, endMs: number, text = "x"): MosaicSubtitleCue => ({
    startMs,
    endMs,
    text,
  });

  it("returns [] for empty input", () => {
    expect(offsetCuesToOutput([], 0, 10000, 10000)).toEqual([]);
  });

  it("passes through when clip is [0, durationMs] (degenerate clip)", () => {
    const cues = [cs(1000, 4000, "a"), cs(5000, 7000, "b")];
    expect(offsetCuesToOutput(cues, 0, 10000, 10000)).toEqual([
      { startMs: 1000, endMs: 4000, text: "a" },
      { startMs: 5000, endMs: 7000, text: "b" },
    ]);
  });

  it("offsets cue times by clipStartMs and clamps to [0, durationMs]", () => {
    // Source cue at 35-38s, clip [30s, 45s], render 10s output.
    // Expected: cue appears at output-time 5-8s.
    const cues = [cs(35000, 38000, "in clip")];
    expect(offsetCuesToOutput(cues, 30000, 45000, 10000)).toEqual([
      { startMs: 5000, endMs: 8000, text: "in clip" },
    ]);
  });

  it("drops cues that fall entirely outside the clip window", () => {
    const cues = [
      cs(1000, 2000, "before"),     // before clip start
      cs(35000, 38000, "in clip"),
      cs(60000, 62000, "after"),    // after clip end
    ];
    const out = offsetCuesToOutput(cues, 30000, 45000, 15000);
    expect(out.length).toBe(1);
    expect(out[0].text).toBe("in clip");
    expect(out[0].startMs).toBe(5000);
  });

  it("trims cues that span the clip start (cue starts before clipStartMs)", () => {
    // Cue at 28-32s, clip starts at 30s → cue appears at 0-2s in output.
    const cues = [cs(28000, 32000, "spans start")];
    expect(offsetCuesToOutput(cues, 30000, 45000, 15000)).toEqual([
      { startMs: 0, endMs: 2000, text: "spans start" },
    ]);
  });

  it("trims cues that span the clip end (cue ends after clipEndMs)", () => {
    // Cue at 44-50s, clip ends at 45s → cue appears at 14-15s in output.
    const cues = [cs(44000, 50000, "spans end")];
    expect(offsetCuesToOutput(cues, 30000, 45000, 15000)).toEqual([
      { startMs: 14000, endMs: 15000, text: "spans end" },
    ]);
  });

  it("clamps to renderEnd when output window is shorter than clip", () => {
    // Clip is 15s but render only 10s → cue at source-time 42-44s
    // (12-14s in clip-time, but output capped at 10s) is dropped entirely.
    const cues = [cs(42000, 44000, "past render")];
    expect(offsetCuesToOutput(cues, 30000, 45000, 10000)).toEqual([]);
  });

  it("drops empty-text cues defensively", () => {
    expect(offsetCuesToOutput([cs(0, 1000, "")], 0, 1000, 1000)).toEqual([]);
  });

  it("clamps negative clipStartMs to 0", () => {
    expect(offsetCuesToOutput([cs(500, 1500, "x")], -1000, 2000, 10000)).toEqual([
      { startMs: 500, endMs: 1500, text: "x" },
    ]);
  });
});

describe("SubtitleBurn — clip window (clipStartMs / clipEndMs / clipLoopMode)", () => {
  function metaWithCuesAtSourceTime(
    cues: MosaicSubtitleCue[],
  ): MosaicMediaMetadata {
    return makeMeta(undefined, {
      durationMs: 60000,
      subtitles: [
        {
          stream: { streamIndex: 2, codecName: "mov_text", language: "eng" },
          cues,
        },
      ],
    });
  }

  it("emits playback.clipStartMs / clipDurationMs / loopMode on the media source", async () => {
    const meta = metaWithCuesAtSourceTime([]);
    const ctx = makeCtx({ "/c.mkv": meta }, 10000);
    const doc = await renderDoc(
      { sourceId: "/c.mkv", clipStartMs: 30000, clipEndMs: 45000 },
      ctx,
    );
    const media = doc.sources[0] as MosaicMediaSource;
    expect(media.playback).toEqual({
      clipStartMs: 30000,
      clipDurationMs: 15000,
      loopMode: "cut", // default
    });
  });

  it("honors clipLoopMode prop", async () => {
    const ctx = makeCtx({ "/c.mkv": metaWithCuesAtSourceTime([]) }, 10000);
    const doc = await renderDoc(
      {
        sourceId: "/c.mkv",
        clipStartMs: 30000,
        clipEndMs: 45000,
        clipLoopMode: "loop",
      },
      ctx,
    );
    const media = doc.sources[0] as MosaicMediaSource;
    expect(media.playback?.loopMode).toBe("loop");
  });

  it("renders cues at output-relative times when a clip window is set", async () => {
    const meta = metaWithCuesAtSourceTime([
      { startMs: 31000, endMs: 33000, text: "early" },
      { startMs: 40000, endMs: 42000, text: "later" },
    ]);
    const ctx = makeCtx({ "/c.mkv": meta }, 15000);
    const doc = await renderDoc(
      { sourceId: "/c.mkv", clipStartMs: 30000, clipEndMs: 45000 },
      ctx,
    );
    const text = doc.sources[1] as MosaicTextSource;
    expect(text.layers.length).toBe(2);
    // Source-time 31-33s → output-time 1-3s. Source-time 40-42s → 10-12s.
    expect(text.layers[0].overlay?.enable).toBe("between(t,1.000,3.000)");
    expect(text.layers[1].overlay?.enable).toBe("between(t,10.000,12.000)");
  });

  it("drops cues outside the clip window entirely", async () => {
    const meta = metaWithCuesAtSourceTime([
      { startMs: 1000, endMs: 2000, text: "before" },
      { startMs: 35000, endMs: 36000, text: "in" },
      { startMs: 50000, endMs: 51000, text: "after" },
    ]);
    const ctx = makeCtx({ "/c.mkv": meta }, 15000);
    const doc = await renderDoc(
      { sourceId: "/c.mkv", clipStartMs: 30000, clipEndMs: 45000 },
      ctx,
    );
    const text = doc.sources[1] as MosaicTextSource;
    expect(text.layers.length).toBe(1);
    expect(text.layers[0].content).toEqual({ kind: "literal", text: "in" });
  });

  it("returns error mosaic when clipEndMs <= clipStartMs", async () => {
    const ctx = makeCtx({ "/c.mkv": metaWithCuesAtSourceTime([]) });
    const doc = await renderDoc(
      { sourceId: "/c.mkv", clipStartMs: 5000, clipEndMs: 5000 },
      ctx,
    );
    // makeErrorMosaic still returns a MosaicDocument; the data source is the
    // error placeholder, not the clipped media — assert by absence of playback.
    const media = doc.sources[0];
    expect(media).toBeDefined();
    expect(media.type === "media" ? (media as MosaicMediaSource).playback : undefined).toBeUndefined();
  });

  it("emits a clip_applied telemetry event when a clip is active", async () => {
    const { sink, events } = makeCapturingSink();
    const meta = metaWithCuesAtSourceTime([
      { startMs: 35000, endMs: 36000, text: "x" },
    ]);
    const ctx = makeCtx({ "/c.mkv": meta }, 15000, sink);
    await renderDoc(
      { sourceId: "/c.mkv", clipStartMs: 30000, clipEndMs: 45000, clipLoopMode: "freeze" },
      ctx,
    );
    const names = templateEventNames(events);
    expect(names).toContain("clip_applied");
    const ev = events.find(
      (e) => e.kind === "template_log" && (e.payload.data as any)?.event === "clip_applied",
    );
    if (ev?.kind === "template_log") {
      const data = ev.payload.data as any;
      expect(data.clipStartMs).toBe(30000);
      expect(data.clipEndMs).toBe(45000);
      expect(data.clipDurationMs).toBe(15000);
      expect(data.clipLoopMode).toBe("freeze");
    }
  });

  it("does NOT emit clip_applied when no clip is set", async () => {
    const { sink, events } = makeCapturingSink();
    const ctx = makeCtx(
      { "/c.mkv": metaWithCuesAtSourceTime([{ startMs: 0, endMs: 100, text: "x" }]) },
      10000,
      sink,
    );
    await renderDoc({ sourceId: "/c.mkv" }, ctx);
    expect(templateEventNames(events)).not.toContain("clip_applied");
  });

  it("clip context lands in the cues payload when emitCues:true", async () => {
    const meta = metaWithCuesAtSourceTime([
      { startMs: 35000, endMs: 36000, text: "x" },
    ]);
    const ctx = makeCtx({ "/c.mkv": meta }, 15000);
    const doc = await renderDoc(
      {
        sourceId: "/c.mkv",
        clipStartMs: 30000,
        clipEndMs: 45000,
        emitCues: true,
      },
      ctx,
    );
    const data = doc.sources.find((s) => s.type === "data") as MosaicDataSource;
    expect(data).toBeDefined();
    expect(data.variables.clip).toEqual({
      startMs: 30000,
      endMs: 45000,
      durationMs: 15000,
      loopMode: "cut",
    });
  });
});

describe("SubtitleBurn — telemetry emits", () => {
  it("emits tracks_discovered + track_selected + cues_filtered on a normal render", async () => {
    const { sink, events } = makeCapturingSink();
    const cues: MosaicSubtitleCue[] = [
      { startMs: 1000, endMs: 4000, text: "First" },
    ];
    const ctx = makeCtx({ "/c.mkv": makeMeta(cues) }, 30000, sink);
    await renderDoc({ sourceId: "/c.mkv" }, ctx);

    expect(templateEventNames(events)).toEqual([
      "tracks_discovered",
      "track_selected",
      "cues_filtered",
    ]);
  });

  it("emits a 'passthrough' event when no track is selected", async () => {
    const { sink, events } = makeCapturingSink();
    const ctx = makeCtx({ "/c.mp4": makeMeta(undefined) }, 30000, sink);
    await renderDoc({ sourceId: "/c.mp4" }, ctx);

    const names = templateEventNames(events);
    expect(names).toContain("passthrough");
    // passthrough fires AFTER cues_filtered in the render flow:
    expect(names.indexOf("passthrough")).toBeGreaterThan(names.indexOf("cues_filtered"));
  });

  it("emits a 'passthrough' event for no-video-source short-circuit", async () => {
    const { sink, events } = makeCapturingSink();
    const ctx = makeCtx({}, 30000, sink);
    await renderDoc({}, ctx);

    const names = templateEventNames(events);
    expect(names).toEqual(["passthrough"]);
    const passthrough = events.find(
      (e) => e.kind === "template_log" && (e.payload.data as any)?.event === "passthrough",
    );
    if (passthrough?.kind === "template_log") {
      expect((passthrough.payload.data as any).reason).toBe("no-video-source");
    }
  });

  it("track_selected payload includes language/codec/rule", async () => {
    const { sink, events } = makeCapturingSink();
    const meta = makeMeta(undefined);
    meta.subtitles = [
      makeTrack("eng", [{ startMs: 0, endMs: 500, text: "en" }]),
      makeTrack("fra", [{ startMs: 0, endMs: 500, text: "fr" }], {}, 3),
    ];
    const ctx = makeCtx({ "/c.mkv": meta }, 30000, sink);
    await renderDoc({ sourceId: "/c.mkv", languageCode: "fre" }, ctx);

    const sel = events.find(
      (e) => e.kind === "template_log" && (e.payload.data as any)?.event === "track_selected",
    );
    expect(sel).toBeDefined();
    if (sel?.kind === "template_log") {
      const data = sel.payload.data as any;
      expect(data.rule).toBe("language-match");
      expect(data.language).toBe("fra");
      expect(data.codec).toBe("subrip");
      expect(data.requestedLanguageCode).toBe("fre");
    }
  });

  it("is safe when ctx.telemetry is absent (no-op sink)", async () => {
    const ctx = makeCtx({ "/c.mkv": makeMeta([{ startMs: 0, endMs: 100, text: "x" }]) });
    await expect(renderDoc({ sourceId: "/c.mkv" }, ctx)).resolves.toBeDefined();
  });
});

describe("gate-26: cue text fit (wrap-first, bounded font step)", () => {
  const LONG =
    "This is a deliberately very long subtitle line that keeps going and going to probe whether the burn path fits text to the frame width or silently clips it";

  it("short cues pass through byte-identical", () => {
    expect(fitCueText("Hello from the reel.", 1280, 49)).toEqual({
      text: "Hello from the reel.",
      fontSize: 49,
    });
  });

  it("authored multi-line cues that fit stay untouched", () => {
    const text = "Two lines here:\nthe second one sits below.";
    expect(fitCueText(text, 1280, 49).text).toBe(text);
  });

  it("a long single line wraps — every line fits the width at the returned font, no words lost", () => {
    const fit = fitCueText(LONG, 1280, 49);
    const lines = fit.text.split("\n");
    // This cue cannot make 3 lines at 49px, so the bounded step fires…
    expect(fit.fontSize).toBe(Math.round(49 * 0.75));
    expect(lines.length).toBeGreaterThan(1);
    // …and the no-clip guarantee holds: every line within the em budget
    // for the RETURNED font (the whole point of the fix).
    const budget = (1280 * 0.9) / (fit.fontSize * 0.62);
    for (const line of lines) {
      expect(textEmUnits(line)).toBeLessThanOrEqual(budget + 0.5);
    }
    // No words lost.
    expect(fit.text.replace(/\n/g, " ")).toBe(LONG);
  });

  it("a pathological cue steps the font down once and re-wraps", () => {
    const fit = fitCueText(`${LONG} ${LONG}`, 640, 49);
    expect(fit.fontSize).toBe(Math.round(49 * 0.75));
    expect(fit.text.replace(/\n/g, " ")).toBe(`${LONG} ${LONG}`);
  });
});

describe("gate-26: the rendered doc declares its format (Make Output Type ground truth)", () => {
  it("burn and passthrough docs carry format video/mp4", async () => {
    const doc = await renderDoc(
      { sourceId: "/tmp/subbed.mkv" },
      makeCtx({ "/tmp/subbed.mkv": makeMeta([{ startMs: 0, endMs: 1000, text: "hi" }]) }),
    );
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });

    const passthrough = await renderDoc(
      { sourceId: "/tmp/plain.mp4" },
      makeCtx({ "/tmp/plain.mp4": makeMeta(undefined) }),
    );
    expect(passthrough.format).toEqual({ kind: "video", container: "mp4" });
  });
});

describe("gate-26: duration follows the source (the big-buck-bunny catch)", () => {
  it("no clip, no user override → doc authors the SOURCE duration and keeps late cues", async () => {
    const late = { startMs: 25000, endMs: 27000, text: "late cue" };
    const doc = await renderDoc(
      { sourceId: "/tmp/long.mkv" },
      makeCtx({ "/tmp/long.mkv": makeMeta([late]) }, 10000),
    );
    expect(doc.durationMs).toBe(30000);
    const text = doc.sources.find((s) => s.type === "text");
    expect(text).toBeDefined();
  });

  it("clip window → doc authors the clip length", async () => {
    const doc = await renderDoc(
      { sourceId: "/tmp/long.mkv", clipStartMs: 2000, clipEndMs: 7000 },
      makeCtx({ "/tmp/long.mkv": makeMeta([{ startMs: 3000, endMs: 4000, text: "in clip" }]) }, 10000),
    );
    expect(doc.durationMs).toBe(5000);
  });

  it("EXPLICIT user duration wins over the follow (userIntent)", async () => {
    const ctx = makeCtx({ "/tmp/long.mkv": makeMeta([{ startMs: 25000, endMs: 27000, text: "late" }]) }, 8000);
    (ctx as { userIntent?: { durationMs?: number } }).userIntent = { durationMs: 8000 };
    const doc = await renderDoc({ sourceId: "/tmp/long.mkv" }, ctx);
    expect(doc.durationMs).toBeUndefined();
    // Late cue outside the user's 8s window is dropped.
    expect(doc.sources.find((s) => s.type === "text")).toBeUndefined();
  });
});

describe("gate-26: cover", () => {
  it("renders the burned-frame hero + start tip on real material", async () => {
    const doc = await SubtitleBurn.renderCover!({}, makeCtx({}));
    if (doc.kind !== "mosaic_document") throw new Error("expected document");
    const sources = doc.sources ?? [];
    const labels = sources.map((src) => src.editor?.label ?? "");
    expect(labels).toContain("hero film frame");
    expect(labels).toContain("hero burned subtitle");
    const texts = sources
      .filter((src) => src.type === "text")
      .flatMap((src) =>
        ((src as { layers?: { content?: { text?: string } }[] }).layers ?? []).map(
          (l) => l.content?.text ?? "",
        ),
      )
      .join(" ");
    expect(texts).toContain("START HERE");
    expect(texts).toContain("Burned right onto the frame.");
    // The hero is the dedicated full-res title-card asset, not a sheet window.
    expect(doc.assets["subtitle-burn-cover-frame" as keyof typeof doc.assets]).toBeDefined();
  });
});

describe("gate-26: WRAPPED registry path preserves the source-follow duration", () => {
  it("requireTemplate render keeps the authored duration (stampOutput must not clobber)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireTemplate } = require("@m0saic/template-utils");
    const wrapped = requireTemplate("@m0saic/media/subtitle-burn/v1");
    const doc = (await wrapped.render(
      { sourceId: "/tmp/long.mkv" },
      makeCtx({ "/tmp/long.mkv": makeMeta([{ startMs: 25000, endMs: 27000, text: "late" }]) }, 10000),
    )) as MosaicDocument;
    expect(doc.kind).toBe("mosaic_document");
    // The source is 30s; the hint-derived target was 10s. The WRAPPED
    // instance is what every real path renders — gate-20 keeper: raw-object
    // tests prove nothing about production.
    expect(doc.durationMs).toBe(30000);
  });
});
