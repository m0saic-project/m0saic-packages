import { weightedSplit } from "@m0saic/dsl-stdlib";
import { parseM0StringComplete } from "@m0saic/dsl";
import {
  FAMILY_BASIS_MENU,
  FAMILY_GCD,
  ceilToSmooth,
  divisors,
  factorize,
  floorToSmooth,
  formatFactors,
  gcd,
  isSmooth,
  latticePrecision,
  latticeWeights,
  lcm,
  lcmAll,
  nearestSmooth,
  quantizedSections,
  roughPart,
  smoothDivisors,
  snapSlot,
} from "./smooth";

describe("gcd / lcm", () => {
  it("gcd handles zero and order", () => {
    expect(gcd(12, 18)).toBe(6);
    expect(gcd(18, 12)).toBe(6);
    expect(gcd(0, 7)).toBe(7);
    expect(gcd(120, 121)).toBe(1);
  });

  it("lcm of the two corpus lattices is the measured median self-lattice", () => {
    expect(lcm(120, 121)).toBe(14520);
    expect(lcm(4, 6)).toBe(12);
    expect(lcm(0, 6)).toBe(0);
  });

  it("lcmAll folds a list, treats an empty list as 1, and bails to Infinity past the cap", () => {
    expect(lcmAll([])).toBe(1);
    expect(lcmAll([120, 121, 119])).toBe(1727880); // the hero/ffmpeg-pulse self-lattice
    expect(lcmAll([7, 9, 122, 238, 240, 241, 245, 1080, 1920])).toBe(211609722240); // theming/v1
    expect(lcmAll([1_000_003, 1_000_033, 1_000_037], 1e12)).toBe(Infinity);
    expect(() => lcmAll([0])).toThrow(RangeError);
  });
});

describe("roughPart / isSmooth", () => {
  it.each([
    [1, 1],
    [120, 1],
    [1920, 1],
    [1080, 1],
    [86400, 1],
    [121, 121],
    [119, 119],
    [14, 7],
    [68, 17],
    [259, 259],
    [2783, 2783],
    [9999, 1111],
    [499, 499],
  ])("roughPart(%i) = %i", (n, rough) => {
    expect(roughPart(n)).toBe(rough);
    expect(isSmooth(n)).toBe(rough === 1);
  });

  it("rejects non-positive or non-integer input", () => {
    expect(() => roughPart(0)).toThrow(RangeError);
    expect(() => roughPart(1.5)).toThrow(RangeError);
    expect(() => roughPart(-3)).toThrow(RangeError);
  });
});

describe("factorize / formatFactors", () => {
  it("factorises by trial division, ascending", () => {
    expect(factorize(1)).toEqual([]);
    expect(factorize(121)).toEqual([{ p: 11, e: 2 }]);
    expect(factorize(119)).toEqual([{ p: 7, e: 1 }, { p: 17, e: 1 }]);
    expect(factorize(1920)).toEqual([{ p: 2, e: 7 }, { p: 3, e: 1 }, { p: 5, e: 1 }]);
    expect(factorize(499)).toEqual([{ p: 499, e: 1 }]);
  });

  it("formats for humans", () => {
    expect(formatFactors(1)).toBe("1");
    expect(formatFactors(121)).toBe("11²");
    expect(formatFactors(119)).toBe("7·17");
    expect(formatFactors(1920)).toBe("2⁷·3·5");
    expect(formatFactors(2783)).toBe("11²·23");
  });
});

describe("divisors", () => {
  it("lists every divisor ascending, including squares", () => {
    expect(divisors(1)).toEqual([1]);
    expect(divisors(12)).toEqual([1, 2, 3, 4, 6, 12]);
    expect(divisors(36)).toEqual([1, 2, 3, 4, 6, 9, 12, 18, 36]);
    expect(divisors(121)).toEqual([1, 11, 121]);
  });

  it("the family menu is divisors(120) — sixteen values, all 5-smooth", () => {
    expect(FAMILY_GCD).toBe(120);
    expect(FAMILY_BASIS_MENU).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 60, 120]);
    expect(smoothDivisors(120)).toEqual([...FAMILY_BASIS_MENU]);
  });

  it("smoothDivisors drops the rough divisors of a rough axis", () => {
    expect(smoothDivisors(566)).toEqual([1, 2]); // 1.91:1 social — 566 = 2·283
    expect(smoothDivisors(1400)).toEqual([1, 2, 4, 5, 8, 10, 20, 25, 40, 50, 100, 200]); // 1400 = 2³·5²·7
  });
});

