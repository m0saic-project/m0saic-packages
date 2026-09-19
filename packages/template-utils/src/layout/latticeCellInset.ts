/**
 * The strict four-sided inset shape (a narrowing of `MosaicBoxFrac`, which
 * also allows a bare number / partial sides). Emitting all four sides keeps
 * the value directly usable as `placement.inset` AND as the input the
 * geometry contract's `engineRecover` replays.
 */
export type LatticeInsetSides = { top: number; right: number; bottom: number; left: number };

/** A span's position on the unit lattice: column/row start + spans in units. */
export type LatticeUnitRect = {
  c0: number;
  r0: number;
  cs: number;
  rs: number;
};

export type LatticeCellInsetOptions = {
  /** Lattice shape (unit columns × unit rows). */
  cols: number;
  rows: number;
  /** The canvas the m0 was parsed at (the render target), integer px. */
  canvasW: number;
  canvasH: number;
  /** Gutter between lattice-adjacent cells, integer px per axis. */
  gutterXPx: number;
  gutterYPx: number;
  /** Outer margin on all four canvas edges, integer px. */
  marginPx: number;
  /**
   * One entry per span: its unit rect and the RAW cell the parsed m0 realized
   * for it at (canvasW, canvasH) — same index order as the emitted sources.
   */
  cells: Array<{ unit: LatticeUnitRect; raw: { x: number; y: number; w: number; h: number } }>;
};

export type LatticeCellInsetResult = {
  /** Per-span inset; `undefined` = the raw cell already IS the target (omit `placement.inset`). */
  insetAt: (index: number) => LatticeInsetSides | undefined;
  /** The exact intended painted rect per span (px) — the planning truth the contract asserts. */
  targets: Array<{ x: number; y: number; w: number; h: number }>;
  /** Integer lattice line positions: `columnEdges[k]` = left edge of unit column k (length cols+1). */
  columnEdges: number[];
  rowEdges: number[];
  /**
   * Largest px a target edge escaped its raw cell and was clamped back to
   * the cell boundary. Since lattice lines fit their feasible windows
   * (`[rawStart, rawEnd + g]` per line), this is `0` for any consistent
   * single-parse tiling — including margin ≫ gutter and tiny-gutter fine
   * grids, where cell WIDTHS absorb the rounding jitter while gutters stay
   * exactly `g`. It can only grow when hand-fed cells disagree about a
   * shared boundary by more than the gutter (no valid line position), which
   * a real parse cannot produce. A clamped edge narrows that one gutter by
   * the clamp amount.
   */
  maxClampPx: number;
  clampedEdges: number;
};

/**
 * Content-grid retargeted insets for a span lattice — the collage sibling of
 * `gridCellInset`, for lattices where cells SPAN multiple units and the naive
 * half-gap scheme fails (edge cells lose `g/2 + margin` vs `g` interior →
 * ~6% equal-size spread at typical values).
 *
 * Instead of insetting each cell relative to itself, author the TARGET painted
 * grid first: integer lattice lines `X_k = round(m + k·(unitW + g))` (each
 * boundary rounded independently — no accumulated drift), a span over columns
 * `[c0, c0+cs)` painting exactly `[X_c0, X_{c0+cs} − g]`. Gutters are then
 * EXACTLY `g` px between every adjacent pair and margins exactly `m`, on every
 * canvas; per-class cell sizes differ only by the ±1px independent-rounding
 * jitter.
 *
 * Each inset fraction is emitted as `(px + 0.5) / rawSize` so the engine's
 * per-edge `Math.floor` (`applyInsetToRect` — replayed by `engineRecover`)
 * recovers the integer target EXACTLY. Targets that escape their raw cell
 * (ideal slack < quantization jitter) are clamped to the cell edge and
 * reported via `maxClampPx` / `clampedEdges` — never thrown, so a template
 * degrades to a ≤2px-off gutter at hostile canvases instead of a dead render.
 *
 * The base m0 stays a plain unit-weight ratio split tree (composable, tiny
 * basis); the whole gutter/margin system lives in the fiber at zero DSL cost.
 */
