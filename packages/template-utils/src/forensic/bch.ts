/**
 * Binary BCH (Bose–Chaudhuri–Hocquenghem) error-correcting codes over
 * GF(2^m), used by the forensic-watermarking template family to wrap
 * each render's payload before slot embedding.
 *
 * Two parameter sets ship in v1; both are textbook standard:
 *
 *   BCH(127, 36, t=15)  — id32 mode (32-bit payload + 4-bit pad)
 *                          parity = 91 bits, corrects up to 15 errors
 *                          per 127-bit codeword (~11.8% error capacity).
 *
 *   BCH(255, 131, t=18) — uuid128 mode (128-bit payload + 3-bit pad)
 *                          parity = 124 bits, corrects up to 18 errors
 *                          per 255-bit codeword (~7.1% error capacity).
 *
 * Bit conventions
 * ---------------
 * Data and codeword bit arrays are indexed left-to-right (`bits[0]` is
 * the most-significant bit). The codeword is systematic: the first `k`
 * bits hold the data verbatim, the remaining `n - k` bits hold parity.
 *
 * Algorithm
 * ---------
 * Encode: systematic shift-register division; standard textbook
 * approach over GF(2).
 *
 * Decode: syndrome computation → Berlekamp-Massey to find the error
 * locator polynomial σ(x) → Chien search to find σ(x)'s roots → error
 * positions are inverses of those roots → flip received bits at those
 * positions. Since we're binary (errors are ±1 mod 2 = just flips),
 * we don't need a separate error-value step (no Forney).
 *
 * Determinism
 * -----------
 * No randomness, no time-dependent state, no floats. Generator
 * polynomials are computed once at module load from the field's
 * cyclotomic cosets — byte-identical across runtimes.
 *
 * References
 * ----------
 *  - Lin & Costello, "Error Control Coding", 2nd ed., Ch. 6.
 *  - https://en.wikipedia.org/wiki/BCH_code
 *  - https://en.wikipedia.org/wiki/Berlekamp%E2%80%93Massey_algorithm
 */

import { GF, GF128, GF256 } from "./gf";

// ── Parameters ───────────────────────────────────────────────────

export interface BchParams {
  /** Codeword length (n). */
  readonly n: number;
  /** Data length (k). */
  readonly k: number;
  /** Designed error-correction capability (t). */
  readonly t: number;
  /** Generator polynomial as bit array, low-order first (`g[0]` = x^0 coefficient). */
  readonly generator: ReadonlyArray<number>;
  /** Underlying field. */
  readonly gf: GF;
}

const _cache = new Map<string, BchParams>();

/**
 * Build (or fetch from cache) BCH parameters for the given (gf, t).
 *
 * Computes the generator polynomial `g(x) = LCM(minPoly(α^1),
 * minPoly(α^3), ..., minPoly(α^(2t-1)))` over GF(2). The degree of
 * `g(x)` determines `n - k`, hence `k`.
 *
 * Throws when the resulting k ≤ 0 (t is too large for the chosen field).
 */
export function buildBch(gf: GF, t: number): BchParams {
  if (t < 1) throw new Error(`buildBch: t must be ≥ 1, got ${t}`);
  const key = `${gf.m}|${t}`;
  const hit = _cache.get(key);
  if (hit) return hit;

  // Walk odd indices in [1, 2t-1]; each contributes the minimal poly
  // of α^i provided we haven't already covered its cyclotomic coset.
  //
  // We cap i at n-1: any i ≥ n is equivalent (mod n) to a smaller
  // index already visited, OR — when i ≡ 0 mod n — to α^0 = 1, whose
  // cyclotomic class is {0} alone (a singleton with no orbit walk).
  // Capping also short-circuits the orbit walk's infinite-loop
  // condition (v = 0, 0, 0, … never equals i again).
  const usedCosets = new Set<number>();
  let g: number[] = [1];
  for (let i = 1; i <= 2 * t - 1 && i < gf.n; i += 2) {
    // Coset representative = smallest j in the orbit i → 2i → 4i …
    let rep = i;
    let v = (i * 2) % gf.n;
    while (v !== i) {
      if (v < rep) rep = v;
      v = (v * 2) % gf.n;
    }
    if (usedCosets.has(rep)) continue;
    usedCosets.add(rep);
    g = polyMulBinary(g, minimalPoly(gf, i));
  }

  const n = gf.n;
  const k = n - (g.length - 1);
  if (k <= 0) {
    throw new Error(
      `buildBch: t=${t} too large for GF(2^${gf.m}); generator degree ${g.length - 1} exceeds n=${n}`,
    );
  }
  const params: BchParams = { n, k, t, generator: g, gf };
  _cache.set(key, params);
  return params;
}

