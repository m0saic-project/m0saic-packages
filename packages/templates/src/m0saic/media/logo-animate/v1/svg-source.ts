/**
 * SVG source resolution + the shared-grid conversion pass for
 * `@m0saic/media/logo-animate/v1`.
 *
 * The conversion runs the dsl-stdlib pipeline stage-by-stage
 * (`parseSvg → extractGeometry → inferGrid → rectsToM0`) instead of the
 * one-shot `svgToM0`, because masks and ranks must be generated against
 * the SAME inferred grid the m0 came from — `svgToM0` discards it.
 */

import { readFileSync } from "node:fs";

import { renderSvgContainRgba } from "../../../_shared/svgRaster";
import {
  classifyPixels,
  extractGeometry,
  generateMasks,
  generateMasksByStableKey,
  inferGrid,
  parseSvg,
  rectsToM0,
} from "@m0saic/dsl-stdlib";
import type {
  BinaryGrid,
  Grid,
  MosaicMaskEntry,
  PackingMode,
  ViewBox,
} from "@m0saic/dsl-stdlib";

/** Actionable guidance when an SVG parses to zero usable shapes. */
export const SVG_SHAPE_GUIDANCE =
  "SVG contains no usable <path> or <rect> shapes. Groups, transforms, " +
  "circles/ellipses/polygons and CSS classes are not parsed — in Inkscape: " +
  "select all, Path → Object to Path, ungroup, then save as Plain SVG.";

export type LogoSourceProps = {
  svg?: string;
  svgPath?: string;
};

/**
 * Resolve the SVG text: inline `svg` string (pure), or the file at
 * `svgPath` (requires the template's `fs.read` capability), or the
 * caller-supplied fallback when neither is set. Callers validate the
 * both-set conflict BEFORE calling.
 */
export function loadSvgText(props: LogoSourceProps, fallback: string): string {
  if (props.svgPath) {
    return readFileSync(props.svgPath, "utf8");
  }
  if (props.svg) return props.svg;
  return fallback;
}

export type LogoGrid = {
  /** Canonical m0 string for the inferred grid (brand at doc assembly). */
  m0: string;
  /** The inferred grid — masks and ranks must derive from this same pass. */
  grid: Grid;
  viewBox: ViewBox | null;
  rectCount: number;
  layerCount: number;
  /** Intrinsic logo dims (viewBox, or grid extent) — the aspect source. */
  intrinsic: { w: number; h: number };
};

/**
 * One conversion pass → `{ m0, grid }` sharing a single `inferGrid`
 * result. Throws (with user-actionable messages) on unparseable SVGs;
 * callers wrap in try/catch → error mosaic.
 */
export function buildLogoGrid(
  svgText: string,
  opts: { driftPercent: number; packing: PackingMode },
): LogoGrid {
  const parsed = parseSvg(svgText);
  const shapes = extractGeometry(parsed.paths);
  if (shapes.length === 0) {
    throw new Error(SVG_SHAPE_GUIDANCE);
  }
  const grid = inferGrid(shapes, parsed.viewBox, {
    driftPercent: opts.driftPercent,
    driftMode: "gcd-snap",
  });
  const variant = rectsToM0(grid, { packing: opts.packing });
  const { w, h } = gridCanvasDims(grid);
  return {
    m0: String(variant.m0),
    grid,
    viewBox: parsed.viewBox,
    rectCount: variant.rectCount,
    layerCount: variant.layerCount,
    intrinsic: { w, h },
  };
}

/**
 * The canvas masks are authored in: the grid's own viewBox space (the
 * space `grid.shapes[].snappedBounds` live in). Shape↔frame matching is
 * an L1 ≤ 8px test, so both mask passes MUST run at these dims — the
 * render canvas would miss every match. Mask `bounds` are cell-relative
 * (the engine maps the path box onto whatever rect the cell renders
 * at), so viewBox-space masks scale to any output canvas.
 */
function gridCanvasDims(grid: Grid): { w: number; h: number } {
  if (grid.viewBox && grid.viewBox.width > 0 && grid.viewBox.height > 0) {
    return {
      w: Math.round(grid.viewBox.width),
      h: Math.round(grid.viewBox.height),
    };
  }
  const xs = grid.xLines;
  const ys = grid.yLines;
  return {
    w: Math.max(1, Math.round((xs[xs.length - 1] ?? 1) - (xs[0] ?? 0))),
    h: Math.max(1, Math.round((ys[ys.length - 1] ?? 1) - (ys[0] ?? 0))),
  };
}

/**
 * Best-effort silhouette masks keyed by leaf StableKey (rect-only
 * shapes need no mask and are absent). `generateMasks` THROWS on
 * shape/frame mismatches (only `generateMasksByStableKey` degrades),
 * so the whole pass is fenced: any failure → `{}` → every tile renders
 * as its bounding rect. StableKeys are structural (canvas-independent),
 * so the keys join against frames queried at any render canvas.
 */
export function buildMasksByStableKey(
  grid: Grid,
  m0: string,
): Record<string, MosaicMaskEntry | null> {
  try {
    const { w, h } = gridCanvasDims(grid);
    const maskSet = generateMasks(grid, m0, {
      canvasW: w,
      canvasH: h,
      clipToBounds: true,
    });
    return generateMasksByStableKey(grid, m0, maskSet, w, h);
  } catch {
    return {};
  }
}

/* ── Bitmap mode (opt-in) ─────────────────────────────────────────── */


/**
 * Rasterize an SVG to a `res × res` binary silhouette grid. The SVG's ALPHA
 * channel is the silhouette, so a logo of any ink converts (colour-agnostic).
 * Its `res²` cells — many ON — become the bitmap m0 the animation stitches:
 * the deliberately heavy, opt-in path for non-rectilinear marks that don't
 * decompose into separately-animatable rectangles.
 */
export async function rasterizeSvgToBinaryGrid(
  svgText: string,
  res: number,
): Promise<BinaryGrid> {
  const { data, width, height } = await renderSvgContainRgba(svgText, res);
  const info = { width, height };
  // threshold 0 ⇒ luminance never gates, so every opaque pixel is ON and every
  // transparent pixel (contain-padding / gaps) is OFF: a pure alpha silhouette.
  return classifyPixels(data, info.width, info.height, {
    onMode: "light",
    threshold: 0,
    alphaThreshold: 128,
  });
}
