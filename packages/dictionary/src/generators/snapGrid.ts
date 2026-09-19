/**
 * Official dictionary generator: Snap Grid
 *
 * Two flows for fitting a quantization-free grid into a canvas:
 *
 * - "Fit": you know the grid you want (rows, cols, gutter); the generator
 *   finds the largest distortion-free inner rect that fits the grid and
 *   wraps it with `placeRect` so the canvas keeps your chosen dimensions.
 *
 * - "Find": you know the canvas; the generator enumerates (rows, cols)
 *   in the search range, scores each by `coverage × tileCount`, and emits
 *   the top candidate's composed `placeRect{grid}` DSL.
 *
 * Wraps the stdlib `snapGridFit` / `snapGridFind` helpers with a UI-friendly
 * parameter surface (mode toggle, alignment, search bounds).
 */

import { snapGridFit, snapGridEnumerate } from "@m0saic/dsl-stdlib";
import { parseM0StringComplete, toCanonicalM0String } from "@m0saic/dsl";
import { serializeM0cFile, type M0Label } from "@m0saic/dsl-file-formats";
import { labelTierParam, resolveLabelTier, type LabelTier } from "./labelTier";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

// ── Descriptor ────────────────────────────────────────────

export const snapGridDescriptor: GeneratorDescriptor = {
  id: "snap-grid",
  title: "Snap Grid",
  description:
    "Fit a quantization-free grid into a canvas. Two modes: snap a known grid into the largest distortion-free rect, or sweep a (rows, cols) range to find the best fit by coverage × cell count.",
  category: "grid",
  group: "Precision",
  params: [
    // Mode selector
    {
      key: "mode",
      title: "Mode",
      type: "enum",
      default: "fit",
      description:
        "How the grid is chosen. Fit: you specify exact rows × columns. Find: you give a search range and the algorithm picks the best (rows, cols) pair for the canvas.",
      options: [
        {
          value: "fit",
          label: "Fit a known grid",
          description:
            "You provide rows × columns. The grid is snapped to the largest quantization-free inner rect inside the canvas, then placed via placeRect. Use when you've already decided the grid shape.",
        },
        {
          value: "find",
          label: "Find best grid",
          description:
            "You give a row/column search range. The algorithm enumerates every (rows, cols) pair, ranks by coverage × cell count, and picks the top candidate. Use when you want the algorithm to choose the shape.",
        },
      ],
    },

    // Canvas dims (both modes)
    {
      key: "rootW",
      title: "Root Width",
      type: "int",
      default: 1920,
      min: 1,
      max: 7680,
    },
    {
      key: "rootH",
      title: "Root Height",
      type: "int",
      default: 1080,
      min: 1,
      max: 4320,
    },

    // Fit mode: explicit grid spec — rows/cols then gutter/outerGutters
    // mirrors the canonical Grid generator order.
    {
      key: "rows",
      title: "Rows",
      type: "int",
      default: 3,
      min: 1,
      max: 12,
      visibleWhen: { mode: "fit" },
    },
    {
      key: "cols",
      title: "Columns",
      type: "int",
      default: 4,
      min: 1,
      max: 12,
      visibleWhen: { mode: "fit" },
    },

    // Find mode: search bounds — same rows-then-cols ordering.
    {
      key: "minRows",
      title: "Min Rows",
      type: "int",
      default: 2,
      min: 1,
      max: 12,
      visibleWhen: { mode: "find" },
    },
    {
      key: "maxRows",
      title: "Max Rows",
      type: "int",
      default: 8,
      min: 1,
      max: 12,
      visibleWhen: { mode: "find" },
    },
    {
      key: "minCols",
      title: "Min Columns",
      type: "int",
      default: 2,
      min: 1,
      max: 12,
      visibleWhen: { mode: "find" },
    },
    {
      key: "maxCols",
      title: "Max Columns",
      type: "int",
      default: 8,
      min: 1,
      max: 12,
      visibleWhen: { mode: "find" },
    },

    // Gutter + outer gutters (both modes) — placed after grid spec to
    // match the Grid generator's order.
    {
      key: "gutter",
      title: "Gutter",
      type: "float",
      default: 0.04,
      min: 0,
      max: 0.2,
      step: 0.01,
      description:
        "Spacing between cells, expressed as a fraction of cell width (0.04 = 4% gutters). Set to 0 for tight grids.",
    },
    {
      key: "outerGutters",
      title: "Outer Gutters",
      type: "bool",
      default: false,
      description:
        "Also place gutters on the outer edges of the grid (before the first cell, after the last). Off by default — only inter-cell gaps.",
    },

    // Alignment (both modes — controls placeRect when inner rect is smaller)
    {
      key: "hAlign",
      title: "H Align",
      type: "enum",
      default: "center",
      description:
        "Horizontal placement of the snapped grid inside the canvas when the inner rect is narrower than the canvas.",
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right" },
      ],
    },
    {
      key: "vAlign",
      title: "V Align",
      type: "enum",
      default: "center",
      description:
        "Vertical placement of the snapped grid inside the canvas when the inner rect is shorter than the canvas.",
      options: [
        { value: "top", label: "Top" },
        { value: "center", label: "Center" },
        { value: "bottom", label: "Bottom" },
      ],
    },
    labelTierParam({
      defaultTier: "silent",
      description: "signposts labels the exterior padding nulls (padding-top/right/bottom/left, whichever exist); atlas adds r{row}c{col} per cell. Exact-fit grids emit no labels at signposts (no padding to mark).",
    }),
  ],
};

