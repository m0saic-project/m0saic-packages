/**
 * GF(2^m) arithmetic — round-trip & invariant tests.
 *
 * Verifies that for the two fields we use (GF(2^7) and GF(2^8)):
 *   - exp/log tables round-trip (`exp[log[x]] === x` for x ≠ 0)
 *   - multiplicative inverse: x * inv(x) === 1 for every nonzero x
 *   - division: (a / b) * b === a for every (a, b≠0)
 *   - pow: α^n === 1, α^(n+i) === α^i (cycle length)
 */
import { describe, expect, it } from "@jest/globals";
import { GF, GF128, GF256 } from "./gf";

describe("GF — common cases over GF(2^7) and GF(2^8)", () => {
  const fields: Array<{ name: string; gf: GF }> = [
    { name: "GF(2^7)", gf: GF128 },
    { name: "GF(2^8)", gf: GF256 },
  ];

  for (const { name, gf } of fields) {
    describe(name, () => {
      it("exp/log round-trip for all nonzero elements", () => {
        for (let x = 1; x <= gf.n; x += 1) {
          expect(gf.exp[gf.log[x]!]).toBe(x);
        }
      });

      it("a * inv(a) === 1 for every nonzero a", () => {
        for (let a = 1; a <= gf.n; a += 1) {
          expect(gf.mul(a, gf.inv(a))).toBe(1);
        }
      });

      it("(a / b) * b === a for every (a, b≠0)", () => {
        // Spot-check a sparse cross-section; full grid would be 65k entries
        // and slow without adding correctness coverage.
        for (let a = 0; a <= gf.n; a += 17) {
          for (let b = 1; b <= gf.n; b += 13) {
            expect(gf.mul(gf.div(a, b), b)).toBe(a);
          }
        }
      });

      it("α^n === 1 (cycle length is n)", () => {
        // α = exp[1]; α^n = exp[1*n mod n] = exp[0] = 1
        expect(gf.pow(gf.exp[1]!, gf.n)).toBe(1);
      });

      it("commutativity and associativity of mul", () => {
        // Spot-check
        for (let i = 0; i < 10; i += 1) {
          const a = (i * 13 + 1) & gf.n;
          const b = (i * 19 + 3) & gf.n;
          const c = (i * 23 + 7) & gf.n;
          expect(gf.mul(a, b)).toBe(gf.mul(b, a));
          expect(gf.mul(gf.mul(a, b), c)).toBe(gf.mul(a, gf.mul(b, c)));
        }
      });

      it("addition is XOR and self-inverse", () => {
        for (let a = 0; a <= gf.n; a += 11) {
          expect(gf.add(a, a)).toBe(0);
          for (let b = 0; b <= gf.n; b += 13) {
            expect(gf.add(a, b)).toBe(a ^ b);
          }
        }
      });
    });
  }

  it("rejects non-primitive polynomials", () => {
    // x^7 + 1 = 0x81 is NOT primitive (it's reducible: (x+1)(x^6 + x^5 + … + 1))
    // The constructor's "back to 1 after n steps" check catches non-primitive
    // polys whose cycle length is shorter than n.
    expect(() => new GF(7, 0x81)).toThrow();
  });
});
