import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import type { MosaicLavfiSource } from "@m0saic/types";
import { makeQrEyeChildDoc } from "./makeQrEyeChildDoc";

/**
 * Narrow MosaicDocument's heterogeneous `sources` (union including data
 * sources) to the lavfi tiles makeQrEyeChildDoc emits. Throws if any entry
 * isn't a lavfi source — the helper's contract guarantees they all are.
 */
function asLavfi(sources: ReadonlyArray<unknown>): MosaicLavfiSource[] {
  return sources.map((s, i) => {
    if (!s || typeof s !== "object" || (s as { type?: string }).type !== "lavfi") {
      throw new Error(`expected lavfi source at index ${i}`);
    }
    return s as MosaicLavfiSource;
  });
}

describe("makeQrEyeChildDoc — structure", () => {
  test("emits a valid MosaicDocument with 3 sources in document order", () => {
    const doc = makeQrEyeChildDoc({
      darkColor: "#000000",
      backgroundColor: "#ffffff",
    });
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.version).toBe(1);
    expect(doc.assets).toEqual({});
    expect(doc.sources).toHaveLength(3);
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
  });

  test("m0 contains exactly 3 renderable frames (outer, inner-light, center)", () => {
    const doc = makeQrEyeChildDoc({
      darkColor: "#000000",
      backgroundColor: "#ffffff",
    });
    // Use a 70×70 canvas (10 px/cell) so geometry checks are easy.
    const frames = parseM0StringToRenderFrames(String(doc.m0), 70, 70);
    expect(frames).toHaveLength(3);
  });

  test("frame geometry: outer 7/7, inner-light 5/7, center 3/7, all centered", () => {
    const doc = makeQrEyeChildDoc({
      darkColor: "#000000",
      backgroundColor: "#ffffff",
    });
    const frames = parseM0StringToRenderFrames(String(doc.m0), 70, 70);
    // Outer: full canvas.
    expect(frames[0]).toMatchObject({ x: 0, y: 0, width: 70, height: 70 });
    // Inner light: 50×50 centered → (10, 10).
    expect(frames[1]).toMatchObject({ x: 10, y: 10, width: 50, height: 50 });
    // Center: 30×30 centered → (20, 20).
    expect(frames[2]).toMatchObject({ x: 20, y: 20, width: 30, height: 30 });
  });
});

describe("makeQrEyeChildDoc — colors + rounding", () => {
  test("sources alternate dark / light / dark in document order", () => {
    const doc = makeQrEyeChildDoc({
      darkColor: "#222222",
      backgroundColor: "#eeeeee",
    });
    const colors = asLavfi(doc.sources).map((s) => s.color);
    expect(colors).toEqual(["#222222", "#eeeeee", "#222222"]);
  });

  test("default rounding is 0 (square corners) on all 3 layers", () => {
    const doc = makeQrEyeChildDoc({
      darkColor: "#000",
      backgroundColor: "#fff",
    });
    for (const s of asLavfi(doc.sources)) {
      expect(s.effects?.rounding?.borderRadius).toBe(0);
      expect(s.effects?.rounding?.cornerStyle).toBe("rounded");
    }
  });

  test("custom outerBorderRadius applied to outer + inner-light (defaults shared)", () => {
    const doc = makeQrEyeChildDoc({
      darkColor: "#000",
      backgroundColor: "#fff",
      outerBorderRadius: 0.3,
    });
    const sources = asLavfi(doc.sources);
    expect(sources[0].effects?.rounding?.borderRadius).toBe(0.3);
    expect(sources[1].effects?.rounding?.borderRadius).toBe(0.3);
    // Center dot still at default 0.
    expect(sources[2].effects?.rounding?.borderRadius).toBe(0);
  });

  test("custom innerDotBorderRadius applies independently", () => {
    const doc = makeQrEyeChildDoc({
      darkColor: "#000",
      backgroundColor: "#fff",
      outerBorderRadius: 0.3,
      innerDotBorderRadius: 1.0,
    });
    expect(asLavfi(doc.sources)[2].effects?.rounding?.borderRadius).toBe(1.0);
  });

  test("innerLightBorderRadius can be overridden independently of outerBorderRadius", () => {
    const doc = makeQrEyeChildDoc({
      darkColor: "#000",
      backgroundColor: "#fff",
      outerBorderRadius: 0.5,
      innerLightBorderRadius: 0.1,
    });
    const sources = asLavfi(doc.sources);
    expect(sources[0].effects?.rounding?.borderRadius).toBe(0.5);
    expect(sources[1].effects?.rounding?.borderRadius).toBe(0.1);
  });
});

describe("makeQrEyeChildDoc — canvas background", () => {
  test("canvas backgroundColor matches the inner-light colour (avoids black bleed through rounded corners)", () => {
    const doc = makeQrEyeChildDoc({
      darkColor: "#000",
      backgroundColor: "#ffffff",
    });
    expect(doc.backgroundColor).toBe("#ffffff");
  });

  test("dark mode: backgroundColor set to dark so rounded eye corners reveal black, not ffmpeg's default", () => {
    const doc = makeQrEyeChildDoc({
      darkColor: "#f97316",
      backgroundColor: "#000000",
    });
    expect(doc.backgroundColor).toBe("#000000");
  });
});

describe("makeQrEyeChildDoc — overlay threading", () => {
  test("outerOverlay attaches to the outer layer source only", () => {
    const overlay = { alpha: "0.5" };
    const doc = makeQrEyeChildDoc({
      darkColor: "#000",
      backgroundColor: "#fff",
      outerOverlay: overlay,
    });
    const sources = asLavfi(doc.sources);
    expect(sources[0].overlay).toEqual(overlay);
    expect(sources[1].overlay).toBeUndefined();
    expect(sources[2].overlay).toBeUndefined();
  });

  test("centerOverlay attaches to the center dot source only", () => {
    const overlay = { alpha: "min(1,t)" };
    const doc = makeQrEyeChildDoc({
      darkColor: "#000",
      backgroundColor: "#fff",
      centerOverlay: overlay,
    });
    const sources = asLavfi(doc.sources);
    expect(sources[0].overlay).toBeUndefined();
    expect(sources[1].overlay).toBeUndefined();
    expect(sources[2].overlay).toEqual(overlay);
  });
});

describe("makeQrEyeChildDoc — determinism", () => {
  test("same input → identical m0 + identical source shape", () => {
    const a = makeQrEyeChildDoc({ darkColor: "#000", backgroundColor: "#fff" });
    const b = makeQrEyeChildDoc({ darkColor: "#000", backgroundColor: "#fff" });
    expect(String(a.m0)).toBe(String(b.m0));
    expect(a.sources).toEqual(b.sources);
  });
});
