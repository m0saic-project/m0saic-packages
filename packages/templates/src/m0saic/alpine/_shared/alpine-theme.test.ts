import type { MosaicEngineContext, MosaicThemeTokens } from "@m0saic/types";
import {
  ALPINE_PALETTE,
  ALPINE_PRESETS,
  alpineTheme,
  alpineToTokens,
  resolveAlpineTheme,
  tokensToAlpine,
  type AlpineTheme,
} from "./alpine-theme";

const ctx = (theme?: Partial<MosaicThemeTokens>): MosaicEngineContext =>
  ({ mode: "render", target: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, output: {}, media: {}, ...(theme ? { upstreamData: { theme } } : {}) }) as unknown as MosaicEngineContext;

const REQUIRED_KEYS: Array<keyof AlpineTheme> = [
  "canvas", "card", "border", "borderAlpha",
  "title", "subtitle", "label", "muted",
  "primary", "positive", "negative",
  "grid", "gridAlpha", "axis", "axisAlpha",
  "cornerRadius",
];

describe("alpine-theme", () => {
  it("every preset defines every token", () => {
    for (const [name, theme] of Object.entries(ALPINE_PRESETS)) {
      for (const key of REQUIRED_KEYS) {
        expect(theme[key]).toBeDefined();
      }
      // alphas + radius are 0..1
      for (const frac of [theme.borderAlpha, theme.gridAlpha, theme.axisAlpha, theme.cornerRadius]) {
        expect(frac).toBeGreaterThanOrEqual(0);
        expect(frac).toBeLessThanOrEqual(1);
      }
      // colors are hex strings
      expect(theme.card).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(name).toMatch(/^(light|dark)$/);
    }
  });

  it("alpineTheme defaults to light and resolves dark", () => {
    expect(alpineTheme()).toBe(ALPINE_PRESETS.light);
    expect(alpineTheme("light")).toBe(ALPINE_PRESETS.light);
    expect(alpineTheme("dark")).toBe(ALPINE_PRESETS.dark);
  });

  it("palette is a non-empty hex ramp whose head is the light primary", () => {
    expect(ALPINE_PALETTE.length).toBeGreaterThanOrEqual(4);
    for (const c of ALPINE_PALETTE) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(ALPINE_PALETTE[0]).toBe(ALPINE_PRESETS.light.primary);
  });

  // ── producer theming bridge (F4 U-A0) ──
  it("alpineToTokens ↔ tokensToAlpine round-trips to the same AlpineTheme (identity on used keys)", () => {
    for (const preset of ["light", "dark"] as const) {
      const base = alpineTheme(preset);
      expect(tokensToAlpine(alpineToTokens(base), base)).toEqual(base);
    }
  });

  it("resolveAlpineTheme unthemed == alpineTheme (byte-identical fallback)", async () => {
    for (const preset of ["light", "dark", undefined] as const) {
      expect(await resolveAlpineTheme(preset, ctx())).toEqual(alpineTheme(preset));
    }
  });

  it("a producer theme block overrides surface / text / accent per-key", async () => {
    const t = await resolveAlpineTheme("light", ctx({ surface: "#654321", textPrimary: "#abcdef", accent: "#ff0000" }));
    expect(t.card).toBe("#654321");   // surface → card
    expect(t.title).toBe("#abcdef");  // textPrimary → title
    expect(t.primary).toBe("#ff0000"); // accent → primary
    // untouched keys keep the preset value
    expect(t.canvas).toBe(ALPINE_PRESETS.light.canvas);
  });
});
