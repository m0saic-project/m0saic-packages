/**
 * Generator coverage tests.
 *
 * Every generator must:
 * 1. Return valid DSL
 * 2. Return correct sourceCount
 * 3. Not throw on reasonable params
 */

import { isValidM0String, getFrameCount } from "@m0saic/dsl";
import type { GeneratorResult } from "./types";

import { grid } from "./grid";
import { spotlightGenerator } from "./spotlightGenerator";
import { comparisonGenerator } from "./comparisonGenerator";
import { rankedListGenerator } from "./rankedListGenerator";
import { bentoGridGenerator } from "./bentoGridGenerator";
import { safeCanvasGenerator } from "./safeCanvas";

function assertValid(r: GeneratorResult) {
  expect(isValidM0String(r.m0)).toBe(true);
  expect(r.sourceCount).toBe(getFrameCount(r.m0));
}

// ─────────────────────────────────────────────────────────────
// grid
// ─────────────────────────────────────────────────────────────

describe("grid generator", () => {
  test("2x2", () => {
    assertValid(grid({ columns: 2, rows: 2 }));
  });

  test("3x4 with gutter", () => {
    const r = grid({ columns: 4, rows: 3, gutter: 0.1 });
    assertValid(r);
    expect(r.sourceCount).toBe(12);
  });
});

// ─────────────────────────────────────────────────────────────
// spotlight
// ─────────────────────────────────────────────────────────────

describe("spotlight generator", () => {
  test("3 bottom", () => {
    assertValid(spotlightGenerator({ supportCount: 3, arrangement: "bottom" }));
  });

  test("2 right", () => {
    const r = spotlightGenerator({ supportCount: 2, arrangement: "right" });
    assertValid(r);
    expect(r.sourceCount).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────
// comparison
// ─────────────────────────────────────────────────────────────

describe("comparison generator", () => {
  test("2 pairs horizontal", () => {
    const r = comparisonGenerator({ pairs: 2, direction: "horizontal" });
    assertValid(r);
    expect(r.sourceCount).toBe(4);
  });

  test("1 pair vertical", () => {
    const r = comparisonGenerator({ pairs: 1, direction: "vertical" });
    assertValid(r);
    expect(r.sourceCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// rankedList
// ─────────────────────────────────────────────────────────────

describe("rankedList generator", () => {
  test("3 items steep", () => {
    const r = rankedListGenerator({ count: 3, decay: "steep", direction: "vertical" });
    assertValid(r);
    expect(r.sourceCount).toBe(3);
  });

  test("5 items gentle horizontal", () => {
    const r = rankedListGenerator({ count: 5, decay: "gentle", direction: "horizontal" });
    assertValid(r);
    expect(r.sourceCount).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────
// bentoGrid
// ─────────────────────────────────────────────────────────────

describe("bentoGrid generator", () => {
  test("3x3 all variants valid", () => {
    for (let v = 1; v <= 3; v++) {
      const r = bentoGridGenerator({ base: "3x3", variant: v });
      assertValid(r);
    }
  });

  test("4x3 all variants valid", () => {
    for (let v = 1; v <= 2; v++) {
      const r = bentoGridGenerator({ base: "4x3", variant: v });
      assertValid(r);
    }
  });

  test("4x4 all variants valid", () => {
    for (let v = 1; v <= 2; v++) {
      const r = bentoGridGenerator({ base: "4x4", variant: v });
      assertValid(r);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// safeCanvas
// ─────────────────────────────────────────────────────────────

describe("safeCanvas generator", () => {
  test("4x4 no gutter", () => {
    const r = safeCanvasGenerator({ columns: 4, rows: 4 });
    assertValid(r);
  });

  test("8x6 with gutter", () => {
    const r = safeCanvasGenerator({ columns: 8, rows: 6, gutter: 0.1 });
    assertValid(r);
  });
});
