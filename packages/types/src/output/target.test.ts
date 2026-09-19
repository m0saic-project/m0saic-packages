import {
  isMosaicOutputTarget,
  MOSAIC_OUTPUT_TARGETS,
  type MosaicOutputTarget,
} from "./target";

describe("MosaicOutputTarget", () => {
  it("enumerates all eight presets", () => {
    expect(MOSAIC_OUTPUT_TARGETS).toEqual([
      "web-mp4",
      "web-webm",
      "alpha-mov",
      "image-png",
      "image-jpeg",
      "animated-gif",
      "audio-mp3",
      "audio-wav",
    ]);
  });

  it("type-level union covers the constant tuple", () => {
    // Compile-time assertion: every tuple member assignable to the type.
    for (const t of MOSAIC_OUTPUT_TARGETS) {
      const x: MosaicOutputTarget = t;
      expect(x).toBe(t);
    }
  });

  describe("isMosaicOutputTarget", () => {
    it("accepts every preset name", () => {
      for (const t of MOSAIC_OUTPUT_TARGETS) {
        expect(isMosaicOutputTarget(t)).toBe(true);
      }
    });

    it("rejects unknown strings", () => {
      expect(isMosaicOutputTarget("mp4")).toBe(false);
      expect(isMosaicOutputTarget("WEB-MP4")).toBe(false);
      expect(isMosaicOutputTarget("")).toBe(false);
    });

    it("rejects non-strings", () => {
      expect(isMosaicOutputTarget(null)).toBe(false);
      expect(isMosaicOutputTarget(undefined)).toBe(false);
      expect(isMosaicOutputTarget(42)).toBe(false);
      expect(isMosaicOutputTarget({})).toBe(false);
      expect(isMosaicOutputTarget([])).toBe(false);
    });
  });
});
