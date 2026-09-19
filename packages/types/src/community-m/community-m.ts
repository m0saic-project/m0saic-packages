/**
 * Community M — the 33-tile brand M where each tile is claimed by ONE
 * contributor (one person, one tile, forever) when their first community
 * template is accepted.
 *
 * These types describe the **manifest** (`index.json`) published by the
 * public `community-m` repository. The repo is the source of truth; the
 * app, the CLI and the `@m0saic/brand/community-m/v1` template are pure
 * consumers. Nothing here executes community content — a manifest is
 * data: who holds which tile, where their tile image and `.mosaic` piece
 * live (repo-root-relative paths), and the precomputed claim order.
 *
 * Design laws (the internal community-m-v1 notes):
 *   - Tile identity = flat index 0..32 in the brand-mark SVG order
 *     (26 rects then 7 polys) AND the dictionary `brand/m-33` stableKey.
 *     Both travel together in every slot so drift is detectable.
 *   - Claim order is precomputed into the manifest (farthest-first
 *     scatter). Consumers read `claimOrder`, never recompute it.
 *   - The V-tip is the ROOT tile. It is never dealt. Every M's 32 other
 *     tiles record participation ("I contributed something accepted");
 *     the root records distinction ("the community recognized this as
 *     unusually important") and stays reserved until awarded — possibly
 *     after the M is otherwise complete. M #001's root is the founder:
 *     Mosaic itself is the first contribution.
 *   - An M is complete when its 32 contributor tiles are claimed; the next
 *     M opens at that moment. Completed Ms are immutable except for a later
 *     root award.
 */

/** Tiles in the brand mark: 26 axis-aligned rects + 7 diagonal polys. */
export const COMMUNITY_M_TILE_COUNT = 33;

/**
 * Contributor tiles per M — every tile except the ROOT (the V-tip). The
 * root is never dealt: it is reserved for a community-recognized contribution
 * of exceptional value (see `CommunityMRoot`), and it is the only way to a
 * second tile.
 */
export const COMMUNITY_M_CONTRIBUTOR_CAPACITY = 32;

/** `index.json` schema version this type set describes. */
export const COMMUNITY_M_MANIFEST_SCHEMA_VERSION = 1;

/**
 * Flat index of the V-tip tile (`POLYS[6]` in the SVG order; dictionary
 * stableKey `r/ov1c0/ov2c0/gcolc100/fc79`) — the ROOT tile of every M.
 */
export const COMMUNITY_M_TIP_TILE_INDEX = 32;

/** Dictionary stableKey of the V-tip tile in `brand/m-33`. */
export const COMMUNITY_M_TIP_STABLE_KEY = "r/ov1c0/ov2c0/gcolc100/fc79";

/**
 * Lifecycle of one M.
 *   - `active`   — currently filling; the next accepted contributor claims
 *                  `claimOrder[claimed]`.
 *   - `complete` — all 33 tiles claimed; immutable from here on.
 *   - `locked`   — not yet open; unlocks when the previous M completes.
 */
export type CommunityMStatus = "active" | "complete" | "locked";

/**
 * One tile's geometry in the 272×272 design space of the brand mark.
 * Rect tiles are their exact rect; poly tiles are their bounding box.
 * Baked from the dictionary m0 by `tools/bake-community-m-tiles.mjs`.
 */
