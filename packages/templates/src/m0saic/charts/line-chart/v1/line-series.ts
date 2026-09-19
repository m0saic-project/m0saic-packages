/**
 * ============================================================================
 * @m0saic/charts/line-chart — line-series data sources (the draw-on layer)
 * ============================================================================
 *
 * Builds the data layer for every series as STATIC mask atlases + ONE reveal —
 * the R6 idiom (perf rule R6: "for a masked line draw-on, use a curtain wipe
 * over the static art, not a per-sliver cascade").
 *
 *   - Per series, per role (area / line / marker-border / marker-fill), the
 *     finished silhouette is ONE full-canvas `maskAtlasSource` (absolute-coord
 *     SVG subpaths, `bounds = W×H`). One source, one overlay layer, at any
 *     subpath count — no per-sliver shards, no time-varying alpha (no geq fold).
 *   - The draw-on is a single reveal, chosen by background opacity:
 *       · opaque (preset/solid) → ONE `curtainSource`: hide-colored columns
 *         over the plot, each disabling (`enable=lt(t,revealAt)`, a free scalar
 *         gate) as the sweep reaches its x. Depth O(1); no alpha expr.
 *       · transparent/image → a group `overlay.alpha` fade on the atlases (a
 *         few full-canvas layers — the accepted perf cost; the deep chain is
 *         gone either way).
 *       · reduceMotion → static atlases, no reveal.
 *   - Value labels stay one `type:"text"` per point, painted ABOVE the curtain,
 *     popped in with `overlay.enable = gte(t, …)` (R4-clean) — never animated
 *     alpha. Each one DISPLAYS a single raw data leaf, so when the parent passes
 *     `valuesBinding` it is bound for Make inline edit (`editor.binding` only —
 *     the m0 is untouched): `[j]` for a flat series, `[i, j]` for nested.
 *
 * `geometry.ts` is unchanged: its existing path builders are fed ABSOLUTE points
 * (no `local()`), and the atlas bounds are the full canvas.
 *
 * Returned as `{ m0, sources }` (contract unchanged); the parent overlays it on
 * the card + chrome. The atlases + curtain are full-frame overlapping layers, so
 * `placeRects` packs them one-per-layer (base→top = area → line → markers →
 * curtain → labels) — the same emission order the composed m0 expects.
 * ============================================================================
 */

import type { MosaicColor, MosaicOverlayExpr, MosaicSource, MosaicTextSource } from "@m0saic/types";
import { maskAtlasSource, curtainSource, fadeInExpr, tag, bindPropPath, MASK_SUBPATH_BUDGET } from "@m0saic/template-utils";
import { placeRects } from "@m0saic/dsl-stdlib";
import type { LineChartModel, Pt } from "../../_shared/line";
import type { AnimConfig, BackgroundMode, ResolvedSeriesStyle, ResolvedValueLabels } from "./types";
import { formatValueLabel } from "./format";
import {
  ribbonQuadPath,
  markerPath,
  areaPolygonPath,
  buildDashMarks,
  dashMarkPath,
  buildSweepSlivers,
  curvePolyline,
  type BBox,
} from "./geometry";
import { BASIS_COL, BASIS_ROW } from "./frame";
import { pointStartSec, buildCurtainColumns } from "./anim";

/** Bbox padding (px) so anti-aliased edges never clip at the cell boundary. */
const EDGE_PAD = 1.5;

type Rect = { x: number; y: number; w: number; h: number; claimant: string };
type Piece = { rect: Rect; source: MosaicSource };

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Rough text width estimate (avg glyph ≈ 0.6em). */
const estTextW = (s: string, size: number) => s.length * size * 0.6;

/** The whole-canvas cell (basis units) every full-frame atlas / curtain occupies. */
const fullRect = (): Rect => ({ x: 0, y: 0, w: BASIS_COL, h: BASIS_ROW, claimant: "F" });

/**
 * Snap a bbox OUTWARD to the frame basis grid (so the cell ⊇ the content, never
 * clipping it) and let the caller build a source sized to the resulting cell px.
 * Used for the per-point value labels (tight text cells).
 */
