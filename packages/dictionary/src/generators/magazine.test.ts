import {
  isValidM0String,
  parseM0StringToRenderFrames,
} from "@m0saic/dsl";
import { magazine } from "./magazine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertMagazine(
  opts: Parameters<typeof magazine>[0],
  expectedTiles: number
) {
  const result = magazine(opts);

  // Must pass the canonical validator
  expect(isValidM0String(result.m0)).toBe(true);

  // Rendered tile count must match expected
  const frames = parseM0StringToRenderFrames(result.m0, 1920, 1080);
  expect(frames.length).toBe(expectedTiles);

  // tileCount must agree
  expect(result.tileCount).toBe(expectedTiles);
}

// ---------------------------------------------------------------------------
// Unit tests (DSL validity + structure)
// ---------------------------------------------------------------------------

describe("magazine", () => {
  test("default layout produces valid string with 6 tiles", () => {
    // hero(1) + sidebar(2) + bottom(3) = 6
    assertMagazine({}, 6);

    const r = magazine({});
    expect(r.cellW).toBe(50);
    expect(r.gutterW).toBe(0);
    expect(r.tileCount).toBe(6);
    expect(r.totalX).toBe(2 * 50 + 1 * 50); // 150
    expect(r.totalY).toBe(2 * 50 + 1 * 50); // 150
  });

  test("with gutter", () => {
    const r = magazine({ gutter: 0.02 });
    assertMagazine({ gutter: 0.02 }, 6);

    expect(r.gutterW).toBe(1);
    expect(r.totalX).toBe(2 * 50 + 1 * 50 + 1); // 151
    expect(r.totalY).toBe(2 * 50 + 1 * 50 + 1); // 151
  });

  test("custom hero and sidebar weights", () => {
    const r = magazine({ heroWeight: 3, sidebarWeight: 1 });
    assertMagazine({ heroWeight: 3, sidebarWeight: 1 }, 6);

    expect(r.totalX).toBe(3 * 50 + 1 * 50); // 200
  });

  test("single sidebar tile", () => {
    // hero(1) + sidebar(1) + bottom(3) = 5
    assertMagazine({ sidebarCount: 1 }, 5);
  });

  test("many sidebar tiles", () => {
    // hero(1) + sidebar(4) + bottom(3) = 8
    assertMagazine({ sidebarCount: 4 }, 8);
  });

  test("single bottom column", () => {
    // hero(1) + sidebar(2) + bottom(1) = 4
    assertMagazine({ bottomCount: 1 }, 4);
  });

  test("many bottom columns", () => {
    // hero(1) + sidebar(2) + bottom(5) = 8
    assertMagazine({ bottomCount: 5 }, 8);
  });

  test("custom top and bottom weights", () => {
    const r = magazine({ topWeight: 3, bottomWeight: 1 });
    assertMagazine({ topWeight: 3, bottomWeight: 1 }, 6);
    expect(r.totalY).toBe(3 * 50 + 1 * 50); // 200
  });

  test("custom cellWeightBase", () => {
    const r = magazine({ cellWeightBase: 10, gutter: 0.1 });
    assertMagazine({ cellWeightBase: 10, gutter: 0.1 }, 6);
    expect(r.cellW).toBe(10);
    expect(r.gutterW).toBe(1); // round(10*0.1)=1
  });

  test("gutter=0 produces no gutters", () => {
    const r = magazine({ gutter: 0 });
    expect(r.gutterW).toBe(0);
    expect(isValidM0String(r.m0)).toBe(true);
  });

  test("undefined gutter treated as no gutter", () => {
    const r = magazine({});
    expect(r.gutterW).toBe(0);
  });

  test("invalid sidebarCount throws", () => {
    expect(() => magazine({ sidebarCount: 0 })).toThrow(
      "magazine: sidebarCount must be a positive integer"
    );
    expect(() => magazine({ sidebarCount: 1.5 })).toThrow(
      "magazine: sidebarCount must be a positive integer"
    );
  });

  test("invalid bottomCount throws", () => {
    expect(() => magazine({ bottomCount: 0 })).toThrow(
      "magazine: bottomCount must be a positive integer"
    );
    expect(() => magazine({ bottomCount: -1 })).toThrow(
      "magazine: bottomCount must be a positive integer"
    );
  });

  test("large editorial layout", () => {
    // hero(1) + sidebar(3) + bottom(4) = 8
    assertMagazine({
      heroWeight: 3,
      sidebarWeight: 2,
      sidebarCount: 3,
      topWeight: 3,
      bottomWeight: 1,
      bottomCount: 4,
      gutter: 0.02,
    }, 8);
  });
});
