import { pulseTheme, PULSE_PRESETS, PULSE_PALETTE } from "./pulse-theme";

const HEX = /^#[0-9a-fA-F]{6}$/;

describe("pulse-theme", () => {
  it("resolves the dark preset by default", () => {
    expect(pulseTheme()).toBe(PULSE_PRESETS.dark);
    expect(pulseTheme("dark")).toBe(PULSE_PRESETS.dark);
  });

  it("every core color token is a hex string", () => {
    const t = pulseTheme();
    for (const k of ["canvas", "card", "border", "eyebrow", "title", "subtitle", "label", "muted", "primary", "primaryBright", "positive", "negative", "grid"] as const) {
      expect(String(t[k])).toMatch(HEX);
    }
  });

  it("ships scatter palettes and a categorical ramp", () => {
    const t = pulseTheme();
    expect(t.scatterDark.length).toBeGreaterThan(0);
    expect(t.scatterGreen.length).toBeGreaterThan(0);
    expect(PULSE_PALETTE.length).toBeGreaterThanOrEqual(6);
    for (const c of [...t.scatterDark, ...t.scatterGreen, ...PULSE_PALETTE]) expect(String(c)).toMatch(HEX);
  });

  it("corner radius is a sane fraction", () => {
    expect(pulseTheme().cornerRadius).toBeGreaterThan(0);
    expect(pulseTheme().cornerRadius).toBeLessThan(0.5);
  });
});