function snapAndPlace(W: number, H: number, bbox: BBox, makeSource: (cellX: number, cellY: number, cellW: number, cellH: number) => MosaicSource): Piece {
  const qx = clampInt(Math.floor(((bbox.minX - EDGE_PAD) / W) * BASIS_COL), 0, BASIS_COL - 1);
  const qy = clampInt(Math.floor(((bbox.minY - EDGE_PAD) / H) * BASIS_ROW), 0, BASIS_ROW - 1);
  const qx2 = clampInt(Math.ceil(((bbox.maxX + EDGE_PAD) / W) * BASIS_COL), qx + 1, BASIS_COL);
  const qy2 = clampInt(Math.ceil(((bbox.maxY + EDGE_PAD) / H) * BASIS_ROW), qy + 1, BASIS_ROW);
  const qw = qx2 - qx;
  const qh = qy2 - qy;
  const cellX = (qx / BASIS_COL) * W;
  const cellY = (qy / BASIS_ROW) * H;
  const cellW = (qw / BASIS_COL) * W;
  const cellH = (qh / BASIS_ROW) * H;
  return { rect: { x: qx, y: qy, w: qw, h: qh, claimant: "F" }, source: makeSource(cellX, cellY, cellW, cellH) };
}

/**
 * One full-canvas mask atlas: the given ABSOLUTE-coord subpaths joined into a
 * single silhouette filled with `color`. Returns null when there's nothing to
 * draw. Caps the subpath list to {@link MASK_SUBPATH_BUDGET} (the resolver's
 * argv wall) — the line is subsampled upstream; markers/dashes stride-decimate.
 */
function atlasPiece(paths: string[], color: MosaicColor, W: number, H: number, overlay?: MosaicOverlayExpr): Piece | null {
  const subs = capStride(paths.filter(Boolean), MASK_SUBPATH_BUDGET);
  if (subs.length === 0) return null;
  const src = maskAtlasSource(subs, color, { width: W, height: H });
  return { rect: fullRect(), source: overlay ? { ...(src as object), overlay } as MosaicSource : src };
}

/** Even-stride a subpath list down to `cap` when it would overflow the atlas budget. */
function capStride(paths: string[], cap: number): string[] {
  if (paths.length <= cap) return paths;
  const out: string[] = [];
  const stride = paths.length / cap;
  for (let i = 0; i < cap; i++) out.push(paths[Math.floor(i * stride)]);
  return out;
}

/**
 * The line as a list of ribbon-quad subpaths (one per polyline segment). A dense
 * flattened curve past the atlas budget is resampled to even arc-length chords
 * (reusing `buildSweepSlivers`) so the silhouette stays smooth and in-budget.
 */
function lineQuadPaths(poly: Pt[], strokeWidth: number): string[] {
  if (poly.length < 2) return [];
  if (poly.length - 1 > MASK_SUBPATH_BUDGET) {
    return buildSweepSlivers(poly, strokeWidth, { maxSlivers: MASK_SUBPATH_BUDGET }).map((s) => ribbonQuadPath(s.a, s.b, strokeWidth));
  }
  const out: string[] = [];
  for (let i = 0; i < poly.length - 1; i++) out.push(ribbonQuadPath(poly[i], poly[i + 1], strokeWidth));
  return out;
}

/** Place a value label (centered text) in a tight cell whose bottom sits at `topY`. */
function placeValueLabel(W: number, H: number, cx: number, topY: number, text: string, fontSize: number, color: MosaicColor, overlay?: MosaicOverlayExpr): Piece {
  const w = Math.max(fontSize * 1.4, estTextW(text, fontSize));
  const h = fontSize * 1.5;
  const bbox: BBox = { minX: cx - w / 2, minY: topY - h, maxX: cx + w / 2, maxY: topY };
  return snapAndPlace(W, H, bbox, () => {
    const src: MosaicTextSource = {
      type: "text",
      visual: { backgroundColor: "black@0" },
      layers: [
        {
          content: { kind: "literal", text },
          style: { fontSize, fontColor: color },
          placement: { fit: "contain", hAlign: "center", vAlign: "middle" } as never,
        },
      ],
      ...(overlay ? { overlay } : {}),
    };
    return tag(src, "value-label");
  });
}

