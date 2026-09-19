import { MOSAIC_THEME_TOKEN_KEYS } from "@m0saic/types";
import {
  DEFAULT_THEME_MODE,
  M0SAIC_BRAND,
  THEME_MODES,
  THEME_PRESETS,
  resolveTheme,
} from "./theme-tokens";

describe("hoisted theme-tokens presets", () => {
  it("resolves dark by default and falls back to dark for unknown modes", () => {
    expect(DEFAULT_THEME_MODE).toBe("dark");
    expect(resolveTheme()).toBe(THEME_PRESETS.dark);
    expect(resolveTheme("unknown" as never)).toBe(THEME_PRESETS.dark);
  });

  it("dark is the brand verbatim (navy + orange)", () => {
    const dark = resolveTheme("dark");
    expect(dark.surfaceApp).toBe(M0SAIC_BRAND.navy);
    expect(dark.surfaceApp).toBe("#050314");
    expect(dark.accent).toBe("#EF7525");
    expect(dark.dataPalette).toEqual(M0SAIC_BRAND.dataRamp);
  });

  it("every mode carries the full semantic key set", () => {
    for (const mode of THEME_MODES) {
      const tokens = resolveTheme(mode) as unknown as Record<string, unknown>;
      for (const key of MOSAIC_THEME_TOKEN_KEYS) {
        expect(tokens[key]).toBeDefined();
      }
    }
  });
});
