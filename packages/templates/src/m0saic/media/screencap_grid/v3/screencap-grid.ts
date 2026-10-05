/**
 * Screencap Grid v2 — the v1 grid rebuilt on inset-recovery placement
 * (handbook feasibility-precision-quantization.md §3c; `placeInsetPieces`).
 *
 * # Why v1 was superseded (the ideal-cell inset math)
 *
 * v1 realized the inter-tile gap with `gridCellInset`: a gutterless equal-split
 * grid plus per-cell half-gap FRACTIONS computed against the IDEAL cell size
 * (`gridW / cols`). Two failure modes make that approximate, not exact:
 *
 * 1. **Ideal vs quantized cells.** The engine floors `frac × actualCellPx`
 *    against the cell the split ACTUALLY produced. Under the content-driven
 *    info pane the grid region height is arbitrary (e.g. 1080 − 110 = 970px →
 *    4 rows of 243/242/243/242), so the same fraction recovers 1px on one row
 *    and 0px on the next — a 2px gap wobbles between 2px and 0px depending on
 *    how each cell rounded.
 * 2. **Floor loss on exact fractions.** Even when cells divide evenly, a plain
 *    `n / cell` fraction can floor-lose the pixel (`floor((1/480)·480) → 0`
 *    under IEEE) — the half-pixel-centering problem `placeInsetRects`
 *    documents and solves.
 *
 * The v1 template stays registered (deprecated) as the reference for exactly
 * this pitfall; it is the natural math a template author reaches for first.
 *
 * # The v2 model
 *
 * Every painted rect is computed in INTEGER pixels — the pane band and the
 * gap-carved tiles (interior boundaries give `floor(gap/2)` to the right/lower
 * neighbor and `ceil(gap/2)` to the left/upper one, so adjacent tiles sit
 * exactly `tileGapPx` apart and odd gaps sum exactly; outer edges stay
 * full-bleed). One `placeInsetPieces` call over the canvas then owns the
 * quantization: cells round OUTWARD to a divisor lattice (bounded precision,
 * basis ≤ 120 — the m0 stays composable when this template is nested via a
 * mosaicx invocation) and each source carries a half-pixel-centered recovery
 * inset that paints it back on its exact rect. Zero drift at every canvas;
 * quantization collisions cost overlay LAYERS, never correctness.
 *
 * Per-tile timestamps are pieces sharing their tile's rect at `importance: 1`
 * (guaranteed to paint above), so the chip hugs the visible tile instead of
 * hanging into the gap as it could in v1.
 *
 * # Custom grid (escape hatch)
 *
 * The authored m0 is kept VERBATIM (the string is the product) and nested
 * under the pane split, as in v1. Its gap stays a render-time per-frame inset,
 * but fixed: fractions are computed per SIDE from each frame's ACTUAL rendered
 * dims, half-pixel-centered, floor/ceil-split so odd gaps sum exactly, and
 * edge-aware (frames touching the grid-region boundary stay flush, matching
 * the generated grid's full-bleed contract — v1 carved all four sides). The
 * pane wrapper is a pixel-weight split, exact at the head; a custom grid
 * trades nested-precision boundedness for authored geometry by design.
 */
