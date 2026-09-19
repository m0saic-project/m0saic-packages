/**
 * Aspect-safe screencap grid — sibling of `screencap_grid` that fans
 * out into a *coordinated landscape + portrait pair* per input file.
 *
 * Per source video the template emits two outputs (one desktop /
 * landscape, one mobile / portrait) whose grids:
 *   - have the same total cell count;
 *   - have matching cell aspect ratios across orientations (NOT a
 *     naive transpose);
 *   - render quantization-free at their respective canvases.
 *
 * The coordinated pair is picked by `aspectSafeGrid` from
 * `@m0saic/dsl-stdlib`. To give the user a "scroll through grids" UX,
 * the template enumerates a cell-count window
 * (`targetCellCountMin..targetCellCountMax`) and ranks the resulting
 * pairs. The `gridChoice` prop indexes into that ranked list.
 *
 * The shape question comes first: `cellShape` declares what shape the
 * CELLS should be — "landscape" (16:9, the default), "square", or
 * "portrait" (9:16), with `targetCellAspect` as the exact-ratio escape
 * hatch — and the search finds, per orientation, the (rows, cols) that
 * realizes that shape at the same cell count (a portrait shape ⇒ many
 * columns on the landscape canvas, many rows on the portrait one).
 * Ranking is shape-first: both orientations' distance to the target;
 * cross-orientation match follows by triangle inequality.
 *
 * Multi-input: just like `screencap_grid`, `sourceIds: string[]`
 * triggers an `emit: "multi"` pipeline. Combined with the per-input
 * landscape + portrait fan-out, N inputs produce 2 × N output files.
 *
 * Aligned with `screencap_grid/v2` (2026-07-21; the former
 * `…_aspect_safe_png/v1` + `…_aspect_safe_mp4/v1` twins are collapsed
 * into this one template — same hard-replace move as the screengrid
 * png/mp4 merge; the gridCellInset negative example is archived at
 * `screencap_grid/v1`):
 *   - `outputFormat` knob picks png (static contact sheet) vs mp4
 *     (animated grid); each step document bakes its own `format`
 *     (watermark/trickplay precedent) and the template-level format
 *     hint is gone.
 *   - Layout is the v2 machinery: integer gap-carved tile rects
 *     (`computeGridTileRects`) placed via `placeInsetPieces` — gaps
 *     are pixel-exact at every orientation canvas (the deprecated
 *     `gridCellInset` ideal-cell fractions wobbled ±1px under the
 *     content-driven info pane). Timestamps are same-rect pieces at
 *     `importance: 1`, so the chip is guaranteed above its tile and
 *     hugs the visible (gap-carved) tile edge.
 *   - Static steps carry the nominal single-frame 40ms duration;
 *     animated steps track `ctx.target.durationMs`.
 */
import type {
  MosaicAssetManifest,
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
import { asAssetId, asTemplateId } from "@m0saic/types";
import type { MosaicColor } from "@m0saic/types";
import { aspectSafeGrid } from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  registerTemplate,
  makeErrorMosaic,
  renderNestedTemplate,
  slugifyAssetKeyFromPath,
  placeInsetPieces,
  withGeometryContract,
  textEmUnits,
  fitEmUnits,
  type InsetPiece,
} from "@m0saic/template-utils";

// Reuse formatting + sizing helpers from the screen grid — same info
// pane / timestamps semantics, just at per-orientation canvases.
import {
  formatInfoLines,
  computeTimestamps,
  estimateInfoPaneHeight,
  buildTimestampSource,
  infoPaneMetaFontSize,
  infoPaneTitleFontSize,
  type ScreencapOutputFormat,
  type TextAlign,
  type TileCorner,
} from "../../screencap_grid/v1/screencap-grid";

// The exact-layout core + group-config shapes + field helpers shared with
// screencap_grid/v2 (the canonical family member).
import {
  computeGridTileRects,
  ellipsizeMiddleEm,
  fBool,
  fColor,
  fEnum,
  fNum,
  paneLineEmBudget,
  type ScreencapInfoPaneConfig,
  type ScreencapTimestampsConfig,
  type ScreencapTilesConfig,
} from "../../screencap_grid/v2/screencap-grid";
import { INFO_PANE_TEMPLATE_ID } from "../../screencap_grid/internal/info_pane";

