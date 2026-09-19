/**
 * ============================================================================
 * @m0saic/dsl-tutorial/canvas/v1 — animated geometry-walk canvas (internal)
 * ============================================================================
 *
 * Renders the layout being taught as numbered wireframe tiles that REVEAL in
 * geometry-walk order (hard cut at each tile's emit time), with dashed split
 * subdivisions and a thin orange geometry CURSOR that leads the parse.
 *
 * PERF (W1): the tiles are NOT one text source per cell (that was ~1 PNG input
 * + 1 geq alpha fold PER tile → the render's 90%+ bottleneck at 10x10). The
 * whole grid collapses to a CONSTANT set of full-canvas sources, independent of
 * tile count: one inline-mask atlas for the surfaces, one for the hairline
 * borders (the frameOutlineSource idiom — N rounded-rect subpaths baked to ONE
 * mask PNG), one static text atlas for the numbers/dims, and one drawbox
 * "curtain" lavfi that hard-cut-reveals tiles (enable-only → zero geq; the
 * cursor/split-track idiom). Corner rounding stays crisp because it's the SVG
 * rounding path (a baked mask, not a per-frame geq). The per-tile fade-in is
 * dropped — the reveal is now a hard cut (like the cursor + splits already are).
 *
 * The cursor + splits are enable-gated drawbox tracks (one lit at a time), NOT
 * per-frame `geq` expressions — `geq` re-evaluates per pixel per frame and the
 * cursor only ever SNAPS between known positions, so baked gated rects are both
 * faithful and near-free. Each atlas/track is ONE source → the overlay stack is
 * a fixed ~7 layers, well under the ~25 overlay-depth mask ceiling, at any tile
 * count.
 *
 * M1a: fit-to-panel (all tiles visible, scaled to the canvas cell). The
 * camera (fixed zoom + eased pan to follow the active tile) lands in M1b.
 * ============================================================================
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicEngineContext,
  MosaicDocument,
  MosaicTemplate,
  MosaicTextSource,
  MosaicSource,
} from "@m0saic/types";
import type { M0String } from "@m0saic/dsl";
import { parseM0StringComplete, computeFeasibility } from "@m0saic/dsl";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  registerTemplate,
  makeColorTile,
} from "@m0saic/template-utils";

import { overlay } from "../../../_shared/node-kit";
import { DIGIT_EM, fitBudget, fitFontPx, textWidthPx } from "../../../_shared/text-fit";
import { dslTutorialTheme } from "../../../theme/tokens";
import type { DslTutorialPreset, DslTutorialTheme } from "../../../theme/tokens";

/** Per-leaf timing + true dims, supplied by the parent (logical order). */
export type DslCanvasTile = {
  order: number;
  /** True dims to DISPLAY (parsed at the real output size, not the slot). */
  w: number;
  h: number;
  revealAtSec: number;
  activeStartSec: number;
  activeEndSec: number;
};

/** A geometry-cursor position, lit during its step window. */
export type DslCanvasCursorRect = {
  /** Bounds as fractions (0..1) of the whole canvas. */
  xFrac: number;
  yFrac: number;
  wFrac: number;
  hFrac: number;
  activeStartSec: number;
  activeEndSec: number;
};

/** A painted tile's extent ALONG a divider (canvas px) + its paint time; `interior`
 *  when the divider runs through the tile (passthrough-absorbed), not along its edge. */
export type DslCanvasDividerCover = { lo: number; hi: number; sec: number; interior: boolean };

/** Pacing tier — mirrors the parent's (`pipeline/timing.ts`): summarize draws the
 *  split scaffolding light; sloth gets no splits from the parent. Labels are SIZE-
 *  driven in every tier (founder, 2026-09-05): the frame number is the smallest
 *  useful signal, dims join it when they fit, nothing is drawn where nothing fits. */
export type DslCanvasTier = "teach" | "summarize" | "sloth";

/** A split (enter) step to visualize as a dotted subdivision before its cells paint. */
export type DslCanvasSplit = {
  /** Region rect as fractions (0..1) of the whole canvas. */
  xFrac: number;
  yFrac: number;
  wFrac: number;
  hFrac: number;
  axis: "row" | "col";
  /** Internal dividers: each a position fraction (0..1 of the region along its axis)
   *  plus its OWN clear time — the divider vanishes as soon as the tile spanning it
   *  is painted (so a passthrough-absorbed boundary clears when its tile emits, not
   *  at the whole split's close). */
  dividers: { frac: number; clearSec: number; covers?: DslCanvasDividerCover[] }[];
  activeStartSec: number;
  /** When the whole REGION is claimed — the region outline clears at this time. */
  clearAtSec: number;
};

