import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaMetadata,
  MosaicMediaSource,
} from "@m0saic/types";
import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";
import { templateRegistry } from "../../../../template-registry";
import { computeScrollWallGeometry } from "./geometry";
import { parseScrollXExpr } from "./motion";
import {
  ScrollWallV1,
  coprimeStride,
  fitVisibleCount,
  renderScrollWallV1,
  SCROLL_WALL_MAX_TILES,
  type ScrollWallProps,
} from "./scroll-wall";

function makeCtx(overrides?: {
  target?: Partial<MosaicEngineContext["target"]>;
  media?: Record<string, MosaicMediaMetadata>;
}): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 4000, ...overrides?.target },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 4000, workspaceDir: "." },
    media: (overrides?.media ?? {}) as MosaicEngineContext["media"],
  } as MosaicEngineContext;
}

function videoMeta(width = 1280, height = 720, durationMs = 60000): MosaicMediaMetadata {
  return { kind: "video", width, height, hasVideo: true, hasAudio: true, durationMs, fps: 30 };
}

function imageMeta(width = 800, height = 600): MosaicMediaMetadata {
  return { kind: "image", width, height, hasVideo: false, hasAudio: false };
}

const FIVE_CLIPS = ["C:/w/a.mp4", "C:/w/b.mp4", "C:/w/c.mp4", "C:/w/d.mp4", "C:/w/e.mp4"];
const fiveVideoMedia = () =>
  Object.fromEntries(FIVE_CLIPS.map((p) => [p, videoMeta()])) as Record<string, MosaicMediaMetadata>;

const isError = (doc: MosaicDocument) => JSON.stringify(doc).includes('"renderStatus":"error"');

function mediaSources(doc: MosaicDocument): MosaicMediaSource[] {
  return doc.sources.filter((s): s is MosaicMediaSource => s.type === "media");
}

describe("ScrollWallV1 metadata + registry linkage", () => {
  it("has the expected id, version, tier and tags", () => {
    expect(ScrollWallV1.id).toBe("@m0saic/media/scroll_wall/v1");
    expect(ScrollWallV1.version).toBe(1);
    expect(ScrollWallV1.deprecated).toBeUndefined();
    expect(ScrollWallV1.capabilities).toEqual({ tier: "core" });
    expect(ScrollWallV1.tags).toEqual(["media", "wall", "scroll", "loop", "montage", "animated", "creators", "marketers", "video"]);
  });

  it("declares the plan's outputHints with the video/mp4 format hint (the frozen 0.2.0 declaration)", () => {
    expect(ScrollWallV1.outputHints).toEqual({ format: { kind: "video", container: "mp4" }, width: 1920, height: 1080, fps: 30, durationMs: 4000 });
  });

  it("is linked in the curated registry under slug scroll-wall", () => {
    const entry = templateRegistry.find((e) => e.slug === "scroll-wall");
    expect(entry).toBeDefined();
    expect(entry!.templateId).toBe("@m0saic/media/scroll_wall/v1");
    expect(entry!.exportName).toBe("ScrollWallV1");
  });
});

describe("demo mode (no clips)", () => {
  it("renders a valid wall of lavfi tiles, each carrying the scroll xExpr", () => {
    const doc = renderScrollWallV1({}, makeCtx());
    expect(doc.kind).toBe("mosaic_document");
    expect(isError(doc)).toBe(false);
    expect(isValidM0String(doc.m0)).toBe(true);
    // 1920×1080 / vc4 → K=4 → minSlotCount 5; 6 demo hues → S=6; 2 rows → 12.
    expect(doc.sources).toHaveLength(12);
    for (const s of doc.sources) {
      expect(s.type).toBe("lavfi");
      const xExpr = (s as { overlay?: { xExpr?: string } }).overlay?.xExpr;
      expect(typeof xExpr).toBe("string");
      expect(() => parseScrollXExpr(xExpr!)).not.toThrow();
    }
    expect(doc.assets).toEqual({});
    expect(doc.backgroundColor).toBe("#0b0b0f");
  });
});

