import { SPAN_CLASSES, SPAN_MENU, classifySpans, cropCost, fittingSpans, spanArea, spanVisibleAspect } from "./classify";
import type { SpanClass } from "./types";

describe("cropCost — cover-fit area loss", () => {
  it("is exact at the budget boundary", () => {
    // a=0.5 into A=0.714…: kept = 0.5/0.7142857 = 0.7 → cost 0.3 exactly.
    expect(cropCost(0.5, 0.5 / 0.7)).toBeCloseTo(0.3, 10);
  });
  it("is symmetric and zero at a perfect match", () => {
    expect(cropCost(1.5, 1.5)).toBe(0);
    expect(cropCost(2, 1)).toBeCloseTo(cropCost(1, 2), 12);
  });
  it("degrades to 1 on invalid aspects", () => {
    expect(cropCost(0, 1)).toBe(1);
    expect(cropCost(1, -2)).toBe(1);
  });
});

describe("span menu", () => {
  it("areas are {1,2,3,4,6} — no 5 (the parity gap the planner must respect)", () => {
    const areas = [...new Set(SPAN_CLASSES.map(spanArea))].sort((a, b) => a - b);
    expect(areas).toEqual([1, 2, 3, 4, 6]);
  });
  it("fittingSpans respects lattice dims", () => {
    expect(fittingSpans(1, 1)).toEqual(["1x1"]);
    expect(fittingSpans(1, 3)).toEqual(["1x1", "1x2", "1x3"]);
    expect(fittingSpans(4, 1)).toEqual(["1x1", "2x1", "3x1", "4x1"]);
    expect(fittingSpans(11, 9)).toEqual([...SPAN_CLASSES]);
  });
  it("visible aspect includes shared gutters (2×2 ≈ unit aspect)", () => {
    // Seed numbers: unit ≈154.4×121, gutters 20/17.5 → A(1x1)=1.276, A(2x2)≈1.27.
    const a11 = spanVisibleAspect("1x1", 154.4, 121, 20, 17.5);
    const a22 = spanVisibleAspect("2x2", 154.4, 121, 20, 17.5);
    expect(a11).toBeCloseTo(1.276, 2);
    expect(a22).toBeCloseTo(1.27, 2);
    expect(spanVisibleAspect("1x2", 154.4, 121, 20, 17.5)).toBeCloseTo(0.595, 2);
    expect(spanVisibleAspect("2x1", 154.4, 121, 20, 17.5)).toBeCloseTo(2.72, 2);
  });
});

describe("classifySpans", () => {
  const visible: Partial<Record<SpanClass, number>> = {
    "1x1": 1.28, "2x1": 2.72, "3x1": 4.2, "4x1": 5.7,
    "1x2": 0.59, "2x2": 1.27, "3x2": 2.0, "1x3": 0.38,
  };

  it("sorts by cost with area tie-break (never a bigger cell for free)", () => {
    const [m] = classifySpans([1.27], visible, 0.3);
    // 2x2 (cost ~0.008) vs 1x1 (cost ~0.008): near-tie — 1x1 must come first
    // when costs are exactly equal; here 2x2 is exact so it wins on cost.
    expect(m.options[0].span).toBe("2x2");
    expect(m.options[1].span).toBe("1x1");
    const equalTie = classifySpans([1.0], { "1x1": 2, "2x2": 2 }, 0.9)[0];
    expect(equalTie.options[0].span).toBe("1x1"); // same cost → smaller area first
  });

  it("portraits route to 1x2; panoramas to wide spans", () => {
    const [portrait] = classifySpans([0.6], visible, 0.3);
    expect(portrait.options[0].span).toBe("1x2");
    const [pano] = classifySpans([4.0], visible, 0.3);
    expect(["3x1", "4x1"]).toContain(pano.options[0].span);
  });

  it("withinBudget counts the soft-budget menu; extreme aspects flag bestEffort (0)", () => {
    const [m] = classifySpans([1.27], visible, 0.3);
    expect(m.withinBudget).toBeGreaterThanOrEqual(2); // 1x1 + 2x2 at least
    const [extreme] = classifySpans([12], visible, 0.3);
    expect(extreme.withinBudget).toBe(0); // nothing within 30% — best-effort
    expect(extreme.options.length).toBeGreaterThan(0); // but the menu is never empty
  });

  it("fail-fast on invalid aspects", () => {
    expect(() => classifySpans([NaN], visible, 0.3)).toThrow(/aspects\[0\]/);
    expect(() => classifySpans([1, -0.5], visible, 0.3)).toThrow(/aspects\[1\]/);
  });
});