// Editor-only onboarding surfaces (renderCover / renderTutorial) — gate-25
// founder ruling ("it needs a cover and tutorial"). Kept in sibling modules
// so this file stays about the pair machinery.
import { renderScreencapGridAspectSafeCover } from "./screencap-grid-aspect-safe-cover";
import { renderScreencapGridAspectSafeTutorial } from "./screencap-grid-aspect-safe-tutorial";

const ASPECT_SAFE_ID = "@m0saic/media/screencap_grid_aspect_safe/v1";

/** Preset cell shapes — the answer to "what shape should a cell be?". */
export type AspectSafeCellShape = "landscape" | "square" | "portrait";

/** The aspect ratio each preset targets (width / height). */
export const CELL_SHAPE_RATIOS: Record<AspectSafeCellShape, number> = {
  landscape: 16 / 9,
  square: 1,
  portrait: 9 / 16,
};

// ── Group configs unique to this template (the shared info-pane /
//    timestamps / tiles configs come from screencap_grid/v2 above) ──

/** Pair-search tuning (the "Grid Search" group). */
export type AspectSafeSearchConfig = {
  /** Exact target cell aspect (w/h) — OVERRIDES `cellShape` when set. */
  cellAspect?: number;
  /** Lower bound of the cell-count sweep. */
  minCells?: number;
  /** Upper bound of the cell-count sweep. */
  maxCells?: number;
};

/** Output canvas dims per orientation (the "Canvas" group). */
export type AspectSafeCanvasConfig = {
  landscapeW?: number;
  landscapeH?: number;
  portraitW?: number;
  portraitH?: number;
};

// ---- PROPS ----

export type ScreencapGridAspectSafeProps = {
  /** The grid's source input(s) — emit:multi fan-out (2 outputs per file). */
  sourceIds?: string[];

  /**
   * Deliverable format: "png" renders static contact sheets (each tile a
   * frozen frame at its timestamp); "mp4" renders animated grids (each
   * tile plays from its timestamp). Default "png".
   */
  outputFormat?: ScreencapOutputFormat;

  /**
   * The shape question — what shape should the CELLS be? Drives the pair
   * search: pairs are ranked by how close BOTH orientations' cells sit to
   * this shape (sum of log-distances; the cross-orientation match follows
   * automatically), and the shape biases which (rows, cols) factorization
   * each cell count picks — e.g. portrait cells put many columns on the
   * landscape canvas and many rows on the portrait one. Default
   * "landscape" (16:9 cells — the natural shape for video frames).
   */
  cellShape?: AspectSafeCellShape;

  /**
   * Index into the ranked list of (landscape, portrait) pairs enumerated
   * across the search window. 0 = best-ranked (both orientations' cells
   * closest to the wanted cell shape; cross-orientation match + density as
   * tiebreaks). Out-of-range gets clamped.
   */
  gridChoice?: number;

  /** Pair-search tuning (collapsible group): exact aspect + cell-count window. */
  search?: AspectSafeSearchConfig;
  /** Output canvas dims per orientation (collapsible group). */
  canvas?: AspectSafeCanvasConfig;
  /** Info pane (collapsible group). */
  infoPane?: ScreencapInfoPaneConfig;
  /** Per-tile timestamps (collapsible group). */
  timestamps?: ScreencapTimestampsConfig;
  /** Tile gap + fit (collapsible group). */
  tiles?: ScreencapTilesConfig;

  /**
   * Dev-only geometry contract: assert every tile's computed rect survived
   * to the pixels at each orientation canvas; on violation that step renders
   * a GEOMETRY_CONTRACT error mosaic. Deterministic default false.
   */
  debugGeometry?: boolean;
};

/**
 * LEGACY flat props (pre-group, 2026-07-21) still accepted at resolve time —
 * saved docs written against the collapsed `…_aspect_safe_png/v1` /
 * `…_aspect_safe_mp4/v1` twins (or the pre-group id) carry these; silently
 * dropping them on repoint would be a trap. Grouped values win.
 */
type ScreencapGridAspectSafeLegacyProps = {
  targetCellAspect?: number;
  targetCellCountMin?: number;
  targetCellCountMax?: number;
  landscapeW?: number;
  landscapeH?: number;
  portraitW?: number;
  portraitH?: number;
  withInfoPane?: boolean;
  headerAlign?: TextAlign;
  withTileTimestamp?: boolean;
  timestampCorner?: TileCorner;
  timestampColor?: MosaicColor;
  timestampBgColor?: MosaicColor;
  tileGapPx?: number;
  tileFit?: "contain" | "cover";
};