describe("real clips — layout + source/frame alignment", () => {
  const props: ScrollWallProps = { clips: FIVE_CLIPS };

  it("5 clips × 2 rows → 10 sources on the expected footprint rects", () => {
    const doc = renderScrollWallV1(props, makeCtx({ media: fiveVideoMedia() }));
    expect(isError(doc)).toBe(false);
    expect(doc.sources).toHaveLength(10);

    const frames = parseM0StringToRenderFrames(doc.m0, 1920, 1080);
    expect(frames).toHaveLength(10);
    const rects = frames
      .map((f) => ({ logicalIndex: f.logicalIndex, x: f.x, y: f.y, w: f.width, h: f.height }))
      .sort((a, b) => a.logicalIndex - b.logicalIndex)
      .map(({ x, y, w, h }) => ({ x, y, w, h }));
    // Layer 0 = wrap generation 0 (i 0..3, both rows, band order y→x);
    // layer 1 = generation 1 (i=4 in slot 0 of each row). pitch 480, cell 456×528.
    expect(rects).toEqual([
      { x: 0, y: 0, w: 456, h: 528 },
      { x: 480, y: 0, w: 456, h: 528 },
      { x: 960, y: 0, w: 456, h: 528 },
      { x: 1440, y: 0, w: 456, h: 528 },
      { x: 0, y: 552, w: 456, h: 528 },
      { x: 480, y: 552, w: 456, h: 528 },
      { x: 960, y: 552, w: 456, h: 528 },
      { x: 1440, y: 552, w: 456, h: 528 },
      { x: 0, y: 0, w: 456, h: 528 },
      { x: 0, y: 552, w: 456, h: 528 },
    ]);
  });

  it("every source's xExpr subtracts ITS frame's baseX (SUB = pitch + frame.x)", () => {
    // The regression this locks: a placeOptimizedPieces ordering change would
    // pair a tile's expression with another tile's cell and silently misplace
    // every clip.
    const doc = renderScrollWallV1(props, makeCtx({ media: fiveVideoMedia() }));
    const frames = parseM0StringToRenderFrames(doc.m0, 1920, 1080);
    const byLogical = new Map(frames.map((f) => [f.logicalIndex, f]));
    const pitch = 480;
    doc.sources.forEach((s, k) => {
      const frame = byLogical.get(k);
      expect(frame).toBeDefined();
      const parsed = parseScrollXExpr((s as MosaicMediaSource).overlay!.xExpr!);
      expect(parsed.sub).toBe(pitch + frame!.x);
    });
  });

  it("cycles clips row-major with the coprime row stride", () => {
    const doc = renderScrollWallV1(props, makeCtx({ media: fiveVideoMedia() }));
    const stride = coprimeStride(5);
    expect(stride).toBe(2);
    // assetIds in manifest order mirror FIVE_CLIPS order (no shuffle).
    const assetIds = Object.keys(doc.assets);
    expect(assetIds).toHaveLength(5);
    for (const s of mediaSources(doc)) {
      const m = /^clip:r(\d+):i(\d+)$/.exec(s.editor?.label ?? "");
      expect(m).not.toBeNull();
      const [, r, i] = m!.map(Number);
      expect(String(s.assetId)).toBe(assetIds[(i + r * stride) % 5]);
    }
  });
});

