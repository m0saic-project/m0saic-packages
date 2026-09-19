import {
  COMMUNITY_M_MANIFEST_SCHEMA_VERSION,
  COMMUNITY_M_TILE_COUNT,
  COMMUNITY_M_TIP_STABLE_KEY,
  COMMUNITY_M_TIP_TILE_INDEX,
} from "./community-m";

describe("community-m constants", () => {
  it("pins the brand-mark contract", () => {
    expect(COMMUNITY_M_TILE_COUNT).toBe(33);
    expect(COMMUNITY_M_TIP_TILE_INDEX).toBe(32);
    expect(COMMUNITY_M_MANIFEST_SCHEMA_VERSION).toBe(1);
    expect(COMMUNITY_M_TIP_STABLE_KEY).toBe("r/ov1c0/ov2c0/gcolc100/fc79");
  });
});
