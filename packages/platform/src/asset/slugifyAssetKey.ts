import type { AssetId, MosaicAssetManifest } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";

/**
 * Reduce an arbitrary filename to a key that matches ASSET_KEY_PATTERN.
 *
 * Asset keys are the safe handle on a manifest entry — the raw filesystem
 * path (which may contain spaces, Unicode, drive letters, parens, quotes)
 * belongs in the entry's `path` field, never in the key. This slugifier
 * is the funnel every caller should run paths / user-supplied strings
 * through before minting a manifest key.
 *
 * Strategy:
 *   - Drop the extension (so `hero.mp4` and `hero.mov` don't collide).
 *   - Replace any run of disallowed chars with a single `_`.
 *   - Strip leading / trailing `_`, `-`, `.` so the first char satisfies
 *     ASSET_KEY_PATTERN (no leading dot / hyphen).
 *   - Cap to 128 chars and fall back to `"asset"` if everything was stripped.
 */
export function slugifyAssetKey(name: string): string {
  const lastDot = name.lastIndexOf(".");
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const cleaned = base
    .replace(/[^A-Za-z0-9_.\-]+/g, "_")
    .replace(/^[._\-]+/, "")
    .replace(/[._\-]+$/, "");
  const trimmed = cleaned.slice(0, 128);
  return trimmed.length > 0 ? trimmed : "asset";
}

/**
 * Strip POSIX or Windows path separators off `pathLike` and slugify the
 * basename. Convenience wrapper for the common case of "user picked a file,
 * give me a clean asset key."
 */
export function slugifyAssetKeyFromPath(pathLike: string): string {
  const basename = pathLike.split(/[\\/]/).pop() ?? pathLike;
  return slugifyAssetKey(basename);
}

/**
 * Return an AssetId built from `base` that is unique against `manifest`.
 * On collision, suffix with `_2`, `_3`, … until free. The suffix is part
 * of the 128-char budget — extremely long bases get truncated to fit.
 */
export function uniqueAssetKey(
  base: string,
  manifest: MosaicAssetManifest | undefined,
): AssetId {
  if (!manifest || !(base in manifest)) return asAssetId(base);
  for (let i = 2; i < 10000; i++) {
    const suffix = `_${i}`;
    const head = base.slice(0, 128 - suffix.length);
    const candidate = `${head}${suffix}`;
    if (!(candidate in manifest)) return asAssetId(candidate);
  }
  throw new Error(`uniqueAssetKey: exhausted suffix space for base "${base}"`);
}