export type DslCanvasProps = {
  M0String: M0String;
  preset?: DslTutorialPreset;
  tiles?: DslCanvasTile[];
  /** Fade-in duration per tile. */
  introSec?: number;
  /** Draw a thin outline around the whole canvas Frame (default true). */
  showFrame?: boolean;
  /** Split steps to visualize as dotted subdivisions (drawn during their window). */
  splits?: DslCanvasSplit[];
  /** Geometry-cursor positions — the orange ring that leads the parse, one per step. */
  cursorRects?: DslCanvasCursorRect[];
  /** Pacing tier (default teach). */
  tier?: DslCanvasTier;
};

const propsSchema = definePropsSchema<DslCanvasProps>({
  M0String: { type: "m0", required: true, description: "The layout to walk." },
  preset: { type: "string", required: false, description: "Theme preset." },
  tiles: { type: "json", required: false, description: "Per-leaf timing + true dims (logical order)." },
  introSec: { type: "number", required: false, description: "Per-tile fade-in seconds." },
  showFrame: { type: "boolean", required: false, description: "Outline the whole canvas Frame." },
  splits: { type: "json", required: false, description: "Split steps to visualize as dotted subdivisions." },
  cursorRects: { type: "json", required: false, description: "Geometry-cursor positions (one per step)." },
  tier: {
    type: "string",
    required: false,
    description: "Pacing tier: teach (everything), summarize (split scaffolding at 35% — watch it paint), sloth (the parent sends no splits). Tile labels are size-driven in every tier.",
    meta: { constraints: { oneOf: ["teach", "summarize", "sloth"] }, ui: { label: "Pace tier" } },
  },
});

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** An absolute-pixel tile rect (a subset of the parsed `RenderFrame`). */
type TileRect = { x: number; y: number; width: number; height: number };

/** Tile corner-radius strength (fraction of the shorter side) — the value the
 *  old per-tile `effects.rounding.borderRadius` used. */
const TILE_RADIUS = 0.04;

/** Density guards. These used to keep the collapsed sources under the process
 *  argv limit (Windows' ~32K command line) when inline-mask `d` strings and the
 *  curtain lavfi rode argv. Neither does any more: masks resolve through the
 *  worker bridge (`resolveMasksSync` → `runMaskWorkerBatchSync`, one round-trip)
 *  and a lavfi graph past `DEFAULT_LAVFI_INLINE_MAX_CHARS` is lowered to a
 *  `graph_file`. The old 260/500 budgets silently blanked the canvas of any
 *  layout past 260 tiles (a 20×20 grid rendered NO tiles — 2026-09-05), so they
 *  now sit at the engine's real walls: a 5k-tile mask atlas is ~1 MB of path
 *  (fine in the worker), and a 5k-box curtain is one graph file. Labels still
 *  drop first — past ~600 tiles the number cannot fit its tile at 1080p. */
const MASK_SUBPATH_BUDGET = 12_000; // rounded-rect subpaths across fills(+borders) in ONE mask atlas
const LABEL_BUDGET = 2000;          // tiles labelled in the ONE static atlas (a still, rendered once); each label is width-fitted and drops what it cannot fit
export const CURTAIN_BOX_BUDGET = 6_000; // drawbox reveal boxes in the ONE curtain lavfi (graph_file past 4k chars); the parent's MAX_FRAMES is pinned to it
/** An OVERLAPPING layout (`{…}` overlays) reveals per tile — one z-ordered cell
 *  source each — only up to this many tiles: every cell is an overlay layer, and
 *  past the engine's ~25-layer mask ceiling the render both drops masks and
 *  crawls (a 594-module QR took 594 nested text cells and never finished,
 *  2026-09-05). Beyond it the atlas fast-path draws the union of the tiles —
 *  overlaps merge, z-order is approximated by the reveal order — which is the
 *  founder's call for heavy layouts: stability over fidelity. */
const OVERLAP_CELL_BUDGET = 24;

/** Tile label type: the order number + the `w×h` dims line, sized from the tile's
 *  shorter side and WIDTH-FITTED (gate 33) — a narrow tile shrinks the number to
 *  its width, and drops the dims line when it can't fit at the floor (number-only,
 *  the wireframe's "marks degrade" rule) instead of clipping it. */
