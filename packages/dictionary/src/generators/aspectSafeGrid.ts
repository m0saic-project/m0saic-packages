/**
 * Official dictionary generator: Aspect Safe Grid
 *
 * Finds a grid that renders with zero pixel distortion across both
 * a landscape and portrait canvas. The generator searches for weight
 * configurations where the total weights are common divisors of both
 * canvas dimensions.
 */

import { aspectSafeGrid as stdlibAspectSafeGrid } from "@m0saic/dsl-stdlib";
import { parseM0StringComplete, toCanonicalM0String } from "@m0saic/dsl";
import { serializeM0cFile, type M0Label } from "@m0saic/dsl-file-formats";
import { labelTierParam, resolveLabelTier, type LabelTier } from "./labelTier";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

// ── Descriptor ────────────────────────────────────────────

export const aspectSafeGridDescriptor: GeneratorDescriptor = {
  id: "aspect-safe-grid",
  title: "Cross-Resolution Grid",
  description:
    "Find a grid with zero pixel distortion across both landscape and portrait canvases.",
  category: "grid",
  group: "Precision",
  params: [
    // Mode toggle — drives which set of inputs is shown.
    {
      key: "mode",
      title: "Mode",
      type: "enum",
      default: "matchAspect",
      description:
        "How to choose the landscape and portrait grid pair. Each mode trades off canvas fit, grid quality, and how much you specify up-front.",
      options: [
        {
          value: "matchAspect",
          label: "Match cell aspect",
          description:
            "Search both orientations within the shared row/column range. Each grid must tile its canvas exactly. Use when you want full canvas coverage and don't care about the exact grid shape.",
        },
        {
          value: "pinLandscape",
          label: "Pin landscape grid",
          description:
            "Fix the landscape rows and columns; the portrait grid is searched freely with the matching cell count + closest aspect. Use when you've designed the landscape composition and want the portrait to follow.",
        },
        {
          value: "letterbox",
          label: "Letterbox to fit",
          description:
            "Each grid is wrapped in placeRect inside its canvas, so any (rows × cols) becomes valid via letterbox padding. Best cell-aspect match across orientations at the cost of black bars.",
        },
        {
          value: "byCount",
          label: "By cell count",
          description:
            "Tell the algorithm how many cells you need (with optional fuzziness) and let it pick the row/column split. Uses letterbox internally so any factor pair becomes valid. Best when you know the data — 'I have ~10 items to display' — and want the layout chosen for you.",
        },
      ],
    },

    // Canvases (both modes)
    {
      key: "landscapeW",
      title: "Landscape Width",
      type: "int",
      default: 1920,
      min: 1,
      max: 7680,
    },
    {
      key: "landscapeH",
      title: "Landscape Height",
      type: "int",
      default: 1080,
      min: 1,
      max: 4320,
    },
    {
      key: "portraitW",
      title: "Portrait Width",
      type: "int",
      default: 1080,
      min: 1,
      max: 7680,
    },
    {
      key: "portraitH",
      title: "Portrait Height",
      type: "int",
      default: 1920,
      min: 1,
      max: 4320,
    },

    // ── Match-aspect mode: shared range + optional target AR ──
    {
      key: "minRows",
      title: "Min Rows",
      type: "int",
      default: 2,
      min: 1,
      max: 10,
      visibleWhen: { mode: ["matchAspect", "letterbox"] },
    },
    {
      key: "maxRows",
      title: "Max Rows",
      type: "int",
      default: 6,
      min: 1,
      max: 10,
      visibleWhen: { mode: ["matchAspect", "letterbox"] },
    },
    {
      key: "minCols",
      title: "Min Columns",
      type: "int",
      default: 2,
      min: 1,
      max: 10,
      visibleWhen: { mode: ["matchAspect", "letterbox"] },
    },
    {
      key: "maxCols",
      title: "Max Columns",
      type: "int",
      default: 6,
      min: 1,
      max: 10,
      visibleWhen: { mode: ["matchAspect", "letterbox"] },
    },
    {
      key: "targetCellAspectRatio",
      title: "Target Cell Aspect",
      type: "float",
      default: 0,            // 0 = auto (pick whichever pair has best AR match)
      min: 0,
      max: 4,
      step: 0.05,
      description:
        "Bias toward cells with this width/height ratio (1.78 = 16:9, 1.33 = 4:3, 1.0 = square). Set to 0 to let the search auto-pick whichever pair has the closest landscape/portrait aspect match.",
      visibleWhen: { mode: ["matchAspect", "letterbox", "byCount"] },
    },

    // ── byCount-only: target cell count + fuzziness ──
    {
      key: "targetCellCount",
      title: "Target Cell Count",
      type: "int",
      default: 10,
      min: 1,
      max: 64,
      description:
        "Approximate number of cells you want to display. The algorithm picks rows × columns to land near this count.",
      visibleWhen: { mode: "byCount" },
    },
    {
      key: "cellCountTolerance",
      title: "Tolerance",
      type: "int",
      default: 4,
      min: 0,
      max: 16,
      description:
        "How fuzzy the count can be. 0 = exact match, 4 = within ±4 cells. Higher tolerance = bigger candidate set, often better cell aspect match.",
      visibleWhen: { mode: "byCount" },
    },

    // ── Letterbox-only: alignment of the inner grid in the canvas ──
    {
      key: "hAlign",
      title: "H Align",
      type: "enum",
      default: "center",
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right" },
      ],
      visibleWhen: { mode: ["letterbox", "byCount"] },
    },
    {
      key: "vAlign",
      title: "V Align",
      type: "enum",
      default: "center",
      options: [
        { value: "top", label: "Top" },
        { value: "center", label: "Center" },
        { value: "bottom", label: "Bottom" },
      ],
      visibleWhen: { mode: ["letterbox", "byCount"] },
    },

    // ── Pin-landscape mode: fixed landscape grid + portrait range ──
    {
      key: "landscapeRows",
      title: "Landscape Rows",
      type: "int",
      default: 3,
      min: 1,
      max: 10,
      visibleWhen: { mode: "pinLandscape" },
    },
    {
      key: "landscapeCols",
      title: "Landscape Columns",
      type: "int",
      default: 4,
      min: 1,
      max: 10,
      visibleWhen: { mode: "pinLandscape" },
    },
    {
      key: "portraitMinRows",
      title: "Portrait Min Rows",
      type: "int",
      default: 2,
      min: 1,
      max: 12,
      visibleWhen: { mode: "pinLandscape" },
    },
    {
      key: "portraitMaxRows",
      title: "Portrait Max Rows",
      type: "int",
      default: 8,
      min: 1,
      max: 12,
      visibleWhen: { mode: "pinLandscape" },
    },
    {
      key: "portraitMinCols",
      title: "Portrait Min Columns",
      type: "int",
      default: 2,
      min: 1,
      max: 12,
      visibleWhen: { mode: "pinLandscape" },
    },
    {
      key: "portraitMaxCols",
      title: "Portrait Max Columns",
      type: "int",
      default: 8,
      min: 1,
      max: 12,
      visibleWhen: { mode: "pinLandscape" },
    },

    // Spacing + scoring (both modes)
    {
      key: "gutter",
      title: "Gutter",
      type: "float",
      default: 0,
      min: 0,
      max: 0.2,
      step: 0.01,
    },
    {
      key: "outerGutters",
      title: "Outer Gutters",
      type: "bool",
      default: false,
    },
    {
      key: "priority",
      title: "Priority",
      type: "enum",
      default: "balanced",
      description: "Tie-breaking preference among grid candidates that all match equally well on cell aspect.",
      options: [
        { value: "balanced", label: "Balanced", description: "Compromise between cell count and cell size — a sensible default for most cases." },
        { value: "cleanPixels", label: "Clean Pixels", description: "Prefer larger cells with the cleanest pixel division. Less precision pressure on the engine." },
        { value: "moreCells", label: "More Cells", description: "Prefer denser grids — useful when displaying many items." },
        { value: "largerCells", label: "Larger Cells", description: "Prefer fewer, bigger cells — useful when each cell needs to be readable on small screens." },
      ],
    },
    labelTierParam({
      defaultTier: "silent",
      description: "signposts labels exterior padding nulls (padding-top/right/bottom/left, whichever exist); atlas adds r{row}c{col} per cell. Exact-fit landscape emits no labels at signposts. Labels apply to the landscape variant only — alternates don't carry m0c.",
    }),
  ],
};