import type {
  MosaicAssetManifest,
  MosaicBoxFrac,
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicOutputFormat,
  MosaicPipelineStep,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";
import {
  buildStepNames,
  definePropsSchema,
  registerTemplate,
  makeErrorMosaic,
  makeColorTile,
  bindProps,
  tag,
  renderNestedTemplate,
  slugifyAssetKeyFromPath,
  placeInsetPieces,
  withGeometryContract,
  textEmUnits,
  fitEmUnits,
  measureText,
  type InsetPiece,
  type PropBindingEntry,
} from "@m0saic/template-utils";

// Editor-only onboarding surfaces (renderCover / renderTutorial). Kept in
// sibling modules so this file stays about the grid itself.
import { renderScreencapGridV2Cover } from "../v2/screencap-grid-cover";
import { renderScreencapGridV2Tutorial } from "../v2/screencap-grid-tutorial";

// Import internal subtemplate for registration side-effect
import { INFO_PANE_TEMPLATE_ID } from "../internal/info_pane";
// Shared, math-neutral helpers hosted by the (deprecated) v1 module — the
// same reuse the aspect-safe sibling does. The deprecated part of v1 is its
// ideal-cell inset math, not these formatters.
import {
  assembleScreencapM0,
  buildTimestampSource,
  computeTimestamps,
  estimateInfoPaneHeight,
  formatInfoLines,
  infoPaneMetaFontSize,
  infoPaneTitleFontSize,
  type ScreencapOutputFormat,
  type TextAlign,
  type TileCorner,
} from "../v1/screencap-grid";

const SCREENCAP_GRID_V3_ID = "@m0saic/media/screencap_grid/v3";

// ---- PROPS ----

// ── Group configs — THE grouping mechanism (alpine bar-graph pattern):
//    `type:"group"` + `fields` folds in the Make panel AND the Compose form.
//    Shared with the aspect-safe sibling, which imports them from here. ──

/** Info-pane group. */
export type ScreencapInfoPaneConfig = {
  /** Show the info pane with filename + metadata above the grid. Default true. */
  show?: boolean;
  /** Horizontal alignment of the pane text. Default "left". */
  align?: TextAlign;
};

/** Per-tile timestamp group. */
export type ScreencapTimestampsConfig = {
  /** Overlay a timestamp in each tile. Default true. */
  show?: boolean;
  /** Which corner the chip sits in. Default "br". */
  corner?: TileCorner;
  /** Text color. Default white. */
  color?: MosaicColor;
  /** Chip background behind the glyphs. Default black. */
  bgColor?: MosaicColor;
};

/** Tile presentation group. */
export type ScreencapTilesConfig = {
  /** Gap between tiles, in pixels — EXACT at every canvas. Default 2. */
  gapPx?: number;
  /** cover crops to fill the cell; contain letterboxes the frame. Default "cover". */
  fit?: "contain" | "cover";
};

// Tiny field-entry helpers (the alpine `_shared/alpine-anim` shapes, kept
// local — the media pack doesn't import alpine's shared module).
/* eslint-disable @typescript-eslint/no-explicit-any */
export const bBool = (): any => ({ type: "boolean", required: false });
export const bNum = (control?: any, constraints?: any): any => ({ type: "number", required: false, ...(control || constraints ? { meta: { ...(constraints ? { constraints } : {}), ...(control ? { control } : {}) } } : {}) });
export const bEnum = (oneOf: string[]): any => ({ type: "string", required: false, meta: { constraints: { oneOf } } });
export const bColor = (): any => ({ type: "string", required: false, meta: { control: { colorPicker: true }, constraints: { isColor: true } } });
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ScreencapGridV3Props = {
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

  /** Info pane (collapsible group). */
  infoPane?: ScreencapInfoPaneConfig;
  /** Per-tile timestamps (collapsible group). */
  timestamps?: ScreencapTimestampsConfig;
  /** Tile gap + fit (collapsible group). */
  tiles?: ScreencapTilesConfig;

  /**
   * Advanced (collapsible group): `customGrid` — a custom m0 layout string
   * used for the grid instead of the generated `rows × cols` grid. One media
   * tile (with its timestamp) is bound per rendered cell, in document order.
   * When set, `rows`/`cols` are ignored. Accepts a bare m0 or a pasted `.m0`
   * file (header comments are stripped); kept verbatim in the document.
   */
  advanced?: { customGrid?: string };

  /**
   * Dev-only geometry contract (generated-grid path): assert every tile's
   * computed rect survived to the pixels at this canvas; on violation render
   * a GEOMETRY_CONTRACT error mosaic. Deterministic default false.
   */
  debugGeometry?: boolean;
};

/**
 * LEGACY flat props (pre-group, 2026-07-21) still accepted at resolve time —
 * saved docs written against v1 (deprecated → "use v2") or the pre-group v2
 * carry these; silently dropping them on repoint would be a trap. Grouped
 * values win over flat ones.
 */
type ScreencapGridV2LegacyProps = {
  withInfoPane?: boolean;
  headerAlign?: TextAlign;
  withTileTimestamp?: boolean;
  timestampCorner?: TileCorner;
  timestampColor?: MosaicColor;
  timestampBgColor?: MosaicColor;
  tileGapPx?: number;
  /** v1's even-older fractional gap (≈ fraction of a 1080p-ish cell). */
  tileGap?: number;
  tileFit?: "contain" | "cover";
  customGrid?: string;
};

const propsSchema = definePropsSchema<ScreencapGridV3Props>({
  // The one source input. One required "Source(s)" field that takes a
  // folder, one or many files, or drag-and-drop. A single file renders one
  // grid; multiple fan out as an `emit: "multi"` pipeline (one render per
  // file).
  sourceIds: {
    type: "media[]",
    required: true,
    meta: {
      control: { multiple: true, picker: "folder", accept: ["video"] },
    },
  },
  // Reserved prop-bag convention (trickplay precedent): a prop named
  // `outputFormat` holding a container name drives the Make page's Output
  // Type + container + default output extension.
  outputFormat: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["png", "mp4"] },
    },
  },
  rows: {
    type: "number",
    required: false,
    meta: { constraints: { min: 1, max: 20 } },
  },
  cols: {
    type: "number",
    required: false,
    meta: { constraints: { min: 1, max: 20 } },
  },
  // ── Collapsible groups (`type:"group"` + `fields` — folds in Make AND
  //    Compose; the one grouping mechanism). ──
  infoPane: {
    type: "group" as never,
    required: false,
    fields: {
      show: bBool(),
      align: bEnum(["left", "center", "right"]),
    },
  } as never,
  timestamps: {
    type: "group" as never,
    required: false,
    fields: {
      show: bBool(),
      corner: bEnum(["tl", "tr", "bl", "br"]),
      color: bColor(),
      bgColor: bColor(),
    },
  } as never,
  tiles: {
    type: "group" as never,
    required: false,
    fields: {
      gapPx: bNum({ flavor: "slider", step: 1, unit: "px" }, { min: 0, max: 40 }),
      fit: bEnum(["cover", "contain"]),
    },
  } as never,
  advanced: {
    type: "group" as never,
    required: false,
    fields: {
      customGrid: {
        type: "m0",
        required: false,
      } as never,
    },
  } as never,
  debugGeometry: {
    type: "boolean",
    required: false,
  },
});

