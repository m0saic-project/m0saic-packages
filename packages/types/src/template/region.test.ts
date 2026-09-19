import { isMosaicRegionRect, type MosaicRegionsValue } from "./region";

describe("MosaicRegionRect", () => {
  test("wire value stays JSON-serializable", () => {
    const value: MosaicRegionsValue = {
      canvas: { w: 1920, h: 1080 },
      regions: [
        { x: 600, y: 300, w: 400, h: 200 },
        { kind: "rect", x: 120, y: 80, w: 240, h: 120 },
      ],
    };
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  test("guard accepts minimal and kind-tagged entries", () => {
    expect(isMosaicRegionRect({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isMosaicRegionRect({ kind: "rect", x: 600, y: 300, w: 400, h: 200 })).toBe(true);
  });

  test("guard rejects non-objects", () => {
    expect(isMosaicRegionRect(null)).toBe(false);
    expect(isMosaicRegionRect(undefined)).toBe(false);
    expect(isMosaicRegionRect([])).toBe(false);
    expect(isMosaicRegionRect("600,300,400,200")).toBe(false);
    expect(isMosaicRegionRect(42)).toBe(false);
  });

  test("guard rejects unknown kinds", () => {
    expect(isMosaicRegionRect({ kind: "polygon", x: 0, y: 0, w: 1, h: 1 })).toBe(false);
    expect(isMosaicRegionRect({ kind: 7, x: 0, y: 0, w: 1, h: 1 })).toBe(false);
  });

  test("guard rejects missing, non-finite, or negative coords", () => {
    expect(isMosaicRegionRect({})).toBe(false);
    expect(isMosaicRegionRect({ x: 0, y: 0, w: 1 })).toBe(false);
    expect(isMosaicRegionRect({ x: -1, y: 0, w: 1, h: 1 })).toBe(false);
    expect(isMosaicRegionRect({ x: 0, y: -5, w: 1, h: 1 })).toBe(false);
    expect(isMosaicRegionRect({ x: NaN, y: 0, w: 1, h: 1 })).toBe(false);
    expect(isMosaicRegionRect({ x: 0, y: 0, w: Infinity, h: 1 })).toBe(false);
    expect(isMosaicRegionRect({ x: "0", y: 0, w: 1, h: 1 })).toBe(false);
  });

  test("guard rejects zero-width and zero-height rects", () => {
    expect(isMosaicRegionRect({ x: 0, y: 0, w: 0, h: 10 })).toBe(false);
    expect(isMosaicRegionRect({ x: 0, y: 0, w: 10, h: 0 })).toBe(false);
    expect(isMosaicRegionRect({ x: 0, y: 0, w: -3, h: 10 })).toBe(false);
  });

  test("guard tolerates unknown extra keys", () => {
    expect(isMosaicRegionRect({ x: 0, y: 0, w: 1, h: 1, label: "face" })).toBe(true);
  });
});
