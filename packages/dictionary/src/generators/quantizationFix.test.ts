import { forceQuantizationFree, applyForceQuantizationFree } from "./quantizationFix";
import { grid } from "./grid";
import { comparisonGenerator } from "./comparisonGenerator";
import { rankedListGenerator } from "./rankedListGenerator";
import { spotlightGenerator } from "./spotlightGenerator";
import { magazineGenerator } from "./magazineGenerator";
import { goldenLayoutGenerator } from "./goldenLayout";
import { quantizationSpread, compareM0 } from "@m0saic/dsl-stdlib";

describe("forceQuantizationFree helper", () => {
  test("makes a spread-prone grid exact at the target canvas", () => {
    const portable = grid({ rows: 3, columns: 7 }).m0; // 7 cols rarely divides evenly
    const target = { width: 1003, height: 717 }; // deliberately odd
    const before = quantizationSpread(portable, target.width, target.height).maxSpreadPx;
    const fixed = forceQuantizationFree(portable, target.width, target.height);
    const after = quantizationSpread(fixed.m0, target.width, target.height).maxSpreadPx;
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBe(0); // exact at the baked target
    expect(fixed.idealCanvas).toEqual(target);
  });

  test("applyForceQuantizationFree is a no-op when the toggle is off", () => {
    const m0 = grid({ rows: 2, columns: 2 }).m0;
    const r = applyForceQuantizationFree(m0, { forceQuantizationFree: false });
    expect(r.m0).toBe(m0);
    expect(r.idealCanvas).toBeUndefined();
  });
});

describe("grid generator — force quantization-free opt-in", () => {
  test("off (default): portable, no idealCanvas", () => {
    const r = grid({ rows: 3, columns: 7 });
    expect(r.idealCanvas).toBeUndefined();
  });

  test("on: returns idealCanvas and an exact layout at the target", () => {
    const target = { width: 1003, height: 717 };
    const r = grid({ rows: 3, columns: 7, forceQuantizationFree: true, targetW: target.width, targetH: target.height });
    expect(r.idealCanvas).toEqual(target);
    expect(quantizationSpread(r.m0, target.width, target.height).maxSpreadPx).toBe(0);
    expect(r.sourceCount).toBe(21);
  });

  test("compareM0: forced grid removes spread vs the portable one", () => {
    const target = { width: 1003, height: 717 };
    const portable = grid({ rows: 3, columns: 7 }).m0;
    const forced = grid({ rows: 3, columns: 7, forceQuantizationFree: true, targetW: target.width, targetH: target.height }).m0;
    const c = compareM0(portable, forced, target);
    const spread = c.metrics.find((m) => m.key === "worstSpreadPx")!;
    expect(spread.a).toBeGreaterThan(0); // portable spreads at this odd size
    expect(spread.b).toBe(0); // forced is exact
  });
});

describe("all first-batch generators expose a working opt-in", () => {
  const target = { width: 1003, height: 717 };
  const cases: Array<[string, (p: any) => { m0: string; idealCanvas?: any }]> = [
    ["comparison", (p) => comparisonGenerator({ pairs: 3, ...p })],
    ["ranked-list", (p) => rankedListGenerator({ count: 5, ...p })],
    ["spotlight", (p) => spotlightGenerator({ supportCount: 3, ...p })],
    ["magazine", (p) => magazineGenerator({ ...p })],
    ["golden-layout", (p) => goldenLayoutGenerator({ ...p })],
  ];
  test.each(cases)("%s: opt-in yields an exact layout + idealCanvas", (_label, gen) => {
    expect(gen({}).idealCanvas).toBeUndefined(); // off by default → portable
    const on = gen({ forceQuantizationFree: true, targetW: target.width, targetH: target.height });
    expect(on.idealCanvas).toEqual(target);
    expect(quantizationSpread(on.m0, target.width, target.height).maxSpreadPx).toBe(0);
  });
});