// ---- INFO-PANE TEXT FIT ----

/** The info pane's horizontal text padding fraction (info_pane.ts `padding.x`). */
const PANE_PAD_X = 0.015;
/** Average-glyph width heuristic — the tutorial text-fit contract constant. */
const EM_WIDTH_RATIO = 0.62;

/** Em budget for one pane line at this canvas width and font size. */
export function paneLineEmBudget(canvasW: number, fontSize: number): number {
  return (canvasW * (1 - 2 * PANE_PAD_X)) / (fontSize * EM_WIDTH_RATIO);
}

/**
 * Middle-ellipsize to an em budget, keeping the TAIL — for filenames, where
 * the extension and trailing qualifiers are the part worth preserving.
 * Script-aware via `textEmUnits` (CJK counts wide). Half-unit tolerance so
 * exact-budget strings keep their last char (the donut fitToHole lesson).
 */
export function ellipsizeMiddleEm(text: string, maxUnits: number): string {
  if (textEmUnits(text) <= maxUnits + 0.5) return text;
  const chars = [...text];
  const tailChars = chars.slice(-10);
  const tailUnits = textEmUnits(tailChars.join(""));
  let head = "";
  let used = 1 + tailUnits; // the ellipsis + the kept tail
  for (const ch of chars) {
    const u = textEmUnits(ch);
    if (used + u > maxUnits) break;
    head += ch;
    used += u;
  }
  return `${head}…${tailChars.join("")}`;
}

// ---- LAYOUT (the v2 core) ----

export type TilePxRect = { x: number; y: number; w: number; h: number };

/**
 * Exact integer tile rects for a rows × cols grid filling the region below
 * the info pane. Cell boundaries are proportional rounds of the region
 * (`round(i · span / n)` — cells differ by at most 1px); interior boundaries
 * carve the gap `floor(gap/2)` / `ceil(gap/2)` between the two neighbors so
 * adjacent painted tiles are EXACTLY `tileGapPx` apart (odd gaps included).
 * Outer edges are full-bleed (row 0 hugs the pane; the grid runs edge to
 * edge). The gap is clamped per axis so no tile collapses below 1px.
 *
 * Row-major order (matches the tile → timestamp source pairing).
 */
export function computeGridTileRects(args: {
  canvasW: number;
  canvasH: number;
  /** Info-pane pixel height. 0 → no pane; the grid starts at y=0. */
  paneHeightPx: number;
  rows: number;
  cols: number;
  tileGapPx: number;
}): TilePxRect[] {
  const { canvasW, canvasH, paneHeightPx, rows, cols, tileGapPx } = args;
  const gridH = canvasH - paneHeightPx;

  const xs = Array.from({ length: cols + 1 }, (_, c) => Math.round((c * canvasW) / cols));
  const ys = Array.from({ length: rows + 1 }, (_, r) => paneHeightPx + Math.round((r * gridH) / rows));

  const minSpan = (b: number[]) => Math.min(...b.slice(1).map((v, i) => v - b[i]));
  const gapX = Math.max(0, Math.min(tileGapPx, minSpan(xs) - 1));
  const gapY = Math.max(0, Math.min(tileGapPx, minSpan(ys) - 1));
  const lead = (g: number) => Math.floor(g / 2);
  const trail = (g: number) => Math.ceil(g / 2);

  const rects: TilePxRect[] = [];
  for (let r = 0; r < rows; r++) {
    const y = ys[r] + (r > 0 ? lead(gapY) : 0);
    const y2 = ys[r + 1] - (r < rows - 1 ? trail(gapY) : 0);
    for (let c = 0; c < cols; c++) {
      const x = xs[c] + (c > 0 ? lead(gapX) : 0);
      const x2 = xs[c + 1] - (c < cols - 1 ? trail(gapX) : 0);
      rects.push({ x, y, w: x2 - x, h: y2 - y });
    }
  }
  return rects;
}

