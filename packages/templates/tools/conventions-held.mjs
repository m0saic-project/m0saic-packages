/**
 * Conventions held — templates that DELIBERATELY stay at their shipped line.
 *
 * The gate's vN+1 worklist lists every live template that is behind a
 * convention its code must meet. Most of them clear at their next version.
 * A few should not get one: the template does one specific job, reached one
 * specific way, and a vN+1 would cost more than the rule buys. Left on the
 * worklist, such a template pins the count above zero forever — and a count
 * that never reaches zero stops being read, so the next template that really
 * falls behind hides behind it.
 *
 * `src/conventions-held.json` names those templates, each with the reason a
 * reviewer reads. A held template is counted apart (like deprecated and
 * internal ones) and printed with its reason on every gate run, so the
 * decision stays visible instead of silent.
 *
 * Holding changes NOTHING about the template: it still registers, still
 * renders, is still frozen, and is still reported as behind by
 * `m0saic doctor`. It only says "this lag is a decision, not a to-do".
 *
 * The list is kept honest by the gate: an entry that no longer applies (its
 * template is gone, superseded, internal, or no longer behind on anything its
 * code must meet) FAILS the build, so the file cannot rot into a place where
 * lag is parked.
 *
 * It lives under `src/` so it can never reach the tarball (`package.json#files`
 * has no `src` entry). Pure logic lives here so it can be unit-tested;
 * `check-registry.mjs` does the I/O and reporting.
 */
import fs from "node:fs";
import path from "node:path";

/** Package-relative path of the list. */
export const CONVENTIONS_HELD_FILE = "src/conventions-held.json";

/** @typedef {Record<string, string>} ConventionsHeld  templateId → reason */

/**
 * Read the list. `{}` when the file is absent (nothing is held). A present
 * but malformed file throws: a list that silently degrades to "nothing held"
 * would put its templates back on the worklist without saying why.
 * @param {string} packageRoot
 * @returns {ConventionsHeld}
 */
export function readConventionsHeld(packageRoot) {
  const p = path.join(packageRoot, CONVENTIONS_HELD_FILE);
  if (!fs.existsSync(p)) return {};
  const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  const held = parsed?.held;
  if (!parsed || typeof parsed !== "object" || !held || typeof held !== "object" || Array.isArray(held)) {
    throw new Error(`${CONVENTIONS_HELD_FILE}: expected { schemaVersion, held: { "<templateId>": "<reason>" } }`);
  }
  return held;
}

/**
 * Judge the list against the tree.
 *
 * @param {ConventionsHeld} held
 * @param {{
 *   registered: (id: string) => boolean,
 *   deprecated: (id: string) => boolean,
 *   internal: (id: string) => boolean,
 *   behindOn: (id: string) => string[],
 * }} tree  `behindOn` = the conventions the template lags on (empty = none).
 * @returns {{ ok: boolean, ids: string[], problems: string[] }}
 *   `ids` = the entries that hold (sorted); `problems` = one line per stale or
 *   malformed entry.
 */
export function checkConventionsHeld(held, tree) {
  const ids = [];
  const problems = [];
  for (const id of Object.keys(held).sort()) {
    const reason = held[id];
    if (typeof reason !== "string" || reason.trim().length === 0) {
      problems.push(`${id}: no reason — say why this template stays at its shipped line.`);
      continue;
    }
    if (!tree.registered(id)) {
      problems.push(`${id}: not a registered template — remove the entry (or fix the id).`);
      continue;
    }
    if (tree.deprecated(id)) {
      problems.push(`${id}: is deprecated — a superseded template is never on the worklist; remove the entry.`);
      continue;
    }
    if (tree.internal(id)) {
      problems.push(`${id}: is internal — its parent's vN+1 carries the handles, it is never on the worklist; remove the entry.`);
      continue;
    }
    const behind = tree.behindOn(id);
    if (behind.length === 0) {
      problems.push(`${id}: is no longer behind on any convention — remove the entry.`);
      continue;
    }
    if (behind.every((c) => c === "catalogSidecar")) {
      problems.push(`${id}: is behind on catalogSidecar alone — that is not worklist lag (a sidecar re-describes it); remove the entry.`);
      continue;
    }
    ids.push(id);
  }
  return { ok: problems.length === 0, ids, problems };
}