/**
 * Minimal polynomial of α^s over GF(2), returned as bit array
 * (low-order first). Computed by taking the conjugate roots
 * α^s, α^(2s), α^(4s), … (the cyclotomic coset of s mod n) and
 * multiplying out (x - α^(s·2^j)) for each.
 */
function minimalPoly(gf: GF, s: number): number[] {
  // Polynomial coefficients live in GF(2^m); we'll verify at the end
  // that they reduce to GF(2).
  let poly: number[] = [1];
  let v = s;
  const seen = new Set<number>();
  while (!seen.has(v)) {
    seen.add(v);
    const root = gf.exp[v]!;
    // Multiply poly by (x + root) over GF(2^m). (x + root) since
    // addition in characteristic 2 is its own inverse.
    const next: number[] = new Array(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i += 1) {
      next[i] = gf.add(next[i]!, gf.mul(poly[i]!, root));
      next[i + 1] = gf.add(next[i + 1]!, poly[i]!);
    }
    poly = next;
    v = (v * 2) % gf.n;
  }
  // Reduce: every coefficient must be 0 or 1.
  for (const c of poly) {
    if (c !== 0 && c !== 1) {
      throw new Error(
        `minimalPoly(α^${s}): non-binary coefficient ${c} — corrupt cyclotomic coset`,
      );
    }
  }
  return poly;
}

/** Multiply two GF(2) polynomials. Inputs/output low-order first. */
function polyMulBinary(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number[] {
  const out: number[] = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    if (!a[i]) continue;
    for (let j = 0; j < b.length; j += 1) {
      if (b[j]) out[i + j] ^= 1;
    }
  }
  return out;
}

// ── Pre-built parameter sets ─────────────────────────────────────

/** BCH(127, 36, t=15) for id32 mode. */
export const BCH_127_15 = buildBch(GF128, 15);

/** BCH(255, 18) for uuid128 mode. */
export const BCH_255_18 = buildBch(GF256, 18);

// ── Encode ───────────────────────────────────────────────────────

/**
 * Encode `k` data bits into an `n`-bit systematic BCH codeword.
 *
 * `data` length must equal `params.k`. Returns a new bit array of
 * length `params.n`. Layout:
 *
 *   codeword[0..k-1]   = data (verbatim)
 *   codeword[k..n-1]   = parity (computed)
 *
 * Determinism: pure function of (data, params).
 */
export function encodeBCH(params: BchParams, data: ReadonlyArray<number>): number[] {
  if (data.length !== params.k) {
    throw new Error(
      `encodeBCH: expected ${params.k} data bits, got ${data.length}`,
    );
  }
  const n = params.n;
  const k = params.k;
  const nMinusK = n - k;
  const g = params.generator;
  // Systematic encoding:
  //   m(x) = data, regarded as a polynomial of degree < k
  //   shifted(x) = m(x) * x^(n-k)
  //   parity(x)  = shifted(x) mod g(x)
  //   c(x)       = shifted(x) + parity(x)
  //              = [data | parity]  (systematic form)
  //
  // We implement the long division as a shift register clocked once
  // per data bit. Bit ordering: data[0] is the *highest-order* bit
  // of m(x) (degree k-1), data[k-1] is the constant term. This
  // matches the bit-array convention documented at top of file.
  //
  // Generator coefficients are indexed low-order first in `g`, so
  // g[n-k] is the leading coefficient (always 1).
  const reg: number[] = new Array(nMinusK).fill(0);
  for (let i = 0; i < k; i += 1) {
    const feedback = data[i]! ^ reg[nMinusK - 1]!;
    for (let j = nMinusK - 1; j > 0; j -= 1) {
      reg[j] = reg[j - 1]! ^ (feedback & g[j]!);
    }
    reg[0] = feedback & g[0]!;
  }
  // Parity is now in reg, but with reg[0] being the lowest-order
  // coefficient of the remainder. The systematic codeword places
  // parity highest-order first after the data block, so we reverse.
  const codeword: number[] = new Array(n);
  for (let i = 0; i < k; i += 1) codeword[i] = data[i]!;
  for (let i = 0; i < nMinusK; i += 1) codeword[k + i] = reg[nMinusK - 1 - i]!;
  return codeword;
}

