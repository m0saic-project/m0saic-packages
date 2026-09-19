/**
 * DSL emission — packed spans → a ratio m0 + inset-wired sources.
 *
 * The base is a nested `weightedSplit` tree in UNIT WEIGHTS (basis ≤ the
 * lattice dims, GCD-collapsed) reconstructed from the placed spans by n-ary
 * guillotine decomposition: at every region, split at ALL full uncrossed
 * lattice lines of one axis at once, alternate axes, recurse. Resolution-
 * independent and composable — the polar opposite of the pixel-baked trace
 * this template replaces (launder-ladder rung 1 + rung 2's gap-as-inset).
 *
 * Gutters and margins live entirely in the fiber: the emitted m0 is
 * gutterless; each source carries a `latticeCellInset` retargeted inset that
 * recovers the exact painted grid under the engine's floor math (pixel-exact
 * gutters/margins at the emit canvas).
 *
 * Fillers (imageIndex < 0 — the tiler's never-expected escape) emit as `-`
 * null tiles: no frame, no source, background shows through.
 */

import {
  parseM0StringComplete,
  validateM0String,
  type M0String,
  type RenderFrame,
} from "@m0saic/dsl";
import { weightedSplit } from "@m0saic/dsl-stdlib";
import { latticeCellInset } from "@m0saic/template-utils";
import type { MosaicSource } from "@m0saic/types";
import type { PlacedSpan } from "./packer/types";

type UnitRect = { x0: number; y0: number; x1: number; y1: number; placed: PlacedSpan };

const isFiller = (p: PlacedSpan): boolean => p.imageIndex < 0;

/**
 * Emit the unit-weight guillotine m0 for an exact cover of a cols×rows
 * lattice. Throws on a non-exact or non-guillotine cover (the tiler
 * guarantees both; a throw here means a tiler bug, not a render-time state).
 */
export function emitLatticeM0(placed: PlacedSpan[], cols: number, rows: number): M0String {
  if (placed.length === 0) throw new Error("emitLatticeM0: no spans");
  const area = placed.reduce((a, p) => a + p.cs * p.rs, 0);
  if (area !== cols * rows)
    throw new Error(`emitLatticeM0: cover area ${area} ≠ lattice ${cols}×${rows} = ${cols * rows}`);
  const rects: UnitRect[] = placed.map((p) => ({
    x0: p.c0,
    y0: p.r0,
    x1: p.c0 + p.cs,
    y1: p.r0 + p.rs,
    placed: p,
  }));
  const m0 = emitRegion(rects, 0, 0, cols, rows);
  const v = validateM0String(m0);
  if (!v.ok) throw new Error(`emitLatticeM0: emitted invalid m0 (internal): ${JSON.stringify(v)}`);
  return m0 as M0String;
}

function emitRegion(rects: UnitRect[], x0: number, y0: number, x1: number, y1: number): string {
  if (rects.length === 1) {
    const r = rects[0];
    if (r.x0 !== x0 || r.y0 !== y0 || r.x1 !== x1 || r.y1 !== y1)
      throw new Error(`emitRegion: leaf span does not fill its region (internal)`);
    return isFiller(r.placed) ? "-" : "1";
  }
  // Full uncrossed lattice lines per axis inside this region.
  const vLines: number[] = [];
  for (let x = x0 + 1; x < x1; x++) if (rects.every((r) => r.x1 <= x || r.x0 >= x)) vLines.push(x);
  const hLines: number[] = [];
  for (let y = y0 + 1; y < y1; y++) if (rects.every((r) => r.y1 <= y || r.y0 >= y)) hLines.push(y);
  if (vLines.length === 0 && hLines.length === 0)
    throw new Error(
      `emitRegion: region (${x0},${y0})–(${x1},${y1}) with ${rects.length} spans has no guillotine cut ` +
        `(non-guillotine cover — tiler bug)`,
    );
  // n-ary split at ALL lines of the richer axis (rows win ties: shelf-first).
  const useRows = hLines.length >= vLines.length;
  const cuts = useRows ? hLines : vLines;
  const bounds = useRows ? [y0, ...cuts, y1] : [x0, ...cuts, x1];
  const weights: number[] = [];
  const claimants: string[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const lo = bounds[i];
    const hi = bounds[i + 1];
    weights.push(hi - lo);
    const subset = rects.filter((r) => (useRows ? r.y0 >= lo && r.y1 <= hi : r.x0 >= lo && r.x1 <= hi));
    if (subset.reduce((a, r) => a + (r.x1 - r.x0) * (r.y1 - r.y0), 0) !== (useRows ? (hi - lo) * (x1 - x0) : (hi - lo) * (y1 - y0)))
      throw new Error("emitRegion: segment subset does not tile its slice (internal)");
    claimants.push(
      useRows ? emitRegion(subset, x0, lo, x1, hi) : emitRegion(subset, lo, y0, hi, y1),
    );
  }
  return String(weightedSplit(weights, useRows ? "row" : "col", { claimants }));
}

// ── the full layout emission (m0 + sources + insets + accounting) ──