/**
 * Engine cap on a `placement.inset` edge fraction (core `assertFrac`).
 * Mirrors `placeInsetRects`' guard — an emitted fraction above this would
 * throw at render, so the carve is dropped on that axis instead.
 */
const INSET_CAP = 0.49;

// ── The timestamp chip's own rect (v3) ──────────────────────────────────
// v2 drew each chip on its whole tile (the text aligned into a corner of a
// full-cell text source), so on the Make canvas the chip's rect WAS the tile's:
// two handles on one rectangle, fighting over the click (founder, 2026-10-01:
// "the full cell text rect fights the cell itself"). v3 gives the chip a
// rect of its own — just wide and tall enough for the text and its plate,
// sitting where the corner-aligned text landed — and lets placeInsetPieces
// recover it byte-exact (a small rect inside a tile is the documented use).
// The chip's text is then centred in that rect: its position is the rect's.

/** `buildTimestampSource`'s type — the chip is sized from the same numbers. */
const CHIP_FONT_PX = 18;
/** `boxBorderWidth` of the chip's plate: the plate reaches this far past the glyphs. */
const CHIP_PLATE_PX = 6;
/** The corner padding v2 gave the text, as fractions of the tile (`padding: { x, y }`). */
const CHIP_PAD_X_FRAC = 0.02;
const CHIP_PAD_Y_FRAC = 0.03;
/** The widest time a chip shows (HH:MM:SS.mmm — every digit a tabular slot). */
const CHIP_WIDEST_TEXT = "00:00:00.000";

/**
 * The chip's rect inside its tile: the plate around the widest time it can
 * show, tucked into `corner` where v2's corner-aligned text sat. Never wider
 * or taller than the tile (a tiny tile keeps the chip, clipped as before).
 */
export function timestampChipRect(
  tile: { x: number; y: number; w: number; h: number },
  corner: TileCorner,
): { x: number; y: number; w: number; h: number } {
  const m = measureText(CHIP_WIDEST_TEXT, { fontSize: CHIP_FONT_PX });
  const w = Math.min(tile.w, Math.ceil(m.width) + 2 * CHIP_PLATE_PX + 2);
  const h = Math.min(tile.h, Math.ceil(m.height) + 2 * CHIP_PLATE_PX);
  // v2 padded the GLYPHS by the fraction; the plate reaches CHIP_PLATE_PX past
  // them, so the plate's own margin is that much less (never negative).
  const mx = Math.max(0, Math.round(tile.w * CHIP_PAD_X_FRAC) - CHIP_PLATE_PX);
  const my = Math.max(0, Math.round(tile.h * CHIP_PAD_Y_FRAC) - CHIP_PLATE_PX);
  const right = corner === "tr" || corner === "br";
  const bottom = corner === "bl" || corner === "br";
  return {
    x: right ? tile.x + tile.w - mx - w : tile.x + mx,
    y: bottom ? tile.y + tile.h - my - h : tile.y + my,
    w,
    h,
  };
}

/** A chip whose rect IS the chip: its text sits centred, with no corner padding left to apply. */
export function tightTimestampSource(chip: MosaicSource): MosaicSource {
  const layers = ((chip as { layers?: Array<Record<string, unknown>> }).layers ?? []).map((layer) => ({
    ...layer,
    placement: { hAlign: "center", vAlign: "middle" },
  }));
  return { ...(chip as object), layers } as MosaicSource;
}

/** Per-side fractional inset (the object form of `MosaicBoxFrac`). */
export type CustomTileInset = { top: number; right: number; bottom: number; left: number };

/**
 * Per-frame gap inset for the CUSTOM-grid path, from the frame's ACTUAL
 * rendered dims. Half-pixel-centered per side (`(n + 0.5) / dim` — plain
 * `n / dim` floor-loses; see `placeInsetRects`), floor/ceil-split so a
 * shared boundary's two carves sum to exactly `gapPx`, and edge-aware:
 * sides on the grid-region boundary stay flush (full-bleed). Carves that
 * would collapse the tile below 1px, or exceed the engine's inset cap,
 * drop that axis's carve. Returns undefined when no side carves.
 */
