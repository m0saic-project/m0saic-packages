/**
 * Scroll Wall v1 — lattice geometry.
 *
 * The wall's motion (`motion.ts`) subtracts a `baseX` computed BEFORE
 * placement, so every rect is placed with `drift: "exact"` — any drift would
 * desync every clip. Locking exact makes the precision floor
 * `gcd(all edges, canvas)`, which collapses to 1 on an unquantized gap and
 * explodes the m0 (measured up to ~24k chars at 997×720 in the step-0
 * prototype). Hence the lattice: every geometry number is picked on a
 * DIVISOR of the canvas dimension (`q | canvasW`, `qy | canvasH`), then
 * locked exact. On a prime-ish canvas the quantum falls to 1 — the geometry
 * stays correct (warning-only, surfaced via the geometry-contract floors
 * under `debugGeometry`), it just costs precision.
 *
 * Deriving `pitch` from the CANVAS (never from the asset aspect) also avoids
 * the hard throw in `placeOptimizedRects` when `r.x + r.w > rootW`.
 *
 * The two axes are deliberately factored as SCROLL axis vs CROSS axis (not
 * x vs y) so a vertical-scroll v2 can reuse both helpers unchanged.
 */

/** Scroll-axis lattice: the tile comb the clips travel along. */
export type ScrollAxisLattice = {
  /** Lattice quantum — the largest divisor of `axisLen` that is ≤ the requested gap. */
  q: number;
  /** Achieved inter-tile gap (a `q`-multiple, ≥ 1 — see the seam note below). */
  gapPx: number;
  /** Tile pitch = cell + gap. Divides the strip period. */
  pitch: number;
  /** Painted cell size along the scroll axis (`pitch - gapPx`). */
  cellPx: number;
  /** DSL footprints across the canvas: distinct `baseX` slots the tiles cycle through. */
  slots: number;
  /** K = min tiles covering the axis (`ceil(axisLen / pitch)`). */
  coverCount: number;
  /** Minimum slot count for gap-free coverage at every t (= K + 1). */
  minSlotCount: number;
};

/** Cross-axis bands: uniform rows (or columns for a vertical v2). */
export type CrossAxisBands = {
  /** Lattice quantum — the largest divisor of `axisLen` ≤ the requested gap. */
  q: number;
  /** Achieved inter-band gap (a `q`-multiple). */
  gapPx: number;
  /** Uniform band size (a `q`-multiple). */
  bandPx: number;
  /** Band start offsets, one per band, ascending. */
  bandStarts: number[];
  /** Slack before the first band (≥ the snapped margin; a `q`-multiple). */
  leadPx: number;
  /** Slack after the last band. */
  trailPx: number;
};

/** The template-facing bundle, in the plan's vocabulary. */
export type ScrollWallGeometry = {
  canvasW: number;
  canvasH: number;
  rows: number;
  visibleCount: number;
  /** X lattice quantum (`q | canvasW`). */
  q: number;
  /** Y lattice quantum (`qy | canvasH`). */
  qy: number;
  gapX: number;
  gapY: number;
  pitch: number;
  cellW: number;
  slots: number;
  /** K. */
  coverCount: number;
  /** K + 1 — the slot-count floor. */
  minSlotCount: number;
  rowH: number;
  /** Top y of each row, ascending. */
  rowYs: number[];
  topPad: number;
  bottomPad: number;
};

export type ScrollWallGeometryResult =
  | { ok: true; geometry: ScrollWallGeometry }
  | { ok: false; error: string };

/**
 * The floor below which a tile stops being a tile.
 *
 * The look knobs thin themselves to fit (see `scrollAxisLattice` /
 * `crossAxisBands`), which means the geometry no longer runs out of room — it
 * runs out of MEANING first: 12 visible tiles across a 100px axis is arithmetic
 * that succeeds and a wall nobody can watch. So the honest failure moved here.
 * On the scroll axis it is soft — the template's `fitVisibleCount` walks the
 * tile count down until the tiles clear it. On the cross axis it is hard:
 * `rows` is the caller's ask, not a look knob, so 4 rows on a 180px canvas is
 * told it is 4 rows on a 180px canvas.
 */