describe("RAM budget — clipDurationMs is always set on video sources", () => {
  it("derives the auto window from probed dims against the loop-store budget", () => {
    const doc = renderScrollWallV1({ clips: FIVE_CLIPS }, makeCtx({ media: fiveVideoMedia() }));
    const vids = mediaSources(doc);
    expect(vids).toHaveLength(10);
    // 10 tiles × 1280×720×1.5 B/frame → floor(0.8e9 / 13 824 000) = 57 frames
    // @30fps → 1900 ms.
    for (const s of vids) {
      expect(s.playback?.loopMode).toBe("loop");
      expect(s.playback?.clipDurationMs).toBe(1900);
    }
    // The invariant behind the number: the summed loop store fits the budget.
    const storeBytes = vids.reduce(
      (sum, s) => sum + ((s.playback!.clipDurationMs! / 1000) * 30) * (1280 * 720 * 1.5),
      0,
    );
    expect(storeBytes).toBeLessThanOrEqual(0.8e9);
  });

  it("clamps to [750, min(assetDuration, 8000)] and honors tiles.clipWindowMs", () => {
    // 4K assets blow the per-frame budget → the floor clamps at 750.
    const bigMedia = Object.fromEntries(
      FIVE_CLIPS.map((p) => [p, videoMeta(3840, 2160, 60000)]),
    ) as Record<string, MosaicMediaMetadata>;
    const floored = renderScrollWallV1({ clips: FIVE_CLIPS }, makeCtx({ media: bigMedia }));
    for (const s of mediaSources(floored)) {
      expect(s.playback?.clipDurationMs).toBe(750);
    }
    // Tiny probes → huge auto window → the 8000 ceiling (asset outlasts it).
    const tinyMedia = Object.fromEntries(
      FIVE_CLIPS.map((p) => [p, videoMeta(64, 36, 60000)]),
    ) as Record<string, MosaicMediaMetadata>;
    const capped = renderScrollWallV1({ clips: FIVE_CLIPS }, makeCtx({ media: tinyMedia }));
    for (const s of mediaSources(capped)) {
      expect(s.playback?.clipDurationMs).toBe(8000);
    }
    // Short asset: the asset duration wins over both bounds.
    const shortMedia = Object.fromEntries(
      FIVE_CLIPS.map((p) => [p, videoMeta(64, 36, 500)]),
    ) as Record<string, MosaicMediaMetadata>;
    const short = renderScrollWallV1({ clips: FIVE_CLIPS }, makeCtx({ media: shortMedia }));
    for (const s of mediaSources(short)) {
      expect(s.playback?.clipDurationMs).toBe(500);
    }
    // Explicit knob (0 = auto) overrides the auto window.
    const explicit = renderScrollWallV1(
      { clips: FIVE_CLIPS, tiles: { clipWindowMs: 1500 } },
      makeCtx({ media: fiveVideoMedia() }),
    );
    for (const s of mediaSources(explicit)) {
      expect(s.playback?.clipDurationMs).toBe(1500);
    }
  });
});

describe("variation — stagger + shuffle, seeded", () => {
  // 2 clips / rows 1 / vc 4 → S=5, so tiles i=2..4 are genuine repeats.
  const twoClips = ["C:/w/a.mp4", "C:/w/b.mp4"];
  const twoMedia = () =>
    Object.fromEntries(twoClips.map((p) => [p, videoMeta()])) as Record<string, MosaicMediaMetadata>;
  const props: ScrollWallProps = { clips: twoClips, rows: 1 };

  it("staggers ONLY genuine repeats (floor(i / L) > 0), with a seeded start", () => {
    const doc = renderScrollWallV1(props, makeCtx({ media: twoMedia() }));
    for (const s of mediaSources(doc)) {
      const i = Number(/i(\d+)$/.exec(s.editor!.label!)![1]);
      if (Math.floor(i / 2) > 0) {
        expect(typeof s.playback?.clipStartMs).toBe("number");
        expect(s.playback!.clipStartMs!).toBeGreaterThanOrEqual(0);
        expect(s.playback!.clipStartMs!).toBeLessThanOrEqual(60000);
      } else {
        expect(s.playback?.clipStartMs).toBeUndefined();
      }
    }
  });

  it("staggerRepeats: false removes every clipStartMs", () => {
    const doc = renderScrollWallV1(
      { ...props, variation: { staggerRepeats: false } },
      makeCtx({ media: twoMedia() }),
    );
    for (const s of mediaSources(doc)) {
      expect(s.playback?.clipStartMs).toBeUndefined();
    }
  });

  it("is byte-deterministic per seed and diverges across seeds", () => {
    const at = (seed: number) =>
      JSON.stringify(
        renderScrollWallV1(
          { ...props, variation: { shuffle: true, staggerRepeats: true, seed } },
          makeCtx({ media: twoMedia() }),
        ),
      );
    expect(at(7)).toBe(at(7));
    expect(at(7)).not.toBe(at(8));
  });
});

