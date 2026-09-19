/**
 * Starter media — the INCLUDED defaults a template shows in a media slot
 * while the user's prop is EMPTY, so the slot is present (and a drop target
 * on the Make canvas) before the footage exists, and the render never looks
 * half-built. Real-looking media, not a "drop here" placard — the canvas's
 * empty-slot outline and its "Add …" glyph are what say "yours to replace".
 *
 * Two sources, the template's choice:
 *   1. bring your own — media bundled next to the template's code
 *      (`assets/*.png|mp4|svg`, mirrored to dist by copy-assets) and built
 *      with `fileAsset(resolve(__dirname, "assets"), name, kind)`; for a
 *      starter that must look like the template's own domain;
 *   2. the included defaults here — one small SVG per slot ROLE, shared by
 *      every template. Vector (a few KB each, crisp at any cell size) and
 *      `viewBox`-only, so the engine's plan-time rasterizer picks the
 *      density from the cell (`.svg` file assets are rasterized to PNG
 *      before ffmpeg ever sees them). Minted by `tools/mint-starter-svg.mjs`.
 *
 * Usage (a template's compose step):
 *
 *   import { starterMedia } from "@m0saic/template-utils/dist/media/defaultMedia";
 *   const cam = props.facecam?.trim() ? fileAsset(…, props.facecam, "video") : starterMedia("facecam");
 *   if (cam) { assets.cam = cam; … bindProp(tile, "facecam") … }
 *
 * `starterMedia` returns `null` when the file is not on disk (a stripped
 * build) — degrade to the template's own stand-in, never an error mosaic.
 *
 * asar-safe: this module compiles to `dist/media/`, two levels below the
 * package root, and a packaged Electron app has `__dirname` inside
 * `app.asar`, which a spawned ffmpeg cannot open; `bundledAssetPath` rewrites
 * to the `app.asar.unpacked` twin (`asarUnpack` in apps/mosaic/package.json
 * carries `@m0saic/template-utils/assets/**`), and the existence probe tests
 * the TRANSLATED path (`existsSync` says true for the in-asar path too).
 *
 * Node-only (`node:path` / `node:fs`); deep-import it, never via the barrel
 * — see the NOTE in `media/index.ts`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { bundledAssetPath, fileAsset, type FileAsset } from "../m0saic/assetPath";

/** The slot roles the included defaults cover. */
export const STARTER_MEDIA_ROLES = ["portrait", "landscape", "square", "facecam", "avatar", "logo"] as const;
export type StarterMediaRole = (typeof STARTER_MEDIA_ROLES)[number];

/** The package-root `assets/` dir (asar-translated). */
export function packageAssetsDir(): string {
  return bundledAssetPath(path.resolve(__dirname, "..", ".."), "assets");
}

/** Where the included starters live (asar-translated). */
export function starterAssetsDir(): string {
  return path.join(packageAssetsDir(), "starter");
}

/** The starter file for `role` — a path only (may not exist). */
export function starterMediaPath(role: StarterMediaRole): string {
  return bundledAssetPath(starterAssetsDir(), `${role}.svg`);
}

/**
 * A `{ kind: "file" }` document asset for the included starter of `role`,
 * or `null` when it is not on disk (or `role` is unknown) — degrade, don't
 * fail. Image media: an SVG the engine rasterizes at plan time.
 */
export function starterMedia(role: StarterMediaRole): FileAsset | null {
  return starterMediaFrom(starterAssetsDir(), role);
}

/** `starterMedia` against an explicit starters dir (a stripped build, a
 *  test) — the existence probe runs on the asar-translated path. */
export function starterMediaFrom(dir: string, role: StarterMediaRole): FileAsset | null {
  if (!(STARTER_MEDIA_ROLES as ReadonlyArray<string>).includes(role)) return null;
  const p = bundledAssetPath(dir, `${role}.svg`);
  if (!fs.existsSync(p)) return null;
  return fileAsset(dir, `${role}.svg`, "image");
}

/**
 * The original placeholder set (`assets/core/`), kept for tooling that reads
 * it. Same asar-safe, package-root resolution as the starters (this used to
 * resolve to a `dist/assets/` that does not exist).
 */
function coreAsset(rel: string): string {
  return bundledAssetPath(packageAssetsDir(), path.join("core", rel));
}

export const CORE_MEDIA = {
  blue_square_image: coreAsset("placeholder-blue.png"),
  green_square_image: coreAsset("placeholder-green.png"),
  red_square_image: coreAsset("placeholder-red.png"),
  gray_square_image: coreAsset("placeholder-gray.png"),
  Mosaic_M_image: coreAsset("m-33_1024x1024.png"),
  gray_video: coreAsset("placeholder.mp4"),
};
