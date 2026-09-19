import type { MosaicEngineContext, MosaicMediaKind } from "@m0saic/types";
import { determineMediaType } from "./determineMediaType";
import {
  ANIMATED_IMAGE_EXTENSIONS,
  STATIC_IMAGE_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS,
} from "@m0saic/types";

function createMockContext(mediaRegistry: Record<string, any> = {}): MosaicEngineContext & { cache?: any } { return { mode: "render" as const,
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 5000,
      workspaceDir: "/tmp/m0saic-test",
    },
    target: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 5000,
    },
    media: mediaRegistry,
    cache: ({
      get: jest.fn(),
      set: jest.fn(),
      getOrCompute: jest.fn(),
    } as any),
  };
}

describe("determineMediaType", () => {
  describe("media registry lookup", () => {
    test("returns kind from media registry when available", () => {
      const ctx = createMockContext({
        "video.mp4": { kind: "video", width: 1920, height: 1080, hasAudio: true },
      });

      expect(determineMediaType("video.mp4", ctx)).toBe("video");
    });

    test("returns image from media registry when available", () => {
      const ctx = createMockContext({
        "image.jpg": { kind: "image", width: 1920, height: 1080, hasAudio: false },
      });

      expect(determineMediaType("image.jpg", ctx)).toBe("image");
    });

    test("ignores registry entry with unknown kind", () => {
      const ctx = createMockContext({
        "file.xyz": { kind: "unknown", width: 1920, height: 1080, hasAudio: false },
      });

      // Should fall back to extension inference
      expect(determineMediaType("file.xyz", ctx)).toBe("video"); // default fallback
    });

    test("handles missing metadata in registry", () => {
      const ctx = createMockContext({
        "file.mp4": { width: 1920, height: 1080, hasAudio: true }, // no kind
      });

      // Should fall back to extension inference
      expect(determineMediaType("file.mp4", ctx)).toBe("video");
    });

    test("handles missing registry entry", () => {
      const ctx = createMockContext();

      // Should fall back to extension inference
      expect(determineMediaType("video.mp4", ctx)).toBe("video");
    });
  });

  describe("static image extensions", () => {
    test.each(STATIC_IMAGE_EXTENSIONS)("detects %s as image", (ext) => {
      const ctx = createMockContext();
      expect(determineMediaType(`file.${ext}`, ctx)).toBe("image");
    });

    test("handles uppercase static image extensions", () => {
      const ctx = createMockContext();
      expect(determineMediaType("file.JPG", ctx)).toBe("image");
      expect(determineMediaType("file.PNG", ctx)).toBe("image");
      expect(determineMediaType("file.JPEG", ctx)).toBe("image");
    });

    test("handles mixed case static image extensions", () => {
      const ctx = createMockContext();
      expect(determineMediaType("file.Jpg", ctx)).toBe("image");
      expect(determineMediaType("file.PnG", ctx)).toBe("image");
    });
  });

  describe("animated image extensions", () => {
    test.each(ANIMATED_IMAGE_EXTENSIONS)("detects %s as video (animated-capable)", (ext) => {
      const ctx = createMockContext();
      expect(determineMediaType(`file.${ext}`, ctx)).toBe("video");
    });

    test("handles uppercase animated image extensions", () => {
      const ctx = createMockContext();
      expect(determineMediaType("file.GIF", ctx)).toBe("video");
      expect(determineMediaType("file.WEBP", ctx)).toBe("video");
      expect(determineMediaType("file.AVIF", ctx)).toBe("video");
    });

    test("handles mixed case animated image extensions", () => {
      const ctx = createMockContext();
      expect(determineMediaType("file.Gif", ctx)).toBe("video");
      expect(determineMediaType("file.WebP", ctx)).toBe("video");
    });
  });

  describe("video extensions", () => {
    test.each(VIDEO_FILE_EXTENSIONS)("detects %s as video", (ext) => {
      const ctx = createMockContext();
      expect(determineMediaType(`file.${ext}`, ctx)).toBe("video");
    });

    test("handles uppercase video extensions", () => {
      const ctx = createMockContext();
      expect(determineMediaType("file.MP4", ctx)).toBe("video");
      expect(determineMediaType("file.WEBM", ctx)).toBe("video");
      expect(determineMediaType("file.MOV", ctx)).toBe("video");
    });

    test("handles mixed case video extensions", () => {
      const ctx = createMockContext();
      expect(determineMediaType("file.Mp4", ctx)).toBe("video");
      expect(determineMediaType("file.WebM", ctx)).toBe("video");
    });
  });

  describe("unknown extensions", () => {
    test("defaults to video for unknown extensions", () => {
      const ctx = createMockContext();
      expect(determineMediaType("file.xyz", ctx)).toBe("video");
      expect(determineMediaType("file.unknown", ctx)).toBe("video");
      expect(determineMediaType("file.custom", ctx)).toBe("video");
    });

    test("handles uppercase unknown extensions", () => {
      const ctx = createMockContext();
      expect(determineMediaType("file.XYZ", ctx)).toBe("video");
    });
  });

  describe("edge cases", () => {
    test("handles files without extension", () => {
      const ctx = createMockContext();
      expect(determineMediaType("filename", ctx)).toBe("video");
    });

    test("handles files with only extension", () => {
      const ctx = createMockContext();
      expect(determineMediaType(".mp4", ctx)).toBe("video");
      expect(determineMediaType(".jpg", ctx)).toBe("image");
    });

    test("handles files with multiple dots", () => {
      const ctx = createMockContext();
      expect(determineMediaType("file.name.with.dots.mp4", ctx)).toBe("video");
      expect(determineMediaType("file.name.with.dots.jpg", ctx)).toBe("image");
    });

    test("handles URLs with query parameters", () => {
      const ctx = createMockContext();
      // Query parameters prevent extension detection, so defaults to video
      expect(determineMediaType("https://example.com/video.mp4?token=abc", ctx)).toBe("video");
      expect(determineMediaType("https://example.com/image.jpg?size=large", ctx)).toBe("video");
    });

    test("handles URLs with paths", () => {
      const ctx = createMockContext();
      expect(determineMediaType("https://example.com/path/to/video.mp4", ctx)).toBe("video");
      expect(determineMediaType("https://example.com/path/to/image.png", ctx)).toBe("image");
    });

    test("handles relative paths", () => {
      const ctx = createMockContext();
      expect(determineMediaType("./video.mp4", ctx)).toBe("video");
      expect(determineMediaType("../images/photo.jpg", ctx)).toBe("image");
      expect(determineMediaType("assets/video.mp4", ctx)).toBe("video");
    });

    test("handles absolute paths", () => {
      const ctx = createMockContext();
      expect(determineMediaType("/absolute/path/to/video.mp4", ctx)).toBe("video");
      expect(determineMediaType("/absolute/path/to/image.gif", ctx)).toBe("video");
    });

    test("handles empty string", () => {
      const ctx = createMockContext();
      expect(determineMediaType("", ctx)).toBe("video");
    });

    test("handles extension with leading dot in registry", () => {
      const ctx = createMockContext({
        ".mp4": { kind: "video", width: 1920, height: 1080, hasAudio: true },
      });
      expect(determineMediaType(".mp4", ctx)).toBe("video");
    });
  });

  describe("registry priority over extension", () => {
    test("registry video overrides static image extension", () => {
      const ctx = createMockContext({
        "file.jpg": { kind: "video", width: 1920, height: 1080, hasAudio: true },
      });
      expect(determineMediaType("file.jpg", ctx)).toBe("video");
    });

    test("registry image overrides video extension", () => {
      const ctx = createMockContext({
        "file.mp4": { kind: "image", width: 1920, height: 1080, hasAudio: false },
      });
      expect(determineMediaType("file.mp4", ctx)).toBe("image");
    });

    test("registry video overrides animated image extension", () => {
      const ctx = createMockContext({
        "file.gif": { kind: "video", width: 1920, height: 1080, hasAudio: true },
      });
      expect(determineMediaType("file.gif", ctx)).toBe("video");
    });

    test("registry image overrides animated image extension", () => {
      const ctx = createMockContext({
        "file.gif": { kind: "image", width: 1920, height: 1080, hasAudio: false },
      });
      expect(determineMediaType("file.gif", ctx)).toBe("image");
    });
  });

  describe("case sensitivity", () => {
    test("extension matching is case-insensitive", () => {
      const ctx = createMockContext();
      
      // Static images
      expect(determineMediaType("file.JPG", ctx)).toBe("image");
      expect(determineMediaType("file.jpg", ctx)).toBe("image");
      expect(determineMediaType("file.Jpg", ctx)).toBe("image");
      
      // Animated images
      expect(determineMediaType("file.GIF", ctx)).toBe("video");
      expect(determineMediaType("file.gif", ctx)).toBe("video");
      expect(determineMediaType("file.Gif", ctx)).toBe("video");
      
      // Videos
      expect(determineMediaType("file.MP4", ctx)).toBe("video");
      expect(determineMediaType("file.mp4", ctx)).toBe("video");
      expect(determineMediaType("file.Mp4", ctx)).toBe("video");
    });
  });
});