const propsSchema = definePropsSchema<ScreencapGridAspectSafeProps>({
  // The one source input. One required "Source(s)" field that takes a
  // folder, one or many files, or drag-and-drop — per-file emit:multi
  // fan-out (2 outputs per file: landscape + portrait).
  sourceIds: {
    type: "media[]",
    required: true,
    description:
      "Source video(s) for the grid — pick a folder, one or more files, or drag-and-drop. 2 outputs per file (landscape + portrait).",
    meta: {
      ui: { label: "Source(s)", order: 1 },
      control: { multiple: true, picker: "folder", accept: ["video"] },
    },
  },
  // Reserved prop-bag convention (trickplay/screencap precedent): a prop
  // named `outputFormat` holding a container name drives the Make page's
  // Output Type + container + default output extension.
  outputFormat: {
    type: "string",
    required: false,
    description:
      'Deliverable format. "png" renders static contact sheets; "mp4" renders animated grids where each tile plays from its timestamp.',
    meta: {
      constraints: { oneOf: ["png", "mp4"] },
      ui: { label: "Output", order: 1 },
    },
  },
  cellShape: {
    type: "string",
    required: false,
    description:
      "What shape should the cells be? landscape = 16:9 (the natural shape for video frames), square, portrait = 9:16. Both orientations' grids are chosen so their cells realize this shape at the same cell count.",
    meta: {
      constraints: { oneOf: ["landscape", "square", "portrait"] },
      ui: { label: "Cell Shape", order: 1 },
    },
  },
  gridChoice: {
    type: "number",
    required: false,
    description:
      "Index into the ranked list of coordinated landscape/portrait grid pairs. 0 = best-ranked (both orientations' cells closest to the wanted cell shape). Out-of-range clamps to the last available pair.",
    meta: {
      constraints: { min: 0, max: 24 },
      control: { flavor: "slider", step: 1 },
      ui: { label: "Grid Choice", order: 3 },
    },
  },
  // ── Collapsible groups (`type:"group"` + `fields` — folds in Make AND
  //    Compose; the one grouping mechanism). ──
  search: {
    type: "group" as never,
    required: false,
    description: "Pair-search tuning: exact cell aspect + the cell-count window the ranked list sweeps.",
    meta: { ui: { label: "Grid Search", order: 4, collapsedByDefault: true } },
    fields: {
      cellAspect: fNum("Cell Aspect (exact)", "Exact target cell aspect ratio (width/height) — overrides Cell Shape when set. E.g. 1.5 for 3:2 cells, 0.8 for 4:5.", { placeholder: "from Cell shape" }, { min: 0.1, max: 10 }),
      minCells: fNum("Min Cells", "Lower bound for the cell-count sweep.", undefined, { min: 1, max: 64 }),
      maxCells: fNum("Max Cells", "Upper bound for the cell-count sweep.", undefined, { min: 1, max: 64 }),
    },
  } as never,
  canvas: {
    type: "group" as never,
    required: false,
    description: "Output canvas dimensions per orientation.",
    meta: { ui: { label: "Canvas", order: 5, collapsedByDefault: true } },
    fields: {
      landscapeW: fNum("Landscape W", "Landscape canvas width — desktop output.", undefined, { min: 16, max: 8192 }),
      landscapeH: fNum("Landscape H", "Landscape canvas height — desktop output.", undefined, { min: 16, max: 8192 }),
      portraitW: fNum("Portrait W", "Portrait canvas width — mobile output.", undefined, { min: 16, max: 8192 }),
      portraitH: fNum("Portrait H", "Portrait canvas height — mobile output.", undefined, { min: 16, max: 8192 }),
    },
  } as never,
  infoPane: {
    type: "group" as never,
    required: false,
    description: "Info pane with filename + ffprobe metadata above the grid.",
    meta: { ui: { label: "Info Pane", order: 6, collapsedByDefault: true } },
    fields: {
      show: fBool("Show", "Show the info pane above the grid."),
      align: fEnum("Align", ["left", "center", "right"], "Alignment of the pane text (filename + metadata)."),
    },
  } as never,
  timestamps: {
    type: "group" as never,
    required: false,
    description: "Per-tile timestamp chip.",
    meta: { ui: { label: "Timestamps", order: 7, collapsedByDefault: true } },
    fields: {
      show: fBool("Show", "Overlay a timestamp in each tile."),
      corner: fEnum("Corner", ["tl", "tr", "bl", "br"], "Which corner the chip sits in."),
      color: fColor("Color", "Timestamp text color."),
      bgColor: fColor("Background", "Chip background behind the glyphs (\"none\" = transparent)."),
    },
  } as never,
  tiles: {
    type: "group" as never,
    required: false,
    description: "Tile gap + fill behavior.",
    meta: { ui: { label: "Tiles", order: 8, collapsedByDefault: true } },
    fields: {
      gapPx: fNum("Gap (px)", "Gap between tiles, in pixels (exact at every canvas).", { flavor: "slider", step: 1, unit: "px" }, { min: 0, max: 40 }),
      fit: fEnum("Fit", ["cover", "contain"], "cover crops to fill; contain letterboxes the whole frame."),
    },
  } as never,
  debugGeometry: {
    type: "boolean",
    required: false,
    description:
      "Dev-only geometry contract: assert every tile's computed rect survived to the pixels at each orientation canvas; on violation that step renders a GEOMETRY_CONTRACT error mosaic. Deterministic default false; production never sets it.",
    meta: { ui: { label: "Debug geometry", order: 1, collapsedByDefault: true } },
  },
});

