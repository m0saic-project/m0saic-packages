import { parseM0StringToLogicalFrames } from "@m0saic/dsl";
import { computeLayoutRegions, type LayoutLabelMap } from "./useLayoutRegions";

const W = 100;
const H = 100;
// Two stacked rows → frame 0 = top half, frame 1 = bottom half.
const M0 = "2[1,1]";

function stableKeys(): string[] {
  return parseM0StringToLogicalFrames(M0, W, H).map((f) => f.meta.stableKey as string);
}

describe("computeLayoutRegions", () => {
  test("joins labels to rendered rects by stableKey, keyed by label text", () => {
    const [topKey, bottomKey] = stableKeys();
    const labels: LayoutLabelMap = {
      [topKey]: { text: "top" },
      [bottomKey]: { text: "bottom" },
    };
    const regions = computeLayoutRegions(M0, W, H, labels);

    expect(regions.size).toBe(2);
    expect(regions.get("top")).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(regions.get("bottom")).toEqual({ x: 0, y: 50, width: 100, height: 50 });
  });

  test("accepts bare-string labels", () => {
    const [topKey] = stableKeys();
    const regions = computeLayoutRegions(M0, W, H, { [topKey]: "hero" });
    expect(regions.get("hero")).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  test("skips labels whose stableKey does not resolve", () => {
    const [topKey] = stableKeys();
    const regions = computeLayoutRegions(M0, W, H, {
      [topKey]: "top",
      "r/does/not/exist": "ghost",
    });
    expect(regions.has("top")).toBe(true);
    expect(regions.has("ghost")).toBe(false);
    expect(regions.size).toBe(1);
  });

  test("skips empty label text", () => {
    const [topKey, bottomKey] = stableKeys();
    const regions = computeLayoutRegions(M0, W, H, {
      [topKey]: { text: "" },
      [bottomKey]: { text: "  " },
    });
    expect(regions.size).toBe(0);
  });
});
