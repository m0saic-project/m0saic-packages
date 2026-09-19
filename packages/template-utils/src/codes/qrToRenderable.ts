import type { M0String, StableKey } from "@m0saic/dsl";
import { parseM0StringToFullGraph, parseM0StringToRenderFrames } from "@m0saic/dsl";
import {
  qrToM0,
  replaceNodeByStableId,
  toM0String,
  type QrChannel,
  type QrChannelConfig,
  type QrChannelOutput,
} from "@m0saic/dsl-stdlib";
import type {
  MosaicColor,
  MosaicLavfiSource,
  MosaicOverlayExpr,
} from "@m0saic/types";
import { makeColorTile } from "../sources/makeColorTile";
import { makeQrEyeChildDoc } from "./makeQrEyeChildDoc";

/**
 * Text → renderable colored QR, as a flat `{ m0, sources }` pair.
 *
 * Accepts any string the QR encoder can carry (URL, plain text, structured
 * payloads built via `qrPayload*`, etc.). Mode is auto-detected by `qrToM0`.
 *
 * This is the single primitive every brand-QR template depends on. It
 * replaces the legacy path of "generate an SVG → rasterize to PNG via
 * `sharp` → place the PNG as a single media tile" with a fully in-house
 * pipeline: `qrToM0` from `@m0saic/dsl-stdlib` emits the per-module m0
 * geometry, and we attach one `makeColorTile` lavfi source per dark cell
 * so the renderer paints each module directly. The result composes into
 * a `MosaicDocument` with no external assets and no `sharp` raster step.
 *
 * Two-layer composition matches `qrToM0`:
 *   Layer 1 (base):    N×N nested grid; cells are "1" (dark module) or
 *                      "-" (light / quiet zone / safe-area cutout).
 *   Layer 2 (overlay): present when `safeArea` is supplied — a
 *                      `placeRect` that carves a centred frame whose
 *                      `safeAreaStableKey` callers can splice via
 *                      `replaceNodeByStableId` to drop in a logo / user
 *                      media. In this carve mode the splice frame is the
 *                      LAST cell in document order; we include a final
 *                      `makeColorTile` source for it so the source array
 *                      stays in lock-step with the m0's frame count, but
 *                      callers will typically replace it before render.
 *
 * Source-count invariant: `sources.length === renderable frame count of
 * the produced m0`. The renderer enumerates "1" cells in document order
 * and consumes one source per cell; getting this wrong drops or duplicates
 * modules at render time. The function validates the invariant itself
 * (throws if `qrToM0`'s composition ever drifts) so callers can trust it.
 *
 * Pure + deterministic — same `text`/`moduleColor`/options produce
 * byte-identical output.
 */

