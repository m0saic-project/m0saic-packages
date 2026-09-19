/**
 * Forensic-watermark decoder — sampled cell luminances → recovered payload.
 *
 * Pure math — no IO, so this stays safe to bundle for the browser. The
 * ffmpeg frame-sampling wrapper sits one layer up, in the verify
 * template (`@m0saic/forensic/watermark/verify/v1`, whose `decode.ts`
 * reads the sidecar and calls this).
 *
 * Pipeline (inverse of encoder.ts):
 *
 *   1. Receive per-cell averaged luminance (sampled & meaned across
 *      all frames of the watermarked clip).
 *   2. Subtract per-cell host baseline → residual r_i ∈ [-128, +128].
 *   3. For each codeword bit b: score = Σ_{i ∈ cellsForBit(b)} r_i * sign_i.
 *      Sign of score gives the bit value.
 *   4. BCH-decode the recovered codeword → data bits.
 *   5. Strip padding → payload bits.
 *
 * Quality knobs surfaced via `confidence`:
 *
 *   - `correlationStrength`: smallest absolute score across all 127
 *     correlations. Larger = more margin to noise.
 *   - `errorPositions`: positions BCH had to correct.
 */

import { type BchParams, decodeBCH } from "./bch";
import { buildCellMask, type CellMask } from "./mask";
import {
  type PayloadMode,
  bitsToPayloadHex,
  paramsForMode,
} from "./encoder";

export interface DecoderInputs {
  /** Payload mode (must match the one used at embed). */
  mode: PayloadMode;
  /** PRNG seed used at embed (from sidecar). */
  seed: number;
  /** Grid dims. */
  cols: number;
  /** Grid dims. */
  rows: number;
  /**
   * Per-cell averaged luminance from the watermarked clip, row-major,
   * length `cols * rows`. Values are 0..255 (uint8 luminance, averaged
   * to floating point if you took multiple frames).
   */
  sampledLuminance: ReadonlyArray<number>;
  /**
   * Per-cell expected host luminance (the sidecar's hostReference,
   * row-major flattened from `[slot][cell]`). Same length as
   * `sampledLuminance`. Subtracted before correlation.
   */
  hostLuminance: ReadonlyArray<number>;
}

export interface DecoderResult {
  /** True iff BCH decoding produced a syndrome-clean codeword. */
  ok: boolean;
  /** Recovered payload hex (the first 32 / 128 bits of the data block). */
  payloadHex?: string;
  /** Number of bit positions BCH had to correct. */
  correctedBitCount: number;
  /** Codeword indices that were corrected (0-indexed within the n-bit codeword). */
  errorPositions: number[];
  /** Per-codeword-bit correlation scores (signed) — diagnostic. */
  scores: number[];
  /**
   * Smallest absolute score across all `params.n` bits. Useful as a
   * confidence proxy: high = strong signal, low = noisy. Reported in
   * the same units as sampled-luminance (so ~0-255 scale).
   */
  worstAbsScore: number;
}

/** Decode a watermark from per-cell sampled luminances. */
export function decodePayload(inputs: DecoderInputs): DecoderResult {
  const { params, payloadBits } = paramsForMode(inputs.mode);

  if (inputs.sampledLuminance.length !== inputs.cols * inputs.rows) {
    throw new Error(
      `decodePayload: sampledLuminance length ${inputs.sampledLuminance.length} ` +
        `!= cols*rows ${inputs.cols * inputs.rows}`,
    );
  }
  if (inputs.hostLuminance.length !== inputs.cols * inputs.rows) {
    throw new Error(
      `decodePayload: hostLuminance length ${inputs.hostLuminance.length} ` +
        `!= cols*rows ${inputs.cols * inputs.rows}`,
    );
  }

  const mask = buildCellMask({
    cols: inputs.cols,
    rows: inputs.rows,
    codewordBits: params.n,
    seed: inputs.seed,
  });

  // 1. Residual per cell
  const cellCount = inputs.cols * inputs.rows;
  const residual = new Float64Array(cellCount);
  for (let i = 0; i < cellCount; i += 1) {
    residual[i] = inputs.sampledLuminance[i]! - inputs.hostLuminance[i]!;
  }

  // 2. Per-bit correlation score
  const scores = correlate(mask, residual);

  // 3. Score → bit
  const codewordBits: number[] = new Array(params.n);
  for (let b = 0; b < params.n; b += 1) {
    codewordBits[b] = scores[b]! >= 0 ? 1 : 0;
  }

  // 4. BCH-decode
  const decoded = decodeBCH(params, codewordBits);

  let worstAbsScore = Infinity;
  for (const s of scores) {
    const a = Math.abs(s);
    if (a < worstAbsScore) worstAbsScore = a;
  }

  if (!decoded.ok || !decoded.data) {
    return {
      ok: false,
      correctedBitCount: decoded.errorPositions.length,
      errorPositions: decoded.errorPositions,
      scores,
      worstAbsScore,
    };
  }

  // 5. Strip padding to the payload's original width
  const payload = decoded.data.slice(0, payloadBits);
  return {
    ok: true,
    payloadHex: bitsToPayloadHex(payload),
    correctedBitCount: decoded.errorPositions.length,
    errorPositions: decoded.errorPositions,
    scores,
    worstAbsScore,
  };
}

/**
 * Per-codeword-bit correlation score. For each bit b:
 *
 *   score[b] = Σ_{i ∈ cellsForBit(b)} residual[i] * sign[i]
 *
 * The encoder set residual ≈ codewordBit * sign * α (in luminance
 * units, after baseline subtraction), so multiplying by `sign[i]`
 * and summing gives ≈ cellsPerBit * α * (codewordBit ∈ ±1) plus
 * codec/sampling noise. Sign of the sum recovers the bit; magnitude
 * is the SNR proxy.
 */
function correlate(
  mask: CellMask,
  residual: Float64Array,
): number[] {
  const n = mask.codewordBits;
  const scores: number[] = new Array(n).fill(0);
  for (let i = 0; i < mask.cellCount; i += 1) {
    const b = mask.bitIdx[i]!;
    scores[b]! += residual[i]! * mask.sign[i]!;
  }
  return scores;
}
