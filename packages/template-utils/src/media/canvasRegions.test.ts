import {
  parseRegionsValue,
  regionRectsFromM0,
  regionsToCompositeMask,
  regionsToMaskPathD,
  resolveRegionsToPx,
} from "./canvasRegions";

describe("parseRegionsValue", () => {
  test("reads the wrapper object with canvas", () => {
    const result = parseRegionsValue({
      canvas: { w: 1920, h: 1080 },
      regions: [{ x: 600, y: 300, w: 400, h: 200 }],
    });
    expect(result).toEqual({
      ok: true,
      canvas: { w: 1920, h: 1080 },
      regions: [{ x: 600, y: 300, w: 400, h: 200 }],
    });
  });

  test("reads a bare array (hand-authored shorthand, no canvas)", () => {
    const result = parseRegionsValue([{ x: 10, y: 20, w: 30, h: 40 }]);
    expect(result).toEqual({ ok: true, regions: [{ x: 10, y: 20, w: 30, h: 40 }] });
  });

  test("reads a JSON-string-encoded value", () => {
    const result = parseRegionsValue('{"canvas":{"w":100,"h":50},"regions":[{"x":1,"y":2,"w":3,"h":4}]}');
    expect(result).toEqual({
      ok: true,
      canvas: { w: 100, h: 50 },
      regions: [{ x: 1, y: 2, w: 3, h: 4 }],
    });
  });

  test("coerces numeric-string px fields and drops unknown keys", () => {
    const result = parseRegionsValue({
      regions: [{ kind: "rect", x: "600", y: "300", w: "400", h: "200", label: "face" }],
    });
    expect(result).toEqual({ ok: true, regions: [{ x: 600, y: 300, w: 400, h: 200 }] });
  });

  test("absent values and empty wrappers parse as zero regions (base state)", () => {
    expect(parseRegionsValue(null)).toEqual({ ok: true, regions: [] });
    expect(parseRegionsValue(undefined)).toEqual({ ok: true, regions: [] });
    expect(parseRegionsValue({})).toEqual({ ok: true, regions: [] });
    expect(parseRegionsValue({ canvas: { w: 100, h: 50 } })).toEqual({
      ok: true,
      canvas: { w: 100, h: 50 },
      regions: [],
    });
  });

  test("rejects unparsable JSON and non-array payloads", () => {
    expect(parseRegionsValue("not json").ok).toBe(false);
    expect(parseRegionsValue(42).ok).toBe(false);
    expect(parseRegionsValue({ regions: "nope" }).ok).toBe(false);
  });

  test("rejects a wrapper with stray keys and no regions array (typo guard)", () => {
    const result = parseRegionsValue({ regionz: [{ x: 0, y: 0, w: 10, h: 10 }] });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("regionz") });
  });

  test("rejects entries without coercible coords, naming the entry", () => {
    const result = parseRegionsValue({ regions: [{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5 }] });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Region #2") });
  });

  test("rejects unknown shape kinds", () => {
    const result = parseRegionsValue({ regions: [{ kind: "polygon", x: 0, y: 0, w: 10, h: 10 }] });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('unknown kind "polygon"') });
  });

  test("rejects a malformed canvas", () => {
    expect(parseRegionsValue({ canvas: { w: 0, h: 100 }, regions: [] }).ok).toBe(false);
    expect(parseRegionsValue({ canvas: "big", regions: [] }).ok).toBe(false);
  });

  test("empty regions array parses ok (no selection)", () => {
    expect(parseRegionsValue({ regions: [] })).toEqual({ ok: true, regions: [] });
    expect(parseRegionsValue([])).toEqual({ ok: true, regions: [] });
  });

  test("m0-native flavor: bare m0 string and { m0 } wrapper", () => {
    expect(parseRegionsValue("1")).toEqual({ ok: true, regions: [], m0: "1" });
    expect(parseRegionsValue(" 1{1} ")).toEqual({ ok: true, regions: [], m0: "1{1}" });
    expect(parseRegionsValue({ m0: "1" })).toEqual({ ok: true, regions: [], m0: "1" });
    expect(parseRegionsValue({ m0: "definitely not m0" })).toEqual({
      ok: false,
      error: expect.stringContaining("not a valid m0"),
    });
    // JSON payloads still win the string path (never valid m0).
    expect(parseRegionsValue('{"regions":[{"x":1,"y":2,"w":3,"h":4}]}')).toEqual({
      ok: true,
      regions: [{ x: 1, y: 2, w: 3, h: 4 }],
    });
  });
});

