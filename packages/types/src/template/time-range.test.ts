import { isMosaicTimeRangeMs, type MosaicTimeRangeMs } from "./time-range";

describe("MosaicTimeRangeMs", () => {
  test("accepts the full field set and stays JSON-serializable", () => {
    const range: MosaicTimeRangeMs = { startMs: 500, endMs: 2000, label: "finale" };
    expect(JSON.parse(JSON.stringify(range))).toEqual(range);
  });

  test("guard accepts minimal and labeled entries", () => {
    expect(isMosaicTimeRangeMs({ startMs: 0, endMs: 1 })).toBe(true);
    expect(isMosaicTimeRangeMs({ startMs: 500, endMs: 2000, label: "finale" })).toBe(true);
  });

  test("guard rejects non-objects", () => {
    expect(isMosaicTimeRangeMs(null)).toBe(false);
    expect(isMosaicTimeRangeMs(undefined)).toBe(false);
    expect(isMosaicTimeRangeMs([])).toBe(false);
    expect(isMosaicTimeRangeMs("500-2000")).toBe(false);
    expect(isMosaicTimeRangeMs(1500)).toBe(false);
  });

  test("guard rejects missing, non-finite, or negative ms", () => {
    expect(isMosaicTimeRangeMs({})).toBe(false);
    expect(isMosaicTimeRangeMs({ startMs: 0 })).toBe(false);
    expect(isMosaicTimeRangeMs({ endMs: 1000 })).toBe(false);
    expect(isMosaicTimeRangeMs({ startMs: NaN, endMs: 1000 })).toBe(false);
    expect(isMosaicTimeRangeMs({ startMs: 0, endMs: Infinity })).toBe(false);
    expect(isMosaicTimeRangeMs({ startMs: -1, endMs: 1000 })).toBe(false);
    expect(isMosaicTimeRangeMs({ startMs: "0", endMs: 1000 })).toBe(false);
  });

  test("guard rejects inverted and zero-width ranges", () => {
    expect(isMosaicTimeRangeMs({ startMs: 1000, endMs: 1000 })).toBe(false);
    expect(isMosaicTimeRangeMs({ startMs: 2000, endMs: 500 })).toBe(false);
  });

  test("guard rejects non-string labels but tolerates unknown extra keys", () => {
    expect(isMosaicTimeRangeMs({ startMs: 0, endMs: 1, label: 3 })).toBe(false);
    expect(isMosaicTimeRangeMs({ startMs: 0, endMs: 1, speedFactor: 2 })).toBe(true);
  });
});