describe("ceilToSmooth / floorToSmooth", () => {
  it.each([
    [99, 100, 96],
    [101, 108, 100],
    [121, 125, 120],
    [119, 120, 108],
    [7, 8, 6],
    [1, 1, 1],
    [120, 120, 120],
    [4097, 4320, 4096],
    [1081, 1125, 1080],
  ])("around %i: ceil %i, floor %i", (n, ceil, floor) => {
    expect(ceilToSmooth(n)).toBe(ceil);
    expect(floorToSmooth(n)).toBe(floor);
    expect(isSmooth(ceilToSmooth(n))).toBe(true);
    expect(isSmooth(floorToSmooth(n))).toBe(true);
  });

  it("is exhaustive: no 5-smooth number lies strictly between n and its ceiling", () => {
    for (let n = 1; n <= 2000; n++) {
      const c = ceilToSmooth(n);
      for (let k = n; k < c; k++) expect(isSmooth(k)).toBe(false);
      const f = floorToSmooth(n);
      for (let k = f + 1; k <= n; k++) expect(isSmooth(k)).toBe(false);
    }
  });
});

describe("nearestSmooth / snapSlot — handing children 5-smooth slots", () => {
  it("leaves smooth sizes alone and moves rough ones to the nearest smooth integer", () => {
    expect(nearestSmooth(960)).toBe(960);
    expect(nearestSmooth(980)).toBe(972); // −8 beats +20
    expect(nearestSmooth(290)).toBe(288);
    expect(nearestSmooth(386)).toBe(384);
    expect(nearestSmooth(266)).toBe(270); // +4 beats −10
    expect(nearestSmooth(7)).toBe(8); // tie goes up
    expect(nearestSmooth(0)).toBe(0);
  });

  it("only grows when the cap allows it", () => {
    expect(nearestSmooth(266, 268)).toBe(256);
    expect(nearestSmooth(266, 270)).toBe(270);
  });

  it("snapSlot keeps the position and never leaves the canvas", () => {
    expect(snapSlot({ x: 140, y: 384, w: 980, h: 600 }, 1920, 1080)).toEqual({ x: 140, y: 384, w: 972, h: 600 });
    expect(snapSlot({ x: 1160, y: 384, w: 290, h: 288 }, 1920, 1080)).toEqual({ x: 1160, y: 384, w: 288, h: 288 });
    // 266 would grow to 270 but the canvas ends 268 px below y → shrink to 256 instead.
    expect(snapSlot({ x: 0, y: 812, w: 386, h: 266 }, 1920, 1080)).toEqual({ x: 0, y: 812, w: 384, h: 256 });
    const extra = snapSlot({ x: 1, y: 2, w: 290, h: 288, label: "rail" }, 1920, 1080);
    expect(extra.label).toBe("rail");
  });
});

