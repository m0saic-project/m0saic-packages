import { weightedSplit } from "@m0saic/dsl-stdlib";

import { checkLayoutFloors, computeLayoutFloors, describeLayoutFloorCheck, layoutFloorDiagnostic } from "./layoutFloors";

// A 2-frame row split on a 1000-slot literal basis: feasible at a few px,
// but its precision floor is 1000px tall — the shape a slider-scaled
// weightedSplit produced in the wild (1303 slots, a prime, no GCD relief).
const TALL = String(weightedSplit([1, 999], "row", { mode: "literal", claimants: ["1", "1"] }));
const FINE = "2[1,1]";

describe("layout floors — the one computation behind 'below the safe minimum'", () => {
  it("reads both floors off the m0 and folds them into safeMin per axis", () => {
    const f = computeLayoutFloors(TALL)!;
    expect(f.precision.height).toBe(1000);
    expect(f.feasibility.height).toBeLessThan(f.precision.height); // the floors are independent
    expect(f.safeMin.height).toBe(1000);
    expect(f.safeMin.width).toBe(Math.max(f.feasibility.width, f.precision.width));
  });

  it("returns null for a string that is not m0 — never throws", () => {
    expect(computeLayoutFloors("not m0")).toBeNull();
    expect(checkLayoutFloors("", { width: 10, height: 10 })).toBeNull();
    expect(layoutFloorDiagnostic("2[1,", { width: 10, height: 10 })).toBeNull();
  });

  it("flags the axis that is below, and whether cells are culled (feasibility) or only squashed (precision)", () => {
    const squashed = checkLayoutFloors(TALL, { width: 1280, height: 720 })!;
    expect(squashed.below).toBe(true);
    expect(squashed.axes).toEqual(["height"]);
    expect(squashed.culls).toBe(false);

    const culled = checkLayoutFloors(TALL, { width: 1280, height: 2 })!;
    expect(culled.below).toBe(true);
    expect(culled.culls).toBe(true);

    const clear = checkLayoutFloors(TALL, { width: 1280, height: 1000 })!;
    expect(clear.below).toBe(false);
    expect(clear.axes).toEqual([]);
  });

  it("emits ONE warning diagnostic when below, and nothing when the canvas clears the floor", () => {
    const d = layoutFloorDiagnostic(TALL, { width: 1280, height: 720 })!;
    expect(d).toMatchObject({ code: "LAYOUT_BELOW_SAFE_MIN", severity: "warning" });
    expect(d.message).toContain("1280×720");
    expect(d.message).toContain("safe minimum of");
    expect(d.message).toContain("×1000");
    expect(d.message).toMatch(/squashed or dropped/);
    expect(layoutFloorDiagnostic(FINE, { width: 16, height: 16 })).toBeNull();
    expect(layoutFloorDiagnostic(TALL, { width: 1280, height: 1000 })).toBeNull();
  });

  it("wording matches the editor's chip and says when content is actually missing", () => {
    const culled = describeLayoutFloorCheck(checkLayoutFloors(TALL, { width: 1280, height: 2 })!);
    expect(culled).toMatch(/culled — content is missing/);
    const squashed = describeLayoutFloorCheck(checkLayoutFloors(TALL, { width: 1280, height: 720 })!);
    expect(squashed).toMatch(/It still renders/);
  });
});
