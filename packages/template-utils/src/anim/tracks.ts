/**
 * ============================================================================
 * anim/tracks — enable-gated drawbox tracks + inline-mask atlases
 * ============================================================================
 *
 * The cost-wall dodges (§0.5 of the F2 plan; perf rules R4/R6/R7) as source
 * builders. The shared idea: N time-disjoint visual elements do NOT become N
 * overlay layers — they collapse into ONE source whose internal filter chain
 * gates each element to its window. Overlay depth stays O(1) at any element
 * count (safely under the ~25 overlay-depth mask-drop ceiling), and
 * visibility is `enable=` (a scalar per-frame gate, ~free) — never a
 * time-varying alpha, which compiles into a per-pixel `geq` fold (R4).
 *
 * Wall-safety is enforced INSIDE these helpers so authors can't re-hit the
 * cliffs by accident:
 *   - `replace=1` on every drawbox (R7): on a transparent base, plain drawbox
 *     blends RGB but does NOT write alpha — edges vanish at composite time.
 *   - commas inside `between()/lt()/gte()` are backslash-escaped for the
 *     ffmpeg filtergraph parser (the engine passes lavfi strings to argv).
 *   - argv budgets (Windows' ~32K command line is the tightest wall): box
 *     tracks THROW past budget; dashed guides degrade by coarsening; mask
 *     atlases THROW past the one-resolver-arg subpath budget.
 *
 * Extracted from dsl-tutorial's canvas panel (reveal curtain, cursor ring
 * track, dashed split guides, tile fill/border atlases) — the same walls
 * every dense template was re-deriving by hand. Domain policy (which rects,
 * what rounding/insets, when windows open) stays with the caller.
 * ============================================================================
 */

import type { MosaicColor, MosaicLavfiSource, MosaicSource } from "@m0saic/types";
import { makeColorTile } from "../sources/makeColorTile";

/** Max drawbox ops in one gated track (dsl-canvas CURTAIN_BOX_BUDGET). */
export const GATED_BOX_BUDGET = 500;
/** Max dash segments across ALL guide lines in one track. */
export const DASH_SEGMENT_BUDGET = 700;
/** Max rounded-rect subpaths in ONE inline-mask atlas: resolveMasksSync
 *  batches all inline-masks into one argv arg — hundreds overflow (E2BIG). */
export const MASK_SUBPATH_BUDGET = 260;

/** One enable-gated drawbox. Coordinates are emitted verbatim — round to
 *  integers (and enforce minimum sizes) at the callsite, where the domain
 *  knows what a sensible floor is. */
export type GatedBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Visibility window (s). Omit fromSec (or ≤0) → from the start; omit
   *  toSec → forever. fromSec>0 & toSec → between(); only toSec → lt();
   *  only fromSec → gte(); neither → always on. */
  fromSec?: number;
  toSec?: number;
  /** Solid fill (t=fill) or a ring of this thickness (px). Default fill. */
  thicknessPx?: number;
  /** Per-box color override (e.g. "#FF8A3D" or "#7C5CFF@0.9"). */
  color?: string;
};

/** The raw lavfi `enable=` gate for a window, comma-escaped. Exported for
 *  callers hand-assembling lavfi strings outside the track builders. */
export function gatedEnableExpr(fromSec?: number, toSec?: number): string | null {
  const from = fromSec != null && fromSec > 0 ? fromSec : undefined;
  if (from != null && toSec != null) return `between(t\\,${from.toFixed(3)}\\,${toSec.toFixed(3)})`;
  if (toSec != null) return `lt(t\\,${toSec.toFixed(3)})`;
  if (from != null) return `gte(t\\,${from.toFixed(3)})`;
  return null;
}

/**
 * ONE lavfi source: a transparent base plus one enable-gated `drawbox` per
 * box. Generalizes BOTH the reveal curtain (fill boxes, `toSec` = reveal
 * moment) and the cursor ring track (`thicknessPx` rings, `between` windows).
 *
 * The engine injects size/rate/duration into the `color=` base and wraps the
 * graph with `format=rgba`; each drawbox paints only while its gate holds.
 * Throws fail-fast past `budget` (default {@link GATED_BOX_BUDGET}) — split
 * the track or reduce density rather than raising it casually.
 */
