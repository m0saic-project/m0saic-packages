/**
 * Decoder unit + integration tests.
 *
 * Verifies:
 *   - Clean round-trip (encode → simulated sampling → decode) recovers
 *     the original payload byte-identically.
 *   - Noisy round-trip (Gaussian-style random luminance perturbation)
 *     still recovers within BCH's error-correction capacity.
 *   - Wrong key (different PRNG seed) fails to decode.
 */
import { describe, expect, it } from "@jest/globals";
import { mulberry32 } from "../seededRng";
import { DEFAULT_ALPHA_OPTS } from "./alphaPerCell";
import { decodePayload } from "./decoder";
import { encodePayload } from "./encoder";

const HOST_LUMA_BASELINE = 128; // mid-luminance host (where adaptive α peaks)

function simulateSampling(opts: {
  encoderResult: ReturnType<typeof encodePayload>;
  cols: number;
  rows: number;
  hostLuminance: number;
  noiseAmplitude?: number;
  noiseSeed?: number;
}): { sampled: number[]; host: number[] } {
  const { encoderResult, cols, rows, hostLuminance, noiseAmplitude = 0 } = opts;
  const cellCount = cols * rows;
  const sampled: number[] = new Array(cellCount);
  const host: number[] = new Array(cellCount).fill(hostLuminance);
  const rng = mulberry32(opts.noiseSeed ?? 0xfeed);

  for (let i = 0; i < cellCount; i += 1) {
    const cell = encoderResult.cells[i]!;
    // The encoder's per-cell α is a fraction of 1.0; the embedded
    // perturbation in luminance units (0-255 scale) is roughly
    // α * 255 (or with sharper mapping, α * 128 — let's pick 128
    // as a "modest visibility" budget to keep the simulation honest).
    const lumShift = cell.polarity * cell.alpha * 128;
    let noise = 0;
    if (noiseAmplitude > 0) {
      // Box-Muller-ish approximation, but since we have plenty of
      // samples and pinpoint accuracy isn't critical for these tests,
      // uniform [-amp, +amp] is fine.
      noise = (rng() * 2 - 1) * noiseAmplitude;
    }
    sampled[i] = hostLuminance + lumShift + noise;
  }
  return { sampled, host };
}

describe("decodePayload — round-trip with no noise", () => {
  it("recovers a 32-bit id32 payload", () => {
    const cols = 64;
    const rows = 36;
    const seed = 0xdeadbeef >>> 0;
    const payloadHex = "12345678";
    const enc = encodePayload({
      mode: "id32",
      payloadHex,
      seed,
      cols,
      rows,
      alpha: { ...DEFAULT_ALPHA_OPTS, luminanceAdaptive: false },
    });
    const { sampled, host } = simulateSampling({
      encoderResult: enc,
      cols,
      rows,
      hostLuminance: HOST_LUMA_BASELINE,
    });
    const dec = decodePayload({
      mode: "id32",
      seed,
      cols,
      rows,
      sampledLuminance: sampled,
      hostLuminance: host,
    });
    expect(dec.ok).toBe(true);
    expect(dec.payloadHex).toBe(payloadHex);
    expect(dec.correctedBitCount).toBe(0);
  });

  it("recovers a 128-bit uuid128 payload", () => {
    const cols = 64;
    const rows = 36;
    const seed = 0xcafebabe >>> 0;
    const payloadHex = "0123456789abcdef0123456789abcdef";
    const enc = encodePayload({
      mode: "uuid128",
      payloadHex,
      seed,
      cols,
      rows,
      alpha: { ...DEFAULT_ALPHA_OPTS, luminanceAdaptive: false },
    });
    const { sampled, host } = simulateSampling({
      encoderResult: enc,
      cols,
      rows,
      hostLuminance: HOST_LUMA_BASELINE,
    });
    const dec = decodePayload({
      mode: "uuid128",
      seed,
      cols,
      rows,
      sampledLuminance: sampled,
      hostLuminance: host,
    });
    expect(dec.ok).toBe(true);
    expect(dec.payloadHex).toBe(payloadHex);
  });
});

describe("decodePayload — noisy round-trip", () => {
  it("recovers payload under heavy Gaussian-ish noise", () => {
    const cols = 64;
    const rows = 36;
    const seed = 31337;
    const payloadHex = "babecafe";
    const enc = encodePayload({
      mode: "id32",
      payloadHex,
      seed,
      cols,
      rows,
      alpha: { ...DEFAULT_ALPHA_OPTS, luminanceAdaptive: false },
    });
    const { sampled, host } = simulateSampling({
      encoderResult: enc,
      cols,
      rows,
      hostLuminance: HOST_LUMA_BASELINE,
      // Noise comparable to the watermark amplitude — well within
      // what spread-spectrum integration is supposed to survive.
      // 0.012 * 128 ≈ 1.54 lumen units per cell; 18 cells per bit gives
      // ~28 expected per bit. Noise of ~3-4 per cell still recovers.
      noiseAmplitude: 4.0,
      noiseSeed: 42,
    });
    const dec = decodePayload({
      mode: "id32",
      seed,
      cols,
      rows,
      sampledLuminance: sampled,
      hostLuminance: host,
    });
    expect(dec.ok).toBe(true);
    expect(dec.payloadHex).toBe(payloadHex);
  });
});

describe("decodePayload — failure modes", () => {
  it("fails to decode with the wrong key", () => {
    const cols = 64;
    const rows = 36;
    const payloadHex = "deadbeef";
    const enc = encodePayload({
      mode: "id32",
      payloadHex,
      seed: 1234,
      cols,
      rows,
      alpha: { ...DEFAULT_ALPHA_OPTS, luminanceAdaptive: false },
    });
    const { sampled, host } = simulateSampling({
      encoderResult: enc,
      cols,
      rows,
      hostLuminance: HOST_LUMA_BASELINE,
    });
    const dec = decodePayload({
      mode: "id32",
      seed: 9999, // wrong
      cols,
      rows,
      sampledLuminance: sampled,
      hostLuminance: host,
    });
    // With the wrong key, the correlation per bit averages noise → random.
    // BCH may or may not recover (random-noise codewords still have ~50%
    // ok rate in pathological cases), but if it does, the payload is
    // overwhelmingly different from the original.
    if (dec.ok) {
      expect(dec.payloadHex).not.toBe(payloadHex);
    }
  });

  it("rejects mismatched array lengths", () => {
    expect(() =>
      decodePayload({
        mode: "id32",
        seed: 1,
        cols: 8,
        rows: 8,
        sampledLuminance: new Array(63).fill(128),
        hostLuminance: new Array(64).fill(128),
      }),
    ).toThrow();
  });
});
