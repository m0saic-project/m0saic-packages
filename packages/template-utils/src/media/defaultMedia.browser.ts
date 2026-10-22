/**
 * Starter media — the BROWSER twin of `./defaultMedia`.
 *
 * Same exports, same roles, same six pictures: a template that calls
 * `starterMedia("facecam")` while its media prop is empty gets the included
 * stand-in here too — as a `data:image/svg+xml` URI (the SVG text inlined by
 * `tools/inline-starter-svg.mjs`) instead of a `{ kind: "file" }` path,
 * because the browser has no filesystem. The engine never sees this module:
 * `package.json`'s `browser` field swaps `dist/media/defaultMedia.js` for
 * this file ONLY in a browser bundle (webpack honours the field; Node and
 * jest resolve the node module as before), which is what lets a frozen
 * template that imports the node helper run unchanged in Mosaic Web — the
 * "empty media = the demo" convention with no second compile.
 *
 * URL-encoded, no `;utf8` parameter, no `Buffer` — the engine's plain-SVG
 * data-URI parser rejects the parameter, and `Buffer` is not a browser global.
 *
 * Node-only consumers of the node module's PATH helpers get honest answers
 * here rather than crashes: there is no assets dir in a browser, so the dir
 * helpers return "" and `CORE_MEDIA` carries "" per key.
 */
import { STARTER_SVG_TEXT } from "./starterSvgInline";

/** The slot roles the included defaults cover — mirrors the node module. */
export const STARTER_MEDIA_ROLES = ["portrait", "landscape", "square", "facecam", "avatar", "logo"] as const;
export type StarterMediaRole = (typeof STARTER_MEDIA_ROLES)[number];

/** A document `assets` entry carrying the picture inline. */
export type DataUriAsset = {
  kind: "data-uri";
  uri: string;
  mediaType: "image";
};

/** No filesystem in a browser: the dir helpers answer "" (never a path). */
export function packageAssetsDir(): string {
  return "";
}

export function starterAssetsDir(): string {
  return "";
}

/** The starter picture for `role` as a `data:` URI (the node twin returns a path). */
export function starterMediaPath(role: StarterMediaRole): string {
  return starterMediaUri(role) ?? "";
}

function starterMediaUri(role: string): string | null {
  const text = (STARTER_SVG_TEXT as Record<string, string>)[role];
  if (typeof text !== "string") return null;
  return `data:image/svg+xml,${encodeURIComponent(text)}`;
}

/**
 * The included starter of `role`, inline, or `null` for an unknown role —
 * degrade, don't fail (the node twin also answers `null` when the file is
 * missing from a stripped build; here nothing can be missing).
 */
export function starterMedia(role: StarterMediaRole): DataUriAsset | null {
  const uri = starterMediaUri(role);
  return uri ? { kind: "data-uri", uri, mediaType: "image" } : null;
}

/** `dir` is meaningless in a browser; the included starters always answer. */
export function starterMediaFrom(_dir: string, role: StarterMediaRole): DataUriAsset | null {
  return starterMedia(role);
}

/** The node module's legacy placeholder paths have no browser form. */
export const CORE_MEDIA = {
  blue_square_image: "",
  green_square_image: "",
  red_square_image: "",
  gray_square_image: "",
  Mosaic_M_image: "",
  gray_video: "",
};