export type DataLayer = { m0: string; sources: MosaicSource[] };

/** Background context the reveal needs: opaque bgs get a curtain, others a fade. */
export type PlotBg = { mode: BackgroundMode; color: MosaicColor };

/**
 * Build the data layer for every series as static full-canvas atlases plus one
 * reveal. Paint order: areas (bottom) → lines → marker-borders → marker-fills →
 * curtain (opaque animated path only) → value labels (top). Returns null when
 * there's nothing to draw.
 */
export function buildLineSeriesSources(
  model: LineChartModel,
  styles: ResolvedSeriesStyle[],
  anim: AnimConfig,
  opts: {
    highlightIndex?: number;
    valueLabels?: ResolvedValueLabels;
    plotBg?: PlotBg;
    /** Make inline-edit binding for the value labels: the PARENT names the
     *  structured prop the series came from and whether it is nested
     *  (`number[][]` → path `[seriesIdx, pointIdx]`) or flat (`number[]` →
     *  `[pointIdx]`). Indices are the ORIGINAL data positions — the model
     *  never filters, sorts or truncates `values`; a null/non-finite point
     *  simply draws no label (and so binds nothing). */
    valuesBinding?: { propKey: string; nested: boolean };
  } = {},
): DataLayer | null {
  const highlightIndex = opts.highlightIndex ?? -1;
  const valueLabels = opts.valueLabels;
  const valuesBinding = opts.valuesBinding;
  const plotBg = opts.plotBg;
  const { width: W, height: H, plot } = model.layout;
  const reduce = anim.reduceMotion;
  const seriesCount = model.series.length;

  // Opaque card (preset/solid) ⇒ curtain wipe. Transparent/image (or a bare
  // standalone call with no plotBg) ⇒ group alpha-fade. reduceMotion ⇒ static.
  const opaque = !!plotBg && (plotBg.mode === "preset" || plotBg.mode === "solid");
  const useCurtain = !reduce && opaque;
  const useGroupFade = !reduce && !opaque;

  const areas: Piece[] = [];
  const lines: Piece[] = [];
  const markerBorders: Piece[] = [];
  const markerFills: Piece[] = [];
  const labels: Piece[] = [];
  let maxOverhangPx = 0; // marker radius / stroke half-width that overhangs the plot edge

  for (let i = 0; i < seriesCount; i++) {
    const st = styles[i];
    const pts = model.points[i];
    if (!st || !pts || pts.length === 0) continue;

    // The line/area trace this (possibly densified) polyline per `curve`;
    // markers stay on the original data points, revealing at `vertexFracs`.
    const { poly, vertexFracs } = curvePolyline(pts, st.curve);

    // Group fade (transparent/image animated path) — the same overlay on every
    // atlas so they ramp in together; opaque path leaves them static (curtain).
    const groupOverlay: MosaicOverlayExpr | undefined = useGroupFade
      ? { startAtSec: anim.intro.delaySec, alpha: fadeInExpr(anim.intro.delaySec, anim.intro.durationSec * 0.85) }
      : undefined;

    // ---- area fill (behind the line) ----
    // Opacity rides overlay.alpha (a constant expr), NOT a color@alpha: the
    // inline-mask's coverage REPLACES the tile's color alpha, so "@0.2"
    // rendered fully opaque and buried the series beneath it.
    if (st.area.show) {
      const a = clamp01(st.area.opacity);
      const areaOverlay: MosaicOverlayExpr | undefined =
        a >= 1
          ? groupOverlay
          : groupOverlay?.alpha
            ? { ...groupOverlay, alpha: `(${groupOverlay.alpha})*${a}` }
            : { ...(groupOverlay ?? {}), alpha: String(a) };
      const p = atlasPiece([areaPolygonPath(poly, plot.bottom)], (st.area.color ?? st.color) as MosaicColor, W, H, areaOverlay);
      if (p) areas.push(p);
    }

    // ---- line (solid = ribbon quads; dashed/dotted = filled dash marks) ----
    const linePaths =
      st.lineStyle === "dashed" || st.lineStyle === "dotted"
        ? buildDashMarks(poly, st.strokeWidth, st.lineStyle, { maxMarks: MASK_SUBPATH_BUDGET - 8 }).map((m) => dashMarkPath(m, st.strokeWidth, 0, 0))
        : lineQuadPaths(poly, st.strokeWidth);
    const lp = atlasPiece(linePaths, st.color, W, H, groupOverlay);
    if (lp) lines.push(lp);
    maxOverhangPx = Math.max(maxOverhangPx, st.strokeWidth / 2);

    // ---- markers (one border atlas + one fill atlas, per series) ----
    if (st.showPoints) {
      const borderPaths: string[] = [];
      const fillPaths: string[] = [];
      const hasBorder = !!st.pointBorder.color && st.pointBorder.width > 0;
      for (let j = 0; j < pts.length; j++) {
        const r = j === highlightIndex ? st.pointRadius * 1.7 : st.pointRadius;
        if (hasBorder) borderPaths.push(markerPath(pts[j], r + st.pointBorder.width, st.pointShape));
        fillPaths.push(markerPath(pts[j], r, st.pointShape));
        maxOverhangPx = Math.max(maxOverhangPx, r + (hasBorder ? st.pointBorder.width : 0));
      }
      if (hasBorder) {
        const bp = atlasPiece(borderPaths, st.pointBorder.color as MosaicColor, W, H, groupOverlay);
        if (bp) markerBorders.push(bp);
      }
      const fp = atlasPiece(fillPaths, (st.pointColor ?? st.color) as MosaicColor, W, H, groupOverlay);
      if (fp) markerFills.push(fp);
    }

    // ---- per-point value labels (above the curtain, pop via enable-gate) ----
    if (valueLabels?.show) {
      for (let j = 0; j < pts.length; j++) {
        const raw = model.series[i].values[j];
        if (raw == null || !Number.isFinite(raw)) continue;
        const markerR = st.showPoints ? (j === highlightIndex ? st.pointRadius * 1.7 : st.pointRadius) : 0;
        const text = formatValueLabel(raw, valueLabels.format, valueLabels.decimals);
        const lc = (valueLabels.color ?? st.color) as MosaicColor;
        const overlay: MosaicOverlayExpr | undefined = reduce ? undefined : { enable: `gte(t,${pointStartSec(vertexFracs[j], anim).toFixed(3)})` };
        const label = placeValueLabel(W, H, pts[j].x, pts[j].y - markerR - 4, text, valueLabels.fontSize, lc, overlay);
        // The rect shows a FORMATTED rendering of one raw leaf — still that
        // leaf's display (Make seeds the editor from the raw number).
        if (valuesBinding) bindPropPath(label.source, valuesBinding.propKey, valuesBinding.nested ? [i, j] : [j], "number");
        labels.push(label);
      }
    }
  }

  // Assemble bottom→top. The curtain sits ABOVE the data atlases (hides them)
  // and BELOW the value labels (which pop in independently).
  const dataPieces = [...areas, ...lines, ...markerBorders, ...markerFills];
  const pieces: Piece[] = [...dataPieces];
  if (useCurtain && plotBg && dataPieces.length > 0) {
    const cols = buildCurtainColumns(plot, anim, { padPx: Math.ceil(maxOverhangPx + EDGE_PAD) });
    const curtain = curtainSource(cols, plotBg.color);
    if (curtain) pieces.push({ rect: fullRect(), source: curtain });
  }
  pieces.push(...labels);

  if (pieces.length === 0) return null;

  const placed = placeRects({ rootW: BASIS_COL, rootH: BASIS_ROW, rects: pieces.map((p) => p.rect) });

  // Source order must match the composed m0's emission: per layer (base→top),
  // each rect occupies exactly one band, so sort by (y, x).
  const sources: MosaicSource[] = [];
  for (const layer of placed.layers) {
    const ordered = [...layer.rectIndices].sort((a, b) => pieces[a].rect.y - pieces[b].rect.y || pieces[a].rect.x - pieces[b].rect.x);
    for (const idx of ordered) sources.push(pieces[idx].source);
  }

  return { m0: String(placed.m0), sources };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