export const MIN_TILE_PX = 24;

/** Largest divisor of `n` that is ≤ `cap` (cap clamped to ≥ 1, so always ≥ 1). */
export function largestDivisorAtMost(n: number, cap: number): number {
  const c = Math.max(1, Math.min(Math.floor(cap), n));
  for (let d = c; d >= 2; d--) {
    if (n % d === 0) return d;
  }
  return 1;
}

/**
 * Scroll-axis lattice. The seam: the wrap hands a tile off at
 * `absX = -pitch`, where it spans `[-pitch, -gapPx)` — fully off-screen with
 * `gapPx` px of slack. That requires `gapPx ≥ 1`, so a truly flush zero-gap
 * wall is not supported (the requested gap has a floor of 1, which snaps up
 * to `q` px).
 */
export function scrollAxisLattice(
  axisLen: number,
  visibleCount: number,
  requestedGapPx: number,
): ScrollAxisLattice | { error: string } {
  // Bound the gap BEFORE it picks the quantum. `q` is the largest divisor of
  // the axis that fits the gap, so an over-large gap on a short axis chooses a
  // quantum near the whole canvas (96px asked of 320px picks q=80) and then
  // every geometry number has to be a multiple of it — which is what actually
  // makes those canvases infeasible, not the gap itself. Halving the per-tile
  // share first keeps the lattice fine enough to lay the wall out.
  const gapCeiling = Math.max(1, Math.floor(axisLen / (2 * Math.max(1, visibleCount))));
  const q = largestDivisorAtMost(axisLen, Math.min(Math.max(1, requestedGapPx), gapCeiling));
  const pitch = q * Math.floor(axisLen / (visibleCount * q));
  // The gap is a LOOK knob and a SEPARATOR: it never takes more than half the
  // pitch, so a gap wider than the tiles it separates thins to the widest
  // lattice multiple that leaves the tile the larger half, instead of refusing
  // the wall. (Thinning only to "the cell survives" would hand back 1px tiles
  // on a hostile canvas — a render, but not a wall.) What stays an error is a
  // pitch too small for even one quantum of gap; the template's
  // `fitVisibleCount` answers that by asking for fewer, bigger tiles.
  const maxGapQ = Math.floor(pitch / (2 * q));
  const gapPx = q * Math.max(1, Math.min(Math.floor(Math.max(1, requestedGapPx) / q), maxGapQ));
  const cellPx = pitch - gapPx;
  if (cellPx < MIN_TILE_PX) {
    return {
      error:
        `axis ${axisLen}px cannot fit ${visibleCount} visible tile(s) with a ${gapPx}px gap ` +
        `(tile would be ${cellPx}px, under the ${MIN_TILE_PX}px floor).`,
    };
  }
  const slots = Math.floor((axisLen - cellPx) / pitch) + 1;
  const coverCount = Math.ceil(axisLen / pitch);
  return {
    q,
    gapPx,
    pitch,
    cellPx,
    slots,
    coverCount,
    minSlotCount: coverCount + 1,
  };
}

/**
 * Cross-axis uniform bands, cumulative-boundary style (screencap-grid v2's
 * `computeGridTileRects` sibling) on its own quantum `q | axisLen`. The
 * requested margin snaps to the NEAREST lattice point, then down to whatever
 * still leaves every band a pixel; band size is the largest
 * `q`-multiple fitting `bands` uniform bands + gaps inside it; the remaining
 * slack (a `q`-multiple by construction, since `q | axisLen` and every used
 * span is a `q`-multiple) splits lead/trail with the lead floored to the
 * lattice — so every band edge stays a `q`-multiple.
 */
