/**
 * Pure trickplay math: fixed-interval seek timestamps, sheet
 * partitioning, and per-thumb cue rectangles.
 *
 * This is the fixed-cadence counterpart of screencap-grid's
 * proportional `computeTimestamps` (`(i+1)/(n+1)·d`): trickplay
 * players expect one thumbnail per `interval`, placed row-major into
 * fixed-capacity sheets — thumb `i` covers the timeline range
 * `[i·interval, (i+1)·interval)` and lives at a coordinate derivable
 * from `i` alone. Everything here is a pure function of its inputs.
 */

export type TrickplayKnobs = {
  /** Seconds between thumbnails. */
  intervalSec: number;
  /** Thumbnail width in px (even-rounded; height derives from source aspect). */
  tileWidth: number;
  /** Tiles per sheet row. */
  cols: number;
  /** Max tile rows per sheet. */
  rowsPerSheet: number;
};

export type TrickplayCue = {
  /** Timeline range this thumb previews. `endMs` is exclusive; the last cue ends at the media duration. */
  startMs: number;
  endMs: number;
  /** Which sheet the thumb lives in. */
  sheetIndex: number;
  /** Pixel rect within the sheet (the WebVTT `#xywh` values). */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TrickplaySheet = {
  index: number;
  /** Tile rows actually present (the last sheet is trimmed). */
  rows: number;
  cols: number;
  /** Sheet canvas dims in px — exactly cols·tileWidth × rows·tileHeight. */
  width: number;
  height: number;
  /** Thumbs on this sheet (< rows·cols only on the last sheet). */
  thumbCount: number;
  /** Global index of this sheet's first thumb. */
  firstThumbIndex: number;
};

export type TrickplayPlan = {
  intervalMs: number;
  tileWidth: number;
  tileHeight: number;
  thumbnailCount: number;
  /** Seek time per thumb, clamped so the last seek still yields a frame. */
  timestampsMs: number[];
  sheets: TrickplaySheet[];
  cues: TrickplayCue[];
};

/** Round to the nearest even integer, floored at 2 (encoder-safe tile dims). */
export function evenRound(v: number): number {
  return Math.max(2, 2 * Math.round(v / 2));
}

export function planTrickplay(
  args: {
    durationMs: number;
    srcWidth: number;
    srcHeight: number;
    /** One source frame's duration in ms (seek clamp headroom). */
    frameMs: number;
  } & TrickplayKnobs,
): TrickplayPlan {
  const { durationMs, srcWidth, srcHeight, frameMs } = args;
  if (!(durationMs > 0)) {
    throw new Error(`planTrickplay: durationMs must be > 0 (got ${durationMs})`);
  }
  if (!(srcWidth > 0) || !(srcHeight > 0)) {
    throw new Error(
      `planTrickplay: source dims must be > 0 (got ${srcWidth}×${srcHeight})`,
    );
  }

  const intervalMs = Math.max(1, Math.round(args.intervalSec * 1000));
  const cols = Math.max(1, Math.round(args.cols));
  const rowsPerSheet = Math.max(1, Math.round(args.rowsPerSheet));
  const tileWidth = evenRound(args.tileWidth);
  const tileHeight = evenRound(tileWidth * (srcHeight / srcWidth));

  const thumbnailCount = Math.max(1, Math.ceil(durationMs / intervalMs));

  // Seek at each interval start; clamp so the final seek lands at least
  // one frame before EOF (a seek at/past EOF yields no frame). t_0 stays 0.
  const maxSeek = Math.max(0, Math.round(durationMs - frameMs));
  const timestampsMs = Array.from({ length: thumbnailCount }, (_, i) =>
    Math.min(i * intervalMs, maxSeek),
  );

  const capacity = cols * rowsPerSheet;
  const sheetCount = Math.ceil(thumbnailCount / capacity);
  const sheets: TrickplaySheet[] = Array.from({ length: sheetCount }, (_, s) => {
    const firstThumbIndex = s * capacity;
    const thumbCount = Math.min(capacity, thumbnailCount - firstThumbIndex);
    const rows = Math.ceil(thumbCount / cols);
    return {
      index: s,
      rows,
      cols,
      width: cols * tileWidth,
      height: rows * tileHeight,
      thumbCount,
      firstThumbIndex,
    };
  });

  const cues: TrickplayCue[] = Array.from({ length: thumbnailCount }, (_, i) => {
    const sheetIndex = Math.floor(i / capacity);
    const j = i - sheetIndex * capacity;
    return {
      startMs: i * intervalMs,
      endMs: Math.min((i + 1) * intervalMs, Math.round(durationMs)),
      sheetIndex,
      x: (j % cols) * tileWidth,
      y: Math.floor(j / cols) * tileHeight,
      w: tileWidth,
      h: tileHeight,
    };
  });

  return {
    intervalMs,
    tileWidth,
    tileHeight,
    thumbnailCount,
    timestampsMs,
    sheets,
    cues,
  };
}
