import { solidBackground } from "./solidBackground";

describe("solidBackground", () => {
  test("undefined passes through (preserves transparent-bg intent)", () => {
    expect(solidBackground(undefined)).toBeUndefined();
  });

  test("raw hex gets @1.0 appended", () => {
    expect(solidBackground("#ffffff")).toBe("#ffffff@1.0");
    expect(solidBackground("#000000")).toBe("#000000@1.0");
    expect(solidBackground("#f97316")).toBe("#f97316@1.0");
  });

  test("short hex gets @1.0 appended", () => {
    expect(solidBackground("#fff")).toBe("#fff@1.0");
  });

  test("named color gets @1.0 appended", () => {
    expect(solidBackground("white")).toBe("white@1.0");
    expect(solidBackground("black")).toBe("black@1.0");
  });

  test("explicit alpha is preserved (translucent watermark use case)", () => {
    expect(solidBackground("#ffffff@0.6")).toBe("#ffffff@0.6");
    expect(solidBackground("black@0.5")).toBe("black@0.5");
    expect(solidBackground("#f97316@0.92")).toBe("#f97316@0.92");
  });

  test("@1.0 is preserved verbatim when already present", () => {
    expect(solidBackground("#ffffff@1.0")).toBe("#ffffff@1.0");
  });

  test("none@<alpha> is preserved", () => {
    expect(solidBackground("none@0.0")).toBe("none@0.0");
  });

  test("'none' (no alpha suffix) gets @1.0 appended", () => {
    // Edge case — "none" without a suffix is unusual but typed as a valid
    // MosaicColor. We err on the side of opt-in opacity since the helper's
    // name is `solidBackground`.
    expect(solidBackground("none")).toBe("none@1.0");
  });
});