// ---- DEFAULTS ----

const SHARED_DEFAULTS: Omit<
  ScreencapGridAspectSafeProps,
  "sourceIds"
> = {
  outputFormat: "png",
  cellShape: "landscape",
  gridChoice: 0,
  search: { minCells: 4, maxCells: 32 },
  canvas: { landscapeW: 1920, landscapeH: 1080, portraitW: 1080, portraitH: 1920 },
  infoPane: { show: true, align: "left" },
  timestamps: { show: true, corner: "br", color: "#ffffff", bgColor: "none" },
  tiles: { gapPx: 2, fit: "cover" },
};

// ---- HELPERS ----

type ResolvedConfig = {
  inputs: string[];
  /** Target cell aspect (w/h), or null = legacy cross-match-only ranking. */
  targetCellAspect: number | null;
  gridChoice: number;
  countMin: number;
  countMax: number;
  landscapeW: number;
  landscapeH: number;
  portraitW: number;
  portraitH: number;
  withInfoPane: boolean;
  headerAlign: TextAlign;
  withTileTimestamp: boolean;
  timestampCorner: TileCorner;
  timestampColor: MosaicColor;
  timestampBgColor: MosaicColor;
  tileGapPx: number;
  tileFit: "contain" | "cover";
  debugGeometry: boolean;
};

function resolveInputs(props: ScreencapGridAspectSafeProps): string[] {
  if (props.sourceIds && props.sourceIds.length > 0) return props.sourceIds;
  return [];
}

/**
 * Resolve grouped props → the flat internal config the render body consumes.
 * Precedence per knob: grouped value → legacy flat value (see
 * {@link ScreencapGridAspectSafeLegacyProps}) → default.
 */
function resolveConfig(props: ScreencapGridAspectSafeProps): ResolvedConfig {
  const legacy = props as ScreencapGridAspectSafeProps & ScreencapGridAspectSafeLegacyProps;
  // The numeric escape hatch overrides the preset; the preset defaults
  // to landscape (16:9 cells), so a target is ALWAYS in play. Unknown
  // shape strings (schema-invalid, but this is a public function) fall
  // back to the landscape default rather than poisoning the log math.
  const exactAspect = props.search?.cellAspect ?? legacy.targetCellAspect;
  return {
    inputs: resolveInputs(props),
    targetCellAspect:
      typeof exactAspect === "number" && exactAspect > 0
        ? exactAspect
        : (CELL_SHAPE_RATIOS[props.cellShape ?? "landscape"] ?? CELL_SHAPE_RATIOS.landscape),
    gridChoice: props.gridChoice ?? 0,
    countMin: props.search?.minCells ?? legacy.targetCellCountMin ?? 4,
    countMax: props.search?.maxCells ?? legacy.targetCellCountMax ?? 32,
    landscapeW: props.canvas?.landscapeW ?? legacy.landscapeW ?? 1920,
    landscapeH: props.canvas?.landscapeH ?? legacy.landscapeH ?? 1080,
    portraitW: props.canvas?.portraitW ?? legacy.portraitW ?? 1080,
    portraitH: props.canvas?.portraitH ?? legacy.portraitH ?? 1920,
    withInfoPane: props.infoPane?.show ?? legacy.withInfoPane ?? true,
    headerAlign: props.infoPane?.align ?? legacy.headerAlign ?? "left",
    withTileTimestamp: props.timestamps?.show ?? legacy.withTileTimestamp ?? true,
    timestampCorner: props.timestamps?.corner ?? legacy.timestampCorner ?? "br",
    timestampColor: props.timestamps?.color ?? legacy.timestampColor ?? "#ffffff",
    timestampBgColor: props.timestamps?.bgColor ?? legacy.timestampBgColor ?? "none",
    tileGapPx: props.tiles?.gapPx ?? legacy.tileGapPx ?? 2,
    tileFit: props.tiles?.fit ?? legacy.tileFit ?? "cover",
    debugGeometry: props.debugGeometry === true,
  };
}

