/**
 * Unit tests for freeze-precommit.mjs. The pure core (checkStagedFreeze) is
 * driven through its seams — a fake manifest, a fake staged list and a fake
 * `read` — so no real git or index state is touched. The hasher is the REAL
 * dist/freeze.js so a comment-only edit is judged exactly as check-registry
 * would judge it. Only `main` is exercised end-to-end, and only for its
 * fail-closed path (no dist → exit 2), which bails before any git call.
 *
 * Run with: node --test packages/templates/tools/freeze-precommit.test.mjs
 * Prereq: packages/templates built (dist/freeze.js).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { BUILD_HINT, PACKAGE_PREFIX, SNAPSHOT_PATH, WEB_ENTRY_PATH, checkStagedFreeze, loadFreeze, main, movedPins, webEntryImports } from "./freeze-precommit.mjs";

const freeze = createRequire(import.meta.url)("../dist/freeze.js");
const PKG_ROOT_FOR_DIST = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const FROZEN = "src/m0saic/alpine/v1/theming.ts";
const SHARED = "src/m0saic/alpine/_shared/alpine-theme.ts";
const ORIGINAL = "// shipped\nexport const pad = 4;\nexport const label = `a  b`;\n";
const PIN_A = { file: "src/m0saic/alpine/v1/theming.ts", definitionSha256: "a".repeat(64), web: true };
const PIN_B = { file: "src/m0saic/alpine/v1/other.ts", definitionSha256: "b".repeat(64), fieldsSha256: "c".repeat(64) };
const manifest = {
  release: "0.2.0", tag: "v0.2.0", commit: "d72fdcea", note: "test", hashVersion: freeze.FREEZE_HASH_VERSION,
  files: { [FROZEN]: freeze.hashSource(ORIGINAL).hash, [SHARED]: freeze.hashSource(ORIGINAL).hash },
  registry: { "@m0saic/alpine/a/v1": PIN_A, "@m0saic/alpine/b/v1": PIN_B },
};
const MANIFEST_PATH = PACKAGE_PREFIX + freeze.FREEZE_MANIFEST_FILE;
const HEAD_SNAPSHOT = { release: "0.2.0", commit: "d72fdcea", note: "t", ids: ["@m0saic/alpine/a/v1", "@m0saic/hello-world/v1"] };
const HEAD_WEB = `import "./m0saic/wireframe";\nimport "./m0saic/hello-world"; // card\nimport './m0saic/alpine'\nimport { x } from "./not-a-side-effect";\n`;

/** Build the seams: `files` maps repo-relative path → staged content. */
function run(staged, files = {}, head = { snapshot: HEAD_SNAPSHOT, webEntry: HEAD_WEB }) {
  const read = (p) => { if (!(p in files)) throw new Error(`unexpected read of ${p}`); return files[p]; };
  return checkStagedFreeze({ staged, manifest, read, freeze, head });
}
const M = (p) => ({ status: "M", path: p });

test("nothing frozen staged → ok, zero checked, nothing read", () => {
  // (src/web.ts is NOT in this list any more: it is held by its imports — see below.)
  const r = run([M("apps/mosaic/web/src/App.tsx"), M("packages/templates/src/webTemplateIds.ts"), M("packages/templates/src/m0saic/alpine/index.ts")]);
  assert.deepEqual(r, { ok: true, checked: 0, failures: [] });
});

test("comment-only edit to a frozen file → ok (same canonical hash)", () => {
  const p = PACKAGE_PREFIX + FROZEN;
  const edited = "// shipped — now with a\n// longer note /* and a block */\nexport const pad = 4;\nexport const label = `a  b`;\n";
  const r = run([M(p)], { [p]: edited });
  assert.equal(r.ok, true);
  assert.equal(r.checked, 1);
});

test("one-token code edit to a frozen file → fails naming the file", () => {
  const p = PACKAGE_PREFIX + FROZEN;
  const r = run([M(p)], { [p]: ORIGINAL.replace("pad = 4", "pad = 5") });
  assert.equal(r.ok, false);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].path, p);
  assert.match(r.failures[0].reason, /code changed/);
});

