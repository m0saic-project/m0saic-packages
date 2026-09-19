import { parseEnableWindow } from "../window";

describe("parseEnableWindow — recognized shapes", () => {
  test("S1: gte(t,A) → [A, ∞)", () => {
    expect(parseEnableWindow("gte(t,1.500)")).toEqual({
      startSec: 1.5,
      endSec: null,
      startRaw: "1.500",
    });
  });

  test("S2: lt(t,B) → [0, B)", () => {
    expect(parseEnableWindow("lt(t,27.5)")).toEqual({
      startSec: null,
      endSec: 27.5,
      endRaw: "27.5",
    });
  });

  test("S2: lte(t,B) accepted", () => {
    expect(parseEnableWindow("lte(t,3)")).toEqual({
      startSec: null,
      endSec: 3,
      endRaw: "3",
    });
  });

  test("S3: between(t,A,B) with raw commas", () => {
    expect(parseEnableWindow("between(t,27,30)")).toEqual({
      startSec: 27,
      endSec: 30,
      startRaw: "27",
      endRaw: "30",
    });
  });

  test("S3: between with escaped commas (tracks.ts emission)", () => {
    expect(parseEnableWindow("between(t\\,1.000\\,3.000)")).toEqual({
      startSec: 1,
      endSec: 3,
      startRaw: "1.000",
      endRaw: "3.000",
    });
  });

  test("S4: gte(t,A)*lt(t,B) product", () => {
    expect(parseEnableWindow("gte(t,1)*lt(t,3)")).toEqual({
      startSec: 1,
      endSec: 3,
      startRaw: "1",
      endRaw: "3",
    });
  });

  test("S4: reversed factor order", () => {
    expect(parseEnableWindow("lt(t,3)*gte(t,1)")).toEqual({
      startSec: 1,
      endSec: 3,
      startRaw: "1",
      endRaw: "3",
    });
  });

  test("S4: paren-wrapped factors (dsl-tutorial emission)", () => {
    expect(parseEnableWindow("(gte(t,1.250))*(lt(t,4.750))")).toEqual({
      startSec: 1.25,
      endSec: 4.75,
      startRaw: "1.250",
      endRaw: "4.750",
    });
  });

  test("redundant whole-expression paren wraps stripped", () => {
    expect(parseEnableWindow("((between(t,2,4)))")).toEqual({
      startSec: 2,
      endSec: 4,
      startRaw: "2",
      endRaw: "4",
    });
  });

  test("exponent numerics accepted", () => {
    expect(parseEnableWindow("gte(t,1.5e1)")).toEqual({
      startSec: 15,
      endSec: null,
      startRaw: "1.5e1",
    });
  });

  test("raw boundary text preserved verbatim for deterministic re-emission", () => {
    const win = parseEnableWindow("between(t,0.100,2.900)");
    expect(win?.startRaw).toBe("0.100");
    expect(win?.endRaw).toBe("2.900");
    expect(win?.startSec).toBeCloseTo(0.1);
  });

  test("zero start is a valid bound", () => {
    expect(parseEnableWindow("gte(t,0)")).toEqual({
      startSec: 0,
      endSec: null,
      startRaw: "0",
    });
  });
});

describe("parseEnableWindow — bails to null", () => {
  test.each([
    ["empty string", ""],
    ["bare constant", "1"],
    ["multi-window sum (S5)", "(gte(t,1)*lt(t,2))+(gte(t,3)*lt(t,4))"],
    ["if() phase envelope", "if(lt(t,1),t,1)"],
    ["local-time term (un-normalized)", "between((t-2),0,3)"],
    ["local-time variable (un-substituted lt macro)", "between(lt,0,2)"],
    ["negative start", "gte(t,-1)"],
    ["inverted window", "between(t,5,2)"],
    ["empty window (A == B)", "between(t,3,3)"],
    ["zero end bound", "lt(t,0)"],
    ["two start bounds", "gte(t,1)*gte(t,2)"],
    ["two end bounds", "lt(t,1)*lt(t,2)"],
    ["between as a product factor", "between(t,1,3)*gte(t,1)"],
    ["three factors", "gte(t,1)*lt(t,3)*gte(t,0)"],
    ["non-numeric bound", "gte(t,start)"],
    ["wrong time variable", "gte(n,10)"],
    ["unbalanced parens", "gte(t,1"],
    ["first-frame gate with expression bound", "gte(t,1/30)"],
    ["trailing garbage", "between(t,1,3)+0"],
  ])("%s", (_label, expr) => {
    expect(parseEnableWindow(expr)).toBeNull();
  });
});
