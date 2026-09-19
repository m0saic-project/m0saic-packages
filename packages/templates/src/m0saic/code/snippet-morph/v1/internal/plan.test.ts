import {
  buildSnippetMorphPlan,
  computeMorphTimeline,
  MAX_ANIMATED_UNITS,
  type MorphTimeline,
  type TimeWindowMs,
} from "./plan";

function compactTimeline(timeline: MorphTimeline): unknown {
  return {
    naturalDurationMs: timeline.naturalDurationMs,
    durationMs: timeline.durationMs,
    scale: timeline.scale,
    pinned: timeline.pinned,
    steps: timeline.steps.map((step) => ({
      durationMs: step.durationMs,
      global: [step.globalStartMs, step.globalEndMs],
      lead: [step.lead.startMs, step.lead.endMs],
      morph: [step.morph.startMs, step.morph.endMs],
      hold: [step.hold.startMs, step.hold.endMs],
      trail: [step.trail.startMs, step.trail.endMs],
    })),
  };
}

function expectGlobalWindow(
  window: TimeWindowMs,
  globalStepStartMs: number,
): void {
  if (window.durationMs !== window.endMs - window.startMs) {
    throw new Error("window duration does not match its local bounds");
  }
  if (window.globalStartMs !== globalStepStartMs + window.startMs) {
    throw new Error("window global start does not match its step offset");
  }
  if (window.globalEndMs !== globalStepStartMs + window.endMs) {
    throw new Error("window global end does not match its step offset");
  }
}

function expectTimelinePartitions(timeline: MorphTimeline): void {
  if (
    timeline.steps.reduce((sum, step) => sum + step.durationMs, 0) !==
    timeline.durationMs
  ) {
    throw new Error("step durations do not sum to the timeline duration");
  }
  let globalCursor = 0;
  for (const step of timeline.steps) {
    if (step.durationMs <= 0) throw new Error("step duration is not positive");
    if (step.globalStartMs !== globalCursor) throw new Error("non-contiguous global start");
    if (step.globalEndMs !== globalCursor + step.durationMs) {
      throw new Error("global step bounds do not match duration");
    }
    if (
      step.lead.startMs !== 0 ||
      step.lead.endMs !== step.morph.startMs ||
      step.morph.endMs !== step.hold.startMs ||
      step.hold.endMs !== step.trail.startMs ||
      step.trail.endMs !== step.durationMs
    ) {
      throw new Error("lead/morph/hold/trail windows do not partition the step");
    }
    for (const window of [step.lead, step.morph, step.hold, step.trail]) {
      expectGlobalWindow(window, globalCursor);
    }
    globalCursor = step.globalEndMs;
  }
  if (globalCursor !== timeline.durationMs) {
    throw new Error("global cursor does not end at timeline duration");
  }
}

describe("computeMorphTimeline window goldens", () => {
  it("uses the natural lead + S*(morph+hold) + trail recommendation", () => {
    expect(compactTimeline(computeMorphTimeline(3))).toMatchInlineSnapshot(`
{
  "durationMs": 11250,
  "naturalDurationMs": 11250,
  "pinned": false,
  "scale": 1,
  "steps": [
    {
      "durationMs": 3750,
      "global": [
        0,
        3750,
      ],
      "hold": [
        750,
        3750,
      ],
      "lead": [
        0,
        0,
      ],
      "morph": [
        0,
        750,
      ],
      "trail": [
        3750,
        3750,
      ],
    },
    {
      "durationMs": 3750,
      "global": [
        3750,
        7500,
      ],
      "hold": [
        750,
        3750,
      ],
      "lead": [
        0,
        0,
      ],
      "morph": [
        0,
        750,
      ],
      "trail": [
        3750,
        3750,
      ],
    },
    {
      "durationMs": 3750,
      "global": [
        7500,
        11250,
      ],
      "hold": [
        750,
        3750,
      ],
      "lead": [
        0,
        0,
      ],
      "morph": [
        0,
        750,
      ],
      "trail": [
        3750,
        3750,
      ],
    },
  ],
}
`);
  });

  it("uniformly fits a pinned duration and gives the last step the remainder", () => {
    expect(compactTimeline(computeMorphTimeline(3, {}, 10_000)))
      .toMatchInlineSnapshot(`
{
  "durationMs": 10000,
  "naturalDurationMs": 11250,
  "pinned": true,
  "scale": 0.8888888888888888,
  "steps": [
    {
      "durationMs": 3333,
      "global": [
        0,
        3333,
      ],
      "hold": [
        667,
        3333,
      ],
      "lead": [
        0,
        0,
      ],
      "morph": [
        0,
        667,
      ],
      "trail": [
        3333,
        3333,
      ],
    },
    {
      "durationMs": 3333,
      "global": [
        3333,
        6666,
      ],
      "hold": [
        667,
        3333,
      ],
      "lead": [
        0,
        0,
      ],
      "morph": [
        0,
        667,
      ],
      "trail": [
        3333,
        3333,
      ],
    },
    {
      "durationMs": 3334,
      "global": [
        6666,
        10000,
      ],
      "hold": [
        667,
        3334,
      ],
      "lead": [
        0,
        0,
      ],
      "morph": [
        0,
        667,
      ],
      "trail": [
        3334,
        3334,
      ],
    },
  ],
}
`);
  });

  it("folds lead into the first step and trail into the last", () => {
    expect(
      compactTimeline(
        computeMorphTimeline(2, { leadMs: 500, trailMs: 700 }, 7000),
      ),
    ).toMatchInlineSnapshot(`
{
  "durationMs": 7000,
  "naturalDurationMs": 8700,
  "pinned": true,
  "scale": 0.8045977011494253,
  "steps": [
    {
      "durationMs": 3420,
      "global": [
        0,
        3420,
      ],
      "hold": [
        1006,
        3420,
      ],
      "lead": [
        0,
        402,
      ],
      "morph": [
        402,
        1006,
      ],
      "trail": [
        3420,
        3420,
      ],
    },
    {
      "durationMs": 3580,
      "global": [
        3420,
        7000,
      ],
      "hold": [
        603,
        3017,
      ],
      "lead": [
        0,
        0,
      ],
      "morph": [
        0,
        603,
      ],
      "trail": [
        3017,
        3580,
      ],
    },
  ],
}
`);
  });
});

