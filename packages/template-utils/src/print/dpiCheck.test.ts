import { classifyEffectiveDpi, effectiveDpi } from "./dpiCheck";

describe("print DPI checks", () => {
  it("computes the limiting axis", () => {
    const result = effectiveDpi(
      { width: 3000, height: 1800 },
      { width: 254, height: 127 },
    );
    expect(result.x).toBeCloseTo(300, 8);
    expect(result.y).toBeCloseTo(360, 8);
    expect(result.min).toBeCloseTo(300, 8);
  });

  it("classifies strict, warning, and disabled policies", () => {
    expect(classifyEffectiveDpi(300, "strict")).toBe("pass");
    expect(classifyEffectiveDpi(220, "strict")).toBe("warn");
    expect(classifyEffectiveDpi(149, "strict")).toBe("error");
    expect(classifyEffectiveDpi(72, "warn")).toBe("warn");
    expect(classifyEffectiveDpi(1, "off")).toBe("off");
  });
});
