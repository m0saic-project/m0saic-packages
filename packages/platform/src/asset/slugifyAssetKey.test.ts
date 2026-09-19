import { FRIENDLY_SLUG_PATTERN, asAssetId } from "@m0saic/types";
import type { MosaicAssetManifest } from "@m0saic/types";
import {
  slugifyAssetKey,
  slugifyAssetKeyFromPath,
  uniqueAssetKey,
} from "./slugifyAssetKey";

describe("slugifyAssetKey", () => {
  const mustBeValid = (s: string) => {
    expect(s).toMatch(FRIENDLY_SLUG_PATTERN);
  };

  it("strips the extension and keeps a clean name as-is", () => {
    expect(slugifyAssetKey("big_buck_bunny_1080p_h264.mov")).toBe(
      "big_buck_bunny_1080p_h264",
    );
    mustBeValid(slugifyAssetKey("hero.mp4"));
  });

  it("replaces spaces and special chars with underscores", () => {
    const s = slugifyAssetKey("My Movie (final).mp4");
    expect(s).toBe("My_Movie_final");
    mustBeValid(s);
  });

  it("strips emojis and other non-ASCII", () => {
    const s = slugifyAssetKey("🎬 hero.mov");
    expect(s).toBe("hero");
    mustBeValid(s);
  });

  it("strips leading dot / hyphen so first char is letter/digit/underscore", () => {
    expect(slugifyAssetKey(".hidden.mov")).toBe("hidden");
    expect(slugifyAssetKey("-leading.mp4")).toBe("leading");
    mustBeValid(slugifyAssetKey(".hidden.mov"));
  });

  it("falls back to 'asset' when nothing usable remains", () => {
    expect(slugifyAssetKey("---.mov")).toBe("asset");
    expect(slugifyAssetKey("...")).toBe("asset");
    expect(slugifyAssetKey("🎬🎬🎬.mov")).toBe("asset");
  });

  it("caps length at 128", () => {
    const long = "a".repeat(200) + ".mp4";
    const s = slugifyAssetKey(long);
    expect(s.length).toBeLessThanOrEqual(128);
    mustBeValid(s);
  });

  it("keeps file with no extension intact", () => {
    expect(slugifyAssetKey("README")).toBe("README");
  });
});

describe("slugifyAssetKeyFromPath", () => {
  it("strips POSIX and Windows separators before slugifying", () => {
    expect(
      slugifyAssetKeyFromPath("/Users/me/Mosaic Demos/big_buck_bunny_1080p_h264.mov"),
    ).toBe("big_buck_bunny_1080p_h264");
    expect(
      slugifyAssetKeyFromPath("C:\\Users\\me\\My Movies\\clip.mp4"),
    ).toBe("clip");
  });

  it("handles a bare filename (no separator)", () => {
    expect(slugifyAssetKeyFromPath("hero.mp4")).toBe("hero");
  });
});

describe("uniqueAssetKey", () => {
  const manifest = (...keys: string[]): MosaicAssetManifest => {
    const m: MosaicAssetManifest = {};
    for (const k of keys) {
      m[asAssetId(k)] = { kind: "file", path: "/x.mp4" };
    }
    return m;
  };

  it("returns the base when no collision", () => {
    expect(uniqueAssetKey("hero", undefined)).toBe("hero");
    expect(uniqueAssetKey("hero", manifest())).toBe("hero");
    expect(uniqueAssetKey("hero", manifest("intro"))).toBe("hero");
  });

  it("suffixes _2, _3 on collision", () => {
    expect(uniqueAssetKey("hero", manifest("hero"))).toBe("hero_2");
    expect(uniqueAssetKey("hero", manifest("hero", "hero_2"))).toBe("hero_3");
  });

  it("respects the 128 char cap when suffixing", () => {
    const longBase = "a".repeat(128);
    const collided = manifest(longBase);
    const out = uniqueAssetKey(longBase, collided);
    expect(out.length).toBeLessThanOrEqual(128);
    expect(out.endsWith("_2")).toBe(true);
  });
});