// ── Params ────────────────────────────────────────────────

export type AspectSafeGridGeneratorParams = {
  /** "matchAspect" (default) — search broadly; optional cell-aspect target. */
  /** "pinLandscape" — fix landscape rows/cols; portrait searches in its own range. */
  /** "letterbox" — same as matchAspect but grids may be letterboxed inside the canvas. */
  /** "byCount" — specify target cell count; auto-search rows/cols. */
  mode?: "matchAspect" | "pinLandscape" | "letterbox" | "byCount" | string;

  landscapeW: number;
  landscapeH: number;
  portraitW: number;
  portraitH: number;

  // matchAspect / letterbox modes
  minCols?: number;
  maxCols?: number;
  minRows?: number;
  maxRows?: number;
  targetCellAspectRatio?: number;

  // byCount mode
  targetCellCount?: number;
  cellCountTolerance?: number;

  // pinLandscape mode
  landscapeRows?: number;
  landscapeCols?: number;
  portraitMinRows?: number;
  portraitMaxRows?: number;
  portraitMinCols?: number;
  portraitMaxCols?: number;

  // letterbox-only — placement of the inner grid in the canvas
  hAlign?: string;
  vAlign?: string;

  // all modes
  gutter?: number;
  outerGutters?: boolean;
  priority?: string;
  labels?: string;
};

