import * as path from "node:path";

import { unpackedAsarPath, bundledAssetPath, fileAsset } from "./assetPath";

const sep = path.sep;
const join = (...parts: string[]) => parts.join(sep);

// A realistic packaged-app assets dir (leading "" makes it absolute on posix).
const ASAR_ASSETS = join("", "Applications", "Mosaic Desktop.app", "Contents", "Resources", "app.asar", "node_modules", "@m0saic", "templates", "dist", "m0saic", "hero", "assets");

describe("unpackedAsarPath", () => {
  it("rewrites an in-asar path to its unpacked twin", () => {
    const out = unpackedAsarPath(join(ASAR_ASSETS, "qr-fin.mp4"));
    expect(out).toContain(`${sep}app.asar.unpacked${sep}`);
    expect(out).not.toContain(`${sep}app.asar${sep}`);
    expect(out.endsWith(join("assets", "qr-fin.mp4"))).toBe(true);
  });

  it("is a no-op for an ordinary on-disk path (the CLI case)", () => {
    const onDisk = path.resolve(sep, "repo", "packages", "templates", "dist", "assets", "m-hero.png");
    expect(unpackedAsarPath(onDisk)).toBe(onDisk);
  });

  it("is idempotent — an already-unpacked path is left alone", () => {
    const unpacked = path.resolve(sep, "app", "Contents", "Resources", "app.asar.unpacked", "assets", "x.png");
    expect(unpackedAsarPath(unpacked)).toBe(unpacked);
  });

  it("matches app.asar only as a whole path segment", () => {
    const decoy = path.resolve(sep, "tmp", "app.asarbackup", "assets", "x.png");
    expect(unpackedAsarPath(decoy)).toBe(decoy);
  });

  it("rewrites every occurrence when the segment repeats", () => {
    const doubled = join("", "a", "app.asar", "b", "app.asar", "c.png");
    expect(unpackedAsarPath(doubled).split(`${sep}app.asar.unpacked${sep}`)).toHaveLength(3);
  });
});

describe("bundledAssetPath", () => {
  it("resolves + translates in one step", () => {
    expect(bundledAssetPath(ASAR_ASSETS, "logo.png")).toBe(unpackedAsarPath(path.resolve(ASAR_ASSETS, "logo.png")));
  });

  it("returns an absolute path", () => {
    expect(path.isAbsolute(bundledAssetPath(ASAR_ASSETS, "logo.png"))).toBe(true);
  });
});

describe("fileAsset", () => {
  it("builds a translated file-asset entry", () => {
    const a = fileAsset(ASAR_ASSETS, "scatter-desktop.mp4", "video");
    expect(a).toEqual({ kind: "file", mediaType: "video", path: bundledAssetPath(ASAR_ASSETS, "scatter-desktop.mp4") });
    expect(a.path).toContain(`${sep}app.asar.unpacked${sep}`);
  });

  it("leaves a plain on-disk assets dir alone", () => {
    const dir = path.resolve(sep, "repo", "dist", "assets");
    expect(fileAsset(dir, "m-hero.png", "image").path).toBe(path.join(dir, "m-hero.png"));
  });
});