export function customGridTileInset(
  frame: { x: number; y: number; width: number; height: number },
  gapPx: number,
  regionW: number,
  regionH: number,
): CustomTileInset | undefined {
  if (gapPx <= 0 || frame.width <= 0 || frame.height <= 0) return undefined;
  const lead = Math.floor(gapPx / 2);
  const trail = Math.ceil(gapPx / 2);

  // A frame's left/top edge carves `lead`, its right/bottom edge `trail` —
  // the neighbor across the boundary carves the complement, summing to gapPx.
  let left = frame.x > 0 ? lead : 0;
  let right = frame.x + frame.width < regionW ? trail : 0;
  let top = frame.y > 0 ? lead : 0;
  let bottom = frame.y + frame.height < regionH ? trail : 0;

  const frac = (n: number, dim: number) => (n === 0 ? 0 : (n + 0.5) / dim);
  const axisOk = (a: number, b: number, dim: number) =>
    a + b < dim && frac(a, dim) <= INSET_CAP && frac(b, dim) <= INSET_CAP;
  if (!axisOk(left, right, frame.width)) { left = 0; right = 0; }
  if (!axisOk(top, bottom, frame.height)) { top = 0; bottom = 0; }
  if (left === 0 && right === 0 && top === 0 && bottom === 0) return undefined;

  return {
    top: frac(top, frame.height),
    right: frac(right, frame.width),
    bottom: frac(bottom, frame.height),
    left: frac(left, frame.width),
  };
}

// ---- SHARED RENDER ----

type ScreencapMode = "static" | "animated";

