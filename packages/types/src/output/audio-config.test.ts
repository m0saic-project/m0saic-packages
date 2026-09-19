import type { MosaicAudioConfig } from "./audio-config";

describe("MosaicAudioConfig", () => {
  it("accepts the empty config (all fields optional)", () => {
    const c: MosaicAudioConfig = {};
    expect(c).toEqual({});
  });

  it("accepts the canonical full shape", () => {
    const c: MosaicAudioConfig = {
      mode: "auto",
      codec: "aac",
      bitrate: "192k",
      sampleRate: 48000,
      channelLayout: "stereo",
    };
    expect(c.codec).toBe("aac");
    expect(c.sampleRate).toBe(48000);
  });

  it('accepts mode: "off" to suppress the audio stream', () => {
    const c: MosaicAudioConfig = { mode: "off" };
    expect(c.mode).toBe("off");
  });

  it("accepts string escape-hatch codecs outside the typed union", () => {
    const c: MosaicAudioConfig = { codec: "future_audio_codec_xyz" };
    expect(c.codec).toBe("future_audio_codec_xyz");
  });
});