describe("latticePrecision — the kit policy", () => {
  it("over the cap: exactly the cap (Hamilton), never per-weight rounding", () => {
    expect(latticePrecision([59, 1802, 59])).toBe(120);
    expect(latticePrecision([59, 1802, 59], { cap: 240 })).toBe(240);
  });

  it("under the cap: rough unequal pixel bands drift down to the nearest smooth basis ≤ their size", () => {
    expect(latticePrecision([5, 20, 10])).toBe(32); // 35 = 5·7 → 32
    expect(latticePrecision([3, 5, 44, 15, 15, 15, 3])).toBeUndefined(); // already 100 → smooth → keep
    expect(latticePrecision([8, 40, 6, 30, 8])).toBe(90); // 92 = 2²·23 → 90
    expect(latticePrecision([1, 112])).toBe(108); // 113 (prime) → 108
  });

  it("keeps smooth, tiny, and equal-weight splits as they are", () => {
    expect(latticePrecision([1, 2, 1])).toBeUndefined();
    expect(latticePrecision([30, 60, 30])).toBeUndefined(); // 120
    expect(latticePrecision([7])).toBeUndefined();
    expect(latticePrecision([1, 6])).toBeUndefined(); // 7 ≤ 12: content fill
    expect(latticePrecision(Array(13).fill(1))).toBeUndefined(); // 13 equal rows: content cardinality
    expect(latticePrecision(Array(7).fill(5))).toBeUndefined(); // 35 but equal → content
    expect(latticePrecision([6, 1, 6, 1, 6, 1, 6, 1, 6, 1, 6])).toBeUndefined(); // 41: six rows + gutters → content
    expect(latticePrecision([3, 2, 3, 2, 3])).toBeUndefined(); // 13: three dots + gaps → content
    expect(latticePrecision([6, 1, 6, 2, 6])).toBe(20); // unequal gutters: not a list pattern → 21 → 20
    expect(latticePrecision([])).toBeUndefined();
  });

  it("never asks for fewer slots than bands", () => {
    // 14 bands summing to 17: floorToSmooth(17) = 16 ≥ 14 → 16; 13 bands summing to 13 is equal → kept.
    expect(latticePrecision([...Array(13).fill(1), 4])).toBe(16);
    expect(latticePrecision([...Array(12).fill(1), 2])).toBeUndefined(); // 14 → floor 12 < 13 bands → keep
  });

  it("the boundary is the convention's small basis", () => {
    expect(latticePrecision([1, 12])).toBe(12); // 13 → 12 (2 bands)
    expect(latticePrecision([1, 12], { smallBasis: 13 })).toBeUndefined();
  });
});

