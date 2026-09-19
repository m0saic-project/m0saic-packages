#!/usr/bin/env node
/**
 * freeze-precommit — the template freeze at COMMIT time, not just build time.
 *
 * Called by tools/git-hooks/pre-commit (install once per clone, Mac or Windows:
 * `npm run hooks:install`). Every staged file that frozen.manifest.json hashes
 * (the frozen set is an import closure, so membership in the manifest — not
 * isFrozenPath() — is the test) has its STAGED bytes (`git show :<path>`, not the working
 * tree) hashed with dist/freeze.js's own hashSource — the canonical form
 * check-registry uses, so a comment-only edit passes here and there alike and
 * a one-token code edit fails in both. Contract: .ai/CLAUDE.md §10.
 *
 * ⭐ THE LAW IS THE MANIFEST AT HEAD, not the working-tree copy. Anyone can run
 * --update-freeze and rewrite the working-tree manifest to bless whatever they
 * just changed; the committed one is what the last commit swore to. Hashes are
 * compared against `HEAD:packages/templates/frozen.manifest.json` (falling back
 * to the working-tree file only when HEAD has none), and a staged manifest whose
 * `files` moved or shrank — or whose `registry` pins moved, shrank or lost a
 * `web` flag — fails outright — a re-mint is the founder's release act and goes
 * through `git commit --no-verify`. Metadata-only manifest edits (tag/commit/
 * note after the tag lands) and ADDED files/pins pass.
 *
 * ⭐ THE SNAPSHOT IS LAW THE SAME WAY. `src/web-template-ids.frozen.json` lists
 * the ids the shipped CLI links to; a staged copy that drops an id HEAD lists
 * fails (adding passes), and deleting it fails. `src/web.ts` is held by its
 * side-effect imports: an import HEAD has that the staged file lacks fails —
 * that is how a shipped id leaves web. (Stage 0b/0c at build time do the exact
 * id-level check; this is the commit-time twin, static so it needs no build.)
 *
 * ⭐ TYPECHANGE. `git diff --diff-filter` without `T` hides a staged file whose
 * TYPE changed — a frozen `.ts` replaced by a symlink to an unfrozen file keeps
 * its path, hashes to nothing here, and used to read as "0 staged frozen
 * files" (adversary 2026-09-17). `T` is in the filter, and a typechange of any
 * held path (a frozen file, the manifest, the snapshot, web.ts) fails outright:
 * "type changed — a frozen file became something else".
 *
 * ⭐ HASH VERSION. The HEAD manifest's `hashVersion` must equal the hasher's
 * FREEZE_HASH_VERSION; otherwise staged hashes cannot be judged and the gate
 * fails CLOSED (exit 2) naming both versions. Re-mint at a release.
 *
 * Exit 0 clean · 1 freeze violated · 2 the gate could not run (fails CLOSED:
 * a missing dist/freeze.js or manifest is never a pass).
 * Run:  node packages/templates/tools/freeze-precommit.mjs
 * Test: node --test packages/templates/tools/freeze-precommit.test.mjs
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The package root as git prints staged paths: repo-relative, forward slashes. */
export const PACKAGE_PREFIX = "packages/templates/";
/** Repo-relative paths of the two files held by "HEAD is law" beside the manifest. */
export const SNAPSHOT_PATH = PACKAGE_PREFIX + "src/web-template-ids.frozen.json";
export const WEB_ENTRY_PATH = PACKAGE_PREFIX + "src/web.ts";

/**
 * Side-effect import specifiers of a `src/web.ts` (`import "./m0saic/x";`),
 * sorted and unique. Read off the COMMENT-STRIPPED text when the hasher is
 * available (`freeze` = dist/freeze.js): an import wrapped in a block comment
 * is not an import, and must not count as "still present" — that was a
 * commit-time bypass of the web.ts lock (adversary 2026-09-17). Several
 * imports on one line are all seen.
 */
export function webEntryImports(source, freeze) {
  const text = freeze && typeof freeze.stripComments === "function"
    ? freeze.stripComments(source.replace(/\r\n?/g, "\n")).text
    : source;
  // Statement-aware: an import counts only at a statement start (text start,
  // after `;` or a line break) and OUTSIDE any string / template literal —
  // `stripComments` keeps literal interiors verbatim (they are code for the
  // hash), so a regex over the stripped text would still "see" an import
  // quoted inside a template literal.
  const out = new Set();
  const n = text.length;
  let i = 0;
  let atStart = true;
  while (i < n) {
    const c = text[i];
    if (atStart) {
      const m = /^import\s+["']([^"']+)["']/.exec(text.slice(i, i + 512));
      if (m) { out.add(m[1]); i += m[0].length; atStart = false; continue; }
    }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < n && text[i] !== c) { if (text[i] === "\\") i++; i++; }
      i++;
      atStart = false;
      continue;
    }
    if (c === ";" || c === "\n") { atStart = true; i++; continue; }
    if (c === " " || c === "\t") { i++; continue; }
    atStart = false;
    i++;
  }
  return [...out].sort();
}

