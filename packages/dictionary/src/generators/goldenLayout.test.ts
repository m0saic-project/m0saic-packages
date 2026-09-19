import {
  isValidM0String,
  parseM0StringToRenderFrames,
} from "@m0saic/dsl";
import { goldenLayoutGenerator } from "./goldenLayout";

const PHI = 1.6180339887498949;

describe("goldenLayout generator", () => {
  test("default params produce a valid 2-cell horizontal split with φ:1 ratio", () => {
    const r = goldenLayoutGenerator({});
    expect(isValidM0String(r.m0)).toBe(true);
    expect(r.sourceCount).toBe(2);
    const frames = parseM0StringToRenderFrames(r.m0, 1620, 1000);
    expect(frames).toHaveLength(2);
    const ratio = Math.max(frames[0].width, frames[1].width) / Math.min(frames[0].width, frames[1].width);
    expect(Math.abs(ratio - PHI)).toBeLessThan(0.05);
  });

  test("vertical direction stacks rows", () => {
    const r = goldenLayoutGenerator({ direction: "vertical" });
    const frames = parseM0StringToRenderFrames(r.m0, 1000, 1620);
    expect(frames[0].width).toBe(frames[1].width); // same column
    const ratio = Math.max(frames[0].height, frames[1].height) / Math.min(frames[0].height, frames[1].height);
    expect(Math.abs(ratio - PHI)).toBeLessThan(0.05);
  });

  test("dominantSide: second flips which cell is larger", () => {
    const first = goldenLayoutGenerator({ dominantSide: "first" });
    const second = goldenLayoutGenerator({ dominantSide: "second" });
    const fA = parseM0StringToRenderFrames(first.m0, 1000, 1000);
    const fB = parseM0StringToRenderFrames(second.m0, 1000, 1000);
    expect(fA[0].width).toBeGreaterThan(fA[1].width);
    expect(fB[0].width).toBeLessThan(fB[1].width);
  });

  test("higher precision produces a different (longer) DSL", () => {
    const compact = goldenLayoutGenerator({ precision: "13/8" });
    const precise = goldenLayoutGenerator({ precision: "144/89" });
    expect(precise.m0.length).toBeGreaterThan(compact.m0.length);
  });

  test("invalid precision falls back to 21/13 default", () => {
    const r = goldenLayoutGenerator({ precision: "garbage" });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(r.sourceCount).toBe(2);
  });
});