export function tileLabelType(
  order: number,
  dims: string,
  slotW: number,
  slotH: number,
): { numFont: number; dimFont: number | null } {
  const availW = fitBudget(slotW * 0.96);
  const numMax = Math.round(clamp(Math.min(slotW, slotH) * 0.24, 12, 84));
  const numFont = fitFontPx(String(order), availW, numMax, 8, DIGIT_EM);
  const dimMax = Math.max(9, Math.round(numFont * 0.4));
  const dimFont = fitFontPx(dims, availW, dimMax, 9, DIGIT_EM);
  return { numFont, dimFont: textWidthPx(dims, dimFont, DIGIT_EM) <= availW ? dimFont : null };
}

/** Corner radius in px for `cornerStyle:"rounded"` — mirrors core's
 *  `radiusPxFor` (roundedRectMask.ts) so the atlas corners match the old
 *  per-tile look; core lives behind the moat (§7.4) so it's re-authored here. */
function tileRadiusPx(w: number, h: number, strength: number): number {
  const minDim = Math.min(w, h);
  if (minDim <= 0) return 0;
  const s = Math.max(0, Math.min(1, strength));
  if (s <= 0) return 0;
  const r = Math.floor(s * (minDim / 2));
  return Math.max(1, Math.min(r, Math.floor(minDim / 2)));
}

/** One clockwise rounded-rect SVG subpath in ABSOLUTE canvas coords (the atlas
 *  masks are authored against the whole-canvas bounds). Mirrors core's
 *  `roundedRectPathD` offset to (x,y); r≤0 → a plain rect. */
