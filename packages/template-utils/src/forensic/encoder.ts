/**
 * Forensic-watermark encoder — payload → per-cell overlay plan.
 *
 * This is the math half of the embedding pipeline. The template's
 * render() path turns the `CellPlan[]` into ffmpeg drawbox overlays;
 * the decoder inverts the same math.
 *
 * The encoder is **pure**: identical inputs produce byte-identical
 * outputs. No filesystem, no time-of-day, no Math.random.
 *
 * Pipeline:
 *
 *   1. payloadHex → bit array (k bits, MSB-first)
 *   2. Pad with zeros to params.k → BCH-encode → codeword (n bits)
 *   3. Build cell mask from PRNG seed
 *   4. For each cell, emit a (color, alpha) overlay record:
 *        polarity = codewordBit XOR signBit
 *        color    = polarity ? "white" : "black"
 *        alpha    = α (luminance-adaptive if hostLuminance is supplied)
 *
 * The template author wraps each `CellPlan` in an ffmpeg `drawbox`
 * (or equivalent geometric primitive) with the cell's pixel rect.
 */

import {
  BCH_127_15,
  BCH_255_18,
  type BchParams,
  encodeBCH,
} from "./bch";
import { buildCellMask, type CellMask } from "./mask";
import { alphaForCell, type AlphaCurveOpts } from "./alphaPerCell";

export type PayloadMode = "id32" | "uuid128";

export interface EncoderInputs {
  /** Payload size mode — selects BCH parameter set and bit budget. */
  mode: PayloadMode;
  /** Hex-encoded payload value (lowercase or upper). */
  payloadHex: string;
  /** PRNG seed driving the cell→bit assignment + sign mask. */
  seed: number;
  /** Cell grid columns. */
  cols: number;
  /** Cell grid rows. */
  rows: number;
  /** α curve parameters. */
  alpha: AlphaCurveOpts;
  /**
   * Optional per-cell host luminance baseline (row-major, length cols*rows).
   * Used to scale α per cell when `alpha.luminanceAdaptive` is true.
   * Undefined → uniform α = alphaBase.
   */
  hostLuminance?: ReadonlyArray<number>;
  /**
   * Optional per-cell host ACTIVITY (row-major, length cols*rows): the
   * spread (max − min, luma units) of each cell's 2×2 sub-cell means.
   * With `alpha.luminanceAdaptive`, flat cells fall toward `alphaMin`
   * (see `textureGain`). Undefined → luminance-only curve.
   */
  hostActivity?: ReadonlyArray<number>;
}

export interface CellPlan {
  /** Cell index in row-major order. */
  cellIdx: number;
  /** Row in the grid (0..rows-1). */
  row: number;
  /** Column in the grid (0..cols-1). */
  col: number;
  /** Codeword bit that this cell encodes (for diagnostics / decode). */
  bitIdx: number;
  /**
   * Effective polarity: +1 if the cell should brighten its region,
   * -1 if it should darken. Computed as
   * `codeword[bitIdx] ? sign[i] : -sign[i]`.
   */
  polarity: -1 | 1;
  /** α to apply (0..1). */
  alpha: number;
}

export interface EncoderResult {
  /** BCH parameters used. */
  params: BchParams;
  /** Bit count of the original payload (32 or 128). */
  payloadBits: number;
  /** Final codeword (length params.n). */
  codeword: ReadonlyArray<number>;
  /** Per-cell overlay plan, length = cols * rows. */
  cells: ReadonlyArray<CellPlan>;
  /** Mask used (returned for the sidecar; not for direct embedding). */
  mask: CellMask;
}

/** Resolve BCH parameters + payload bit width for a payload mode. */
export function paramsForMode(mode: PayloadMode): {
  params: BchParams;
  payloadBits: number;
} {
  switch (mode) {
    case "id32":
      return { params: BCH_127_15, payloadBits: 32 };
    case "uuid128":
      return { params: BCH_255_18, payloadBits: 128 };
    default: {
      const _exhaustive: never = mode;
      throw new Error(`paramsForMode: unknown mode ${_exhaustive}`);
    }
  }
}

/** Convert a hex string to a bit array (MSB-first), exactly `payloadBits` long. */
export function payloadHexToBits(
  payloadHex: string,
  payloadBits: number,
): number[] {
  const cleaned = payloadHex.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]*$/.test(cleaned)) {
    throw new Error(`payloadHexToBits: invalid hex string "${payloadHex}"`);
  }
  const expectedHexChars = Math.ceil(payloadBits / 4);
  if (cleaned.length !== expectedHexChars) {
    throw new Error(
      `payloadHexToBits: expected ${expectedHexChars} hex chars for ` +
        `${payloadBits}-bit payload, got ${cleaned.length}`,
    );
  }
  const bits: number[] = new Array(payloadBits);
  for (let i = 0; i < cleaned.length; i += 1) {
    const nib = parseInt(cleaned[i]!, 16);
    for (let b = 0; b < 4; b += 1) {
      const bitPos = i * 4 + b;
      if (bitPos >= payloadBits) break;
      bits[bitPos] = (nib >> (3 - b)) & 1;
    }
  }
  return bits;
}

/** Inverse of payloadHexToBits. */
export function bitsToPayloadHex(bits: ReadonlyArray<number>): string {
  if (bits.length % 4 !== 0) {
    // Pad up to a nibble boundary on the LSB side; the consumer
    // mismatching this should be rare since we only ever encode
    // multiples of 32 in v1.
    const padded = bits.slice();
    while (padded.length % 4 !== 0) padded.push(0);
    return bitsToPayloadHex(padded);
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nib = ((bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!) >>> 0;
    hex += nib.toString(16);
  }
  return hex;
}

/**
 * Pad a payload bit array to the BCH params' `k` data bits.
 * Extra bits are zero-padded on the LSB side (high indices).
 */
export function padToK(payloadBits: ReadonlyArray<number>, k: number): number[] {
  if (payloadBits.length > k) {
    throw new Error(
      `padToK: payload (${payloadBits.length} bits) exceeds BCH k=${k}`,
    );
  }
  const padded = payloadBits.slice();
  while (padded.length < k) padded.push(0);
  return padded;
}

/** Encode a full plan. */
export function encodePayload(inputs: EncoderInputs): EncoderResult {
  const { params, payloadBits } = paramsForMode(inputs.mode);

  // 1. Payload bits
  const dataBits = payloadHexToBits(inputs.payloadHex, payloadBits);

  // 2. Pad to BCH k, encode
  const padded = padToK(dataBits, params.k);
  const codeword = encodeBCH(params, padded);

  // 3. Mask
  const mask = buildCellMask({
    cols: inputs.cols,
    rows: inputs.rows,
    codewordBits: params.n,
    seed: inputs.seed,
  });

  // 4. Per-cell overlay plan
  const cells: CellPlan[] = new Array(mask.cellCount);
  for (let i = 0; i < mask.cellCount; i += 1) {
    const bitIdx = mask.bitIdx[i]!;
    const bit = codeword[bitIdx]!; // 0 or 1
    const sign = mask.sign[i]!; // -1 or +1
    const polarity: -1 | 1 = ((bit ? 1 : -1) * sign) as -1 | 1;
    const luminanceY = inputs.hostLuminance?.[i];
    const alpha = alphaForCell(luminanceY, inputs.hostActivity?.[i], inputs.alpha);
    const row = Math.floor(i / inputs.cols);
    const col = i % inputs.cols;
    cells[i] = { cellIdx: i, row, col, bitIdx, polarity, alpha };
  }

  return { params, payloadBits, codeword, cells, mask };
}
