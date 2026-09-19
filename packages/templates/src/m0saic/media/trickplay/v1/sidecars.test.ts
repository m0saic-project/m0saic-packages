import { planTrickplay } from "./plan";
import {
  buildStoryboardVtt,
  buildTrickplayManifest,
  formatVttTimestamp,
} from "./sidecars";

// 25s @ 10s into 2×1 sheets → 3 thumbs: sheet 0 holds 2, sheet 1 holds 1.
const PLAN = planTrickplay({
  durationMs: 25_000,
  srcWidth: 1280,
  srcHeight: 720,
  frameMs: 33,
  intervalSec: 10,
  tileWidth: 320,
  cols: 2,
  rowsPerSheet: 1,
});

const sheetRef = (i: number) => `sheet-${i}.png`;

describe("formatVttTimestamp", () => {
  it("formats HH:MM:SS.mmm", () => {
    expect(formatVttTimestamp(0)).toBe("00:00:00.000");
    expect(formatVttTimestamp(5_000)).toBe("00:00:05.000");
    expect(formatVttTimestamp(65_250)).toBe("00:01:05.250");
    expect(formatVttTimestamp(3_661_234)).toBe("01:01:01.234");
    expect(formatVttTimestamp(2 * 3_600_000)).toBe("02:00:00.000");
  });

  it("clamps negatives and rounds fractional ms", () => {
    expect(formatVttTimestamp(-5)).toBe("00:00:00.000");
    expect(formatVttTimestamp(999.6)).toBe("00:00:01.000");
  });
});

describe("buildStoryboardVtt", () => {
  it("emits the exact WebVTT storyboard", () => {
    expect(buildStoryboardVtt(PLAN, sheetRef)).toBe(
      "WEBVTT\n" +
        "\n" +
        "00:00:00.000 --> 00:00:10.000\n" +
        "sheet-0.png#xywh=0,0,320,180\n" +
        "\n" +
        "00:00:10.000 --> 00:00:20.000\n" +
        "sheet-0.png#xywh=320,0,320,180\n" +
        "\n" +
        "00:00:20.000 --> 00:00:25.000\n" +
        "sheet-1.png#xywh=0,0,320,180\n",
    );
  });

  it("is deterministic", () => {
    expect(buildStoryboardVtt(PLAN, sheetRef)).toBe(buildStoryboardVtt(PLAN, sheetRef));
  });
});

describe("buildTrickplayManifest", () => {
  const manifest = buildTrickplayManifest({
    plan: PLAN,
    inputPath: "/abs/movie.mp4",
    durationMs: 25_000,
    cols: 2,
    rowsPerSheet: 1,
    sheetRef,
  });

  it("carries the Jellyfin block (per-thumb dims + tiles-per-axis + ms interval)", () => {
    expect(manifest.jellyfin).toEqual({
      Width: 320,
      Height: 180,
      TileWidth: 2,
      TileHeight: 1,
      ThumbnailCount: 3,
      Interval: 10_000,
    });
  });

  it("carries the DASH-IF thumbnail_tile block as HxV", () => {
    expect(manifest.dashIf).toEqual({
      schemeIdUri: "http://dashif.org/guidelines/thumbnail_tile",
      value: "2x1",
    });
  });

  it("lists sheets and cues with sheet references", () => {
    expect(manifest.sheets).toHaveLength(2);
    expect(manifest.sheets[0]).toMatchObject({
      file: "sheet-0.png",
      width: 640,
      height: 180,
      thumbCount: 2,
      firstThumbIndex: 0,
    });
    expect(manifest.cues).toHaveLength(3);
    expect(manifest.cues[2]).toEqual({
      startMs: 20_000,
      endMs: 25_000,
      sheet: "sheet-1.png",
      x: 0,
      y: 0,
      w: 320,
      h: 180,
    });
  });

  it("is byte-identical across calls", () => {
    const again = buildTrickplayManifest({
      plan: PLAN,
      inputPath: "/abs/movie.mp4",
      durationMs: 25_000,
      cols: 2,
      rowsPerSheet: 1,
      sheetRef,
    });
    expect(JSON.stringify(manifest)).toBe(JSON.stringify(again));
  });
});
