import * as fs from "fs";
import * as path from "path";
import {
  BUNDLED_FONT_FACES,
  bundledFontCacheKey,
  isBundledDefaultFace,
  registerBundledFontBytes,
} from "./bundledFonts";
import { BUNDLED_FONT_CACHE_KEY, getCachedFont } from "./fontCache";
import { resolveFontFile } from "./fontRegistry";
import { bundledFontPath, measureText } from "./textToPath";

const FONT_DIR = path.dirname(bundledFontPath());

describe("bundled font manifest", () => {
  test("names both families in all four faces, and every file ships in assets/fonts", () => {
    expect(BUNDLED_FONT_FACES).toHaveLength(8);
    for (const face of BUNDLED_FONT_FACES) {
      expect(fs.existsSync(path.join(FONT_DIR, face.file))).toBe(true);
    }
    const families = new Set(BUNDLED_FONT_FACES.map((f) => f.family));
    expect([...families].sort()).toEqual(["JetBrains Mono", "Roboto"]);
  });

  test("the default face's key is the long-standing BUNDLED_FONT_CACHE_KEY", () => {
    expect(bundledFontCacheKey("Roboto-Regular.ttf")).toBe(BUNDLED_FONT_CACHE_KEY);
    expect(isBundledDefaultFace("Roboto-Regular.ttf")).toBe(true);
    expect(isBundledDefaultFace("JetBrainsMono-Regular.ttf")).toBe(false);
    expect(bundledFontCacheKey("JetBrainsMono-Bold.ttf")).toBe("@m0saic/text:bundled/JetBrainsMono-Bold");
  });

  test("Node registers every face by disk path on import", () => {
    for (const face of BUNDLED_FONT_FACES) {
      const r = resolveFontFile({ family: face.family, weight: face.weight, style: face.style });
      expect(r && path.basename(r.path)).toBe(face.file);
    }
  });
});

describe("registerBundledFontBytes (the browser seam)", () => {
  test("a face registered from bytes resolves by family and measures EXACTLY like the disk file", () => {
    const file = "JetBrainsMono-Regular.ttf";
    const diskPath = path.join(FONT_DIR, file);
    const fromDisk = measureText("Hello, world.", { fontSize: 40, fontPath: diskPath });

    const bytes = fs.readFileSync(diskPath);
    registerBundledFontBytes(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    const key = bundledFontCacheKey(file);
    expect(getCachedFont(key)).toBeDefined();
    // The family now resolves to the cache key — a "path" the cache-first
    // loader serves without fs, on either host.
    expect(resolveFontFile({ family: "JetBrains Mono" })?.path).toBe(key);
    const fromBytes = measureText("Hello, world.", { fontSize: 40, fontPath: key });
    expect(fromBytes.width).toBe(fromDisk.width);
    expect(fromBytes.ascent).toBe(fromDisk.ascent);
    // …and is visibly not the default face: a mono line is wider than Roboto's.
    const roboto = measureText("Hello, world.", { fontSize: 40 });
    expect(fromBytes.width).toBeGreaterThan(roboto.width);
  });

  test("rejects a file outside the manifest", () => {
    expect(() => registerBundledFontBytes("ComicSans.ttf", new ArrayBuffer(4))).toThrow(/not a bundled font/);
  });
});
