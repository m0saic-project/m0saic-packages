import type { CommunityMTileGeom } from "@m0saic/types";

/**
 * Community M claim order — **farthest-first scatter**.
 *
 * The next slot is always the open tile whose centroid is farthest (max of
 * min-distance) from every already-claimed tile's centroid. Ties break
 * toward the larger tile, then the lower flat index. The result is a
 * permutation of every `tileIndex` in `tiles`.
 *
 * Why this rule (founder, 2026-09-06): the M should look *alive* at every
 * fill level — evenly scattered, never clumped in one leg — with no seed
 * and a one-sentence explanation.
 *
 * Two anchorings share the algorithm:
 *   - `tipFirst: true`  (M #001) — the tip is slot 1 (the founder), and the
 *     scatter grows outward from it: `[tip, s1, …, s32]`.
 *   - `tipFirst: false` (M #002+) — the tip is the **keystone**, the last
 *     slot claimed by whoever completes the M: `[s1, …, s32, tip]`. The
 *     scatter is still anchored on the tip's centroid so `s1` is the tile
 *     farthest from it — "farthest from the tip" falls out naturally.
 *
 * Pure and integer-exact on bbox centroids/areas — the same numbers the
 * public repo's zero-dep `tools/claim-order.mjs` computes; a lockstep test
 * pins the two implementations to the same committed order.
 */
export function computeClaimOrder(
  tiles: readonly CommunityMTileGeom[],
  opts: { tipIndex: number; tipFirst: boolean },
): number[] {
  const tip = tiles.find((t) => t.tileIndex === opts.tipIndex);
  if (!tip) {
    throw new Error(`computeClaimOrder: tipIndex ${opts.tipIndex} not in tiles`);
  }
  const centroid = (t: CommunityMTileGeom) => ({
    x: t.x + t.w / 2,
    y: t.y + t.h / 2,
    area: t.w * t.h,
  });

  const anchors = [centroid(tip)];
  const open = tiles.filter((t) => t.tileIndex !== opts.tipIndex);
  const scatter: number[] = [];

  while (open.length > 0) {
    let bestI = -1;
    let bestD = -1;
    let bestArea = -1;
    for (let i = 0; i < open.length; i++) {
      const c = centroid(open[i]);
      let minD = Infinity;
      for (const a of anchors) {
        const d = Math.hypot(a.x - c.x, a.y - c.y);
        if (d < minD) minD = d;
      }
      const better =
        minD > bestD ||
        (minD === bestD &&
          (c.area > bestArea ||
            (c.area === bestArea && open[i].tileIndex < open[bestI].tileIndex)));
      if (better) {
        bestI = i;
        bestD = minD;
        bestArea = c.area;
      }
    }
    const picked = open.splice(bestI, 1)[0];
    anchors.push(centroid(picked));
    scatter.push(picked.tileIndex);
  }

  return opts.tipFirst ? [opts.tipIndex, ...scatter] : [...scatter, opts.tipIndex];
}
