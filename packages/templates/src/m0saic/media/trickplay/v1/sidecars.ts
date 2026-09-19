/**
 * Trickplay index-file builders: the WebVTT storyboard and the JSON
 * manifest. Both reference sheet images via `{{stepOutput:<stepName>}}`
 * tokens (see `@m0saic/types` `stepOutputToken`) — the engine's sidecar
 * writer substitutes each token with the sheet deliverable's final
 * on-disk basename, so the emitted references are valid relative URLs
 * next to the index files.
 *
 * Conventions covered:
 *  - WebVTT storyboard (`#xywh=x,y,w,h` media fragments) — the
 *    de-facto web-player format (Video.js, JW, Bitmovin, THEO, hls.js UIs).
 *  - Jellyfin trickplay fields (Width/Height = per-thumb px,
 *    TileWidth/TileHeight = tiles per row/column, ThumbnailCount,
 *    Interval in ms). Bandwidth is omitted — sheet byte sizes are
 *    unknowable at make-time.
 *  - DASH-IF thumbnail tiles (`thumbnail_tile` EssentialProperty,
 *    value "HxV") — ready to lift into an MPD.
 */

import type { TrickplayPlan } from "./plan";

export type TrickplayManifest = {
  version: 1;
  input: string;
  durationMs: number;
  intervalMs: number;
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rowsPerSheet: number;
  thumbnailCount: number;
  sheets: Array<{
    /** Sheet image file reference (step-output token → final basename). */
    file: string;
    width: number;
    height: number;
    rows: number;
    cols: number;
    thumbCount: number;
    firstThumbIndex: number;
  }>;
  cues: Array<{
    startMs: number;
    endMs: number;
    /** Sheet image file reference (step-output token → final basename). */
    sheet: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  jellyfin: {
    Width: number;
    Height: number;
    TileWidth: number;
    TileHeight: number;
    ThumbnailCount: number;
    Interval: number;
  };
  dashIf: {
    schemeIdUri: "http://dashif.org/guidelines/thumbnail_tile";
    value: string;
  };
};

/** Format milliseconds as a WebVTT timestamp (`HH:MM:SS.mmm`). */
export function formatVttTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const msPart = clamped % 1000;
  const totalSec = Math.floor(clamped / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60) % 60;
  const hr = Math.floor(totalSec / 3600);
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(hr, 2)}:${pad(min, 2)}:${pad(sec, 2)}.${pad(msPart, 3)}`;
}

/**
 * Build the WebVTT storyboard. `sheetRef(sheetIndex)` supplies the
 * sheet-image reference for each cue's payload (a step-output token in
 * production; tests may pass literal names).
 */
export function buildStoryboardVtt(
  plan: TrickplayPlan,
  sheetRef: (sheetIndex: number) => string,
): string {
  const cues = plan.cues.map(
    (c) =>
      `${formatVttTimestamp(c.startMs)} --> ${formatVttTimestamp(c.endMs)}\n` +
      `${sheetRef(c.sheetIndex)}#xywh=${c.x},${c.y},${c.w},${c.h}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/** Build the JSON manifest (Jellyfin + DASH-IF blocks + full cue list). */
export function buildTrickplayManifest(args: {
  plan: TrickplayPlan;
  inputPath: string;
  durationMs: number;
  cols: number;
  rowsPerSheet: number;
  sheetRef: (sheetIndex: number) => string;
}): TrickplayManifest {
  const { plan, inputPath, durationMs, cols, rowsPerSheet, sheetRef } = args;
  return {
    version: 1,
    input: inputPath,
    durationMs: Math.round(durationMs),
    intervalMs: plan.intervalMs,
    tileWidth: plan.tileWidth,
    tileHeight: plan.tileHeight,
    cols,
    rowsPerSheet,
    thumbnailCount: plan.thumbnailCount,
    sheets: plan.sheets.map((s) => ({
      file: sheetRef(s.index),
      width: s.width,
      height: s.height,
      rows: s.rows,
      cols: s.cols,
      thumbCount: s.thumbCount,
      firstThumbIndex: s.firstThumbIndex,
    })),
    cues: plan.cues.map((c) => ({
      startMs: c.startMs,
      endMs: c.endMs,
      sheet: sheetRef(c.sheetIndex),
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
    })),
    jellyfin: {
      Width: plan.tileWidth,
      Height: plan.tileHeight,
      TileWidth: cols,
      TileHeight: rowsPerSheet,
      ThumbnailCount: plan.thumbnailCount,
      Interval: plan.intervalMs,
    },
    dashIf: {
      schemeIdUri: "http://dashif.org/guidelines/thumbnail_tile",
      value: `${cols}x${rowsPerSheet}`,
    },
  };
}
