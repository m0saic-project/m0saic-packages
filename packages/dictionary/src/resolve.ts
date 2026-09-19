/**
 * Lazy DSL resolution for heavy dictionary entries.
 *
 * Entries whose m0saic DSL is too large for the browser bundle have
 * m0saic: "" and m0File: "entries/..." pointing to the .m0 file.
 * This module provides async resolution with bounded caching.
 */
import type { MosaicDictionaryEntryResolved } from "@m0saic/types";
import { parseM0File, parseM0cFile } from "@m0saic/dsl-file-formats";

/**
 * Base URL for dictionary assets. Defaults to "/dictionary".
 * Set this before calling resolveM0saic() if your app serves
 * dictionary assets at a different path.
 */
export let dictionaryAssetsBase = "/dictionary";

export function setDictionaryAssetsBase(base: string) {
  dictionaryAssetsBase = base;
}

/**
 * Bounded cache for resolved M0 strings.
 * Evicts oldest entry (by insertion order) when full.
 * Default max: 64 entries — well above the ~7 heavy entries in the
 * current dictionary, with room for growth.
 */
const MAX_CACHE_SIZE = 64;
const _m0saicCache = new Map<string, string>();

function cacheSet(key: string, value: string): void {
  // If already present, delete and re-insert to refresh insertion order
  if (_m0saicCache.has(key)) _m0saicCache.delete(key);

  // Evict oldest if at capacity
  if (_m0saicCache.size >= MAX_CACHE_SIZE) {
    const oldest = _m0saicCache.keys().next().value;
    if (oldest !== undefined) _m0saicCache.delete(oldest);
  }

  _m0saicCache.set(key, value);
}

/**
 * Resolve the M0 DSL string for a dictionary entry.
 *
 * - If the entry has an inline M0 string, returns it immediately.
 * - If the entry has m0File (heavy entry), fetches the .m0 file,
 *   parses it via parseM0File, caches the canonical M0 string.
 *
 * Cache is bounded (max 64 entries). Oldest entries are evicted when full.
 */
export async function resolveM0saic(
  entry: MosaicDictionaryEntryResolved,
): Promise<string> {
  // Fast path: already inlined
  if (entry.m0) return entry.m0;

  // Check cache
  const cached = _m0saicCache.get(entry.id);
  if (cached) return cached;

  // Lazy fetch
  if (!entry.m0File) {
    throw new Error(`Cannot resolve m0saic for "${entry.id}": no m0saic or m0File`);
  }

  const base = entry.assetsBase ?? dictionaryAssetsBase;
  const url = `${base}/${entry.m0File}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch m0saic for "${entry.id}": ${resp.status} ${url}`);
  }

  const text = await resp.text();
  // Dispatch on extension: .m0c carries labels in a JSON wrapper; plain .m0
  // is a DSL string with `#`-prefixed header comments. The dictionary-side
  // path-builder is the source of this extension, so a simple suffix
  // check is sound.
  const isM0c = entry.m0File.endsWith(".m0c");
  const parsed = isM0c ? parseM0cFile(text) : parseM0File(text);
  cacheSet(entry.id, parsed.m0);
  return parsed.m0;
}

/** @internal — exposed for testing only. */
export function _testGetCache(): ReadonlyMap<string, string> {
  return _m0saicCache;
}

/** @internal — exposed for testing only. */
export function _testClearCache(): void {
  _m0saicCache.clear();
}
