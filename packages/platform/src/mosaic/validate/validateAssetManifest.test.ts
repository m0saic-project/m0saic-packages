import { validateAssetManifest } from "./validateAssetManifest";

const ok = (assets: unknown) =>
  validateAssetManifest(assets).filter((d) => d.severity === "error");

// covers: T:asset.manifest, T:asset.ASSET_KINDS, T:asset.AssetKind,
//         T:asset.diagnostic.ASSETS_MISSING, T:asset.diagnostic.ASSET_KEY_INVALID,
//         T:asset.diagnostic.ASSET_KIND_UNKNOWN, T:asset.diagnostic.ASSET_MALFORMED,
//         T:asset.diagnostic.ASSET_KIND_FIELDS_MISSING, T:asset.diagnostic.ASSET_PATH_NOT_ABSOLUTE,
//         T:asset.kind=file, T:asset.kind=file.path, T:asset.kind=file#absolute-path,
//         T:asset.kind=file#windows-paths, T:asset.kind=url, T:asset.kind=url.url,
//         T:asset.kind=data-uri, T:asset.kind=data-uri.uri, T:asset.mediaType
describe("validateAssetManifest", () => {
  it("accepts an empty manifest", () => {
    expect(ok({})).toEqual([]);
  });

  it("emits ASSETS_MISSING when manifest is null/undefined/array", () => {
    expect(validateAssetManifest(null)[0].code).toBe("ASSETS_MISSING");
    expect(validateAssetManifest(undefined)[0].code).toBe("ASSETS_MISSING");
    expect(validateAssetManifest([])[0].code).toBe("ASSETS_MISSING");
  });

  it("accepts a well-formed file entry with absolute path", () => {
    expect(
      ok({
        hero: { kind: "file", path: "/abs/hero.mp4", mediaType: "video" },
      }),
    ).toEqual([]);
  });

  it("warns on a relative file path (loader should have absolutized)", () => {
    const diags = validateAssetManifest({
      hero: { kind: "file", path: "hero.mp4" },
    });
    expect(diags.some((d) => d.code === "ASSET_PATH_NOT_ABSOLUTE")).toBe(true);
  });

  it("accepts Windows absolute paths", () => {
    expect(
      ok({ hero: { kind: "file", path: "C:\\Users\\me\\hero.mp4" } }),
    ).toEqual([]);
    expect(
      ok({ hero: { kind: "file", path: "C:/Users/me/hero.mp4" } }),
    ).toEqual([]);
  });

  it("accepts url and data-uri entries", () => {
    expect(
      ok({
        remote: { kind: "url", url: "https://example.com/clip.mp4" },
        inline: { kind: "data-uri", uri: "data:image/png;base64,AAAA" },
      }),
    ).toEqual([]);
  });

  it("rejects engine-internal kinds appearing in serialized JSON as ASSET_KIND_UNKNOWN", () => {
    // From the OSS validator's vantage point, lavfi/node-output ARE simply
    // unknown — they live entirely inside @m0saic/core and never enter the
    // public asset surface. Either name surfacing on disk is the same bug.
    const lavfi = validateAssetManifest({
      bg: { kind: "lavfi", graph: "color=c=black" },
    });
    expect(lavfi[0].code).toBe("ASSET_KIND_UNKNOWN");

    const node = validateAssetManifest({
      child: { kind: "node-output", nodeId: "stage1" },
    });
    expect(node[0].code).toBe("ASSET_KIND_UNKNOWN");
  });

  it("rejects empty / whitespace keys", () => {
    expect(validateAssetManifest({ "": { kind: "file", path: "/a" } })[0].code).toBe(
      "ASSET_KEY_INVALID",
    );
    expect(validateAssetManifest({ "   ": { kind: "file", path: "/a" } })[0].code).toBe(
      "ASSET_KEY_INVALID",
    );
  });

  it("rejects keys carrying troublesome chars — paths, spaces, emojis", () => {
    // The whole point of the asset table is that the KEY is a safe handle;
    // letting raw filesystem paths or emoji land here would defeat it.
    expect(
      validateAssetManifest({
        "/Users/me/My Movies/clip.mov": { kind: "file", path: "/Users/me/clip.mov" },
      })[0].code,
    ).toBe("ASSET_KEY_INVALID");
    expect(
      validateAssetManifest({
        "hero clip": { kind: "file", path: "/abs/hero.mp4" },
      })[0].code,
    ).toBe("ASSET_KEY_INVALID");
    expect(
      validateAssetManifest({
        "emoji_🙂": { kind: "file", path: "/abs/x.mp4" },
      })[0].code,
    ).toBe("ASSET_KEY_INVALID");
  });

  it("accepts conventional snake_case / kebab-case / dotted keys", () => {
    expect(
      ok({
        hero: { kind: "file", path: "/abs/hero.mp4" },
        "intro-clip": { kind: "file", path: "/abs/intro.mp4" },
        "big_buck_bunny_1080p": { kind: "file", path: "/abs/bbb.mp4" },
        "hero.mp4": { kind: "file", path: "/abs/hero.mp4" },
      }),
    ).toEqual([]);
  });

  it("rejects malformed entries", () => {
    expect(validateAssetManifest({ a: null })[0].code).toBe("ASSET_MALFORMED");
    expect(validateAssetManifest({ a: [] })[0].code).toBe("ASSET_MALFORMED");
    expect(validateAssetManifest({ a: {} })[0].code).toBe("ASSET_MALFORMED");
    expect(validateAssetManifest({ a: { kind: 5 } })[0].code).toBe("ASSET_MALFORMED");
    expect(
      validateAssetManifest({ a: { kind: "totally-fake" } })[0].code,
    ).toBe("ASSET_KIND_UNKNOWN");
  });

  it("rejects per-kind missing required fields", () => {
    expect(
      validateAssetManifest({ a: { kind: "file" } })[0].code,
    ).toBe("ASSET_KIND_FIELDS_MISSING");
    expect(
      validateAssetManifest({ a: { kind: "url" } })[0].code,
    ).toBe("ASSET_KIND_FIELDS_MISSING");
    expect(
      validateAssetManifest({ a: { kind: "data-uri" } })[0].code,
    ).toBe("ASSET_KIND_FIELDS_MISSING");
  });
});