describe("latticeWeights — structure-preserving rewrite for kits", () => {
  const total = (ws: number[]): number => ws.reduce((a, b) => a + b, 0);
  const reducedTotal = (ws: number[]): number => total(ws) / ws.reduce((g, w) => gcd(g, w), 0);

  it("leaves smooth, tiny and all-equal splits alone — judged after GCD reduction", () => {
    expect(latticeWeights([30, 60, 30])).toEqual([30, 60, 30]);
    expect(latticeWeights([1, 6])).toEqual([1, 6]);
    expect(latticeWeights(Array(13).fill(1))).toEqual(Array(13).fill(1));
    expect(latticeWeights([200, 600])).toEqual([200, 600]); // reduces to [1, 3]
    expect(latticeWeights([])).toEqual([]);
  });

  it("a symmetric inset stays symmetric on a smooth total at or under the cap", () => {
    const over = latticeWeights([59, 1802, 59]); // the alpine card inset at 1920×1080
    expect(over).toEqual([4, 112, 4]); // Hamilton to exactly 120 → GCD → [1, 28, 1]
    const r = latticeWeights([1, 11, 1]); // 13 → 12
    expect(r[0]).toBe(r[2]);
    expect(isSmooth(total(r))).toBe(true);
    expect(total(r)).toBeLessThanOrEqual(13);
    const s = latticeWeights([15, 73, 15]); // 103 (prime)
    expect(s[0]).toBe(s[2]);
    expect(isSmooth(reducedTotal(s))).toBe(true);
    expect(total(s)).toBeLessThanOrEqual(103);
  });

  it("proportional bands never end up with MORE slots than the author's GCD-reduced split", () => {
    const row = [8, 40, 6, 30, 8]; // 92 → the engine reduces to 46 (rough)
    const r = latticeWeights(row);
    expect(reducedTotal(r)).toBeLessThanOrEqual(46);
    expect(isSmooth(reducedTotal(r))).toBe(true);
    expect(r[0]).toBe(r[4]); // pads stay equal
    expect(Math.abs(r[1] / total(r) - 40 / 92)).toBeLessThan(0.02);
  });

  it("keeps every bar equal and every gap equal in an interleaved list", () => {
    const bars = [3, 20, 3, 20, 3, 20, 3, 20, 3, 20, 3]; // 118 = 2·59
    const r = latticeWeights(bars);
    expect(new Set(r.filter((_, i) => i % 2 === 0)).size).toBe(1);
    expect(new Set(r.filter((_, i) => i % 2 === 1)).size).toBe(1);
    expect(isSmooth(reducedTotal(r))).toBe(true);
    expect(total(r)).toBeLessThanOrEqual(118);
  });

  it("a tiny pixel inset may move by a pixel or two: [3, 8, 3] (14 px) → a symmetric 12", () => {
    const r = latticeWeights([3, 8, 3]);
    expect(r[0]).toBe(r[2]);
    expect(isSmooth(total(r))).toBe(true);
    expect(total(r)).toBeLessThanOrEqual(14);
  });

  it("a coarse rough basis moves by one slot: [72, 24, 56] px reduces to 19 → 18 slots", () => {
    const r = latticeWeights([72, 24, 56]); // gcd 8 → [9, 3, 7] = 19 (prime)
    expect(reducedTotal(r)).toBe(18);
    expect(r.every((w) => w >= 1)).toBe(true);
  });

  it("refuses to distort: six rows + gutters (41, prime) has no smooth rewrite within the drift budget", () => {
    const rows = [6, 1, 6, 1, 6, 1, 6, 1, 6, 1, 6];
    expect(latticeWeights(rows)).toEqual(rows);
  });

  it("Hamilton-scales plain pixel bands to the floor smooth total, within the drift budget", () => {
    expect(latticeWeights([5, 20, 10])).toEqual([5, 20, 10]); // 35 reduces to [1, 4, 2] = 7: small, kept
    const under = latticeWeights([5, 21, 9]); // 35, gcd 1, rough → 32
    expect(total(under)).toBe(32);
    expect(under.every((w) => w >= 1)).toBe(true);
    expect(latticeWeights([59, 1802, 40])).toEqual([4, 114, 2]); // quotas 3.72 · 113.75 · 2.52
  });

  it("never asks for more slots than pixels or than the cap", () => {
    for (const ws of [[3, 22, 3], [1, 112], [7, 40, 7, 40, 7], [59, 1802, 59], [44, 300, 44, 300, 44]]) {
      const r = latticeWeights(ws);
      expect(total(r)).toBeLessThanOrEqual(total(ws));
      expect(reducedTotal(r)).toBeLessThanOrEqual(Math.max(120, reducedTotal(ws)));
    }
  });
});

describe("quantizedSections — the engine's outside-in slot arithmetic, reproduced", () => {
  it("matches the parser's frames for a weighted split on a remainder-bearing axis", () => {
    for (const [total, weights, axis] of [
      [103, [1, 1, 1, 1], "col"],
      [912, [9, 2, 89], "col"],
      [960, [3, 114, 3], "col"],
      [1080, [22, 916, 22], "row"],
      [497, [5, 20, 10], "row"],
    ] as Array<[number, number[], "col" | "row"]>) {
      const m0 = String(weightedSplit(weights, axis));
      const W = axis === "col" ? total : 100;
      const H = axis === "row" ? total : 100;
      const parsed = parseM0StringComplete(m0, W, H);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const frames = parsed.ir.renderFrames.map((f) => Math.round(axis === "col" ? f.width : f.height));
      expect(quantizedSections(total, weights)).toEqual(frames);
    }
  });

  it("the handbook example: 4(1,1,1,1) on 103 px → [26, 26, 25, 26]", () => {
    expect(quantizedSections(103, [1, 1, 1, 1])).toEqual([26, 26, 25, 26]);
  });

  it("an edge section absorbs the remainder first — 9 of 100 slots on 912 px is 87, not 82", () => {
    expect(quantizedSections(912, [9, 2, 89])[0]).toBe(87);
  });
});
