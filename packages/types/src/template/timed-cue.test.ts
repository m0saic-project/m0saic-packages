import { isMosaicTimedCue, type MosaicTimedCue } from "./timed-cue";

describe("MosaicTimedCue", () => {
  test("accepts the full field set and stays JSON-serializable", () => {
    const cue: MosaicTimedCue = { text: "Bridge", startMs: 30500, endMs: 33000 };
    expect(JSON.parse(JSON.stringify(cue))).toEqual(cue);
  });

  test("guard accepts untimed, timed, and explicitly-ended cues", () => {
    expect(isMosaicTimedCue({ text: "Second line" })).toBe(true);
    expect(isMosaicTimedCue({ text: "First line I sing", startMs: 12040 })).toBe(true);
    expect(isMosaicTimedCue({ text: "Bridge", startMs: 30500, endMs: 33000 })).toBe(true);
    expect(isMosaicTimedCue({ text: "At zero", startMs: 0 })).toBe(true);
  });

  test("guard rejects non-objects", () => {
    expect(isMosaicTimedCue(null)).toBe(false);
    expect(isMosaicTimedCue(undefined)).toBe(false);
    expect(isMosaicTimedCue([])).toBe(false);
    expect(isMosaicTimedCue("First line")).toBe(false);
    expect(isMosaicTimedCue(12040)).toBe(false);
  });

  test("guard rejects missing, non-string, or blank text", () => {
    expect(isMosaicTimedCue({})).toBe(false);
    expect(isMosaicTimedCue({ startMs: 0 })).toBe(false);
    expect(isMosaicTimedCue({ text: 7, startMs: 0 })).toBe(false);
    expect(isMosaicTimedCue({ text: "" })).toBe(false);
    expect(isMosaicTimedCue({ text: "   " })).toBe(false);
  });

  test("guard rejects non-finite or negative ms", () => {
    expect(isMosaicTimedCue({ text: "x", startMs: NaN })).toBe(false);
    expect(isMosaicTimedCue({ text: "x", startMs: Infinity })).toBe(false);
    expect(isMosaicTimedCue({ text: "x", startMs: -1 })).toBe(false);
    expect(isMosaicTimedCue({ text: "x", startMs: "0" })).toBe(false);
    expect(isMosaicTimedCue({ text: "x", startMs: 0, endMs: NaN })).toBe(false);
  });

  test("guard rejects inverted, zero-width, and start-less ends", () => {
    expect(isMosaicTimedCue({ text: "x", startMs: 1000, endMs: 1000 })).toBe(false);
    expect(isMosaicTimedCue({ text: "x", startMs: 2000, endMs: 500 })).toBe(false);
    // an end without a start is malformed — untimed cues carry no end
    expect(isMosaicTimedCue({ text: "x", endMs: 5000 })).toBe(false);
  });

  test("guard tolerates unknown extra keys (per-word extras included)", () => {
    expect(
      isMosaicTimedCue({
        text: "First line I sing",
        startMs: 12040,
        words: [{ text: "First", startMs: 12040 }],
      }),
    ).toBe(true);
  });

  test("words deepening: sparse spans allowed, same laws one level down", () => {
    expect(
      isMosaicTimedCue({
        text: "two words",
        startMs: 1000,
        words: [{ startMs: 1000, endMs: 1400 }, {}],
      }),
    ).toBe(true);
    // Words need the LINE to be timed.
    expect(isMosaicTimedCue({ text: "two words", words: [{ startMs: 0 }] })).toBe(false);
    // Word end-without-start / inverted spans are malformed.
    expect(
      isMosaicTimedCue({ text: "two words", startMs: 0, words: [{ endMs: 500 }] }),
    ).toBe(false);
    expect(
      isMosaicTimedCue({ text: "two words", startMs: 0, words: [{ startMs: 900, endMs: 900 }] }),
    ).toBe(false);
    // Non-array words value is malformed (no longer a tolerated unknown).
    expect(isMosaicTimedCue({ text: "x", startMs: 0, words: "later" })).toBe(false);
  });
});
