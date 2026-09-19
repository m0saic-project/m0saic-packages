import {
  normalizeExpr,
  normalizeOverlayExpr,
  compileEnableArg,
  normalizeOpacityExpr,
} from "../compile";

describe("normalizeExpr", () => {
  test("applies tile macros and lt substitution", () => {
    expect(
      normalizeExpr("W+lt*H", {
        startAtSec: 1,
        dims: { W: 200, H: 100 },
      }),
    ).toBe("200+(t-1)*100");
  });

  test("applies lt substitution without startAtSec", () => {
    expect(
      normalizeExpr("lt/2", {
        dims: { W: 100, H: 50 },
      }),
    ).toBe("t/2");
  });

  test("applies TW/TH when provided", () => {
    expect(
      normalizeExpr("TW-W", {
        dims: { W: 100, H: 50, TW: 1920 },
      }),
    ).toBe("1920-100");
  });
});

describe("normalizeOverlayExpr", () => {
  test("returns undefined for undefined input", () => {
    expect(normalizeOverlayExpr(undefined, { tileW: 100, tileH: 50 })).toBeUndefined();
  });

  test("normalizes xExpr, yExpr, enable, alpha", () => {
    const result = normalizeOverlayExpr(
      {
        startAtSec: 2,
        xExpr: "lt*W",
        yExpr: "lt*H",
        enable: "between(lt,0,3)",
        alpha: "min(1,lt)",
      },
      { tileW: 640, tileH: 480 },
    );
    expect(result).toEqual({
      startAtSec: 2,
      xExpr: "(t-2)*640",
      yExpr: "(t-2)*480",
      enable: "between((t-2),0,3)",
      alpha: "min(1,(t-2))",
    });
  });

  test("substitutes W/H and lt in xExpr and yExpr", () => {
    const result = normalizeOverlayExpr(
      { xExpr: "W/2", yExpr: "H+lt*10" },
      { tileW: 200, tileH: 100 },
    );
    expect(result!.xExpr).toBe("200/2");
    expect(result!.yExpr).toBe("100+t*10");
  });

  test("includes TW/TH when provided", () => {
    const result = normalizeOverlayExpr(
      { xExpr: "TW-W" },
      { tileW: 100, tileH: 50, tileTW: 1920 },
    );
    expect(result!.xExpr).toBe("1920-100");
  });

  test("leaves TW/TH untouched when not provided", () => {
    const result = normalizeOverlayExpr(
      { xExpr: "TW-W" },
      { tileW: 100, tileH: 50 },
    );
    expect(result!.xExpr).toBe("TW-100");
  });

  test("throws on x/y references in xExpr by default", () => {
    expect(() =>
      normalizeOverlayExpr(
        { xExpr: "x+1" },
        { tileW: 100, tileH: 50 },
      ),
    ).toThrow(/overlay expr may not reference x\/y/);
  });

  test("throws on y reference in yExpr", () => {
    expect(() =>
      normalizeOverlayExpr(
        { yExpr: "y" },
        { tileW: 100, tileH: 50 },
      ),
    ).toThrow(/overlay expr may not reference x\/y/);
  });

  test("allows x/y when forbidXYInOffsets is false", () => {
    expect(() =>
      normalizeOverlayExpr(
        { xExpr: "x+1", yExpr: "y+1" },
        { tileW: 100, tileH: 50 },
        { forbidXYInOffsets: false },
      ),
    ).not.toThrow();
  });

  test("does not throw on enable/alpha containing x/y", () => {
    expect(() =>
      normalizeOverlayExpr(
        { enable: "gte(x,0)", alpha: "y/100" },
        { tileW: 100, tileH: 50 },
      ),
    ).not.toThrow();
  });

  test("preserves undefined fields", () => {
    const result = normalizeOverlayExpr(
      { xExpr: "10" },
      { tileW: 100, tileH: 50 },
    );
    expect(result!.yExpr).toBeUndefined();
    expect(result!.enable).toBeUndefined();
    expect(result!.alpha).toBeUndefined();
  });

  test("preserves blendMode", () => {
    const result = normalizeOverlayExpr(
      { xExpr: "0", blendMode: "screen" },
      { tileW: 100, tileH: 50 },
    );
    expect(result!.blendMode).toBe("screen");
  });
});

describe("compileEnableArg", () => {
  test("returns empty string for undefined overlay", () => {
    expect(compileEnableArg(undefined)).toBe("");
  });

  test("returns empty string when enable is missing", () => {
    expect(compileEnableArg({ startAtSec: 1 })).toBe("");
  });

  test("substitutes lt and quotes with escaped commas", () => {
    expect(
      compileEnableArg({ enable: "between(lt,0,2)", startAtSec: 1 }),
    ).toBe(":enable='between((t-1)\\,0\\,2)'");
  });

  test("substitutes lt to t when no startAtSec", () => {
    expect(compileEnableArg({ enable: "between(lt,0,2)" })).toBe(
      ":enable='between(t\\,0\\,2)'",
    );
  });

  test("handles expression without lt", () => {
    expect(compileEnableArg({ enable: "between(t,0,5)" })).toBe(
      ":enable='between(t\\,0\\,5)'",
    );
  });

  test("is idempotent on already-normalized enable", () => {
    // If enable already has t instead of lt, it should still work
    expect(compileEnableArg({ enable: "between(t,0,2)", startAtSec: 1 })).toBe(
      ":enable='between(t\\,0\\,2)'",
    );
  });
});

describe("normalizeOpacityExpr", () => {
  test("returns undefined for undefined input", () => {
    expect(normalizeOpacityExpr(undefined)).toBeUndefined();
  });

  test("substitutes lt with t when no startAtSec", () => {
    expect(normalizeOpacityExpr("min(1,lt/2)")).toBe("min(1,t/2)");
  });

  test("substitutes lt with (t-offset) when startAtSec provided", () => {
    expect(normalizeOpacityExpr("lt/3", 2)).toBe("(t-2)/3");
  });

  test("does not touch expressions without lt", () => {
    expect(normalizeOpacityExpr("t*0.5")).toBe("t*0.5");
  });
});
