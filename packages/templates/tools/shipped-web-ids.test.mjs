/**
 * Tests for shipped-web-ids.mjs — the additive-only lock on `src/web.ts`.
 *
 * Run with: node --test packages/templates/tools/shipped-web-ids.test.mjs
 * No build prerequisite: the pure checks use in-memory fixtures; the two
 * "real tree" tests read the committed snapshot and the committed
 * web-template-ids.json straight from the package root.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERATED_WEB_IDS_FILE,
  SHIPPED_WEB_IDS_FILE,
  checkPinnedWebIds,
  checkShippedWebIds,
  readGeneratedWebIds,
  readShippedWebIds,
} from "./shipped-web-ids.mjs";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const snapshot = (ids) => ({ release: "0.2.0", commit: "d72fdcea", note: "t", ids });

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-shipped-web-ids-"));
  return Promise.resolve(fn(dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test("passes when every shipped id is still registered (additions are free)", () => {
  const r = checkShippedWebIds(snapshot(["@m0saic/a/v1", "@m0saic/b/v1"]), ["@m0saic/b/v1", "@m0saic/a/v1", "@m0saic/new/v1"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.added, ["@m0saic/new/v1"]);
  assert.equal(r.shipped, 2);
  assert.equal(r.registered, 2);
  assert.equal(r.release, "0.2.0");
  assert.equal(r.commit, "d72fdcea");
});

test("fails naming every removed id, sorted", () => {
  const r = checkShippedWebIds(snapshot(["@m0saic/z/v1", "@m0saic/a/v1", "@m0saic/m/v1"]), ["@m0saic/m/v1"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["@m0saic/a/v1", "@m0saic/z/v1"]);
  assert.equal(r.shipped, 3);
  assert.equal(r.registered, 1);
});

test("an empty current list fails on every shipped id", () => {
  const r = checkShippedWebIds(snapshot(["@m0saic/a/v1"]), []);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["@m0saic/a/v1"]);
});

test("duplicate ids in the snapshot count once", () => {
  const r = checkShippedWebIds(snapshot(["@m0saic/a/v1", "@m0saic/a/v1"]), ["@m0saic/a/v1"]);
  assert.equal(r.ok, true);
  assert.equal(r.shipped, 1);
  assert.equal(r.registered, 1);
});

test("the snapshot lives under src/ so it can never ship", () => {
  // The builder copies per package.json#files and the tarball audit refuses
  // any `src/` path segment — both hold as long as this prefix does.
  assert.ok(SHIPPED_WEB_IDS_FILE.startsWith("src/"));
  const files = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")).files;
  assert.ok(!files.includes("src"), "package.json#files must not list src");
  assert.ok(files.includes(GENERATED_WEB_IDS_FILE), "the generated list is what ships");
});

test("readShippedWebIds: null when absent, the object when present, throws when malformed", () =>
  withTmpDir((dir) => {
    assert.equal(readShippedWebIds(dir), null);
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, SHIPPED_WEB_IDS_FILE), JSON.stringify(snapshot(["@m0saic/a/v1"])));
    assert.deepEqual(readShippedWebIds(dir).ids, ["@m0saic/a/v1"]);
    fs.writeFileSync(path.join(dir, SHIPPED_WEB_IDS_FILE), JSON.stringify({ release: "0.2.0" }));
    assert.throws(() => readShippedWebIds(dir), /expected \{ release, commit, note, ids/);
  }));

test("readGeneratedWebIds: null when absent, the ids when present", () =>
  withTmpDir((dir) => {
    assert.equal(readGeneratedWebIds(dir), null);
    fs.writeFileSync(path.join(dir, GENERATED_WEB_IDS_FILE), JSON.stringify({ schemaVersion: 1, ids: ["@m0saic/a/v1"] }));
    assert.deepEqual(readGeneratedWebIds(dir), ["@m0saic/a/v1"]);
  }));

test("real tree: the committed snapshot is well-formed, sorted and duplicate-free", () => {
  const shipped = readShippedWebIds(PKG_ROOT);
  assert.ok(shipped, `${SHIPPED_WEB_IDS_FILE} is committed`);
  assert.equal(shipped.release, "0.2.0");
  assert.equal(shipped.commit, "d72fdcea");
  assert.ok(shipped.note.length > 0);
  assert.deepEqual(shipped.ids, [...shipped.ids].sort(), "ids are sorted");
  assert.equal(new Set(shipped.ids).size, shipped.ids.length, "no duplicates");
  assert.ok(shipped.ids.every((id) => id.startsWith("@m0saic/")), "every id is a first-party template id");
});

test("real tree: every shipped web id is still registered on web", () => {
  const shipped = readShippedWebIds(PKG_ROOT);
  const current = readGeneratedWebIds(PKG_ROOT);
  assert.ok(current, `${GENERATED_WEB_IDS_FILE} is committed`);
  const r = checkShippedWebIds(shipped, current);
  assert.deepEqual(r.missing, [], `removed from src/web.ts after 0.2.0 shipped: ${r.missing.join(", ")}`);
  assert.equal(r.ok, true);
});

test("checkPinnedWebIds: a pinned web id must be in the snapshot AND on web; unpinned ids are free", () => {
  const pinned = ["@m0saic/a/v1", "@m0saic/b/v1"];
  assert.deepEqual(checkPinnedWebIds(pinned, ["@m0saic/a/v1", "@m0saic/b/v1", "@m0saic/new/v1"], ["@m0saic/b/v1", "@m0saic/a/v1", "@m0saic/new/v1"]),
    { ok: true, pinned: 2, notInSnapshot: [], notOnWeb: [] });
  // The re-mint bypass: b dropped from web.ts AND from the snapshot together.
  const r = checkPinnedWebIds(pinned, ["@m0saic/a/v1"], ["@m0saic/a/v1"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.notInSnapshot, ["@m0saic/b/v1"]);
  assert.deepEqual(r.notOnWeb, ["@m0saic/b/v1"]);
  // Still in the snapshot but gone from web.ts (Stage 0b's own check also fires).
  assert.deepEqual(checkPinnedWebIds(pinned, pinned, ["@m0saic/a/v1"]).notOnWeb, ["@m0saic/b/v1"]);
  // No pins (a pre-pin manifest) holds nothing.
  assert.deepEqual(checkPinnedWebIds([], [], []), { ok: true, pinned: 0, notInSnapshot: [], notOnWeb: [] });
});
