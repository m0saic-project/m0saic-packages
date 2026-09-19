import {
  measureMonoGrid,
  resolveFontFile,
  runsToPaths,
  type PathLine,
  type RunsToPathsOptions,
} from "./index";

function jetBrainsMonoPath(): string {
  const resolved = resolveFontFile({ family: "JetBrains Mono" });
  if (!resolved) throw new Error("JetBrains Mono was not registered");
  return resolved.path;
}

function opts(
  overrides: Partial<RunsToPathsOptions> = {},
): RunsToPathsOptions {
  return {
    fontSize: 16,
    lineHeight: 1.5,
    fontPath: jetBrainsMonoPath(),
    ...overrides,
  };
}

function firstMoveX(d: string): number {
  const match = d.match(/M\s*(-?[\d.]+)/);
  if (!match) throw new Error(`No absolute moveto in path: ${d}`);
  return Number(match[1]);
}

describe("measureMonoGrid", () => {
  test("measures JetBrains Mono's exact character grid", () => {
    const metrics = measureMonoGrid(opts());
    expect(metrics).toEqual({
      charW: 9.6,
      lineStep: 24,
      ascent: 16.32,
      descent: 4.8,
      monospace: true,
    });
  });

  test("rounds fontSize × lineHeight once to an integer line step", () => {
    const metrics = measureMonoGrid(opts({ fontSize: 13, lineHeight: 1.35 }));
    expect(metrics.lineStep).toBe(18);
  });

  test("reports the bundled proportional Roboto fallback as non-monospace", () => {
    expect(measureMonoGrid({ fontSize: 16 }).monospace).toBe(false);
  });

  test("rejects invalid sizing", () => {
    expect(() => measureMonoGrid(opts({ fontSize: 0 }))).toThrow(/fontSize/);
    expect(() => measureMonoGrid(opts({ lineHeight: Number.NaN }))).toThrow(
      /lineHeight/,
    );
  });
});

describe("runsToPaths", () => {
  test("translates a glyph by exactly col × charW", () => {
    const atZero = runsToPaths(
      [{ runs: [{ text: "A", colorKey: "plain", col: 0 }] }],
      opts(),
    );
    const atThree = runsToPaths(
      [{ runs: [{ text: "A", colorKey: "plain", col: 3 }] }],
      opts(),
    );

    const delta = firstMoveX(atThree.paths[0].d) - firstMoveX(atZero.paths[0].d);
    expect(delta).toBeCloseTo(3 * atZero.metrics.charW, 10);
  });

  test("merges same-color runs into one path in first-seen color order", () => {
    const result = runsToPaths(
      [
        {
          runs: [
            { text: "const", colorKey: "keyword", col: 0 },
            { text: "42", colorKey: "number", col: 6 },
            { text: "return", colorKey: "keyword", col: 9 },
          ],
        },
      ],
      opts(),
    );

    expect(result.paths.map((path) => path.colorKey)).toEqual([
      "keyword",
      "number",
    ]);
    expect(result.paths.every((path) => path.d.startsWith("M"))).toBe(true);
  });

  test("preserves the fractional char-grid phase after subtracting the origin floor", () => {
    const base = runsToPaths(
      [{ runs: [{ text: "A", colorKey: "plain", col: 0 }] }],
      opts({ fontSize: 17 }),
    );
    const anchored = runsToPaths(
      [{ runs: [{ text: "A", colorKey: "plain", col: 3 }] }],
      opts({ fontSize: 17, originCol: 3, originLine: 5 }),
    );
    const absoluteX = 3 * anchored.metrics.charW;
    const fractionalPhase = absoluteX - Math.floor(absoluteX);

    expect(
      firstMoveX(anchored.paths[0].d) - firstMoveX(base.paths[0].d),
    ).toBeCloseTo(fractionalPhase, 10);
    expect(anchored.firstBaselineY).toBeCloseTo(anchored.metrics.ascent, 10);
    expect(anchored.width).toBe(
      Math.ceil(4 * anchored.metrics.charW) - Math.floor(absoluteX),
    );
    expect(anchored.height).toBe(anchored.metrics.lineStep);
  });

  test("is byte-deterministic for identical input", () => {
    const lines: PathLine[] = [
      { runs: [{ text: "const answer = 42;", colorKey: "code", col: 0 }] },
      { runs: [] },
      { runs: [{ text: "answer", colorKey: "code", col: 2 }] },
    ];
    expect(runsToPaths(lines, opts())).toEqual(runsToPaths(lines, opts()));
  });

  test("keeps => as two grid glyphs with no ligature substitution", () => {
    const oneRun = runsToPaths(
      [{ runs: [{ text: "=>", colorKey: "operator", col: 0 }] }],
      opts(),
    );
    const twoRuns = runsToPaths(
      [
        {
          runs: [
            { text: "=", colorKey: "operator", col: 0 },
            { text: ">", colorKey: "operator", col: 1 },
          ],
        },
      ],
      opts(),
    );

    expect(oneRun).toEqual(twoRuns);
    expect(oneRun.width).toBe(Math.ceil(2 * oneRun.metrics.charW));
  });

  test("retains transparent line boxes and handles an empty document", () => {
    const sparse = runsToPaths(
      [
        { runs: [{ text: "x", colorKey: "plain", col: 0 }] },
        { runs: [] },
        { runs: [] },
      ],
      opts(),
    );
    expect(sparse.height).toBe(3 * sparse.metrics.lineStep);

    const empty = runsToPaths([], opts());
    expect(empty.paths).toEqual([]);
    expect(empty.width).toBe(0);
    expect(empty.height).toBe(0);
  });

  test("rejects malformed origins, columns, and runs", () => {
    expect(() =>
      runsToPaths([], opts({ originCol: 0.5 })),
    ).toThrow(/originCol/);
    expect(() =>
      runsToPaths(
        [{ runs: [{ text: "x", colorKey: "plain", col: 2 }] }],
        opts({ originCol: 3 }),
      ),
    ).toThrow(/originCol/);
    expect(() =>
      runsToPaths(
        [{ runs: [{ text: "x", colorKey: 1, col: 0 } as never] }],
        opts(),
      ),
    ).toThrow(/colorKey/);
  });
});
