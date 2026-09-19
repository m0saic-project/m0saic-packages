import * as print from "./index";

describe("print public surface", () => {
  it("exports the physical-unit and dieline helpers", () => {
    expect(print.mmToPx).toBeDefined();
    expect(print.resolveDieline).toBeDefined();
    expect(print.effectiveDpi).toBeDefined();
  });
});
