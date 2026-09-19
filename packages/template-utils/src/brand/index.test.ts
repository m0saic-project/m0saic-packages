import * as brand from "./index";

describe("brand barrel", () => {
  it("re-exports the glyphs, the hello-world factory and the cover kit", () => {
    expect(typeof brand.defineHelloWorldTemplate).toBe("function");
    expect(typeof brand.buildBrandedCover).toBe("function");
    expect(typeof brand.M_RECTS).toBe("object");
  });
});
