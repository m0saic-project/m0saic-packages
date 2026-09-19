import { formatValue, niceAxis } from "./format";

describe("bar-graph niceAxis (delegates Heckbert rule to shared niceNum)", () => {
  it("keeps the 2.5 bucket: 0..120 → step 25", () => {
    const a = niceAxis(0, 120, 6);
    expect(a.step).toBe(25);
    expect(a.max).toBe(125);
    expect(a.ticks).toEqual([0, 25, 50, 75, 100, 125]);
  });

  it("matches the canonical set elsewhere", () => {
    expect(niceAxis(0, 85, 6).step).toBe(20);
    expect(niceAxis(0, 9800, 11).step).toBe(1000);
    expect(niceAxis(0, 55, 6).step).toBe(20);
  });
});

describe("bar-graph formatValue", () => {
  it("formats raw / percent / compact", () => {
    expect(formatValue(31.5, "raw", 1)).toBe("31.5");
    expect(formatValue(50, "percent", 0, { max: 200 })).toBe("25%");
    expect(formatValue(1500, "compact", 1)).toBe("1.5K");
  });

  it("appends the optional unit suffix", () => {
    expect(formatValue(31.5, "raw", 1, undefined, "s")).toBe("31.5s");
    expect(formatValue(120, "raw", 0, undefined, "fps")).toBe("120fps");
  });

  it("omits the suffix when empty or undefined", () => {
    expect(formatValue(4.5, "raw", 1, undefined, "")).toBe("4.5");
    expect(formatValue(4.5, "raw", 1)).toBe("4.5");
  });
});