export function latticeCellInset(opts: LatticeCellInsetOptions): LatticeCellInsetResult {
  const { cols, rows, canvasW, canvasH, gutterXPx, gutterYPx, marginPx, cells } = opts;

  for (const [name, v] of [
    ["cols", cols], ["rows", rows], ["canvasW", canvasW], ["canvasH", canvasH],
  ] as const) {
    if (!Number.isInteger(v) || v <= 0)
      throw new Error(`latticeCellInset: ${name} must be a positive integer, got ${v}`);
  }
  for (const [name, v] of [
    ["gutterXPx", gutterXPx], ["gutterYPx", gutterYPx], ["marginPx", marginPx],
  ] as const) {
    if (!Number.isInteger(v) || v < 0)
      throw new Error(`latticeCellInset: ${name} must be a non-negative integer, got ${v}`);
  }
  if (!cells || cells.length === 0) throw new Error("latticeCellInset: cells must be non-empty");

  // Ideal (fractional) unit pitch; the lattice must leave ≥1px per unit.
  const unitW = (canvasW - 2 * marginPx - (cols - 1) * gutterXPx) / cols;
  const unitH = (canvasH - 2 * marginPx - (rows - 1) * gutterYPx) / rows;
  if (unitW < 1 || unitH < 1)
    throw new Error(
      `latticeCellInset: lattice ${cols}×${rows} with gutters ${gutterXPx}/${gutterYPx}px and margin ` +
        `${marginPx}px does not fit ${canvasW}×${canvasH} (unit ${unitW.toFixed(2)}×${unitH.toFixed(2)}px)`,
    );

  // Validate cells up front — the line-fitting pass below needs them.
  cells.forEach(({ unit, raw }, i) => {
    const { c0, r0, cs, rs } = unit;
    if (
      !Number.isInteger(c0) || !Number.isInteger(r0) || !Number.isInteger(cs) || !Number.isInteger(rs) ||
      cs < 1 || rs < 1 || c0 < 0 || r0 < 0 || c0 + cs > cols || r0 + rs > rows
    )
      throw new Error(
        `latticeCellInset: cells[${i}].unit {c0:${c0}, r0:${r0}, cs:${cs}, rs:${rs}} is outside the ${cols}×${rows} lattice`,
      );
    if (!(raw.w >= 1) || !(raw.h >= 1))
      throw new Error(`latticeCellInset: cells[${i}].raw has degenerate size ${raw.w}×${raw.h}`);
  });

  // Feasible WINDOW per lattice line, from the raw cells adjacent to it.
  // A span starting at line k needs X_k ≥ its raw start (left inset ≥ 0);
  // a span ending at line k needs X_k − g ≤ its raw end (right inset ≥ 0),
  // i.e. X_k ≤ rawEnd + g. Gutters are exactly `g` WHEREVER the line lands
  // (a span ends at X−g, the next starts at X) — so clamping the LINE into
  // its window preserves exact gutters and merely shifts the ±1px rounding
  // jitter into cell-width variance, which equal splits carry anyway.
  // Before this pass, ideal lines were rounded blind and a line that landed
  // ~1px outside a raw cell forced a TARGET clamp that narrowed one gutter
  // (visible wobble at small g on fine grids). Windows only come up empty
  // when adjacent spans' raw cells genuinely leave no valid position —
  // that residual case keeps the old degrade-and-report path.
  const colLo = new Array<number>(cols + 1).fill(-Infinity);
  const colHi = new Array<number>(cols + 1).fill(Infinity);
  const rowLo = new Array<number>(rows + 1).fill(-Infinity);
  const rowHi = new Array<number>(rows + 1).fill(Infinity);
  for (const { unit, raw } of cells) {
    colLo[unit.c0] = Math.max(colLo[unit.c0], raw.x);
    colHi[unit.c0 + unit.cs] = Math.min(colHi[unit.c0 + unit.cs], raw.x + raw.w + gutterXPx);
    rowLo[unit.r0] = Math.max(rowLo[unit.r0], raw.y);
    rowHi[unit.r0 + unit.rs] = Math.min(rowHi[unit.r0 + unit.rs], raw.y + raw.h + gutterYPx);
  }

  const fitLine = (ideal: number, lo: number, hi: number): number => {
    const v = Math.round(ideal);
    if (lo > hi) return v; // infeasible window — legacy clamp path reports it
    return Math.min(Math.max(v, lo), hi);
  };

  // Integer lattice lines: each rounds from its own ideal, then fits its window.
  const columnEdges: number[] = [];
  for (let k = 0; k <= cols; k++)
    columnEdges.push(fitLine(marginPx + k * (unitW + gutterXPx), colLo[k], colHi[k]));
  const rowEdges: number[] = [];
  for (let k = 0; k <= rows; k++)
    rowEdges.push(fitLine(marginPx + k * (unitH + gutterYPx), rowLo[k], rowHi[k]));

  const targets: Array<{ x: number; y: number; w: number; h: number }> = [];
  const insets: Array<LatticeInsetSides | undefined> = [];
  let maxClampPx = 0;
  let clampedEdges = 0;

  cells.forEach(({ unit, raw }, i) => {
    const { c0, r0, cs, rs } = unit;

    const target = {
      x: columnEdges[c0],
      y: rowEdges[r0],
      w: columnEdges[c0 + cs] - gutterXPx - columnEdges[c0],
      h: rowEdges[r0 + rs] - gutterYPx - rowEdges[r0],
    };
    if (target.w < 1 || target.h < 1)
      throw new Error(
        `latticeCellInset: cells[${i}] target collapses to ${target.w}×${target.h}px at ${canvasW}×${canvasH}`,
      );
    targets.push(target);

    // Per-edge inset in px (clamped to the raw cell; escapes are reported).
    const clamp = (v: number): number => {
      const n = Math.round(v);
      if (n >= 0) return n;
      clampedEdges++;
      maxClampPx = Math.max(maxClampPx, -n);
      return 0;
    };
    const l = clamp(target.x - raw.x);
    const t = clamp(target.y - raw.y);
    const r = clamp(raw.x + raw.w - (target.x + target.w));
    const b = clamp(raw.y + raw.h - (target.y + target.h));

    if (l === 0 && t === 0 && r === 0 && b === 0) {
      insets.push(undefined);
      return;
    }
    // (n + 0.5)/size survives the engine's floor exactly: floor(((n+0.5)/s)·s) = n.
    insets.push({
      left: (l + 0.5) / raw.w,
      right: (r + 0.5) / raw.w,
      top: (t + 0.5) / raw.h,
      bottom: (b + 0.5) / raw.h,
    });
  });

  return {
    insetAt: (index: number) => insets[index],
    targets,
    columnEdges,
    rowEdges,
    maxClampPx,
    clampedEdges,
  };
}