describe("mixed media", () => {
  it("video gets playback+audio; image gets neither", () => {
    const clips = ["C:/w/a.mp4", "C:/w/pic.png"];
    const media = { "C:/w/a.mp4": videoMeta(), "C:/w/pic.png": imageMeta() } as Record<
      string,
      MosaicMediaMetadata
    >;
    const doc = renderScrollWallV1({ clips, rows: 1 }, makeCtx({ media }));
    expect(isError(doc)).toBe(false);
    const srcs = mediaSources(doc);
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) {
      if (s.mediaType === "video") {
        expect(s.playback?.loopMode).toBe("loop");
        expect(s.audio).toEqual({ enabled: false });
      } else {
        expect(s.mediaType).toBe("image");
        expect(s.playback).toBeUndefined();
        expect(s.audio).toBeUndefined();
      }
    }
  });
});

describe("fail-fast", () => {
  it(`errors above the ${SCROLL_WALL_MAX_TILES}-tile cap when the CLIP LIST is what does not fit`, () => {
    const clips = Array.from({ length: 13 }, (_, i) => `C:/w/c${i}.mp4`);
    const doc = renderScrollWallV1({ clips, rows: 2 }, makeCtx());
    expect(isError(doc)).toBe(true);
    // The message names the clips, not an internal slot count, and says the
    // budget the caller has left at this row count.
    expect(JSON.stringify(doc)).toContain("13 clips x 2 rows");
    expect(JSON.stringify(doc)).toContain("up to 12 clips");
  });

  it("errors on an audio clip", () => {
    const media = {
      "C:/w/song.mp3": { kind: "audio", width: 0, height: 0, hasVideo: false, hasAudio: true } as MosaicMediaMetadata,
    } as Record<string, MosaicMediaMetadata>;
    const doc = renderScrollWallV1({ clips: ["C:/w/song.mp3"], rows: 1 }, makeCtx({ media }));
    expect(isError(doc)).toBe(true);
  });

  it("errors when the canvas cannot fit the ROWS (a cross-axis overflow no look knob rescues)", () => {
    const doc = renderScrollWallV1({ rows: 4 }, makeCtx({ target: { width: 1920, height: 8 } }));
    expect(isError(doc)).toBe(true);
  });
});

