import type { MosaicOutputEmit } from "./output";

describe("MosaicOutputEmit", () => {
  it("accepts only 'single' or 'multi'", () => {
    const single: MosaicOutputEmit = "single";
    const multi: MosaicOutputEmit = "multi";
    expect([single, multi]).toEqual(["single", "multi"]);
  });
});
