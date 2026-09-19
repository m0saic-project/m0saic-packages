import {
  asAssetId,
  ASSET_KINDS,
  type AssetId,
  type MosaicAsset,
  type MosaicAssetManifest,
} from "./asset";

describe("AssetId brand", () => {
  it("asAssetId returns the same value at runtime", () => {
    expect(asAssetId("hero")).toBe("hero");
    expect(asAssetId("asset_a3f9c2e1d4")).toBe("asset_a3f9c2e1d4");
  });

  // NB: AssetId values must match FRIENDLY_SLUG_PATTERN — see
  // identifiers/identifiers.test.ts for tier validation coverage.
  // asAssetId is an unchecked cast; runtime validation is the
  // predicate's job.
});

describe("asset kind constants", () => {
  it("ASSET_KINDS lists the three serializable kinds", () => {
    expect(ASSET_KINDS).toEqual(["file", "url", "data-uri"]);
  });
});

describe("MosaicAsset shape (compile-time + runtime)", () => {
  it("accepts a kind:file asset with a path and optional displayName", () => {
    const asset: MosaicAsset = {
      kind: "file",
      path: "/abs/path/hero.mp4",
      displayName: "hero.mp4",
      mediaType: "video",
    };
    expect(asset.kind).toBe("file");
    if (asset.kind === "file") expect(asset.path).toBe("/abs/path/hero.mp4");
  });

  it("accepts a kind:url asset", () => {
    const asset: MosaicAsset = {
      kind: "url",
      url: "https://example.com/clip.mp4",
    };
    expect(asset.kind).toBe("url");
  });

  it("accepts a kind:data-uri asset", () => {
    const asset: MosaicAsset = {
      kind: "data-uri",
      uri: "data:image/png;base64,AAAA",
    };
    expect(asset.kind).toBe("data-uri");
  });

});

describe("MosaicAssetManifest", () => {
  it("composes typed entries by AssetId", () => {
    const heroId: AssetId = asAssetId("hero");
    const remoteId: AssetId = asAssetId("remote");

    const manifest: MosaicAssetManifest = {
      [heroId]: { kind: "file", path: "/abs/hero.mp4", mediaType: "video" },
      [remoteId]: { kind: "url", url: "https://example.com/clip.mp4" },
    };

    expect(manifest[heroId].kind).toBe("file");
    expect(manifest[remoteId].kind).toBe("url");
  });
});
