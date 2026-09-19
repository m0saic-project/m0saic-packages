/**
 * Bundled font packs — Roboto (classic, Apache-2.0) and JetBrains Mono
 * (OFL-1.1). Roboto Regular remains the long-standing default. Each family
 * carries Regular / Bold / Italic / Bold-Italic for the svg rasterizer's
 * fontWeight/fontStyle support.
 *
 * ONE manifest, two hosts:
 *   - Node registers every face by FILE PATH on import (`registerBundledFonts`),
 *     and `measureText` / `textToPath` read the file from disk.
 *   - A browser has no fs. The host fetches each face's bytes from wherever it
 *     serves the pack and hands them to `registerBundledFontBytes`, which puts
 *     the parsed font in the cache under the face's bundled key AND registers
 *     the family with that key as its "path" — so `resolveFontFile` resolves
 *     it and the cache-first loader never touches fs. Same metrics on both
 *     hosts: a template that fits its copy in JetBrains Mono measures the
 *     mono face in the browser too, instead of silently measuring the default
 *     and then overflowing when the preview draws the real face.
 *
 * Adding a face = one manifest entry (+ the .ttf in assets/fonts); every host
 * picks it up. The larger curated multi-family pack and user/system fonts
 * register into the same store later (see the internal font-sprint notes).
 */

import * as path from "path";
import { bundledFontPath } from "./textToPath";
import { registerFont, type FontStyle } from "./fontRegistry";
import { BUNDLED_FONT_CACHE_KEY, registerFontBytes } from "./fontCache";

export interface BundledFontFace {
  /** Canonical family name (`resolveFontFile` matches it case-insensitively). */
  family: string;
  /** File name inside `assets/fonts/` — also what a web host serves. */
  file: string;
  weight: number;
  style: FontStyle;
}

/** Every face the package ships. The order is cosmetic; the DEFAULT face
 *  (Roboto Regular) is the one `BUNDLED_FONT_CACHE_KEY` names. */
export const BUNDLED_FONT_FACES: readonly BundledFontFace[] = [
  { family: "Roboto", file: "Roboto-Regular.ttf", weight: 400, style: "normal" },
  { family: "Roboto", file: "Roboto-Bold.ttf", weight: 700, style: "normal" },
  { family: "Roboto", file: "Roboto-Italic.ttf", weight: 400, style: "italic" },
  { family: "Roboto", file: "Roboto-BoldItalic.ttf", weight: 700, style: "italic" },
  { family: "JetBrains Mono", file: "JetBrainsMono-Regular.ttf", weight: 400, style: "normal" },
  { family: "JetBrains Mono", file: "JetBrainsMono-Bold.ttf", weight: 700, style: "normal" },
  { family: "JetBrains Mono", file: "JetBrainsMono-Italic.ttf", weight: 400, style: "italic" },
  { family: "JetBrains Mono", file: "JetBrainsMono-BoldItalic.ttf", weight: 700, style: "italic" },
];

const BUNDLED_KEY_PREFIX = "@m0saic/text:bundled/";

/**
 * The parsed-font cache key of a bundled face — identical on Node and in the
 * browser, so a "path" of this shape resolves through the cache on either.
 * `bundledFontCacheKey("Roboto-Regular.ttf")` IS `BUNDLED_FONT_CACHE_KEY`.
 */
export function bundledFontCacheKey(file: string): string {
  return BUNDLED_KEY_PREFIX + file.replace(/\.(ttf|otf)$/i, "");
}

/** True when `file` is the pack's default face (the one a host must have). */
export function isBundledDefaultFace(file: string): boolean {
  return bundledFontCacheKey(file) === BUNDLED_FONT_CACHE_KEY;
}

let registered = false;

/**
 * Register the bundled faces (family → file path). Idempotent.
 *
 * NODE-ONLY: the file-path font registry is a filesystem concept. In a browser
 * bundle `"browser": {"path": false}` stubs `path` to an empty module, so
 * `path.dirname` / `path.join` are undefined — there's nothing to register a
 * path against (the browser registers bytes via `registerBundledFontBytes`
 * instead). Detect that and no-op.
 */
export function registerBundledFonts(): void {
  if (registered) return;
  // Browser guard: `path` is stubbed to `{}` there, so `dirname` is undefined.
  if (typeof path.dirname !== "function") return;
  registered = true;
  const FONT_DIR = path.dirname(bundledFontPath());
  for (const face of BUNDLED_FONT_FACES) {
    registerFont({
      family: face.family,
      weight: face.weight,
      style: face.style,
      path: path.join(FONT_DIR, face.file),
    });
  }
}

/**
 * BROWSER seam: register one bundled face from fetched bytes (any host may
 * use it — the cache-first loader serves the key on Node too). The face lands
 * in the parsed-font cache under `bundledFontCacheKey(file)` and in the family
 * registry with that key as its path. Throws for a file outside the manifest:
 * the manifest is the contract between the package and the hosts that serve it.
 */
export function registerBundledFontBytes(file: string, bytes: ArrayBuffer): void {
  const face = BUNDLED_FONT_FACES.find((f) => f.file === file);
  if (!face) {
    throw new Error(`registerBundledFontBytes: "${file}" is not a bundled font (see BUNDLED_FONT_FACES)`);
  }
  const key = bundledFontCacheKey(file);
  registerFontBytes(key, bytes);
  registerFont({ family: face.family, weight: face.weight, style: face.style, path: key });
}

// Self-register on module load (node CJS consumers run this side effect; the
// browser guard above makes it a no-op in a web bundle).
registerBundledFonts();