// ── Params ────────────────────────────────────────────────

export type SnapGridGeneratorParams = {
  mode?: "fit" | "find" | string;
  rootW: number;
  rootH: number;
  gutter?: number;
  outerGutters?: boolean;
  hAlign?: string;
  vAlign?: string;
  // fit mode
  rows?: number;
  cols?: number;
  // find mode
  minRows?: number;
  maxRows?: number;
  minCols?: number;
  maxCols?: number;
  labels?: string;
};

/**
 * Build snap-grid's m0c labels in one pass.
 *
 * The snap-grid layout has three distinct null populations:
 *   1. Exterior padding nulls — letterbox/pillarbox borders around
 *      the snapped grid (present when the grid doesn't fill the
 *      canvas, e.g. align center on a non-exact-fit).
 *   2. Interior gutter nulls — gaps between cells inside the grid.
 *   3. Outer-gutter nulls — when `outerGutters: true`, gutters around
 *      the perimeter of the grid itself (inside the grid's bbox).
 *
 * `signposts` labels (1) only — exterior padding by side. Interior
 * gutters and outer gutters live INSIDE the placed-grid bbox, so the
 * "centroid outside bbox" check skips them naturally.
 *
 * `atlas` adds per-cell `r{row}c{col}` labels (row-major source order).
 *
 * Returns `undefined` (caller skips m0c) when the tier emits no labels
 * — including the exact-fit signposts case (no exterior padding).
 */
function buildSnapGridM0c(opts: {
  m0: string;
  rootW: number;
  rootH: number;
  cols: number;
  rows: number;
  tier: LabelTier;
}): string | undefined {
  if (opts.tier === "silent") return undefined;
  const parsed = parseM0StringComplete(opts.m0, opts.rootW, opts.rootH);
  if (!parsed.ok) return undefined;

  // Compute the placed-grid bbox: the union of every rendered cell's rect.
  let cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity;
  for (const f of parsed.ir.renderFrames) {
    if (f.x < cx0) cx0 = f.x;
    if (f.y < cy0) cy0 = f.y;
    if (f.x + f.width > cx1) cx1 = f.x + f.width;
    if (f.y + f.height > cy1) cy1 = f.y + f.height;
  }
  if (!Number.isFinite(cx0)) return undefined;

  const labels: Record<string, M0Label> = {};

  // Exterior padding nulls. Same algorithm as aspectFit/placeRect:
  // classify each null by the side it sits furthest outside the bbox.
  // Interior gutter nulls have centroids inside the bbox → all four
  // offsets are 0 → skipped.
  for (const f of parsed.ir.editorFrames) {
    if (f.kind !== "null") continue;
    if (f.width <= 0 || f.height <= 0) continue;
    const fcx = f.x + f.width / 2;
    const fcy = f.y + f.height / 2;
    const dTop = Math.max(0, cy0 - fcy);
    const dBottom = Math.max(0, fcy - cy1);
    const dLeft = Math.max(0, cx0 - fcx);
    const dRight = Math.max(0, fcx - cx1);
    const max = Math.max(dTop, dBottom, dLeft, dRight);
    if (max === 0) continue; // inside bbox — gutter null, skip
    let text: string;
    if (max === dTop) text = "padding-top";
    else if (max === dBottom) text = "padding-bottom";
    else if (max === dLeft) text = "padding-left";
    else text = "padding-right";
    labels[String(f.meta.stableKey)] = { text };
  }

  if (opts.tier === "atlas") {
    // Add per-cell r{row}c{col}. renderFrames in logical order maps to
    // the row-major cell grid (snap-grid emits cells row-by-row).
    const sourceKeys = parsed.ir.renderFrames
      .slice()
      .sort((a, b) => a.logicalIndex - b.logicalIndex)
      .map((f) => String(f.meta.stableKey));
    for (let i = 0; i < opts.cols * opts.rows; i++) {
      const key = sourceKeys[i];
      if (!key) continue;
      const row = Math.floor(i / opts.cols);
      const col = i % opts.cols;
      labels[key] = { text: `r${row}c${col}` };
    }
  }

  if (Object.keys(labels).length === 0) return undefined;
  return serializeM0cFile({
    m0: opts.m0,
    size: { width: opts.rootW, height: opts.rootH },
    app: "snap-grid-generator",
    labels,
  });
}

