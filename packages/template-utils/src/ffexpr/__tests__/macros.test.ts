import { substituteLocalTime, substituteTileMacros } from "..";

describe("substituteLocalTime (re-export)", () => {
  test("replaces lt with t when startAtSec is undefined", () => {
    expect(substituteLocalTime("between(lt,0,2)")).toBe("between(t,0,2)");
  });

  test("replaces lt with (t-offset) when startAtSec is provided", () => {
    expect(substituteLocalTime("between(lt,0,2)", 1.5)).toBe(
      "between((t-1.5),0,2)",
    );
  });
});

describe("substituteTileMacros (re-export)", () => {
  test("replaces W and H with pixel values", () => {
    expect(substituteTileMacros("W-H", { W: 100, H: 50 })).toBe("100-50");
  });
});
