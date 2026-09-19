/**
 * Shipped web ids — the additive-only lock on `src/web.ts`.
 *
 * `web-template-ids.json` (generated from `src/web.ts` at build) ships in the
 * `m0saic` tarball, and the CLI prints `app.m0saic.io/make?t=<id>` for exactly
 * those ids. Removing an id from `src/web.ts` after a CLI release therefore
 * makes an ALREADY-INSTALLED CLI print a dead link — the id is gone from the
 * web registry while the old tarball still advertises it.
 *
 * `src/web-template-ids.frozen.json` snapshots the list as it shipped
 * (re-minted deliberately at each CLI release, never to clear a failing gate).
 * It lives under `src/` so it can never reach the tarball: the builder copies
 * per `package.json#files` (no `src` entry) and `audit-publish-tarball.mjs`
 * refuses any `src/` path segment. Rule: `.ai/proposed-plans/launch-epic-0.2.0.md`
 * ("never remove an id from packages/templates/src/web.ts that the shipped
 * web-template-ids.json lists").
 *
 * Pure logic lives here so it can be unit-tested; `check-registry.mjs` does
 * the I/O and reporting.
 */
import fs from "node:fs";
import path from "node:path";

/** Package-relative path of the snapshot. Under `src/` ON PURPOSE — see above. */
export const SHIPPED_WEB_IDS_FILE = "src/web-template-ids.frozen.json";

/** Package-relative path of the build output the CLI ships. */
export const GENERATED_WEB_IDS_FILE = "web-template-ids.json";

/** @typedef {{ release: string; commit: string; note: string; ids: string[] }} ShippedWebIds */

/**
 * Read the snapshot. `null` when absent (no CLI release has been minted yet —
 * the gate has nothing to hold the tree to). A present-but-malformed file
 * throws: a lock that silently degrades to "nothing to check" is not a lock.
 * @param {string} packageRoot
 * @returns {ShippedWebIds | null}
 */
export function readShippedWebIds(packageRoot) {
  const p = path.join(packageRoot, SHIPPED_WEB_IDS_FILE);
  if (!fs.existsSync(p)) return null;
  const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.ids) || typeof parsed.release !== "string") {
    throw new Error(`${SHIPPED_WEB_IDS_FILE}: expected { release, commit, note, ids: string[] }`);
  }
  return parsed;
}

/**
 * Read the freshly generated list. `null` when absent (the build has not run
 * `dist/gen-web-template-ids.js` yet — the gate cannot answer).
 * @param {string} packageRoot
 * @returns {string[] | null}
 */
export function readGeneratedWebIds(packageRoot) {
  const p = path.join(packageRoot, GENERATED_WEB_IDS_FILE);
  if (!fs.existsSync(p)) return null;
  const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  return Array.isArray(parsed?.ids) ? parsed.ids.map(String) : [];
}

/**
 * Every shipped id must still be registered on web. Additions are free
 * (`added` is informational — the shipped CLI just does not advertise them
 * until the next release re-mints the snapshot); a removal is the violation.
 * @param {ShippedWebIds} shipped
 * @param {readonly string[]} currentIds
 * @returns {{ ok: boolean; release: string; commit: string; shipped: number; registered: number; missing: string[]; added: string[] }}
 */
export function checkShippedWebIds(shipped, currentIds) {
  const current = new Set(currentIds.map(String));
  const shippedSet = new Set(shipped.ids.map(String));
  const missing = [...shippedSet].filter((id) => !current.has(id)).sort();
  const added = [...current].filter((id) => !shippedSet.has(id)).sort();
  return {
    ok: missing.length === 0,
    release: shipped.release,
    commit: shipped.commit,
    shipped: shippedSet.size,
    registered: shippedSet.size - missing.length,
    missing,
    added,
  };
}

/**
 * Cross-check the snapshot against the freeze manifest's registry pins: every
 * id the manifest pinned as ON WEB at mint must still be in the snapshot AND
 * still registered by the browser entry. Closes the re-mint bypass: dropping
 * an id from `src/web.ts` together with `src/web-template-ids.frozen.json`
 * passes the plain snapshot check (the snapshot no longer lists it), but the
 * manifest still does — and the manifest cannot be re-minted without the
 * pre-commit hook refusing the commit.
 * @param {readonly string[]} pinnedWebIds  ids with `web: true` in frozen.manifest.json
 * @param {readonly string[]} snapshotIds   ids in the snapshot
 * @param {readonly string[]} currentIds    ids the build generated from src/web.ts
 * @returns {{ ok: boolean; pinned: number; notInSnapshot: string[]; notOnWeb: string[] }}
 */
export function checkPinnedWebIds(pinnedWebIds, snapshotIds, currentIds) {
  const snapshot = new Set(snapshotIds.map(String));
  const current = new Set(currentIds.map(String));
  const pinned = [...new Set(pinnedWebIds.map(String))].sort();
  const notInSnapshot = pinned.filter((id) => !snapshot.has(id));
  const notOnWeb = pinned.filter((id) => !current.has(id));
  return { ok: notInSnapshot.length === 0 && notOnWeb.length === 0, pinned: pinned.length, notInSnapshot, notOnWeb };
}
