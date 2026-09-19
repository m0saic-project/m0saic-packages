import { evenRound, planTrickplay } from "./plan";

const BASE = {
  durationMs: 300_000,
  srcWidth: 1280,
  srcHeight: 720,
  frameMs: 33,
  intervalSec: 10,
  tileWidth: 320,
  cols: 10,
  rowsPerSheet: 10,
};

describe("evenRound", () => {
  it("rounds to the nearest even integer, floored at 2", () => {
    expect(evenRound(320)).toBe(320);
    expect(evenRound(321)).toBe(322);
    expect(evenRound(179.9)).toBe(180);
    expect(evenRound(180.07)).toBe(180);
    expect(evenRound(1)).toBe(2);
    expect(evenRound(0)).toBe(2);
  });
});

describe("planTrickplay — fixed cadence", () => {
  it("300s @ 10s interval → 30 thumbs at t_i = i·10000", () => {
    const p = planTrickplay(BASE);
    expect(p.thumbnailCount).toBe(30);
    expect(p.intervalMs).toBe(10_000);
    expect(p.timestampsMs).toEqual(
      Array.from({ length: 30 }, (_, i) => i * 10_000),
    );
    expect(p.timestampsMs[0]).toBe(0);
  });

  it("duration not a multiple of interval → extra thumb, last cue ends at duration", () => {
    const p = planTrickplay({ ...BASE, durationMs: 305_000 });
    expect(p.thumbnailCount).toBe(31);
    const last = p.cues[p.cues.length - 1];
    expect(last.startMs).toBe(300_000);
    expect(last.endMs).toBe(305_000);
  });

  it("clamps the last seek to one frame before EOF", () => {
    const p = planTrickplay({ ...BASE, durationMs: 100_001 });
    expect(p.thumbnailCount).toBe(11);
    expect(p.timestampsMs[10]).toBe(100_001 - 33);
    expect(p.timestampsMs[9]).toBe(90_000);
  });

  it("very short clip → a single thumb covering the whole timeline", () => {
    const p = planTrickplay({ ...BASE, durationMs: 5_000 });
    expect(p.thumbnailCount).toBe(1);
    expect(p.timestampsMs).toEqual([0]);
    expect(p.sheets).toHaveLength(1);
    expect(p.sheets[0]).toMatchObject({ rows: 1, thumbCount: 1 });
    expect(p.cues[0]).toMatchObject({ startMs: 0, endMs: 5_000, x: 0, y: 0 });
  });
});

describe("planTrickplay — tile dims", () => {
  it("derives an even tile height from the source aspect", () => {
    expect(planTrickplay(BASE).tileHeight).toBe(180); // 320 · 720/1280
    expect(planTrickplay(BASE).tileWidth).toBe(320);
  });

  it("even-rounds odd source aspects and odd tile widths", () => {
    const odd = planTrickplay({ ...BASE, srcWidth: 853, srcHeight: 480 });
    expect(odd.tileHeight % 2).toBe(0);
    expect(odd.tileHeight).toBe(180); // 320 · 480/853 ≈ 180.07 → 180
    const oddW = planTrickplay({ ...BASE, tileWidth: 321 });
    expect(oddW.tileWidth).toBe(322);
  });
});

describe("planTrickplay — sheet partition", () => {
  it("splits thumbs across sheets and trims the last sheet's rows", () => {
    // 15 thumbs into 4×2 sheets → 8 + 7.
    const p = planTrickplay({
      ...BASE,
      durationMs: 300_000,
      intervalSec: 20,
      cols: 4,
      rowsPerSheet: 2,
      tileWidth: 160,
    });
    expect(p.thumbnailCount).toBe(15);
    expect(p.sheets).toHaveLength(2);
    expect(p.sheets[0]).toMatchObject({
      index: 0,
      rows: 2,
      thumbCount: 8,
      firstThumbIndex: 0,
      width: 4 * 160,
      height: 2 * 90, // tileHeight = 160 · 720/1280 = 90
    });
    expect(p.sheets[1]).toMatchObject({
      index: 1,
      rows: 2, // ceil(7/4)
      thumbCount: 7,
      firstThumbIndex: 8,
      height: 2 * 90,
    });
  });

  it("cue rects restart row-major on each sheet", () => {
    const p = planTrickplay({
      ...BASE,
      intervalSec: 20,
      cols: 4,
      rowsPerSheet: 2,
      tileWidth: 160,
    });
    // Cue 8 = first thumb of sheet 2 → back at the sheet origin.
    expect(p.cues[8]).toMatchObject({ sheetIndex: 1, x: 0, y: 0, w: 160, h: 90 });
    // Cue 5 = second thumb of row 2 on sheet 1.
    expect(p.cues[5]).toMatchObject({ sheetIndex: 0, x: 160, y: 90 });
    expect(p.cues[8].startMs).toBe(160_000);
  });
});

describe("planTrickplay — validation + determinism", () => {
  it("throws on non-positive duration or dims", () => {
    expect(() => planTrickplay({ ...BASE, durationMs: 0 })).toThrow();
    expect(() => planTrickplay({ ...BASE, durationMs: -1 })).toThrow();
    expect(() => planTrickplay({ ...BASE, srcWidth: 0 })).toThrow();
    expect(() => planTrickplay({ ...BASE, srcHeight: 0 })).toThrow();
  });

  it("identical inputs produce identical plans", () => {
    expect(planTrickplay(BASE)).toEqual(planTrickplay(BASE));
  });
});
