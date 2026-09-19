import type {
  CommunityMEntry,
  CommunityMManifest,
  CommunityMSlot,
} from "@m0saic/types";
import { COMMUNITY_M_CONTRIBUTOR_CAPACITY, COMMUNITY_M_TIP_TILE_INDEX } from "@m0saic/types";
import { M_TILES } from "./mTiles.generated";

/** One tile's claim state, in brand-mark SVG order (index 0..32). */
export type CommunityMTileState = {
  tileIndex: number;
  stableKey: string;
  claimed: boolean;
  /** The claim (or root award) that holds this tile, or null when open / reserved. */
  slot: CommunityMSlot | null;
  /** True for the root tile (the tip) — reserved until awarded, never dealt. */
  root: boolean;
};

/** 33 tile states for an M, indexed by `tileIndex`. */
export function communityMTileStates(m: CommunityMEntry): CommunityMTileState[] {
  const bySlotTile = new Map<number, CommunityMSlot>();
  for (const s of m.slots) bySlotTile.set(s.tileIndex, s);
  return M_TILES.map((t) => {
    const isRoot = t.tileIndex === COMMUNITY_M_TIP_TILE_INDEX;
    const slot = isRoot ? m.root.slot : (bySlotTile.get(t.tileIndex) ?? null);
    return {
      tileIndex: t.tileIndex,
      stableKey: t.stableKey,
      claimed: slot !== null,
      slot,
      root: isRoot,
    };
  });
}

/** The tile the next accepted contributor will land on, or null when the 32 are full. */
export function nextOpenTile(m: CommunityMEntry): number | null {
  if (m.slots.length >= COMMUNITY_M_CONTRIBUTOR_CAPACITY) return null;
  return m.claimOrder[m.slots.length] ?? null;
}

export function communityMProgress(m: CommunityMEntry): { claimed: number; capacity: number } {
  return { claimed: m.slots.length, capacity: m.capacity };
}

/**
 * How long the M took to fill: `completedAt - openedAt` in ms, or null
 * while it is still open / locked. Frozen once complete (see the type doc).
 */
export function communityMFillDurationMs(m: CommunityMEntry): number | null {
  if (!m.openedAt || !m.completedAt) return null;
  return Date.parse(m.completedAt) - Date.parse(m.openedAt);
}

export type ResolveCommunitySlotResult =
  | { ok: true; m: CommunityMEntry; slot: CommunityMSlot }
  | { ok: false; code: "UNKNOWN_M" | "UNKNOWN_SLOT" | "UNCLAIMED"; error: string };

/**
 * Find a claimed slot by M id and either a 1-based slot number (`"7"`),
 * `"root"` / `"0"` for the root award, or a contributor handle
 * (`"@octocat"` / `"octocat"`, case-insensitive; a handle holding both a
 * tile and the root resolves to the contributor tile). Slot numbers beyond
 * the current fill and a reserved root are UNCLAIMED; handles that hold
 * nothing are UNKNOWN_SLOT.
 */
export function resolveCommunitySlot(
  manifest: CommunityMManifest,
  mId: string,
  tileRef: string,
): ResolveCommunitySlotResult {
  const m = manifest.ms.find((e) => e.id === mId);
  if (!m) return { ok: false, code: "UNKNOWN_M", error: `Community M "${mId}" not found` };
  const ref = tileRef.trim();
  if (ref.toLowerCase() === "root" || ref === "0") {
    if (!m.root.slot) return { ok: false, code: "UNCLAIMED", error: `the root of Community M ${mId} is reserved (not yet awarded)` };
    return { ok: true, m, slot: m.root.slot };
  }
  if (/^\d+$/.test(ref)) {
    const n = Number(ref);
    if (n < 1 || n > COMMUNITY_M_CONTRIBUTOR_CAPACITY) {
      return { ok: false, code: "UNKNOWN_SLOT", error: `slot ${ref} is out of range 1..${COMMUNITY_M_CONTRIBUTOR_CAPACITY} (use "root" for the root award)` };
    }
    const slot = m.slots.find((s) => s.slot === n);
    if (!slot) {
      return { ok: false, code: "UNCLAIMED", error: `slot ${n} of Community M ${mId} is unclaimed` };
    }
    return { ok: true, m, slot };
  }
  const handle = ref.replace(/^@/, "").toLowerCase();
  const slot = m.slots.find((s) => s.handle.toLowerCase() === handle) ?? (m.root.slot?.handle.toLowerCase() === handle ? m.root.slot : undefined);
  if (!slot) {
    return { ok: false, code: "UNKNOWN_SLOT", error: `@${handle} holds no tile in Community M ${mId}` };
  }
  return { ok: true, m, slot };
}
