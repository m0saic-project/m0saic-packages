import { coverAchievable, enumerateCandidates, unitAspectTargets } from "./candidates";
import { fittingSpans } from "./classify";

/** The seed collage's mix: 34 landscape, 14 portrait, 1 square. */
const seedMix = (): number[] => [
  ...Array.from({ length: 34 }, (_, i) => 1.2 + (i % 7) * 0.1),
  ...Array.from({ length: 14 }, (_, i) => 0.55 + (i % 5) * 0.05),
  1.0,
];

describe("unitAspectTargets", () => {
  it("derives landscape median + portrait-fit targets from the mix", () => {
    const t = unitAspectTargets(seedMix());
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t[0]).toBeGreaterThan(1.15); // landscape median
    expect(t.some((u) => u < 1.5 && u > 0.9)).toBe(true); // portrait-fit ≈ 2·0.65
  });
  it("adds a square target when squares dominate", () => {
    const t = unitAspectTargets([1, 1.02, 0.98, 1.6, 0.5]);
    expect(t.some((u) => Math.abs(u - 1) < 0.05)).toBe(true);
  });
  it("defaults to the seed's 1.27 with no landscape images", () => {
    expect(unitAspectTargets([0.6, 0.7])[0]).toBeCloseTo(1.27, 2);
  });
});

describe("coverAchievable — exact-cover area feasibility", () => {
  const full = fittingSpans(11, 9); // areas {1,2,3,4,6}
  it("accepts [N, 6N] except the 6N−1 parity gap", () => {
    expect(coverAchievable(10, 10, full)).toBe(true);
    expect(coverAchievable(10, 60, full)).toBe(true);
    expect(coverAchievable(10, 59, full)).toBe(false); // 6N−1
    expect(coverAchievable(10, 58, full)).toBe(true); //  (N−1)·6 + 4
    expect(coverAchievable(10, 9, full)).toBe(false); //  < N
    expect(coverAchievable(10, 61, full)).toBe(false); // > 6N
  });
  it("handles lattice-limited menus ({1,2,4} has a 4N−1 gap)", () => {
    const menu22 = fittingSpans(2, 2); // 1x1, 2x1, 1x2, 2x2 → areas {1,2,4}
    expect(coverAchievable(3, 11, menu22)).toBe(false); // 4N−1
    expect(coverAchievable(3, 10, menu22)).toBe(true);
    expect(coverAchievable(3, 12, menu22)).toBe(true);
  });
  it("degenerate 1×1-only menu is exact-count only", () => {
    const menu11 = fittingSpans(1, 1);
    expect(coverAchievable(4, 4, menu11)).toBe(true);
    expect(coverAchievable(4, 5, menu11)).toBe(false);
  });
});

describe("enumerateCandidates", () => {
  const base = {
    canvasW: 1920, canvasH: 1280, gutterXPx: 20, gutterYPx: 18, marginPx: 20,
    minCellPx: 100, maxCellPx: 260, aspects: seedMix(), count: 49,
  };

  it("finds the seed's 11×9 neighborhood for the seed mix", () => {
    const cands = enumerateCandidates(base);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.length).toBeLessThanOrEqual(64);
    expect(
      cands.some((c) => Math.abs(c.cols - 11) <= 2 && Math.abs(c.rows - 9) <= 2),
    ).toBe(true);
    // Every candidate respects the invariants the tiler relies on.
    for (const c of cands) {
      expect(c.cols * c.rows).toBeGreaterThanOrEqual(49);
      expect(c.cols * c.rows).toBeLessThanOrEqual(6 * 49);
      expect(c.cols * c.rows).not.toBe(6 * 49 - 1);
      const scale = Math.sqrt(c.unitW * c.unitH);
      expect(scale).toBeGreaterThanOrEqual(100);
      expect(scale).toBeLessThanOrEqual(260);
    }
  });

  it("orders by pre-score and is deterministic", () => {
    const a = enumerateCandidates(base);
    const b = enumerateCandidates(base);
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) expect(a[i].preScore).toBeGreaterThanOrEqual(a[i - 1].preScore);
  });

  it("honors maxCandidates and supports tiny N", () => {
    expect(enumerateCandidates({ ...base, maxCandidates: 5 }).length).toBeLessThanOrEqual(5);
    const one = enumerateCandidates({
      ...base, count: 1, aspects: [1.5], minCellPx: 300, maxCellPx: 2000,
    });
    expect(one.length).toBeGreaterThan(0);
    expect(one[0].cols * one[0].rows).toBeLessThanOrEqual(6);
  });

  it("fail-fast validation", () => {
    // aspects may EXCEED count (uniform paging passes the full mix with a
    // per-page count) but never undershoot it.
    expect(() => enumerateCandidates({ ...base, count: 50 })).toThrow(/aspects\.length/);
    expect(enumerateCandidates({ ...base, count: 20 }).length).toBeGreaterThan(0);
    expect(() => enumerateCandidates({ ...base, count: 0, aspects: [] })).toThrow(/count/);
    expect(() => enumerateCandidates({ ...base, minCellPx: 0 })).toThrow(/bounds/);
  });
});
