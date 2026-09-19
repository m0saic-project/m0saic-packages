/**
 * ⚠️ DEPRECATED (2026-07-21) — superseded by `./v2` (`@m0saic/media/screencap_grid/v2`).
 *
 * Archived as the canonical "ideal-cell gap inset" reference. This version
 * realizes the inter-tile gap with `gridCellInset`: half-gap FRACTIONS
 * computed against the IDEAL cell size (`gridW / cols`), applied by the
 * engine as `floor(frac × actualCellPx)` against the QUANTIZED cell the
 * equal split actually produced. It is the natural math a template author
 * reaches for first — and it is approximate, not exact:
 *
 * 1. Under the content-driven info pane the grid region height is arbitrary
 *    (e.g. 1080 − 110 = 970px → 4 rows of 243/242/243/242), so the same
 *    fraction recovers 1px on one row and 0px on the next — a 2px gap
 *    wobbles between 2px and 0px depending on how each cell rounded.
 * 2. Even on exactly-dividing cells, a plain `n / cell` fraction can
 *    floor-lose the pixel (`floor((1/480)·480) → 0` under IEEE) — the
 *    half-pixel-centering problem `placeInsetRects` documents.
 * 3. The custom-grid path's uniform `(gap/2)/dim` fractions shared failure
 *    mode 2, and the timestamp chips (no inset at all) could hang into the
 *    carved gap.
 *
 * v2 fixes all three by computing every painted rect in integer pixels and
 * emitting the layout through `placeInsetPieces` (inset-recovery, handbook
 * feasibility-precision-quantization.md §3c) — pixel-exact gaps at every
 * canvas, bounded precision. The pure formatting/timestamp helpers below are
 * NOT deprecated — v2 and the aspect-safe sibling import them from here.
 */
import type {
  MosaicAssetManifest,
  MosaicBoxFrac,
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaMetadata,
  MosaicOutputFormat,
  MosaicPipelineStep,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asAssetId , asTemplateId } from "@m0saic/types";
import { toM0String, weightedSplit, grid, addOverlayToAllFrames } from "@m0saic/dsl-stdlib";
import { isValidM0String, parseM0StringToRenderFrames, type M0String } from "@m0saic/dsl";
import {
  buildStepNames,
  definePropsSchema,
  registerTemplate,
  makeErrorMosaic,
  renderNestedTemplate,
  slugifyAssetKeyFromPath,
  gridCellInset,
} from "@m0saic/template-utils";

// Import internal subtemplate for registration side-effect
import { INFO_PANE_TEMPLATE_ID } from "../internal/info_pane";

// ---- PROPS ----

export type ScreencapGridProps = {
  /**
   * The grid's source input(s) — THE source knob. When set with length > 1
   * the template fans out as an `emit: "multi"` pipeline: one render per
   * file, named after the file's basename. With length 1 it renders a
   * single grid.
   */
  sourceIds?: string[];

  /**
   * Deliverable format: "png" renders a static contact sheet (each tile a
   * frozen frame at its timestamp); "mp4" renders an animated grid (each
   * tile plays from its timestamp). Default "png".
   */
  outputFormat?: ScreencapOutputFormat;

  /** Number of grid rows. */
  rows?: number;
  /** Number of grid columns. */
  cols?: number;

  /** Show the info pane with filename + metadata above the grid. Height is auto-calculated from content. */
  withInfoPane?: boolean;

  /** Horizontal alignment of the info-pane text (filename + metadata). Default "left". */
  headerAlign?: TextAlign;

  /** Whether to overlay a timestamp in each tile. */
  withTileTimestamp?: boolean;

  /** Which corner the per-tile timestamp sits in. Default "br" (bottom-right). */
  timestampCorner?: TileCorner;

  /** Timestamp text color. Default white. */
  timestampColor?: MosaicColor;

  /** Timestamp background color (the chip behind the text). Default none (transparent). */
  timestampBgColor?: MosaicColor;

  /**
   * Gap between tiles, in pixels. Applied as a per-tile inset (a render-time
   * rect shrink) rather than DSL gutters — so it's pixel-exact, nudges 1px at
   * a time, and adds no DSL tokens (keeps the grid cheap). Default 2.
   *
   * The grid always fills the canvas (gutterless cells + this inset gap); the
   * cells read as equal, so there's no separate canvas-fit mode.
   */
  tileGapPx?: number;

  /**
   * How each frame fills its tile. `cover` crops to fill the cell; `contain`
   * letterboxes the whole frame (spare area shows the grid document's
   * background). Default "cover".
   */
  tileFit?: "contain" | "cover";

  /**
   * Escape hatch: a custom m0 layout string used for the grid instead of the
   * generated `rows × cols` grid. One media tile (with its timestamp) is bound
   * per rendered cell, in document order — so you can give some cells emphasis
   * (bigger frames) by authoring the geometry yourself. When set, `rows`/`cols`
   * are ignored; every other knob (info pane, header align, timestamp, gap)
   * still applies. Accepts a bare m0 or a pasted `.m0` file (header comments
   * are stripped).
   */
  customGrid?: string;
};