// ── Build ─────────────────────────────────────────────────

const VALID_PRIORITIES = new Set(["balanced", "cleanPixels", "moreCells", "largerCells"]);

export function aspectSafeGrid(params: AspectSafeGridGeneratorParams): GeneratorResult {
  const {
    mode = "matchAspect",
    landscapeW,
    landscapeH,
    portraitW,
    portraitH,
    gutter = 0,
    outerGutters = false,
    priority = "balanced",
  } = params;

  const VALID_HALIGN = new Set(["left", "center", "right"]);
  const VALID_VALIGN = new Set(["top", "center", "bottom"]);
  const hAlignParam = params.hAlign && VALID_HALIGN.has(params.hAlign) ? params.hAlign : "center";
  const vAlignParam = params.vAlign && VALID_VALIGN.has(params.vAlign) ? params.vAlign : "center";

  // Dispatch on mode — each branch builds the stdlib options differently.
  // matchAspect, letterbox, and byCount share the same shape with mode-
  // specific overrides; pinLandscape uses the per-orientation range API.
  let stdlibOpts;
  if (mode === "pinLandscape") {
    stdlibOpts = {
      landscapeW, landscapeH, portraitW, portraitH,
      // Pin the landscape grid to a single (rows, cols).
      landscapeMinRows: params.landscapeRows ?? 3,
      landscapeMaxRows: params.landscapeRows ?? 3,
      landscapeMinCols: params.landscapeCols ?? 4,
      landscapeMaxCols: params.landscapeCols ?? 4,
      // Search portrait freely in its own range.
      portraitMinRows: params.portraitMinRows ?? 2,
      portraitMaxRows: params.portraitMaxRows ?? 8,
      portraitMinCols: params.portraitMinCols ?? 2,
      portraitMaxCols: params.portraitMaxCols ?? 8,
      gutter: gutter > 0 ? gutter : 0,
      outerGutters,
      priority: VALID_PRIORITIES.has(priority) ? (priority as any) : "balanced",
    };
  } else if (mode === "byCount") {
    // Wide row/column range — the targetCellCount filter does the real
    // narrowing. Letterbox is on by default since arbitrary cell counts
    // rarely tile every canvas exactly.
    stdlibOpts = {
      landscapeW, landscapeH, portraitW, portraitH,
      minRows: 1, maxRows: 16,
      minCols: 1, maxCols: 16,
      targetCellCount: params.targetCellCount ?? 10,
      cellCountTolerance: params.cellCountTolerance ?? 4,
      targetCellAspectRatio:
        params.targetCellAspectRatio && params.targetCellAspectRatio > 0
          ? params.targetCellAspectRatio
          : undefined,
      letterbox: true,
      hAlign: hAlignParam as "left" | "center" | "right",
      vAlign: vAlignParam as "top" | "center" | "bottom",
      gutter: gutter > 0 ? gutter : 0,
      outerGutters,
      priority: VALID_PRIORITIES.has(priority) ? (priority as any) : "balanced",
    };
  } else {
    // matchAspect (default) / letterbox
    stdlibOpts = {
      landscapeW, landscapeH, portraitW, portraitH,
      minRows: params.minRows ?? 2,
      maxRows: params.maxRows ?? 6,
      minCols: params.minCols ?? 2,
      maxCols: params.maxCols ?? 6,
      targetCellAspectRatio:
        params.targetCellAspectRatio && params.targetCellAspectRatio > 0
          ? params.targetCellAspectRatio
          : undefined,
      letterbox: mode === "letterbox",
      hAlign: hAlignParam as "left" | "center" | "right",
      vAlign: vAlignParam as "top" | "center" | "bottom",
      gutter: gutter > 0 ? gutter : 0,
      outerGutters,
      priority: VALID_PRIORITIES.has(priority) ? (priority as any) : "balanced",
    };
  }

  const result = stdlibAspectSafeGrid(stdlibOpts);

  // Primary output is the LANDSCAPE DSL; the alternates array carries the
  // PORTRAIT DSL as its single entry. Each variant is paired with its design
  // canvas so the consumer can preview / score against the right dims and
  // surface the dims to the user. Future iterations might add more variants
  // (e.g. a square / safe-area crop) without changing the result shape.
  const landscapeM0 = toCanonicalM0String(result.landscape.m0);

  const tier = resolveLabelTier(params.labels);
  // Mirrors snap-grid's pattern: signposts labels exterior padding
  // nulls; atlas adds per-cell coords. Exact-fit landscape (the most
  // common output) emits no labels at signposts since the grid fills
  // the canvas perfectly. Labels apply to the landscape (primary) DSL
  // only — alternates don't carry an m0c slot today, so a portrait
  // switch loses them. Documented on the tier param's description.
  const m0c = buildAspectSafeGridM0c({
    m0: landscapeM0,
    rootW: result.landscape.canvasW,
    rootH: result.landscape.canvasH,
    cols: result.landscape.cols,
    rows: result.landscape.rows,
    tier,
  });

  return {
    m0: landscapeM0,
    sourceCount: result.cellCount,
    idealCanvas: {
      width: result.landscape.canvasW,
      height: result.landscape.canvasH,
    },
    primaryLabel: "Landscape",
    alternates: [
      {
        m0: toCanonicalM0String(result.portrait.m0),
        idealCanvas: {
          width: result.portrait.canvasW,
          height: result.portrait.canvasH,
        },
        label: "Portrait",
      },
    ],
    ...(m0c ? { m0c } : {}),
  };
}