/** Resolve the render mode from the `outputFormat` knob (default png/static). */
function resolveMode(props: ScreencapGridV3Props): ScreencapMode {
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
function resolveInputs(props: ScreencapGridV3Props): string[] {
  if (props.sourceIds && props.sourceIds.length > 0) return props.sourceIds;
  return [];
}

/** The flat internal knob shape the render body consumes. */
type ResolvedV2Knobs = {
  rows: number;
  cols: number;
  withInfoPane: boolean;
  headerAlign: TextAlign;
  withTileTimestamp: boolean;
  timestampCorner: TileCorner;
  timestampColor: MosaicColor;
  timestampBgColor: MosaicColor;
  tileGapPx: number;
  tileFit: "contain" | "cover";
  customGridRaw: string | undefined;
};

/**
 * Resolve grouped props → the flat internal knob shape. Precedence per knob:
 * grouped value → legacy flat value (see {@link ScreencapGridV2LegacyProps})
 * → default. The gap additionally bridges v1's even-older FRACTIONAL
 * `tileGap` (≈ fraction of a 1080p-ish cell) so ancient docs don't snap to 0.
 */
function resolveV2Knobs(props: ScreencapGridV3Props): ResolvedV2Knobs {
  const legacy = props as ScreencapGridV3Props & ScreencapGridV2LegacyProps;
  const gapPx = props.tiles?.gapPx ?? legacy.tileGapPx;
  const legacyFraction =
    typeof legacy.tileGap === "number" && legacy.tileGap > 0
      ? Math.round(legacy.tileGap * 480)
      : undefined;
  return {
    rows: props.rows ?? 4,
    cols: props.cols ?? 4,
    withInfoPane: props.infoPane?.show ?? legacy.withInfoPane ?? true,
    headerAlign: props.infoPane?.align ?? legacy.headerAlign ?? "left",
    withTileTimestamp: props.timestamps?.show ?? legacy.withTileTimestamp ?? true,
    timestampCorner: props.timestamps?.corner ?? legacy.timestampCorner ?? "br",
    timestampColor: props.timestamps?.color ?? legacy.timestampColor ?? "#ffffff",
    timestampBgColor: props.timestamps?.bgColor ?? legacy.timestampBgColor ?? "#000000",
    tileGapPx: typeof gapPx === "number" && gapPx >= 0 ? gapPx : (legacyFraction ?? 2),
    tileFit: props.tiles?.fit ?? legacy.tileFit ?? "cover",
    customGridRaw: props.advanced?.customGrid ?? legacy.customGrid,
  };
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
export async function renderScreencapGridV3(
  props: ScreencapGridV3Props,
  ctx: MosaicEngineContext,
): Promise<MosaicRenderableFile> {
  const mode = resolveMode(props);
  const inputs = resolveInputs(props);
  if (inputs.length === 0) {
    // v3: no source yet → the SLOT BEFORE THE FOOTAGE. The real sheet at the
    // real canvas — pane, rows × cols, timestamp chips — with stand-in tiles
    // where the frames will land, every tile a drop target for the first
    // source. Marked `incomplete` (nothing to write to a file yet), so the CLI
    // still exits 3 and Make still gates MAKE; but the layout is on screen,
    // and every knob is editable on it before the footage exists.
    return renderScreencapGridForInput(null, 0, props, ctx, mode);
  }

  if (inputs.length === 1) {
    return renderScreencapGridForInput(inputs[0], 0, props, ctx, mode);
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
  props: ScreencapGridV3Props,
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
    const file = await renderScreencapGridForInput(inputs[i], i, props, ctx, mode);
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
 * of {@link renderScreencapGridV3} so the multi-input path can reuse it
 * per input.
 */
async function renderScreencapGridForInput(
  /** The input path — or `null` for the stand-in sheet (no source picked yet). */
  sourceIdOrNull: string | null,
  /** This input's index into `sourceIds` (the drop handle every tile carries). */
  inputIndex: number,
  props: ScreencapGridV3Props,
  ctx: MosaicEngineContext,
  mode: ScreencapMode,
): Promise<MosaicDocument> {
  const standIn = sourceIdOrNull === null;
  const sourceId = sourceIdOrNull ?? "";
  // `sourceId` is, by current convention, whatever string the caller
  // passed (in the editor / CLI today this is an absolute filesystem path,
  // not a clean id). `ctx.media` is keyed by that same raw string, so the
  // metadata probe has to use it as-is. But the OUTGOING manifest key must
  // be a safe slug — paths with spaces / drive letters / Unicode would fail
  // ASSET_KEY_PATTERN at plan-build.
  const ctxMediaKey = asAssetId(sourceId);
  const sourceAssetId = asAssetId(slugifyAssetKeyFromPath(sourceId));
  const meta = standIn ? undefined : ctx.media[ctxMediaKey];
  const {
    rows, cols, withInfoPane, headerAlign, withTileTimestamp, timestampCorner,
    timestampColor, timestampBgColor, tileGapPx, tileFit, customGridRaw,
  } = resolveV2Knobs(props);

  const canvasW = ctx.target.width;
  const canvasH = ctx.target.height;

  // Escape hatch: a custom m0 layout replaces the generated rows × cols grid.
  const customGridM0 = resolveCustomGrid(customGridRaw);
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
    const info = standIn
      ? { title: STAND_IN_TITLE, metadata: STAND_IN_HINT, metaLineCount: 1 }
      : meta
        ? formatInfoLines(sourceId, meta)
        : { title: `No metadata for sourceId=${sourceId}`, metadata: "", metaLineCount: 0 };
    const ratio = Math.max(0.03, Math.min(0.25,
      estimateInfoPaneHeight(canvasH, info.metaLineCount) / canvasH
    ));
    // Floor at 1px so `withInfoPane` always reserves a pane frame — keeps
    // the source array aligned with the rendered frames even on
    // pathologically small canvases.
    paneHeightPx = Math.max(1, Math.round(canvasH * ratio));
    // Fit-first: the pane draws LITERAL text at fixed fonts — a long
    // filename or a dense metadata line overruns the canvas silently in
    // the CLI (the gate-16 text-clip class). Title keeps its tail (the
    // extension is the informative part); metadata lines end-ellipsize.
    // Never print a filesystem PATH as the title: when originalFileName is
    // absent (thin host probes), formatInfoLines falls back to the raw
    // sourceId — basename-ify before fitting (string split; node:path is
    // web-forbidden here).
    const titleBase = info.title.split("/").pop()?.split("\\").pop() || info.title;
    infoTitle = ellipsizeMiddleEm(
      titleBase,
      paneLineEmBudget(canvasW, infoPaneTitleFontSize(canvasH)),
    );
    const metaBudget = paneLineEmBudget(canvasW, infoPaneMetaFontSize(canvasH));
    infoMeta = info.metadata
      .split("\n")
      .map((l) => (textEmUnits(l) <= metaBudget + 0.5 ? l : fitEmUnits(l, metaBudget)))
      .join("\n");
  }

  // The grid always fills the canvas: full width × the area below the info
  // pane. Fail fast when the canvas cannot give every row/col at least 1px.
  const gridH = canvasH - paneHeightPx;
  if (!customGridM0 && (gridH < rows || canvasW < cols)) {
    return makeErrorMosaic(
      `Canvas ${canvasW}×${canvasH} is too small for a ${rows}×${cols} grid${withInfoPane ? " below the info pane" : ""}.`,
      { title: "Screencap Grid", width: canvasW, height: canvasH },
    );
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

  const isVideo =
    meta?.kind === "video" && meta.durationMs != null && meta.durationMs > 0;
  // The stand-in reads as a contact sheet of a nominal clip, so the chips show
  // spread-out times (and their colours) instead of sixteen zeros.
  const chipsShowTime = isVideo || standIn;
  const timelineMs = isVideo ? meta!.durationMs! : STAND_IN_DURATION_MS;

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

  // The pane child rasterizes at full canvas height with its text in the
  // top strip; a top-anchored cover crop (focusY: 0) shows exactly that
  // strip in the ~paneHeightPx cell. The default contain fit would scale
  // the whole full-height frame down into the cell (≈2px text).
  const paneSource: MosaicSource = {
    type: "mosaic",
    ref: "info-pane",
    placement: { fit: "cover", focusY: 0 },
  };

  // v3: every tile is a HANDLE. It shows the source → it takes a dropped file
  // (`sourceIds[inputIndex]`: replace this input, or add the first one); and
  // the sheet's shape is what the tiles are, so they carry rows / cols / gap
  // (a custom grid replaces rows × cols, so it does not offer them).
  const tileHandles: PropBindingEntry[] = [
    { propKey: "sourceIds", index: inputIndex },
    ...(customGridM0 ? [] : [{ propKey: "rows" }, { propKey: "cols" }]),
    { propKey: "tiles.gapPx" },
  ];
  let tileCount = 0;
  const mediaTileSource = (t: number, inset?: MosaicBoxFrac): MosaicSource => {
    const nth = tileCount++;
    if (standIn) {
      // A quiet two-tone CHECK (row + column parity), so the grid reads as
      // tiles even at gap 0. The first tile carries the `incomplete` marker
      // Make and the CLI look for.
      const shade = customGridM0 ? nth : Math.floor(nth / Math.max(1, cols)) + (nth % Math.max(1, cols));
      const tile = makeColorTile(STAND_IN_TILES[shade % STAND_IN_TILES.length], inset ? { placement: { inset } } : undefined) as MosaicSource;
      if (nth === 0) {
        (tile as MosaicSource & { engine?: unknown }).engine = {
          renderStatus: "incomplete",
          renderError: { message: `Screencap Grid: ${STAND_IN_TITLE}` },
        };
      }
      return bindProps(tag(tile, "tile"), tileHandles);
    }
    return bindProps({
      type: "media",
      mediaType,
      assetId: sourceAssetId,
      placement: { fit: tileFit, ...(inset ? { inset } : {}) },
      ...(isVideo
        ? {
          playback:
            mode === "animated"
              ? { clipStartMs: t }
              : { clipStartMs: t, clipDurationMs: frameMs, loopMode: "freeze" },
          audio: { enabled: false },
        }
        : {}),
      editor: { owner: "template", label: "tile" },
    } as MosaicSource, tileHandles);
  };

  // v3: a chip shows its ink and its plate → it carries both colours.
  const timestampSource = (t: number): MosaicSource =>
    bindProps(tag(buildTimestampSource({
      t,
      // A stand-in has no clock to read: literal times, even in animated mode.
      mode: standIn ? "static" : mode,
      isVideo: chipsShowTime,
      corner: timestampCorner,
      color: timestampColor,
      bgColor: timestampBgColor,
    }), "timestamp"), [{ propKey: "timestamps.color" }, { propKey: "timestamps.bgColor" }]);

  // Mint the file asset for the source media so this document is hermetic
  // when used as the root renderable (e.g. via CLI `make`). When nested as
  // a child, the parent's manifest entry under the same assetId is identical
  // (path + mediaType derived from the same sourceId), so scope merge is a
  // no-op rather than a conflict.
  const assets: MosaicAssetManifest = standIn
    ? ({} as MosaicAssetManifest)
    : {
        [sourceAssetId]: {
          kind: "file",
          path: sourceId,
          mediaType,
        },
      };

  const format = formatForMode(mode);

  if (customGridM0) {
    // ── Custom-grid path: authored m0 verbatim, gap as fixed per-frame inset ──
    const frames = parseM0StringToRenderFrames(customGridM0, canvasW, gridH);
    const rectByLogical = new Map<number, { x: number; y: number; width: number; height: number }>();
    for (const f of frames) {
      rectByLogical.set(f.logicalIndex, { x: f.x, y: f.y, width: f.width, height: f.height });
    }
    const N = frames.length;
    const timestamps = chipsShowTime ? computeTimestamps(N, timelineMs) : [];

    const sources: MosaicSource[] = [];
    if (withInfoPane) sources.push(paneSource);
    for (let i = 0; i < N; i++) {
      const t = chipsShowTime ? timestamps[i] : 0;
      const frame = rectByLogical.get(i);
      const inset = frame
        ? customGridTileInset(frame, tileGapPx, canvasW, gridH)
        : undefined;
      sources.push(mediaTileSource(t, inset));
      if (withTileTimestamp) {
        // Same inset on the chip so it hugs the visible (gap-carved) tile —
        // wired at SOURCE level (layer-level placement ignores inset), the
        // same clone-and-wire move placeInsetPieces does.
        const ts = timestampSource(t);
        sources.push(inset ? ({ ...(ts as object), placement: { inset } } as MosaicSource) : ts);
      }
    }

    const m0 = assembleScreencapM0({
      rows, cols, paneHeightPx, gridH, withTileTimestamp, gridM0: customGridM0,
    });

    return {
      kind: "mosaic_document",
      version: 1,
      sources,
      assets,
      m0: toM0String(m0, "ScreencapGrid"),
      children,
      format,
      // Doc-level disable STRIPS the track (`-an`). The source-level knob
      // on each tile only mutes the mix contribution — alone, an animated
      // grid ships a silent placeholder audio track (the gate-20 class).
      ...(mode === "animated" ? { audio: { mode: "off" } } : {}),
    };
  }

  // ── Generated-grid path: exact pixel rects → inset-recovery placement ──
  const tileRects = computeGridTileRects({
    canvasW, canvasH, paneHeightPx, rows, cols, tileGapPx,
  });
  const N = tileRects.length;
  const timestamps = chipsShowTime ? computeTimestamps(N, timelineMs) : [];

  const pieces: InsetPiece[] = [];
  if (withInfoPane) {
    pieces.push({ rect: { x: 0, y: 0, w: canvasW, h: paneHeightPx }, source: paneSource });
  }
  for (let i = 0; i < N; i++) {
    const t = chipsShowTime ? timestamps[i] : 0;
    const r = tileRects[i];
    pieces.push({ rect: { x: r.x, y: r.y, w: r.w, h: r.h }, source: mediaTileSource(t) });
    if (withTileTimestamp) {
      // v3: the chip's OWN rect (see timestampChipRect), at importance 1 →
      // guaranteed to paint above its tile; the colliding cells spill to an
      // overlay layer by design.
      pieces.push({
        rect: { ...timestampChipRect(r, timestampCorner), importance: 1 },
        source: tightTimestampSource(timestampSource(t)),
      });
    }
  }

  const placed = placeInsetPieces({ rootW: canvasW, rootH: canvasH, pieces });

  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    sources: placed.sources,
    assets,
    m0: placed.m0,
    children,
    format,
    // Doc-level disable STRIPS the track (`-an`) — see the custom-grid
    // return above for why the source-level mute alone isn't enough.
    ...(mode === "animated" ? { audio: { mode: "off" } } : {}),
  };

  // Dev tripwire: `debugGeometry` falsy (the default) → returns `doc`
  // untouched at zero cost.
  return withGeometryContract(doc, ctx, {
    templateId: SCREENCAP_GRID_V3_ID,
    expectations: placed.expectations,
    debug: props.debugGeometry === true,
  });
}

// ---- STAND-IN (no source yet) ----

/** The pane's title line while the sheet waits for its footage. */
const STAND_IN_TITLE = "Drop a video here";
/** …and the line under it. */
const STAND_IN_HINT = "Its frames fill this grid. Files, a folder, or drag and drop.";
/** Tile stand-ins (a quiet two-tone check). */
const STAND_IN_TILES: MosaicColor[] = ["#1c212b" as MosaicColor, "#232a36" as MosaicColor];
/** Nominal clip length the stand-in's chips spread across. */
const STAND_IN_DURATION_MS = 96_000;

// ---- TEMPLATE ----

const SHARED_DEFAULTS: Omit<ScreencapGridV3Props, "sourceIds"> = {
  outputFormat: "png",
  rows: 4,
  cols: 4,
  infoPane: { show: true, align: "left" },
  timestamps: { show: true, corner: "br", color: "#ffffff", bgColor: "#000000" },
  tiles: { gapPx: 2, fit: "cover" },
};

export const ScreencapGridV3: MosaicTemplate<ScreencapGridV3Props> = {
  id: asTemplateId(SCREENCAP_GRID_V3_ID),
  version: 3,
  capabilities: { tier: "core" },
  propsSchema,

  // No `format` hint on purpose (watermark/trickplay precedent): the
  // `outputFormat` knob picks png vs mp4 per render, and a template-level
  // container hint would override the user's `-o` extension in
  // `resolveOutputFormat`. Each rendered doc declares its own format.
  outputHints: {
    format: { kind: "image", container: "png" },
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
  },

  defaultProps: { debugGeometry: false, ...SHARED_DEFAULTS },

  render(props: ScreencapGridV3Props, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    return renderScreencapGridV3(props, ctx);
  },

  // Onboarding surfaces. Both are editor-only stand-ins — they never enter the
  // render path, and `render` above keeps its fail-fast contract untouched
  // (CLI, nested renders, and Make after the first prop edit are unchanged).
  renderCover(_props: ScreencapGridV3Props, ctx: MosaicEngineContext): MosaicDocument {
    return renderScreencapGridV2Cover(ctx);
  },

  renderTutorial(_props: ScreencapGridV3Props, ctx: MosaicEngineContext): MosaicDocumentPipeline {
    return renderScreencapGridV2Tutorial(ctx);
  },
};

registerTemplate(ScreencapGridV3);
