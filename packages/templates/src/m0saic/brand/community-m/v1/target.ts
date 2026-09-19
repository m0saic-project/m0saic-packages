import type { CommunityMEntry, CommunityMManifest, CommunityMSlot } from "@m0saic/types";
import { COMMUNITY_M_TIP_STABLE_KEY, COMMUNITY_M_TIP_TILE_INDEX } from "@m0saic/types";
import { M_TILES, resolveCommunitySlot } from "@m0saic/platform";
import type { ClaimImage, MarkClaim } from "./mark";
import { previewTileLine, standInPhoto, type PreviewOptions, type PreviewPhoto } from "./preview";
import type { ResolvedPreview } from "./props";

/**
 * Everything the harness needs about ONE tile of ONE Community M, with no
 * filesystem in sight. The node entry hands it real file paths; the browser
 * entry hands it nothing and every picture becomes a stand-in.
 */
export type ProvenanceTarget = {
  manifest: CommunityMManifest;
  entry: CommunityMEntry;
  /** The slot the video is about (a contributor claim, the root award, or a stood-up preview). */
  slot: CommunityMSlot;
  /** The slot's tile picture, or null when there is no readable file for it. */
  tileImage: ClaimImage | null;
  /** Tile index → picture + slot for every claim the M shows (per `asOf`). */
  claimedTiles: Map<number, { image: ClaimImage; slot: CommunityMSlot }>;
  /** Whether the root reads as awarded in this view. */
  rootShown: boolean;
  /**
   * True when nobody has claimed this slot and the dev preview stood it up
   * anyway: the picture and the canvas are generated, not read from the repo.
   */
  synthetic: boolean;
};

export type BuildTargetResult = { ok: true; target: ProvenanceTarget } | { ok: false; error: string };

export type BuildTargetOptions = {
  m: string;
  tile: string;
  asOf: "now" | "claim";
  allowUnclaimed?: boolean;
  /**
   * The picture for a slot, or null when it cannot be read here (a claim
   * whose file is missing, or the browser, which has no files at all). A
   * null picture paints as dormant rather than failing the render.
   */
  pictureFor: (slot: CommunityMSlot) => ClaimImage | null;
};

/** Resolve the M, the slot and the claims to paint. Never throws. */
export function buildTarget(manifest: CommunityMManifest, o: BuildTargetOptions): BuildTargetResult {
  const r = resolveCommunitySlot(manifest, o.m, o.tile);
  // An UNCLAIMED slot is normally the end of the road — there is no
  // provenance to tell. With the dev preview on it is the whole point: stand
  // the slot up so its tile's zoom and framing can be designed now.
  if (!r.ok && !(r.code === "UNCLAIMED" && o.allowUnclaimed)) {
    return { ok: false, error: r.code === "UNCLAIMED" ? `${r.error}. Turn on Dev preview (filled tiles, or a generated canvas) to preview it anyway.` : r.error };
  }
  const entry = r.ok ? r.m : manifest.ms.find((e) => e.id === o.m);
  if (!entry) return { ok: false, error: `Community M "${o.m}" not found` };
  const synthetic = !r.ok;
  const slot = r.ok ? r.slot : syntheticSlot(entry, o.tile);
  if (!slot) return { ok: false, error: `tile "${o.tile}" does not name a slot of Community M ${o.m}` };

  const cutoff = o.asOf === "claim" ? slot.claimedAt : null;
  const visible = (s: CommunityMSlot) => cutoff === null || s.claimedAt <= cutoff;
  const claimedTiles = new Map<number, { image: ClaimImage; slot: CommunityMSlot }>();
  const add = (s: CommunityMSlot) => {
    const image = o.pictureFor(s);
    if (image) claimedTiles.set(s.tileIndex, { image, slot: s });
  };
  for (const s of entry.slots) if (visible(s)) add(s);
  const rootShown = !!entry.root.slot && visible(entry.root.slot);
  if (entry.root.slot && rootShown) add(entry.root.slot);

  const tileImage = synthetic ? null : o.pictureFor(slot);
  return { ok: true, target: { manifest, entry, slot, tileImage, claimedTiles, rootShown, synthetic } };
}

/**
 * The slot an unclaimed reference WOULD become: claim N takes the N-th tile
 * of the M's own deal order, and "root" is always the V-tip. Everything else
 * (a handle nobody holds) has no tile to stand up.
 */
