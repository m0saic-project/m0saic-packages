import { overlay, moveY, fadeIn } from "../overlay";

describe("overlay", () => {
  test("returns only defined fields", () => {
    const result = overlay({ startAtSec: 2, enable: "between(lt,0,2)" });
    expect(result).toEqual({
      startAtSec: 2,
      enable: "between(lt,0,2)",
    });
    expect(result).not.toHaveProperty("alpha");
    expect(result).not.toHaveProperty("xExpr");
    expect(result).not.toHaveProperty("yExpr");
    expect(result).not.toHaveProperty("blendMode");
  });

  test("includes all fields when provided", () => {
    const result = overlay({
      startAtSec: 1,
      enable: "between(lt,0,1)",
      alpha: "lt/1",
      xExpr: "W/2",
      yExpr: "H-10",
      blendMode: "screen",
    });
    expect(result).toEqual({
      startAtSec: 1,
      enable: "between(lt,0,1)",
      alpha: "lt/1",
      xExpr: "W/2",
      yExpr: "H-10",
      blendMode: "screen",
    });
  });

  test("returns empty object when no args provided", () => {
    expect(overlay({})).toEqual({});
  });
});

describe("moveY", () => {
  test("builds overlay with yExpr", () => {
    const result = moveY({ yExpr: "H-lt*100" });
    expect(result.yExpr).toBe("H-lt*100");
  });

  test("adds enableLocalWindow when durSec is provided", () => {
    const result = moveY({ yExpr: "H-lt*100", durSec: 2 });
    expect(result.enable).toBe("between(lt,0,2)");
  });

  test("does not add enable when durSec is absent", () => {
    const result = moveY({ yExpr: "H-lt*100" });
    expect(result).not.toHaveProperty("enable");
  });

  test("prefers explicit enable over durSec", () => {
    const result = moveY({
      yExpr: "H-lt*100",
      durSec: 2,
      enable: "between(lt,0,5)",
    });
    expect(result.enable).toBe("between(lt,0,5)");
  });

  test("passes through startAtSec and blendMode", () => {
    const result = moveY({
      yExpr: "H",
      startAtSec: 1,
      blendMode: "add",
    });
    expect(result.startAtSec).toBe(1);
    expect(result.blendMode).toBe("add");
  });
});

describe("fadeIn", () => {
  test("builds linear fade-in overlay", () => {
    const result = fadeIn({ durSec: 2 });
    expect(result.enable).toBe("between(lt,0,2)");
    expect(result.alpha).toBe("min(1,max(0,lt/2))");
  });

  test("applies easeExpr when provided", () => {
    const result = fadeIn({
      durSec: 1.5,
      easeExpr: (u) => `${u}*${u}`, // quadratic ease-in
    });
    expect(result.alpha).toBe("min(1,max(0,lt/1.5))*min(1,max(0,lt/1.5))");
  });

  test("includes startAtSec when provided", () => {
    const result = fadeIn({ startAtSec: 3, durSec: 1 });
    expect(result.startAtSec).toBe(3);
    expect(result.enable).toBe("between(lt,0,1)");
    expect(result.alpha).toBe("min(1,max(0,lt/1))");
  });

  test("does not include startAtSec when absent", () => {
    const result = fadeIn({ durSec: 2 });
    expect(result).not.toHaveProperty("startAtSec");
  });
});
