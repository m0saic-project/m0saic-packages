import {
  escapeFilterExpr,
  quoteExpr,
  escapeEnableExpr,
  quoteEnableArg,
  escapeEvalExpr,
  quoteEvalExpr,
} from "..";

describe("escapeFilterExpr (re-export)", () => {
  test("escapes backslashes first", () => {
    expect(escapeFilterExpr("a\\b")).toBe("a\\\\b");
  });

  test("escapes single quotes", () => {
    expect(escapeFilterExpr("it's")).toBe("it\\'s");
  });

  test("preserves commas (function argument separators)", () => {
    expect(escapeFilterExpr("min(1,max(0,t/2))")).toBe("min(1,max(0,t/2))");
  });
});

describe("quoteExpr (re-export)", () => {
  test("wraps in single quotes, commas preserved", () => {
    expect(quoteExpr("min(1,max(0,t/2))")).toBe("'min(1,max(0,t/2))'");
  });
});

describe("quoteEnableArg (re-export)", () => {
  test("builds :enable='...' with escaped commas", () => {
    expect(quoteEnableArg("between(t,0,2)")).toBe(
      ":enable='between(t\\,0\\,2)'",
    );
  });
});

describe("escapeEvalExpr (re-export)", () => {
  test("escapes backslashes and quotes but not commas", () => {
    expect(escapeEvalExpr("a\\b'c,d")).toBe("a\\\\b\\'c,d");
  });
});

describe("quoteEvalExpr (re-export)", () => {
  test("wraps in single quotes with eval escaping", () => {
    expect(quoteEvalExpr("lum(X,Y)")).toBe("'lum(X,Y)'");
  });
});