/** Repo-relative path of a layout-fingerprint sidecar: `<pkg>/src/**\/*.layout.m0` or `<pkg>/layout-fingerprints/*.m0`. */
export function isFingerprintPath(p) {
  if (!p.startsWith(PACKAGE_PREFIX)) return false;
  const rel = p.slice(PACKAGE_PREFIX.length);
  return (rel.startsWith("src/") && rel.endsWith(".layout.m0")) || (rel.startsWith("layout-fingerprints/") && rel.endsWith(".m0"));
}

/** `registry` pins of a manifest, or {} for one minted before pins. */
const pinsOf = (manifest) => (manifest && manifest.registry && typeof manifest.registry === "object" ? manifest.registry : {});

/** Pins in `head` that `next` lost, moved (file / definition) or un-webbed. */
export function movedPins(head, next) {
  const moved = [];
  for (const id of Object.keys(pinsOf(head))) {
    const a = pinsOf(head)[id];
    const b = pinsOf(next)[id];
    if (!b) { moved.push(`${id} (dropped)`); continue; }
    if (b.file !== a.file) { moved.push(`${id} (file ${a.file} -> ${b.file})`); continue; }
    if (b.definitionSha256 !== a.definitionSha256) { moved.push(`${id} (definition changed)`); continue; }
    if (a.fieldsSha256 !== undefined && b.fieldsSha256 !== a.fieldsSha256) { moved.push(`${id} (definition fields changed)`); continue; }
    if (a.web === true && b.web !== true) { moved.push(`${id} (no longer on web)`); continue; }
    if (a.webFile !== undefined && b.webFile !== a.webFile) { moved.push(`${id} (web file ${a.webFile} -> ${b.webFile})`); continue; }
    if (a.webDefinitionSha256 !== undefined && b.webDefinitionSha256 !== a.webDefinitionSha256) moved.push(`${id} (web definition changed)`);
  }
  return moved;
}
export const BUILD_HINT = "build packages/templates first (npm run build --workspace packages/templates)";

