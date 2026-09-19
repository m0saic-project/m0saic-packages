import { publishTheme, readTheme, applyTheme, MOSAIC_THEME_ALIAS } from "./theming";
import type { MosaicThemeTokens, MosaicEngineContext } from "@m0saic/types";

const TOKENS: MosaicThemeTokens = {
  surfaceApp: "#050314",
  surface: "#12111F",
  surfaceRaised: "#1E1D2D",
  surfaceInset: "#161525",
  border: "#2A293D",
  borderStrong: "#3A394F",
  textPrimary: "#F5F5F7",
  textSecondary: "#A0A0B0",
  textMuted: "#6D6D84",
  eyebrow: "#EF7525",
  accent: "#EF7525",
  accentSoft: "#F99666",
  accentGlow: "#EF752540",
  positive: "#4ADE80",
  negative: "#F87171",
  grid: "#1E1D2D",
  gridAlpha: 1,
  axis: "#3A394F",
  axisAlpha: 1,
  radius: 0.06,
  dataPalette: ["#EF7525", "#3FB6C9", "#F5C451", "#E0607F", "#8B7FE8", "#5AD1A0"],
};

const ctxWith = (data: Record<string, unknown>): MosaicEngineContext =>
  ({ upstreamData: data, upstreamVariables: undefined }) as unknown as MosaicEngineContext;

describe("publishTheme", () => {
  it("emits a data source under the canonical alias", () => {
    const src = publishTheme(TOKENS);
    expect(src.type).toBe("data");
    expect(src.alias).toBe(MOSAIC_THEME_ALIAS);
    expect(src.variables).toEqual(TOKENS);
    expect(src.variables).not.toBe(TOKENS); // copied, not aliased
  });

  it("honors a custom alias", () => {
    expect(publishTheme(TOKENS, { alias: "brandTheme" }).alias).toBe("brandTheme");
  });
});

describe("readTheme", () => {
  it("reads the published block, undefined when un-themed", () => {
    expect(readTheme(ctxWith({ theme: TOKENS }))).toEqual(TOKENS);
    expect(readTheme(ctxWith({}))).toBeUndefined();
    expect(readTheme({ } as MosaicEngineContext)).toBeUndefined();
  });

  it("honors a custom alias", () => {
    expect(readTheme(ctxWith({ brandTheme: TOKENS }), { alias: "brandTheme" })).toEqual(TOKENS);
  });
});

describe("applyTheme", () => {
  it("returns the fallback unchanged when un-themed", () => {
    expect(applyTheme(TOKENS, ctxWith({}))).toBe(TOKENS);
  });

  it("overlays a partial producer per-key onto the fallback", () => {
    const ctx = ctxWith({ theme: { accent: "#00FF00", surfaceApp: "#000000" } });
    const merged = applyTheme(TOKENS, ctx);
    expect(merged.accent).toBe("#00FF00"); // producer wins
    expect(merged.surfaceApp).toBe("#000000");
    expect(merged.textPrimary).toBe(TOKENS.textPrimary); // fallback kept
    expect(TOKENS.accent).toBe("#EF7525"); // fallback not mutated
  });

  it("round-trips publishTheme → applyTheme", () => {
    const src = publishTheme(TOKENS);
    const ctx = ctxWith({ [MOSAIC_THEME_ALIAS]: src.variables });
    expect(applyTheme(TOKENS, ctx)).toEqual(TOKENS);
  });
});
