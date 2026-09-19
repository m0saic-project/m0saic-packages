/**
 * Galois-field GF(2^m) arithmetic for BCH coding.
 *
 * Builds log/exp tables for a primitive element α and exposes
 * deterministic, allocation-free arithmetic. Used by `bch.ts` to
 * compute generator polynomials, syndromes, and error locators.
 *
 * The two fields we instantiate in v1:
 *
 *   GF(2^7)  — primitive poly x^7 + x + 1               (0x83)
 *              underlying BCH(127, k, t).
 *   GF(2^8)  — primitive poly x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
 *              underlying BCH(255, k, t).
 *
 * Elements are non-negative integers in [0, 2^m). Element 0 is the
 * additive identity (no logarithm); every nonzero element x equals
 * α^i for some 0 ≤ i < 2^m - 1. Addition is XOR.
 */

export class GF {
  /** Extension degree. */
  readonly m: number;
  /** Field order minus 1 (cycle length of α). */
  readonly n: number;
  /** Primitive irreducible polynomial as an integer, low-bit = x^0. */
  readonly primPoly: number;
  /** `exp[i]` = α^i for i in [0, n). exp[i + n] === exp[i] (extended for convenience). */
  readonly exp: Int32Array;
  /** `log[α^i]` = i. `log[0]` is unused (we'd otherwise return -1; callers must check first). */
  readonly log: Int32Array;

  constructor(m: number, primPoly: number) {
    if (m < 1 || m > 16) throw new Error(`GF: m must be 1..16, got ${m}`);
    this.m = m;
    this.n = (1 << m) - 1;
    this.primPoly = primPoly;
    // exp table is 2n long so (a+b) % n can be folded by a single lookup
    // for indices in [0, 2n - 2].
    this.exp = new Int32Array(this.n * 2);
    this.log = new Int32Array(1 << m);

    let x = 1;
    for (let i = 0; i < this.n; i += 1) {
      this.exp[i] = x;
      this.log[x] = i;
      x <<= 1;
      if (x & (1 << m)) x ^= primPoly;
    }
    // Sanity: after n iterations we should be back at 1 (proves primPoly
    // is primitive of degree m).
    if (x !== 1) {
      throw new Error(
        `GF(2^${m}): non-primitive polynomial 0x${primPoly.toString(16)} (cycle length != ${this.n})`,
      );
    }
    // Duplicate exp into the upper half so (a+b) lookups never overflow.
    for (let i = 0; i < this.n; i += 1) {
      this.exp[i + this.n] = this.exp[i];
    }
  }

  /** Field add = XOR. */
  add(a: number, b: number): number {
    return a ^ b;
  }

  /** Field multiply. Returns 0 when either operand is 0. */
  mul(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    return this.exp[this.log[a] + this.log[b]]!;
  }

  /** Field divide. Throws on division by 0. */
  div(a: number, b: number): number {
    if (b === 0) throw new Error("GF.div: division by zero");
    if (a === 0) return 0;
    // log[a] - log[b] could be negative; add n to bring it positive.
    return this.exp[this.log[a] - this.log[b] + this.n]!;
  }

  /** Multiplicative inverse. Throws on inv(0). */
  inv(a: number): number {
    if (a === 0) throw new Error("GF.inv: inverse of zero");
    return this.exp[this.n - this.log[a]]!;
  }

  /** a^e (any integer exponent). 0^0 returns 1. */
  pow(a: number, e: number): number {
    if (e === 0) return 1;
    if (a === 0) return 0;
    let ee = ((this.log[a]! * e) % this.n + this.n) % this.n;
    return this.exp[ee]!;
  }
}

/** Pre-built field instance for BCH(127, k, t). */
export const GF128 = new GF(7, 0x83);

/** Pre-built field instance for BCH(255, k, t). */
export const GF256 = new GF(8, 0x11d);