type AspectSafePair = ReturnType<typeof aspectSafeGrid>;

/**
 * How far BOTH orientations' cells sit from the target shape — the sum of
 * per-orientation log-distances. Log space keeps 1.5 and 1/1.5 equally far
 * from square; summing both orientations means a pair only ranks well when
 * EACH canvas realizes the wanted shape (and then the cross-orientation
 * match follows by the triangle inequality: delta ≤ distL + distP).
 */
export function targetShapeDistance(pair: AspectSafePair, target: number): number {
  const t = Math.log(target);
  return (
    Math.abs(Math.log(pair.landscape.cellAspectRatio) - t) +
    Math.abs(Math.log(pair.portrait.cellAspectRatio) - t)
  );
}

/**
 * Enumerate coordinated landscape/portrait pairs across the cell-count
 * window. Each `targetCellCount` is tried with tolerance 0 (exact
 * count). Failures (no feasible pair) are silently dropped. Results
 * are sorted so the best pair lands at index 0:
 *
 * With `targetCellAspect` set (shape-first — the shape question decides):
 *   1. Smallest {@link targetShapeDistance} first (both orientations'
 *      cells closest to the wanted shape).
 *   2. Then smallest `cellAspectLogDelta` (cross-orientation match).
 *   3. Then larger cellCount (denser grid).
 * The target is also passed INTO `aspectSafeGrid` per cell count, so each
 * count picks its shape-aligned (rows, cols) factorization — ranking alone
 * could not recover a factorization the builder didn't pick.
 *
 * Without a target (legacy):
 *   1. Smallest `cellAspectLogDelta` first (best cross-orientation
 *      cell-shape match).
 *   2. Tied AR match → larger cellCount wins (more cells = denser
 *      grid, which is usually what the user wants).
 */
export function enumerateAspectSafePairs(
  cfg: Pick<
    ResolvedConfig,
    "countMin" | "countMax" | "landscapeW" | "landscapeH" | "portraitW" | "portraitH"
  > &
    Partial<Pick<ResolvedConfig, "targetCellAspect">>,
): AspectSafePair[] {
  const target = cfg.targetCellAspect ?? null;
  const out: AspectSafePair[] = [];
  for (let n = cfg.countMin; n <= cfg.countMax; n++) {
    try {
      const pair = aspectSafeGrid({
        landscapeW: cfg.landscapeW,
        landscapeH: cfg.landscapeH,
        portraitW: cfg.portraitW,
        portraitH: cfg.portraitH,
        targetCellCount: n,
        cellCountTolerance: 0,
        ...(target != null ? { targetCellAspectRatio: target } : {}),
        // Gutterless: cells are pure, so the aspect-match is computed on the
        // same cells we actually render (gutterless fill). The gap is a
        // cosmetic per-cell carve and doesn't affect cell aspect. `letterbox:
        // true` keeps the widest pool of aspect-matched (rows, cols) pairs —
        // since we always fill, this never adds bars, it just maximizes the
        // candidate set for the best cross-orientation aspect match.
        letterbox: true,
      });
      out.push(pair);
    } catch {
      // No feasible pair for this exact cell count — drop and continue.
    }
  }
  out.sort((a, b) => {
    if (target != null) {
      const dTarget = targetShapeDistance(a, target) - targetShapeDistance(b, target);
      if (Math.abs(dTarget) > 1e-9) return dTarget;
    }
    const dDelta = a.cellAspectLogDelta - b.cellAspectLogDelta;
    if (Math.abs(dDelta) > 1e-9) return dDelta;
    return b.cellCount - a.cellCount;
  });
  return out;
}

/**
 * Pick the gridChoice-th ranked pair. Returns null when the sweep
 * produced no feasible candidates — caller surfaces that as an error
 * mosaic.
 */