/**
 * Build aspectSafeGrid's m0c labels for the landscape variant.
 *
 * Identical structure to snap-grid's helper: classify each `kind:"null"`
 * editorFrame by centroid offset relative to the placed-grid bbox →
 * `padding-top` / `padding-right` / `padding-bottom` / `padding-left`.
 * Interior gutter nulls (centroid inside the bbox) get all-zero offsets
 * and are skipped. atlas adds per-cell `r{row}c{col}` in row-major
 * source order.
 *
 * Returns `undefined` (caller skips m0c) when the tier emits no labels
 * — exact-fit landscape at signposts is a no-op (no padding).
 */
function buildAspectSafeGridM0c(opts: {
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

  let cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity;
  for (const f of parsed.ir.renderFrames) {
    if (f.x < cx0) cx0 = f.x;
    if (f.y < cy0) cy0 = f.y;
    if (f.x + f.width > cx1) cx1 = f.x + f.width;
    if (f.y + f.height > cy1) cy1 = f.y + f.height;
  }
  if (!Number.isFinite(cx0)) return undefined;

  const labels: Record<string, M0Label> = {};

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
    if (max === 0) continue;
    let text: string;
    if (max === dTop) text = "padding-top";
    else if (max === dBottom) text = "padding-bottom";
    else if (max === dLeft) text = "padding-left";
    else text = "padding-right";
    labels[String(f.meta.stableKey)] = { text };
  }

  if (opts.tier === "atlas") {
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
    app: "aspect-safe-grid-generator",
    labels,
  });
}
