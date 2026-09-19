/**
 * Cell→bit assignment and per-cell sign mask.
 *
 * In the v1 spatial encoding scheme each cell of a `cols × rows`
 * grid carries one codeword bit, repeated `cellsPerBit` times across
 * the grid. The mapping (cell index → codeword bit index, sign) is
 * derived deterministically from the PRNG seed in the sidecar.
 *
 * Why the indirection (instead of "cell i carries bit i mod n"):
 *
 *   - PRNG-driven assignment scatters cells for a given bit across
 *     the frame. A local content perturbation (motion, dark region)
 *     damages many bits a little, instead of damaging one bit a lot.
 *   - The decoder can't recover the payload without the key, even
 *     if the bit-block layout is structurally guessable.
 *   - Per-cell sign flips (+1 / -1) eliminate any DC luminance bias
 *     — the watermark contributes near-zero net luminance.
 *
 * Determinism: identical seed + grid shape → byte-identical output.
 */

import { mulberry32 } from "../seededRng";

export interface CellMask {
  /** Grid width (columns). */
  readonly cols: number;
  /** Grid height (rows). */
  readonly rows: number;
  /** `cols * rows` cell count. */
  readonly cellCount: number;
  /** Codeword length the mask is sliced for. */
  readonly codewordBits: number;
  /** Floor(cellCount / codewordBits) — number of cells per codeword bit. */
  readonly cellsPerBit: number;
  /**
   * Per-cell codeword bit index, length `cellCount`. Cell index `i`
   * (row-major: `r * cols + c`) encodes codeword bit `bitIdx[i]`.
   * Range: [0, codewordBits).
   */
  readonly bitIdx: Int32Array;
  /**
   * Per-cell sign assignment in {-1, +1}, length `cellCount`. The
   * embedded perturbation for a cell is
   *
   *   (codeword[bitIdx[i]] === 1 ? +1 : -1) * sign[i] * α
   *
   * Mean-zero across the frame (by PRNG construction), so the
   * watermark contributes no DC luminance bias.
   */
  readonly sign: Int8Array;
  /**
   * Reverse index: for each codeword bit `b`, the list of cell
   * indices that carry it. Used by the decoder to compute one
   * correlation per bit.
   */
  readonly cellsByBit: ReadonlyArray<ReadonlyArray<number>>;
}

export interface BuildMaskOpts {
  cols: number;
  rows: number;
  /** Codeword length (must divide into cellCount with at least 1 cell per bit). */
  codewordBits: number;
  /** PRNG seed (32-bit). */
  seed: number;
}

/**
 * Build a deterministic mask from a PRNG seed.
 *
 * `cellsPerBit = floor(cols * rows / codewordBits)`. Any leftover
 * cells (`cellCount % codewordBits`) are distributed across the
 * first `leftover` bit-indices — those bits get one extra cell of
 * redundancy. The PRNG shuffle is a Fisher-Yates over the cell-index
 * sequence `[0, 0, …, 0, 1, 1, …, codewordBits-1, …]` (each bit
 * index repeated `cellsPerBit` (or +1) times), then permuted; this
 * spreads cells for each bit across the grid.
 */
export function buildCellMask(opts: BuildMaskOpts): CellMask {
  const { cols, rows, codewordBits, seed } = opts;
  if (cols < 1 || rows < 1) {
    throw new Error(`buildCellMask: cols/rows must be ≥ 1, got ${cols}×${rows}`);
  }
  if (codewordBits < 1) {
    throw new Error(`buildCellMask: codewordBits must be ≥ 1, got ${codewordBits}`);
  }
  const cellCount = cols * rows;
  if (codewordBits > cellCount) {
    throw new Error(
      `buildCellMask: codewordBits (${codewordBits}) exceeds cellCount (${cellCount})`,
    );
  }
  const cellsPerBit = Math.floor(cellCount / codewordBits);
  const leftover = cellCount - cellsPerBit * codewordBits;

  // Build the unshuffled assignment: bit 0 appears (cellsPerBit + (0<leftover))
  // times, bit 1 appears (cellsPerBit + (1<leftover)) times, etc.
  const assignment = new Int32Array(cellCount);
  let cursor = 0;
  for (let b = 0; b < codewordBits; b += 1) {
    const reps = cellsPerBit + (b < leftover ? 1 : 0);
    for (let r = 0; r < reps; r += 1) {
      assignment[cursor++] = b;
    }
  }

  // Fisher-Yates shuffle, using mulberry32 seeded by `seed`.
  const rng = mulberry32(seed);
  for (let i = cellCount - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = assignment[i]!;
    assignment[i] = assignment[j]!;
    assignment[j] = tmp;
  }

  // Per-cell sign from an independently seeded PRNG so changing
  // grid dims doesn't shift the sign sequence.
  const signRng = mulberry32((seed ^ 0x5a5a5a5a) >>> 0);
  const sign = new Int8Array(cellCount);
  for (let i = 0; i < cellCount; i += 1) {
    sign[i] = signRng() < 0.5 ? -1 : 1;
  }

  // Build cellsByBit reverse index.
  const cellsByBit: number[][] = Array.from({ length: codewordBits }, () => []);
  for (let i = 0; i < cellCount; i += 1) {
    cellsByBit[assignment[i]!]!.push(i);
  }

  return {
    cols,
    rows,
    cellCount,
    codewordBits,
    cellsPerBit,
    bitIdx: assignment,
    sign,
    cellsByBit,
  };
}

/** Convert a cell index back to (row, col). */
export function cellRowCol(cellIdx: number, cols: number): { row: number; col: number } {
  return { row: Math.floor(cellIdx / cols), col: cellIdx % cols };
}
