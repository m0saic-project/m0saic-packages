import type { CommunityMEntry, CommunityMManifest } from "@m0saic/types";
import { COMMUNITY_M_TIP_STABLE_KEY } from "@m0saic/types";
import { computeClaimOrder } from "./claimOrder";
import { M_TILES } from "./mTiles.generated";
import {
  communityMFillDurationMs,
  communityMProgress,
  communityMTileStates,
  nextOpenTile,
  resolveCommunitySlot,
} from "./tileState";

const ORDER = computeClaimOrder(M_TILES, { tipIndex: 32, tipFirst: false }).slice(0, 32);

const ROOT_SLOT = {
  slot: 0, tileIndex: 32, stableKey: COMMUNITY_M_TIP_STABLE_KEY, handle: "m0saic-dev", displayName: "m0saic",
  claimedAt: "2026-04-15T00:00:00.000Z", tile: "ms/001/root/tile.png", piece: "ms/001/root/piece.mosaic",
};
const SLOT_1 = {
  slot: 1, tileIndex: ORDER[0], stableKey: `k${ORDER[0]}`, handle: "octocat", displayName: "Mona",
  claimedAt: "2026-05-01T00:00:00.000Z", tile: "ms/001/slots/01/tile.png", piece: "ms/001/slots/01/piece.mosaic",
};

function entry(over: Partial<CommunityMEntry> = {}): CommunityMEntry {
  return {
    id: "001",
    number: 1,
    title: "Community M #001",
    status: "active",
    capacity: 32,
    claimed: 1,
    openedAt: "2026-04-15T00:00:00.000Z",
    completedAt: null,
    root: { tileIndex: 32, stableKey: COMMUNITY_M_TIP_STABLE_KEY, status: "awarded", slot: ROOT_SLOT },
    claimOrder: ORDER,
    slots: [SLOT_1],
    ...over,
  };
}

const manifest = (): CommunityMManifest => ({
  schemaVersion: 1,
  generatedAt: "2026-09-06T00:00:00.000Z",
  tileCount: 33,
  geometry: { entry: "brand/m-33", size: 272, tiles: "geometry/m-33-tiles.json" },
  ms: [entry()],
});

describe("communityMTileStates", () => {
  it("marks the contributor claims and the root award, in flat index order", () => {
    const states = communityMTileStates(entry());
    expect(states.length).toBe(33);
    states.forEach((s, i) => expect(s.tileIndex).toBe(i));
    expect(states.filter((s) => s.claimed).map((s) => s.tileIndex).sort((a, b) => a - b)).toEqual([ORDER[0], 32].sort((a, b) => a - b));
    expect(states[32].slot?.handle).toBe("m0saic-dev");
    expect(states[32].root).toBe(true);
    expect(states[ORDER[0]].root).toBe(false);
  });

  it("a reserved root is open but still the root", () => {
    const states = communityMTileStates(entry({ root: { tileIndex: 32, stableKey: COMMUNITY_M_TIP_STABLE_KEY, status: "reserved", slot: null } }));
    expect(states[32].root).toBe(true);
    expect(states[32].claimed).toBe(false);
  });
});

describe("nextOpenTile / progress", () => {
  it("returns claimOrder[claimed]", () => {
    expect(nextOpenTile(entry())).toBe(ORDER[1]);
    expect(communityMProgress(entry())).toEqual({ claimed: 1, capacity: 32 });
  });
  it("is null when the 32 contributor tiles are full (root aside)", () => {
    const full = entry({ slots: new Array(32).fill(SLOT_1) });
    expect(nextOpenTile(full)).toBeNull();
  });
  it("reports the frozen fill duration once complete", () => {
    expect(communityMFillDurationMs(entry())).toBeNull();
    const done = entry({ status: "complete", completedAt: "2026-04-16T00:00:00.000Z" });
    expect(communityMFillDurationMs(done)).toBe(24 * 3600 * 1000);
  });
});

describe("resolveCommunitySlot", () => {
  it("resolves by slot number, by root, and by handle (case-insensitive, @ optional)", () => {
    expect(resolveCommunitySlot(manifest(), "001", "1")).toMatchObject({ ok: true, slot: { slot: 1, handle: "octocat" } });
    expect(resolveCommunitySlot(manifest(), "001", "root")).toMatchObject({ ok: true, slot: { slot: 0 } });
    expect(resolveCommunitySlot(manifest(), "001", "0")).toMatchObject({ ok: true, slot: { slot: 0 } });
    expect(resolveCommunitySlot(manifest(), "001", "@M0SAIC-dev")).toMatchObject({ ok: true, slot: { slot: 0 } });
    expect(resolveCommunitySlot(manifest(), "001", "Octocat")).toMatchObject({ ok: true, slot: { slot: 1 } });
  });
  it("reports UNKNOWN_M, UNCLAIMED (incl. a reserved root), UNKNOWN_SLOT", () => {
    expect(resolveCommunitySlot(manifest(), "009", "1")).toMatchObject({ ok: false, code: "UNKNOWN_M" });
    expect(resolveCommunitySlot(manifest(), "001", "2")).toMatchObject({ ok: false, code: "UNCLAIMED" });
    expect(resolveCommunitySlot(manifest(), "001", "33")).toMatchObject({ ok: false, code: "UNKNOWN_SLOT" });
    expect(resolveCommunitySlot(manifest(), "001", "nobody")).toMatchObject({ ok: false, code: "UNKNOWN_SLOT" });
    const reserved: CommunityMManifest = { ...manifest(), ms: [entry({ root: { tileIndex: 32, stableKey: COMMUNITY_M_TIP_STABLE_KEY, status: "reserved", slot: null } })] };
    expect(resolveCommunitySlot(reserved, "001", "root")).toMatchObject({ ok: false, code: "UNCLAIMED" });
  });
});
