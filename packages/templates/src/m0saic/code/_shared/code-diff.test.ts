import {
  coalesceFadeUnits,
  groupMotionUnits,
  lcsDiffLines,
  refineMotionUnits,
  type LineOp,
  type MotionUnit,
  type MotionUnitLine,
} from "./code-diff";

function reconstructBefore(ops: ReadonlyArray<LineOp>): string[] {
  return ops
    .filter((op) => op.kind === "same" || op.kind === "del")
    .map((op) => op.text);
}

function reconstructAfter(ops: ReadonlyArray<LineOp>): string[] {
  return ops
    .filter((op) => op.kind === "same" || op.kind === "add")
    .map((op) => op.text);
}

function flattenLines(units: ReadonlyArray<MotionUnit>): MotionUnitLine[] {
  return units.flatMap((unit) => unit.lines);
}

describe("lcsDiffLines", () => {
  it("locks deletion-first behavior on an ambiguous LCS tie", () => {
    expect(lcsDiffLines(["A", "B"], ["B", "A"])).toMatchInlineSnapshot(`
[
  {
    "fromLine": 0,
    "kind": "del",
    "text": "A",
    "toLine": null,
  },
  {
    "fromLine": 1,
    "kind": "same",
    "text": "B",
    "toLine": 0,
  },
  {
    "fromLine": null,
    "kind": "add",
    "text": "A",
    "toLine": 1,
  },
]
`);
  });

  it("matches the earlier duplicate line and deletes the later duplicate", () => {
    expect(lcsDiffLines(["same", "same"], ["same"])).toEqual([
      { kind: "same", text: "same", fromLine: 0, toLine: 0 },
      { kind: "del", text: "same", fromLine: 1, toLine: null },
    ]);
  });

  it("models a changed line as deletion then addition", () => {
    expect(lcsDiffLines(["old"], ["new"])).toEqual([
      { kind: "del", text: "old", fromLine: 0, toLine: null },
      { kind: "add", text: "new", fromLine: null, toLine: 0 },
    ]);
  });

  it("models the reveal from empty as ordered additions", () => {
    expect(lcsDiffLines([], ["one", "two"])).toEqual([
      { kind: "add", text: "one", fromLine: null, toLine: 0 },
      { kind: "add", text: "two", fromLine: null, toLine: 1 },
    ]);
  });
});

describe("motion grouping", () => {
  const before = ["header", "alpha", "beta", "tail"];
  const after = ["header", "insert", "alpha", "beta", "tail"];

  it("groups maximal contiguous runs by kind and motion vector", () => {
    expect(groupMotionUnits(lcsDiffLines(before, after))).toMatchInlineSnapshot(`
[
  {
    "deltaLines": 0,
    "fromStartLine": 0,
    "kind": "move",
    "lines": [
      {
        "fromLine": 0,
        "text": "header",
        "toLine": 0,
      },
    ],
    "toStartLine": 0,
  },
  {
    "kind": "add",
    "lines": [
      {
        "fromLine": null,
        "text": "insert",
        "toLine": 1,
      },
    ],
    "toStartLine": 1,
  },
  {
    "deltaLines": 1,
    "fromStartLine": 1,
    "kind": "move",
    "lines": [
      {
        "fromLine": 1,
        "text": "alpha",
        "toLine": 2,
      },
      {
        "fromLine": 2,
        "text": "beta",
        "toLine": 3,
      },
      {
        "fromLine": 3,
        "text": "tail",
        "toLine": 4,
      },
    ],
    "toStartLine": 2,
  },
]
`);
  });

  it("line grouping is a pure one-line refinement of block grouping", () => {
    const blocks = groupMotionUnits(lcsDiffLines(before, after));
    const lines = refineMotionUnits(blocks, "line");
    expect(lines.every((unit) => unit.lines.length === 1)).toBe(true);
    expect(flattenLines(lines)).toEqual(flattenLines(blocks));
    expect(refineMotionUnits(blocks, "block")).toEqual(blocks);
  });

  it("coalesces static/add/remove lines while retaining nonzero moves", () => {
    const units: MotionUnit[] = [
      {
        kind: "move",
        fromStartLine: 0,
        toStartLine: 0,
        deltaLines: 0,
        lines: [{ text: "stay", fromLine: 0, toLine: 0 }],
      },
      {
        kind: "remove",
        fromStartLine: 1,
        lines: [{ text: "old-a", fromLine: 1, toLine: null }],
      },
      {
        kind: "move",
        fromStartLine: 2,
        toStartLine: 1,
        deltaLines: -1,
        lines: [{ text: "move", fromLine: 2, toLine: 1 }],
      },
      {
        kind: "remove",
        fromStartLine: 3,
        lines: [{ text: "old-b", fromLine: 3, toLine: null }],
      },
      {
        kind: "add",
        toStartLine: 2,
        lines: [{ text: "new-a", fromLine: null, toLine: 2 }],
      },
      {
        kind: "add",
        toStartLine: 3,
        lines: [{ text: "new-b", fromLine: null, toLine: 3 }],
      },
    ];
    const plan = coalesceFadeUnits(units, "block");
    expect(plan.staticUnderlay?.lines.map((line) => line.text)).toEqual(["stay"]);
    expect(plan.removalRaster?.lines.map((line) => line.text)).toEqual([
      "old-a",
      "old-b",
    ]);
    expect(plan.additionRaster?.lines.map((line) => line.text)).toEqual([
      "new-a",
      "new-b",
    ]);
    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0].deltaLines).toBe(-1);
  });
});

describe("diff/grouping properties", () => {
  function generatedLines(seed: number): string[] {
    let value = seed >>> 0;
    const length = seed % 7;
    const choices = ["alpha", "beta", "gamma", "alpha", "delta"];
    return Array.from({ length }, () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return choices[value % choices.length]!;
    });
  }

  it("partitions both states exactly across repeated/ambiguous fixtures", () => {
    for (let seed = 0; seed < 250; seed += 1) {
      const before = generatedLines(seed * 2 + 1);
      const after = generatedLines(seed * 2 + 2);
      const ops = lcsDiffLines(before, after);
      const blocks = groupMotionUnits(ops);
      const refined = refineMotionUnits(blocks, "line");

      expect(reconstructBefore(ops)).toEqual(before);
      expect(reconstructAfter(ops)).toEqual(after);
      expect(flattenLines(blocks)).toEqual(flattenLines(refined));
      expect(flattenLines(blocks)).toHaveLength(ops.length);
      for (const unit of blocks) {
        if (unit.kind === "move") {
          expect(
            unit.lines.every(
              (line) => line.toLine! - line.fromLine! === unit.deltaLines,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it("is byte-identical across two complete runs", () => {
    const before = generatedLines(1234);
    const after = generatedLines(5678);
    const run = () =>
      coalesceFadeUnits(groupMotionUnits(lcsDiffLines(before, after)));
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
