import type {
  CommunityMEntry,
  CommunityMManifest,
  CommunityMSlot,
  CommunityMStatus,
  CommunityMTileFocus,
} from "@m0saic/types";
import {
  COMMUNITY_M_CONTRIBUTOR_CAPACITY,
  COMMUNITY_M_MANIFEST_SCHEMA_VERSION,
  COMMUNITY_M_TILE_COUNT,
  COMMUNITY_M_TIP_STABLE_KEY,
  COMMUNITY_M_TIP_TILE_INDEX,
} from "@m0saic/types";
import { M_TILES } from "./mTiles.generated";

export type ParseCommunityMManifestResult =
  | { ok: true; manifest: CommunityMManifest }
  | { ok: false; error: string };

const STATUSES: ReadonlySet<string> = new Set<CommunityMStatus>([
  "active",
  "complete",
  "locked",
]);
const HANDLE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const M_ID_RE = /^\d{3}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/**
 * A repo-root-relative path: `/`-separated, no leading slash, no scheme,
 * no `.`/`..` segments, no backslashes, no empty segments.
 */
export function isRelativeRepoPath(p: unknown): p is string {
  if (!isStr(p) || p.length === 0 || p.length > 512) return false;
  if (p.includes("\\") || p.includes("://") || p.startsWith("/")) return false;
  const segs = p.split("/");
  return segs.every((s) => s.length > 0 && s !== "." && s !== "..");
}

function isFocus(v: unknown): v is CommunityMTileFocus {
  if (!isObj(v)) return false;
  const num = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
  return num(v.x, 0, 1) && num(v.y, 0, 1) && num(v.zoom, 1, 2) && Object.keys(v).length === 3;
}

function isHttpUrl(u: unknown): u is string {
  return isStr(u) && /^https?:\/\/[^\s]+$/.test(u);
}

/**
 * Parse + validate a Community M manifest (`index.json`). Never throws —
 * a remote document must be rejected, not crash the consumer. Every
 * structural rule the app / template relies on is checked here so callers
 * downstream can trust the shape without re-validating.
 */
