import {
  AUDIO_CODECS,
  AUDIO_CONTAINERS,
  IMAGE_CONTAINERS,
  PIXEL_FORMATS,
  VIDEO_CODECS,
  VIDEO_CONTAINERS,
  type AudioCodec,
  type AudioContainer,
  type MosaicOutputFormat,
  type PixelFormat,
  type VideoCodec,
  type VideoContainer,
} from "./format";

describe("VIDEO_CONTAINERS", () => {
  it("includes the core web/cross-platform containers", () => {
    for (const c of ["mp4", "webm", "mov", "mkv"]) {
      expect(VIDEO_CONTAINERS).toContain(c);
    }
  });

  it("includes legacy + broadly-compatible containers (avi, flv)", () => {
    for (const c of ["avi", "flv"]) {
      expect(VIDEO_CONTAINERS).toContain(c);
    }
  });

  it("includes MPEG transport / system / program streams (ts, m2ts, mpg)", () => {
    for (const c of ["ts", "m2ts", "mpg"]) {
      expect(VIDEO_CONTAINERS).toContain(c);
    }
  });

  it("includes mobile and Apple variants (3gp, 3g2, m4v)", () => {
    for (const c of ["3gp", "3g2", "m4v"]) {
      expect(VIDEO_CONTAINERS).toContain(c);
    }
  });

  it("includes Microsoft (wmv, asf) and Adobe Flash (f4v)", () => {
    for (const c of ["wmv", "asf", "f4v"]) {
      expect(VIDEO_CONTAINERS).toContain(c);
    }
  });

  it("includes professional / broadcast (mxf, dv, nut)", () => {
    for (const c of ["mxf", "dv", "nut"]) {
      expect(VIDEO_CONTAINERS).toContain(c);
    }
  });

  it("each tuple member assigns to VideoContainer", () => {
    for (const c of VIDEO_CONTAINERS) {
      const x: VideoContainer = c;
      expect(x).toBe(c);
    }
  });
});

describe("IMAGE_CONTAINERS", () => {
  it("includes the classic containers (png, jpeg, gif)", () => {
    for (const c of ["png", "jpeg", "gif"]) {
      expect(IMAGE_CONTAINERS).toContain(c);
    }
  });

  it("includes modern animation-capable containers (apng, webp, avif)", () => {
    for (const c of ["apng", "webp", "avif"]) {
      expect(IMAGE_CONTAINERS).toContain(c);
    }
  });

  it("includes specialized containers (tiff, bmp, ico)", () => {
    for (const c of ["tiff", "bmp", "ico"]) {
      expect(IMAGE_CONTAINERS).toContain(c);
    }
  });
});

describe("AUDIO_CONTAINERS", () => {
  it("includes the canonical audio containers", () => {
    for (const c of ["mp3", "wav", "flac", "aac", "m4a"]) {
      expect(AUDIO_CONTAINERS).toContain(c);
    }
  });

  it("includes Xiph containers (ogg, opus)", () => {
    for (const c of ["ogg", "opus"]) {
      expect(AUDIO_CONTAINERS).toContain(c);
    }
  });

  it("includes surround / pro-audio containers (ac3, eac3, dts)", () => {
    for (const c of ["ac3", "eac3", "dts"]) {
      expect(AUDIO_CONTAINERS).toContain(c);
    }
  });

  it("includes mobile / Apple containers (amr, caf)", () => {
    for (const c of ["amr", "caf"]) {
      expect(AUDIO_CONTAINERS).toContain(c);
    }
  });

  it("each tuple member assigns to AudioContainer", () => {
    for (const c of AUDIO_CONTAINERS) {
      const x: AudioContainer = c;
      expect(x).toBe(c);
    }
  });
});

