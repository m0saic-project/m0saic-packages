import { normalizeTimeRanges, parseTimeRangesValue } from "./timeRanges";

describe("parseTimeRangesValue", () => {
  it("accepts a real array and preserves order + labels", () => {
    const res = parseTimeRangesValue([
      { startMs: 3000, endMs: 4500, label: "finale" },
      { startMs: 500, endMs: 2000 },
    ]);
    expect(res).toEqual({
      ok: true,
      ranges: [
        { startMs: 3000, endMs: 4500, label: "finale" },
        { startMs: 500, endMs: 2000 },
      ],
    });
  });

  it("accepts a JSON-string-encoded array", () => {
    const res = parseTimeRangesValue('[{"startMs":500,"endMs":2000}]');
    expect(res).toEqual({ ok: true, ranges: [{ startMs: 500, endMs: 2000 }] });
  });

  it("coerces numeric-string ms fields and rounds fractional ms", () => {
    const res = parseTimeRangesValue([{ startMs: "500", endMs: 2000.6 }]);
    expect(res).toEqual({ ok: true, ranges: [{ startMs: 500, endMs: 2001 }] });
  });

  it("drops unknown keys and non-string / empty labels", () => {
    const res = parseTimeRangesValue([
      { startMs: 0, endMs: 1000, speedFactor: 2, label: 7 },
      { startMs: 0, endMs: 1000, label: "  " },
    ]);
    expect(res).toEqual({
      ok: true,
      ranges: [
        { startMs: 0, endMs: 1000 },
        { startMs: 0, endMs: 1000 },
      ],
    });
  });

  it("an empty array parses ok (emptiness is the caller's policy)", () => {
    expect(parseTimeRangesValue([])).toEqual({ ok: true, ranges: [] });
  });

  it("rejects missing values, bad JSON, non-arrays, and bad entries by index", () => {
    expect(parseTimeRangesValue(undefined).ok).toBe(false);
    expect(parseTimeRangesValue(null).ok).toBe(false);
    expect(parseTimeRangesValue("{nope").ok).toBe(false);
    expect(parseTimeRangesValue({ startMs: 0, endMs: 1 }).ok).toBe(false);
    expect(parseTimeRangesValue(42).ok).toBe(false);

    const badEntry = parseTimeRangesValue([{ startMs: 0, endMs: 1000 }, "x"]);
    expect(badEntry).toEqual({ ok: false, error: "Range #2 must be an object with startMs and endMs." });

    const noStart = parseTimeRangesValue([{ endMs: 1000 }]);
    expect(noStart).toEqual({ ok: false, error: "Range #1 is missing a numeric startMs." });

    const nanEnd = parseTimeRangesValue([{ startMs: 0, endMs: "not-a-number" }]);
    expect(nanEnd).toEqual({ ok: false, error: "Range #1 is missing a numeric endMs." });
  });
});

describe("normalizeTimeRanges", () => {
  const DUR = 5000;

  it("passes in-bounds ranges through, preserving order and labels", () => {
    const verdicts = normalizeTimeRanges(
      [
        { startMs: 3000, endMs: 4500, label: "finale" },
        { startMs: 500, endMs: 2000 },
      ],
      DUR,
    );
    expect(verdicts).toEqual([
      { ok: true, startMs: 3000, endMs: 4500, label: "finale" },
      { ok: true, startMs: 500, endMs: 2000 },
    ]);
  });

  it("rejects inverted and zero-width ranges before clamping", () => {
    const verdicts = normalizeTimeRanges(
      [
        { startMs: 2000, endMs: 500 },
        { startMs: 1000, endMs: 1000 },
      ],
      DUR,
    );
    expect(verdicts.map((v) => v.ok)).toEqual([false, false]);
  });

  it("clamps out-of-bounds ranges into the source duration", () => {
    const verdicts = normalizeTimeRanges([{ startMs: -100, endMs: 99_999 }], DUR);
    expect(verdicts).toEqual([{ ok: true, startMs: 0, endMs: DUR }]);
  });

  it("rejects ranges entirely outside the source", () => {
    const verdicts = normalizeTimeRanges([{ startMs: 6000, endMs: 9000 }], DUR);
    expect(verdicts[0].ok).toBe(false);
  });

  it("allows overlapping and duplicate ranges", () => {
    const verdicts = normalizeTimeRanges(
      [
        { startMs: 0, endMs: 3000 },
        { startMs: 1000, endMs: 2000 },
        { startMs: 0, endMs: 3000 },
      ],
      DUR,
    );
    expect(verdicts.every((v) => v.ok)).toBe(true);
  });
});