export type CommunityMTileGeom = {
  /** Flat index 0..32 (SVG order: rects 0..25, polys 26..32). */
  tileIndex: number;
  /** Dictionary `brand/m-33` stableKey for the same tile. */
  stableKey: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Who curated / seeded an M (distinct from per-tile contributors). */
export type CommunityMCurator = {
  handle: string;
  displayName: string;
  url?: string;
};

/**
 * One claimed tile. `slot` is the 1-based claim number (oldest first);
 * `tileIndex` is where that claim landed on the mark (`claimOrder[slot-1]`).
 * The ROOT award uses `slot: 0` and `tileIndex` 32. All paths are
 * repo-root-relative with `/` separators.
 */
export type CommunityMSlot = {
  /** 1..32 for contributor claims; 0 for the root award. */
  slot: number;
  tileIndex: number;
  stableKey: string;
  /** GitHub handle, no `@`. Unique across ALL Ms (one person, one tile). */
  handle: string;
  displayName: string;
  /** Outbound link (GitHub profile). http(s) only. */
  url?: string;
  /** One-line note about the contribution. */
  note?: string;
  /** UTC ISO 8601. Monotonic by slot within an M. */
  claimedAt: string;
  /** PR URL or number that landed the claim, if recorded. */
  pr?: string | number | null;
  /** Square tile image (PNG on commit). */
  tile: string;
  /** SHA-256 (hex) of `tile` at claim time — pins the reference to exact bytes. */
  tileSha256?: string;
  /**
   * OPTIONAL repo-relative path to a fuller picture of the contributor —
   * the tile is the mark they put on the M, this is the person behind it.
   * Surfaced by the Community page's tile macro; absent for most claims.
   */
  portrait?: string;
  /** SHA-256 of `portrait` when one is committed. */
  portraitSha256?: string;
  /** The contributor's `.mosaic` piece (data only). */
  piece: string;
  /** SHA-256 (hex) of `piece`. */
  pieceSha256?: string;
  /** Extra files the piece references, repo-root-relative. */
  assets?: string[];
  /** Template id of the accepted contribution that earned the tile. */
  contribution?: string;
  /**
   * How the square tile image sits inside its (non-square, possibly
   * diagonal) tile. The renderer cover-fits the image, then `x`/`y`
   * (0..1, default 0.5) pick which part of the overflow stays visible —
   * `y: 0` pins the image top to the tile's top edge — and `zoom` (1..2,
   * default 1) magnifies about that point. Optional; contributors who
   * don't care get a centred cover-fit.
   */
  focus?: CommunityMTileFocus;
};

export type CommunityMTileFocus = { x: number; y: number; zoom: number };

export const COMMUNITY_M_DEFAULT_FOCUS: CommunityMTileFocus = { x: 0.5, y: 0.5, zoom: 1 };

/**
 * The root tile of an M. `reserved` until the community awards it; the
 * criteria and process are deliberately unpublished and will evolve with
 * the community (maintainer selection, nomination, voting, usage signal…).
 * At most one per M; an M may complete with its root still reserved.
 */
export type CommunityMRoot = {
  tileIndex: typeof COMMUNITY_M_TIP_TILE_INDEX;
  stableKey: string;
  status: "reserved" | "awarded";
  /** The award (`slot: 0`), or null while reserved. */
  slot: CommunityMSlot | null;
  /** One line on what the award recognizes, when awarded. */
  citation?: string;
};

export type CommunityMEntry = {
  /** Zero-padded ordinal, e.g. `"001"`. */
  id: string;
  /** Numeric ordinal, e.g. `1`. */
  number: number;
  title: string;
  status: CommunityMStatus;
  /** Contributor tiles per M — always 32 (the root is separate). */
  capacity: number;
  /** `slots.length` — contributor claims, root excluded. */
  claimed: number;
  /** The root tile: reserved or awarded. */
  root: CommunityMRoot;
  /**
   * UTC ISO 8601 when this M opened for claims. M #001's is the epoch
   * (2026-04-15). Later Ms open the moment the previous one completes,
   * so `openedAt === previous.completedAt`. `null` while locked.
   */
  openedAt: string | null;
  /**
   * UTC ISO 8601 when the 32nd contributor claim landed. Written ONCE by
   * assemble and frozen: tile art may be edited later, but the recorded fill
   * time never moves. `null` until complete. `completedAt - openedAt` = how
   * quickly the community filled this M. The root award is not part of it.
   */
  completedAt: string | null;
  curator?: CommunityMCurator;
  /** CSS colour for the accent ring / keystone. */
  accent?: string;
  /** Precomputed deal order of the 32 contributor tiles — a permutation of 0..31. */
  claimOrder: number[];
  /** The assembled `.m0p` pack, repo-root-relative. */
  pack?: string;
  /** Claimed tiles, sorted by `slot` ascending. */
  slots: CommunityMSlot[];
};

export type CommunityMGeometryRef = {
  /** Dictionary entry id the geometry derives from. */
  entry: string;
  /** Design-space side (272). */
  size: number;
  /** Repo-root-relative path to the baked tile table. */
  tiles: string;
};

export type CommunityMManifest = {
  schemaVersion: typeof COMMUNITY_M_MANIFEST_SCHEMA_VERSION;
  /** `owner/name` of the public repo that generated this manifest. */
  repo?: string;
  /** UTC ISO 8601 of the generating assemble run. */
  generatedAt: string;
  tileCount: typeof COMMUNITY_M_TILE_COUNT;
  geometry: CommunityMGeometryRef;
  /** Ordered by `number` ascending. */
  ms: CommunityMEntry[];
};
