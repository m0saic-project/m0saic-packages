import {
  defaultRangeLabel,
  evenRound,
  fmtRangeSeconds,
  inputLabel,
  rangeStepName,
  sanitizeLabel,
  scaleToMaxWidth,
} from "./plan";

describe("rangeStepName", () => {
  it("pads positionally from 01", () => {
    expect(rangeStepName("hero_1", 0)).toBe("hero_1__range_01");
    expect(rangeStepName("hero_1", 9)).toBe("hero_1__range_10");
  });
});

describe("inputLabel", () => {
  it("strips directories and the extension, both separators", () => {
    expect(inputLabel("/abs/media/hero_1.mp4")).toBe("hero_1");
    expect(inputLabel("C:\\media\\hero_1.mp4")).toBe("hero_1");
    expect(inputLabel("noext")).toBe("noext");
    expect(inputLabel(".hidden")).toBe(".hidden");
  });
});

describe("labels", () => {
  it("formats seconds with one decimal", () => {
    expect(fmtRangeSeconds(500)).toBe("0.5s");
    expect(fmtRangeSeconds(5300)).toBe("5.3s");
    expect(fmtRangeSeconds(0)).toBe("0.0s");
  });

  it("derives the default label from input base + range bounds", () => {
    expect(defaultRangeLabel("hero_1", 500, 2000)).toBe("hero_1_0.5s-2.0s");
  });

  it("sanitizes path-hostile characters, trims, and caps length", () => {
    expect(sanitizeLabel("finale")).toBe("finale");
    expect(sanitizeLabel("  the/final cut!! ")).toBe("the_final_cut");
    expect(sanitizeLabel("___")).toBe("");
    expect(sanitizeLabel("x".repeat(100))).toHaveLength(64);
  });
});

describe("scaleToMaxWidth", () => {
  it("even-rounds probed dims even without a cap", () => {
    expect(scaleToMaxWidth(1281, 719)).toEqual({ width: 1282, height: 720 });
    expect(evenRound(1)).toBe(2);
  });

  it("downscales aspect-preservingly when the cap is below the width", () => {
    expect(scaleToMaxWidth(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it("never upscales", () => {
    expect(scaleToMaxWidth(640, 360, 1280)).toEqual({ width: 640, height: 360 });
  });
});