describe("rect-local masks (maskPath / maskStrokes)", () => {
  const ELLIPSE = "M50 0A50 50 0 1 0 50 100A50 50 0 1 0 50 0Z";

  test("parse carries mask fields; malformed masks ERROR (never dropped)", () => {
    const ok = parseRegionsValue({
      regions: [{ x: 10, y: 20, w: 100, h: 100, maskPath: ELLIPSE }],
    });
    expect(ok).toEqual({
      ok: true,
      regions: [{ x: 10, y: 20, w: 100, h: 100, maskPath: ELLIPSE }],
    });

    const strokes = parseRegionsValue({
      regions: [
        { x: 0, y: 0, w: 50, h: 50, maskStrokes: [{ d: "M5 5L45 45", width: 8 }] },
      ],
    });
    expect(strokes.ok).toBe(true);

    for (const badMask of [
      { maskPath: "" },
      { maskPath: 42 },
      { maskStrokes: [] },
      { maskStrokes: [{ d: "", width: 5 }] },
      { maskStrokes: [{ d: "M0 0L1 1", width: 0 }] },
    ]) {
      const result = parseRegionsValue({ regions: [{ x: 0, y: 0, w: 10, h: 10, ...badMask }] });
      expect(result.ok).toBe(false);
    }
  });

  test("resolve carries the mask with the AUTHORED rect as its bounds", () => {
    const verdicts = resolveRegionsToPx(
      {
        canvas: { w: 1920, h: 1080 },
        regions: [{ x: 960, y: 540, w: 480, h: 270, maskPath: ELLIPSE }],
      },
      { width: 1280, height: 720 },
    );
    expect(verdicts).toEqual([
      {
        ok: true,
        x: 640,
        y: 360,
        w: 320,
        h: 180,
        // Path space = AUTHORED rect dims — the engine's bounds-scaling
        // recovers the shape at the resolved cell size.
        mask: { path: ELLIPSE, bounds: { w: 480, h: 270 } },
      },
    ]);
  });

  test("composite mask: plain rects stay subpaths, masked rects become placed parts", () => {
    const composite = regionsToCompositeMask([
      { x: 0, y: 0, w: 100, h: 50 },
      {
        x: 200,
        y: 300,
        w: 240,
        h: 135,
        mask: { path: ELLIPSE, bounds: { w: 480, h: 270 } },
      },
    ]);
    expect(composite).toEqual({
      localPath: "M0 0H100V50H0Z",
      parts: [
        {
          d: ELLIPSE,
          translate: { x: 200, y: 300 },
          scale: { x: 0.5, y: 0.5 },
          // Region rect as the part's clip: brush-stroke width that
          // overhangs the rect is cut like a real-geometry cell edge.
          clip: { x: 200, y: 300, width: 240, height: 135 },
        },
      ],
    });
  });

  test("composite mask without any masked regions has NO parts (legacy shape)", () => {
    const composite = regionsToCompositeMask([{ x: 1, y: 2, w: 3, h: 4 }]);
    expect(composite).toEqual({ localPath: "M1 2H4V6H1Z" });
  });
});

describe("regionRectsFromM0", () => {
  test("leaf cells at the target canvas become rects", () => {
    expect(regionRectsFromM0("1", { width: 1280, height: 720 })).toEqual([
      { x: 0, y: 0, w: 1280, h: 720 },
    ]);
  });

  test("invalid m0 degrades to no rects (callers validate first)", () => {
    expect(regionRectsFromM0("definitely not m0", { width: 100, height: 100 })).toEqual([]);
  });
});

describe("resolveRegionsToPx", () => {
  test("identity when the value carried no canvas", () => {
    const verdicts = resolveRegionsToPx(
      { regions: [{ x: 600, y: 300, w: 400, h: 200 }] },
      { width: 1920, height: 1080 },
    );
    expect(verdicts).toEqual([{ ok: true, x: 600, y: 300, w: 400, h: 200 }]);
  });

  test("rescales authored canvas onto a different target", () => {
    const verdicts = resolveRegionsToPx(
      { canvas: { w: 1920, h: 1080 }, regions: [{ x: 960, y: 540, w: 480, h: 270 }] },
      { width: 1280, height: 720 },
    );
    expect(verdicts).toEqual([{ ok: true, x: 640, y: 360, w: 320, h: 180 }]);
  });

  test("clamps overshoot into the canvas", () => {
    const verdicts = resolveRegionsToPx(
      { regions: [{ x: 1800, y: 1000, w: 400, h: 300 }] },
      { width: 1920, height: 1080 },
    );
    expect(verdicts).toEqual([{ ok: true, x: 1800, y: 1000, w: 120, h: 80 }]);
  });

  test("rejects regions entirely outside the canvas, keeping order", () => {
    const outside = { x: 5000, y: 0, w: 100, h: 100 };
    const verdicts = resolveRegionsToPx(
      { regions: [outside, { x: 0, y: 0, w: 10, h: 10 }] },
      { width: 1920, height: 1080 },
    );
    expect(verdicts[0]).toEqual({ ok: false, reason: expect.stringContaining("outside"), region: outside });
    expect(verdicts[1]).toEqual({ ok: true, x: 0, y: 0, w: 10, h: 10 });
  });

  test("rejects degenerate sizes", () => {
    const flat = { x: 10, y: 10, w: 0, h: 50 };
    const verdicts = resolveRegionsToPx({ regions: [flat] }, { width: 100, height: 100 });
    expect(verdicts[0]).toEqual({ ok: false, reason: expect.stringContaining("non-positive"), region: flat });
  });

  test("rounds fractional inputs to integer px via edge rounding", () => {
    const verdicts = resolveRegionsToPx(
      { canvas: { w: 3, h: 3 }, regions: [{ x: 1, y: 1, w: 1, h: 1 }] },
      { width: 100, height: 100 },
    );
    // edges: 1/3*100=33.33→33, 2/3*100=66.67→67
    expect(verdicts).toEqual([{ ok: true, x: 33, y: 33, w: 34, h: 34 }]);
  });
});

describe("regionsToMaskPathD", () => {
  test("emits one closed subpath per rect, space-joined", () => {
    expect(
      regionsToMaskPathD([
        { x: 600, y: 300, w: 400, h: 200 },
        { x: 120, y: 80, w: 240, h: 120 },
      ]),
    ).toBe("M600 300H1000V500H600Z M120 80H360V200H120Z");
  });

  test("empty input emits an empty path", () => {
    expect(regionsToMaskPathD([])).toBe("");
  });
});
