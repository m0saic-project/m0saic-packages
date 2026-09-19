/**
 * Page-mode grid planner + pattern-child builder: the diagonal repeated
 * logo/wordmark across the whole canvas (document-style DRAFT /
 * CONFIDENTIAL watermark).
 *
 * # Geometry (why per-instance rotation)
 *
 * `effects.rotate` runs AFTER scale-to-cell, in place, with transparent
 * corner fill — rotating one full-canvas layer would leave transparent
 * corner triangles. Instead each instance cell holds the content's
 * envelope across BOTH rotation phases: the content is drawn unrotated
 * first (needs w×h), then rotated in place (needs the rotated bbox
 * w·|cosθ|+h·|sinθ| × w·|sinθ|+h·|cosθ| — which for slender content at
 * shallow angles is NARROWER than w, so neither box alone suffices):
 *
 *   cw = ceil(max(w, w·|cosθ| + h·|sinθ|))
 *   ch = ceil(max(h, w·|sinθ| + h·|cosθ|))
 *
 * The centering CANNOT use `placement.inset` or contain-letterboxing:
 * the engine shrinks the destination box (inset/padding) BEFORE the
 * scale, and `contain` scales to content-fitted dims — either way the
 * buffer `effects.rotate` runs on is CONTENT-sized and the rotation
 * clips at the content box (ffmpegCommands.ts: inset at ~1055, scale
 * `decrease` at ~1185, applyTileEffects on the scaled label at ~1196;
 * the pad-to-cell happens after the effects chain). The only cell-sized
 * pre-rotation buffer is a NESTED CHILD whose declared `size` equals
 * the cell — children render at their declared dims, so the padding is
 * baked in as real geometry (a centered placeRect + null tiles) and the
 * 1:1 contain scale preserves it through the rotation.
 *
 * # Walls
 *
 * The pattern renders as its OWN engine command (nested child), so the
 * parent's overlay depth stays 1. Inside the pattern, cells are
 * non-overlapping structural siblings (placeRects single layer) capped
 * at `maxTiles ≤ 24` — under the ~25-overlay mask-drop wall (W3), and
 * with no per-cell alpha/enable/blend they stay xstack-sheet-eligible.
 * Text/lockup content is ONE shared nested child referenced per cell,
 * so its inline-mask path travels once (W6 argv budget).
 */

import type { MosaicAssetManifest, MosaicDocument, MosaicSource } from "@m0saic/types";
import { placeRect, placeRects, toM0String } from "@m0saic/dsl-stdlib";
import type { StampRectPx } from "@m0saic/template-utils";

// ── Types ─────────────────────────────────────────────────────

export type PageGridKnobs = {
  canvasW: number;
  canvasH: number;
  /** Unrotated instance content size (from the sizeRatio math). */
  contentW: number;
  contentH: number;
  /** Rotation angle, degrees clockwise. */
  angleDeg: number;
  /** Gap between instance cells, fraction of min(W, H). */
  tileGapRatio: number;
  /** Offset alternate rows by half the horizontal pitch. */
  stagger: boolean;
  /** Hard instance budget (W3 wall). */
  maxTiles: number;
};

export type PageGridPlan = {
  /** Instance cells (envelope sized), row-major. */
  cells: StampRectPx[];
  /** Cell dims (the content's two-phase rotation envelope). */
  cellW: number;
  cellH: number;
  /** Effective unrotated content dims (may shrink so the envelope fits the canvas). */
  contentW: number;
  contentH: number;
  /** Resolved gap (grows deterministically to satisfy maxTiles). */
  gapPx: number;
  rows: number;
  cols: number;
};

// ── planPageGrid ──────────────────────────────────────────────

/**
 * Plan the staggered instance grid. Deterministic: the tile budget is
 * enforced by growing the gap (strictly increasing), and cells that
 * would cross the canvas edge are dropped — the edge margin is the
 * classic page-watermark look.
 */
export function planPageGrid(k: PageGridKnobs): PageGridPlan {
  const { canvasW: W, canvasH: H, angleDeg, tileGapRatio, stagger, maxTiles } = k;
  if (!(k.contentW > 0) || !(k.contentH > 0)) {
    throw new Error(`planPageGrid: content dims must be positive, got ${k.contentW}x${k.contentH}`);
  }
  if (!Number.isInteger(maxTiles) || maxTiles < 1) {
    throw new Error(`planPageGrid: maxTiles must be a positive integer, got ${maxTiles}`);
  }

  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  // Envelope across both rotation phases (see header) — never smaller
  // than the content on either axis, so insets stay non-negative.
  const envW = (w: number, h: number) => Math.ceil(Math.max(w, w * cos + h * sin));
  const envH = (w: number, h: number) => Math.ceil(Math.max(h, w * sin + h * cos));

  // Shrink the content (aspect preserved) until its cell envelope fits
  // the canvas — a large sizeRatio at a steep angle can overflow.
  let contentW = Math.max(1, Math.round(k.contentW));
  let contentH = Math.max(1, Math.round(k.contentH));
  {
    const scale = Math.min(1, W / envW(contentW, contentH), H / envH(contentW, contentH));
    if (scale < 1) {
      contentW = Math.max(1, Math.floor(contentW * scale));
      contentH = Math.max(1, Math.floor(contentH * scale));
    }
  }
  const cellW = Math.min(W, envW(contentW, contentH));
  const cellH = Math.min(H, envH(contentW, contentH));

  const min2 = Math.min(W, H);
  let gapPx = Math.max(0, Math.round(tileGapRatio * min2));

  const gridFor = (gap: number) => {
    const pitchX = cellW + gap;
    const pitchY = cellH + gap;
    const cols = Math.max(1, Math.floor((W - cellW) / pitchX) + 1);
    const rows = Math.max(1, Math.floor((H - cellH) / pitchY) + 1);
    return { pitchX, pitchY, cols, rows };
  };

  // Deterministic budget loop: strictly-increasing gap → rows*cols
  // shrinks monotonically toward 1×1 ≤ maxTiles.
  let grid = gridFor(gapPx);
  while (grid.rows * grid.cols > maxTiles) {
    gapPx = Math.max(gapPx + 1, Math.ceil(gapPx * 1.25));
    grid = gridFor(gapPx);
  }
  const { pitchX, pitchY, cols, rows } = grid;

  const spanW = cols * cellW + (cols - 1) * gapPx;
  const spanH = rows * cellH + (rows - 1) * gapPx;
  const x0 = Math.max(0, Math.floor((W - spanW) / 2));
  const y0 = Math.max(0, Math.floor((H - spanH) / 2));

  const cells: StampRectPx[] = [];
  for (let r = 0; r < rows; r++) {
    const rowOffset = stagger && r % 2 === 1 ? Math.floor(pitchX / 2) : 0;
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * pitchX + rowOffset;
      const y = y0 + r * pitchY;
      if (x + cellW > W || y + cellH > H) continue; // stagger pushes the row's last cell out
      cells.push({ x, y, w: cellW, h: cellH });
    }
  }

  return { cells, cellW, cellH, contentW, contentH, gapPx, rows, cols };
}

