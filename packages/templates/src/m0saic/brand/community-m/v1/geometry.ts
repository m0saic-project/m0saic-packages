import { parseM0StringToLogicalFrames } from "@m0saic/dsl";
import { registry as dictionaryRegistry, getSourceOrderStableKeysForM0 } from "@m0saic/dictionary";
import type { MosaicDictionaryEntryResolved, MosaicSourceMask } from "@m0saic/types";
import { COMMUNITY_M_TIP_STABLE_KEY, COMMUNITY_M_TIP_TILE_INDEX } from "@m0saic/types";
import { M_GEOMETRY_M0, M_TILES } from "@m0saic/platform";

export const DICT_ID = "brand/m-33";
/** Native design side of the brand M. Every render is an integer multiple of this (mask law). */
export const M_NATIVE = 272;

export type MarkGeometry = {
  entry: MosaicDictionaryEntryResolved;
  /** The mark's m0 — the baked copy, present in every build (see below). */
  m0: string;
  /** Source-order stableKeys (index i = the i-th emitted frame of the m0). */
  keys: readonly string[];
  /** Frame rects in 272-space, indexed by SOURCE order. */
  sourceRects: ReadonlyArray<{ x: number; y: number; width: number; height: number }>;
  /** Source index → Community M flat tile index (brand-mark SVG order). */
  sourceToTile: readonly number[];
  /** Tile index → source index. */
  tileToSource: readonly number[];
  /** Inline mask per SOURCE index, or undefined for plain rects. */
  maskFor: (sourceIndex: number) => MosaicSourceMask | undefined;
};

let _cached: MarkGeometry | null = null;

/**
 * The Community M's geometry. The m0 comes from the BAKED copy in
 * `@m0saic/platform` rather than the dictionary entry: the browser
 * dictionary ships `m0: ""` with a lazily-fetched `m0File` that the web app
 * does not even serve, and the mark has to draw identically in both builds
 * with no network. The masks still come from the dictionary entry, which
 * carries them inline in every build. `mTiles.test.ts` pins the baked m0 to
 * the dictionary's so the two cannot drift.
 *
 * Source order (how the engine feeds `sources[]`) and Community M tile
 * order (the manifest's `tileIndex`) differ; both are keyed by stableKey,
 * so the join is exact.
 */
export function markGeometry(): MarkGeometry {
  if (_cached) return _cached;
  const entry = dictionaryRegistry.byId[DICT_ID];
  if (!entry) throw new Error(`dictionary entry "${DICT_ID}" not found`);
  const m0 = M_GEOMETRY_M0;
  const keys = getSourceOrderStableKeysForM0(DICT_ID, m0, M_NATIVE, M_NATIVE).map(String);
  const frames = parseM0StringToLogicalFrames(m0, M_NATIVE, M_NATIVE);
  if (frames.length !== keys.length) throw new Error(`${DICT_ID}: ${frames.length} frames vs ${keys.length} keys`);
  const sourceRects = frames.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height }));
  const tileByKey = new Map(M_TILES.map((t) => [t.stableKey, t.tileIndex]));
  const sourceToTile = keys.map((k) => {
    const t = tileByKey.get(k);
    if (t === undefined) throw new Error(`${DICT_ID}: stableKey ${k} has no Community M tile`);
    return t;
  });
  const tileToSource: number[] = new Array(keys.length).fill(-1);
  sourceToTile.forEach((t, s) => { tileToSource[t] = s; });
  if (keys[tileToSource[COMMUNITY_M_TIP_TILE_INDEX]] !== COMMUNITY_M_TIP_STABLE_KEY) {
    throw new Error(`${DICT_ID}: root tile is not ${COMMUNITY_M_TIP_STABLE_KEY} — dictionary / manifest drift`);
  }
  const masks = entry.masks ?? null;
  const maskFor = (i: number): MosaicSourceMask | undefined => {
    const m = masks?.[keys[i] as never];
    return m ? { kind: "inline-mask", localPath: m.localPath, bounds: m.bounds } : undefined;
  };
  _cached = { entry, m0, keys, sourceRects, sourceToTile, tileToSource, maskFor };
  return _cached;
}

/**
 * Side of the M for a frame: the largest integer multiple of 272 that fits
 * `share` of the frame's shorter side. 3840×2160 → 1904 (7×); 1280×720 →
 * 544 (2×); anything under ~302 px tall → 272 (1×, the floor).
 */
export function markSideFor(frameW: number, frameH: number, share = 0.9): number {
  const k = Math.max(1, Math.floor((Math.min(frameW, frameH) * share) / M_NATIVE));
  return k * M_NATIVE;
}
