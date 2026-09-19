import { substituteLocalTime, substituteTileMacros } from "../macros";

describe("substituteLocalTime", () => {
  test("replaces lt with t when startAtSec is undefined", () => {
    expect(substituteLocalTime("between(lt,0,2)")).toBe("between(t,0,2)");
  });

  test("replaces lt with (t-offset) when startAtSec is provided", () => {
    expect(substituteLocalTime("between(lt,0,2)", 1.5)).toBe(
      "between((t-1.5),0,2)",
    );
  });

  test("does NOT replace lt( function name", () => {
    expect(substituteLocalTime("lt(1,2)")).toBe("lt(1,2)");
  });

  test("does NOT replace lt ( with spaces before paren", () => {
    expect(substituteLocalTime("lt (1,2)")).toBe("lt (1,2)");
  });

  test("does NOT replace substrings like blt or altitude", () => {
    expect(substituteLocalTime("blt")).toBe("blt");
    expect(substituteLocalTime("altitude")).toBe("altitude");
  });

  test("replaces multiple lt tokens in one expression", () => {
    expect(substituteLocalTime("lt+lt*2", 0.5)).toBe(
      "(t-0.5)+(t-0.5)*2",
    );
  });

  test("replaces lt at start and end of string", () => {
    expect(substituteLocalTime("lt", 1)).toBe("(t-1)");
  });

  test("handles startAtSec = 0 as provided", () => {
    expect(substituteLocalTime("lt", 0)).toBe("(t-0)");
  });

  test("handles mixed lt variable and lt() function in same expr", () => {
    expect(substituteLocalTime("lt+lt(1,2)", 3)).toBe("(t-3)+lt(1,2)");
  });

  test("handles lt followed by end of string", () => {
    expect(substituteLocalTime("min(1,lt)", 2)).toBe("min(1,(t-2))");
  });
});

describe("substituteTileMacros", () => {
  test("replaces W and H with pixel values", () => {
    expect(substituteTileMacros("W-H", { W: 100, H: 50 })).toBe("100-50");
  });

  test("does not replace substrings (SHOW, WHY)", () => {
    expect(substituteTileMacros("SHOW+WHY", { W: 100, H: 50 })).toBe(
      "SHOW+WHY",
    );
  });

  test("replaces TW/TH when provided", () => {
    expect(
      substituteTileMacros("TW*TH", { W: 100, H: 50, TW: 1920, TH: 1080 }),
    ).toBe("1920*1080");
  });

  test("leaves TW/TH untouched when not provided", () => {
    expect(substituteTileMacros("TW*TH", { W: 100, H: 50 })).toBe("TW*TH");
  });

  test("replaces all occurrences", () => {
    expect(substituteTileMacros("W+W-H", { W: 200, H: 100 })).toBe(
      "200+200-100",
    );
  });

  test("replaces W/H adjacent to operators", () => {
    expect(substituteTileMacros("W/2+H*3", { W: 640, H: 480 })).toBe(
      "640/2+480*3",
    );
  });
});