test("reformatting a frozen file counts as a change; CRLF does not", () => {
  const p = PACKAGE_PREFIX + FROZEN;
  assert.equal(run([M(p)], { [p]: ORIGINAL.replace("pad = 4", "pad=4") }).ok, false);
  assert.equal(run([M(p)], { [p]: ORIGINAL.replace(/\n/g, "\r\n") }).ok, true);
});

test("a change to a frozen _shared helper is caught on the same terms", () => {
  const p = PACKAGE_PREFIX + SHARED;
  const r = run([M(p)], { [p]: ORIGINAL + "export const extra = 1;\n" });
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].path, p);
});

test("staged deletion of a manifest path → fails without reading it", () => {
  const p = PACKAGE_PREFIX + FROZEN;
  const r = run([{ status: "D", path: p }]);
  assert.equal(r.ok, false);
  assert.match(r.failures[0].reason, /deleted/);
});

test("staged typechange (T) of a held path → fails as 'type changed' without reading it; unheld paths pass", () => {
  // A frozen file replaced by a symlink keeps its path; the staged blob is the
  // link TARGET, so no hash can vouch for it (adversary 2026-09-17).
  const T = (p) => ({ status: "T", path: p });
  for (const p of [PACKAGE_PREFIX + FROZEN, PACKAGE_PREFIX + SHARED, MANIFEST_PATH, SNAPSHOT_PATH, WEB_ENTRY_PATH]) {
    const r = run([T(p)]);
    assert.equal(r.ok, false, p);
    assert.equal(r.failures.length, 1);
    assert.equal(r.failures[0].path, p);
    assert.match(r.failures[0].reason, /type changed - a frozen file became something else/);
  }
  // Not held: a new vN+1 file, a test, an unfrozen barrel, a file outside the package.
  const r = run([T(PACKAGE_PREFIX + "src/m0saic/alpine/v2/theming.ts"), T(PACKAGE_PREFIX + FROZEN.replace(".ts", ".test.ts")), T(PACKAGE_PREFIX + "src/m0saic/alpine/index.ts"), T("apps/mosaic/web/src/App.tsx")]);
  assert.deepEqual(r, { ok: true, checked: 0, failures: [] });
});

test("the hook and listStaged both ask git for typechanges (diff-filter includes T)", () => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const self = fs.readFileSync(path.join(here, "freeze-precommit.mjs"), "utf8");
  assert.match(self, /--diff-filter=ACDMRT/);
  const hook = fs.readFileSync(path.join(here, "..", "..", "..", "tools", "git-hooks", "pre-commit"), "utf8");
  assert.match(hook, /--diff-filter=ACDMRT/);
  assert.doesNotMatch(hook, /--diff-filter=ACDMR\b(?!T)/);
});

test("frozen-shaped path NOT in the manifest (new vN+1 work) → free to change", () => {
  const p = PACKAGE_PREFIX + "src/m0saic/alpine/v2/theming.ts";
  const r = run([{ status: "A", path: p }], { [p]: "export const pad = 99;\n" });
  assert.deepEqual(r, { ok: true, checked: 0, failures: [] });
});

test("tests beside a frozen template are not frozen", () => {
  const p = PACKAGE_PREFIX + "src/m0saic/alpine/v1/theming.test.ts";
  assert.equal(run([M(p)]).ok, true);
});

test("staged manifest: metadata-only edit passes, moved or dropped hash fails, deletion fails", () => {
  const meta = { ...manifest, tag: "v0.2.0 (tagged)", commit: "abcdef0", note: "after the tag" };
  assert.equal(run([M(MANIFEST_PATH)], { [MANIFEST_PATH]: JSON.stringify(meta) }).ok, true);

  const moved = { ...manifest, files: { ...manifest.files, [FROZEN]: "0".repeat(64) } };
  let r = run([M(MANIFEST_PATH)], { [MANIFEST_PATH]: JSON.stringify(moved) });
  assert.equal(r.ok, false);
  assert.match(r.failures[0].reason, /re-minted: 1 frozen hash/);
  assert.match(r.failures[0].reason, new RegExp(FROZEN));

  const dropped = { ...manifest, files: { [SHARED]: manifest.files[SHARED] } };
  assert.equal(run([M(MANIFEST_PATH)], { [MANIFEST_PATH]: JSON.stringify(dropped) }).ok, false);

  r = run([{ status: "D", path: MANIFEST_PATH }]);
  assert.equal(r.ok, false);
  assert.match(r.failures[0].reason, /never delete/);
});

