import { COMMUNITY_M_TIP_STABLE_KEY } from "@m0saic/types";
import { computeClaimOrder } from "./claimOrder";
import { M_TILES } from "./mTiles.generated";
import { isRelativeRepoPath, parseCommunityMManifest } from "./parseCommunityMManifest";

const ORDER = computeClaimOrder(M_TILES, { tipIndex: 32, tipFirst: false }).slice(0, 32);
const ROOT_SLOT = {
  slot: 0, tileIndex: 32, stableKey: COMMUNITY_M_TIP_STABLE_KEY, handle: "m0saic-dev", displayName: "m0saic",
  url: "https://github.com/m0saic-dev", note: "Seeded the M", claimedAt: "2026-04-15T00:00:00.000Z", pr: null,
  tile: "ms/001/root/tile.png", piece: "ms/001/root/piece.mosaic", assets: [],
  contribution: "@m0saic-dev/community-m/emoji-grid/v1",
};
const slotFor = (i: number, handle: string, at = "2026-05-01T00:00:00.000Z") => ({
  slot: i + 1, tileIndex: ORDER[i], stableKey: M_TILES[ORDER[i]].stableKey, handle, displayName: handle,
  claimedAt: at, pr: null, tile: `ms/001/slots/${String(i + 1).padStart(2, "0")}/tile.png`, piece: `ms/001/slots/${String(i + 1).padStart(2, "0")}/piece.mosaic`, assets: [],
});

function good(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    repo: "m0saic-project/community-m",
    generatedAt: "2026-09-06T00:00:00.000Z",
    tileCount: 33,
    geometry: { entry: "brand/m-33", size: 272, tiles: "geometry/m-33-tiles.json" },
    ms: [
      {
        id: "001", number: 1, title: "Community M #001", status: "active", capacity: 32, claimed: 1,
        openedAt: "2026-04-15T00:00:00.000Z", completedAt: null, curator: { handle: "m0saic-dev", displayName: "m0saic", url: "https://github.com/m0saic-project" },
        accent: "#f97316", claimOrder: ORDER, pack: "ms/001/community-m-001.m0p",
        root: { tileIndex: 32, stableKey: COMMUNITY_M_TIP_STABLE_KEY, status: "awarded", slot: { ...ROOT_SLOT }, citation: "Mosaic itself" },
        slots: [slotFor(0, "octocat")],
      },
      {
        id: "002", number: 2, title: "Community M #002", status: "locked", capacity: 32, claimed: 0,
        openedAt: null, completedAt: null, claimOrder: ORDER, root: { tileIndex: 32, stableKey: COMMUNITY_M_TIP_STABLE_KEY, status: "reserved", slot: null }, slots: [],
      },
    ],
  };
}

type Mut = (j: Record<string, unknown>) => void;
const m0 = (j: Record<string, unknown>) => (j.ms as Record<string, unknown>[])[0];
const slot0 = (j: Record<string, unknown>) => (m0(j).slots as Record<string, unknown>[])[0];

function expectReject(mut: Mut, re: RegExp): void {
  const j = good();
  mut(j);
  const r = parseCommunityMManifest(j);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(re);
}