export type QrToRenderableOptions = {
  /** Text to encode (URL, plain string, structured payload, etc.). Mode auto-detected. */
  text: string;
  /**
   * Fill colour for every dark module. Each `"1"` cell becomes a
   * lavfi `color=...` source painted in this colour.
   */
  moduleColor: MosaicColor;
  /** ECC level. Default `"M"` to match `qrToM0`'s default. */
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  /** Force a specific QR version (1–40). Default: smallest that fits. */
  version?: number;
  /** Quiet-zone modules per side. ISO 18004 mandates ≥4. Default 4. */
  quietZoneModules?: number;
  /**
   * Reserve a centred safe area (e.g. for a logo). When present, the QR
   * is rendered in carve mode: cells inside the safe area are masked
   * from the base and a single overlay `F` is emitted as the splice
   * point. The returned `safeAreaStableKey` identifies that splice
   * frame for `replaceNodeByStableId`.
   */
  safeArea?: {
    width: number;
    height: number;
    paddingPct?: number;
  };
  /**
   * Per-cell overlay expression hook. Called once per renderable cell
   * in document order (the same order the renderer enumerates them).
   * Return `undefined` to leave the cell un-animated. Used for
   * pixelate-in animations (see `QrAnimateV2`).
   *
   * `cellIndex` is the 0-based document-order index; `totalCells` is
   * `sources.length`. When a `safeArea` carve is present, the LAST
   * cell is the safe-area splice point — callers that splice their own
   * m0 there can ignore the overlay returned for that index.
   */
  perCellOverlay?: (
    cellIndex: number,
    totalCells: number,
  ) => MosaicOverlayExpr | undefined;
  /**
   * Opt in to logical-rect overlay channels (eyes, alignmentPatterns,
   * timingPatterns, formatInfo, versionInfo, darkModule, separators).
   * Forwarded directly to `qrToM0`. See `qrToM0` docs for the full table
   * of defaults and semantics.
   *
   * When a channel is enabled, its cells are suppressed from the base
   * grid and replaced with single overlay frames the caller can splice
   * via `replaceNodeByStableId(m0, frame.stableKey, ...)`. The default
   * solid-colour sources emitted here just fill those overlay frames
   * with `moduleColor`; templates that want a richer treatment (e.g. a
   * concentric-square eye via `makeQrEyeChildDoc`) replace them.
   */
  channels?: Partial<Record<Exclude<QrChannel, "data" | "safeArea">, QrChannelConfig>>;
  /**
   * Engine-perf optimization: collapse remaining dark cells into the
   * smallest set of overlay rects. Visual output identical to default;
   * frame count drops. Forwarded to `qrToM0`. Default false.
   */
  pack?: boolean | { strategy?: "rowwise" };
  /**
   * Bake the Instagram-style rounded eye treatment directly into the m0.
   * Each finder pattern's splice-point F gets replaced by a 3-layer
   * concentric structure (outer dark rounded square, inner light ring,
   * center dot) with rounding applied per layer. Forces
   * `channels.eyes: true`. Templates don't need to wire up
   * `makeQrEyeChildDoc` themselves — qrToRenderable returns a complete
   * renderable with the eye visual already in place.
   *
   * Pass `true` for sensible defaults (radius 0.3 outer, circular dot,
   * inner light = `backgroundColor`). Pass an object to tune the look.
   */
  eyes?: true | QrEyeStyle;
  /**
   * Required when `eyes` is set: the colour used for the inner light
   * ring of the eye treatment (visually continuous with the canvas
   * background so the rounded corners don't reveal an unwanted colour).
   */
  backgroundColor?: MosaicColor;
};

export type QrEyeStyle = {
  /** Dark colour for outer ring + center dot. Defaults to `moduleColor`. */
  darkColor?: MosaicColor;
  /** Outer eye corner radius (0..1). Default 0.3. */
  outerBorderRadius?: number;
  /** Inner light ring corner radius (0..1). Defaults to match outer. */
  innerLightBorderRadius?: number;
  /** Center dot corner radius (0..1). Default 1.0 (circle). */
  innerDotBorderRadius?: number;
};

export type QrRenderable = {
  /** Canonical m0 string from `qrToM0`. */
  m0: M0String;
  /**
   * One colour-tile source per renderable cell, in document order.
   * Length matches the m0's renderable-frame count.
   */
  sources: MosaicLavfiSource[];
  /** Square canvas dimensions the m0 is designed for. */
  canvasW: number;
  canvasH: number;
  /** Matrix side length (modules-only, no quiet zone). */
  matrixSize: number;
  /** Quiet-zone modules per side. */
  quietZone: number;
  /** QR version selected (1–40). */
  version: number;
  /** ECC level actually applied. */
  errorCorrectionLevel: "L" | "M" | "Q" | "H";
  /**
   * Enabled channels from `qrToM0` (data + any opted-in overlays +
   * optional safeArea). Always includes a `data` entry; other entries
   * appear only when their channel is enabled. Use `channelByRole.X`
   * for fast lookup; iterate `channels` for m0 composition order.
   */
  channels: QrChannelOutput[];
  channelByRole: Partial<Record<QrChannel, QrChannelOutput>>;
  /**
   * Stable-key → human-readable label map. Includes one entry per
   * channel frame (eyes/alignment/etc.) + one per packed rect (when
   * `pack: true`) + one for the safeArea splice frame (when carving).
   * Base-grid data cells are NOT labeled (per-cell would be hundreds).
   * Forwarded from `qrToM0`; useful for m0c serialization.
   */
  labels: Record<StableKey, string>;
  /**
   * Inner safe-area bounds in canvas pixels. Present iff `safeArea`
   * was supplied. Reports the exact W×H rect the splice F occupies.
   * Also accessible via `channelByRole.safeArea?.frames[0].bounds`.
   */
  safeAreaBounds?: { x: number; y: number; width: number; height: number };
  /**
   * Stable key of the safe-area splice frame. Present iff `safeArea`
   * was supplied. Use with `replaceNodeByStableId` to swap in a logo
   * or other media; the corresponding source at the same index then
   * becomes redundant. Also accessible via
   * `channelByRole.safeArea?.frames[0].stableKey`.
   */
  safeAreaStableKey?: StableKey;
};

