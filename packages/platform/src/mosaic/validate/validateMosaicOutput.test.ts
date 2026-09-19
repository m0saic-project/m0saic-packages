import {
  AUDIO_CONTAINERS,
  IMAGE_CONTAINERS,
  VIDEO_CONTAINERS,
} from "@m0saic/types";
import { validateMosaicOutput } from "./validateMosaicOutput";

// All container-kind matrix tests below are driven by `test.each` over
// the imported tuples — new containers added to `@m0saic/types`
// automatically pick up coverage with no test-file edits required.

describe("validateMosaicOutput (3d.3)", () => {
  // ───────────────────────────────────────────────────────────
  // Field-level checks
  // ───────────────────────────────────────────────────────────

  describe("durationMs", () => {
    test("accepts a positive integer", () => {
      const diags = validateMosaicOutput({ durationMs: 1000 } as any, "default");
      expect(diags.map((d) => d.code)).not.toContain("INVALID_DURATION");
    });

    test.each([
      ["non-number", "1000"],
      ["NaN", Number.NaN],
      ["non-integer", 1.25],
      ["zero", 0],
      ["negative", -1],
    ])("rejects %s as INVALID_DURATION", (_name, durationMs) => {
      const diags = validateMosaicOutput({ durationMs } as any, "default");
      expect(diags.some((d) => d.code === "INVALID_DURATION")).toBe(true);
    });

    test("omitted durationMs is fine (no diagnostic)", () => {
      const diags = validateMosaicOutput({} as any, "default");
      expect(diags.map((d) => d.code)).not.toContain("INVALID_DURATION");
    });

    test("error message includes the key", () => {
      const diags = validateMosaicOutput({ durationMs: 0 } as any, "alpha-master");
      const err = diags.find((d) => d.code === "INVALID_DURATION");
      expect(err?.message).toContain("\"alpha-master\"");
    });
  });

  describe("fps", () => {
    test.each([
      ["non-number", "30"],
      ["NaN", Number.NaN],
      ["non-integer", 29.97],
      ["zero", 0],
      ["above 240", 241],
    ])("rejects %s as INVALID_FPS", (_name, fps) => {
      const diags = validateMosaicOutput({ fps } as any, "default");
      expect(diags.some((d) => d.code === "INVALID_FPS")).toBe(true);
    });

    test.each([
      ["lower boundary 1", 1],
      ["upper boundary 240", 240],
      ["common 30", 30],
      ["common 60", 60],
    ])("accepts %s", (_name, fps) => {
      const diags = validateMosaicOutput({ fps } as any, "default");
      expect(diags.map((d) => d.code)).not.toContain("INVALID_FPS");
    });

    test("omitted fps is fine (no diagnostic)", () => {
      const diags = validateMosaicOutput({} as any, "default");
      expect(diags.map((d) => d.code)).not.toContain("INVALID_FPS");
    });
  });

  describe("empty-string warnings", () => {
    test("EMPTY_BITRATE on empty-string bitrate", () => {
      const diags = validateMosaicOutput(
        { format: { container: "mp4", bitrate: "" } } as any,
        "default",
      );
      const w = diags.find((d) => d.code === "EMPTY_BITRATE");
      expect(w?.severity).toBe("warning");
    });

    test("EMPTY_PIXEL_FORMAT on empty-string pixelFormat", () => {
      const diags = validateMosaicOutput(
        { format: { container: "mp4", pixelFormat: "" } } as any,
        "default",
      );
      const w = diags.find((d) => d.code === "EMPTY_PIXEL_FORMAT");
      expect(w?.severity).toBe("warning");
    });

    test("no false positive when bitrate is a real string", () => {
      const diags = validateMosaicOutput(
        { format: { container: "mp4", bitrate: "8M" } } as any,
        "default",
      );
      expect(diags.map((d) => d.code)).not.toContain("EMPTY_BITRATE");
    });

    test("no false positive when pixelFormat is a real string", () => {
      const diags = validateMosaicOutput(
        { format: { container: "mp4", pixelFormat: "yuv420p" } } as any,
        "default",
      );
      expect(diags.map((d) => d.code)).not.toContain("EMPTY_PIXEL_FORMAT");
    });
  });

  // ───────────────────────────────────────────────────────────
  // Audio-container matrix (every entry in AUDIO_CONTAINERS)
  // ───────────────────────────────────────────────────────────

  describe("audio-container matrix — pixelFormat ignored", () => {
    test.each(AUDIO_CONTAINERS)(
      "%s + pixelFormat → PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER",
      (container) => {
        const diags = validateMosaicOutput(
          { format: { container, pixelFormat: "yuv420p" } } as any,
          "default",
        );
        const w = diags.find((d) => d.code === "PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER");
        expect(w).toBeDefined();
        expect(w?.severity).toBe("warning");
        expect(w?.message).toContain(container);
      },
    );

    test.each(AUDIO_CONTAINERS)(
      "%s without pixelFormat → no warning",
      (container) => {
        const diags = validateMosaicOutput(
          { format: { container, bitrate: "192k" } } as any,
          "default",
        );
        expect(diags.map((d) => d.code)).not.toContain(
          "PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER",
        );
      },
    );
  });

  describe("audio-container matrix — videoCodec ignored", () => {
    test.each(AUDIO_CONTAINERS)(
      "%s + videoCodec → VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER",
      (container) => {
        const diags = validateMosaicOutput(
          { format: { container, videoCodec: "libx264" } } as any,
          "default",
        );
        const w = diags.find((d) => d.code === "VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER");
        expect(w).toBeDefined();
        expect(w?.severity).toBe("warning");
        expect(w?.message).toContain(container);
      },
    );

    test.each(AUDIO_CONTAINERS)(
      "%s without videoCodec → no warning",
      (container) => {
        const diags = validateMosaicOutput(
          { format: { container, bitrate: "192k" } } as any,
          "default",
        );
        expect(diags.map((d) => d.code)).not.toContain(
          "VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER",
        );
      },
    );
  });

  // ───────────────────────────────────────────────────────────
  // Image-container matrix (every entry in IMAGE_CONTAINERS)
  // ───────────────────────────────────────────────────────────

  describe("image-container matrix — videoCodec ignored", () => {
    test.each(IMAGE_CONTAINERS)(
      "%s + videoCodec → VIDEO_CODEC_IGNORED_FOR_IMAGE_CONTAINER",
      (container) => {
        const diags = validateMosaicOutput(
          { format: { container, videoCodec: "libx264" } } as any,
          "default",
        );
        const w = diags.find((d) => d.code === "VIDEO_CODEC_IGNORED_FOR_IMAGE_CONTAINER");
        expect(w).toBeDefined();
        expect(w?.severity).toBe("warning");
        expect(w?.message).toContain(container);
      },
    );

    test.each(IMAGE_CONTAINERS)(
      "%s without videoCodec → no warning",
      (container) => {
        const diags = validateMosaicOutput(
          { format: { container } } as any,
          "default",
        );
        expect(diags.map((d) => d.code)).not.toContain(
          "VIDEO_CODEC_IGNORED_FOR_IMAGE_CONTAINER",
        );
      },
    );
  });

  describe("image-container matrix — audio ignored", () => {
    test.each(IMAGE_CONTAINERS)(
      "%s + audio config → AUDIO_IGNORED_FOR_IMAGE_CONTAINER",
      (container) => {
        const diags = validateMosaicOutput(
          {
            format: { container },
            audio: { codec: "aac" },
          } as any,
          "default",
        );
        const w = diags.find((d) => d.code === "AUDIO_IGNORED_FOR_IMAGE_CONTAINER");
        expect(w).toBeDefined();
        expect(w?.severity).toBe("warning");
        expect(w?.message).toContain(container);
      },
    );

    test.each(IMAGE_CONTAINERS)(
      "%s without audio config → no warning",
      (container) => {
        const diags = validateMosaicOutput(
          { format: { container } } as any,
          "default",
        );
        expect(diags.map((d) => d.code)).not.toContain(
          "AUDIO_IGNORED_FOR_IMAGE_CONTAINER",
        );
      },
    );
  });

  // ───────────────────────────────────────────────────────────
  // Video-container matrix — no false positives from the audio
  // or image rules. Every video container tolerates pixelFormat
  // + videoCodec + audio config without firing the kind warnings.
  // ───────────────────────────────────────────────────────────

  describe("video-container matrix — no audio/image false positives", () => {
    test.each(VIDEO_CONTAINERS)(
      "%s + pixelFormat + videoCodec + audio config emits zero kind warnings",
      (container) => {
        const diags = validateMosaicOutput(
          {
            format: { container, pixelFormat: "yuv420p", videoCodec: "libx264" },
            audio: { codec: "aac" },
          } as any,
          "default",
        );
        const codes = diags.map((d) => d.code);
        expect(codes).not.toContain("PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER");
        expect(codes).not.toContain("VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER");
        expect(codes).not.toContain("VIDEO_CODEC_IGNORED_FOR_IMAGE_CONTAINER");
        expect(codes).not.toContain("AUDIO_IGNORED_FOR_IMAGE_CONTAINER");
      },
    );
  });

  // ───────────────────────────────────────────────────────────
  // Unknown / escape-hatch containers — skipped by the matrix.
  // ───────────────────────────────────────────────────────────

  describe("unknown container values skip the kind matrix", () => {
    test("free-string container value → no kind warnings emitted", () => {
      const diags = validateMosaicOutput(
        {
          format: { container: "totally-made-up", pixelFormat: "yuv420p", videoCodec: "libx264" },
          audio: { codec: "aac" },
        } as any,
        "default",
      );
      const codes = diags.map((d) => d.code);
      expect(codes).not.toContain("PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER");
      expect(codes).not.toContain("VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER");
      expect(codes).not.toContain("VIDEO_CODEC_IGNORED_FOR_IMAGE_CONTAINER");
      expect(codes).not.toContain("AUDIO_IGNORED_FOR_IMAGE_CONTAINER");
    });

    test("omitted container → no kind warnings emitted", () => {
      const diags = validateMosaicOutput(
        { format: { pixelFormat: "yuv420p", videoCodec: "libx264" } } as any,
        "default",
      );
      const codes = diags.map((d) => d.code);
      expect(codes).not.toContain("PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER");
      expect(codes).not.toContain("VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER");
    });
  });

  // ───────────────────────────────────────────────────────────
  // Composite happy-path / empty-format cases
  // ───────────────────────────────────────────────────────────

  test("omits the format block entirely → no diagnostics", () => {
    const diags = validateMosaicOutput({ durationMs: 1000, fps: 30 } as any, "default");
    expect(diags).toHaveLength(0);
  });

  test("fully valid video output → no diagnostics", () => {
    const diags = validateMosaicOutput(
      {
        durationMs: 1000,
        fps: 30,
        format: { container: "mp4", videoCodec: "libx264", pixelFormat: "yuv420p", bitrate: "8M" },
      } as any,
      "default",
    );
    expect(diags).toEqual([]);
  });

  test("fully valid audio output → no diagnostics", () => {
    const diags = validateMosaicOutput(
      {
        durationMs: 1000,
        format: { container: "mp3", bitrate: "192k" },
        audio: { codec: "libmp3lame", bitrate: "192k" },
      } as any,
      "default",
    );
    expect(diags).toEqual([]);
  });

  test("fully valid image output → no diagnostics", () => {
    const diags = validateMosaicOutput(
      {
        format: { container: "png", pixelFormat: "rgba" },
      } as any,
      "default",
    );
    expect(diags).toEqual([]);
  });
});