test("a re-mint that blesses a code change is caught on both files (hashes come from HEAD, not the working tree)", () => {
  const p = PACKAGE_PREFIX + FROZEN;
  const changed = ORIGINAL.replace("pad = 4", "pad = 5");
  const blessed = { ...manifest, files: { ...manifest.files, [FROZEN]: freeze.hashSource(changed).hash } };
  const r = run([M(p), M(MANIFEST_PATH)], { [p]: changed, [MANIFEST_PATH]: JSON.stringify(blessed) });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures.map((f) => f.path).sort(), [MANIFEST_PATH, p].sort());
});

test("loadFreeze: null when dist/freeze.js is not built; main fails CLOSED with the build hint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-freeze-precommit-"));
  try {
    assert.equal(loadFreeze(dir), null);
    const lines = [];
    assert.equal(main({ packageRoot: dir, log: (s) => lines.push(s) }), 2);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes(BUILD_HINT), lines[0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.ok(loadFreeze(), "the real dist/freeze.js loads");
});

test("staged manifest: registry pins are additive-only - a moved file, changed definition, dropped pin or lost web flag fails", () => {
  const withPins = (registry) => JSON.stringify({ ...manifest, registry });
  // Adding a pin (new work pinned at the next mint) passes.
  assert.equal(run([M(MANIFEST_PATH)], { [MANIFEST_PATH]: withPins({ ...manifest.registry, "@m0saic/new/v1": PIN_B }) }).ok, true);
  const cases = [
    [{ "@m0saic/alpine/b/v1": PIN_B }, /dropped/],
    [{ ...manifest.registry, "@m0saic/alpine/a/v1": { ...PIN_A, file: "src/m0saic/alpine/v2/theming.ts" } }, /file src\/m0saic\/alpine\/v1\/theming.ts -> src\/m0saic\/alpine\/v2\/theming.ts/],
    [{ ...manifest.registry, "@m0saic/alpine/a/v1": { ...PIN_A, definitionSha256: "f".repeat(64) } }, /definition changed/],
    [{ ...manifest.registry, "@m0saic/alpine/b/v1": { ...PIN_B, fieldsSha256: "e".repeat(64) } }, /definition fields changed/],
    [{ ...manifest.registry, "@m0saic/alpine/a/v1": { file: PIN_A.file, definitionSha256: PIN_A.definitionSha256 } }, /no longer on web/],
  ];
  for (const [registry, re] of cases) {
    const r = run([M(MANIFEST_PATH)], { [MANIFEST_PATH]: withPins(registry) });
    assert.equal(r.ok, false);
    assert.match(r.failures[0].reason, /registry pin\(s\) moved or vanished/);
    assert.match(r.failures[0].reason, re);
  }
  // A HEAD manifest minted before pins holds no pins.
  assert.deepEqual(movedPins({ files: {} }, { files: {} }), []);
});

test("staged snapshot: HEAD is law - dropping a shipped web id fails, adding passes, deleting fails, first snapshot is free", () => {
  const stage = (ids) => JSON.stringify({ ...HEAD_SNAPSHOT, ids });
  assert.equal(run([M(SNAPSHOT_PATH)], { [SNAPSHOT_PATH]: stage([...HEAD_SNAPSHOT.ids, "@m0saic/new/v1"]) }).ok, true);
  const r = run([M(SNAPSHOT_PATH)], { [SNAPSHOT_PATH]: stage(["@m0saic/hello-world/v1"]) });
  assert.equal(r.ok, false);
  assert.match(r.failures[0].reason, /1 shipped web id\(s\) dropped \(@m0saic\/alpine\/a\/v1\)/);
  assert.match(r.failures[0].reason, /release re-mints/);
  assert.match(run([{ status: "D", path: SNAPSHOT_PATH }]).failures[0].reason, /never delete/);
  assert.equal(run([{ status: "A", path: SNAPSHOT_PATH }], { [SNAPSHOT_PATH]: stage([]) }, { snapshot: null, webEntry: null }).ok, true);
});

