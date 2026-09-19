import {
  isValidM0String,
  parseM0StringToRenderFrames,
} from "@m0saic/dsl";
import { aspectFit } from "./aspectFit";
import type { AspectFitGeneratorParams } from "./aspectFit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertAspectFitGen(
  params: AspectFitGeneratorParams,
  expectedSourceCount = 1,
) {
  const result = aspectFit(params);

  // Must pass the canonical validator
  expect(isValidM0String(result.m0)).toBe(true);

  // Rendered tile count
  const frames = parseM0StringToRenderFrames(
    result.m0,
    params.rootW,
    params.rootH,
  );
  expect(frames.length).toBe(expectedSourceCount);
  expect(result.sourceCount).toBe(expectedSourceCount);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

describe("aspectFit generator — presets", () => {
  test("21:9 preset (default)", () => {
    assertAspectFitGen({ rootW: 1920, rootH: 1080 });
  });

  test("16:9 preset on 16:9 root → exact fit", () => {
    const r = aspectFit({ rootW: 1920, rootH: 1080, preset: "16:9" });
    expect(r.m0).toBe("1");
    expect(r.sourceCount).toBe(1);
  });

  test("4:3 preset", () => {
    assertAspectFitGen({ rootW: 1920, rootH: 1080, preset: "4:3" });
  });

  test("1:1 preset", () => {
    assertAspectFitGen({ rootW: 1920, rootH: 1080, preset: "1:1" });
  });

  test("9:16 preset (portrait)", () => {
    assertAspectFitGen({ rootW: 1920, rootH: 1080, preset: "9:16" });
  });

  test("unknown preset throws", () => {
    expect(() =>
      aspectFit({ rootW: 1920, rootH: 1080, preset: "bogus" }),
    ).toThrow(/unknown preset/);
  });
});

// ---------------------------------------------------------------------------
// Custom ratio input
// ---------------------------------------------------------------------------

describe("aspectFit generator — custom ratio", () => {
  test("custom ratio 3:2", () => {
    assertAspectFitGen({
      rootW: 1920,
      rootH: 1080,
      preset: "custom",
      inputMode: "ratio",
      targetW: 3,
      targetH: 2,
    });
  });

  test("custom ratio 1:1 in square root → exact fit", () => {
    const r = aspectFit({
      rootW: 1080,
      rootH: 1080,
      preset: "custom",
      inputMode: "ratio",
      targetW: 1,
      targetH: 1,
    });
    expect(r.m0).toBe("1");
  });

  test("invalid targetW throws", () => {
    expect(() =>
      aspectFit({
        rootW: 1920,
        rootH: 1080,
        preset: "custom",
        inputMode: "ratio",
        targetW: 0,
        targetH: 9,
      }),
    ).toThrow(/targetW/);
  });
});

// ---------------------------------------------------------------------------
// Custom dimensions input
// ---------------------------------------------------------------------------

describe("aspectFit generator — custom dimensions", () => {
  test("dimensions 3840x2160 → 16:9 ratio", () => {
    const r = aspectFit({
      rootW: 1920,
      rootH: 1080,
      preset: "custom",
      inputMode: "dimensions",
      targetDimW: 3840,
      targetDimH: 2160,
    });
    // 3840:2160 = 16:9 → exact fit on 16:9 root
    expect(r.m0).toBe("1");
  });

  test("dimensions 2560x1080 → ultrawide", () => {
    assertAspectFitGen({
      rootW: 1920,
      rootH: 1080,
      preset: "custom",
      inputMode: "dimensions",
      targetDimW: 2560,
      targetDimH: 1080,
    });
  });

  test("invalid targetDimW throws", () => {
    expect(() =>
      aspectFit({
        rootW: 1920,
        rootH: 1080,
        preset: "custom",
        inputMode: "dimensions",
        targetDimW: 0,
        targetDimH: 1080,
      }),
    ).toThrow(/targetDimW/);
  });
});

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

describe("aspectFit generator — alignment", () => {
  test("left-aligned pillarbox", () => {
    const r = aspectFit({
      rootW: 1920,
      rootH: 1080,
      preset: "4:3",
      hAlign: "left",
    });
    expect(isValidM0String(r.m0)).toBe(true);
    const frames = parseM0StringToRenderFrames(r.m0, 1920, 1080);
    expect(frames[0].x).toBe(0);
  });

  test("right-aligned pillarbox", () => {
    const r = aspectFit({
      rootW: 1920,
      rootH: 1080,
      preset: "4:3",
      hAlign: "right",
    });
    expect(isValidM0String(r.m0)).toBe(true);
    const frames = parseM0StringToRenderFrames(r.m0, 1920, 1080);
    expect(frames[0].x + frames[0].width).toBe(1920);
  });

  test("top-aligned letterbox", () => {
    const r = aspectFit({
      rootW: 1920,
      rootH: 1080,
      preset: "21:9",
      vAlign: "top",
    });
    expect(isValidM0String(r.m0)).toBe(true);
    const frames = parseM0StringToRenderFrames(r.m0, 1920, 1080);
    expect(frames[0].y).toBe(0);
  });

  test("bottom-aligned letterbox", () => {
    const r = aspectFit({
      rootW: 1920,
      rootH: 1080,
      preset: "21:9",
      vAlign: "bottom",
    });
    expect(isValidM0String(r.m0)).toBe(true);
    const frames = parseM0StringToRenderFrames(r.m0, 1920, 1080);
    expect(frames[0].y + frames[0].height).toBe(1080);
  });

  test("invalid alignment falls back to center", () => {
    const r = aspectFit({
      rootW: 1920,
      rootH: 1080,
      preset: "4:3",
      hAlign: "bogus",
    });
    expect(isValidM0String(r.m0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Padding
// ---------------------------------------------------------------------------

describe("aspectFit generator — padding", () => {
  test("uniform padding", () => {
    const r = aspectFit({
      rootW: 1920,
      rootH: 1080,
      preset: "16:9",
      padding: 0.1,
    });
    expect(isValidM0String(r.m0)).toBe(true);
    const frames = parseM0StringToRenderFrames(r.m0, 1920, 1080);
    expect(frames.length).toBe(1);
    expect(frames[0].width).toBeLessThan(1920);
    expect(frames[0].height).toBeLessThan(1080);
  });

  test("custom padding per-side", () => {
    const r = aspectFit({
      rootW: 1920,
      rootH: 1080,
      preset: "16:9",
      customPadding: true,
      paddingLeft: 0.1,
      paddingRight: 0.1,
      paddingTop: 0.05,
      paddingBottom: 0.05,
    });
    expect(isValidM0String(r.m0)).toBe(true);
    const frames = parseM0StringToRenderFrames(r.m0, 1920, 1080);
    expect(frames.length).toBe(1);
  });

  test("zero padding same as no padding", () => {
    const a = aspectFit({ rootW: 1920, rootH: 1080, preset: "21:9", padding: 0 });
    const b = aspectFit({ rootW: 1920, rootH: 1080, preset: "21:9" });
    expect(a.m0).toBe(b.m0);
  });
});

// ---------------------------------------------------------------------------
// Invalid inputs
// ---------------------------------------------------------------------------

describe("aspectFit generator — invalid inputs", () => {
  test("rootW out of range throws", () => {
    expect(() => aspectFit({ rootW: 0, rootH: 1080 })).toThrow(/rootW/);
    expect(() => aspectFit({ rootW: 10000, rootH: 1080 })).toThrow(/rootW/);
  });

  test("rootH out of range throws", () => {
    expect(() => aspectFit({ rootW: 1920, rootH: 0 })).toThrow(/rootH/);
    expect(() => aspectFit({ rootW: 1920, rootH: 5000 })).toThrow(/rootH/);
  });
});

// ---------------------------------------------------------------------------
// Atlas label emission — borders for template callers
// ---------------------------------------------------------------------------

describe("aspectFit — atlas tier labels", () => {
  test("silent tier returns no m0c", () => {
    const r = aspectFit({ rootW: 1920, rootH: 1080, preset: "1:1" });
    expect(r.m0c).toBeUndefined();
  });

  test("signposts tier returns no m0c (aspectFit's only landmark is the content frame — atlas is where the value lives)", () => {
    const r = aspectFit({ rootW: 1920, rootH: 1080, preset: "1:1", labels: "signposts" });
    expect(r.m0c).toBeUndefined();
  });

  test("atlas labels content + pillarbox sides for 1:1 in 16:9", () => {
    const { parseM0cFile } = require("@m0saic/dsl-file-formats");
    const r = aspectFit({ rootW: 1920, rootH: 1080, preset: "1:1", labels: "atlas" });
    expect(r.m0c).toBeDefined();
    const parsed = parseM0cFile(r.m0c!);
    const texts = Object.values(parsed.labels).map((l: any) => l.text).sort();
    expect(texts).toEqual(["content", "pillarbox-left", "pillarbox-right"]);
  });

  test("atlas labels content + letterbox sides for 16:9 in square", () => {
    const { parseM0cFile } = require("@m0saic/dsl-file-formats");
    const r = aspectFit({ rootW: 1080, rootH: 1080, preset: "16:9", labels: "atlas" });
    expect(r.m0c).toBeDefined();
    const parsed = parseM0cFile(r.m0c!);
    const texts = Object.values(parsed.labels).map((l: any) => l.text).sort();
    expect(texts).toEqual(["content", "letterbox-bottom", "letterbox-top"]);
  });

  test("atlas on an exact-fit (target matches root) labels only the content", () => {
    const { parseM0cFile } = require("@m0saic/dsl-file-formats");
    const r = aspectFit({ rootW: 1920, rootH: 1080, preset: "16:9", labels: "atlas" });
    expect(r.m0c).toBeDefined();
    const parsed = parseM0cFile(r.m0c!);
    const texts = Object.values(parsed.labels).map((l: any) => l.text);
    expect(texts).toEqual(["content"]);
  });
});