// ── Decode ───────────────────────────────────────────────────────

/** Result of a decode attempt. */
export interface BchDecodeResult {
  /** True iff decoding produced a codeword consistent with the syndromes. */
  ok: boolean;
  /** The recovered data (`k` bits). Undefined on failure. */
  data?: number[];
  /** Bit positions (0..n-1) where errors were corrected. */
  errorPositions: number[];
}

/**
 * Decode an `n`-bit received word back to `k` data bits.
 *
 * Pipeline:
 *  1. Syndromes S_1 … S_{2t} in GF(2^m). If all zero, no errors.
 *  2. Berlekamp-Massey → error locator σ(x).
 *  3. Chien search → roots of σ(x) → error positions.
 *  4. Flip bits at those positions. Re-check syndromes to validate.
 *
 * Beyond-capacity behavior: when more than `t` errors are present,
 * decode usually fails gracefully (ok=false). It cannot, in general,
 * detect every uncorrectable case — codes have a "decoder failure
 * domain" — but it will never silently return wrong data without
 * matching syndromes. Callers should validate the recovered payload
 * against an independent check (CRC, expected value) when survival
 * margin matters.
 */
export function decodeBCH(
  params: BchParams,
  received: ReadonlyArray<number>,
): BchDecodeResult {
  if (received.length !== params.n) {
    throw new Error(
      `decodeBCH: expected ${params.n} bits, got ${received.length}`,
    );
  }
  const { n, k, t, gf } = params;
  const twoT = 2 * t;

  // ── 1) Syndromes ──────────────────────────────────────────────
  //
  // Codeword convention: codeword[i] is the coefficient of
  // x^(n-1-i). For BCH the parity-check polynomial roots are α^1,
  // α^2, ..., α^(2t). Syndrome S_i = R(α^i) for received polynomial
  // R.
  const syndromes: number[] = new Array(twoT + 1).fill(0);
  let anyNonzero = false;
  for (let i = 1; i <= twoT; i += 1) {
    let s = 0;
    for (let j = 0; j < n; j += 1) {
      if (received[j]) {
        // term = (α^i)^(n-1-j) = α^(i*(n-1-j))
        const exp = (i * (n - 1 - j)) % gf.n;
        s ^= gf.exp[exp]!;
      }
    }
    syndromes[i] = s;
    if (s !== 0) anyNonzero = true;
  }
  if (!anyNonzero) {
    return { ok: true, data: received.slice(0, k), errorPositions: [] };
  }

  // ── 2) Berlekamp-Massey: find σ(x) ────────────────────────────
  //
  // σ(x) is the connection polynomial of the shortest LFSR that
  // generates the syndrome sequence. Standard Massey iteration.
  let sigma: number[] = [1]; // current
  let prevSigma: number[] = [1]; // last σ before length change
  let l = 0; // current LFSR length
  let m = 1; // distance since last length change
  let prevDiscrepancy = 1; // last nonzero discrepancy

  for (let nIter = 0; nIter < twoT; nIter += 1) {
    // Discrepancy at step nIter: d = S_{nIter+1} + Σ sigma[j] * S_{nIter+1-j}, j=1..l
    let d = syndromes[nIter + 1]!;
    for (let j = 1; j <= l; j += 1) {
      d ^= gf.mul(sigma[j]!, syndromes[nIter + 1 - j]!);
    }
    if (d === 0) {
      m += 1;
    } else if (2 * l <= nIter) {
      // Save old sigma, then update
      const t_poly = sigma.slice();
      const coeff = gf.div(d, prevDiscrepancy);
      // sigma <- sigma + coeff * x^m * prevSigma
      const shifted = new Array(m + prevSigma.length).fill(0);
      for (let i = 0; i < prevSigma.length; i += 1) {
        shifted[i + m] = gf.mul(prevSigma[i]!, coeff);
      }
      const next: number[] = new Array(Math.max(sigma.length, shifted.length)).fill(0);
      for (let i = 0; i < sigma.length; i += 1) next[i] = sigma[i]!;
      for (let i = 0; i < shifted.length; i += 1) next[i] = gf.add(next[i]!, shifted[i]);
      sigma = next;
      l = nIter + 1 - l;
      prevSigma = t_poly;
      prevDiscrepancy = d;
      m = 1;
    } else {
      const coeff = gf.div(d, prevDiscrepancy);
      const shifted = new Array(m + prevSigma.length).fill(0);
      for (let i = 0; i < prevSigma.length; i += 1) {
        shifted[i + m] = gf.mul(prevSigma[i]!, coeff);
      }
      const next: number[] = new Array(Math.max(sigma.length, shifted.length)).fill(0);
      for (let i = 0; i < sigma.length; i += 1) next[i] = sigma[i]!;
      for (let i = 0; i < shifted.length; i += 1) next[i] = gf.add(next[i]!, shifted[i]);
      sigma = next;
      m += 1;
    }
  }

  // Trim trailing zeros
  while (sigma.length > 1 && sigma[sigma.length - 1] === 0) sigma.pop();

  const sigmaDeg = sigma.length - 1;
  if (sigmaDeg === 0 || sigmaDeg > t) {
    // No or too-many indicated errors — uncorrectable.
    return { ok: false, errorPositions: [] };
  }

  // ── 3) Chien search: roots of σ(x) ────────────────────────────
  //
  // σ(x) is the connection polynomial: roots are at x = 1/X_j where
  // X_j = α^(p_j) is the locator for error at polynomial position
  // p_j. So σ(α^k) = 0 ⇔ α^k = α^(-p_j) ⇔ p_j = (n - k) mod n.
  //
  // Codeword bit `received[i]` is the coefficient of x^(n-1-i), so
  // the bit-array index of an error at polynomial position p is
  // (n - 1 - p). Substituting p = (n - k) mod n:
  //   bit-idx = (n - 1 - (n - k) mod n) = (k - 1 + n) mod n.
  const errorPositions: number[] = [];
  for (let k0 = 0; k0 < n; k0 += 1) {
    let val = sigma[0]!;
    for (let j = 1; j <= sigmaDeg; j += 1) {
      val = gf.add(val, gf.mul(sigma[j]!, gf.exp[(k0 * j) % gf.n]!));
    }
    if (val === 0) {
      const pos = (k0 - 1 + n) % n;
      errorPositions.push(pos);
    }
  }

  if (errorPositions.length !== sigmaDeg) {
    // Polynomial didn't fully factor in GF(2^m) — uncorrectable.
    return { ok: false, errorPositions: [] };
  }

  // ── 4) Apply corrections ──────────────────────────────────────
  const corrected = received.slice();
  for (const p of errorPositions) corrected[p] ^= 1;

  // Verify syndromes are now zero. If a bit was flipped but the
  // syndromes still indicate error, we ran into the decoder failure
  // domain (too many errors). Signal failure rather than return bad
  // data.
  for (let i = 1; i <= twoT; i += 1) {
    let s = 0;
    for (let j = 0; j < n; j += 1) {
      if (corrected[j]) {
        s ^= gf.exp[(i * (n - 1 - j)) % gf.n]!;
      }
    }
    if (s !== 0) {
      return { ok: false, errorPositions };
    }
  }

  return { ok: true, data: corrected.slice(0, k), errorPositions };
}
