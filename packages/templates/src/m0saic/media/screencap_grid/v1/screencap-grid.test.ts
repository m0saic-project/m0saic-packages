import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaMetadata,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import {
  ScreencapGrid,
  computeTimestamps,
  formatInfoLines,
  estimateInfoPaneHeight,
  infoPaneTitleFontSize,
  infoPaneMetaFontSize,
  assembleScreencapM0,
} from "./screencap-grid";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & {
    workspaceDir?: string;
  },
): MosaicEngineContext {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("screencap-grid-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 2000,
      ...overrides,
    },
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 2000,
      workspaceDir: ws,
      ...overrides,
    },
    media: {},
  };
}

function isPipeline(file: MosaicRenderableFile): file is MosaicDocumentPipeline {
  return file.kind === "mosaic_pipeline";
}

function isDocument(file: MosaicRenderableFile): file is MosaicDocument {
  return file.kind === "mosaic_document";
}

const VIDEO_META: MosaicMediaMetadata = {
  kind: "video",
  width: 1920,
  height: 1080,
  hasVideo: true,
  hasAudio: true,
  durationMs: 60000,
  fps: 24,
  originalFileName: "sample.mp4",
  tags: { title: "Test Video", artist: "Author" },
  format: {
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    formatLongName: "QuickTime / MOV",
    sizeBytes: 50_000_000,
    bitRate: 6_666_666,
  },
  video: {
    codecName: "h264",
    codecLongName: "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
    profile: "High",
    pixFmt: "yuv420p",
    colorSpace: "bt709",
    avgFrameRate: 24,
    streamIndex: 0,
  },
  audio: {
    codecName: "aac",
    codecLongName: "AAC (Advanced Audio Coding)",
    sampleRate: 48000,
    channels: 2,
    channelLayout: "stereo",
    bitRate: 128000,
    streamIndex: 1,
  },
};

const IMAGE_META: MosaicMediaMetadata = {
  kind: "image",
  width: 3840,
  height: 2160,
  hasVideo: true,
  hasAudio: false,
  originalFileName: "photo.jpg",
  format: { formatName: "image2", sizeBytes: 5_000_000 },
};

describe("ScreencapGrid template metadata", () => {
  it("has expected id", () => {
    expect(ScreencapGrid.id).toBe("@m0saic/media/screencap_grid/v1");
  });

  it("has version 1", () => {
    expect(ScreencapGrid.version).toBe(1);
  });

  it("has defaultProps with outputFormat, rows, cols, withInfoPane", () => {
    expect(ScreencapGrid.defaultProps).toMatchObject({
      outputFormat: "png",
      rows: 4,
      cols: 4,
      withInfoPane: true,
    });
  });

  it("declares no outputHints.format (the outputFormat knob owns the container)", () => {
    expect(ScreencapGrid.outputHints?.format).toBeUndefined();
  });
});

describe("ScreencapGrid — outputFormat knob (per-doc format)", () => {
  it("default (png) bakes an image/png format on the document", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.format).toEqual({ kind: "image", container: "png" });
  });

  it('outputFormat:"mp4" bakes a video/mp4 format on the document', async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, outputFormat: "mp4" },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.format).toEqual({ kind: "video", container: "mp4" });
  });

  it("multi-input steps each carry the mode's format", async () => {
    for (const outputFormat of ["png", "mp4"] as const) {
      const file = await ScreencapGrid.render(
        { sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4"], withInfoPane: false, outputFormat },
        makeCtx(),
      );
      if (!isPipeline(file)) throw new Error("expected pipeline");
      for (const step of file.steps) {
        expect(step.file?.format).toEqual(
          outputFormat === "mp4"
            ? { kind: "video", container: "mp4" }
            : { kind: "image", container: "png" },
        );
      }
    }
  });
});

