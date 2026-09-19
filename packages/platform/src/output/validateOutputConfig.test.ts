import { validateOutputConfig } from "./validateOutputConfig";

describe("validateOutputConfig — errors", () => {
  it("flags ProRes outside MOV", () => {
    const { errors } = validateOutputConfig({
      format: { videoCodec: "prores_ks", container: "mp4" },
    });
    expect(errors.map((e) => e.code)).toContain("PRORES_REQUIRES_MOV");
  });

  it("accepts ProRes in MOV", () => {
    const { errors } = validateOutputConfig({
      format: { videoCodec: "prores_ks", container: "mov" },
    });
    expect(errors).toHaveLength(0);
  });

  it("flags JPEG + alpha", () => {
    const { errors } = validateOutputConfig({
      format: { container: "jpeg" },
      alpha: true,
    });
    expect(errors.map((e) => e.code)).toContain("JPEG_DOES_NOT_SUPPORT_ALPHA");
  });

  it("flags JPEG + CRF", () => {
    const { errors } = validateOutputConfig({
      format: { container: "jpeg", crf: 20 },
    });
    expect(errors.map((e) => e.code)).toContain("JPEG_USES_QUALITY_NOT_CRF");
  });

  it("flags alpha with non-alpha pixel format", () => {
    const { errors } = validateOutputConfig({
      format: { pixelFormat: "yuv420p" },
      alpha: true,
    });
    expect(errors.map((e) => e.code)).toContain("PIXEL_FORMAT_LACKS_ALPHA");
  });

  it("accepts alpha with yuva420p", () => {
    const { errors } = validateOutputConfig({
      format: { pixelFormat: "yuva420p" },
      alpha: true,
    });
    expect(errors).toHaveLength(0);
  });

  it("flags ProRes alpha without 4444 profile", () => {
    const { errors } = validateOutputConfig({
      format: {
        videoCodec: "prores_ks",
        container: "mov",
        encoderProfile: "hq",
      },
      alpha: true,
    });
    expect(errors.map((e) => e.code)).toContain("PRORES_ALPHA_REQUIRES_4444");
  });

  it("accepts ProRes 4444 with alpha", () => {
    const { errors } = validateOutputConfig({
      format: {
        videoCodec: "prores_ks",
        container: "mov",
        encoderProfile: "4444",
        pixelFormat: "yuva444p10le",
      },
      alpha: true,
    });
    expect(errors).toHaveLength(0);
  });

  it("flags WebM with non-opus audio", () => {
    const { errors } = validateOutputConfig({
      format: { container: "webm", videoCodec: "libvpx-vp9" },
      audio: { codec: "aac" },
    });
    expect(errors.map((e) => e.code)).toContain("WEBM_AUDIO_CODEC_INCOMPAT");
  });

  it("accepts WebM with Opus audio", () => {
    const { errors } = validateOutputConfig({
      format: { container: "webm", videoCodec: "libvpx-vp9" },
      audio: { codec: "libopus" },
    });
    expect(errors).toHaveLength(0);
  });

  it("flags video codec in audio-only container", () => {
    const { errors } = validateOutputConfig({
      format: { container: "mp3", videoCodec: "libx264" },
    });
    expect(errors.map((e) => e.code)).toContain("AUDIO_CONTAINER_NO_VIDEO");
  });

  it("flags H.264 in WebM", () => {
    const { errors } = validateOutputConfig({
      format: { container: "webm", videoCodec: "libx264" },
    });
    expect(errors.map((e) => e.code)).toContain("WEBM_VIDEO_CODEC_INCOMPAT");
  });

  it("flags VP9 in MP4", () => {
    const { errors } = validateOutputConfig({
      format: { container: "mp4", videoCodec: "libvpx-vp9" },
    });
    expect(errors.map((e) => e.code)).toContain("MP4_VIDEO_CODEC_INCOMPAT");
  });
});

