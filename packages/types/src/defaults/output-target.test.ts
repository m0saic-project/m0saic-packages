import {
  MOSAIC_OUTPUT_TARGET_DEFAULTS,
  getOutputTargetDefaults,
} from "./output-target";
import { MOSAIC_OUTPUT_TARGETS } from "../output/target";

describe("MOSAIC_OUTPUT_TARGET_DEFAULTS", () => {
  it("has an entry for every MosaicOutputTarget", () => {
    for (const t of MOSAIC_OUTPUT_TARGETS) {
      expect(MOSAIC_OUTPUT_TARGET_DEFAULTS[t]).toBeDefined();
    }
  });

  it("web-mp4 → libx264 / mp4 / yuv420p / AAC", () => {
    const d = MOSAIC_OUTPUT_TARGET_DEFAULTS["web-mp4"];
    expect(d.format.videoCodec).toBe("libx264");
    expect(d.format.container).toBe("mp4");
    expect(d.format.pixelFormat).toBe("yuv420p");
    expect(d.audio.codec).toBe("aac");
  });

  it("web-webm → libvpx-vp9 / webm / Opus", () => {
    const d = MOSAIC_OUTPUT_TARGET_DEFAULTS["web-webm"];
    expect(d.format.videoCodec).toBe("libvpx-vp9");
    expect(d.format.container).toBe("webm");
    expect(d.audio.codec).toBe("libopus");
  });

  it("alpha-mov → ProRes 4444 / MOV / yuva444p10le / PCM", () => {
    const d = MOSAIC_OUTPUT_TARGET_DEFAULTS["alpha-mov"];
    expect(d.format.videoCodec).toBe("prores_ks");
    expect(d.format.container).toBe("mov");
    expect(d.format.encoderProfile).toBe("4444");
    expect(d.format.pixelFormat).toBe("yuva444p10le");
    expect(d.audio.codec).toBe("pcm_s24le");
  });

  it("image targets have no audio", () => {
    for (const t of ["image-png", "image-jpeg", "animated-gif"] as const) {
      expect(MOSAIC_OUTPUT_TARGET_DEFAULTS[t].audio.mode).toBe("off");
    }
  });

  it("audio targets have no video codec", () => {
    for (const t of ["audio-mp3", "audio-wav"] as const) {
      expect(MOSAIC_OUTPUT_TARGET_DEFAULTS[t].format.videoCodec).toBeUndefined();
    }
  });

  it("BT.709 tagging on every video target", () => {
    for (const t of ["web-mp4", "web-webm", "alpha-mov"] as const) {
      const c = MOSAIC_OUTPUT_TARGET_DEFAULTS[t].color;
      expect(c.colorSpace).toBe("bt709");
      expect(c.colorPrimaries).toBe("bt709");
    }
  });
});

describe("getOutputTargetDefaults", () => {
  it("returns matrix entry for known target", () => {
    expect(getOutputTargetDefaults("web-mp4")?.format.container).toBe("mp4");
  });

  it("returns undefined for unknown target", () => {
    expect(getOutputTargetDefaults("not-a-target")).toBeUndefined();
  });

  it("returns undefined for null / empty input", () => {
    expect(getOutputTargetDefaults(null)).toBeUndefined();
    expect(getOutputTargetDefaults("")).toBeUndefined();
    expect(getOutputTargetDefaults(undefined)).toBeUndefined();
  });
});
