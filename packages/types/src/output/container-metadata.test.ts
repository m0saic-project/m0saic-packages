import type { MosaicContainerMetadata } from "./container-metadata";

describe("MosaicContainerMetadata", () => {
  it("accepts the empty object (all fields optional)", () => {
    const m: MosaicContainerMetadata = {};
    expect(m).toEqual({});
  });

  it("accepts every documented atom", () => {
    const m: MosaicContainerMetadata = {
      title: "Launch hero",
      description: "Q2 launch trailer",
      author: "createwithm0saic@gmail.com",
      copyright: "2026 m0saic",
      comment: "Render 17",
      encoder: "m0saic-cli/0.1.0",
    };
    expect(m.title).toBe("Launch hero");
    expect(m.encoder).toBe("m0saic-cli/0.1.0");
  });
});
