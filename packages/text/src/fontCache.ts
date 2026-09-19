/**
 * Parsed-font cache — keyed by a string (an absolute path in Node, or a
 * logical key the browser registers under). Parsing a TTF isn't free, so a
 * long-lived render process amortizes it across every label.
 *
 * This is the browser seam for `@m0saic/text`: `textToPath` / `measureText`
 * resolve their font through `getCachedFont` FIRST, before any `fs`/`path`
 * call. In a pure-web bundle (`"browser": { "fs": false, "path": false }` in
 * package.json) the host pre-registers the bundled Roboto bytes via
 * {@link registerFontBytes} under {@link BUNDLED_FONT_CACHE_KEY}, so the
 * default-font path never touches the (stubbed) fs/path modules. Node hosts
 * hit the cache miss and load from disk exactly as before.
 *
 * opentype.js is `require()`d lazily here (never at module load) so importing
 * this module pulls neither the parser nor any node builtin into a
 * browser / typecheck-only graph. opentype's `parse(ArrayBuffer)` and
 * `loadSync(path)` are both reachable through the same module — the browser
 * uses `parse`, Node uses `loadSync`.
 */
import type * as OpentypeNS from "opentype.js";

// ── Lazy opentype.js loader ──────────────────────────────────────────────
let _opentype: typeof OpentypeNS | null = null;

/** Lazily-required opentype.js. Deferred to first use so neither the parser
 *  nor its node deps enter an import-only graph. */
export function getOpentype(): typeof OpentypeNS {
  if (!_opentype) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _opentype = require("opentype.js") as typeof OpentypeNS;
  }
  return _opentype;
}

/**
 * Stable cache key for the bundled default font (Roboto Regular). The browser
 * registers the fetched bytes under this key so `textToPath`'s default path
 * resolves without a filesystem read. Node resolves the same default from
 * disk and caches it under this key too.
 */
export const BUNDLED_FONT_CACHE_KEY = "@m0saic/text:bundled/Roboto-Regular";

const _cache = new Map<string, OpentypeNS.Font>();

/** Look up a parsed font by cache key (absolute path in Node, or a logical
 *  key registered via {@link registerFontBytes} / {@link registerParsedFont}). */
export function getCachedFont(key: string): OpentypeNS.Font | undefined {
  return _cache.get(key);
}

/** Store a parsed font under `key`. */
export function setCachedFont(key: string, font: OpentypeNS.Font): void {
  _cache.set(key, font);
}

/** Register an already-parsed opentype Font under `key`. */
export function registerParsedFont(key: string, font: OpentypeNS.Font): void {
  _cache.set(key, font);
}

/**
 * Register a font from raw bytes, parsing via `opentype.parse` (pure JS — no
 * fs). The browser calls this once with the fetched bundled Roboto bytes
 * (under {@link BUNDLED_FONT_CACHE_KEY}) before the first `textToPath`.
 *
 * Accepts an `ArrayBuffer` (or a view's underlying buffer). Returns the parsed
 * Font for convenience.
 */
export function registerFontBytes(
  key: string,
  data: ArrayBuffer,
): OpentypeNS.Font {
  const font = getOpentype().parse(data);
  _cache.set(key, font);
  return font;
}

/** Test-only — clear the parsed-font cache between cases. */
export function __clearFontCache(): void {
  _cache.clear();
}
