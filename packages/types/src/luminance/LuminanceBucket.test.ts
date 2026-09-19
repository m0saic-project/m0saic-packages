import type { LuminanceBucket, RegionPctRect } from "./LuminanceBucket";

describe("LuminanceBucket", () => {
  it("accepts well-formed buckets at compile time and runtime", () => {
    const b: LuminanceBucket = { startMs: 0, endMs: 2000, avgLuma: 192 };
    expect(b.endMs).toBeGreaterThan(b.startMs);
    expect(b.avgLuma).toBeGreaterThanOrEqual(0);
    expect(b.avgLuma).toBeLessThanOrEqual(255);
  });

  it("supports a sequence of contiguous buckets covering a clip end-to-end", () => {
    const buckets: LuminanceBucket[] = [
      { startMs: 0, endMs: 1500, avgLuma: 210 },
      { startMs: 1500, endMs: 3200, avgLuma: 48 },
      { startMs: 3200, endMs: 5000, avgLuma: 175 },
    ];
    for (let i = 1; i < buckets.length; i += 1) {
      expect(buckets[i]!.startMs).toBe(buckets[i - 1]!.endMs);
    }
    expect(buckets[0]!.startMs).toBe(0);
    expect(buckets[buckets.length - 1]!.endMs).toBe(5000);
  });

  it("lets callers derive a binary light/dark classification at their own threshold", () => {
    const buckets: LuminanceBucket[] = [
      { startMs: 0, endMs: 1000, avgLuma: 220 },
      { startMs: 1000, endMs: 2000, avgLuma: 30 },
      { startMs: 2000, endMs: 3000, avgLuma: 140 },
    ];
    const classifyAt = (threshold: number) =>
      buckets.map((b) => b.avgLuma > threshold);
    expect(classifyAt(128)).toEqual([true, false, true]);
    expect(classifyAt(160)).toEqual([true, false, false]);
  });
});

describe("RegionPctRect", () => {
  it("accepts a fractional rectangle within the unit square", () => {
    const r: RegionPctRect = { xPct: 0.85, yPct: 0.85, wPct: 0.12, hPct: 0.12 };
    expect(r.xPct + r.wPct).toBeLessThanOrEqual(1);
    expect(r.yPct + r.hPct).toBeLessThanOrEqual(1);
  });
});