function roundedRectAt(x: number, y: number, w: number, h: number, r: number): string {
  const R = Math.max(0, Math.min(r, Math.floor(w / 2), Math.floor(h / 2)));
  const x1 = x + w, y1 = y + h;
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

/** ALL tile SURFACES as ONE inline-mask atlas (the frameOutlineSource idiom):
 *  N rounded-rect subpaths in one silhouette, rasterized to ONE PNG once and
 *  filled with the border color. Painted UNDER the inset fill so a hairline
 *  `tileBorder` ring shows — the collapsed equivalent of the old per-tile inner
 *  `effects.stroke`. One source / one mask / one overlay at any tile count. */
function tileBorderFillSource(slotRects: TileRect[], theme: DslTutorialTheme, W: number, H: number): MosaicSource {
  const path = slotRects
    .map((sr) => {
      const iw = Math.round(sr.width), ih = Math.round(sr.height);
      if (iw <= 0 || ih <= 0) return "";
      return roundedRectAt(Math.round(sr.x), Math.round(sr.y), iw, ih, tileRadiusPx(iw, ih, TILE_RADIUS));
    })
    .filter(Boolean)
    .join(" ");
  return makeColorTile(theme.tileBorder, {
    mask: { kind: "inline-mask", localPath: path, bounds: { x: 0, y: 0, width: W, height: H } },
  });
}

/** ALL tile FILLS as ONE inline-mask atlas — rounded-rect subpaths in the tile
 *  color. When `withBorder`, each rect is inset by the hairline width `bw` (its
 *  radius reduced to `outerR-bw` to stay concentric, matching applyStroke's
 *  innerR) so the border source beneath reads as an inner stroke; otherwise the
 *  full tile is filled. */
function tileFillSource(slotRects: TileRect[], theme: DslTutorialTheme, W: number, H: number, withBorder: boolean): MosaicSource {
  const path = slotRects
    .map((sr) => {
      const iw = Math.round(sr.width), ih = Math.round(sr.height);
      if (iw <= 0 || ih <= 0) return "";
      const outerR = tileRadiusPx(iw, ih, TILE_RADIUS);
      const bw = withBorder ? Math.max(1, Math.floor(0.004 * Math.min(iw, ih))) : 0;
      const w = iw - 2 * bw, h = ih - 2 * bw;
      if (w <= 0 || h <= 0) return "";
      const r = withBorder ? Math.max(outerR - bw, 0) : outerR;
      return roundedRectAt(Math.round(sr.x) + bw, Math.round(sr.y) + bw, w, h, r);
    })
    .filter(Boolean)
    .join(" ");
  return makeColorTile(theme.tile, {
    mask: { kind: "inline-mask", localPath: path, bounds: { x: 0, y: 0, width: W, height: H } },
  });
}

/** ALL tile LABELS as ONE static text source — 2 layers per tile (order number
 *  over `w×h`), each absolutely placed at its tile centre via `xExpr`/`yExpr`
 *  (the `glyphStripSource` idiom). No `renderMode`/`overlay` → it renders as a
 *  single still PNG once (gating a still per-layer would bake at t=0), and the
 *  curtain does the reveal. */
function tileAtlasSource(slotRects: TileRect[], tiles: DslCanvasTile[], theme: DslTutorialTheme): MosaicTextSource {
  const layers = slotRects.flatMap((sr, i) => {
    const t = tiles[i];
    const order = t?.order ?? i + 1;
    const w = t?.w ?? Math.round(sr.width);
    const h = t?.h ?? Math.round(sr.height);
    const dims = `${w}×${h}`;
    const { numFont, dimFont } = tileLabelType(order, dims, sr.width, sr.height);
    // The frame number is the smallest useful signal (founder, 2026-09-05): keep it
    // wherever it fits at the floor, add the dims when THEY fit, and draw nothing
    // in a tile too small for even the number — never a clipped glyph.
    if (textWidthPx(String(order), numFont, DIGIT_EM) > fitBudget(sr.width * 0.96) || numFont * 1.12 > sr.height) return [];
    const blockH = numFont * 1.12 + (dimFont ?? 0) * 1.5;
    const y0 = sr.y + (sr.height - blockH) / 2;
    const cx = sr.x + sr.width / 2;
    const numberLayer = {
      content: { kind: "literal", text: String(order) },
      style: { fontSize: numFont, fontColor: theme.tileText },
      placement: { xExpr: `${cx.toFixed(1)}-text_w/2`, yExpr: `${y0.toFixed(1)}` } as never,
    };
    if (dimFont == null) return [numberLayer];
    return [
      numberLayer,
      {
        content: { kind: "literal", text: dims },
        style: { fontSize: dimFont, fontColor: theme.tileMuted },
        placement: { xExpr: `${cx.toFixed(1)}-text_w/2`, yExpr: `${(y0 + numFont * 1.12).toFixed(1)}` } as never,
      },
    ];
  });
  return { type: "text", visual: { backgroundColor: "black@0" }, layers } as MosaicTextSource;
}

/** The reveal CURTAIN — ONE lavfi drawbox source (the cursor-track idiom): a
 *  transparent base plus one opaque `theme.surface` box per not-yet-revealed
 *  tile, gated `enable=lt(t,revealAt)`. Above the atlas, it hides a tile until
 *  its reveal moment (surface-colored → reads as empty canvas), then disables
 *  and the tile pops in — a HARD CUT, boundary-identical to the old
 *  `gte(t,revealAt)` gate but with ZERO geq (enable-only). Returns null when
 *  nothing is ever curtained (no timing / all reveal at t=0). */
function revealCurtainSource(slotRects: TileRect[], tiles: DslCanvasTile[], theme: DslTutorialTheme): MosaicSource | null {
  const surface = typeof theme.surface === "string" ? theme.surface : "#111726";
  const boxes: string[] = [];
  for (let i = 0; i < slotRects.length; i++) {
    const revealAtSec = tiles[i]?.revealAtSec ?? 0;
    if (!(revealAtSec > 0)) continue; // visible from t=0 → never curtained
    const sr = slotRects[i];
    const x = Math.round(sr.x), y = Math.round(sr.y);
    const w = Math.max(1, Math.round(sr.width)), h = Math.max(1, Math.round(sr.height));
    boxes.push(
      `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${surface}:t=fill:replace=1:enable=lt(t\\,${revealAtSec.toFixed(3)})`,
    );
  }
  if (boxes.length === 0) return null;
  return { type: "lavfi", lavfi: ["color=black@0", ...boxes].join(",") } as MosaicSource;
}

/** True when any two tiles overlap by more than a hairline — i.e. the layout has
 *  an OVERLAY (`{…}`): a later tile sits OVER earlier ones. Grids / splits / null
 *  / passthrough tile the canvas without overlap. Overlapping layouts can't use
 *  the reveal CURTAIN — a later full-frame tile's opaque curtain box would occlude
 *  the earlier tiles beneath it until its OWN reveal, so the base layer would only
 *  appear (all at once) when the overlay does. Those take the per-tile path. */
function anyTilesOverlap(rects: TileRect[]): boolean {
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j];
      if (
        a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 &&
        a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1
      ) return true;
    }
  }
  return false;
}

/** A numbered wireframe cell as ONE text source that FILLS its layout leaf (the
 *  engine places + z-orders it) and reveals with an ENABLE-ONLY hard cut — no
 *  `overlay.alpha`, so no per-pixel geq fold. Used ONLY for overlapping/overlay
 *  layouts, where the atlas + curtain can't preserve z-order + progressive reveal;
 *  handing the engine the REAL layout m0 as the base lets it stack these correctly
 *  (overlay on top, revealed at its own time). The pre-atlas per-tile cell, minus
 *  the fade (which is what cost the geq). */
