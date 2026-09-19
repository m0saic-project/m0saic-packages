import {
  normalizeLayoutM0,
  resolveContentAspect,
  resolveWatermarkProbeRegion,
  resolveWatermarkRect,
  textContentAspect,
  validateLayoutM0,
  watermarkNeedsLumaProbe,
} from "./geometry";
import type { WatermarkV1Props } from "./watermark";

const KNOBS = {
  position: "bottom-right" as const,
  sizeRatio: 0.18,
  sizeBasis: "min" as const,
  marginRatio: 0.022,
};

describe("normalizeLayoutM0", () => {
  test("strips .m0 header comments and blank lines", () => {
    expect(normalizeLayoutM0("# comment\n\n4(-,-,-,F)\n")).toBe("4(-,-,-,F)");
  });
  test("empty → null", () => {
    expect(normalizeLayoutM0(undefined)).toBeNull();
    expect(normalizeLayoutM0("")).toBeNull();
    expect(normalizeLayoutM0("# only comments\n")).toBeNull();
  });
});

describe("validateLayoutM0", () => {
  test("accepts a valid single-frame layout", () => {
    expect(() => validateLayoutM0("4(-,-,-,F)")).not.toThrow();
  });
  test("rejects invalid strings", () => {
    expect(() => validateLayoutM0("not-an-m0(((")).toThrow(/not a valid m0/);
  });
  test("rejects all-null layouts (invalid m0 — nothing rendered)", () => {
    expect(() => validateLayoutM0("2(-,-)")).toThrow(/not a valid m0/);
  });
  test("rejects multi-frame layouts", () => {
    expect(() => validateLayoutM0("2(F,F)")).toThrow(/exactly ONE frame \(got 2\)/);
  });
});

describe("resolveWatermarkRect", () => {
  test("m0 hatch parses the single frame at the canvas and clamps to integers", () => {
    // 4(-,-,-,F): 4 columns, F = last quarter → x=1440, w=480, full height
    const r = resolveWatermarkRect({ ...KNOBS, layoutM0: "4(-,-,-,F)" }, 1920, 1080, 2);
    expect(r).toEqual({ x: 1440, y: 0, w: 480, h: 1080 });
  });
  test("hatch overrides position knobs", () => {
    const hatch = resolveWatermarkRect({ ...KNOBS, position: "top-left", layoutM0: "4(-,-,-,F)" }, 1920, 1080, 2);
    expect(hatch.x).toBe(1440);
  });
  test("no hatch → nine-position math", () => {
    const r = resolveWatermarkRect({ ...KNOBS, layoutM0: null }, 1920, 1080, 2);
    // w = round(0.18*1080) = 194, h = 97, margin 24 → bottom-right
    expect(r).toEqual({ x: 1920 - 194 - 24, y: 1080 - 97 - 24, w: 194, h: 97 });
  });
});

describe("resolveContentAspect", () => {
  test("logo aspect from probed dims", () => {
    const props: WatermarkV1Props = { content: "logo", image: "/tmp/logo.png" };
    const ctx = { media: { "/tmp/logo.png": { kind: "image", width: 400, height: 100 } } } as never;
    expect(resolveContentAspect(props, ctx)).toBe(4);
  });
  test("logo without image throws a guiding message", () => {
    expect(() => resolveContentAspect({ content: "logo" }, { media: {} } as never)).toThrow(/needs a logo image/);
  });
  test("logo without probed dims throws", () => {
    expect(() =>
      resolveContentAspect({ content: "logo", image: "/tmp/logo.png" }, { media: {} } as never),
    ).toThrow(/no probed dimensions/);
  });
  test("non-image logo kind throws", () => {
    const ctx = { media: { "/tmp/logo.png": { kind: "video", width: 400, height: 100 } } } as never;
    expect(() => resolveContentAspect({ content: "logo", image: "/tmp/logo.png" }, ctx)).toThrow(/must be an image/);
  });
  test("text aspect is measured and wide for a long wordmark", () => {
    const a = resolveContentAspect({ content: "text", text: "yourbrand.com" }, { media: {} } as never);
    expect(a).toBeGreaterThan(3);
    expect(a).toBe(textContentAspect("yourbrand.com"));
  });
  test("empty text throws", () => {
    expect(() => resolveContentAspect({ content: "text", text: "   " }, { media: {} } as never)).toThrow(/empty/);
  });
  test("deterministic", () => {
    expect(textContentAspect("m0saic.io")).toBe(textContentAspect("m0saic.io"));
  });
});

describe("watermarkNeedsLumaProbe", () => {
  test("truth table", () => {
    expect(watermarkNeedsLumaProbe({})).toBe(false); // default mode static
    expect(watermarkNeedsLumaProbe({ mode: "static" })).toBe(false);
    expect(watermarkNeedsLumaProbe({ mode: "page" })).toBe(false);
    expect(watermarkNeedsLumaProbe({ mode: "adaptive" })).toBe(true); // variant defaults to auto
    expect(watermarkNeedsLumaProbe({ mode: "adaptive", variant: "auto" })).toBe(true);
    expect(watermarkNeedsLumaProbe({ mode: "adaptive", variant: "single" })).toBe(false);
  });
});

describe("resolveWatermarkProbeRegion", () => {
  test("expands the stamp rect ~10% per axis and clamps to [0,1]", () => {
    const props: WatermarkV1Props = { content: "text", text: "yourbrand.com", position: "bottom-right" };
    const region = resolveWatermarkProbeRegion(props, 1920, 1080);
    expect(region.xPct).toBeGreaterThanOrEqual(0);
    expect(region.yPct).toBeGreaterThanOrEqual(0);
    expect(region.xPct + region.wPct).toBeLessThanOrEqual(1);
    expect(region.yPct + region.hPct).toBeLessThanOrEqual(1);
    expect(region.wPct).toBeGreaterThan(0);
    expect(region.hPct).toBeGreaterThan(0);
  });
  test("logo content uses caller-passed dims (host has no engine ctx)", () => {
    const props: WatermarkV1Props = { content: "logo", image: "/tmp/logo.png" };
    const region = resolveWatermarkProbeRegion(props, 1920, 1080, { width: 400, height: 100 });
    expect(region.wPct).toBeGreaterThan(0);
  });
});
