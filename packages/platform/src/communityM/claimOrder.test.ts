import { COMMUNITY_M_TIP_TILE_INDEX } from "@m0saic/types";
import { computeClaimOrder } from "./claimOrder";
import { M_TILES } from "./mTiles.generated";

const TIP = COMMUNITY_M_TIP_TILE_INDEX;

describe("computeClaimOrder — farthest-first scatter", () => {
  const first = computeClaimOrder(M_TILES, { tipIndex: TIP, tipFirst: true });
  const later = computeClaimOrder(M_TILES, { tipIndex: TIP, tipFirst: false });

  it("returns a permutation of 0..32", () => {
    for (const order of [first, later]) {
      expect(order.length).toBe(33);
      expect([...order].sort((a, b) => a - b)).toEqual(M_TILES.map((t) => t.tileIndex));
    }
  });

  it("M #001 starts with the tip; later Ms end with it (keystone)", () => {
    expect(first[0]).toBe(TIP);
    expect(later[32]).toBe(TIP);
    expect(later).toEqual([...first.slice(1), TIP]);
  });

  it("scatters: the second claim lands far from the tip (a top corner)", () => {
    const t = M_TILES[first[1]];
    expect(t.y).toBe(0);
  });

  it("is deterministic", () => {
    expect(computeClaimOrder(M_TILES, { tipIndex: TIP, tipFirst: true })).toEqual(first);
  });

  it("breaks ties toward the larger tile then the lower index", () => {
    const tiles = [
      { tileIndex: 0, stableKey: "a", x: 0, y: 0, w: 10, h: 10 },
      { tileIndex: 1, stableKey: "b", x: 100, y: 0, w: 10, h: 10 },
      { tileIndex: 2, stableKey: "c", x: 100, y: 0, w: 20, h: 5 },
      { tileIndex: 3, stableKey: "d", x: 100, y: 0, w: 5, h: 20 },
    ];
    // b, c, d share a centroid distance from a (same center x=105/110/102.5? no —
    // make them identical centroids by construction):
    tiles[2] = { tileIndex: 2, stableKey: "c", x: 95, y: -5, w: 20, h: 20 }; // center 105,5 area 400
    tiles[3] = { tileIndex: 3, stableKey: "d", x: 100, y: 0, w: 10, h: 10 }; // center 105,5 area 100 (same as b)
    const order = computeClaimOrder(tiles, { tipIndex: 0, tipFirst: true });
    expect(order[0]).toBe(0);
    expect(order[1]).toBe(2); // larger area wins the tie
    expect(order[2]).toBe(1); // then lower index among equal areas
    expect(order[3]).toBe(3);
  });

  it("throws when the tip is not in the tile set", () => {
    expect(() => computeClaimOrder(M_TILES, { tipIndex: 99, tipFirst: true })).toThrow(/tipIndex/);
  });

  // LOCKSTEP PIN — the public repo's zero-dep `tools/claim-order.mjs` must
  // produce exactly this CONTRIBUTOR order (the 32 non-root tiles, scatter
  // anchored on the root's centroid, root dropped) for every M. Change both
  // or neither.
  it("pins the contributor deal order (root never dealt)", () => {
    const contributor = later.slice(0, 32);
    expect(contributor).toEqual([
      20, 0, 14, 6, 3, 17, 29, 26, 30, 27, 13, 21, 31, 24, 1, 28, 4,
      15, 18, 9, 7, 2, 16, 5, 11, 19, 23, 8, 10, 12, 22, 25,
    ]);
    expect(contributor).not.toContain(TIP);
    expect(first.slice(1)).toEqual(contributor);
  });
});
