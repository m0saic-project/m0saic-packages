import {
  enableLocalWindow,
  enableGlobalWindow,
  clamp01,
  u01,
  localStartAt,
} from "../time";

describe("enableLocalWindow", () => {
  test("returns between(lt,0,dur) for a number", () => {
    expect(enableLocalWindow(2)).toBe("between(lt,0,2)");
  });

  test("accepts string duration", () => {
    expect(enableLocalWindow("dur")).toBe("between(lt,0,dur)");
  });

  test("handles fractional duration", () => {
    expect(enableLocalWindow(1.5)).toBe("between(lt,0,1.5)");
  });
});

describe("enableGlobalWindow", () => {
  test("returns between(t,start,end)", () => {
    expect(enableGlobalWindow(1, 3)).toBe("between(t,1,3)");
  });

  test("accepts string args", () => {
    expect(enableGlobalWindow("s", "e")).toBe("between(t,s,e)");
  });
});

describe("clamp01", () => {
  test("wraps expr in min/max", () => {
    expect(clamp01("lt/2")).toBe("min(1,max(0,lt/2))");
  });

  test("handles complex expression", () => {
    expect(clamp01("(t-1)*2")).toBe("min(1,max(0,(t-1)*2))");
  });
});

describe("u01", () => {
  test("defaults to lt-based ramp", () => {
    expect(u01(2)).toBe("min(1,max(0,lt/2))");
  });

  test("accepts explicit lt", () => {
    expect(u01(1.5, "lt")).toBe("min(1,max(0,lt/1.5))");
  });

  test("accepts t for global time", () => {
    expect(u01(2, "t")).toBe("min(1,max(0,t/2))");
  });

  test("accepts string duration", () => {
    expect(u01("dur")).toBe("min(1,max(0,lt/dur))");
  });
});

describe("localStartAt", () => {
  test("returns object with startAtSec", () => {
    expect(localStartAt(2.5)).toEqual({ startAtSec: 2.5 });
  });

  test("returns object with startAtSec = 0", () => {
    expect(localStartAt(0)).toEqual({ startAtSec: 0 });
  });
});