export function syntheticSlot(entry: CommunityMEntry, tileRef: string): CommunityMSlot | null {
  const ref = tileRef.trim();
  const at = (tileIndex: number, slot: number, stableKey: string): CommunityMSlot => ({
    slot, tileIndex, stableKey,
    handle: "preview", displayName: "Preview",
    claimedAt: entry.openedAt ?? "",
    tile: "", piece: "",
  });
  if (ref.toLowerCase() === "root" || ref === "0") return at(COMMUNITY_M_TIP_TILE_INDEX, 0, COMMUNITY_M_TIP_STABLE_KEY);
  if (!/^\d+$/.test(ref)) return null;
  const n = Number(ref);
  const tileIndex = entry.claimOrder[n - 1];
  if (tileIndex === undefined) return null;
  const key = M_TILES.find((t) => t.tileIndex === tileIndex)?.stableKey;
  return key ? at(tileIndex, n, key) : null;
}

/** "Community M #001 - opened 2026-04-15 - in progress" / "… - completed 2026-06-05". */
export function identityLine(entry: CommunityMEntry): string {
  const opened = entry.openedAt ? `opened ${entry.openedAt.slice(0, 10)}` : "not yet open";
  const state = entry.completedAt ? `completed ${entry.completedAt.slice(0, 10)}` : entry.status === "locked" ? "locked" : "in progress";
  return `${entry.title} - ${opened} - ${state}`;
}

/** "tile 32 - root - @m0saic-dev - 2026-04-15" / "tile 20 - claim 1 of 32 - @octocat - 2026-05-01". */
export function tileLine(entry: CommunityMEntry, slot: CommunityMSlot): string {
  const which = slot.slot === 0 ? "root" : `claim ${slot.slot} of ${entry.capacity}`;
  return `tile ${slot.tileIndex} - ${which} - @${slot.handle} - ${slot.claimedAt.slice(0, 10)}`;
}

// ── The subject of the video, and what the M paints ──────────────────────

/** True when any dev lever is on — which is also what lets an unclaimed tile stand up. */
export function previewIsOn(pv: ResolvedPreview): boolean {
  return pv.claims > 0 || pv.tile !== null || pv.piece !== "off";
}

export type Subject = { tileIndex: number; standIn: boolean; caption: string; photo: PreviewPhoto | null };

/**
 * The "Subject tile" lever speaks AWARD ORDER, the one number the Community
 * page, the caption ("claim 1 of 32") and the "claims" lever all agree on:
 * claim N (1..32) is `entry.claimOrder[N-1]`, 0 is the root. The geometry
 * index (0..32 in mark order) is an implementation detail nobody sees —
 * exposing it here is what made "Subject tile 1" light a tile the Community
 * page lists fifteenth (founder, 2026-09-16).
 */
export function awardToTileIndex(entry: CommunityMEntry, claimNo: number): { tileIndex: number; claimNo: number | null } {
  if (claimNo <= 0) return { tileIndex: entry.root.tileIndex, claimNo: null };
  const tileIndex = entry.claimOrder[claimNo - 1];
  if (tileIndex === undefined) throw new Error(`community-m: claim ${claimNo} is past this M's award order (${entry.claimOrder.length} claims)`);
  return { tileIndex, claimNo };
}

/**
 * Which tile the video is about: the explicit lever wins, else the tile the
 * slot resolves to. It is a stand-in whenever nobody really holds it (or
 * whenever its picture cannot be read here).
 */
export function subjectOf(target: ProvenanceTarget, pv: ResolvedPreview): Subject {
  const lever = pv.tile === null ? null : awardToTileIndex(target.entry, pv.tile);
  const tileIndex = lever ? lever.tileIndex : target.slot.tileIndex;
  const standIn = pv.tile !== null || target.tileImage === null;
  return {
    tileIndex,
    standIn,
    caption: standIn ? previewTileLine(tileIndex, pv.style, lever ? lever.claimNo : null, target.entry.capacity) : tileLine(target.entry, target.slot),
    photo: standIn ? standInPhoto(tileIndex, pv as PreviewOptions) : null,
  };
}

/** Every tile the M paints as claimed: the real claims, plus stand-ins for the levers. */
export function harnessClaims(
  target: ProvenanceTarget,
  pv: ResolvedPreview,
  subject: Subject,
  simulate: (entry: CommunityMEntry, real: ReadonlySet<number>, o: PreviewOptions) => Map<number, MarkClaim>,
): Map<number, MarkClaim> {
  const claims = new Map<number, MarkClaim>();
  for (const [i, c] of target.claimedTiles) claims.set(i, { image: c.image, ...(c.slot.focus ? { focus: c.slot.focus } : {}) });
  const opts = { ...pv, tile: subject.standIn ? subject.tileIndex : null } as PreviewOptions;
  for (const [i, c] of simulate(target.entry, new Set(claims.keys()), opts)) claims.set(i, c);
  return claims;
}
