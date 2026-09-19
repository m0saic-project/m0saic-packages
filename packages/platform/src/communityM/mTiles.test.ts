import { COMMUNITY_M_TILE_COUNT, COMMUNITY_M_TIP_STABLE_KEY, COMMUNITY_M_TIP_TILE_INDEX } from "@m0saic/types";
import { M_TILES } from "./mTiles.generated";

describe("M_TILES (baked from dictionary brand/m-33)", () => {
  it("has 33 rows in flat index order with unique stableKeys", () => {
    expect(M_TILES.length).toBe(COMMUNITY_M_TILE_COUNT);
    M_TILES.forEach((t, i) => expect(t.tileIndex).toBe(i));
    expect(new Set(M_TILES.map((t) => t.stableKey)).size).toBe(COMMUNITY_M_TILE_COUNT);
  });

  it("puts the V-tip tile at index 32", () => {
    const tip = M_TILES[COMMUNITY_M_TIP_TILE_INDEX];
    expect(tip.stableKey).toBe(COMMUNITY_M_TIP_STABLE_KEY);
    expect(tip).toMatchObject({ x: 110, y: 168, w: 50, h: 34 });
  });

  it("keeps every tile inside the 272×272 design space", () => {
    for (const t of M_TILES) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.w).toBeGreaterThan(0);
      expect(t.h).toBeGreaterThan(0);
      expect(t.x + t.w).toBeLessThanOrEqual(272);
      expect(t.y + t.h).toBeLessThanOrEqual(272);
    }
  });
});
