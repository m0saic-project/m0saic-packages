import * as fs from "fs";
import * as path from "path";
import {
  registerFontBytes,
  registerParsedFont,
  getCachedFont,
  setCachedFont,
  getOpentype,
  BUNDLED_FONT_CACHE_KEY,
  __clearFontCache,
} from "./fontCache";
import { measureText, textToPath } from "./textToPath";

/** The bundled Roboto Regular, as an ArrayBuffer (what the browser would fetch
 *  and hand to registerFontBytes). In Node we read it from the assets dir. */
function robotoBytes(): ArrayBuffer {
  const buf = fs.readFileSync(
    path.resolve(__dirname, "../assets/fonts/Roboto-Regular.ttf"),
  );
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("fontCache", () => {
  beforeEach(() => __clearFontCache());
  afterEach(() => __clearFontCache());

  test("registerFontBytes parses raw bytes into a usable Font", () => {
    const font = registerFontBytes("test-key", robotoBytes());
    expect(typeof font.getAdvanceWidth).toBe("function");
    expect(font.getAdvanceWidth("Hi", 100)).toBeGreaterThan(0);
    // …and it's retrievable by key.
    expect(getCachedFont("test-key")).toBe(font);
  });

  test("registerParsedFont / setCachedFont round-trip by key", () => {
    const font = getOpentype().parse(robotoBytes());
    registerParsedFont("parsed-key", font);
    expect(getCachedFont("parsed-key")).toBe(font);

    setCachedFont("set-key", font);
    expect(getCachedFont("set-key")).toBe(font);
  });

  test("getCachedFont returns undefined for an unregistered key", () => {
    expect(getCachedFont("nope")).toBeUndefined();
  });

  test("BUNDLED_FONT_CACHE_KEY is a stable non-empty string", () => {
    expect(typeof BUNDLED_FONT_CACHE_KEY).toBe("string");
    expect(BUNDLED_FONT_CACHE_KEY.length).toBeGreaterThan(0);
  });

  // The browser seam: with the bundled bytes pre-registered under the default
  // key, textToPath / measureText resolve the default font from the cache
  // WITHOUT reading from disk — and produce identical output to the disk path.
  describe("default-font resolution via the cache (browser path)", () => {
    test("measureText matches the disk-loaded result after registerFontBytes", () => {
      // Disk path (fontPath omitted → loadFont reads the bundled file).
      const fromDisk = measureText("Hello m0saic", { fontSize: 64 });

      // Cache path: clear, pre-register the bytes under the default key.
      __clearFontCache();
      registerFontBytes(BUNDLED_FONT_CACHE_KEY, robotoBytes());
      expect(getCachedFont(BUNDLED_FONT_CACHE_KEY)).toBeDefined();
      const fromCache = measureText("Hello m0saic", { fontSize: 64 });

      expect(fromCache.width).toBeCloseTo(fromDisk.width, 5);
      expect(fromCache.height).toBeCloseTo(fromDisk.height, 5);
      expect(fromCache.lines).toBe(fromDisk.lines);
    });

    test("textToPath matches the disk-loaded result after registerFontBytes", () => {
      const canvas = { width: 400, height: 120 };
      const fromDisk = textToPath("Preview", { fontSize: 48 }, canvas);

      __clearFontCache();
      registerFontBytes(BUNDLED_FONT_CACHE_KEY, robotoBytes());
      const fromCache = textToPath("Preview", { fontSize: 48 }, canvas);

      expect(fromCache).toBe(fromDisk);
      expect(fromCache.length).toBeGreaterThan(0);
    });
  });
});