describe("validateOutputConfig — warnings", () => {
  it("warns on lossless CRF 0 with x264", () => {
    const { warnings } = validateOutputConfig({
      format: { videoCodec: "libx264", crf: 0 },
    });
    expect(warnings.map((w) => w.code)).toContain("LOSSLESS_CRF_HUGE_FILES");
  });

  it("warns when both bitrate and CRF are set", () => {
    const { warnings } = validateOutputConfig({
      format: { videoCodec: "libx264", bitrate: "4M", crf: 23 },
    });
    expect(warnings.map((w) => w.code)).toContain("BITRATE_AND_CRF_BOTH_SET");
  });

  it("warns when audio mode is off but audio fields set", () => {
    const { warnings } = validateOutputConfig({
      audio: { mode: "off", codec: "aac", bitrate: "192k" },
    });
    const codes = warnings.map((w) => w.code);
    expect(codes.filter((c) => c === "AUDIO_DISABLED_FIELD_IGNORED")).toHaveLength(2);
  });

  it("warns on VP9 CRF out of range", () => {
    const { warnings } = validateOutputConfig({
      format: { videoCodec: "libvpx-vp9", crf: 80 },
    });
    expect(warnings.map((w) => w.code)).toContain("VP9_CRF_OUT_OF_RANGE");
  });

  it("warns on x264 CRF > 51", () => {
    const { warnings } = validateOutputConfig({
      format: { videoCodec: "libx264", crf: 60 },
    });
    expect(warnings.map((w) => w.code)).toContain("X264_X265_CRF_OUT_OF_RANGE");
  });

  it("warns on hardware encoder + CRF", () => {
    const { warnings } = validateOutputConfig({
      format: { videoCodec: "h264_nvenc", crf: 23 },
    });
    expect(warnings.map((w) => w.code)).toContain("HARDWARE_CRF_NOT_RESPECTED");
  });

  it("flags H.264 level too low for 1080p60", () => {
    const { warnings } = validateOutputConfig({
      format: { videoCodec: "libx264", encoderLevel: "3.1" },
      size: { width: 1920, height: 1080 },
      fps: 60,
    });
    expect(warnings.map((w) => w.code)).toContain("H264_LEVEL_TOO_LOW");
  });

  it("accepts H.264 level 4.1 for 1080p30", () => {
    const { warnings } = validateOutputConfig({
      format: { videoCodec: "libx264", encoderLevel: "4.1" },
      size: { width: 1920, height: 1080 },
      fps: 30,
    });
    expect(warnings.map((w) => w.code)).not.toContain("H264_LEVEL_TOO_LOW");
  });
});

describe("validateOutputConfig — advice", () => {
  it("advises on Opus bitrate ≥256k", () => {
    const { advice } = validateOutputConfig({
      audio: { codec: "libopus", bitrate: "320k" },
    });
    expect(advice.map((a) => a.code)).toContain("OPUS_BITRATE_EXCESSIVE");
  });

  it("does not advise on Opus at 192k", () => {
    const { advice } = validateOutputConfig({
      audio: { codec: "libopus", bitrate: "192k" },
    });
    expect(advice.map((a) => a.code)).not.toContain("OPUS_BITRATE_EXCESSIVE");
  });

  it("advises on x264 ultrafast", () => {
    const { advice } = validateOutputConfig({
      format: { videoCodec: "libx264", encoderPreset: "ultrafast" },
    });
    expect(advice.map((a) => a.code)).toContain("ULTRAFAST_QUALITY_CLIFF");
  });

  it("advises on libaom-av1", () => {
    const { advice } = validateOutputConfig({
      format: { videoCodec: "libaom-av1" },
    });
    expect(advice.map((a) => a.code)).toContain("LIBAOM_AV1_SLOW");
  });
});

describe("validateOutputConfig — clean configurations", () => {
  it("empty input → all clean", () => {
    const r = validateOutputConfig({});
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.advice).toHaveLength(0);
  });

  it("web-mp4 h264 stays clean", () => {
    const r = validateOutputConfig({
      target: "web-mp4",
      format: {
        container: "mp4",
        videoCodec: "libx264",
        crf: 23,
        encoderPreset: "medium",
        pixelFormat: "yuv420p",
      },
      audio: { codec: "aac", bitrate: "192k" },
    });
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.advice).toHaveLength(0);
  });

  it("web-webm vp9 + opus stays clean", () => {
    const r = validateOutputConfig({
      target: "web-webm",
      format: {
        container: "webm",
        videoCodec: "libvpx-vp9",
        crf: 32,
        pixelFormat: "yuv420p",
      },
      audio: { codec: "libopus", bitrate: "128k" },
    });
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.advice).toHaveLength(0);
  });
});

describe("validateOutputConfig — field anchors", () => {
  it("attaches field anchor to each diagnostic", () => {
    const { errors } = validateOutputConfig({
      format: { videoCodec: "prores_ks", container: "mp4" },
    });
    expect(errors[0].field).toBe("container");
  });

  it("pins JPEG+CRF to crf field", () => {
    const { errors } = validateOutputConfig({
      format: { container: "jpeg", crf: 5 },
    });
    expect(errors.find((e) => e.code === "JPEG_USES_QUALITY_NOT_CRF")?.field).toBe("crf");
  });
});