// ── Helpers ───────────────────────────────────────────────

type HAlign = "left" | "center" | "right";
type VAlign = "top" | "center" | "bottom";

const VALID_HALIGN = new Set<string>(["left", "center", "right"]);
const VALID_VALIGN = new Set<string>(["top", "center", "bottom"]);

function resolveHAlign(v: string | undefined): HAlign {
  return VALID_HALIGN.has(v ?? "") ? (v as HAlign) : "center";
}
function resolveVAlign(v: string | undefined): VAlign {
  return VALID_VALIGN.has(v ?? "") ? (v as VAlign) : "center";
}

// ── Build ─────────────────────────────────────────────────

export function snapGridGenerator(params: SnapGridGeneratorParams): GeneratorResult {
  const { rootW, rootH } = params;

  if (!Number.isInteger(rootW) || rootW < 1 || rootW > 7680)
    throw new Error(`snapGrid: rootW must be an integer 1–7680, got ${rootW}`);
  if (!Number.isInteger(rootH) || rootH < 1 || rootH > 4320)
    throw new Error(`snapGrid: rootH must be an integer 1–4320, got ${rootH}`);

  const mode = params.mode ?? "fit";
  const gutter = params.gutter ?? 0;
  const outerGutters = params.outerGutters === true;
  const hAlign = resolveHAlign(params.hAlign);
  const vAlign = resolveVAlign(params.vAlign);

  const tier = resolveLabelTier(params.labels);

  if (mode === "find") {
    // Use snapGridFind's stdlib equivalent inline so we keep visibility
    // into the chosen (rows, cols) — find's SnapGridResult collapses
    // them into tileCount, which is enough for rendering but doesn't
    // expose the dims for atlas-tier label coordinates. Pulling the
    // top candidate from snapGridEnumerate ourselves gives us both.
    const findOpts = {
      rootW, rootH, gutter, outerGutters, hAlign, vAlign,
      minRows: params.minRows ?? 2,
      maxRows: params.maxRows ?? 8,
      minCols: params.minCols ?? 2,
      maxCols: params.maxCols ?? 8,
    };
    const candidates = snapGridEnumerate(findOpts);
    if (candidates.length === 0) {
      throw new Error(
        `snapGrid: no grid fits inside ${rootW}×${rootH} for the requested range`,
      );
    }
    const best = candidates[0]!;
    const result = snapGridFit({
      rootW, rootH, gutter, outerGutters, hAlign, vAlign,
      rows: best.rows,
      cols: best.cols,
    });
    const m0 = toCanonicalM0String(result.m0);
    const m0c = buildSnapGridM0c({
      m0, rootW, rootH, cols: best.cols, rows: best.rows, tier,
    });
    return {
      m0,
      sourceCount: result.tileCount,
      idealCanvas: { width: rootW, height: rootH },
      ...(m0c ? { m0c } : {}),
    };
  }

  // Default: fit mode
  const rows = params.rows ?? 3;
  const cols = params.cols ?? 4;
  const result = snapGridFit({
    rootW,
    rootH,
    rows,
    cols,
    gutter,
    outerGutters,
    hAlign,
    vAlign,
  });
  const m0 = toCanonicalM0String(result.m0);
  const m0c = buildSnapGridM0c({ m0, rootW, rootH, cols, rows, tier });
  return {
    m0,
    sourceCount: result.tileCount,
    idealCanvas: { width: rootW, height: rootH },
    ...(m0c ? { m0c } : {}),
  };
}
