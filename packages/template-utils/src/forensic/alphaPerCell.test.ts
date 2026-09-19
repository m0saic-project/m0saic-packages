import { describe, expect, it } from "@jest/globals";
import {
  ACTIVITY_FULL_GAIN,
  DEFAULT_ALPHA_OPTS,
  alphaForCell,
  alphaForLuminance,
  textureGain,
  type AlphaCurveOpts,
} from "./alphaPerCell";

describe("alphaForLuminance", () => {
  const opts: AlphaCurveOpts = {
    alphaBase: 0.01,
    alphaMin: 0.002,
    alphaMax: 0.02,
    luminanceAdaptive: true,
  };

  it("returns alphaBase when luminanceAdaptive is false", () => {
    expect(
      alphaForLuminance(128, { ...opts, luminanceAdaptive: false }),
    ).toBe(opts.alphaBase);
    expect(alphaForLuminance(0, { ...opts, luminanceAdaptive: false })).toBe(
      opts.alphaBase,
    );
  });

  it("returns alphaBase when luminanceY is undefined", () => {
    expect(alphaForLuminance(undefined, opts)).toBe(opts.alphaBase);
  });

  it("peaks at mid-luminance (Y=128) → alphaMax", () => {
    const a = alphaForLuminance(128, opts);
    expect(a).toBeCloseTo(opts.alphaMax, 6);
  });

  it("hits alphaMin at the extremes (Y=0 and Y=255)", () => {
    const a0 = alphaForLuminance(0, opts);
    const a255 = alphaForLuminance(255, opts);
    expect(a0).toBeCloseTo(opts.alphaMin, 6);
    // Y=255 is u=127/128 ≈ 0.992, so shape ≈ 1 - 0.984 = 0.016
    // Not exactly alphaMin but very close.
    expect(a255).toBeLessThan(opts.alphaMin + 0.001);
  });

  it("monotonically decreases moving away from Y=128", () => {
    let prev = alphaForLuminance(128, opts);
    for (let y = 130; y <= 250; y += 10) {
      const a = alphaForLuminance(y, opts);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      prev = a;
    }
  });

  it("clamps to alphaMin", () => {
    // Extreme out-of-range Y values shouldn't break monotonicity or
    // exceed the clamp.
    expect(alphaForLuminance(-100, opts)).toBeGreaterThanOrEqual(opts.alphaMin - 1e-9);
    expect(alphaForLuminance(500, opts)).toBeGreaterThanOrEqual(opts.alphaMin - 1e-9);
  });

  it("DEFAULT_ALPHA_OPTS are self-consistent", () => {
    expect(DEFAULT_ALPHA_OPTS.alphaMin).toBeLessThanOrEqual(
      DEFAULT_ALPHA_OPTS.alphaBase,
    );
    expect(DEFAULT_ALPHA_OPTS.alphaBase).toBeLessThanOrEqual(
      DEFAULT_ALPHA_OPTS.alphaMax,
    );
  });
});

describe("alphaForCell — texture mask on top of the luminance bell", () => {
  const opts: AlphaCurveOpts = { alphaBase: 0.01, alphaMin: 0.002, alphaMax: 0.02, luminanceAdaptive: true };

  it("textureGain: flat → 0, fully textured → 1, linear between, undefined → 1", () => {
    expect(textureGain(0)).toBe(0);
    expect(textureGain(ACTIVITY_FULL_GAIN / 2)).toBeCloseTo(0.5, 9);
    expect(textureGain(ACTIVITY_FULL_GAIN)).toBe(1);
    expect(textureGain(ACTIVITY_FULL_GAIN * 4)).toBe(1);
    expect(textureGain(undefined)).toBe(1);
  });

  it("a FLAT mid-grey cell sits at alphaMin — the checkerboard the eye catches is gone", () => {
    expect(alphaForCell(128, 0, opts)).toBeCloseTo(opts.alphaMin, 9);
  });

  it("a TEXTURED mid-grey cell keeps the full bell value (alphaMax)", () => {
    expect(alphaForCell(128, ACTIVITY_FULL_GAIN, opts)).toBeCloseTo(opts.alphaMax, 9);
  });

  it("half activity lands halfway between alphaMin and the bell", () => {
    const bell = alphaForLuminance(128, opts);
    expect(alphaForCell(128, ACTIVITY_FULL_GAIN / 2, opts)).toBeCloseTo(opts.alphaMin + (bell - opts.alphaMin) / 2, 9);
  });

  it("without activity it IS the luminance bell; non-adaptive it IS alphaBase", () => {
    expect(alphaForCell(60, undefined, opts)).toBe(alphaForLuminance(60, opts));
    expect(alphaForCell(60, 0, { ...opts, luminanceAdaptive: false })).toBe(opts.alphaBase);
  });
});
