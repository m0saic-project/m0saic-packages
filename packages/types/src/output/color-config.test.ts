import type { MosaicColorConfig } from "./color-config";

describe("MosaicColorConfig", () => {
  it("accepts the empty config (all fields optional)", () => {
    const c: MosaicColorConfig = {};
    expect(c).toEqual({});
  });

  it("accepts BT.709 web defaults", () => {
    const c: MosaicColorConfig = {
      colorSpace: "bt709",
      colorRange: "tv",
      colorPrimaries: "bt709",
      colorTransfer: "bt709",
    };
    expect(c.colorPrimaries).toBe("bt709");
  });

  it("accepts BT.2020 HDR variants (PQ, HLG)", () => {
    const pq: MosaicColorConfig = {
      colorSpace: "bt2020nc",
      colorPrimaries: "bt2020",
      colorTransfer: "smpte2084",
      colorRange: "tv",
    };
    const hlg: MosaicColorConfig = {
      colorSpace: "bt2020nc",
      colorPrimaries: "bt2020",
      colorTransfer: "arib-std-b67",
      colorRange: "tv",
    };
    expect(pq.colorTransfer).toBe("smpte2084");
    expect(hlg.colorTransfer).toBe("arib-std-b67");
  });

  it("colorRange accepts both ffmpeg synonyms (limited|full, tv|pc)", () => {
    const limited: MosaicColorConfig = { colorRange: "limited" };
    const full: MosaicColorConfig = { colorRange: "full" };
    const tv: MosaicColorConfig = { colorRange: "tv" };
    const pc: MosaicColorConfig = { colorRange: "pc" };
    expect([limited, full, tv, pc].map((c) => c.colorRange)).toEqual([
      "limited",
      "full",
      "tv",
      "pc",
    ]);
  });
});