export function gatedBoxTrackSource(
  boxes: GatedBox[],
  opts: { color: string; budget?: number },
): MosaicLavfiSource {
  const budget = opts.budget ?? GATED_BOX_BUDGET;
  if (boxes.length > budget) {
    throw new Error(
      `gatedBoxTrackSource: ${boxes.length} boxes exceeds the argv budget (${budget}); ` +
        `split the track or reduce density`,
    );
  }
  const ops = boxes.map((b) => {
    const t = b.thicknessPx != null ? String(b.thicknessPx) : "fill";
    const color = b.color ?? opts.color;
    const gate = gatedEnableExpr(b.fromSec, b.toSec);
    return (
      `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=${color}:t=${t}:replace=1` +
      (gate ? `:enable=${gate}` : "")
    );
  });

  // Track-level UNION lifetime (enable-gating sprint): outside
  // [min(fromSec), max(toSec)] every gate is off and the track composites
  // pure transparency — the engine may skip it entirely. A bound is open
  // when ANY box lacks it (a from ≤ 0 paints from t=0; a missing to paints
  // to stream end). Rounded like the per-box gates so the two agree.
  const fromSecs = boxes.map((b) => (b.fromSec != null && b.fromSec > 0 ? b.fromSec : undefined));
  const toSecs = boxes.map((b) => b.toSec);
  const window = {
    ...(fromSecs.every((v): v is number => v != null)
      ? { startSec: Number(Math.min(...fromSecs).toFixed(3)) }
      : {}),
    ...(toSecs.every((v): v is number => v != null)
      ? { endSec: Number(Math.max(...toSecs).toFixed(3)) }
      : {}),
  };

  return {
    type: "lavfi",
    lavfi: ["color=black@0", ...ops].join(","),
    ...(window.startSec != null || window.endSec != null ? { overlay: { window } } : {}),
  } as MosaicLavfiSource;
}

/**
 * Sugar over {@link gatedBoxTrackSource} for the hide-until-reveal CURTAIN:
 * render the finished canvas ONCE, cover each not-yet-revealed region with a
 * hide-colored box gated `lt(t, revealAtSec)` — the box disables at its
 * moment and the content pops in (a hard cut, zero geq). Boxes with
 * `revealAtSec ≤ 0` are visible from t=0 and never curtained; returns `null`
 * when nothing is ever curtained (revealCurtainSource parity).
 */
export function curtainSource(
  boxes: { x: number; y: number; w: number; h: number; revealAtSec: number }[],
  hideColor: string,
  opts?: { budget?: number },
): MosaicLavfiSource | null {
  const curtained: GatedBox[] = [];
  for (const b of boxes) {
    if (!(b.revealAtSec > 0)) continue; // visible from t=0 → never curtained
    curtained.push({ x: b.x, y: b.y, w: b.w, h: b.h, toSec: b.revealAtSec });
  }
  if (curtained.length === 0) return null;
  return gatedBoxTrackSource(curtained, { color: hideColor, budget: opts?.budget });
}

/** A dashed guide line: `fixed` is the cross-axis position, `[from, to]` the
 *  span along the line's axis (all px). Window semantics = {@link GatedBox}. */
export type DashedGuideLine = {
  vertical: boolean;
  fixed: number;
  from: number;
  to: number;
  fromSec?: number;
  toSec?: number;
};

/**
 * Dashed/dotted guide lines as budgeted {@link GatedBox} fills, using a FIXED
 * small dash+gap period (consistent density at any line length). Only when
 * the estimated dash count exceeds `budget` does the period coarsen —
 * uniformly, dash and gap together — so an extreme layout degrades to crisp
 * sparser guides instead of overflowing argv (splitTrackSource parity; a line
 * that gets a single long segment renders effectively solid).
 *
 * Returns GatedBox[] (not a source) so the caller composes them — with other
 * boxes if desired — into ONE {@link gatedBoxTrackSource}.
 */
