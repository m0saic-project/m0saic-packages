import {
  JETBRAINS_MONO_ADVANCE_EM,
  MIN_AUTOFIT_FONT_SIZE,
  autoFitCodeFont,
  codeBlockRect,
  codeColumnCount,
  measureCodeGrid,
} from "./code-metrics";

const LINES = [
  { text: "const answer = 42;" },
  { text: "console.log(2);" },
  { text: "  return answer;" },
];

describe("code grid metrics", () => {
  it("matches the registered JetBrains Mono grid at 16px", () => {
    const metrics = measureCodeGrid(LINES, { fontSize: 16, lineHeight: 1.5 });
    expect(JETBRAINS_MONO_ADVANCE_EM).toBe(0.6);
    expect(metrics).toEqual({
      fontSize: 16,
      lineHeight: 1.5,
      charW: 9.6,
      lineStep: 24,
      lineCount: 3,
      maxColumns: 18,
      width: 173,
      height: 72,
    });
  });

  it("retains empty line boxes while an all-empty grid has zero ink width", () => {
    expect(measureCodeGrid([{ text: "" }, { text: "" }], { fontSize: 16 })).toMatchObject({
      width: 0,
      height: 48,
      lineCount: 2,
    });
  });

  it("counts code points deterministically", () => {
    expect(codeColumnCount("=>")).toBe(2);
    expect(codeColumnCount("A😀B")).toBe(3);
  });
});

describe("code block outward rounding", () => {
  it("matches A2 origin-floor and right/bottom-ceil placement", () => {
    expect(
      codeBlockRect(
        { originCol: 1, originLine: 2, endCol: 4, endLine: 4 },
        { charW: 9.6, lineStep: 24 },
      ),
    ).toEqual({
      x: 9,
      y: 48,
      width: 30,
      height: 48,
      originCol: 1,
      originLine: 2,
      endCol: 4,
      endLine: 4,
    });
  });

  it("allows a zero-area sparse span but rejects reversed bounds", () => {
    expect(
      codeBlockRect(
        { originLine: 2, endCol: 0, endLine: 2 },
        { charW: 9.6, lineStep: 24 },
      ),
    ).toMatchObject({ width: 0, height: 0 });
    expect(() =>
      codeBlockRect(
        { originLine: 2, endCol: 3, endLine: 1 },
        { charW: 9.6, lineStep: 24 },
      ),
    ).toThrow(/must not precede/);
  });
});

describe("deterministic code autofit", () => {
  it("selects the largest integer size that fits both axes", () => {
    const fitted = autoFitCodeFont(LINES, {
      preferredFontSize: 16,
      maxWidth: 100,
      maxHeight: 48,
    });
    expect(fitted.fontSize).toBe(9);
    expect(fitted.fits).toBe(true);
    expect(fitted.metrics).toMatchObject({ width: 98, height: 42 });
  });

  it("stops at 8px and reports the overflowing axes", () => {
    const fitted = autoFitCodeFont(LINES, {
      preferredFontSize: 16,
      maxWidth: 80,
      maxHeight: 20,
    });
    expect(fitted.fontSize).toBe(MIN_AUTOFIT_FONT_SIZE);
    expect(fitted.fits).toBe(false);
    expect(fitted.overflowX).toBe(true);
    expect(fitted.overflowY).toBe(true);
    expect(fitted.metrics).toMatchObject({ width: 87, height: 36 });
  });

  it("is byte-deterministic for the same inputs", () => {
    const options = { preferredFontSize: 16, maxWidth: 100, maxHeight: 48 };
    expect(JSON.stringify(autoFitCodeFont(LINES, options))).toBe(
      JSON.stringify(autoFitCodeFont(LINES, options)),
    );
  });
});