describe("VIDEO_CODECS", () => {
  it("includes the canonical software encoders", () => {
    const software = [
      "libx264",
      "libx265",
      "libopenh264",
      "libvpx-vp9",
      "libaom-av1",
      "libsvtav1",
      "prores_ks",
      "prores_aw",
      "mjpeg",
    ];
    for (const c of software) {
      expect(VIDEO_CODECS).toContain(c);
    }
  });

  it("includes the Apple VideoToolbox hardware encoders", () => {
    for (const c of [
      "h264_videotoolbox",
      "hevc_videotoolbox",
      "prores_videotoolbox",
    ]) {
      expect(VIDEO_CODECS).toContain(c);
    }
  });

  it("includes the NVIDIA NVENC hardware encoders", () => {
    for (const c of ["h264_nvenc", "hevc_nvenc", "av1_nvenc"]) {
      expect(VIDEO_CODECS).toContain(c);
    }
  });

  it("includes the Intel Quick Sync hardware encoders", () => {
    for (const c of ["h264_qsv", "hevc_qsv", "av1_qsv", "vp9_qsv"]) {
      expect(VIDEO_CODECS).toContain(c);
    }
  });

  it("includes the AMD AMF hardware encoders", () => {
    for (const c of ["h264_amf", "hevc_amf", "av1_amf"]) {
      expect(VIDEO_CODECS).toContain(c);
    }
  });

  it("includes the Linux VAAPI generic-hardware encoders", () => {
    for (const c of [
      "h264_vaapi",
      "hevc_vaapi",
      "av1_vaapi",
      "vp9_vaapi",
      "mjpeg_vaapi",
    ]) {
      expect(VIDEO_CODECS).toContain(c);
    }
  });

  it("each tuple member assigns to VideoCodec", () => {
    for (const c of VIDEO_CODECS) {
      const x: VideoCodec = c;
      expect(x).toBe(c);
    }
  });
});

describe("AUDIO_CODECS", () => {
  it("includes the canonical six (aac, libmp3lame, libopus, flac, pcm_s16le, pcm_s24le)", () => {
    expect(AUDIO_CODECS).toEqual([
      "aac",
      "libmp3lame",
      "libopus",
      "flac",
      "pcm_s16le",
      "pcm_s24le",
    ]);
  });

  it("each tuple member assigns to AudioCodec", () => {
    for (const c of AUDIO_CODECS) {
      const x: AudioCodec = c;
      expect(x).toBe(c);
    }
  });
});

describe("PIXEL_FORMATS", () => {
  it("includes the 8-bit YUV + alpha variants", () => {
    for (const f of ["yuv420p", "yuv422p", "yuv444p", "yuva420p", "yuva422p", "yuva444p"]) {
      expect(PIXEL_FORMATS).toContain(f);
    }
  });

  it("includes the JPEG full-range variants", () => {
    for (const f of ["yuvj420p", "yuvj422p", "yuvj444p"]) {
      expect(PIXEL_FORMATS).toContain(f);
    }
  });

  it("includes the 10-bit variants required for ProRes 4444 and HDR", () => {
    for (const f of ["yuv420p10le", "yuv422p10le", "yuv444p10le", "yuva444p10le"]) {
      expect(PIXEL_FORMATS).toContain(f);
    }
  });

  it("includes RGBA variants for PNG / image alpha", () => {
    for (const f of ["rgba", "argb", "bgra", "abgr", "rgb24", "bgr24"]) {
      expect(PIXEL_FORMATS).toContain(f);
    }
  });

  it("includes pal8 for GIF", () => {
    expect(PIXEL_FORMATS).toContain("pal8");
  });

  it("each tuple member assigns to PixelFormat", () => {
    for (const f of PIXEL_FORMATS) {
      const x: PixelFormat = f;
      expect(x).toBe(f);
    }
  });
});

describe("MosaicOutputFormat", () => {
  it("accepts an empty object (all fields optional)", () => {
    const f: MosaicOutputFormat = {};
    expect(f).toEqual({});
  });

  it("accepts every documented field", () => {
    const f: MosaicOutputFormat = {
      kind: "video",
      container: "mp4",
      videoCodec: "libx264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      frameCount: 1,
      bitrate: "4M",
      crf: 23,
      encoderPreset: "veryfast",
      encoderProfile: "high",
      encoderLevel: "4.0",
      gopSize: 250,
      encoderOptions: { "aq-mode": 2, "aq-strength": "0.8" },
    };
    expect(f.crf).toBe(23);
    expect(f.encoderOptions).toEqual({ "aq-mode": 2, "aq-strength": "0.8" });
  });

  it("accepts string escape-hatch values for codecs and containers", () => {
    const f: MosaicOutputFormat = {
      videoCodec: "some_future_encoder",
      container: "experimental_container",
      pixelFormat: "yuv420p12le",
    };
    expect(f.videoCodec).toBe("some_future_encoder");
  });

  it("accepts frameCount as 1 or \"sequence\"", () => {
    const a: MosaicOutputFormat = { frameCount: 1 };
    const b: MosaicOutputFormat = { frameCount: "sequence" };
    expect(a.frameCount).toBe(1);
    expect(b.frameCount).toBe("sequence");
  });

  it("does not expose a hasAlpha field (alpha is encoded in pixelFormat)", () => {
    // Type-level: this would compile-error if `hasAlpha` were on the type.
    const f: MosaicOutputFormat = { pixelFormat: "yuva420p" };
    expect("hasAlpha" in f).toBe(false);
  });
});
