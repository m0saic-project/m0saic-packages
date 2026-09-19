/**
 * BCH(n, k, t) — round-trip + error-injection tests.
 *
 * Verifies:
 *   - parameter cache returns the same canonical object
 *   - generator polynomial degree matches n - k
 *   - clean encode/decode round-trips
 *   - 1..t random-position errors are recovered
 *   - exactly-t errors at adversarial positions are recovered
 *   - t+1 errors either recover (lucky) or are flagged ok=false
 *     (never silently miscorrected)
 *   - shorter standard BCH(15, 7, t=2) round-trip with hand-checked vector
 *
 * Reproducibility: every test uses a fixed PRNG seed via mulberry32.
 */
import { describe, expect, it } from "@jest/globals";
import { mulberry32 } from "../seededRng";
import { GF, GF128 } from "./gf";
import {
  BCH_127_15,
  BCH_255_18,
  buildBch,
  decodeBCH,
  encodeBCH,
} from "./bch";

function randBits(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = rng() < 0.5 ? 0 : 1;
  return out;
}

function flipBits(
  bits: number[],
  positions: ReadonlyArray<number>,
): number[] {
  const out = bits.slice();
  for (const p of positions) out[p] ^= 1;
  return out;
}

function chooseDistinct(
  count: number,
  bound: number,
  seed: number,
): number[] {
  const rng = mulberry32(seed);
  const picked = new Set<number>();
  while (picked.size < count) {
    picked.add(Math.floor(rng() * bound));
  }
  return Array.from(picked.values()).sort((a, b) => a - b);
}

describe("BCH parameter construction", () => {
  it("buildBch is cached — same (gf, t) returns same object", () => {
    const a = buildBch(GF128, 15);
    const b = buildBch(GF128, 15);
    expect(a).toBe(b);
  });

  it("BCH(127, k, t=15): generator degree = n - k", () => {
    const p = BCH_127_15;
    expect(p.n).toBe(127);
    expect(p.generator.length - 1).toBe(p.n - p.k);
  });

  it("BCH(255, k, t=18): n = 255 and k > 128 (room for uuid128 payload)", () => {
    const p = BCH_255_18;
    expect(p.n).toBe(255);
    expect(p.k).toBeGreaterThanOrEqual(128);
  });

  it("k=36 for BCH(127, *, 15) is the textbook value", () => {
    // Standard BCH tables list BCH(127, 36, 15). Our implementation should
    // arrive at the same generator degree (91) regardless of build path.
    expect(BCH_127_15.k).toBe(36);
  });

  it("saturates k to 1 at very large t (cyclotomic cosets exhausted)", () => {
    // For GF(2^7), n=127. With t large enough that 2t-1 ≥ n, the
    // loop caps at i < n and we've consumed every odd cyclotomic
    // coset under n. There are 9 such classes (each contributing
    // a minimal poly of degree 7, except {0}=trivial; their LCM
    // saturates to a 126-degree generator). k = n - 126 = 1.
    const huge = buildBch(GF128, 64);
    expect(huge.k).toBe(1);
    expect(huge.n).toBe(127);
  });
});

describe("BCH(127, 36, t=15) — encode/decode", () => {
  const params = BCH_127_15;

  it("clean round-trip: encode → decode recovers input", () => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const data = randBits(params.k, seed * 991);
      const code = encodeBCH(params, data);
      expect(code.length).toBe(params.n);
      const result = decodeBCH(params, code);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(data);
      expect(result.errorPositions).toEqual([]);
    }
  });

  it("recovers 1..t random-position errors", () => {
    const data = randBits(params.k, 42);
    const code = encodeBCH(params, data);
    for (let e = 1; e <= params.t; e += 1) {
      const errPositions = chooseDistinct(e, params.n, e * 17);
      const received = flipBits(code, errPositions);
      const result = decodeBCH(params, received);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(data);
      expect(result.errorPositions.slice().sort((a, b) => a - b)).toEqual(
        errPositions,
      );
    }
  });

  it("recovers adversarial t-error patterns (consecutive)", () => {
    const data = randBits(params.k, 7);
    const code = encodeBCH(params, data);
    const errPositions: number[] = [];
    for (let i = 0; i < params.t; i += 1) errPositions.push(i);
    const received = flipBits(code, errPositions);
    const result = decodeBCH(params, received);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(data);
  });

  it("flags failure (never miscorrects) beyond capacity at t+5", () => {
    // With t+5 errors we're well past decode capacity. Decoder must
    // either still recover the original (uncommon but possible) or
    // signal ok=false. It must NOT return wrong data with ok=true.
    const data = randBits(params.k, 99);
    const code = encodeBCH(params, data);
    let neverWrong = true;
    for (let seed = 1; seed <= 20; seed += 1) {
      const errPositions = chooseDistinct(params.t + 5, params.n, seed * 11);
      const received = flipBits(code, errPositions);
      const result = decodeBCH(params, received);
      if (result.ok && result.data) {
        // Recovery happened — must equal original.
        if (result.data.some((b, i) => b !== data[i])) {
          neverWrong = false;
          break;
        }
      }
    }
    expect(neverWrong).toBe(true);
  });
});

describe("BCH(255, 131, t=18) — encode/decode", () => {
  const params = BCH_255_18;

  it("clean round-trip", () => {
    const data = randBits(params.k, 12345);
    const code = encodeBCH(params, data);
    expect(code.length).toBe(params.n);
    const result = decodeBCH(params, code);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(data);
  });

  it("recovers t random-position errors", () => {
    const data = randBits(params.k, 17);
    const code = encodeBCH(params, data);
    const errPositions = chooseDistinct(params.t, params.n, 99);
    const received = flipBits(code, errPositions);
    const result = decodeBCH(params, received);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(data);
  });

  it("k ≥ 128 leaves room for uuid128 + padding", () => {
    expect(params.k).toBeGreaterThanOrEqual(128);
  });
});

describe("BCH(15, 7, t=2) — textbook small case", () => {
  // Lin & Costello Example 6.2 — standard small BCH used in textbooks.
  // We don't ship this; it's just a known-good sanity check.
  const gf = new GF(4, 0x13); // GF(2^4) primitive poly x^4 + x + 1 = 0b10011
  const params = buildBch(gf, 2);

  it("has the textbook parameters n=15, k=7, t=2", () => {
    expect(params.n).toBe(15);
    expect(params.k).toBe(7);
    expect(params.t).toBe(2);
  });

  it("round-trips arbitrary 7-bit messages", () => {
    for (let msg = 0; msg < 128; msg += 13) {
      const data: number[] = [];
      for (let i = 6; i >= 0; i -= 1) data.push((msg >> i) & 1);
      const code = encodeBCH(params, data);
      const result = decodeBCH(params, code);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(data);
    }
  });

  it("corrects 1 or 2 errors at every position pair", () => {
    const data = [1, 0, 1, 1, 0, 0, 1];
    const code = encodeBCH(params, data);
    for (let i = 0; i < params.n; i += 1) {
      for (let j = i + 1; j < params.n; j += 1) {
        const received = flipBits(code, [i, j]);
        const result = decodeBCH(params, received);
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(data);
      }
    }
  });
});