function pickAspectSafePair(cfg: ResolvedConfig): AspectSafePair | null {
  const candidates = enumerateAspectSafePairs(cfg);
  if (candidates.length === 0) return null;
  const idx = Math.max(0, Math.min(candidates.length - 1, cfg.gridChoice));
  return candidates[idx];
}

// ---- SHARED RENDER ----

type ScreencapMode = "static" | "animated";

/** Resolve the render mode from the `outputFormat` knob (default png/static). */
function resolveMode(props: ScreencapGridAspectSafeProps): ScreencapMode {
  return props.outputFormat === "mp4" ? "animated" : "static";
}

/**
 * The output format each rendered step document declares for its mode
 * (watermark/trickplay/screencap precedent) — under `emit: "multi"` every
 * step switches the command build into the right graph mode.
 */
function formatForMode(mode: ScreencapMode): MosaicOutputFormat {
  return mode === "animated"
    ? { kind: "video", container: "mp4" }
    : { kind: "image", container: "png" };
}

/**
 * Render one orientation (landscape OR portrait) of one input file.
 * Returns a MosaicDocument with the orientation's canvas + tiles +
 * optional info pane. Layout is the screencap_grid/v2 machinery:
 * integer gap-carved rects → one `placeInsetPieces` call, timestamps
 * as same-rect pieces at importance 1 (guaranteed above their tile).
 */