/** dist/freeze.js, or null when it is not built — the caller must fail closed. */
export function loadFreeze(packageRoot = PACKAGE_ROOT) {
  try { return createRequire(import.meta.url)(path.join(packageRoot, "dist", "freeze.js")); }
  catch (err) { if (err && err.code === "MODULE_NOT_FOUND") return null; throw err; }
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** `[{ status, path }]` index vs HEAD. Renames are split into D + A so a moved frozen file reads as a deletion;
 *  T (typechange — a file became a symlink or vice versa) is included so a frozen path swapped for a link is judged, not skipped. */
export function listStaged(repoRoot) {
  const parts = git(["diff", "--cached", "--name-status", "-z", "--no-renames", "--diff-filter=ACDMRT"], repoRoot).split("\0");
  const staged = [];
  for (let i = 0; i + 1 < parts.length; i += 2) staged.push({ status: parts[i][0], path: parts[i + 1] });
  return staged;
}

const listSome = (xs) => `${xs.slice(0, 3).join(", ")}${xs.length > 3 ? ", ..." : ""}`;

/**
 * Pure core (the unit test drives it with fakes). `staged` = [{ status, path }]
 * repo-relative; `manifest` = the committed one; `read(path)` = staged bytes;
 * `freeze` = dist/freeze.js; `head` = { snapshot, webEntry, has } as committed
 * at HEAD (`snapshot` / `webEntry` null when HEAD has none — then nothing
 * holds it; `has(path)` says whether HEAD holds a path at all, for the
 * fingerprint sidecars). Returns { ok, checked, failures: [{ path, reason }] }.
 *
 * What is held, and how:
 *   - a file the MANIFEST hashes (whatever folder it sits in — the frozen set
 *     is an import closure, so `isFrozenPath` alone is not the test): staged
 *     bytes must hash to the manifest's value; a deletion or typechange fails;
 *   - the manifest itself: hashes, pins, `hashVersion` and `release` are HEAD's
 *     (tag / commit / note may move — the post-tag re-mint);
 *   - the shipped web-id snapshot: ids are additive-only;
 *   - src/web.ts: side-effect imports are additive-only;
 *   - layout-fingerprint sidecars HEAD already has: never modified or deleted
 *     (a NEW sidecar for a new template is free) — the commit-time twin of
 *     Stage 3, which `--update-fingerprints` would otherwise re-mint silently.
 */
export function checkStagedFreeze({ staged, manifest, read, freeze, head = {} }) {
  const failures = [];
  const manifestPath = PACKAGE_PREFIX + freeze.FREEZE_MANIFEST_FILE;
  let checked = 0;
  const rel = (p) => p.slice(PACKAGE_PREFIX.length);
  const frozenFile = (p) => manifest.files[rel(p)] !== undefined;
  const held = (p) => p === manifestPath || p === SNAPSHOT_PATH || p === WEB_ENTRY_PATH || frozenFile(p) || (isFingerprintPath(p) && head.has?.(p) === true);
  for (const { status, path: p } of staged) {
    if (!p.startsWith(PACKAGE_PREFIX)) continue;
    if (status === "T") {
      // The staged blob is a symlink target (or the path stopped being one): its
      // bytes are not the file's, so no hash can vouch for it.
      if (held(p)) failures.push({ path: p, reason: "type changed - a frozen file became something else (a symlink, a submodule); a held path keeps its type" });
      continue;
    }
    if (p === manifestPath) {
      if (status === "D") { failures.push({ path: p, reason: "the freeze manifest is a committed file - restore it, never delete it" }); continue; }
      const nextManifest = JSON.parse(read(p));
      const next = nextManifest.files ?? {};
      const moved = Object.keys(manifest.files).filter((k) => next[k] !== manifest.files[k]);
      if (moved.length) failures.push({ path: p, reason: `re-minted: ${moved.length} frozen hash(es) moved or vanished (${listSome(moved)}) - a re-mint is a release act, not a fix` });
      const pins = movedPins(manifest, nextManifest);
      if (pins.length) failures.push({ path: p, reason: `re-minted: ${pins.length} registry pin(s) moved or vanished (${listSome(pins)}) - a shipped id keeps its registering file, definition and web flag until a release re-mints` });
      const versionOf = (m) => (typeof freeze.manifestHashVersion === "function" ? freeze.manifestHashVersion(m) : (typeof m.hashVersion === "number" ? m.hashVersion : 1));
      if (versionOf(nextManifest) !== versionOf(manifest)) failures.push({ path: p, reason: `hashVersion ${versionOf(manifest)} -> ${versionOf(nextManifest)} - the hasher version is set by the checker at a release re-mint, never by hand (it would lock every clone out until the next --no-verify re-mint)` });
      if (nextManifest.release !== manifest.release) failures.push({ path: p, reason: `release ${manifest.release} -> ${nextManifest.release} - a new release re-mints the whole manifest (a release act); only tag / commit / note move between releases` });
      continue;
    }
    if (p === SNAPSHOT_PATH) {
      if (status === "D") { failures.push({ path: p, reason: "the shipped web-id snapshot is a committed file - restore it, never delete it" }); continue; }
      if (!head.snapshot) continue; // first snapshot ever: nothing to hold it to
      const nextIds = new Set((JSON.parse(read(p)).ids ?? []).map(String));
      const dropped = (head.snapshot.ids ?? []).map(String).filter((id) => !nextIds.has(id));
      if (dropped.length) failures.push({ path: p, reason: `re-minted: ${dropped.length} shipped web id(s) dropped (${listSome(dropped)}) - the installed CLI still links to them; ids are additive-only until a release re-mints` });
      continue;
    }
    if (p === WEB_ENTRY_PATH) {
      if (status === "D") { failures.push({ path: p, reason: "the browser entry registers every shipped web id - restore it, never delete it" }); continue; }
      if (typeof head.webEntry !== "string") continue;
      const nextImports = new Set(webEntryImports(read(p), freeze));
      const removed = webEntryImports(head.webEntry, freeze).filter((spec) => !nextImports.has(spec));
      if (removed.length) failures.push({ path: p, reason: `${removed.length} side-effect import(s) removed (${listSome(removed)}) - that is how a shipped id leaves Mosaic Web; imports are additive-only until a release re-mints (a pure refactor that keeps every id: prove it with npm run build, then --no-verify)` });
      continue;
    }
    if (isFingerprintPath(p)) {
      // HEAD is law for sidecars too: a fingerprint HEAD carries is the layout a
      // shipped id had; re-minting it is what a Tier-2 drift or a helper edit
      // would need to hide behind. A new sidecar (new template) is free.
      if (head.has?.(p) !== true) continue;
      if (status === "D") failures.push({ path: p, reason: "layout fingerprint deleted - a shipped id's layout record; deprecate the template, never drop its fingerprint" });
      else failures.push({ path: p, reason: "layout fingerprint re-minted - a shipped id's layout moved (--update-fingerprints is for NEW versions only; a changed sidecar for a shipped id is a release act, --no-verify)" });
      continue;
    }
    const expected = manifest.files[rel(p)];
    if (expected === undefined) continue; // not in the manifest: new work is free
    checked++;
    if (status === "D") { failures.push({ path: p, reason: "deleted - that removes shipped behaviour" }); continue; }
    const { hash, confident } = freeze.hashSource(read(p));
    if (hash === expected) continue;
    failures.push({ path: p, reason: confident ? "code changed (comments only; reformatting counts as a change)" : "changed, and the scanner lost its place so it was hashed raw" });
  }
  return { ok: failures.length === 0, checked, failures };
}

/** Wires git + dist/freeze.js into checkStagedFreeze. Returns the exit code; `log` gets every line. */
export function main({ packageRoot = PACKAGE_ROOT, log = (s) => console.error(s) } = {}) {
  const freeze = loadFreeze(packageRoot);
  if (!freeze) { log(`[freeze] x dist/freeze.js is missing - ${BUILD_HINT}`); return 2; }
  const repoRoot = git(["rev-parse", "--show-toplevel"], packageRoot).trim();
  const manifestPath = PACKAGE_PREFIX + freeze.FREEZE_MANIFEST_FILE;
  let manifest;
  try { manifest = JSON.parse(git(["show", `HEAD:${manifestPath}`], repoRoot)); }
  catch { manifest = freeze.readFreezeManifest(packageRoot); }
  if (!manifest) { log(`[freeze] x ${manifestPath} is missing - restore it: git checkout -- ${manifestPath}`); return 2; }
  const minted = typeof freeze.manifestHashVersion === "function" ? freeze.manifestHashVersion(manifest) : (typeof manifest.hashVersion === "number" ? manifest.hashVersion : 1);
  // A dist/freeze.js built before the hasher carried a version (pre-0.2.0)
  // reads as v1 — judging a v2 manifest with it would report every staged
  // frozen file as changed. Stale build, not a violation: fail closed, say so.
  const checker = typeof freeze.FREEZE_HASH_VERSION === "number" ? freeze.FREEZE_HASH_VERSION : 1;
  if (minted !== checker) {
    if (typeof freeze.describeHashVersionMismatch === "function") log(`[freeze] x ${freeze.describeHashVersionMismatch(minted)}`);
    else log(`[freeze] x manifest minted with hash v${minted}, but this dist/freeze.js predates hash versions (v1) - a stale build: ${BUILD_HINT}`);
    if (minted < checker) log(`[freeze]   Staged frozen files cannot be judged until the manifest is re-minted at a release (commit the re-mint with --no-verify).`);
    return 2;
  }
  const headShow = (p) => { try { return git(["show", `HEAD:${p}`], repoRoot); } catch { return null; } };
  const snapshotText = headShow(SNAPSHOT_PATH);
  const headHas = (p) => { try { execFileSync("git", ["cat-file", "-e", `HEAD:${p}`], { cwd: repoRoot, stdio: "ignore" }); return true; } catch { return false; } };
  const head = { snapshot: snapshotText ? JSON.parse(snapshotText) : null, webEntry: headShow(WEB_ENTRY_PATH), has: headHas };
  const staged = listStaged(repoRoot);
  const r = checkStagedFreeze({ staged, manifest, read: (p) => git(["show", `:${p}`], repoRoot), freeze, head });
  if (r.ok) { log(`[freeze] ok: ${r.checked} frozen file(s) staged, all unchanged against ${manifest.release}.`); return 0; }
  log(`[freeze] x ${r.failures.length} staged change(s) violate the ${manifest.release} freeze:`);
  for (const f of r.failures) log(`    ${f.path}\n        ${f.reason}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main()); }
  catch (err) { console.error(`[freeze] x the gate could not run: ${err && err.message ? err.message : err}`); process.exit(2); }
}