function revealCellSource(
  order: number,
  w: number,
  h: number,
  slotW: number,
  slotH: number,
  theme: DslTutorialTheme,
  revealAtSec: number,
): MosaicTextSource {
  const dims = `${w}×${h}`;
  const { numFont, dimFont } = tileLabelType(order, dims, slotW, slotH);
  const blockH = `(${numFont}*1.12+${dimFont ?? 0}*1.5)`;
  const y0 = `(h-${blockH})/2`;
  const numberLayer = {
    content: { kind: "literal", text: String(order) },
    style: { fontSize: numFont, fontColor: theme.tileText },
    placement: { hAlign: "center", vAlign: "top", yExpr: y0 } as never,
  };
  return {
    type: "text",
    visual: { backgroundColor: theme.tile },
    effects: {
      rounding: { cornerStyle: "rounded", borderRadius: TILE_RADIUS },
      stroke: { position: "inner", width: 0.004, color: theme.tileBorder, alpha: 1 },
    },
    layers:
      dimFont == null
        ? [numberLayer]
        : [
            numberLayer,
            {
              content: { kind: "literal", text: dims },
              style: { fontSize: dimFont, fontColor: theme.tileMuted },
              placement: { hAlign: "center", vAlign: "top", yExpr: `${y0}+${numFont}*1.12` } as never,
            },
          ],
    overlay: {
      startAtSec: revealAtSec,
      enable: `gte(t,${revealAtSec.toFixed(3)})`,
    },
  } as MosaicTextSource;
}

/** The geometry CURSOR track — a thin orange RING that sits at the live X/Y/W/H
 *  bounds and LEADS the parse. The cursor SNAPS per step (no interpolation) and
 *  only ONE position is ever visible at a time, so the entire N-step track lives
 *  in ONE lavfi source: a transparent base plus one ffmpeg `drawbox` op per step,
 *  each enable-gated to its window. `drawbox` draws all four edges natively (no
 *  mask, no input, native thickness), so the track is a FLAT filter chain → a
 *  SINGLE overlay layer regardless of step count.
 *
 *  Why this and not one masked ring per step: a masked ring is a full-panel color
 *  tile + inline-mask, stacked as its own overlay layer — so N steps = N stacked
 *  masked overlays. On a dense layout (8×8 ≈ 154 steps) that overlay DEPTH is the
 *  render bottleneck (frame threads through every layer; super-linear; nears the
 *  ~25 mask-drop ceiling). drawbox collapses depth O(steps) → O(1) and is
 *  near-free per op. Verified ~60–70× realtime. See the `.ai` drawbox-cursor-track
 *  candidate. Commas inside `between(t,a,b)` are backslash-escaped for the ffmpeg
 *  filtergraph parser (the engine passes the lavfi string straight to argv). */
function cursorTrackSource(
  W: number,
  H: number,
  cursorRects: DslCanvasCursorRect[],
  theme: DslTutorialTheme,
): MosaicSource {
  const t = Math.max(2, Math.round(Math.min(W, H) * 0.005)); // border thickness px
  const col = typeof theme.cursor === "string" ? theme.cursor : "#FF8A3D";
  const boxes = cursorRects.map((c) => {
    // Same one-stroke inset as the old masked ring: keep a perimeter cell (root
    // frame / any canvas-edge cell) fully inside the canvas so it isn't clipped
    // by the boundary or overdrawn by the topmost Frame outline.
    const inset = t;
    const x = clamp(Math.round(c.xFrac * W) + inset, 0, W);
    const y = clamp(Math.round(c.yFrac * H) + inset, 0, H);
    const w = Math.max(2 * t, Math.round(c.wFrac * W) - 2 * inset);
    const h = Math.max(2 * t, Math.round(c.hFrac * H) - 2 * inset);
    const a = c.activeStartSec.toFixed(3);
    const b = c.activeEndSec.toFixed(3);
    // `replace=1` is load-bearing: on a transparent (alpha-0) base, plain drawbox
    // blends RGB but does NOT write the alpha channel, so the edge pixels stay
    // alpha-0 and vanish the moment the layer is alpha-composited (visible only if
    // you ignore alpha, e.g. dumping to rgb24). `replace` writes RGB *and* alpha,
    // so the orange edges are opaque and survive the overlay onto the tiles.
    return `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${col}:t=${t}:replace=1:enable=between(t\\,${a}\\,${b})`;
  });
  return {
    type: "lavfi",
    // Transparent base — the engine injects s/r/d into the `color=` generator and
    // wraps the graph with format=rgba; the drawboxes draw only their edges when
    // their window is active.
    lavfi: ["color=black@0", ...boxes].join(","),
  } as MosaicSource;
}