describe("computeMorphTimeline exact-sum properties", () => {
  it("partitions every tested natural and pinned timeline exactly", () => {
    for (let count = 1; count <= 100; count += 1) {
      expectTimelinePartitions(computeMorphTimeline(count));
      for (const target of [count, count + 1, 12_345, 30_000]) {
        expectTimelinePartitions(
          computeMorphTimeline(
            count,
            { leadMs: 137, morphMs: 751, holdMs: 1234, trailMs: 293 },
            target,
          ),
        );
      }
    }
  });

  it("keeps a single state as one step containing all four windows", () => {
    const timeline = computeMorphTimeline(
      1,
      { leadMs: 500, trailMs: 700 },
      4000,
    );
    expectTimelinePartitions(timeline);
    expect(timeline.steps[0]).toMatchObject({
      durationMs: 4000,
      lead: { durationMs: 404 },
      morph: { durationMs: 606 },
      hold: { durationMs: 2424 },
      trail: { durationMs: 566 },
    });
  });

  it("treats a non-positive target as unpinned and rejects impossible pins", () => {
    expect(computeMorphTimeline(3, {}, 0)).toEqual(computeMorphTimeline(3));
    expect(computeMorphTimeline(3, {}, -1)).toEqual(computeMorphTimeline(3));
    expect(() => computeMorphTimeline(4, {}, 3)).toThrow(/at least 1ms per state/);
  });

  it("rounds millisecond knobs once before all timing arithmetic", () => {
    expect(
      computeMorphTimeline(1, {
        morphMs: 750.4,
        holdMs: 1000.6,
        leadMs: 10.2,
        trailMs: 20.8,
      }).knobs,
    ).toEqual({ morphMs: 750, holdMs: 1001, leadMs: 10, trailMs: 21 });
  });
});