/** Deliverable format for the grid — static PNG sheet or animated MP4. */
export type ScreencapOutputFormat = "png" | "mp4";

/** Horizontal text alignment for the info-pane header. */
export type TextAlign = "left" | "center" | "right";

/** Corner placement for a per-tile overlay (e.g. the timestamp). */
export type TileCorner = "tl" | "tr" | "bl" | "br";

const propsSchema = definePropsSchema<ScreencapGridProps>({
  // The one source input. One required "Source(s)" field that takes a
  // folder, one or many files, or drag-and-drop. A single file renders one
  // grid; multiple fan out as an `emit: "multi"` pipeline (one render per
  // file).
  sourceIds: {
    type: "media[]",
    required: true,
    description:
      "Source video(s) for the grid — pick a folder, one or more files, or drag-and-drop. One render per file (emit:multi when >1).",
    meta: {
      ui: { label: "Source(s)" },
      control: { multiple: true, picker: "folder", accept: ["video"] },
    },
  },
  // Reserved prop-bag convention (trickplay precedent): a prop named
  // `outputFormat` holding a container name drives the Make page's Output
  // Type + container + default output extension.
  outputFormat: {
    type: "string",
    required: false,
    description:
      'Deliverable format. "png" renders a static contact sheet; "mp4" renders an animated grid where each tile plays from its timestamp.',
    meta: {
      constraints: { oneOf: ["png", "mp4"] },
      ui: { label: "Output" },
    },
  },
  rows: {
    type: "number",
    required: false,
    description: "Number of rows in the screenshot grid.",
    meta: { constraints: { min: 1, max: 20 }, ui: { label: "Rows" } },
  },
  cols: {
    type: "number",
    required: false,
    description: "Number of columns in the screenshot grid.",
    meta: { constraints: { min: 1, max: 20 }, ui: { label: "Cols" } },
  },
  withInfoPane: {
    type: "boolean",
    required: false,
    description: "Show the info pane with filename + metadata above the grid.",
    meta: { ui: { label: "Info Pane" } },
  },
  headerAlign: {
    type: "string",
    required: false,
    description: "Alignment of the info-pane text (filename + metadata).",
    meta: {
      constraints: { oneOf: ["left", "center", "right"] },
      ui: { label: "Header Align" },
    },
  },
  withTileTimestamp: {
    type: "boolean",
    required: false,
    description: "Overlay a timestamp in each tile.",
    meta: { ui: { label: "Tile Timestamp" } },
  },
  timestampCorner: {
    type: "string",
    required: false,
    description: "Which corner the per-tile timestamp sits in.",
    meta: {
      constraints: { oneOf: ["tl", "tr", "bl", "br"] },
      ui: { label: "Timestamp Corner" },
    },
  },
  timestampColor: {
    type: "string",
    required: false,
    description: "Timestamp text color.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true },
      ui: { label: "Timestamp Color" },
    },
  },
  timestampBgColor: {
    type: "string",
    required: false,
    description: "Timestamp background color (chip behind the text).",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true },
      ui: { label: "Timestamp Background" },
    },
  },
  tileGapPx: {
    type: "number",
    required: false,
    description: "Gap between tiles, in pixels.",
    meta: {
      constraints: { min: 0, max: 40 },
      control: { flavor: "slider", step: 1, unit: "px" },
      ui: { label: "Tile Gap" },
    },
  },
  tileFit: {
    type: "string",
    required: false,
    description:
      "How each frame fills its tile. Cover crops to fill; contain letterboxes the whole frame.",
    meta: {
      constraints: { oneOf: ["contain", "cover"] },
      ui: { label: "Tile Fit" },
    },
  },
  customGrid: {
    type: "m0",
    required: false,
    description:
      "Custom m0 layout for the grid (overrides rows/cols). One tile is bound per cell, in order — give some cells emphasis by sizing them. Other knobs still apply.",
    meta: {
      control: { placeholder: "e.g. 2(3(F,F,F),3(F,>,F))" },
      ui: { label: "Custom Grid" },
    },
  },
});