/** A thin hairline outline of the whole canvas Frame — the bounds every tile
 *  paints into. A single color tile clipped to a rectangle RING via an
 *  inline-mask (matte 0 → transparent body, opaque border only), so it reads as
 *  a hollow frame. Authored in the frame's own pixel space (`bounds` = W×H) so
 *  scaleX === scaleY and the border is uniform thickness on every edge — no
 *  aspect distortion. It's canvas content, so under the camera it scales + pans
 *  WITH the walk (you see the frame edge as the camera reaches it). Static +
 *  full duration: the empty frame shows from t=0 and the tiles fade in over it.
 *
 *  The ring path is the outer rect (CW) followed by the inner rect (CCW); the
 *  opposite winding cuts the hole under BOTH nonzero and even-odd fill rules. */
function frameOutlineSource(W: number, H: number, theme: DslTutorialTheme): MosaicSource {
  const t = Math.max(2, Math.round(Math.min(W, H) * 0.004)); // border thickness px
  const outer = `M0 0 H${W} V${H} H0 Z`;
  const inner = `M${t} ${t} V${H - t} H${W - t} V${t} Z`;
  return makeColorTile(theme.frameOutline, {
    mask: {
      kind: "inline-mask",
      localPath: `${outer} ${inner}`,
      bounds: { x: 0, y: 0, width: W, height: H },
    },
  });
}

/** Total dash-segment budget across ALL splits' dividers + outlines, so the one
 *  lavfi graph stays well under the argv length limit even on a 100-tile grid
 *  (the inline-mask version overflowed it → E2BIG). Segments are shared out evenly;
 *  a line that gets only 1 segment renders SOLID (the "capped" dashed mode). */
const DASH_SEGMENT_BUDGET = 700;

type DashLine = { vertical: boolean; fixed: number; from: number; to: number; a: number; b: number; covers?: DslCanvasDividerCover[] };

/** ALL split subdivisions as ONE lavfi `drawbox` source — no inline-masks, so it
 *  scales to any tile count and stays a single overlay layer (the same collapse the
 *  cursor track uses). Each divider/outline is a dashed run of `drawbox` ops gated
 *  to its split's window; the dash count per line is capped against a global budget
 *  so a dense grid degrades to crisp solid guides instead of overflowing argv.
 *
 *  `replace=1` is mandatory (writes alpha on the transparent base); commas inside
 *  `between(t,a,b)` are backslash-escaped for the filtergraph parser. */
