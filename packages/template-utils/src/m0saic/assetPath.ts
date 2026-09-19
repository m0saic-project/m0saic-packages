/**
 * Asar-safe paths for media a template SHIPS in its own `assets/` dir.
 *
 * The model: a template bundles media next to its code (`assets/*.png|mp4`,
 * mirrored to `dist/**​/assets/` by the templates build's copy-assets step) and
 * addresses it at render time via `path.resolve(__dirname, "assets", name)`.
 *
 * That path is correct for the CLI, and WRONG inside a packaged Electron app.
 * There `__dirname` lands inside `app.asar` — a single archive file, not a
 * directory. Electron patches Node's `fs` so `readFileSync` / `existsSync`
 * transparently read through the archive, but **ffmpeg is a spawned external
 * process with no such shim**: it fails with "error opening input file
 * …/app.asar/…". The `existsSync` guard many templates use as a fallback does
 * NOT save them, because it returns `true` for the in-asar path.
 *
 * electron-builder's `asarUnpack` (see `apps/mosaic/package.json`) already
 * writes template assets to a parallel `app.asar.unpacked/` tree with identical
 * layout, so the fix is purely a path rewrite at the point of use.
 *
 *   import { fileAsset } from "@m0saic/template-utils/dist/m0saic/assetPath";
 *   const logo = fileAsset(path.resolve(__dirname, "assets"), "logo.png", "image");
 *
 * Node-only (`node:path`); deep-import it, never via the barrel — see the NOTE
 * in `index.ts`. Pure; no side effects.
 */

import * as path from "node:path";

/**
 * Rewrite a path that points INTO `app.asar` to its `app.asar.unpacked` twin.
 *
 * No-op when the segment is absent, so this is safe to apply unconditionally —
 * CLI and test paths pass through untouched, and an already-unpacked path is
 * left alone (the match requires `app.asar` as a whole path segment, so neither
 * `app.asar.unpacked` nor a directory named `app.asarbackup` is rewritten).
 */
export function unpackedAsarPath(p: string): string {
  const inAsar = `${path.sep}app.asar${path.sep}`;
  if (!p.includes(inAsar)) return p;
  return p.split(inAsar).join(`${path.sep}app.asar.unpacked${path.sep}`);
}

/**
 * Resolve a bundled asset to an absolute path that a spawned tool can open.
 *
 * Use this anywhere a template turns `__dirname` into a path that reaches
 * ffmpeg — including the `existsSync` availability probe, which must test the
 * SAME path that will be handed to the renderer.
 */
export function bundledAssetPath(assetsDir: string, name: string): string {
  return unpackedAsarPath(path.resolve(assetsDir, name));
}

/** A `{ kind: "file" }` document asset entry. */
export type FileAsset = {
  kind: "file";
  path: string;
  mediaType: "image" | "video";
};

/** Build a document `assets` entry for a bundled file, asar-translated. */
export function fileAsset(
  assetsDir: string,
  name: string,
  mediaType: "image" | "video",
): FileAsset {
  return { kind: "file", path: bundledAssetPath(assetsDir, name), mediaType };
}
