import { normalizeOverlayExpr, compileEnableArg } from "..";

describe("normalizeOverlayExpr (re-export)", () => {
  test("returns undefined when no overlay", () => {
    expect(normalizeOverlayExpr(undefined, { tileW: 100, tileH: 50 })).toBeUndefined();
  });

  test("substitutes W/H and lt in xExpr and yExpr", () => {
    const result = normalizeOverlayExpr(
      { xExpr: "W/2", yExpr: "H+lt*10" },
      { tileW: 200, tileH: 100 },
    );
    expect(result!.xExpr).toBe("200/2");
    expect(result!.yExpr).toBe("100+t*10");
  });
});

describe("compileEnableArg (re-export)", () => {
  test("returns empty string for undefined overlay", () => {
    expect(compileEnableArg(undefined)).toBe("");
  });

  test("substitutes lt and quotes with escaped commas", () => {
    expect(
      compileEnableArg({ enable: "between(lt,0,2)", startAtSec: 1 }),
    ).toBe(":enable='between((t-1)\\,0\\,2)'");
  });
});