describe("assembleScreencapM0 (gutterless grid + optional info pane)", () => {
  it("is gutterless — no '-' null tiles, with or without an info pane", () => {
    expect(
      assembleScreencapM0({ rows: 4, cols: 4, paneHeightPx: 110, gridH: 970, withTileTimestamp: false }),
    ).not.toContain("-");
    expect(
      assembleScreencapM0({ rows: 4, cols: 4, paneHeightPx: 0, gridH: 1080, withTileTimestamp: false }),
    ).not.toContain("-");
  });

  it("without an info pane returns the bare grid (starts with the row count)", () => {
    const s = assembleScreencapM0({ rows: 2, cols: 3, paneHeightPx: 0, gridH: 1080, withTileTimestamp: false });
    expect(isValidM0String(s)).toBe(true);
    expect(s.startsWith("2[")).toBe(true);
  });

  it("with an info pane stacks a header row above the grid (valid m0)", () => {
    const bare = assembleScreencapM0({ rows: 2, cols: 3, paneHeightPx: 0, gridH: 1080, withTileTimestamp: false });
    const withPane = assembleScreencapM0({ rows: 2, cols: 3, paneHeightPx: 90, gridH: 990, withTileTimestamp: false });
    expect(isValidM0String(withPane)).toBe(true);
    // The header row wraps the grid, so the string is no longer the bare grid.
    expect(withPane).not.toBe(bare);
  });

  it("valid across a sweep (with/without info pane, with/without timestamps)", () => {
    for (const rows of [1, 2, 3, 5]) {
      for (const cols of [1, 2, 4, 6]) {
        for (const pane of [0, 90]) {
          for (const ts of [false, true]) {
            const s = assembleScreencapM0({ rows, cols, paneHeightPx: pane, gridH: 980, withTileTimestamp: ts });
            expect(isValidM0String(s)).toBe(true);
          }
        }
      }
    }
  });
});

describe("computeTimestamps", () => {
  it("returns N timestamps strictly increasing", () => {
    const ts = computeTimestamps(16, 60000);
    expect(ts.length).toBe(16);
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    }
  });

  it("all timestamps are in (0, durationMs)", () => {
    const dur = 10000;
    const ts = computeTimestamps(8, dur);
    for (const t of ts) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(dur);
    }
  });

  it("single tile avoids exact 0 and duration", () => {
    const ts = computeTimestamps(1, 5000);
    expect(ts[0]).toBe(2500);
  });
});