function splitTrackSource(
  W: number,
  H: number,
  splits: DslCanvasSplit[],
  theme: DslTutorialTheme,
  alpha = 0.9,
): MosaicSource {
  const lineW = Math.max(2, Math.round(Math.min(W, H) * 0.003));
  const col = typeof theme.accent === "string" ? theme.accent : "#7C5CFF";

  // Flatten every split into axis-aligned lines (region outline for sub-regions +
  // interior dividers), each tagged with its [appear, clear] window.
  const lines: DashLine[] = [];
  for (const sp of splits) {
    const rx = sp.xFrac * W, ry = sp.yFrac * H, rw = sp.wFrac * W, rh = sp.hFrac * H;
    const a = sp.activeStartSec;
    // Region outline clears when the whole region is claimed (split close).
    if (sp.wFrac < 0.99 || sp.hFrac < 0.99) {
      const b = sp.clearAtSec;
      lines.push({ vertical: false, fixed: ry, from: rx, to: rx + rw, a, b });
      lines.push({ vertical: false, fixed: ry + rh, from: rx, to: rx + rw, a, b });
      lines.push({ vertical: true, fixed: rx, from: ry, to: ry + rh, a, b });
      lines.push({ vertical: true, fixed: rx + rw, from: ry, to: ry + rh, a, b });
    }
    // Each interior divider clears on its OWN tile's claim (d.clearSec).
    for (const d of sp.dividers) {
      if (sp.axis === "col") lines.push({ vertical: true, fixed: rx + d.frac * rw, from: ry, to: ry + rh, a, b: d.clearSec, covers: d.covers });
      else lines.push({ vertical: false, fixed: ry + d.frac * rh, from: rx, to: rx + rw, a, b: d.clearSec, covers: d.covers });
    }
  }

  // Premium dotted look: FIXED small dash + gap (consistent density at any line
  // length), matching the original inline-mask grid — not a fixed count per line
  // (which made long lines sparse + "debuggy"). Only an extreme tile count coarsens
  // the period (scales dash + gap up together) to keep the lavfi under budget.
  const dash0 = Math.max(6, Math.round(Math.min(W, H) * 0.016));
  const gap0 = Math.max(4, Math.round(dash0 * 0.7));
  const totalSpan = lines.reduce((s, ln) => s + Math.max(0, ln.to - ln.from), 0);
  const estDashes = totalSpan / (dash0 + gap0);
  const scale = estDashes > DASH_SEGMENT_BUDGET ? estDashes / DASH_SEGMENT_BUDGET : 1;
  const period = (dash0 + gap0) * scale;
  const dash = Math.max(2, Math.round(dash0 * scale));
  const half = lineW / 2;
  const boxes: string[] = [];
  // A dash clears on its OWN cover: inside a tile that absorbed the boundary it
  // vanishes when that tile paints; on a shared edge it waits for the later
  // neighbour; uncovered dashes keep the divider's own clear time.
  const dashClearSec = (ln: DashLine, mid: number): number => {
    if (!ln.covers || ln.covers.length === 0) return ln.b;
    const hit = ln.covers.filter((c) => c.lo - 1 <= mid && mid <= c.hi + 1);
    if (hit.length === 0) return ln.b;
    const interior = hit.filter((c) => c.interior);
    const at = interior.length > 0 ? Math.min(...interior.map((c) => c.sec)) : Math.max(...hit.map((c) => c.sec));
    return Math.min(ln.b, at);
  };
  for (const ln of lines) {
    const span = ln.to - ln.from;
    if (!(span > 0)) continue;
    for (let p = ln.from; p < ln.to; p += period) {
      const len = Math.min(dash, ln.to - p);
      if (len < 1) break;
      const b = dashClearSec(ln, p + len / 2);
      if (!(b > ln.a)) continue; // cleared before it would appear — never drawn
      const enable = `enable=between(t\\,${ln.a.toFixed(3)}\\,${b.toFixed(3)})`;
      const x = Math.round(ln.vertical ? ln.fixed - half : p);
      const y = Math.round(ln.vertical ? p : ln.fixed - half);
      const w = Math.round(ln.vertical ? lineW : len);
      const h = Math.round(ln.vertical ? len : lineW);
      boxes.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${col}@${alpha}:t=fill:replace=1:${enable}`);
    }
  }

  return {
    type: "lavfi",
    lavfi: ["color=black@0", ...boxes].join(","),
  } as MosaicSource;
}

export const DslCanvas: MosaicTemplate<DslCanvasProps> = {
  id: asTemplateId("@m0saic/dsl-tutorial/canvas/v1"),
  label: "DSL Tutorial — Canvas",
  version: 1,
  description: "Internal: animated geometry-walk canvas (numbered tiles reveal in order + active highlight) for dsl-tutorial.",
  capabilities: { tier: "core" },
  tags: ["developer", "dsl-tutorial", "internal", "canvas", "animated"],
  internal: true,
  outputHints: { width: 1280, height: 768, fps: 30, durationMs: 12000, note: "Animated geometry-walk canvas." }, // 768 not 760: a 5-smooth hinted canvas (latticeSmooth)
  propsSchema,
  defaultProps: { M0String: "2(2[1,1],2[1,1])" as M0String, preset: "dark", introSec: 0.3, showFrame: true, tier: "teach" },

  render(props: DslCanvasProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const theme = dslTutorialTheme(props.preset);
    const W = ctx.target.width;
    const H = ctx.target.height;
    const m0 = props.M0String as string;

    const parsed = parseM0StringComplete(m0, W, H);
    if (!parsed.ok) {
      // The parent refuses a layout past this slot's feasibility floor before we
      // render (`dslTutorialCeiling`, founder 2026-09-05). Standalone, name the
      // floor vs the slot so a 0-size frame never reads as a syntax error. ASCII:
      // `makeErrorMosaic` draws this with drawtext (`×`/`—` → `?`).
      const floor =
        parsed.error?.code === "SPLIT_EXCEEDS_AXIS"
          ? (() => {
              const feas = computeFeasibility(m0);
              return ` (the layout needs at least ${feas.minWidthPx} x ${feas.minHeightPx} px; this canvas slot is ${W} x ${H} px)`;
            })()
          : "";
      throw new Error(`dsl-tutorial/canvas: m0 parse failed - ${parsed.error?.message ?? "unknown"}${floor}`);
    }
    const slotRects: TileRect[] = parsed.ir.renderFrames
      .slice()
      .sort((a, b) => a.logicalIndex - b.logicalIndex);

    const tiles = props.tiles ?? [];
    const haveTiming = tiles.length === slotRects.length;
    const revealTiles = haveTiming ? tiles : [];
    const N = slotRects.length;

    // Density guards at the engine's real walls (see the budgets above): labels
    // drop first (illegible), then borders, then the per-tile masked fill falls
    // back to one flat canvas fill, then the curtain.
    const drawBorders = N > 0 && 2 * N <= MASK_SUBPATH_BUDGET;
    const drawTiles = N > 0 && N <= MASK_SUBPATH_BUDGET;
    const tier: DslCanvasTier = props.tier ?? "teach";
    const drawLabels = drawTiles && N <= LABEL_BUDGET;

    // Layers (bottom → top): tile surfaces · reveal · dotted split subdivisions ·
    // geometry CURSOR · Frame outline. Non-overlapping layouts (the perf-critical
    // common case) use the CONSTANT full-canvas atlas + curtain — the per-tile
    // PNG-input + geq-fold explosion is gone. OVERLAPPING layouts (`{…}` overlays)
    // fall back to real geometry: per-tile cells placed via the layout m0 so the
    // engine z-orders them, revealed enable-only (still no geq fade) — because a
    // curtain can't hide an on-top overlay without also hiding the tiles beneath.
    const showFrame = props.showFrame !== false;
    const splits = props.splits ?? [];
    const cursorRects = props.cursorRects ?? [];
    const hasOverlap = anyTilesOverlap(slotRects);
    const layers: { m0: string; sources: MosaicSource[] }[] = [];
    if (hasOverlap && N <= OVERLAP_CELL_BUDGET) {
      // Real-geometry per-tile reveal — each cell fills its layout leaf (engine
      // placement + z-order), revealed by its own enable gate (hard cut, no alpha).
      const perTile = slotRects.map((sr, i) => {
        const t = tiles[i];
        const order = t?.order ?? i + 1;
        const w = t?.w ?? Math.round(sr.width);
        const h = t?.h ?? Math.round(sr.height);
        const revealAtSec = haveTiming ? t.revealAtSec : 0;
        return revealCellSource(order, w, h, sr.width, sr.height, theme, revealAtSec);
      });
      layers.push({ m0, sources: perTile });
    } else {
      // Atlas fast-path (§ file header): the layout string never enters the doc
      // (base m0 is "1"); tile geometry is drawn at absolute px from renderFrames.
      if (drawBorders) {
        layers.push({ m0: "1", sources: [tileBorderFillSource(slotRects, theme, W, H)] });
      }
      if (drawTiles) {
        layers.push({ m0: "1", sources: [tileFillSource(slotRects, theme, W, H, drawBorders)] });
      } else if (N > 0) {
        // Extreme density: one flat tile-colored fill over the canvas; the split +
        // frame guides carry the grid (rounding + labels are sub-pixel here).
        layers.push({ m0: "1", sources: [makeColorTile(theme.tile)] });
      }
      if (drawLabels) {
        const atlas = tileAtlasSource(slotRects, revealTiles, theme);
        if ((atlas.layers?.length ?? 0) > 0) layers.push({ m0: "1", sources: [atlas] }); // no empty text source
      }
      if (haveTiming && N <= CURTAIN_BOX_BUDGET) {
        const curtain = revealCurtainSource(slotRects, revealTiles, theme);
        if (curtain) layers.push({ m0: "1", sources: [curtain] });
      }
    }
    if (splits.length > 0) {
      // ALL dividers in ONE lavfi drawbox source (no per-split inline-masks → no
      // mask-resolution arg explosion on dense grids).
      layers.push({ m0: "1", sources: [splitTrackSource(W, H, splits, theme, tier === "summarize" ? 0.35 : 0.9)] });
    }
    if (cursorRects.length > 0) {
      layers.push({ m0: "1", sources: [cursorTrackSource(W, H, cursorRects, theme)] });
    }
    if (showFrame) {
      layers.push({ m0: "1", sources: [frameOutlineSource(W, H, theme)] });
    }
    // A layout that parses to no tiles still needs a valid single-layer doc.
    if (layers.length === 0) {
      layers.push({ m0: "1", sources: [makeColorTile(theme.surface)] });
    }
    const node = overlay(layers);

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0: toM0String(node.m0, "DslCanvas"),
      sources: node.sources,
      backgroundColor: theme.surface,
    });
  },
};

registerTemplate(DslCanvas);
