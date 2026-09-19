import {
  asAssetId,
  type MosaicAssetManifest,
} from "@m0saic/types";
import {
  resolveAsset,
  AssetResolveError,
  type AssetResolveResult,
} from "./resolveAsset";

const HERO = asAssetId("hero");
const URL_ID = asAssetId("remote");
const DATA_ID = asAssetId("inline");

function makeManifest(): MosaicAssetManifest {
  return {
    [HERO]: { kind: "file", path: "/abs/hero.mp4", mediaType: "video", displayName: "hero.mp4" },
    [URL_ID]: { kind: "url", url: "https://example.com/clip.mp4" },
    [DATA_ID]: { kind: "data-uri", uri: "data:image/png;base64,AAAA" },
  };
}

describe("resolveAsset — file kind", () => {
  const m = makeManifest();

  it("node-path returns absolute path", () => {
    const r = resolveAsset(m, HERO, { target: "node-path" });
    expect(r).toEqual({ target: "node-path", value: "/abs/hero.mp4" });
  });

  it("browser-url returns mosaic-asset:// URL preserving leading slash", () => {
    const r = resolveAsset(m, HERO, { target: "browser-url" }) as AssetResolveResult & { target: "browser-url" };
    expect(r.target).toBe("browser-url");
    expect(r.value).toBe("mosaic-asset:///abs/hero.mp4");
  });

  it("ffmpeg-input emits -i for video", () => {
    const r = resolveAsset(m, HERO, { target: "ffmpeg-input" }) as AssetResolveResult & { target: "ffmpeg-input" };
    expect(r.argv).toEqual(["-i", "/abs/hero.mp4"]);
  });

  it("ffmpeg-input emits -loop/-framerate for image", () => {
    const m2: MosaicAssetManifest = {
      [HERO]: { kind: "file", path: "/abs/poster.png", mediaType: "image" },
    };
    const r = resolveAsset(m2, HERO, { target: "ffmpeg-input", fps: 30 }) as AssetResolveResult & { target: "ffmpeg-input" };
    expect(r.argv).toEqual(["-loop", "1", "-framerate", "30", "-i", "/abs/poster.png"]);
  });

  it("ffmpeg-input image without fps throws ASSET_MALFORMED", () => {
    const m2: MosaicAssetManifest = {
      [HERO]: { kind: "file", path: "/abs/poster.png", mediaType: "image" },
    };
    expect(() => resolveAsset(m2, HERO, { target: "ffmpeg-input" })).toThrow(AssetResolveError);
  });

  it("display-name uses displayName then falls back to basename", () => {
    expect(
      (resolveAsset(m, HERO, { target: "display-name" }) as { value: string }).value,
    ).toBe("hero.mp4");

    const m2: MosaicAssetManifest = {
      [HERO]: { kind: "file", path: "/abs/path/with spaces/clip (final).mp4" },
    };
    expect(
      (resolveAsset(m2, HERO, { target: "display-name" }) as { value: string }).value,
    ).toBe("clip (final).mp4");
  });
});

describe("resolveAsset — url kind", () => {
  const m = makeManifest();

  it("node-path throws ASSET_KIND_INCOMPATIBLE", () => {
    let err: AssetResolveError | undefined;
    try {
      resolveAsset(m, URL_ID, { target: "node-path" });
    } catch (e) {
      err = e as AssetResolveError;
    }
    expect(err).toBeInstanceOf(AssetResolveError);
    expect(err?.code).toBe("ASSET_KIND_INCOMPATIBLE");
  });

  it("browser-url returns the URL as-is", () => {
    const r = resolveAsset(m, URL_ID, { target: "browser-url" }) as { value: string };
    expect(r.value).toBe("https://example.com/clip.mp4");
  });

  it("ffmpeg-input emits -i <url>", () => {
    const r = resolveAsset(m, URL_ID, { target: "ffmpeg-input" }) as { argv: string[] };
    expect(r.argv).toEqual(["-i", "https://example.com/clip.mp4"]);
  });
});

describe("resolveAsset — data-uri kind", () => {
  const m = makeManifest();

  it("node-path throws ASSET_KIND_INCOMPATIBLE", () => {
    expect(() => resolveAsset(m, DATA_ID, { target: "node-path" })).toThrow(/data-uri/);
  });

  it("browser-url returns uri as-is", () => {
    const r = resolveAsset(m, DATA_ID, { target: "browser-url" }) as { value: string };
    expect(r.value).toBe("data:image/png;base64,AAAA");
  });

  it("display-name uses truncated uri preview when displayName missing", () => {
    const r = resolveAsset(m, DATA_ID, { target: "display-name" }) as { value: string };
    expect(r.value).toMatch(/^<data:image\/png/);
  });

  it("ffmpeg-input emits -i <uri> for a non-image data-uri", () => {
    const r = resolveAsset(m, DATA_ID, { target: "ffmpeg-input" }) as { argv: string[] };
    expect(r.argv).toEqual(["-i", "data:image/png;base64,AAAA"]);
  });

  it("ffmpeg-input loops a still image data-uri (mediaType image + fps)", () => {
    const r = resolveAsset(m, DATA_ID, {
      target: "ffmpeg-input",
      mediaType: "image",
      fps: 30,
    }) as { argv: string[] };
    expect(r.argv).toEqual([
      "-loop",
      "1",
      "-framerate",
      "30",
      "-i",
      "data:image/png;base64,AAAA",
    ]);
  });

  it("ffmpeg-input throws when an image data-uri is missing fps", () => {
    expect(() =>
      resolveAsset(m, DATA_ID, { target: "ffmpeg-input", mediaType: "image" }),
    ).toThrow(/requires fps/);
  });
});