describe("buildSnippetMorphPlan", () => {
  const STATES = [
    "const value = 1;\nconsole.log(value);",
    "console.log(value);\nreturn value;",
    "\tconst value = 2;\r\nconsole.log(value);\r\nreturn value;",
  ];

  it("normalizes and lexes every state before planning transitions", () => {
    const plan = buildSnippetMorphPlan({ states: STATES, tabWidth: 2 });
    expect(plan.states.map((state) => state.code)).toEqual([
      "const value = 1;\nconsole.log(value);",
      "console.log(value);\nreturn value;",
      "  const value = 2;\nconsole.log(value);\nreturn value;",
    ]);
    expect(plan.states[2].lines[0].tokens[1]).toMatchObject({
      kind: "keyword",
      text: "const",
      col: 2,
    });
  });

  it("plans the first state as a reveal from empty", () => {
    const first = buildSnippetMorphPlan({ states: STATES }).transitions[0];
    expect(first.fromStateIndex).toBeNull();
    expect(first.toStateIndex).toBe(0);
    expect(first.ops.map((op) => op.kind)).toEqual(["add", "add"]);
    expect(first.units).toHaveLength(1);
    expect(first.units[0].kind).toBe("add");
    expect(first.requestedAnimatedUnitCount).toBe(1);
    expect(first.renderMode).toBe("morph");
    expect(first.coalesced).toEqual({
      additionRaster: {
        kind: "add",
        lines: [
          { text: "const value = 1;", fromLine: null, toLine: 0 },
          { text: "console.log(value);", fromLine: null, toLine: 1 },
        ],
      },
      moves: [],
    });
  });

  it("keeps transitions at the animated-unit ceiling in morph mode", () => {
    const before = Array.from({ length: 15 }, (_, index) => `line-${index}`);
    const after = before.flatMap((line, index) => [`added-${index}`, line]);
    const transition = buildSnippetMorphPlan({
      states: [before.join("\n"), after.join("\n")],
    }).transitions[1]!;

    expect(transition.requestedAnimatedUnitCount).toBe(MAX_ANIMATED_UNITS);
    expect(transition.renderMode).toBe("morph");
    expect(transition.coalesced.moves).toHaveLength(15);
    expect(transition.coalesced.additionRaster).toBeDefined();
  });

  it("degrades transitions above the ceiling to a whole-snippet crossfade", () => {
    const before = Array.from({ length: 16 }, (_, index) => `line-${index}`);
    const after = before.flatMap((line, index) => [`added-${index}`, line]);
    const transition = buildSnippetMorphPlan({
      states: [before.join("\n"), after.join("\n")],
    }).transitions[1]!;

    expect(transition.requestedAnimatedUnitCount).toBe(
      MAX_ANIMATED_UNITS + 1,
    );
    expect(transition.renderMode).toBe("crossfade");
    expect(transition.coalesced.staticUnderlay).toBeUndefined();
    expect(transition.coalesced.moves).toEqual([]);
    expect(
      transition.coalesced.removalRaster?.lines.map((line) => line.text),
    ).toEqual(before);
    expect(
      transition.coalesced.additionRaster?.lines.map((line) => line.text),
    ).toEqual(after);
  });

  it("goldens the consecutive transition mappings and motion vectors", () => {
    const plan = buildSnippetMorphPlan({ states: STATES, tabWidth: 2 });
    const compact = plan.transitions.map((transition) => ({
      edge: [transition.fromStateIndex, transition.toStateIndex],
      ops: transition.ops.map(
        (op) => `${op.kind}:${op.fromLine ?? "-"}->${op.toLine ?? "-"}:${op.text}`,
      ),
      units: transition.units.map((unit) => ({
        kind: unit.kind,
        ...("deltaLines" in unit ? { deltaLines: unit.deltaLines } : {}),
        lines: unit.lines.map((line) => line.text),
      })),
    }));
    expect(compact).toMatchInlineSnapshot(`
[
  {
    "edge": [
      null,
      0,
    ],
    "ops": [
      "add:-->0:const value = 1;",
      "add:-->1:console.log(value);",
    ],
    "units": [
      {
        "kind": "add",
        "lines": [
          "const value = 1;",
          "console.log(value);",
        ],
      },
    ],
  },
  {
    "edge": [
      0,
      1,
    ],
    "ops": [
      "del:0->-:const value = 1;",
      "same:1->0:console.log(value);",
      "add:-->1:return value;",
    ],
    "units": [
      {
        "kind": "remove",
        "lines": [
          "const value = 1;",
        ],
      },
      {
        "deltaLines": -1,
        "kind": "move",
        "lines": [
          "console.log(value);",
        ],
      },
      {
        "kind": "add",
        "lines": [
          "return value;",
        ],
      },
    ],
  },
  {
    "edge": [
      1,
      2,
    ],
    "ops": [
      "add:-->0:  const value = 2;",
      "same:0->1:console.log(value);",
      "same:1->2:return value;",
    ],
    "units": [
      {
        "kind": "add",
        "lines": [
          "  const value = 2;",
        ],
      },
      {
        "deltaLines": 1,
        "kind": "move",
        "lines": [
          "console.log(value);",
          "return value;",
        ],
      },
    ],
  },
]
`);
  });

  it("aligns one transition/timing record with every pipeline step", () => {
    const plan = buildSnippetMorphPlan({
      states: STATES,
      targetDurationMs: 10_000,
    });
    expect(plan.states).toHaveLength(3);
    expect(plan.transitions).toHaveLength(3);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.map((step) => step.durationMs)).toEqual([3333, 3333, 3334]);
    expect(plan.steps.reduce((sum, step) => sum + step.durationMs, 0)).toBe(10_000);
    plan.steps.forEach((step, index) => {
      expect(step.index).toBe(index);
      expect(step.stateIndex).toBe(index);
      expect(step.transition).toBe(plan.transitions[index]);
      expect(step.timing).toBe(plan.timeline.steps[index]);
    });
  });

  it("is byte-identical across complete planning runs", () => {
    const spec = { states: STATES, language: "ts" as const, targetDurationMs: 12_345 };
    expect(JSON.stringify(buildSnippetMorphPlan(spec))).toBe(
      JSON.stringify(buildSnippetMorphPlan(spec)),
    );
  });

  it("rejects empty and non-string states actionably", () => {
    expect(() => buildSnippetMorphPlan({ states: [] })).toThrow(/at least one/);
    expect(() =>
      buildSnippetMorphPlan({ states: ["ok", 42 as never] }),
    ).toThrow(/states\[1\].*string/);
  });
});