// ---- HELPERS ----

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatTimestamp(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const frac = Math.round(ms % 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${String(frac).padStart(3, "0")}`;
}

/**
 * Build a per-tile timestamp overlay text source. Shared by screencap_grid and
 * the aspect-safe variant so corner placement, text color, and the
 * behind-glyphs box background (drawtext `box`, NOT a full-rect fill) stay
 * identical across both. `bgColor === "none"` → no box.
 */
export function buildTimestampSource(opts: {
  /** Seek time in ms (0 for stills). */
  t: number;
  mode: "static" | "animated";
  isVideo: boolean;
  corner: TileCorner;
  color: MosaicColor;
  bgColor: MosaicColor;
}): MosaicSource {
  const { t, mode, isVideo, corner, color, bgColor } = opts;
  const startSec = (t / 1000).toFixed(3);
  // HH:MM:SS.mmm via FFmpeg text expansion.
  const expr = `%{eif\\:(t+${startSec})/3600\\:d\\:2}:%{eif\\:mod((t+${startSec})/60\\,60)\\:d\\:2}:%{eif\\:mod(t+${startSec}\\,60)\\:d\\:2}.%{eif\\:mod((t+${startSec})*1000\\,1000)\\:d\\:3}`;

  const hasBg = bgColor !== "none";
  const style = {
    fontSize: 18,
    fontColor: color,
    borderWidth: 0.003,
    borderColor: "black@0.8" as const,
    ...(hasBg ? { boxColor: bgColor, boxBorderWidth: 6 } : {}),
  };
  const visual = { backgroundColor: "none" as const };
  const hAlign = corner === "tr" || corner === "br" ? ("right" as const) : ("left" as const);
  const vAlign = corner === "tl" || corner === "tr" ? ("top" as const) : ("bottom" as const);
  const placement = { hAlign, vAlign, padding: { x: 0.02, y: 0.03 } };

  const layer =
    mode === "animated"
      ? { content: { kind: "expr" as const, expr, eval: "frame" as const }, style, visual, placement }
      : {
          content: {
            kind: "literal" as const,
            text: isVideo ? formatTimestamp(t) : "00:00:00.000",
          },
          style,
          visual,
          placement,
        };

  return {
    type: "text",
    renderMode: mode === "animated" ? { kind: "video" } : { kind: "image" },
    layers: [layer],
    editor: { owner: "template" },
  };
}

function formatDuration(ms: number): string {
  // keep your original format for Duration line
  const totalSec = ms / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = (totalSec % 60).toFixed(2);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function formatBitrate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbit/s`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbit/s`;
  return `${bps} bit/s`;
}

function commaNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Best-effort bit depth from ffprobe pix_fmt string.
 * Returns undefined when the format is unrecognized.
 */
function bitDepthFromPixFmt(pixFmt: string | undefined): number | undefined {
  if (!pixFmt) return undefined;
  if (/10le|10be|p010|p210|y210/.test(pixFmt)) return 10;
  if (/12le|12be|p012|p212/.test(pixFmt)) return 12;
  if (/16le|16be/.test(pixFmt)) return 16;
  // Most common 8-bit formats
  if (/^(yuv|yuvj|nv|rgb|bgr|gray|pal8|ya8|rgba|bgra)/.test(pixFmt)) return 8;
  return undefined;
}

function formatSampleRate(hz: number): string {
  if (hz >= 1000 && hz % 1000 === 0) return `${hz / 1000} kHz`;
  if (hz >= 1000) return `${(hz / 1000).toFixed(1)} kHz`;
  return `${hz} Hz`;
}

// ---- Font sizing (shared between height estimation and info_pane rendering) ----

/** Title font size derived from output height, not pane height. */
export function infoPaneTitleFontSize(targetH: number): number {
  return Math.max(16, Math.min(48, Math.round(targetH * 0.022)));
}

/** Metadata font size derived from output height, not pane height. */
export function infoPaneMetaFontSize(targetH: number): number {
  return Math.max(9, Math.min(20, Math.round(targetH * 0.012)));
}

/**
 * Estimate the pixel height needed for the info pane content.
 * Uses the same font-sizing formulas as info_pane.ts rendering.
 */
export function estimateInfoPaneHeight(targetH: number, metaLineCount: number): number {
  const titleFs = infoPaneTitleFontSize(targetH);
  const metaFs = infoPaneMetaFontSize(targetH);

  const topPad = 6;
  const titleLineH = Math.round(titleFs * 1.3);
  const gap = Math.round(titleFs * 0.35);
  const metaBlockH = metaLineCount > 0 ? Math.round(metaLineCount * metaFs * 1.45) : 0;
  const bottomPad = 8;

  return topPad + titleLineH + gap + metaBlockH + bottomPad;
}

export function formatInfoLines(
  sourceId: string,
  meta: MosaicMediaMetadata,
): { title: string; metadata: string; metaLineCount: number } {
  const title = meta.originalFileName ?? sourceId;
  const lines: string[] = [];

  // -- Summary line: Duration | Size | Bitrate | Container --
  const summaryParts: string[] = [];
  if (meta.durationMs != null)
    summaryParts.push(`Duration: ${formatDuration(meta.durationMs)}`);
  if (meta.format?.sizeBytes != null)
    summaryParts.push(
      `Size: ${formatBytes(meta.format.sizeBytes)} (${commaNumber(meta.format.sizeBytes)} bytes)`
    );
  if (meta.format?.bitRate != null)
    summaryParts.push(`Bitrate: ${formatBitrate(meta.format.bitRate)}`);
  const containerName = meta.format?.formatLongName ?? meta.format?.formatName;
  if (containerName) summaryParts.push(`Container: ${containerName}`);
  if (summaryParts.length > 0) lines.push(summaryParts.join("  |  "));

  // -- Video stream line --
  if (meta.video?.codecName || meta.hasVideo) {
    const vParts: string[] = [];
    const idx = meta.video?.streamIndex;
    vParts.push(idx != null ? `Stream ${idx} Video:` : "Video:");
    if (meta.width || meta.height) vParts.push(`${meta.width}x${meta.height}`);
    if (meta.video?.pixFmt) vParts.push(meta.video.pixFmt);
    const bd = bitDepthFromPixFmt(meta.video?.pixFmt);
    if (bd != null) vParts.push(`${bd}-bit`);
    if (meta.fps != null) vParts.push(`${meta.fps.toFixed(2)} fps`);
    const codecLabel = meta.video?.codecLongName ?? meta.video?.codecName;
    if (codecLabel) vParts.push(codecLabel);
    if (meta.video?.profile) vParts.push(`(${meta.video.profile})`);
    lines.push(vParts.join(" "));
  }

  // -- Audio stream line --
  if (meta.audio?.codecName || meta.hasAudio) {
    const aParts: string[] = [];
    const idx = meta.audio?.streamIndex;
    aParts.push(idx != null ? `Stream ${idx} Audio:` : "Audio:");
    if (meta.audio?.channelLayout) aParts.push(meta.audio.channelLayout);
    else if (meta.audio?.channels) aParts.push(`${meta.audio.channels}ch`);
    if (meta.audio?.sampleRate) aParts.push(formatSampleRate(meta.audio.sampleRate));
    if (meta.audio?.bitRate) aParts.push(formatBitrate(meta.audio.bitRate));
    const aCodecLabel = meta.audio?.codecLongName ?? meta.audio?.codecName;
    if (aCodecLabel) aParts.push(aCodecLabel);
    lines.push(aParts.join(" "));
  }

  // -- Chapters / Programs --
  const extras: string[] = [];
  if (meta.chapters && meta.chapters.length > 0)
    extras.push(`Chapters: ${meta.chapters.length}`);
  if (meta.programs && meta.programs.length > 0)
    extras.push(`Programs: ${meta.programs.length}`);
  if (extras.length > 0) lines.push(extras.join("  |  "));

  const filteredLines = lines.filter(Boolean);
  const metadata = filteredLines.join("\n");
  return { title, metadata, metaLineCount: filteredLines.length };
}

/**
 * Assemble the layout m0: an optional info-pane row on top of a gutterless
 * grid that fills the canvas. Frame order is `[info-pane, tile, tile, …]` so
 * the caller's source array maps positionally. The grid is gutterless (the
 * compact `equalSplit` path) — the inter-tile gap is a per-tile inset on the
 * media sources, so it costs no DSL tokens here.
 *
 * `gridM0` overrides the generated `rows × cols` grid with a caller-supplied
 * layout (the custom-grid escape hatch); the timestamp overlay + info-pane
 * wrapping still apply on top.
 *
 * `paneHeightPx` / `gridH` are pixel heights summing to the canvas height, so
 * the `[pane, grid]` split lands the grid on exactly `gridH`.
 */
export function assembleScreencapM0(args: {
  rows: number;
  cols: number;
  /** Info-pane pixel height. 0 → no info pane. */
  paneHeightPx: number;
  /** Grid region pixel height (canvas height minus the info pane). */
  gridH: number;
  withTileTimestamp: boolean;
  /** Custom grid m0 (escape hatch). When set, replaces the generated grid. */
  gridM0?: string;
}): string {
  const { rows, cols, paneHeightPx, gridH, withTileTimestamp, gridM0 } = args;

  // gridM0 is a caller-validated m0; cast to the branded type for the builders.
  const bareGrid = (gridM0 ?? grid({ rows, cols }).m0) as M0String;
  const gridStr = withTileTimestamp ? addOverlayToAllFrames(bareGrid) : bareGrid;

  if (paneHeightPx <= 0) return gridStr;
  return weightedSplit([paneHeightPx, gridH], "row", {
    claimants: ["F", gridStr],
  });
}

/**
 * Compute deterministic seek timestamps for N grid tiles.
 * Returns timestamps in ms, strictly in (0, durationMs).
 */
export function computeTimestamps(n: number, durationMs: number): number[] {
  const d = Math.max(0, durationMs);

  // If duration is extremely small, just return midpoints clamped
  if (d <= 2) return Array.from({ length: n }, () => 1);

  return Array.from({ length: n }, (_, i) => {
    const t = ((i + 1) / (n + 1)) * d;
    // clamp to (0, d)
    return Math.min(d - 1, Math.max(1, Math.round(t)));
  });
}

// ---- SHARED RENDER ----

type ScreencapMode = "static" | "animated";

/** Resolve the render mode from the `outputFormat` knob (default png/static). */
function resolveMode(props: ScreencapGridProps): ScreencapMode {
  return props.outputFormat === "mp4" ? "animated" : "static";
}

/**
 * The output format each rendered document declares for its mode. Baked
 * per-doc (watermark/trickplay's per-step-format precedent) so under
 * `emit: "multi"` every step switches the command build into the right
 * graph mode, and hosts reading the resolved renderable (e.g. the Run
 * view's extension pick) see the authored container.
 */
function formatForMode(mode: ScreencapMode): MosaicOutputFormat {
  return mode === "animated"
    ? { kind: "video", container: "mp4" }
    : { kind: "image", container: "png" };
}

/**
 * Resolve the effective input list from props. Returns `[]` when
 * `sourceIds` is empty/unset — callers surface that as a fail-fast error.
 */
function resolveInputs(props: ScreencapGridProps): string[] {
  if (props.sourceIds && props.sourceIds.length > 0) return props.sourceIds;
  return [];
}

/**
 * Resolve the tile gap in pixels. `tileGapPx` is the current prop; older docs
 * may carry the deprecated fractional `tileGap` — bridge it to an approximate
 * pixel value (≈ fraction of a 1080p-ish cell) so they don't snap to 0.
 */
function resolveTileGapPx(props: ScreencapGridProps): number {
  if (typeof props.tileGapPx === "number" && props.tileGapPx >= 0) {
    return props.tileGapPx;
  }
  const legacyFraction = (props as { tileGap?: number }).tileGap;
  if (typeof legacyFraction === "number" && legacyFraction > 0) {
    return Math.round(legacyFraction * 480);
  }
  return SHARED_DEFAULTS.tileGapPx!;
}

/**
 * Resolve the optional custom-grid m0. Accepts a bare m0 or a pasted `.m0`
 * file — strips `#` header comment lines and blank lines. Returns null when
 * empty (use the generated rows × cols grid).
 */
function resolveCustomGrid(raw: string | undefined): string | null {
  if (!raw) return null;
  const m0 = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .join("");
  return m0.length > 0 ? m0 : null;
}

/**
 * Top-level dispatcher.
 *
 * - 0 inputs → fail-fast error mosaic.
 * - 1 input → single `MosaicDocument`.
 * - N inputs → `MosaicDocumentPipeline` with `emit: "multi"`,
 *              one step per input.
 *
 * The `outputFormat` knob picks the mode: png → static contact sheet,
 * mp4 → animated grid.
 */
export async function renderScreencapGrid(
  props: ScreencapGridProps,
  ctx: MosaicEngineContext,
): Promise<MosaicRenderableFile> {
  const mode = resolveMode(props);
  const inputs = resolveInputs(props);
  if (inputs.length === 0) {
    return makeErrorMosaic(
      'Missing required "Source(s)": pick a folder, one or more files, or drag-and-drop.',
      {
        title: "Screencap Grid",
        width: ctx.target.width,
        height: ctx.target.height,
      },
    );
  }

  if (inputs.length === 1) {
    return renderScreencapGridForInput(inputs[0], props, ctx, mode);
  }

  return buildMultiInputPipeline(inputs, props, ctx, mode);
}

/**
 * Build the `emit: "multi"` pipeline that fans out to one render per
 * input. Each step's `file` is a single-input MosaicDocument; the step's
 * `name` and `label` are derived from the input filename so the CLI's
 * `--output-pattern {{label}}` slot has something meaningful to write.
 */
async function buildMultiInputPipeline(
  inputs: string[],
  props: ScreencapGridProps,
  ctx: MosaicEngineContext,
  mode: ScreencapMode,
): Promise<MosaicDocumentPipeline> {
  const stepNames = buildStepNames(inputs);
  // Static sheets are single-frame renders — a fixed nominal duration
  // (trickplay's image-step precedent); animated steps track the target.
  const stepDurationMs =
    mode === "animated" ? (ctx.target.durationMs ?? 5000) : 40;

  const steps: MosaicPipelineStep[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const file = await renderScreencapGridForInput(inputs[i], props, ctx, mode);
    steps.push({
      name: stepNames[i],
      label: stepNames[i],
      durationMs: stepDurationMs,
      file,
    });
  }

  return {
    kind: "mosaic_pipeline",
    version: 1,
    emit: "multi",
    steps,
  };
}

/**
 * Render a single screencap-grid document for one input path. Pulled out
 * of {@link renderScreencapGrid} so the multi-input path can reuse it
 * per input.
 */
async function renderScreencapGridForInput(
  sourceId: string,
  props: ScreencapGridProps,
  ctx: MosaicEngineContext,
  mode: ScreencapMode,
): Promise<MosaicDocument> {
  // `sourceId` is, by current convention, whatever string the caller
  // passed (in the editor / CLI today this is an absolute filesystem path,
  // not a clean id). `ctx.media` is keyed by that same raw string, so the
  // metadata probe has to use it as-is. But the OUTGOING manifest key must
  // be a safe slug — paths with spaces / drive letters / Unicode would fail
  // ASSET_KEY_PATTERN at plan-build.
  const ctxMediaKey = asAssetId(sourceId);
  const sourceAssetId = asAssetId(slugifyAssetKeyFromPath(sourceId));
  const meta = ctx.media[ctxMediaKey];
  const rows = props.rows ?? 4;
  const cols = props.cols ?? 4;
  const withInfoPane = props.withInfoPane ?? true;
  const headerAlign = props.headerAlign ?? SHARED_DEFAULTS.headerAlign!;
  const withTileTimestamp = props.withTileTimestamp ?? true;
  const timestampCorner = props.timestampCorner ?? SHARED_DEFAULTS.timestampCorner!;
  const tileGapPx = resolveTileGapPx(props);
  const timestampColor = props.timestampColor ?? SHARED_DEFAULTS.timestampColor!;
  const timestampBgColor = props.timestampBgColor ?? SHARED_DEFAULTS.timestampBgColor!;
  const tileFit = props.tileFit ?? SHARED_DEFAULTS.tileFit!;

  const canvasW = ctx.target.width;
  const canvasH = ctx.target.height;

  // Escape hatch: a custom m0 layout replaces the generated rows × cols grid.
  const customGridM0 = resolveCustomGrid(props.customGrid);
  if (customGridM0 && !isValidM0String(customGridM0)) {
    return makeErrorMosaic("Custom Grid is not a valid m0 string.", {
      title: "Screencap Grid",
      width: canvasW,
      height: canvasH,
    });
  }

  const children: Record<string, MosaicRenderableFile> = {};

  // Info-pane header height (px). Content-driven; fonts are baked from the
  // FULL canvas height (see info_pane.ts), so the pane height and its font
  // sizes stay consistent.
  let paneHeightPx = 0;
  let infoTitle = "";
  let infoMeta = "";
  if (withInfoPane) {
    const info = meta
      ? formatInfoLines(sourceId, meta)
      : { title: `No metadata for sourceId=${sourceId}`, metadata: "", metaLineCount: 0 };
    const ratio = Math.max(0.03, Math.min(0.25,
      estimateInfoPaneHeight(canvasH, info.metaLineCount) / canvasH
    ));
    // Floor at 1px so `withInfoPane` always reserves a pane frame — keeps
    // the source array ([info-pane, media…]) aligned with the rendered
    // frames even on pathologically small canvases.
    paneHeightPx = Math.max(1, Math.round(canvasH * ratio));
    infoTitle = info.title;
    infoMeta = info.metadata;
  }

  // The grid always fills the canvas: full width × the area below the info
  // pane. Gutterless cells; the gap is a per-tile inset (below).
  const gridW = canvasW;
  const gridH = Math.max(1, canvasH - paneHeightPx);

  // Cell count + per-cell gap inset. Custom grid: one tile per rendered cell,
  // gap derived from each cell's own pixel size (so uneven cells still get an
  // even pixel gap). Generated grid: uniform rows × cols via gridCellInset.
  let cellCount: number;
  let tileInsetFor: (i: number) => MosaicBoxFrac | undefined;
  if (customGridM0) {
    const frames = parseM0StringToRenderFrames(customGridM0, gridW, gridH);
    cellCount = frames.length;
    const dimsByLogical = new Map<number, { width: number; height: number }>();
    for (const f of frames) dimsByLogical.set(f.logicalIndex, { width: f.width, height: f.height });
    tileInsetFor = (i) => {
      const f = dimsByLogical.get(i);
      if (!f || tileGapPx <= 0 || f.width <= 0 || f.height <= 0) return undefined;
      return { x: (tileGapPx / 2) / f.width, y: (tileGapPx / 2) / f.height };
    };
  } else {
    cellCount = rows * cols;
    const cellInset = gridCellInset({ rows, cols, gridW, gridH, gapPx: tileGapPx });
    tileInsetFor = (i) => cellInset(Math.floor(i / cols), i % cols);
  }

  if (withInfoPane) {
    // The info pane spans the full canvas width; height stays canvasH so
    // drawtext font sizes match estimateInfoPaneHeight's assumptions (the
    // child rasterizes at its parent frame size regardless).
    const infoPaneFile = await renderNestedTemplate(
      INFO_PANE_TEMPLATE_ID,
      { title: infoTitle, metadata: infoMeta, paneHeight: paneHeightPx, align: headerAlign },
      ctx,
      { slot: { width: canvasW, height: canvasH } },
    );
    children["info-pane"] = infoPaneFile;
  }

  const N = cellCount;

  const isVideo =
    meta?.kind === "video" && meta.durationMs != null && meta.durationMs > 0;

  const timestamps = isVideo ? computeTimestamps(N, meta.durationMs!) : [];

  const mediaType =
    meta?.kind === "video"
      ? ("video" as const)
      : meta?.kind === "audio"
        ? ("audio" as const)
        : ("image" as const);

  const frameMs = Math.max(
    1,
    Math.round(1000 / (meta?.fps ?? ctx.target.fps ?? 30))
  );

  const sources: MosaicSource[] = [];
  if (withInfoPane) {
    // The pane child rasterizes at full canvas height with its text in the
    // top strip; a top-anchored cover crop (focusY: 0) shows exactly that
    // strip in the ~paneHeightPx cell. The default contain fit would scale
    // the whole full-height frame down into the cell (≈2px text).
    sources.push({ type: "mosaic", ref: "info-pane", placement: { fit: "cover", focusY: 0 } });
  }

  for (let i = 0; i < N; i++) {
    const t = isVideo ? timestamps[i] : 0;
    const tileInset = tileInsetFor(i);

    // Media tile
    sources.push({
      type: "media",
      mediaType,
      assetId: sourceAssetId,
      placement: { fit: tileFit, ...(tileInset ? { inset: tileInset } : {}) },
      ...(isVideo
        ? {
          playback:
            mode === "animated"
              ? { clipStartMs: t }
              : { clipStartMs: t, clipDurationMs: frameMs, loopMode: "freeze" },
          audio: { enabled: false },
        }
        : {}),
      editor: { owner: "template" },
    });

    // Timestamp overlay (corner + color + behind-glyphs box per props).
    if (withTileTimestamp) {
      sources.push(
        buildTimestampSource({
          t,
          mode,
          isVideo,
          corner: timestampCorner,
          color: timestampColor,
          bgColor: timestampBgColor,
        }),
      );
    }
  }

  const m0saic = assembleScreencapM0({
    rows, cols, paneHeightPx, gridH, withTileTimestamp,
    ...(customGridM0 ? { gridM0: customGridM0 } : {}),
  });

  // Mint the file asset for the source media so this document is hermetic
  // when used as the root renderable (e.g. via CLI `make`). When nested as
  // a child, the parent's manifest entry under the same assetId is identical
  // (path + mediaType derived from the same sourceId), so scope merge is a
  // no-op rather than a conflict.
  const assets: MosaicAssetManifest = {
    [sourceAssetId]: {
      kind: "file",
      path: sourceId,
      mediaType,
    },
  };

  return {
    kind: "mosaic_document",
    version: 1,
    sources,
    assets,
    m0: toM0String(m0saic, "ScreencapGrid"),
    children,
    format: formatForMode(mode),
  };
}

// ---- TEMPLATE ----

const SHARED_DEFAULTS: Omit<ScreencapGridProps, "sourceIds"> = {
  outputFormat: "png",
  rows: 4,
  cols: 4,
  withInfoPane: true,
  headerAlign: "left",
  withTileTimestamp: true,
  timestampCorner: "br",
  timestampColor: "#ffffff",
  timestampBgColor: "none",
  tileGapPx: 2,
  tileFit: "cover",
};

export const ScreencapGrid: MosaicTemplate<ScreencapGridProps> = {
  id: asTemplateId("@m0saic/media/screencap_grid/v1"),
  label: "Screencap Grid",
  description:
    "Displays formatted ffprobe info in a top pane with a rows x cols grid of the same media below. Renders a static PNG contact sheet or an animated MP4 grid via the Output knob.",
  version: 1,
  capabilities: { tier: "core" },
  deprecated: {
    reason:
      "Approximate gap math: the inter-tile gap rides as gridCellInset fractions computed against the IDEAL cell size, but the engine floors them against the QUANTIZED cells the equal split actually produced — under the content-driven info pane a 2px gap wobbles between 2px and 0px row to row, and plain n/cell fractions floor-lose even on exact cells. Kept as the canonical 'ideal-cell gap inset' reference — it is the math a template author naturally reaches for first. Use v2: the SAME picture with every painted rect computed in integer pixels and emitted via inset-recovery placement (placeInsetPieces, handbook §3c) — pixel-exact gaps at every canvas, bounded precision.",
    replacement: asTemplateId("@m0saic/media/screencap_grid/v2"),
    since: "2026-07-21",
  },
  tags: ["media", "screencap"],
  propsSchema,

  // No `format` hint on purpose (watermark/trickplay precedent): the
  // `outputFormat` knob picks png vs mp4 per render, and a template-level
  // container hint would override the user's `-o` extension in
  // `resolveOutputFormat`. Each rendered doc declares its own format.
  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
  },

  defaultProps: { ...SHARED_DEFAULTS },

  render(props: ScreencapGridProps, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    return renderScreencapGrid(props, ctx);
  },
};

registerTemplate(ScreencapGrid);