test("staged web.ts: a removed side-effect import fails, additions and reordering pass", () => {
  assert.deepEqual(webEntryImports(HEAD_WEB), ["./m0saic/alpine", "./m0saic/hello-world", "./m0saic/wireframe"]);
  const reordered = `import './m0saic/alpine';\nimport "./m0saic/wireframe";\nimport "./m0saic/charts";\nimport "./m0saic/hello-world";\n`;
  assert.equal(run([M(WEB_ENTRY_PATH)], { [WEB_ENTRY_PATH]: reordered }).ok, true);
  const r = run([M(WEB_ENTRY_PATH)], { [WEB_ENTRY_PATH]: `import "./m0saic/wireframe";\nimport "./m0saic/hello-world";\n` });
  assert.equal(r.ok, false);
  assert.match(r.failures[0].reason, /1 side-effect import\(s\) removed \(\.\/m0saic\/alpine\)/);
  assert.match(run([{ status: "D", path: WEB_ENTRY_PATH }]).failures[0].reason, /never delete/);
  assert.equal(run([M(WEB_ENTRY_PATH)], { [WEB_ENTRY_PATH]: "" }, { snapshot: null, webEntry: null }).ok, true);
});

test("main: a HEAD manifest minted under another hash version fails CLOSED (exit 2) naming both versions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-freeze-precommit-"));
  try {
    execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
    fs.mkdirSync(path.join(dir, "dist"));
    fs.copyFileSync(path.join(PKG_ROOT_FOR_DIST, "dist", "freeze.js"), path.join(dir, "dist", "freeze.js"));
    fs.writeFileSync(path.join(dir, freeze.FREEZE_MANIFEST_FILE), JSON.stringify({ release: "0.1.0", tag: "v0.1.0", commit: "c", note: "n", files: {} }));
    const lines = [];
    assert.equal(main({ packageRoot: dir, log: (s) => lines.push(s) }), 2);
    assert.match(lines[0], /manifest minted with hash v1, checker is v2/);
    assert.match(lines.join("\n"), /--no-verify/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── 2026-09-17 review round: closure files, hashVersion/release, sidecars, commented imports ──

test("a manifest-listed file OUTSIDE every vN/ and _shared/ folder (import closure) is held exactly like a seed", () => {
  // isFrozenPath says false for a pack-level helper; the manifest says it is frozen. The manifest wins.
  const helper = "src/m0saic/wireframe/utils/wireframeCell.ts";
  assert.equal(freeze.isFrozenPath(helper), false);
  const m = { ...manifest, files: { ...manifest.files, [helper]: freeze.hashSource(ORIGINAL).hash } };
  const p = PACKAGE_PREFIX + helper;
  const read = (q) => (q === p ? ORIGINAL.replace("pad = 4", "pad = 5") : ORIGINAL);
  const r = checkStagedFreeze({ staged: [M(p)], manifest: m, read, freeze, head: {} });
  assert.equal(r.ok, false);
  assert.equal(r.checked, 1);
  assert.match(r.failures[0].reason, /code changed/);
  const ok = checkStagedFreeze({ staged: [M(p)], manifest: m, read: () => "// comment only\n" + ORIGINAL, freeze, head: {} });
  assert.equal(ok.ok, true);
  const del = checkStagedFreeze({ staged: [{ status: "D", path: p }], manifest: m, read: () => { throw new Error("no read"); }, freeze, head: {} });
  assert.equal(del.ok, false);
  assert.match(del.failures[0].reason, /deleted/);
});

test("staged manifest: hashVersion and release are held by HEAD; tag / commit / note stay free", () => {
  const same = JSON.stringify({ ...manifest, tag: "v0.2.0 (published)", commit: "abc1234", note: "post-tag re-mint" });
  assert.equal(run([M(MANIFEST_PATH)], { [MANIFEST_PATH]: same }).ok, true);
  const bumped = JSON.stringify({ ...manifest, hashVersion: manifest.hashVersion + 1 });
  const r1 = run([M(MANIFEST_PATH)], { [MANIFEST_PATH]: bumped });
  assert.equal(r1.ok, false);
  assert.match(r1.failures[0].reason, /hashVersion/);
  const dropped = JSON.stringify({ ...manifest, hashVersion: undefined });
  const r2 = run([M(MANIFEST_PATH)], { [MANIFEST_PATH]: dropped });
  assert.equal(r2.ok, false);
  assert.match(r2.failures[0].reason, /hashVersion/);
  const rel = JSON.stringify({ ...manifest, release: "0.3.0" });
  const r3 = run([M(MANIFEST_PATH)], { [MANIFEST_PATH]: rel });
  assert.equal(r3.ok, false);
  assert.match(r3.failures[0].reason, /release 0\.2\.0 -> 0\.3\.0/);
});

test("staged manifest: a web-side pin (webFile / webDefinitionSha256) is held like the node one", () => {
  const webPin = { ...PIN_A, webFile: "src/m0saic/alpine/v1/theming.web.ts", webDefinitionSha256: "d".repeat(64) };
  const m = { ...manifest, registry: { ...manifest.registry, "@m0saic/alpine/a/v1": webPin } };
  const next = (patch) => JSON.stringify({ ...m, registry: { ...m.registry, "@m0saic/alpine/a/v1": { ...webPin, ...patch } } });
  const r = (text) => checkStagedFreeze({ staged: [M(MANIFEST_PATH)], manifest: m, read: () => text, freeze, head: {} });
  assert.equal(r(next({})).ok, true);
  assert.match(r(next({ webFile: "src/m0saic/alpine/v1/evil.web.ts" })).failures[0].reason, /web file/);
  assert.match(r(next({ webDefinitionSha256: "e".repeat(64) })).failures[0].reason, /web definition changed/);
  assert.deepEqual(movedPins(m, JSON.parse(next({ web: undefined }))), ["@m0saic/alpine/a/v1 (no longer on web)"]);
});

test("layout fingerprint sidecars: HEAD is law - modify or delete fails, a new sidecar or one HEAD lacks is free", () => {
  const sidecar = PACKAGE_PREFIX + "src/m0saic/alpine/v1/theming.layout.m0";
  const fallback = PACKAGE_PREFIX + "layout-fingerprints/some-id.m0";
  const notOne = PACKAGE_PREFIX + "src/m0saic/alpine/v1/notes.m0";
  const head = { snapshot: HEAD_SNAPSHOT, webEntry: HEAD_WEB, has: (p) => p === sidecar || p === fallback };
  const r = (staged) => checkStagedFreeze({ staged, manifest, read: () => "3(1,1,1)", freeze, head });
  assert.equal(r([M(sidecar)]).ok, false);
  assert.match(r([M(sidecar)]).failures[0].reason, /re-minted/);
  assert.match(r([{ status: "D", path: fallback }]).failures[0].reason, /deleted/);
  assert.equal(r([{ status: "A", path: PACKAGE_PREFIX + "src/m0saic/alpine/v2/theming.layout.m0" }]).ok, true);
  assert.equal(r([M(PACKAGE_PREFIX + "src/m0saic/alpine/v2/theming.layout.m0")]).ok, true, "HEAD lacks it: free");
  assert.equal(r([M(notOne)]).ok, true, "a .m0 that is not a sidecar is not held");
  assert.equal(checkStagedFreeze({ staged: [M(sidecar)], manifest, read: () => "x", freeze, head: {} }).ok, true, "no head.has → nothing held (older caller)");
});

test("staged web.ts: a block-commented or template-literal-wrapped import does not count as present; two imports on one line are both seen", () => {
  const p = WEB_ENTRY_PATH;
  const commented = `import "./m0saic/wireframe";\n/*\nimport "./m0saic/hello-world";\n*/\nimport './m0saic/alpine'\n`;
  const r1 = run([M(p)], { [p]: commented });
  assert.equal(r1.ok, false);
  assert.match(r1.failures[0].reason, /hello-world/);
  const inLiteral = `import "./m0saic/wireframe";\nconst note = \`\nimport "./m0saic/hello-world";\n\`;\nimport './m0saic/alpine'\n`;
  const r2 = run([M(p)], { [p]: inLiteral });
  assert.equal(r2.ok, false);
  assert.match(r2.failures[0].reason, /hello-world/);
  const joined = `import "./m0saic/wireframe"; import "./m0saic/hello-world"; import './m0saic/alpine'\n`;
  assert.equal(run([M(p)], { [p]: joined }).ok, true);
  assert.deepEqual(webEntryImports(joined, freeze), ["./m0saic/alpine", "./m0saic/hello-world", "./m0saic/wireframe"]);
  assert.deepEqual(webEntryImports(commented, freeze), ["./m0saic/alpine", "./m0saic/wireframe"]);
});
