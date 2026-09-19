import {
  clampCues,
  DEFAULT_CAPTIONS,
  hamilton,
  MAX_CUES_PER_SECTION,
  resolveSectionCues,
  serializeSrt,
  splitClauses,
  splitSentences,
  synthesizeCues,
} from "./captions";

const CFG = DEFAULT_CAPTIONS;

describe("splitSentences", () => {
  it("splits on terminal punctuation followed by a capital opener", () => {
    expect(splitSentences("Start at the pavement. Everything happens here.")).toEqual([
      "Start at the pavement.",
      "Everything happens here.",
    ]);
  });

  it("abbreviations do not split", () => {
    expect(splitSentences("Dr. Smith met Mr. Jones. They talked.")).toEqual([
      "Dr. Smith met Mr. Jones.",
      "They talked.",
    ]);
  });

  it("handles quotes, digits, and ellipses as openers", () => {
    expect(splitSentences('It ended. "Begin again." 42 was the answer.')).toEqual([
      "It ended.",
      '"Begin again."',
      "42 was the answer.",
    ]);
  });

  it("whitespace-normalizes and survives no-terminal text", () => {
    expect(splitSentences("  just   one\nline without terminal  ")).toEqual([
      "just one line without terminal",
    ]);
    expect(splitSentences("")).toEqual([]);
  });
});

describe("splitClauses", () => {
  it("keeps short sentences whole and splits long ones at clause boundaries", () => {
    expect(splitClauses("short, and sweet")).toEqual(["short, and sweet"]);
    const long =
      "One step up, the block starts selling everything a person could want across the whole day; glass and signage and a doorway that decides who comes in, and who keeps walking past into the evening crowd";
    const parts = splitClauses(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ").replace(/\s+/g, " ")).toContain("glass and signage");
  });
});

describe("synthesizeCues", () => {
  const TEXT =
    "Start at the pavement. Everything a block does for a person happens in the first three metres. Look up sometimes.";

  it("covers the narration span exactly before gap-trimming (Hamilton exactness)", () => {
    const span = 8000;
    const cues = synthesizeCues(TEXT, span, { ...CFG, cueGapMs: 0 });
    expect(cues[0].startMs).toBe(0);
    expect(cues[cues.length - 1].endMs).toBe(span);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startMs).toBe(cues[i - 1].endMs);
    }
  });

  it("trims cueGapMs off interior boundaries", () => {
    const cues = synthesizeCues(TEXT, 8000, { ...CFG, cueGapMs: 80 });
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startMs - cues[i - 1].endMs).toBeGreaterThanOrEqual(160);
    }
  });

  it("merges cues below minCueMs into their shorter neighbour — and terminates", () => {
    // A tiny span forces every piece under minCueMs; merging must converge
    // to a single cue rather than loop.
    const cues = synthesizeCues(TEXT, 1000, CFG);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toContain("Start at the pavement.");
    expect(cues[0].text).toContain("Look up sometimes.");
  });

  it("weights longer sentences with more time (w = max(12, len))", () => {
    const cues = synthesizeCues(
      "Tiny one here now. This considerably longer sentence should clearly receive a larger share of the narration span overall.",
      10000,
      { ...CFG, minCueMs: 0, cueGapMs: 0 },
    );
    expect(cues).toHaveLength(2);
    expect(cues[1].endMs - cues[1].startMs).toBeGreaterThan(cues[0].endMs - cues[0].startMs);
  });

  it("is deterministic", () => {
    expect(synthesizeCues(TEXT, 8000, CFG)).toEqual(synthesizeCues(TEXT, 8000, CFG));
  });
});

describe("resolveSectionCues", () => {
  it("explicit cues win over synthesis and are clamped to the narration span", () => {
    const cues = resolveSectionCues(
      {
        narrationText: "Would synthesize this.",
        cues: [
          { startMs: 0, endMs: 1500, text: "Real timing." },
          { startMs: 1600, endMs: 99999, text: "Clamped." },
        ],
      },
      4000,
      CFG,
    );
    expect(cues).toEqual([
      { startMs: 0, endMs: 1500, text: "Real timing." },
      { startMs: 1600, endMs: 4000, text: "Clamped." },
    ]);
  });

  it("overrides.caption beats synthesis but loses to timed cues", () => {
    const withCaption = resolveSectionCues(
      { narrationText: "Would synthesize.", overrides: { caption: "One custom caption." } },
      3000,
      CFG,
    );
    expect(withCaption).toEqual([{ startMs: 0, endMs: 3000, text: "One custom caption." }]);

    const withCues = resolveSectionCues(
      {
        narrationText: "x",
        overrides: { caption: "Loses to timed data." },
        cues: [{ startMs: 0, endMs: 900, text: "Timed." }],
      },
      3000,
      CFG,
    );
    expect(withCues).toEqual([{ startMs: 0, endMs: 900, text: "Timed." }]);
  });

  it("an oversized cueGapMs clamps per cue instead of deleting captions", () => {
    const cues = synthesizeCues(
      "Short one. Another short one. And a third short sentence.",
      6000,
      { ...CFG, minCueMs: 0, cueGapMs: 5000 },
    );
    // Every sentence keeps a cue; nothing silently vanishes.
    expect(cues.length).toBe(3);
    for (const cue of cues) {
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
    }
  });

  it("no narration span, or captions disabled, yields no cues", () => {
    expect(resolveSectionCues({ narrationText: "x" }, undefined, CFG)).toEqual([]);
    expect(resolveSectionCues({ narrationText: "x" }, 5000, { ...CFG, enabled: false })).toEqual([]);
  });

  it("caps at MAX_CUES_PER_SECTION", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      startMs: i * 10,
      endMs: i * 10 + 9,
      text: `c${i}`,
    }));
    expect(clampCues(many, 999999).length).toBe(MAX_CUES_PER_SECTION);
  });
});

describe("serializeSrt", () => {
  it("emits numbered blocks with comma-millisecond timecodes", () => {
    const srt = serializeSrt([
      { startMs: 0, endMs: 1900, text: "First." },
      { startMs: 3661004, endMs: 3662500, text: "Deep in.\nTwo lines." },
    ]);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,900\nFirst.");
    expect(srt).toContain("2\n01:01:01,004 --> 01:01:02,500\nDeep in.\nTwo lines.");
  });
});

describe("hamilton (shared)", () => {
  it("splits exactly with ties to the lower index", () => {
    expect(hamilton(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(hamilton(6000, [3, 1])).toEqual([4500, 1500]);
  });
});