describe("the 24-tile cap is paid by visibleCount, not by an error card", () => {
  const tileCount = (doc: MosaicDocument) => doc.sources.length;

  it("renders Rows=4 + Visible=6 — two slider drags off the defaults — instead of erroring", () => {
    const doc = renderScrollWallV1({ rows: 4, visibleCount: 6 }, makeCtx());
    expect(isError(doc)).toBe(false);
    expect(tileCount(doc)).toBeLessThanOrEqual(SCROLL_WALL_MAX_TILES);
  });

  it("stays inside the cap across the whole rows x visibleCount panel", () => {
    for (let rows = 1; rows <= 4; rows++) {
      for (let visibleCount = 1; visibleCount <= 12; visibleCount++) {
        const doc = renderScrollWallV1({ rows, visibleCount }, makeCtx());
        expect({ rows, visibleCount, error: isError(doc) }).toEqual({ rows, visibleCount, error: false });
        expect(tileCount(doc)).toBeLessThanOrEqual(SCROLL_WALL_MAX_TILES);
      }
    }
  });

  it("takes the LARGEST fitting count, not the first safe one", () => {
    const fit = fitVisibleCount({
      canvasW: 1920,
      canvasH: 1080,
      rows: 4,
      gapPx: 24,
      marginPx: 0,
      requestedVisibleCount: 12,
      clipCount: 6,
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.visibleCount).toBeLessThan(12);
    expect(4 * fit.slotCount).toBeLessThanOrEqual(SCROLL_WALL_MAX_TILES);
    // One step up is genuinely infeasible — that is what "largest" means.
    const oneMore = fitVisibleCount({
      canvasW: 1920,
      canvasH: 1080,
      rows: 4,
      gapPx: 24,
      marginPx: 0,
      requestedVisibleCount: fit.visibleCount + 1,
      clipCount: 6,
    });
    expect(oneMore.ok && oneMore.visibleCount).toBe(fit.visibleCount);
  });

  it("leaves a request that already fits exactly alone", () => {
    const fit = fitVisibleCount({
      canvasW: 1920,
      canvasH: 1080,
      rows: 2,
      gapPx: 24,
      marginPx: 0,
      requestedVisibleCount: 4,
      clipCount: 6,
    });
    expect(fit.ok && fit.visibleCount).toBe(4);
  });

  it("walks down on a canvas too narrow for the asked-for count", () => {
    const doc = renderScrollWallV1({ visibleCount: 12 }, makeCtx({ target: { width: 100, height: 100 } }));
    expect(isError(doc)).toBe(false);
  });

  it("names the ROWS as the blocker even when the walk started on a too-narrow tile count", () => {
    // 4 rows on a 180px-tall canvas is the real problem; the v=12 attempt also
    // fails on the scroll axis, and reporting THAT would send the caller after
    // the wrong knob.
    const fit = fitVisibleCount({
      canvasW: 320,
      canvasH: 180,
      rows: 4,
      gapPx: 24,
      marginPx: 0,
      requestedVisibleCount: 12,
      clipCount: 6,
    });
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.error).toContain("rows=4");
    expect(fit.error).not.toContain("visibleCount");
  });

  it("reports the cross-axis geometry error, which no tile size rescues", () => {
    const fit = fitVisibleCount({
      canvasW: 1920,
      canvasH: 8,
      rows: 4,
      gapPx: 24,
      marginPx: 0,
      requestedVisibleCount: 4,
      clipCount: 6,
    });
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.error).toContain("rows=4");
  });
});

describe("ctx.target drives geometry (never ctx.output)", () => {
  it("frames parse at the target dims while output stays at 1920×1080", () => {
    const ctx = makeCtx({ target: { width: 1280, height: 720 } });
    const doc = renderScrollWallV1({}, ctx);
    expect(isError(doc)).toBe(false);
    const g = computeScrollWallGeometry({
      canvasW: 1280,
      canvasH: 720,
      visibleCount: 4,
      rows: 2,
      gapPx: 24,
      marginPx: 0,
    });
    if (!g.ok) throw new Error(g.error);
    const frames = parseM0StringToRenderFrames(doc.m0, 1280, 720);
    for (const f of frames) {
      expect(f.x + f.width).toBeLessThanOrEqual(1280);
      expect(f.width).toBe(g.geometry.cellW);
    }
  });
});

describe("determinism", () => {
  it("same props + ctx → byte-identical documents", () => {
    const props: ScrollWallProps = { clips: FIVE_CLIPS, variation: { shuffle: true, seed: 3 } };
    const a = renderScrollWallV1(props, makeCtx({ media: fiveVideoMedia() }));
    const b = renderScrollWallV1(props, makeCtx({ media: fiveVideoMedia() }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("coprimeStride", () => {
  it("is coprime with the clip count and deterministic", () => {
    expect(coprimeStride(1)).toBe(1);
    expect(coprimeStride(2)).toBe(1);
    expect(coprimeStride(4)).toBe(3);
    expect(coprimeStride(5)).toBe(2);
    expect(coprimeStride(6)).toBe(5);
  });
});