describe("parseCommunityMManifest", () => {
  it("accepts the seed shape and normalizes it", () => {
    const r = parseCommunityMManifest(good());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.ms.length).toBe(2);
    expect(r.manifest.ms[0].claimed).toBe(1);
    expect(r.manifest.ms[0].capacity).toBe(32);
    expect(r.manifest.ms[0].root.status).toBe("awarded");
    expect(r.manifest.ms[0].root.slot?.stableKey).toBe(COMMUNITY_M_TIP_STABLE_KEY);
    expect(r.manifest.ms[0].root.citation).toBe("Mosaic itself");
    expect(r.manifest.ms[1].status).toBe("locked");
    expect(r.manifest.ms[1].root.slot).toBeNull();
  });

  it("never throws on garbage", () => {
    for (const v of [null, 1, "x", [], {}, { schemaVersion: 1 }]) {
      expect(parseCommunityMManifest(v).ok).toBe(false);
    }
  });

  it("rejects schema/tileCount/geometry problems", () => {
    expectReject((j) => { j.schemaVersion = 2; }, /schemaVersion/);
    expectReject((j) => { j.tileCount = 32; }, /tileCount/);
    expectReject((j) => { j.generatedAt = "yesterday"; }, /generatedAt/);
    expectReject((j) => { (j.geometry as Record<string, unknown>).tiles = "/abs/tiles.json"; }, /geometry/);
  });

  it("rejects a bad claim order — and the root may never be dealt", () => {
    expectReject((j) => { m0(j).claimOrder = ORDER.slice(0, 31); }, /32 entries/);
    expectReject((j) => { m0(j).claimOrder = [...ORDER.slice(0, 31), 0]; }, /permutation/);
    expectReject((j) => { m0(j).claimOrder = [...ORDER.slice(0, 31), 32]; }, /permutation of the 32 non-root/);
  });

  it("enforces the root contract", () => {
    expectReject((j) => { delete m0(j).root; }, /root is required/);
    expectReject((j) => { (m0(j).root as Record<string, unknown>).tileIndex = 31; }, /root must be tile 32/);
    expectReject((j) => { (m0(j).root as Record<string, unknown>).status = "awarded"; (m0(j).root as Record<string, unknown>).slot = null; }, /root.slot is present exactly when awarded/);
    expectReject((j) => { (m0(j).root as Record<string, unknown>).status = "reserved"; }, /root.slot is present exactly when awarded/);
    expectReject((j) => { ((m0(j).root as Record<string, unknown>).slot as Record<string, unknown>).slot = 1; }, /slot must be 0/);
    expectReject((j) => {
      const m2 = (j.ms as Record<string, unknown>[])[1];
      m2.root = { tileIndex: 32, stableKey: COMMUNITY_M_TIP_STABLE_KEY, status: "awarded", slot: { ...ROOT_SLOT, tile: "ms/002/root/tile.png", piece: "ms/002/root/piece.mosaic" } };
    }, /locked M cannot carry a root award/);
  });

  it("the root is the one sanctioned second tile: its handle may already hold a contributor tile", () => {
    const j = good();
    ((m0(j).root as Record<string, unknown>).slot as Record<string, unknown>).handle = "octocat";
    expect(parseCommunityMManifest(j).ok).toBe(true);
  });

  it("enforces slot ↔ claimOrder ↔ stableKey consistency", () => {
    expectReject((j) => { slot0(j).tileIndex = 32; }, /tileIndex must be/);
    expectReject((j) => { slot0(j).stableKey = "r/nope"; }, /stableKey/);
    expectReject((j) => { slot0(j).slot = 2; }, /slot must be 1/);
    expectReject((j) => { m0(j).claimed = 3; }, /claimed must equal/);
  });

  it("enforces one person, one contributor tile across ALL Ms", () => {
    expectReject((j) => {
      const m2 = (j.ms as Record<string, unknown>[])[1];
      m2.status = "active"; m0(j).status = "complete"; m0(j).completedAt = "2026-09-06T00:00:00.000Z"; m2.openedAt = "2026-09-06T00:00:00.000Z";
      m0(j).slots = ORDER.map((_t, i) => slotFor(i, `user${i}`));
      m0(j).claimed = 32;
      m2.claimed = 1;
      m2.slots = [{ ...slotFor(0, "USER3"), tile: "ms/002/slots/01/tile.png", piece: "ms/002/slots/01/piece.mosaic" }];
    }, /already holds a tile/);
  });

  it("rejects unsafe paths and urls", () => {
    expectReject((j) => { slot0(j).tile = "../secret.png"; }, /tile must be/);
    expectReject((j) => { slot0(j).piece = "https://evil/x.mosaic"; }, /piece must be/);
    expectReject((j) => { slot0(j).url = "javascript:alert(1)"; }, /url must be http/);
    expectReject((j) => { slot0(j).assets = ["ok.png", "C:\\bad.png"]; }, /assets/);
  });

  it("enforces status consistency", () => {
    expectReject((j) => { m0(j).status = "complete"; m0(j).completedAt = "2026-09-06T00:00:00.000Z"; }, /complete requires 32/);
    expectReject((j) => { m0(j).status = "locked"; m0(j).openedAt = null; m0(j).root = { tileIndex: 32, stableKey: COMMUNITY_M_TIP_STABLE_KEY, status: "reserved", slot: null }; }, /locked M cannot have slots/);
    expectReject((j) => { const m2 = (j.ms as Record<string, unknown>[])[1]; m2.status = "active"; m2.openedAt = "2026-09-06T00:00:00.000Z"; }, /only one active/);
  });

  it("enforces the opened/completed record", () => {
    expectReject((j) => { m0(j).openedAt = null; }, /needs openedAt/);
    expectReject((j) => { m0(j).openedAt = "2026-04-15"; }, /openedAt must be/);
    expectReject((j) => { m0(j).completedAt = "2026-09-06T00:00:00.000Z"; }, /completedAt is set exactly when/);
    expectReject((j) => { (j.ms as Record<string, unknown>[])[1].openedAt = "2026-09-06T00:00:00.000Z"; }, /locked M has no openedAt/);
    expectReject((j) => { slot0(j).claimedAt = "2026-01-01T00:00:00.000Z"; }, /precedes the M's openedAt/);
  });

  it("accepts a valid focus and rejects an out-of-range one", () => {
    const j = good(); slot0(j).focus = { x: 0.5, y: 0.443, zoom: 1 };
    const r = parseCommunityMManifest(j);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.ms[0].slots[0].focus).toEqual({ x: 0.5, y: 0.443, zoom: 1 });
    expectReject((jj) => { slot0(jj).focus = { x: 0.5, y: 1.2, zoom: 1 }; }, /focus must be/);
    expectReject((jj) => { slot0(jj).focus = { x: 0.5, y: 0.5, zoom: 3 }; }, /focus must be/);
    expectReject((jj) => { slot0(jj).focus = { x: 0.5, y: 0.5 }; }, /focus must be/);
  });

  it("accepts pinned hashes and rejects malformed ones", () => {
    const j = good(); slot0(j).tileSha256 = "a".repeat(64);
    expect(parseCommunityMManifest(j).ok).toBe(true);
    expectReject((jj) => { slot0(jj).tileSha256 = "nope"; }, /tileSha256 must be/);
    expectReject((jj) => { slot0(jj).pieceSha256 = "A".repeat(64); }, /pieceSha256 must be/);
  });

  it("rejects handle/time problems", () => {
    expectReject((j) => { slot0(j).handle = "@bad"; }, /bad handle/);
    expectReject((j) => { slot0(j).claimedAt = "2026-09-06"; }, /claimedAt/);
  });
});

describe("isRelativeRepoPath", () => {
  it("accepts repo-relative and rejects everything else", () => {
    expect(isRelativeRepoPath("ms/001/slots/01/tile.png")).toBe(true);
    for (const bad of ["", "/x", "a//b", "./a", "a/../b", "a\\b", "http://x/y", ".."]) {
      expect(isRelativeRepoPath(bad)).toBe(false);
    }
  });
});