describe("formatInfoLines", () => {
  it("includes title from originalFileName", () => {
    const { title } = formatInfoLines("hero", VIDEO_META);
    expect(title).toBe("sample.mp4");
  });

  it("includes duration in summary line", () => {
    const { metadata } = formatInfoLines("hero", VIDEO_META);
    expect(metadata).toContain("Duration: 1m 0.00s");
  });

  it("includes human-readable size AND raw byte count", () => {
    const { metadata } = formatInfoLines("hero", VIDEO_META);
    expect(metadata).toContain("47.68 MiB");
    expect(metadata).toContain("50,000,000 bytes");
  });

  it("includes bitrate", () => {
    const { metadata } = formatInfoLines("hero", VIDEO_META);
    expect(metadata).toContain("6.7 Mbit/s");
  });

  it("includes container long name", () => {
    const { metadata } = formatInfoLines("hero", VIDEO_META);
    expect(metadata).toContain("QuickTime / MOV");
  });

  it("video stream line has resolution, pixfmt, bit depth, fps, codec long name, profile", () => {
    const { metadata } = formatInfoLines("hero", VIDEO_META);
    expect(metadata).toContain("Stream 0 Video:");
    expect(metadata).toContain("1920x1080");
    expect(metadata).toContain("yuv420p");
    expect(metadata).toContain("8-bit");
    expect(metadata).toContain("24.00 fps");
    expect(metadata).toContain("H.264 / AVC");
    expect(metadata).toContain("(High)");
  });

  it("audio stream line has layout, sample rate, bitrate, codec long name", () => {
    const { metadata } = formatInfoLines("hero", VIDEO_META);
    expect(metadata).toContain("Stream 1 Audio:");
    expect(metadata).toContain("stereo");
    expect(metadata).toContain("48 kHz");
    expect(metadata).toContain("128 kbit/s");
    expect(metadata).toContain("AAC (Advanced Audio Coding)");
  });

  it("uses sourceId as title fallback when no originalFileName", () => {
    const meta: MosaicMediaMetadata = {
      kind: "video",
      width: 640,
      height: 480,
      hasVideo: true,
      hasAudio: false,
    };
    const { title } = formatInfoLines("fallback-id", meta);
    expect(title).toBe("fallback-id");
  });

  it("omits fields gracefully when metadata is sparse", () => {
    const meta: MosaicMediaMetadata = {
      kind: "video",
      width: 640,
      height: 480,
      hasVideo: true,
      hasAudio: false,
    };
    const { metadata } = formatInfoLines("id", meta);
    // No duration, size, bitrate, container — should not crash or show labels
    expect(metadata).toContain("640x480");
    expect(metadata).not.toContain("Duration");
    expect(metadata).not.toContain("Size");
    expect(metadata).not.toContain("Bitrate");
    expect(metadata).not.toContain("Container");
    expect(metadata).not.toContain("Audio");
  });

  it("shows chapters count when present", () => {
    const meta: MosaicMediaMetadata = {
      ...VIDEO_META,
      chapters: [
        { id: 0, startMs: 0, endMs: 10000, tags: { title: "Intro" } },
        { id: 1, startMs: 10000, endMs: 30000 },
      ],
    };
    const { metadata } = formatInfoLines("hero", meta);
    expect(metadata).toContain("Chapters: 2");
  });

  it("falls back to formatName when formatLongName missing", () => {
    const meta: MosaicMediaMetadata = {
      ...VIDEO_META,
      format: { formatName: "mp4", sizeBytes: 100 },
    };
    const { metadata } = formatInfoLines("hero", meta);
    expect(metadata).toContain("Container: mp4");
  });

  it("falls back to channel count when channelLayout missing", () => {
    const meta: MosaicMediaMetadata = {
      ...VIDEO_META,
      audio: { codecName: "opus", channels: 6, sampleRate: 48000 },
    };
    const { metadata } = formatInfoLines("hero", meta);
    expect(metadata).toContain("6ch");
  });

  it("returns correct metaLineCount", () => {
    // VIDEO_META has summary + video + audio = 3 lines
    const { metaLineCount } = formatInfoLines("hero", VIDEO_META);
    expect(metaLineCount).toBe(3);
  });

  it("returns metaLineCount=0 for completely sparse metadata", () => {
    const meta: MosaicMediaMetadata = {
      kind: "unknown",
      width: 0,
      height: 0,
      hasVideo: false,
      hasAudio: false,
    };
    const { metaLineCount } = formatInfoLines("x", meta);
    expect(metaLineCount).toBe(0);
  });

  it("returns metaLineCount=1 for video-only (no format info)", () => {
    const meta: MosaicMediaMetadata = {
      kind: "video",
      width: 640,
      height: 480,
      hasVideo: true,
      hasAudio: false,
    };
    const { metaLineCount } = formatInfoLines("x", meta);
    expect(metaLineCount).toBe(1); // just the video stream line
  });
});

describe("estimateInfoPaneHeight", () => {
  it("returns a positive number", () => {
    expect(estimateInfoPaneHeight(1080, 3)).toBeGreaterThan(0);
  });

  it("scales with target height", () => {
    const h720 = estimateInfoPaneHeight(720, 3);
    const h1080 = estimateInfoPaneHeight(1080, 3);
    const h2160 = estimateInfoPaneHeight(2160, 3);
    expect(h1080).toBeGreaterThan(h720);
    expect(h2160).toBeGreaterThan(h1080);
  });

  it("grows with more metadata lines", () => {
    const h0 = estimateInfoPaneHeight(1080, 0);
    const h3 = estimateInfoPaneHeight(1080, 3);
    const h5 = estimateInfoPaneHeight(1080, 5);
    expect(h3).toBeGreaterThan(h0);
    expect(h5).toBeGreaterThan(h3);
  });

  it("at 1080p with 3 lines, info pane ratio is well under 12%", () => {
    const h = estimateInfoPaneHeight(1080, 3);
    const ratio = h / 1080;
    expect(ratio).toBeLessThan(0.12);
    expect(ratio).toBeGreaterThan(0.05);
  });
});