export function parseCommunityMManifest(json: unknown): ParseCommunityMManifestResult {
  const fail = (error: string): ParseCommunityMManifestResult => ({ ok: false, error });
  if (!isObj(json)) return fail("manifest: not an object");
  if (json.schemaVersion !== COMMUNITY_M_MANIFEST_SCHEMA_VERSION) {
    return fail(
      `manifest: schemaVersion ${String(json.schemaVersion)} ≠ ${COMMUNITY_M_MANIFEST_SCHEMA_VERSION}`,
    );
  }
  if (json.tileCount !== COMMUNITY_M_TILE_COUNT) {
    return fail(`manifest: tileCount ${String(json.tileCount)} ≠ ${COMMUNITY_M_TILE_COUNT}`);
  }
  if (!isStr(json.generatedAt) || !ISO_RE.test(json.generatedAt)) {
    return fail("manifest: generatedAt must be UTC ISO 8601");
  }
  if (json.repo !== undefined && !(isStr(json.repo) && /^[\w.-]+\/[\w.-]+$/.test(json.repo))) {
    return fail("manifest: repo must be owner/name");
  }
  if (
    !isObj(json.geometry) ||
    !isStr(json.geometry.entry) ||
    !isInt(json.geometry.size) ||
    !isRelativeRepoPath(json.geometry.tiles)
  ) {
    return fail("manifest: geometry must be {entry, size, tiles}");
  }
  if (!Array.isArray(json.ms) || json.ms.length === 0) {
    return fail("manifest: ms must be a non-empty array");
  }

  const keyByIndex = new Map<number, string>();
  for (const t of M_TILES) keyByIndex.set(t.tileIndex, t.stableKey);

  const handles = new Set<string>();
  const ms: CommunityMEntry[] = [];
  let prevNumber = 0;
  let prevStatus: CommunityMStatus | null = null;

  for (const raw of json.ms) {
    if (!isObj(raw)) return fail("ms[]: entry is not an object");
    const where = `ms[${String(raw.id)}]`;
    if (!isStr(raw.id) || !M_ID_RE.test(raw.id)) return fail(`${where}: id must be 3 digits`);
    if (!isInt(raw.number) || raw.number !== Number(raw.id)) {
      return fail(`${where}: number must equal Number(id)`);
    }
    if (raw.number !== prevNumber + 1) return fail(`${where}: ms must be ordered 1,2,3… without gaps`);
    prevNumber = raw.number;
    if (!isStr(raw.title)) return fail(`${where}: title required`);
    if (!isStr(raw.status) || !STATUSES.has(raw.status)) return fail(`${where}: bad status`);
    const status = raw.status as CommunityMStatus;
    if (raw.capacity !== COMMUNITY_M_CONTRIBUTOR_CAPACITY) return fail(`${where}: capacity must be ${COMMUNITY_M_CONTRIBUTOR_CAPACITY} (contributor tiles; the root is separate)`);
    const isoOrNull = (v: unknown): v is string | null => v === null || (isStr(v) && ISO_RE.test(v));
    if (!isoOrNull(raw.openedAt)) return fail(`${where}: openedAt must be UTC ISO 8601 or null`);
    if (!isoOrNull(raw.completedAt)) return fail(`${where}: completedAt must be UTC ISO 8601 or null`);
    if (status !== "locked" && raw.openedAt === null) return fail(`${where}: an open M needs openedAt`);
    if (status === "locked" && raw.openedAt !== null) return fail(`${where}: a locked M has no openedAt`);
    if (status === "complete" ? raw.completedAt === null : raw.completedAt !== null) {
      return fail(`${where}: completedAt is set exactly when the M is complete`);
    }
    if (raw.openedAt !== null && raw.completedAt !== null && raw.completedAt < raw.openedAt) {
      return fail(`${where}: completedAt precedes openedAt`);
    }
    if (raw.accent !== undefined && !(isStr(raw.accent) && /^#[0-9a-fA-F]{6}$/.test(raw.accent))) {
      return fail(`${where}: accent must be #rrggbb`);
    }
    if (raw.curator !== undefined) {
      if (
        !isObj(raw.curator) ||
        !isStr(raw.curator.handle) ||
        !isStr(raw.curator.displayName) ||
        (raw.curator.url !== undefined && !isHttpUrl(raw.curator.url))
      ) {
        return fail(`${where}: bad curator`);
      }
    }
    if (raw.pack !== undefined && !isRelativeRepoPath(raw.pack)) return fail(`${where}: bad pack path`);

    // claimOrder — the deal order of the 32 contributor tiles: a permutation
    // of every index except the root (tip). The root is never dealt.
    if (!Array.isArray(raw.claimOrder) || raw.claimOrder.length !== COMMUNITY_M_CONTRIBUTOR_CAPACITY) {
      return fail(`${where}: claimOrder must have ${COMMUNITY_M_CONTRIBUTOR_CAPACITY} entries`);
    }
    const seen = new Set<number>();
    for (const v of raw.claimOrder) {
      if (!isInt(v) || v < 0 || v >= COMMUNITY_M_TILE_COUNT || seen.has(v) || v === COMMUNITY_M_TIP_TILE_INDEX) {
        return fail(`${where}: claimOrder must be a permutation of the 32 non-root tiles`);
      }
      seen.add(v);
    }
    const claimOrder = raw.claimOrder as number[];

    // slots — sorted by slot asc, contiguous from 1, each on claimOrder[slot-1].
    if (!Array.isArray(raw.slots)) return fail(`${where}: slots must be an array`);
    if (raw.slots.length > COMMUNITY_M_CONTRIBUTOR_CAPACITY) return fail(`${where}: too many slots`);
    if (raw.claimed !== raw.slots.length) return fail(`${where}: claimed must equal slots.length`);
    const parseSlot = (
      s: unknown,
      sw: string,
      expect: { slot: number; tileIndex: number; prevAt: string; uniqueHandle: boolean },
    ): CommunityMSlot | string => {
      if (!isObj(s)) return `${sw}: not an object`;
      if (s.slot !== expect.slot) return `${sw}: slot must be ${expect.slot}`;
      if (!isInt(s.tileIndex) || s.tileIndex !== expect.tileIndex) {
        return `${sw}: tileIndex must be ${expect.tileIndex}`;
      }
      const expectedKey = keyByIndex.get(s.tileIndex);
      if (!isStr(s.stableKey) || s.stableKey !== expectedKey) return `${sw}: stableKey does not match tile ${s.tileIndex}`;
      if (!isStr(s.handle) || !HANDLE_RE.test(s.handle)) return `${sw}: bad handle`;
      const hk = s.handle.toLowerCase();
      if (expect.uniqueHandle) {
        if (handles.has(hk)) return `${sw}: handle "${s.handle}" already holds a tile (one person, one tile)`;
        handles.add(hk);
      }
      if (!isStr(s.displayName) || s.displayName.trim() === "") return `${sw}: displayName required`;
      if (s.url !== undefined && !isHttpUrl(s.url)) return `${sw}: url must be http(s)`;
      if (s.note !== undefined && !isStr(s.note)) return `${sw}: note must be a string`;
      if (!isStr(s.claimedAt) || !ISO_RE.test(s.claimedAt)) return `${sw}: claimedAt must be UTC ISO 8601`;
      if (s.claimedAt < expect.prevAt) return `${sw}: claimedAt must not go backwards`;
      if (isStr(raw.openedAt) && s.claimedAt < raw.openedAt) return `${sw}: claimedAt precedes the M's openedAt`;
      if (!(s.pr === undefined || s.pr === null || isStr(s.pr) || isInt(s.pr))) return `${sw}: bad pr`;
      if (!isRelativeRepoPath(s.tile)) return `${sw}: tile must be a repo-relative path`;
      if (!isRelativeRepoPath(s.piece)) return `${sw}: piece must be a repo-relative path`;
      if (s.portrait !== undefined && !isRelativeRepoPath(s.portrait)) return `${sw}: portrait must be a repo-relative path`;
      for (const h of ["tileSha256", "pieceSha256", "portraitSha256"] as const) {
        if (s[h] !== undefined && !(isStr(s[h]) && /^[0-9a-f]{64}$/.test(s[h] as string))) return `${sw}: ${h} must be 64 hex chars`;
      }
      if (s.assets !== undefined) {
        if (!Array.isArray(s.assets) || !s.assets.every(isRelativeRepoPath)) return `${sw}: assets must be repo-relative paths`;
      }
      if (s.contribution !== undefined && !isStr(s.contribution)) return `${sw}: bad contribution`;
      if (s.focus !== undefined && !isFocus(s.focus)) return `${sw}: focus must be {x 0..1, y 0..1, zoom 1..2}`;
      return {
        slot: s.slot,
        tileIndex: s.tileIndex,
        stableKey: s.stableKey,
        handle: s.handle,
        displayName: s.displayName,
        ...(s.url !== undefined ? { url: s.url } : {}),
        ...(s.note !== undefined ? { note: s.note } : {}),
        claimedAt: s.claimedAt,
        ...(s.pr !== undefined ? { pr: s.pr as string | number | null } : {}),
        tile: s.tile,
        ...(s.tileSha256 !== undefined ? { tileSha256: s.tileSha256 as string } : {}),
        ...(s.portrait !== undefined ? { portrait: s.portrait as string } : {}),
        ...(s.portraitSha256 !== undefined ? { portraitSha256: s.portraitSha256 as string } : {}),
        piece: s.piece,
        ...(s.pieceSha256 !== undefined ? { pieceSha256: s.pieceSha256 as string } : {}),
        ...(s.assets !== undefined ? { assets: s.assets as string[] } : {}),
        ...(s.contribution !== undefined ? { contribution: s.contribution } : {}),
        ...(s.focus !== undefined ? { focus: s.focus as CommunityMTileFocus } : {}),
      };
    };

    const slots: CommunityMSlot[] = [];
    let prevAt = "";
    for (let i = 0; i < raw.slots.length; i++) {
      const r = parseSlot(raw.slots[i], `${where}.slots[${i}]`, { slot: i + 1, tileIndex: claimOrder[i], prevAt, uniqueHandle: true });
      if (typeof r === "string") return fail(r);
      prevAt = r.claimedAt;
      slots.push(r);
    }

    // root — reserved or awarded; never dealt; a handle may already hold a
    // contributor tile (the award is the one sanctioned second tile) and may
    // hold roots in several Ms (unlimited, award-only).
    if (!isObj(raw.root)) return fail(`${where}: root is required`);
    if (raw.root.tileIndex !== COMMUNITY_M_TIP_TILE_INDEX || raw.root.stableKey !== COMMUNITY_M_TIP_STABLE_KEY) {
      return fail(`${where}: root must be tile ${COMMUNITY_M_TIP_TILE_INDEX} (${COMMUNITY_M_TIP_STABLE_KEY})`);
    }
    if (raw.root.status !== "reserved" && raw.root.status !== "awarded") return fail(`${where}: root.status must be reserved | awarded`);
    if (raw.root.status === "awarded" ? raw.root.slot == null : raw.root.slot != null) {
      return fail(`${where}: root.slot is present exactly when awarded`);
    }
    if (raw.root.citation !== undefined && !isStr(raw.root.citation)) return fail(`${where}: root.citation must be a string`);
    let rootSlot: CommunityMSlot | null = null;
    if (raw.root.slot != null) {
      const r = parseSlot(raw.root.slot, `${where}.root.slot`, { slot: 0, tileIndex: COMMUNITY_M_TIP_TILE_INDEX, prevAt: "", uniqueHandle: false });
      if (typeof r === "string") return fail(r);
      rootSlot = r;
    }
    if (status === "locked" && rootSlot) return fail(`${where}: a locked M cannot carry a root award`);

    // status ↔ fill consistency.
    if (status === "complete" && slots.length !== COMMUNITY_M_CONTRIBUTOR_CAPACITY) {
      return fail(`${where}: complete requires ${COMMUNITY_M_CONTRIBUTOR_CAPACITY} contributor slots`);
    }
    if (status !== "complete" && slots.length === COMMUNITY_M_CONTRIBUTOR_CAPACITY) {
      return fail(`${where}: ${COMMUNITY_M_CONTRIBUTOR_CAPACITY} contributor slots must be marked complete`);
    }
    if (status === "locked" && slots.length !== 0) return fail(`${where}: locked M cannot have slots`);
    if (status === "complete" && isStr(raw.completedAt) && raw.completedAt < slots[slots.length - 1].claimedAt) {
      return fail(`${where}: completedAt precedes the last claim`);
    }
    if (status === "active" && prevStatus !== null && prevStatus !== "complete") {
      return fail(`${where}: only one active M — previous M must be complete`);
    }
    if (status !== "locked" && prevStatus === "locked") {
      return fail(`${where}: cannot follow a locked M`);
    }
    prevStatus = status;

    ms.push({
      id: raw.id,
      number: raw.number,
      title: raw.title,
      status,
      capacity: COMMUNITY_M_CONTRIBUTOR_CAPACITY,
      claimed: slots.length,
      root: {
        tileIndex: COMMUNITY_M_TIP_TILE_INDEX,
        stableKey: COMMUNITY_M_TIP_STABLE_KEY,
        status: raw.root.status as "reserved" | "awarded",
        slot: rootSlot,
        ...(raw.root.citation !== undefined ? { citation: raw.root.citation as string } : {}),
      },
      openedAt: raw.openedAt,
      completedAt: raw.completedAt,
      ...(raw.curator !== undefined ? { curator: raw.curator as CommunityMEntry["curator"] } : {}),
      ...(raw.accent !== undefined ? { accent: raw.accent as string } : {}),
      claimOrder,
      ...(raw.pack !== undefined ? { pack: raw.pack as string } : {}),
      slots,
    });
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: COMMUNITY_M_MANIFEST_SCHEMA_VERSION,
      ...(json.repo !== undefined ? { repo: json.repo as string } : {}),
      generatedAt: json.generatedAt,
      tileCount: COMMUNITY_M_TILE_COUNT,
      geometry: {
        entry: json.geometry.entry,
        size: json.geometry.size,
        tiles: json.geometry.tiles,
      },
      ms,
    },
  };
}
