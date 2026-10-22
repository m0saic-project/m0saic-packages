import * as fs from "node:fs";
import * as path from "node:path";
import { STARTER_MEDIA_ROLES as NODE_ROLES } from "./defaultMedia";
import {
  CORE_MEDIA,
  STARTER_MEDIA_ROLES,
  packageAssetsDir,
  starterAssetsDir,
  starterMedia,
  starterMediaFrom,
  starterMediaPath,
} from "./defaultMedia.browser";
import { STARTER_SVG_TEXT } from "./starterSvgInline";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const PKG_JSON = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
  browser?: Record<string, string>;
};

describe("starter media — the browser twin", () => {
  it("covers exactly the node module's roles", () => {
    expect([...STARTER_MEDIA_ROLES]).toEqual([...NODE_ROLES]);
  });

  it.each(STARTER_MEDIA_ROLES)("%s → the file's bytes, inline (re-run tools/inline-starter-svg.mjs when this drifts)", (role) => {
    const onDisk = fs.readFileSync(path.join(PKG_ROOT, "assets", "starter", `${role}.svg`), "utf8").trim();
    expect(STARTER_SVG_TEXT[role]).toBe(onDisk);
  });

  it.each(STARTER_MEDIA_ROLES)("%s → a data:image/svg+xml URI asset, URL-encoded, no ;utf8", (role) => {
    const asset = starterMedia(role);
    expect(asset).not.toBeNull();
    expect(asset!.kind).toBe("data-uri");
    expect(asset!.mediaType).toBe("image");
    expect(asset!.uri.startsWith("data:image/svg+xml,")).toBe(true);
    expect(asset!.uri).not.toContain(";utf8");
    expect(decodeURIComponent(asset!.uri.slice("data:image/svg+xml,".length))).toBe(STARTER_SVG_TEXT[role]);
    expect(starterMediaPath(role)).toBe(asset!.uri);
    expect(starterMediaFrom("/anywhere", role)).toEqual(asset);
  });

  it("answers null for an unknown role, like the node twin", () => {
    expect(starterMedia("banner" as never)).toBeNull();
  });

  it("has no filesystem answers", () => {
    expect(packageAssetsDir()).toBe("");
    expect(starterAssetsDir()).toBe("");
    for (const v of Object.values(CORE_MEDIA)) expect(v).toBe("");
  });

  it("is what package.json's browser field swaps in for the node module", () => {
    // The whole point: a browser bundle resolving the node helper's path gets
    // this file. Node and jest ignore the field, so the swap is bundle-only.
    expect(PKG_JSON.browser?.["./dist/media/defaultMedia.js"]).toBe("./dist/media/defaultMedia.browser.js");
  });
});