describe("font sizing", () => {
  it("infoPaneTitleFontSize clamps at 1080p", () => {
    expect(infoPaneTitleFontSize(1080)).toBe(24);
  });

  it("infoPaneMetaFontSize clamps at 1080p", () => {
    expect(infoPaneMetaFontSize(1080)).toBe(13);
  });

  it("title font clamped to min 16", () => {
    expect(infoPaneTitleFontSize(100)).toBe(16);
  });

  it("title font clamped to max 48", () => {
    expect(infoPaneTitleFontSize(5000)).toBe(48);
  });
});

describe("ScreencapGrid — multi-input dispatch", () => {
  jest.setTimeout(30_000);

  it("single-entry sourceIds returns a MosaicDocument (not a pipeline)", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false },
      makeCtx(),
    );
    expect(isDocument(file)).toBe(true);
  });

  it("missing inputs returns a fail-fast error mosaic (still a document)", async () => {
    const file = await ScreencapGrid.render(
      { withInfoPane: false },
      makeCtx(),
    );
    expect(isDocument(file)).toBe(true);
    // makeErrorMosaic encodes the message into the doc — the toM0String
    // wrapper preserves it as a top-level field.
  });

  it("multi-input returns an emit:multi pipeline with one step per file", async () => {
    const file = await ScreencapGrid.render(
      {
        sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4", "/tmp/c.mp4"],
        withInfoPane: false,
        outputFormat: "mp4",
      },
      makeCtx(),
    );
    expect(isPipeline(file)).toBe(true);
    if (!isPipeline(file)) return;
    expect(file.emit).toBe("multi");
    expect(file.steps.length).toBe(3);
    expect(file.steps.map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  it("each pipeline step carries a label matching the slug for {{label}} naming", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4"], withInfoPane: false, outputFormat: "mp4" },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    expect(file.steps[0].label).toBe("a");
    expect(file.steps[1].label).toBe("b");
  });

  it("animated step durations come from ctx.target.durationMs", async () => {
    const ctx = makeCtx({ durationMs: 1234 });
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4"], withInfoPane: false, outputFormat: "mp4" },
      ctx,
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    for (const step of file.steps) {
      expect(step.durationMs).toBe(1234);
    }
  });

  it("static (png) step durations are a fixed nominal single-frame duration", async () => {
    const ctx = makeCtx({ durationMs: 1234 });
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4"], withInfoPane: false },
      ctx,
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    for (const step of file.steps) {
      expect(step.durationMs).toBe(40);
    }
  });

  it("each step.file is an embedded MosaicDocument with the per-file m0", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4"], withInfoPane: false, rows: 2, cols: 2, outputFormat: "mp4" },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    for (const step of file.steps) {
      expect(step.file).toBeDefined();
      const stepFile = step.file!;
      expect(stepFile.kind).toBe("mosaic_document");
      expect(typeof stepFile.m0).toBe("string");
    }
  });

  it("dedupes step names when two inputs share a basename", async () => {
    const file = await ScreencapGrid.render(
      {
        sourceIds: ["/folderA/clip.mp4", "/folderB/clip.mp4", "/folderC/clip.mp4"],
        withInfoPane: false,
        outputFormat: "mp4",
      },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    const names = file.steps.map((s) => s.name);
    expect(names).toEqual(["clip", "clip_2", "clip_3"]);
    expect(new Set(names).size).toBe(names.length); // all unique
  });

  it("empty sourceIds returns a fail-fast error mosaic (still a document)", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: [], withInfoPane: false },
      makeCtx(),
    );
    expect(isDocument(file)).toBe(true);
  });
});

describe("ScreencapGrid — canvas", () => {
  it("never declares its own doc.size (always fills the user's canvas)", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, rows: 7, cols: 3 },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.size).toBeUndefined();
  });
});