export function qrToRenderable(opts: QrToRenderableOptions): QrRenderable {
  const text = opts.text.trim();
  if (!text) {
    throw new Error("qrToRenderable: `text` is required (non-empty string)");
  }

  if (opts.eyes && !opts.backgroundColor) {
    throw new Error(
      "qrToRenderable: `backgroundColor` is required when `eyes` is set (used for the eye's inner light ring).",
    );
  }

  const safeAreaConfig = opts.safeArea
    ? {
        mode: "carve" as const,
        size: { width: opts.safeArea.width, height: opts.safeArea.height },
        paddingPct: opts.safeArea.paddingPct ?? 0,
      }
    : undefined;

  // When eye treatment is requested we must enable the eyes channel —
  // it's the only way to get F splice points to splice into. We merge
  // with any caller-supplied channels so the rest of their channel
  // selection is preserved. `suppressBase` drops the finder modules from
  // the base layer entirely: the spliced eye child is the region's only
  // paint, so styled base modules (circle dots) can't peek out past the
  // eye's rounded corners.
  const channelsForQr = opts.eyes
    ? { ...(opts.channels ?? {}), eyes: { emit: true, suppressBase: true } }
    : opts.channels;

  const qr = qrToM0(text, {
    errorCorrectionLevel: opts.errorCorrectionLevel ?? "M",
    quietZoneModules: opts.quietZoneModules ?? 4,
    ...(opts.version && opts.version > 0 ? { version: opts.version } : {}),
    ...(safeAreaConfig ? { safeArea: safeAreaConfig } : {}),
    ...(channelsForQr ? { channels: channelsForQr } : {}),
    ...(opts.pack !== undefined ? { pack: opts.pack } : {}),
  });

  // ── Eye treatment: splice each eye F with the concentric child m0 ──
  let m0Out: M0String = qr.m0;
  let eyeChildSources: MosaicLavfiSource[] = [];
  if (opts.eyes) {
    const eyeStyle: QrEyeStyle = opts.eyes === true ? {} : opts.eyes;
    const eyeChild = makeQrEyeChildDoc({
      darkColor: eyeStyle.darkColor ?? opts.moduleColor,
      backgroundColor: opts.backgroundColor!,
      outerBorderRadius: eyeStyle.outerBorderRadius ?? 0.3,
      ...(eyeStyle.innerLightBorderRadius !== undefined
        ? { innerLightBorderRadius: eyeStyle.innerLightBorderRadius }
        : {}),
      innerDotBorderRadius: eyeStyle.innerDotBorderRadius ?? 1.0,
    });
    eyeChildSources = eyeChild.sources as MosaicLavfiSource[];

    // Each eye is `-{-}` in qrToM0's output — an outer logical-owner
    // anchor (carries the stableKey + label) wrapping an inner `-` that
    // serves as the overlay body. We splice the eye child doc into the
    // INNER `-`, preserving the outer anchor + its stableKey. Replacing
    // the outer would orphan the attached `{-}` overlay block and
    // produce an invalid m0 (OVERLAY_CHAIN).
    const eyeFrames = qr.channelByRole.eyes?.frames ?? [];
    const editorFrames = parseM0StringToFullGraph(
      String(qr.m0),
      qr.canvasW,
      qr.canvasH,
    );
    let workingM0 = String(qr.m0);
    for (const ef of eyeFrames) {
      const outerKey = ef.stableKey as unknown as string;
      const outerFrame = editorFrames.find(
        (f) => (f.meta.stableKey as unknown as string) === outerKey,
      );
      if (!outerFrame) {
        throw new Error(
          `qrToRenderable: outer eye anchor not found for stableKey=${outerKey}`,
        );
      }
      // Inner overlay body: another `null` at the same bounds whose
      // stableKey descends from the outer (path contains an extra `/ov`
      // segment).
      const innerFrame = editorFrames.find(
        (f) =>
          f.kind === "null" &&
          f.x === outerFrame.x &&
          f.y === outerFrame.y &&
          f.width === outerFrame.width &&
          f.height === outerFrame.height &&
          (f.meta.stableKey as unknown as string) !== outerKey &&
          (f.meta.stableKey as unknown as string).startsWith(`${outerKey}/`),
      );
      if (!innerFrame) {
        throw new Error(
          `qrToRenderable: inner eye overlay body not found for stableKey=${outerKey}`,
        );
      }
      workingM0 = replaceNodeByStableId(
        workingM0,
        innerFrame.meta.stableKey as unknown as string,
        String(eyeChild.m0),
      );
    }
    m0Out = toM0String(workingM0, "qrToRenderable");
  }

  const renderFrames = parseM0StringToRenderFrames(
    String(m0Out),
    qr.canvasW,
    qr.canvasH,
  );
  const cellCount = renderFrames.length;
  if (cellCount === 0) {
    throw new Error(
      "qrToRenderable: qrToM0 produced an m0 with no renderable frames",
    );
  }

  // ── Sources ──
  //
  // Frame document order after eye splice (when applied):
  //   1. base-layer data cells (in row-scan order)
  //   2. eye overlay frames: each eye F is now 3 nested frames (outer
  //      dark, inner light ring, center dot), repeated for each eye in
  //      qrToM0's channel-frame order
  //   3. (optional) safe-area F
  //
  // We iterate render frames; cells before the eye block use moduleColor
  // tiles, the eye block consumes 3 sources per eye from eyeChildSources,
  // and a trailing safe-area cell (if carved) uses moduleColor too.
  const sources: MosaicLavfiSource[] = new Array(cellCount);
  const eyeFrames = opts.eyes ? (qr.channelByRole.eyes?.frames ?? []) : [];
  const eyeBlockCount = eyeFrames.length * eyeChildSources.length;
  const hasSafeArea = !!qr.safeAreaStableKey;
  const safeAreaCount = hasSafeArea ? 1 : 0;
  const dataCellEnd = cellCount - eyeBlockCount - safeAreaCount;

  for (let i = 0; i < cellCount; i++) {
    if (i < dataCellEnd) {
      const overlay = opts.perCellOverlay?.(i, cellCount);
      sources[i] = makeColorTile(opts.moduleColor, overlay ? { overlay } : undefined);
    } else if (i < dataCellEnd + eyeBlockCount) {
      // Eye block: 3 sources per eye in [outer dark, inner light, dot] order.
      const localIdx = (i - dataCellEnd) % eyeChildSources.length;
      sources[i] = eyeChildSources[localIdx];
    } else {
      // Safe-area splice point — caller typically replaces this.
      sources[i] = makeColorTile(opts.moduleColor);
    }
  }

  return {
    m0: m0Out,
    sources,
    canvasW: qr.canvasW,
    canvasH: qr.canvasH,
    matrixSize: qr.matrixSize,
    quietZone: qr.quietZone,
    version: qr.version,
    errorCorrectionLevel: qr.errorCorrectionLevel,
    channels: qr.channels,
    channelByRole: qr.channelByRole,
    labels: qr.labels,
    ...(qr.safeAreaBounds ? { safeAreaBounds: qr.safeAreaBounds } : {}),
    ...(qr.safeAreaStableKey
      ? { safeAreaStableKey: qr.safeAreaStableKey }
      : {}),
  };
}