export function dashedGuideBoxes(
  lines: DashedGuideLine[],
  opts: {
    canvasW: number;
    canvasH: number;
    lineWidthPx?: number;
    dashPx?: number;
    gapPx?: number;
    budget?: number;
  },
): GatedBox[] {
  const { canvasW, canvasH } = opts;
  const lineW = opts.lineWidthPx ?? Math.max(2, Math.round(Math.min(canvasW, canvasH) * 0.003));
  const dash0 = opts.dashPx ?? Math.max(6, Math.round(Math.min(canvasW, canvasH) * 0.016));
  const gap0 = opts.gapPx ?? Math.max(4, Math.round(dash0 * 0.7));
  const budget = opts.budget ?? DASH_SEGMENT_BUDGET;

  const totalSpan = lines.reduce((s, ln) => s + Math.max(0, ln.to - ln.from), 0);
  const estDashes = totalSpan / (dash0 + gap0);
  const scale = estDashes > budget ? estDashes / budget : 1;
  const period = (dash0 + gap0) * scale;
  const dash = Math.max(2, Math.round(dash0 * scale));
  const half = lineW / 2;

  const out: GatedBox[] = [];
  for (const ln of lines) {
    const span = ln.to - ln.from;
    if (!(span > 0)) continue;
    for (let p = ln.from; p < ln.to; p += period) {
      const len = Math.min(dash, ln.to - p);
      if (len < 1) break;
      out.push({
        x: Math.round(ln.vertical ? ln.fixed - half : p),
        y: Math.round(ln.vertical ? p : ln.fixed - half),
        w: Math.round(ln.vertical ? lineW : len),
        h: Math.round(ln.vertical ? len : lineW),
        fromSec: ln.fromSec,
        toSec: ln.toSec,
      });
    }
  }
  return out;
}

/**
 * One clockwise rounded-rect SVG subpath at (x, y) — the building block of
 * mask atlases (author in the CANVAS's absolute pixel space). `r ≤ 0` → a
 * plain rect; `r` clamps to the half-extents so degenerate corners stay
 * valid. (dsl-canvas `roundedRectAt`, exported.)
 */
export function roundedRectPathD(x: number, y: number, w: number, h: number, r: number): string {
  const R = Math.max(0, Math.min(r, Math.floor(w / 2), Math.floor(h / 2)));
  const x1 = x + w,
    y1 = y + h;
  if (R <= 0) return `M${x} ${y} H${x1} V${y1} H${x} Z`;
  return [
    `M${x + R} ${y}`,
    `H${x1 - R}`,
    `A${R} ${R} 0 0 1 ${x1} ${y + R}`,
    `V${y1 - R}`,
    `A${R} ${R} 0 0 1 ${x1 - R} ${y1}`,
    `H${x + R}`,
    `A${R} ${R} 0 0 1 ${x} ${y1 - R}`,
    `V${y + R}`,
    `A${R} ${R} 0 0 1 ${x + R} ${y}`,
    `Z`,
  ].join(" ");
}

/**
 * N-subpath inline-mask ATLAS source: every subpath joins into ONE
 * silhouette, rasterized once and filled with `color` — one source, one
 * mask, one overlay at ANY rect count (the tileFillSource idiom; the
 * per-shape alternative is N PNG inputs + N overlay layers). Empty subpaths
 * are dropped. Throws past {@link MASK_SUBPATH_BUDGET}: the mask resolver
 * batches all inline-masks into one argv arg, and hundreds overflow it
 * (E2BIG / "Failed to resolve source masks").
 *
 * `bounds` must be the space the paths were authored in (typically the full
 * canvas W×H) so the silhouette lands undistorted.
 */
export function maskAtlasSource(
  paths: string[],
  color: MosaicColor,
  bounds: { width: number; height: number },
): MosaicSource {
  const subpaths = paths.filter(Boolean);
  if (subpaths.length > MASK_SUBPATH_BUDGET) {
    throw new Error(
      `maskAtlasSource: ${subpaths.length} subpaths exceeds MASK_SUBPATH_BUDGET ` +
        `(${MASK_SUBPATH_BUDGET}) — the mask resolver's argv arg would overflow; ` +
        `split into multiple atlases or reduce density`,
    );
  }
  return makeColorTile(color, {
    mask: {
      kind: "inline-mask",
      localPath: subpaths.join(" "),
      bounds: { x: 0, y: 0, width: bounds.width, height: bounds.height },
    },
  });
}