describe("ScreencapGrid — info pane placement (top-anchored cover crop)", () => {
  const findInfoPaneRef = (file: MosaicRenderableFile) => {
    if (!isDocument(file)) throw new Error("expected document");
    return file.sources.find((s) => s.type === "mosaic") as
      | (MosaicSource & { ref?: string; placement?: { fit?: string; focusY?: number } })
      | undefined;
  };

  it("both modes ref the pane with fit:cover focusY:0 (top strip of the full-height raster)", async () => {
    for (const outputFormat of ["png", "mp4"] as const) {
      const file = await ScreencapGrid.render(
        { sourceIds: ["/tmp/clip.mp4"], withInfoPane: true, rows: 2, cols: 2, outputFormat },
        makeCtx(),
      );
      const pane = findInfoPaneRef(file);
      expect(pane?.ref).toBe("info-pane");
      // The pane child rasterizes at full canvas height with its text in the
      // top strip. The default contain fit would scale the whole frame into
      // the ~110px pane cell (≈2px text); the top-anchored cover crop shows
      // the top strip at full size instead.
      expect(pane?.placement).toEqual({ fit: "cover", focusY: 0 });
    }
  });
});

describe("ScreencapGrid — tile gap (per-cell inset)", () => {
  type BoxInset = { top: number; right: number; bottom: number; left: number };
  const findMedia = (file: MosaicRenderableFile) => {
    if (!isDocument(file)) throw new Error("expected document");
    return file.sources.find((s) => s.type === "media") as
      | (MosaicSource & { placement?: { inset?: BoxInset } })
      | undefined;
  };

  it("tileGapPx > 0 insets each cell on its shared (interior) edges, full-bleed", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, rows: 2, cols: 2, tileGapPx: 4 },
      makeCtx(),
    );
    // Source 0 is the top-left cell (0,0): full-bleed → inset only on the
    // shared right + bottom edges, none on the outer top + left.
    const inset = findMedia(file)?.placement?.inset;
    expect(inset).toBeDefined();
    expect(inset!.right).toBeGreaterThan(0);
    expect(inset!.bottom).toBeGreaterThan(0);
    expect(inset!.top).toBe(0);
    expect(inset!.left).toBe(0);
  });

  it("tileGapPx 0 leaves media sources inset-free (no gap)", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, rows: 2, cols: 2, tileGapPx: 0 },
      makeCtx(),
    );
    expect(findMedia(file)?.placement?.inset).toBeUndefined();
  });

  it("the grid m0 stays gutterless (compact) regardless of gap", async () => {
    // With a per-tile-inset gap the m0 has no '-' gutter tokens and no
    // placeRect bars — so a 2×2 grid is a tiny string.
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, rows: 2, cols: 2, tileGapPx: 8 },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(String(file.m0)).not.toContain("-");
  });
});

describe("ScreencapGrid — tile fit", () => {
  const findMediaFits = (file: MosaicRenderableFile): string[] => {
    if (!isDocument(file)) throw new Error("expected document");
    return file.sources
      .filter((s) => s.type === "media")
      .map((s) => (s as MosaicSource & { placement?: { fit?: string } }).placement?.fit as string);
  };
  const findInfoPaneFit = (file: MosaicRenderableFile): string | undefined => {
    if (!isDocument(file)) throw new Error("expected document");
    const pane = file.sources.find((s) => s.type === "mosaic") as
      | (MosaicSource & { placement?: { fit?: string } })
      | undefined;
    return pane?.placement?.fit;
  };

  it("defaults to cover on every tile when tileFit is omitted", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, rows: 2, cols: 2 },
      makeCtx(),
    );
    const fits = findMediaFits(file);
    expect(fits.length).toBe(4);
    expect(fits.every((f) => f === "cover")).toBe(true);
  });

  it("tileFit:contain emits contain on every tile placement", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, rows: 2, cols: 2, tileFit: "contain" },
      makeCtx(),
    );
    const fits = findMediaFits(file);
    expect(fits.length).toBe(4);
    expect(fits.every((f) => f === "contain")).toBe(true);
  });

  it("applies to both PNG and MP4 modes", async () => {
    for (const outputFormat of ["png", "mp4"] as const) {
      const file = await ScreencapGrid.render(
        { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, rows: 2, cols: 2, tileFit: "contain", outputFormat },
        makeCtx(),
      );
      expect(findMediaFits(file).every((f) => f === "contain")).toBe(true);
    }
  });

  it("leaves the info-pane ref at cover regardless of tileFit", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: true, withTileTimestamp: false, rows: 2, cols: 2, tileFit: "contain" },
      makeCtx(),
    );
    expect(findInfoPaneFit(file)).toBe("cover");
  });

  it("does not change grid geometry (media tile count) vs default", async () => {
    const cover = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, rows: 3, cols: 3 },
      makeCtx(),
    );
    const contain = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, rows: 3, cols: 3, tileFit: "contain" },
      makeCtx(),
    );
    expect(findMediaFits(contain).length).toBe(findMediaFits(cover).length);
  });
});

