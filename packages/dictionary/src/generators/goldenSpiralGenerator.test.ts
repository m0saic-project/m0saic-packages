import {
  isValidM0String,
  parseM0StringToRenderFrames,
} from "@m0saic/dsl";
import { goldenSpiralGenerator } from "./goldenSpiralGenerator";

describe("goldenSpiral generator", () => {
  test("default depth produces a valid 5-cell composition", () => {
    const r = goldenSpiralGenerator({ depth: 4 });
    expect(isValidM0String(r.m0)).toBe(true);
    // depth N → N+1 leaves (one new F per level)
    expect(r.sourceCount).toBe(5);
    const frames = parseM0StringToRenderFrames(r.m0, 1620, 1000);
    expect(frames).toHaveLength(5);
  });

  test("each direction produces a valid composition", () => {
    for (const dir of ["tl", "tr", "bl", "br"] as const) {
      const r = goldenSpiralGenerator({ depth: 4, direction: dir });
      expect(isValidM0String(r.m0)).toBe(true);
    }
  });

  test("depth 7 still valid", () => {
    const r = goldenSpiralGenerator({ depth: 7, direction: "br" });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(r.sourceCount).toBe(8);
  });

  test("invalid direction falls back to br", () => {
    const r = goldenSpiralGenerator({ depth: 3, direction: "garbage" });
    expect(isValidM0String(r.m0)).toBe(true);
  });
});
