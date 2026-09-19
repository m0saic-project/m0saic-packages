import { WireframeV2 } from "./index";

describe("m0saic template public entry", () => {
  it("exports the default Make wireframe from the wireframe family", () => {
    expect(WireframeV2.id).toBe("@m0saic/wireframe/base/v2");
  });
});