describe("ScreencapGrid — timestamp styling", () => {
  const findTimestamp = (file: MosaicRenderableFile) => {
    if (!isDocument(file)) throw new Error("expected document");
    const ts = file.sources.find((s) => s.type === "text") as
      | (MosaicSource & {
          layers?: {
            style?: { fontColor?: string; boxColor?: string };
            visual?: { backgroundColor?: string };
          }[];
        })
      | undefined;
    return ts?.layers?.[0];
  };

  it("applies timestampColor + a glyph-only box (not a full-rect fill)", async () => {
    const file = await ScreencapGrid.render(
      {
        sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, rows: 2, cols: 2,
        timestampColor: "#ffcc00", timestampBgColor: "black@0.5",
      },
      makeCtx(),
    );
    const layer = findTimestamp(file);
    expect(layer?.style?.fontColor).toBe("#ffcc00");
    // Background is a drawtext box behind the glyphs (style.boxColor), NOT the
    // text source's rect fill — which would flood the whole cell.
    expect(layer?.style?.boxColor).toBe("black@0.5");
    expect(layer?.visual?.backgroundColor).toBe("none");
  });

  it("defaults to white text with no box (transparent)", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, rows: 2, cols: 2 },
      makeCtx(),
    );
    const layer = findTimestamp(file);
    expect(layer?.style?.fontColor).toBe("#ffffff");
    expect(layer?.style?.boxColor).toBeUndefined(); // no box at default "none"
    expect(layer?.visual?.backgroundColor).toBe("none");
  });
});

describe("ScreencapGrid — custom grid (m0 escape hatch)", () => {
  const CUSTOM =
    "2(5[3(F,F,F),3(F,F,F),>,3(2[F,F],>,F),3(F,F,F)],5[3(F,F,F),>,3(>,F,2[F,F]),3(F,F,F),3(F,F,F)])";

  it("binds one media tile per rendered cell, overriding rows/cols", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, rows: 4, cols: 4, customGrid: CUSTOM },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    const mediaCount = file.sources.filter((s) => s.type === "media").length;
    // 24 F cells in CUSTOM — NOT rows*cols (16).
    expect(mediaCount).toBe(24);
  });

  it("strips '#' header lines from a pasted .m0 file", async () => {
    const withHeaders = "# m0\n# version: 1\n# size: 1920x1080\n3(F,F,F)";
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, customGrid: withHeaders },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.sources.filter((s) => s.type === "media").length).toBe(3);
  });

  it("falls back to rows×cols when customGrid is empty", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], withInfoPane: false, withTileTimestamp: false, rows: 2, cols: 3, customGrid: "   " },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.sources.filter((s) => s.type === "media").length).toBe(6);
  });

  it("returns an error mosaic for an invalid customGrid m0", async () => {
    const file = await ScreencapGrid.render(
      { sourceIds: ["/tmp/clip.mp4"], customGrid: "2(F,F" },
      makeCtx(),
    );
    // makeErrorMosaic returns a (non-throwing) document; it does not bind the
    // 2 cells of the malformed string as media tiles.
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.sources.filter((s) => s.type === "media").length).toBe(0);
  });
});