async function renderOrientationForInput(
  sourceId: string,
  cfg: ResolvedConfig,
  pair: AspectSafePair,
  orientation: "landscape" | "portrait",
  ctx: MosaicEngineContext,
  mode: ScreencapMode,
): Promise<MosaicDocument> {
  const canvasW = orientation === "landscape" ? cfg.landscapeW : cfg.portraitW;
  const canvasH = orientation === "landscape" ? cfg.landscapeH : cfg.portraitH;
  const oriented = orientation === "landscape" ? pair.landscape : pair.portrait;
  const rows = oriented.rows;
  const cols = oriented.cols;
  const N = rows * cols;

  const ctxMediaKey = asAssetId(sourceId);
  const sourceAssetId = asAssetId(slugifyAssetKeyFromPath(sourceId));
  const meta: MosaicMediaMetadata | undefined = ctx.media[ctxMediaKey];

  let paneHeightPx = 0;
  const children: Record<string, MosaicRenderableFile> = {};

  if (cfg.withInfoPane) {
    const info = meta
      ? formatInfoLines(sourceId, meta)
      : { title: `No metadata for sourceId=${sourceId}`, metadata: "", metaLineCount: 0 };
    const ratio = Math.max(
      0.03,
      Math.min(0.25, estimateInfoPaneHeight(canvasH, info.metaLineCount) / canvasH),
    );
    paneHeightPx = Math.max(1, Math.round(canvasH * ratio));
    // Fit-first (the gate-24 screencap_grid/v2 fix, shared semantics): the
    // pane draws LITERAL text at fixed fonts — basename-ify the title (never
    // print a filesystem path), middle-ellipsize it keeping the extension
    // tail, and end-ellipsize dense metadata lines. Per-orientation: the
    // portrait canvas is narrower, so each orientation fits its own budget.
    const titleBase = info.title.split("/").pop()?.split("\\").pop() || info.title;
    const fitTitle = ellipsizeMiddleEm(
      titleBase,
      paneLineEmBudget(canvasW, infoPaneTitleFontSize(canvasH)),
    );
    const metaBudget = paneLineEmBudget(canvasW, infoPaneMetaFontSize(canvasH));
    const fitMeta = info.metadata
      .split("\n")
      .map((l) => (textEmUnits(l) <= metaBudget + 0.5 ? l : fitEmUnits(l, metaBudget)))
      .join("\n");
    // Slot height stays canvasH so the drawtext font sizes match
    // estimateInfoPaneHeight's assumptions (the child rasterizes at its
    // parent frame size regardless).
    const infoPaneFile = await renderNestedTemplate(
      INFO_PANE_TEMPLATE_ID,
      { title: fitTitle, metadata: fitMeta, paneHeight: paneHeightPx, align: cfg.headerAlign },
      ctx,
      { slot: { width: canvasW, height: canvasH } },
    );
    children["info-pane"] = infoPaneFile;
  }

  const gridH = canvasH - paneHeightPx;
  if (gridH < rows || canvasW < cols) {
    return makeErrorMosaic(
      `${orientation} canvas ${canvasW}×${canvasH} is too small for the ${rows}×${cols} grid${cfg.withInfoPane ? " below the info pane" : ""}.`,
      { title: "Screencap Grid — Aspect Safe", width: canvasW, height: canvasH },
    );
  }

  const isVideo =
    meta?.kind === "video" && meta.durationMs != null && meta.durationMs > 0;
  const timestamps = isVideo ? computeTimestamps(N, meta.durationMs!) : [];
  const mediaType: "video" | "image" | "audio" =
    meta?.kind === "video"
      ? "video"
      : meta?.kind === "audio"
        ? "audio"
        : "image";
  const frameMs = Math.max(
    1,
    Math.round(1000 / (meta?.fps ?? ctx.target.fps ?? 30)),
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

  const tileRects = computeGridTileRects({
    canvasW, canvasH, paneHeightPx, rows, cols, tileGapPx: cfg.tileGapPx,
  });

  const pieces: InsetPiece[] = [];
  if (cfg.withInfoPane) {
    pieces.push({ rect: { x: 0, y: 0, w: canvasW, h: paneHeightPx }, source: paneSource });
  }
  for (let i = 0; i < N; i++) {
    const t = isVideo ? timestamps[i] : 0;
    const r = tileRects[i];
    pieces.push({
      rect: { x: r.x, y: r.y, w: r.w, h: r.h },
      source: {
        type: "media",
        mediaType,
        assetId: sourceAssetId,
        placement: { fit: cfg.tileFit },
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
      },
    });
    if (cfg.withTileTimestamp) {
      pieces.push({
        rect: { x: r.x, y: r.y, w: r.w, h: r.h, importance: 1 },
        source: buildTimestampSource({
          t,
          mode,
          isVideo,
          corner: cfg.timestampCorner,
          color: cfg.timestampColor,
          bgColor: cfg.timestampBgColor,
        }),
      });
    }
  }

  const placed = placeInsetPieces({ rootW: canvasW, rootH: canvasH, pieces });

  const assets: MosaicAssetManifest = {
    [sourceAssetId]: {
      kind: "file",
      path: sourceId,
      mediaType,
    },
  };

  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    sources: placed.sources,
    assets,
    m0: placed.m0,
    children,
    size: { width: canvasW, height: canvasH },
    format: formatForMode(mode),
    // Doc-level disable STRIPS the track (`-an`). The source-level knob on
    // each tile only mutes the mix contribution — alone, every animated
    // orientation shipped a silent placeholder audio track (the gate-20
    // class, third family member after highlights and screencap_grid/v2).
    ...(mode === "animated" ? { audio: { mode: "off" } } : {}),
  };

  // Dev tripwire (zero cost when off). The doc renders at its OWN declared
  // canvas (each orientation differs from ctx.target), so the contract is
  // checked against an orientation-sized target.
  return withGeometryContract(
    doc,
    { ...ctx, target: { ...ctx.target, width: canvasW, height: canvasH } },
    {
      templateId: ASPECT_SAFE_ID,
      expectations: placed.expectations,
      debug: cfg.debugGeometry,
    },
  );
}

/**
 * Build the emit:multi pipeline. Two steps per input file
 * (`{slug}__landscape`, `{slug}__portrait`). With 1 input that's 2
 * steps; with N inputs, 2N steps.
 */