export function crossAxisBands(
  axisLen: number,
  bands: number,
  requestedGapPx: number,
  requestedMarginPx: number,
): CrossAxisBands | { error: string } {
  // Same pre-bound as the scroll axis: an over-large row gap would otherwise
  // pick a quantum near half the canvas and leave no room for the bands.
  const gapCeiling = Math.max(1, Math.floor(axisLen / (2 * Math.max(1, bands))));
  const askedGapPx = Math.min(Math.max(1, requestedGapPx), gapCeiling);
  const q = largestDivisorAtMost(axisLen, askedGapPx);
  const gapPx = bands > 1 ? q * Math.max(1, Math.floor(askedGapPx / q)) : 0;
  // The margin is a LOOK knob under the same rule as the gap: the two margins
  // together never take more than half the axis, so 200px of margin on a 360px
  // canvas thins to fit instead of refusing the wall — a slider at its stop is
  // not an error. What survives as an error is the ask no margin rescues: more
  // bands than the axis has room for.
  const roomForBands = Math.max(bands * q, Math.floor(axisLen / 2));
  const maxMarginQ = Math.max(0, Math.floor((axisLen - (bands - 1) * gapPx - roomForBands) / (2 * q)));
  const marginPx = q * Math.min(Math.round(Math.max(0, requestedMarginPx) / q), maxMarginQ);
  const avail = axisLen - 2 * marginPx - (bands - 1) * gapPx;
  const bandPx = q * Math.floor(avail / (bands * q));
  if (bandPx < MIN_TILE_PX) {
    return {
      error:
        `axis ${axisLen}px cannot fit ${bands} band(s) with a ${gapPx}px gap ` +
        `(band would be ${bandPx}px, under the ${MIN_TILE_PX}px floor).`,
    };
  }
  const used = bands * bandPx + (bands - 1) * gapPx;
  const slack = axisLen - used; // ≡ 0 (mod q), ≥ 2·marginPx
  // Floored to the lattice; ≥ marginPx because marginPx is a q-multiple and
  // slack ≥ 2·marginPx.
  const leadPx = q * Math.floor(slack / (2 * q));
  const bandStarts = Array.from({ length: bands }, (_, r) => leadPx + r * (bandPx + gapPx));
  return { q, gapPx, bandPx, bandStarts, leadPx, trailPx: axisLen - (leadPx + used) };
}

/** The full wall geometry (horizontal scroll: x = scroll axis, y = cross axis). */
export function computeScrollWallGeometry(args: {
  canvasW: number;
  canvasH: number;
  visibleCount: number;
  rows: number;
  gapPx: number;
  marginPx: number;
}): ScrollWallGeometryResult {
  const { canvasW, canvasH, visibleCount, rows, gapPx, marginPx } = args;
  if (!Number.isInteger(canvasW) || canvasW < 1 || !Number.isInteger(canvasH) || canvasH < 1) {
    return { ok: false, error: `canvas ${canvasW}x${canvasH} is not a positive integer size.` };
  }
  const x = scrollAxisLattice(canvasW, visibleCount, gapPx);
  if ("error" in x) {
    return { ok: false, error: `Canvas too small for visibleCount=${visibleCount}: ${x.error}` };
  }
  const y = crossAxisBands(canvasH, rows, gapPx, marginPx);
  if ("error" in y) {
    return { ok: false, error: `Canvas too small for rows=${rows}: ${y.error}` };
  }
  return {
    ok: true,
    geometry: {
      canvasW,
      canvasH,
      rows,
      visibleCount,
      q: x.q,
      qy: y.q,
      gapX: x.gapPx,
      gapY: y.gapPx,
      pitch: x.pitch,
      cellW: x.cellPx,
      slots: x.slots,
      coverCount: x.coverCount,
      minSlotCount: x.minSlotCount,
      rowH: y.bandPx,
      rowYs: y.bandStarts,
      topPad: y.leadPx,
      bottomPad: y.trailPx,
    },
  };
}
