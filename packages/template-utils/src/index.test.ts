import { MM_PER_INCH, mmToPx, resolveDieline } from "./index";

describe("template-utils public entry", () => {
  it("exports the generic print-production helpers", () => {
    expect(MM_PER_INCH).toBe(25.4);
    expect(mmToPx(25.4, 300)).toBe(300);
    expect(
      resolveDieline(
        {
          panels: [{ id: "face", widthMm: 25.4 }],
          heightMm: 25.4,
          bleedMm: 0,
          safeMarginMm: 0,
        },
        300,
      ).trimBox,
    ).toMatchObject({ width: 300, height: 300 });
  });
});