// ── buildPaddedInstanceChild ──────────────────────────────────

/**
 * Wrap the content child in a cell-sized child with the padding baked
 * in as real geometry: a centered `placeRect` frame holds the art, the
 * null tiles ARE the (transparent) rotation headroom. This child's
 * declared size == the cell, so the pre-rotation buffer is cell-sized
 * (see header). When the envelope equals the content (angle 0), the
 * wrapper is skipped — the art child is already cell-sized.
 */
export function buildPaddedInstanceChild(opts: {
  plan: PageGridPlan;
  /** The watermark art child at (plan.contentW × plan.contentH). */
  art: MosaicDocument;
}): MosaicDocument {
  const { plan, art } = opts;
  if (plan.cellW === plan.contentW && plan.cellH === plan.contentH) return art;

  const { m0 } = placeRect({
    rootW: plan.cellW,
    rootH: plan.cellH,
    rectW: plan.contentW,
    rectH: plan.contentH,
    // centered (placeRect default) — rotation is about the cell center
  });
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(String(m0), "WatermarkPageInstance"),
    sources: [
      {
        type: "mosaic",
        ref: "wm_art",
        placement: { fit: "contain" },
        editor: { owner: "template", label: "wm:art" },
      },
    ],
    assets: {} as MosaicAssetManifest,
    children: { wm_art: art },
    size: { width: plan.cellW, height: plan.cellH },
  };
}

// ── buildPagePatternChild ─────────────────────────────────────

/**
 * Build the full-canvas pattern child: the planned grid of rotated
 * instances, each referencing ONE shared cell-sized instance child.
 * The parent composites this ONE pattern child (its own engine
 * command) with the pattern opacity applied at the parent source.
 */
export function buildPagePatternChild(opts: {
  canvasW: number;
  canvasH: number;
  plan: PageGridPlan;
  angleDeg: number;
  /** Cell-sized instance child (see {@link buildPaddedInstanceChild}). */
  instance: MosaicDocument;
}): MosaicDocument {
  const { canvasW, canvasH, plan, angleDeg, instance } = opts;
  if (plan.cells.length === 0) {
    throw new Error("buildPagePatternChild: the grid plan produced no cells");
  }
  const declared = instance.size;
  if (!declared || declared.width !== plan.cellW || declared.height !== plan.cellH) {
    throw new Error(
      `buildPagePatternChild: instance child must declare size ${plan.cellW}x${plan.cellH} ` +
        `(got ${declared?.width}x${declared?.height}) — a non-cell-sized child re-letterboxes and the rotation clips`,
    );
  }

  const placed = placeRects({
    rootW: canvasW,
    rootH: canvasH,
    rects: plan.cells.map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, claimant: "F" })),
  });

  const effects = angleDeg !== 0 ? { rotate: angleDeg } : undefined;
  const instanceSource = (i: number): MosaicSource => ({
    type: "mosaic",
    ref: "wm_content",
    // 1:1 — instance size == cell size, so contain is an exact fit and
    // the effects chain sees the full cell-sized buffer.
    placement: { fit: "contain" },
    ...(effects ? { effects } : {}),
    editor: { owner: "template", label: `wm:tile:${i}` },
  });

  // sources[i] binds to the i-th PAINTED frame: within a placeRects
  // layer, frames paint in band order (top→bottom, left→right) — sort
  // each layer's rect indices by y then x (the commit-feed idiom).
  const sources: MosaicSource[] = [];
  for (const layer of placed.layers) {
    const ordered = [...layer.rectIndices].sort(
      (a, b) => plan.cells[a].y - plan.cells[b].y || plan.cells[a].x - plan.cells[b].x,
    );
    for (const idx of ordered) sources.push(instanceSource(idx));
  }

  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(String(placed.m0), "WatermarkPagePattern"),
    sources,
    assets: {} as MosaicAssetManifest,
    children: { wm_content: instance },
    size: { width: canvasW, height: canvasH },
  };
}
