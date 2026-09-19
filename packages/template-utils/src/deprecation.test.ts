import {
  HELPER_DEPRECATIONS,
  helperDeprecation,
  isDeprecatedHelper,
} from "./deprecation";
import * as templateUtils from "./index";

describe("helper deprecation registry", () => {
  it("every entry carries a non-empty reason, replacement, and ISO since date", () => {
    for (const [name, dep] of Object.entries(HELPER_DEPRECATIONS)) {
      expect(dep.reason.length).toBeGreaterThan(0);
      expect(dep.replacement.length).toBeGreaterThan(0);
      expect(dep.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("every registered name is still exported from the package surface (deprecated ≠ removed)", () => {
    for (const name of Object.keys(HELPER_DEPRECATIONS)) {
      expect(typeof (templateUtils as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("helperDeprecation returns the entry for a deprecated export", () => {
    const dep = helperDeprecation("gridCellInset");
    expect(dep).toBeDefined();
    expect(dep!.replacement).toContain("latticeCellInset");
    expect(dep!.replacement).toContain("placeInsetPieces");
  });

  it("helperDeprecation / isDeprecatedHelper are negative for current exports", () => {
    for (const name of ["latticeCellInset", "placeInsetPieces", "placeOptimizedPieces"]) {
      expect(helperDeprecation(name)).toBeUndefined();
      expect(isDeprecatedHelper(name)).toBe(false);
    }
  });

  it("gridCellInset is registered as deprecated", () => {
    expect(isDeprecatedHelper("gridCellInset")).toBe(true);
  });
});