export type EmitCollageOptions = {
  placed: PlacedSpan[];
  cols: number;
  rows: number;
  /** The render target (insets are computed exactly for this canvas). */
  canvasW: number;
  canvasH: number;
  gutterXPx: number;
  gutterYPx: number;
  marginPx: number;
  /**
   * Source factory per image. Must NOT set `placement.inset` (the emitter
   * owns it — same contract as `placeInsetPieces`); `fit` defaults to
   * `"cover"` when the factory leaves placement unset.
   */
  sourceFor: (imageIndex: number) => MosaicSource;
};

export type EmitCollageResult = {
  m0: M0String;
  /** logicalIndex-aligned (the engine binds `sources[frame.logicalIndex]`). */
  sources: MosaicSource[];
  /** Per-SOURCE mapping back to the pack (same order as `sources`). */
  cells: Array<{
    imageIndex: number;
    span: PlacedSpan;
    /** The frame's stableKey (for doc.labels display entries). */
    stableKey: string;
    /** Exact intended painted rect (px) — what the contract asserts. */
    target: { x: number; y: number; w: number; h: number };
    /** The raw parsed cell the inset recovers the target from. */
    raw: { x: number; y: number; w: number; h: number };
  }>;
  /** Planned unpainted fraction (gutters + margins + any filler area). */
  expectedNullFrac: number;
  /** Inset degradation report (0 on healthy lattices — see latticeCellInset). */
  maxClampPx: number;
  clampedEdges: number;
};

/**
 * Emit the complete layout: m0, logicalIndex-aligned sources with retargeted
 * insets, per-cell targets, and the null-space accounting. Pure; parses the
 * emitted m0 once at the render canvas to bind frames ↔ spans ↔ insets.
 */
export function emitCollageLayout(opts: EmitCollageOptions): EmitCollageResult {
  const { placed, cols, rows, canvasW, canvasH, gutterXPx, gutterYPx, marginPx, sourceFor } = opts;
  const m0 = emitLatticeM0(placed, cols, rows);
  // The COMPLETE parse: its path-style stableKeys are the engine's canonical
  // identity space — doc.labels keyed any other way would never resolve in
  // the app or merge with the contract's backfill.
  const parsed = parseM0StringComplete(m0, canvasW, canvasH);
  if (!parsed.ok) throw new Error("emitCollageLayout: emitted m0 failed to parse (internal)");
  const frames: RenderFrame[] = parsed.ir.renderFrames;

  const real = placed.filter((p) => !isFiller(p));
  if (frames.length !== real.length)
    throw new Error(
      `emitCollageLayout: ${frames.length} parsed frames ≠ ${real.length} painted spans (internal)`,
    );

  // Bind each frame to its span by unit-space center containment — immune to
  // the ±1px outside-in remainder placement of the raw split.
  const spanAt = (cx: number, cy: number): PlacedSpan | undefined => {
    const uc = Math.min(cols - 1, Math.floor((cx / canvasW) * cols));
    const ur = Math.min(rows - 1, Math.floor((cy / canvasH) * rows));
    return real.find((p) => p.c0 <= uc && uc < p.c0 + p.cs && p.r0 <= ur && ur < p.r0 + p.rs);
  };
  const byLogical: Array<{ frame: RenderFrame; span: PlacedSpan }> = [];
  const seen = new Set<PlacedSpan>();
  for (const f of frames) {
    const span = spanAt(f.x + f.width / 2, f.y + f.height / 2);
    if (!span || seen.has(span))
      throw new Error(`emitCollageLayout: frame↔span binding failed at logicalIndex ${f.logicalIndex} (internal)`);
    seen.add(span);
    byLogical[f.logicalIndex] = { frame: f, span };
  }

  const inset = latticeCellInset({
    cols,
    rows,
    canvasW,
    canvasH,
    gutterXPx,
    gutterYPx,
    marginPx,
    cells: byLogical.map(({ frame, span }) => ({
      unit: { c0: span.c0, r0: span.r0, cs: span.cs, rs: span.rs },
      raw: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
    })),
  });

  const sources: MosaicSource[] = [];
  const cells: EmitCollageResult["cells"] = [];
  byLogical.forEach(({ frame, span }, li) => {
    const base = sourceFor(span.imageIndex);
    const placement = (base as { placement?: { inset?: unknown; fit?: string } }).placement;
    if (placement?.inset != null)
      throw new Error(
        `emitCollageLayout: sourceFor(${span.imageIndex}) already carries placement.inset — the emitter owns it`,
      );
    const box = inset.insetAt(li);
    sources.push({
      ...base,
      placement: { fit: "cover", ...(placement ?? {}), ...(box ? { inset: box } : {}) },
    } as MosaicSource);
    cells.push({
      imageIndex: span.imageIndex,
      span,
      stableKey: String(frame.meta.stableKey),
      target: inset.targets[li],
      raw: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
    });
  });

  const painted = inset.targets.reduce((a, t) => a + t.w * t.h, 0);
  return {
    m0,
    sources,
    cells,
    expectedNullFrac: 1 - painted / (canvasW * canvasH),
    maxClampPx: inset.maxClampPx,
    clampedEdges: inset.clampedEdges,
  };
}
