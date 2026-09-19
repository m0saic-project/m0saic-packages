/**
 * Text → renderable colored 1D barcode, as a flat `{ m0, sources }` pair.
 *
 * Mirrors `qrToRenderable` but for the in-house barcode library:
 *   - `barcodeToM0` from `@m0saic/dsl-stdlib` emits the per-bar m0 geometry.
 *   - One `makeColorTile` lavfi source is attached per dark bar so the
 *     renderer paints each bar directly.
 *   - When `humanReadable.mode === "carve"`, each HRI frame's splice-point
 *     F gets a default `makeColorTile(moduleColor)` source so the source
 *     array stays in lock-step with the m0's frame count. Templates that
 *     want to render the digit caption splice a text source in via
 *     `replaceNodeByStableId(m0, frame.stableKey, …)`.
 *
 * Source-count invariant: `sources.length === renderable frame count of
 * the produced m0`. Validated locally — callers can trust it.
 *
 * Pure + deterministic — same inputs produce byte-identical output.
 */

import type { M0String, StableKey } from "@m0saic/dsl";
import { parseM0StringToRenderFrames } from "@m0saic/dsl";
import {
  barcodeToM0,
  type BarcodeChannel,
  type BarcodeChannelConfig,
  type BarcodeChannelOutput,
  type BarcodeFormat,
  type BarcodeHriFrame,
  type HumanReadableSpec,
} from "@m0saic/dsl-stdlib";
import type {
  MosaicColor,
  MosaicLavfiSource,
  MosaicOverlayExpr,
} from "@m0saic/types";
import { makeColorTile } from "../sources/makeColorTile";

export type BarcodeToRenderableOptions = {
  /** Text to encode. For `code128`: ASCII 32–127. For `ean13`: 12 or 13 digits. For `upca`: 11 or 12 digits. */
  text: string;
  /** Symbology. Default `"code128"`. */
  format?: BarcodeFormat;
  /** Fill colour for every dark bar. Each dark bar becomes one `color=…` lavfi source. */
  moduleColor: MosaicColor;
  /** Pixels per module (both axes — cells are square). Default 2. */
  moduleWidthPx?: number;
  /** Bar region height in pixels. Rounded to nearest multiple of `moduleWidthPx`. Default 80. */
  heightPx?: number;
  /** Quiet-zone modules per side. Default per format (Code 128: 10, EAN-13/UPC-A: 9). */
  quietZoneModules?: number;
  /**
   * HRI band config. Default depends on format: Code 128 = `{ mode: "none" }`;
   * EAN-13 / UPC-A = `{ mode: "carve" }`. In carve mode, each HRI frame gets
   * a splice-point F that templates can replace with a text source.
   */
  humanReadable?: HumanReadableSpec;
  /**
   * Opt in to structural overlay channels (`quietZoneLeft`, `quietZoneRight`,
   * `startGuard`, `stopGuard`). Forwarded to `barcodeToM0`. See its docs for
   * the full table of defaults and semantics.
   */
  channels?: Partial<Record<
    Exclude<BarcodeChannel, "bars" | "humanReadable">,
    BarcodeChannelConfig
  >>;
  /**
   * Per-cell overlay expression hook. Called once per renderable cell in
   * document order. Return `undefined` to leave the cell un-animated.
   *
   * `cellIndex` is the 0-based document-order index; `totalCells` is
   * `sources.length`. Dark bars come first (one cell per bar), followed
   * by any HRI splice-point Fs (when carved).
   */
  perCellOverlay?: (
    cellIndex: number,
    totalCells: number,
  ) => MosaicOverlayExpr | undefined;
};

export type BarcodeRenderable = {
  /** Canonical m0 string from `barcodeToM0`. */
  m0: M0String;
  /**
   * One colour-tile source per renderable cell, in document order. Length
   * matches the m0's renderable-frame count.
   */
  sources: MosaicLavfiSource[];
  /** Canvas pixel dimensions. */
  canvasW: number;
  canvasH: number;
  format: BarcodeFormat;
  /** Total bar-region width in modules (includes both quiet zones). */
  modulesWide: number;
  /** Quiet-zone modules per side. */
  quietZoneModules: number;
  /** Final payload after any format-specific normalization (check digit appended). */
  payload: string;
  /** Full human-readable interpretation text. */
  humanReadableText: string;
  /**
   * Enabled channels from `barcodeToM0` (always includes `bars` + any
   * opted-in structural channels + `humanReadable` when carved).
   */
  channels: BarcodeChannelOutput[];
  channelByRole: Partial<Record<BarcodeChannel, BarcodeChannelOutput>>;
  /** Stable-key → human-readable label map. */
  labels: Record<StableKey, string>;
  /**
   * HRI frames with pixel bounds + (carve mode only) splice-point stableKeys.
   * Empty when `humanReadable.mode === "none"`. Length 1 for Code 128; 3 for
   * EAN-13; 4 for UPC-A.
   */
  humanReadableFrames: BarcodeHriFrame[];
};

export function barcodeToRenderable(
  opts: BarcodeToRenderableOptions,
): BarcodeRenderable {
  const text = opts.text.trim();
  if (!text) {
    throw new Error("barcodeToRenderable: `text` is required (non-empty string)");
  }

  const result = barcodeToM0(text, {
    ...(opts.format ? { format: opts.format } : {}),
    ...(opts.moduleWidthPx !== undefined ? { moduleWidthPx: opts.moduleWidthPx } : {}),
    ...(opts.heightPx !== undefined ? { heightPx: opts.heightPx } : {}),
    ...(opts.quietZoneModules !== undefined
      ? { quietZoneModules: opts.quietZoneModules }
      : {}),
    ...(opts.humanReadable ? { humanReadable: opts.humanReadable } : {}),
    ...(opts.channels ? { channels: opts.channels } : {}),
  });

  const renderFrames = parseM0StringToRenderFrames(
    String(result.m0),
    result.canvasW,
    result.canvasH,
  );
  const cellCount = renderFrames.length;
  if (cellCount === 0) {
    throw new Error(
      "barcodeToRenderable: barcodeToM0 produced an m0 with no renderable frames",
    );
  }

  // Sanity check: cellCount must equal numDarkBars + numHriFrames (carve only).
  // The `bars` channel reports one frame per dark bar; HRI frames are present
  // only when carved. This keeps templates honest if barcodeToM0's composition
  // ever drifts.
  const numBars = result.channelByRole.bars?.frames.length ?? 0;
  const numHriCarved = result.humanReadableFrames.filter((f) => f.stableKey).length;
  const expected = numBars + numHriCarved;
  if (cellCount !== expected) {
    throw new Error(
      `barcodeToRenderable: render-frame count ${cellCount} != bars(${numBars}) + carved HRI(${numHriCarved}) = ${expected}`,
    );
  }

  // One source per renderable cell. Document order: bars first, then HRI
  // splice points (left-to-right) when carved.
  const sources: MosaicLavfiSource[] = new Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    const overlay = opts.perCellOverlay?.(i, cellCount);
    sources[i] = makeColorTile(opts.moduleColor, overlay ? { overlay } : undefined);
  }

  return {
    m0: result.m0,
    sources,
    canvasW: result.canvasW,
    canvasH: result.canvasH,
    format: result.format,
    modulesWide: result.modulesWide,
    quietZoneModules: result.quietZoneModules,
    payload: result.payload,
    humanReadableText: result.humanReadableText,
    channels: result.channels,
    channelByRole: result.channelByRole,
    labels: result.labels,
    humanReadableFrames: result.humanReadableFrames,
  };
}