async function buildAspectSafePipeline(
  cfg: ResolvedConfig,
  pair: AspectSafePair,
  ctx: MosaicEngineContext,
  mode: ScreencapMode,
): Promise<MosaicDocumentPipeline> {
  // Static sheets are single-frame renders — a fixed nominal duration
  // (trickplay/screencap precedent); animated steps track the target.
  const stepDurationMs =
    mode === "animated" ? (ctx.target.durationMs ?? 5000) : 40;

  // Dedupe step names when multiple inputs share a basename.
  const usedNames = new Set<string>();
  const claim = (name: string): string => {
    let candidate = name;
    let i = 2;
    while (usedNames.has(candidate)) {
      candidate = `${name.slice(0, 128 - String(i).length - 1)}_${i}`;
      i++;
    }
    usedNames.add(candidate);
    return candidate;
  };

  const steps: MosaicPipelineStep[] = [];
  for (const input of cfg.inputs) {
    const slug = slugifyAssetKeyFromPath(input);
    const landscapeName = claim(`${slug}__landscape`);
    const portraitName = claim(`${slug}__portrait`);

    const landscapeDoc = await renderOrientationForInput(
      input,
      cfg,
      pair,
      "landscape",
      ctx,
      mode,
    );
    const portraitDoc = await renderOrientationForInput(
      input,
      cfg,
      pair,
      "portrait",
      ctx,
      mode,
    );

    steps.push({
      name: landscapeName,
      label: landscapeName,
      durationMs: stepDurationMs,
      file: landscapeDoc,
    });
    steps.push({
      name: portraitName,
      label: portraitName,
      durationMs: stepDurationMs,
      file: portraitDoc,
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
 * Top-level dispatcher. Always returns a pipeline on success (even
 * for a single input — 2 orientations means 2 steps). Returns an
 * error mosaic when inputs are missing or no feasible grid pair
 * exists in the search range. The `outputFormat` knob picks the mode:
 * png → static contact sheets, mp4 → animated grids.
 */
export async function renderScreencapGridAspectSafe(
  props: ScreencapGridAspectSafeProps,
  ctx: MosaicEngineContext,
): Promise<MosaicRenderableFile> {
  const mode = resolveMode(props);
  const cfg = resolveConfig(props);
  if (cfg.inputs.length === 0) {
    return makeErrorMosaic(
      'Missing required "Source(s)": pick a folder, one or more files, or drag-and-drop.',
      {
        title: "Screencap Grid — Aspect Safe",
        width: ctx.target.width,
        height: ctx.target.height,
      },
    );
  }
  if (cfg.countMax < cfg.countMin) {
    return makeErrorMosaic(
      `targetCellCountMax (${cfg.countMax}) must be >= targetCellCountMin (${cfg.countMin}).`,
      {
        title: "Screencap Grid — Aspect Safe",
        width: ctx.target.width,
        height: ctx.target.height,
      },
    );
  }
  const pair = pickAspectSafePair(cfg);
  if (!pair) {
    return makeErrorMosaic(
      `No feasible (landscape, portrait) grid pair found in cell-count range [${cfg.countMin}, ${cfg.countMax}] at landscape ${cfg.landscapeW}×${cfg.landscapeH} / portrait ${cfg.portraitW}×${cfg.portraitH}. Widen the range or enable letterbox.`,
      {
        title: "Screencap Grid — Aspect Safe",
        width: ctx.target.width,
        height: ctx.target.height,
      },
    );
  }
  return buildAspectSafePipeline(cfg, pair, ctx, mode);
}

// ---- TEMPLATE ----

export const ScreencapGridAspectSafe: MosaicTemplate<ScreencapGridAspectSafeProps> = {
  id: asTemplateId(ASPECT_SAFE_ID),
  label: "Screencap Grid — Aspect Safe",
  description:
    "Per source video, renders a coordinated landscape + portrait grid pair (same cell count, cells steered to the wanted shape — landscape/square/portrait presets or an exact ratio, default landscape 16:9). Multi-input renders 2 outputs per file. Renders static PNG contact sheets or animated MP4 grids via the Output knob.",
  version: 1,
  capabilities: { tier: "core" },
  tags: ["media", "screencap", "aspect-safe", "multi-orientation", "creators", "developers", "contact-sheet", "thumbnails", "video"],
  propsSchema,

  // No `format` hint on purpose (watermark/trickplay/screencap precedent):
  // the `outputFormat` knob picks png vs mp4 per render, and a template-level
  // container hint would override the user's `-o` extension in
  // `resolveOutputFormat`. Each rendered step document declares its own format.
  outputHints: {
    format: { kind: "image", container: "png" },
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
  },

  defaultProps: { debugGeometry: false, ...SHARED_DEFAULTS },

  render(
    props: ScreencapGridAspectSafeProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicRenderableFile> {
    return renderScreencapGridAspectSafe(props, ctx);
  },

  // Onboarding surfaces. Editor-only stand-ins — they never enter the render
  // path, and `render` keeps its fail-fast contract untouched.
  renderCover(_props: ScreencapGridAspectSafeProps, ctx: MosaicEngineContext): MosaicDocument {
    return renderScreencapGridAspectSafeCover(ctx);
  },

  renderTutorial(_props: ScreencapGridAspectSafeProps, ctx: MosaicEngineContext): MosaicDocumentPipeline {
    return renderScreencapGridAspectSafeTutorial(ctx);
  },
};

registerTemplate(ScreencapGridAspectSafe);
