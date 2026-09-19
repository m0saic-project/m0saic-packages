import {
  latticeAxisTier,
  latticeMaxSlots,
  snapEdgesToLattice,
  snapPxToLatticeFriendly,
} from "./latticeSnap";

describe("latticeMaxSlots", () => {
  it("small axes (≤ basis) report themselves — exact is already cheap", () => {
    expect(latticeMaxSlots(96)).toBe(96);
    expect(latticeMaxSlots(120)).toBe(120);
  });

  it("finds the finest usable divisor lattice", () => {
    expect(latticeMaxSlots(1568)).toBe(112); // 2^5·7^2, pitch 14
    expect(latticeMaxSlots(2244)).toBe(102); // 2^2·3·11·17, pitch 22
  });

  it("a prime axis above the basis collapses to a single giant cell", () => {
    expect(latticeMaxSlots(3307)).toBe(1); // prime — dvd-wrap's canvas width
    expect(latticeMaxSlots(1571)).toBe(1); // prime — dvd-wrap's panel width
  });
});

describe("latticeAxisTier", () => {
  it("tiers the dvd-wrap axes as diagnosed", () => {
    expect(latticeAxisTier(3307)).toBe(0); // hostile
    expect(latticeAxisTier(1571)).toBe(0); // hostile
    expect(latticeAxisTier(2244)).toBe(2); // healthy height
    expect(latticeAxisTier(96)).toBe(2); // small = cheap exact
  });
});

describe("snapPxToLatticeFriendly", () => {
  it("never moves an already-excellent length", () => {
    expect(snapPxToLatticeFriendly(2244)).toBe(2244);
    expect(snapPxToLatticeFriendly(96)).toBe(96);
    expect(snapPxToLatticeFriendly(1568)).toBe(1568);
  });

  it("rescues prime axes within tolerance", () => {
    expect(snapPxToLatticeFriendly(3307)).toBe(3306); // 2·3·19·29 → 114 slots
    expect(snapPxToLatticeFriendly(1571)).toBe(1568); // 2^5·7^2 → 112 slots
  });

  it("respects the tolerance window", () => {
    // tolerance 0 = identity, even for a hostile value
    expect(snapPxToLatticeFriendly(3307, { tolerancePx: 0 })).toBe(3307);
  });

  it("is deterministic", () => {
    for (const n of [977, 1571, 3307, 452, 659]) {
      expect(snapPxToLatticeFriendly(n)).toBe(snapPxToLatticeFriendly(n));
    }
  });
});

describe("snapEdgesToLattice", () => {
  it("solves the dvd-wrap breakpoint set — every span becomes lattice-friendly", () => {
    // back seam, front seam, canvas: spans were [1571, 165, 1571] + total 3307.
    const [b1, b2, w] = snapEdgesToLattice([1571, 1736, 3307]);
    const spans = [b1, b2 - b1, w - b2, w];
    for (const s of spans) {
      expect(latticeAxisTier(s)).toBeGreaterThanOrEqual(1);
    }
    // The two panel axes and the canvas must be fully rescued (they were the
    // 96% of the DSL bill); the narrow spine span is allowed tier 1.
    expect(latticeAxisTier(b1)).toBe(2);
    expect(latticeAxisTier(w - b2)).toBe(2);
    expect(latticeAxisTier(w)).toBe(2);
    // Nothing moved more than the default tolerance.
    expect(Math.abs(b1 - 1571)).toBeLessThanOrEqual(3);
    expect(Math.abs(b2 - 1736)).toBeLessThanOrEqual(3);
    expect(Math.abs(w - 3307)).toBeLessThanOrEqual(3);
    // Still a valid ascending breakpoint chain.
    expect(b1).toBeLessThan(b2);
    expect(b2).toBeLessThan(w);
  });

  it("leaves an already-excellent chain untouched", () => {
    // 960 | 1920 → spans [960, 960, 1920] — all divisor-rich.
    expect(snapEdgesToLattice([960, 1920])).toEqual([960, 1920]);
  });

  it("is deterministic", () => {
    expect(snapEdgesToLattice([1571, 1736, 3307])).toEqual(
      snapEdgesToLattice([1571, 1736, 3307]),
    );
  });

  it("rejects malformed input", () => {
    expect(() => snapEdgesToLattice([10, 10])).toThrow(/ascending/);
    expect(() => snapEdgesToLattice([1, 2, 3, 4, 5, 6])).toThrow(/at most 5/);
  });
});