describe("resolveAsset — error paths", () => {
  it("missing assetId throws ASSET_NOT_FOUND with the assetId attached", () => {
    let err: AssetResolveError | undefined;
    try {
      resolveAsset({}, asAssetId("nope"), { target: "node-path" });
    } catch (e) {
      err = e as AssetResolveError;
    }
    expect(err?.code).toBe("ASSET_NOT_FOUND");
    expect(err?.assetId).toBe("nope");
  });

  it("file kind with empty path throws ASSET_MALFORMED", () => {
    const m: MosaicAssetManifest = {
      [HERO]: { kind: "file", path: "" },
    };
    expect(() => resolveAsset(m, HERO, { target: "node-path" })).toThrow(/no path/);
  });

  it("unknown kind sneaking past TS throws ASSET_MALFORMED", () => {
    const m = {
      [HERO]: { kind: "totally-fake" },
    } as unknown as MosaicAssetManifest;
    let err: AssetResolveError | undefined;
    try {
      resolveAsset(m, HERO, { target: "node-path" });
    } catch (e) {
      err = e as AssetResolveError;
    }
    expect(err?.code).toBe("ASSET_MALFORMED");
  });
});

describe("resolveAsset — cross-platform path stress", () => {
  // Spaces, parens, brackets, single quotes, unicode, emojis are all legal on
  // every host filesystem we care about (Win/macOS/Linux). The resolver must
  // round-trip them verbatim — argv-array spawn is escape-free at the OS
  // boundary, and mosaic-asset:// is a permissive URL scheme.
  const cases: Array<{ name: string; path: string; expectedUrl: string }> = [
    {
      name: "spaces",
      path: "/abs/with spaces/clip.mp4",
      expectedUrl: "mosaic-asset:///abs/with spaces/clip.mp4",
    },
    {
      name: "parens + brackets",
      path: "/abs/clip (final) [v2].mp4",
      expectedUrl: "mosaic-asset:///abs/clip (final) [v2].mp4",
    },
    {
      name: "single quote",
      path: "/abs/o'brien.mp4",
      expectedUrl: "mosaic-asset:///abs/o'brien.mp4",
    },
    {
      name: "unicode",
      path: "/abs/café/Über.mp4",
      expectedUrl: "mosaic-asset:///abs/café/Über.mp4",
    },
    {
      name: "emoji",
      path: "/abs/🎬movie.mp4",
      expectedUrl: "mosaic-asset:///abs/🎬movie.mp4",
    },
    // Windows paths get a leading slash for the URL: "C:\Users\me\clip.mp4"
    // → "mosaic-asset:///C:/Users/me/clip.mp4". The Electron protocol
    // handler at apps/mosaic/electron/main.js:3113 unpacks this back to a
    // platform path (peeling the leading slash + drive letter handling).
    {
      name: "Windows drive letter (C:)",
      path: "C:\\Users\\me\\clip.mp4",
      expectedUrl: "mosaic-asset:///C:/Users/me/clip.mp4",
    },
    {
      name: "Windows drive letter (D:) with spaces",
      path: "D:\\Video Library\\hero.mp4",
      expectedUrl: "mosaic-asset:///D:/Video Library/hero.mp4",
    },
    // URL-reserved chars that would otherwise truncate or rewrite the
    // path when Chromium parses the URL. Without percent-encoding,
    // `foo#31.jpg` becomes `url.pathname = "/abs/foo"` + `url.hash =
    // "#31.jpg"` and the protocol handler reads a truncated path →
    // ENOENT. Same class of bug applies to `?` (query delimiter) and
    // `%` (escape introducer, which must be encoded as `%25` so
    // decodeURIComponent on the other side doesn't double-decode).
    {
      name: "hash in basename",
      path: "/abs/file#31.jpg",
      expectedUrl: "mosaic-asset:///abs/file%2331.jpg",
    },
    {
      name: "hash in directory",
      path: "/abs/folder#2/clip.mp4",
      expectedUrl: "mosaic-asset:///abs/folder%232/clip.mp4",
    },
    {
      name: "question mark in name",
      path: "/abs/Where is it?.jpg",
      expectedUrl: "mosaic-asset:///abs/Where is it%3F.jpg",
    },
    {
      name: "literal percent in name",
      path: "/abs/50% off sale.jpg",
      expectedUrl: "mosaic-asset:///abs/50%25 off sale.jpg",
    },
    {
      name: "Windows path with hash",
      path: "N:\\Library\\ggworld_#31.jpg",
      expectedUrl: "mosaic-asset:///N:/Library/ggworld_%2331.jpg",
    },
  ];

  for (const c of cases) {
    it(`round-trips: ${c.name}`, () => {
      const m: MosaicAssetManifest = {
        [HERO]: { kind: "file", path: c.path, mediaType: "video" },
      };
      const url = resolveAsset(m, HERO, { target: "browser-url" }) as { value: string };
      expect(url.value).toBe(c.expectedUrl);

      const ff = resolveAsset(m, HERO, { target: "ffmpeg-input", mediaType: "video" }) as { argv: string[] };
      expect(ff.argv).toEqual(["-i", c.path]);

      const np = resolveAsset(m, HERO, { target: "node-path" }) as { value: string };
      expect(np.value).toBe(c.path);
    });
  }
});
