import type { MosaicTimedCue } from "@m0saic/types";
import { parseCueTrackValue, resolveCueWindows, resolveWordSpans, type CueWindowVerdict } from "./timedCues";

describe("parseCueTrackValue", () => {
  test("absent value is the valid base state (no cues yet), not an error", () => {
    expect(parseCueTrackValue(undefined)).toEqual({ ok: true, cues: [] });
    expect(parseCueTrackValue(null)).toEqual({ ok: true, cues: [] });
  });

  test("reads a real array and preserves order", () => {
    const res = parseCueTrackValue([
      { text: "First line I sing", startMs: 12040 },
      { text: "Second line" },
      { text: "Bridge", startMs: 30500, endMs: 33000 },
    ]);
    expect(res).toEqual({
      ok: true,
      cues: [
        { text: "First line I sing", startMs: 12040 },
        { text: "Second line" },
        { text: "Bridge", startMs: 30500, endMs: 33000 },
      ],
    });
  });

  test("reads a JSON-string-encoded array (hand-authored --props)", () => {
    const res = parseCueTrackValue('[{"text":"one","startMs":0},{"text":"two"}]');
    expect(res).toEqual({ ok: true, cues: [{ text: "one", startMs: 0 }, { text: "two" }] });
  });

  test("coerces numeric-string ms fields and rounds to integers", () => {
    const res = parseCueTrackValue([{ text: "x", startMs: "1500.4", endMs: 2000.6 }]);
    expect(res).toEqual({ ok: true, cues: [{ text: "x", startMs: 1500, endMs: 2001 }] });
  });

  test("drops unknown extra keys and an endMs without a startMs (words is now a KNOWN key)", () => {
    const res = parseCueTrackValue([
      { text: "future", startMs: 10, chords: ["Am"] },
      { text: "untimed with stray end", endMs: 9000 },
    ]);
    expect(res).toEqual({
      ok: true,
      cues: [{ text: "future", startMs: 10 }, { text: "untimed with stray end" }],
    });
  });

  test("rejects unparsable JSON and non-array payloads", () => {
    expect(parseCueTrackValue("{not json")).toMatchObject({ ok: false });
    expect(parseCueTrackValue({ text: "one" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("array"),
    });
  });

  test("typed errors name the first offending entry", () => {
    expect(parseCueTrackValue([{ text: "fine", startMs: 0 }, "nope"])).toMatchObject({
      ok: false,
      error: expect.stringContaining("Cue #2"),
    });
    expect(parseCueTrackValue([{ startMs: 0 }])).toMatchObject({
      ok: false,
      error: expect.stringContaining("Cue #1 is missing text"),
    });
    expect(parseCueTrackValue([{ text: "   " }])).toMatchObject({
      ok: false,
      error: expect.stringContaining("Cue #1 is missing text"),
    });
    expect(parseCueTrackValue([{ text: "x", startMs: "abc" }])).toMatchObject({
      ok: false,
      error: expect.stringContaining("Cue #1 has a non-numeric startMs"),
    });
    expect(parseCueTrackValue([{ text: "x", startMs: 0, endMs: "abc" }])).toMatchObject({
      ok: false,
      error: expect.stringContaining("Cue #1 has a non-numeric endMs"),
    });
  });

  test("is deterministic (same input → deep-equal output)", () => {
    const input = [{ text: "a", startMs: 1 }, { text: "b" }];
    expect(parseCueTrackValue(input)).toEqual(parseCueTrackValue(input));
  });
});

describe("resolveCueWindows", () => {
  const DUR = 180_000;

  const okWindows = (verdicts: CueWindowVerdict[]) =>
    verdicts.map((v) => (v.ok ? [v.startMs, v.endMs] : v.reason));

  test("infers each end from the next timed cue's start; last cue runs to the output end", () => {
    const cues: MosaicTimedCue[] = [
      { text: "one", startMs: 1000 },
      { text: "two", startMs: 5000 },
      { text: "three", startMs: 12000 },
    ];
    expect(okWindows(resolveCueWindows(cues, { durationMs: DUR }))).toEqual([
      [1000, 5000],
      [5000, 12000],
      [12000, DUR],
    ]);
  });

  test("untimed neighbors are transparent to inference and verdict as untimed", () => {
    const cues: MosaicTimedCue[] = [
      { text: "one", startMs: 1000 },
      { text: "not yet" },
      { text: "three", startMs: 12000 },
    ];
    const verdicts = resolveCueWindows(cues, { durationMs: DUR });
    expect(okWindows(verdicts)).toEqual([[1000, 12000], "untimed", [12000, DUR]]);
    expect(verdicts[1]).toEqual({ ok: false, reason: "untimed", cue: { text: "not yet" } });
  });

  test("an explicit endMs wins over inference and may overlap the next cue (held line)", () => {
    const cues: MosaicTimedCue[] = [
      { text: "held", startMs: 1000, endMs: 8000 },
      { text: "next", startMs: 5000 },
    ];
    expect(okWindows(resolveCueWindows(cues, { durationMs: DUR }))).toEqual([
      [1000, 8000],
      [5000, DUR],
    ]);
  });

  test("clamps: negative starts to 0, ends to the output duration", () => {
    const cues: MosaicTimedCue[] = [
      { text: "early", startMs: -500 },
      { text: "long tail", startMs: 179_000, endMs: 500_000 },
    ];
    expect(okWindows(resolveCueWindows(cues, { durationMs: DUR }))).toEqual([
      [0, 179_000],
      [179_000, DUR],
    ]);
  });

  test("a cue starting at/past the output end is outside (skippable), not an error on neighbors", () => {
    const cues: MosaicTimedCue[] = [
      { text: "in", startMs: 170_000 },
      { text: "beyond", startMs: 200_000 },
    ];
    const verdicts = resolveCueWindows(cues, { durationMs: DUR });
    // The in-range cue still infers its end from the raw next timed start,
    // clamped back into the render.
    expect(okWindows(verdicts)).toEqual([[170_000, DUR], "outside"]);
  });

  test("ordering violations surface as inverted instead of being hidden", () => {
    const outOfOrder: MosaicTimedCue[] = [
      { text: "late", startMs: 9000 },
      { text: "earlier", startMs: 4000 },
    ];
    expect(okWindows(resolveCueWindows(outOfOrder, { durationMs: DUR }))).toEqual([
      "inverted",
      [4000, DUR],
    ]);
    const badExplicitEnd: MosaicTimedCue[] = [{ text: "x", startMs: 5000, endMs: 5000 }];
    expect(okWindows(resolveCueWindows(badExplicitEnd, { durationMs: DUR }))).toEqual(["inverted"]);
  });

  test("preserves order (verdict i is cue i) and never sorts", () => {
    const cues: MosaicTimedCue[] = [
      { text: "b", startMs: 5000 },
      { text: "a", startMs: 1000 },
    ];
    const verdicts = resolveCueWindows(cues, { durationMs: DUR });
    expect(verdicts[0]).toMatchObject({ ok: false, reason: "inverted" });
    expect(verdicts[1]).toMatchObject({ ok: true, startMs: 1000 });
  });

  test("empty input → empty verdicts; determinism", () => {
    expect(resolveCueWindows([], { durationMs: DUR })).toEqual([]);
    const cues: MosaicTimedCue[] = [{ text: "one", startMs: 1000 }, { text: "two" }];
    expect(resolveCueWindows(cues, { durationMs: DUR })).toEqual(
      resolveCueWindows(cues, { durationMs: DUR }),
    );
  });
});

describe("word deepening (karaoke)", () => {
  const DUR = 180_000;
  test("parser carries words through, coercing ms and dropping them from untimed lines", () => {
    const r = parseCueTrackValue([
      { text: "two words", startMs: 1000, words: [{ startMs: "1000", endMs: 1400 }, { startMs: 1500 }] },
      { text: "untimed line", words: [{ startMs: 0 }] },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cues[0].words).toEqual([{ startMs: 1000, endMs: 1400 }, { startMs: 1500 }]);
    expect(r.cues[1].words).toBeUndefined(); // words on an untimed line are dropped
  });

  test("parser errors on hard-malformed words; word end-without-start is dropped", () => {
    expect(parseCueTrackValue([{ text: "x", startMs: 0, words: "soon" }]).ok).toBe(false);
    expect(parseCueTrackValue([{ text: "x", startMs: 0, words: [{ startMs: "abc" }] }]).ok).toBe(false);
    const r = parseCueTrackValue([{ text: "x", startMs: 0, words: [{ endMs: 900 }] }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cues[0].words).toEqual([{}]);
  });

  test("resolveCueWindows passes words through on ok verdicts", () => {
    const verdicts = resolveCueWindows(
      [{ text: "two words", startMs: 1000, words: [{ startMs: 1000 }, { startMs: 1500 }] }],
      { durationMs: DUR },
    );
    expect(verdicts[0]).toMatchObject({ ok: true, words: [{ startMs: 1000 }, { startMs: 1500 }] });
  });

  test("resolveWordSpans: tokens from the line text, sparse ends inferred, clamped", () => {
    const r = resolveWordSpans(
      { text: "  every  single line ", words: [{ startMs: 1000 }, { startMs: 1600, endMs: 1900 }, { startMs: 2400 }] },
      { startMs: 1000, endMs: 3000 },
    );
    expect(r).toEqual({
      ok: true,
      words: [
        { text: "every", startMs: 1000, endMs: 1600 },
        { text: "single", startMs: 1600, endMs: 1900 },
        { text: "line", startMs: 2400, endMs: 3000 },
      ],
    });
  });

  test("resolveWordSpans verdicts: no-words / mismatch / untimed / inverted", () => {
    const win = { startMs: 0, endMs: 5000 };
    expect(resolveWordSpans({ text: "a b" }, win)).toEqual({ ok: false, reason: "no-words" });
    expect(resolveWordSpans({ text: "a b c", words: [{ startMs: 0 }, { startMs: 1 }] }, win)).toEqual(
      { ok: false, reason: "mismatch" },
    );
    expect(resolveWordSpans({ text: "a b", words: [{ startMs: 0 }, {}] }, win)).toEqual({
      ok: false,
      reason: "untimed",
    });
    expect(
      resolveWordSpans({ text: "a b", words: [{ startMs: 2000 }, { startMs: 1000 }] }, win),
    ).toEqual({ ok: false, reason: "inverted" });
  });
});
