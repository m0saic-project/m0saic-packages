import { asAssetId } from "@m0saic/types";
import { getFrameCount, parseM0StringToRenderFrames } from "@m0saic/dsl";
import { buildLockupChild, buildLogoChild, buildTextChild } from "./content";
import {
  LOCKUP_GAP,
  LOCKUP_LOGO_BAND,
  LOCKUP_TEXT_BAND,
  LOCKUP_TEXT_TO_LOGO,
  lockupAspect,
} from "./geometry";

describe("buildLogoChild / buildTextChild", () => {
  test("logo child is hermetic and declares size", () => {
    const c = buildLogoChild({ logoPath: "/tmp/logo.png", w: 200, h: 100 });
    expect(c.size).toEqual({ width: 200, height: 100 });
    expect(c.assets?.[asAssetId("wm_logo")]).toMatchObject({ path: "/tmp/logo.png" });
  });

  test("text child uses the svg rasterizer with a fitted font", () => {
    const c = buildTextChild({ text: "yourbrand.com", color: "#ffffff", w: 400, h: 80 });
    const src = c.sources[0] as { rasterizer?: string; layers?: Array<{ style?: { fontSize?: number } }> };
    expect(src.rasterizer).toBe("svg");
    expect(src.layers?.[0]?.style?.fontSize).toBeGreaterThan(4);
  });
});

describe("buildLockupChild", () => {
  const base = {
    logoPath: "/tmp/logo.png",
    logoAspect: 1, // square logo
    text: "yourbrand.com",
    textAspect: 8,
    color: "#ffffff" as const,
  };

  test("text-right: logo full-height, text band vertically centered after the gap", () => {
    const h = 200;
    const aspect = lockupAspect(1, 8, "text-right");
    const w = Math.round(h * aspect);
    const c = buildLockupChild({ ...base, layout: "text-right", w, h });
    expect(getFrameCount(String(c.m0))).toBe(2);
    const frames = parseM0StringToRenderFrames(String(c.m0), w, h);
    const logo = frames.find((f) => f.height === h)!;
    const text = frames.find((f) => f.height < h)!;
    expect(logo.x).toBe(0);
    expect(logo.width).toBe(Math.round(h * base.logoAspect));
    expect(text.height).toBe(Math.round(h * LOCKUP_TEXT_TO_LOGO));
    expect(text.x).toBe(logo.width + Math.round(h * LOCKUP_GAP));
    // vertically centered band
    expect(Math.abs(text.y - (h - text.height) / 2)).toBeLessThanOrEqual(1);
  });

  test("text-below: logo band on top, text band at the bottom, both centered", () => {
    const h = 200;
    const aspect = lockupAspect(1, 8, "text-below");
    const w = Math.round(h * aspect);
    const c = buildLockupChild({ ...base, layout: "text-below", w, h });
    const frames = parseM0StringToRenderFrames(String(c.m0), w, h);
    const logo = frames.find((f) => f.y === 0)!;
    const text = frames.find((f) => f.y > 0)!;
    expect(logo.height).toBe(Math.round(h * LOCKUP_LOGO_BAND));
    expect(text.height).toBe(Math.round(h * LOCKUP_TEXT_BAND));
    expect(text.y + text.height).toBe(h);
  });

  test("lockupAspect mirrors the rect math constants", () => {
    expect(lockupAspect(1, 8, "text-right")).toBeCloseTo(1 + LOCKUP_GAP + 8 * LOCKUP_TEXT_TO_LOGO, 9);
    expect(lockupAspect(1, 8, "text-below")).toBeCloseTo(Math.max(1 * LOCKUP_LOGO_BAND, 8 * LOCKUP_TEXT_BAND), 9);
  });

  test("sources bind to frames in paint order (logo frame paints first)", () => {
    for (const layout of ["text-right", "text-below"] as const) {
      const h = 200;
      const w = Math.round(h * lockupAspect(1, 8, layout));
      const c = buildLockupChild({ ...base, layout, w, h });
      expect(c.sources[0]!.type).toBe("media");
      expect(c.sources[1]!.type).toBe("text");
      // sources[i] binds to the i-th painted frame — the first painted
      // frame must be the logo rect (top-most by the y-then-x idiom).
      const frames = parseM0StringToRenderFrames(String(c.m0), w, h);
      const logoH = layout === "text-right" ? h : Math.round(h * LOCKUP_LOGO_BAND);
      expect(frames[0]!.height).toBe(logoH);
    }
  });

  test("determinism + degenerate dims guarded", () => {
    const h = 120;
    const w = Math.round(h * lockupAspect(1, 8, "text-right"));
    const build = () => buildLockupChild({ ...base, layout: "text-right", w, h });
    expect(build()).toEqual(build());
    expect(() => buildLockupChild({ ...base, layout: "text-right", w: 0, h })).toThrow(/positive/);
  });
});
