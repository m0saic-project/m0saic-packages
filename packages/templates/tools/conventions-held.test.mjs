/**
 * Tests for conventions-held.mjs — the list of templates that deliberately
 * stay at their shipped conventions line.
 *
 * Run with: node --test packages/templates/tools/conventions-held.test.mjs
 * No build prerequisite: the checks use in-memory fixtures; the "real tree"
 * test reads the committed list straight from the package root.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONVENTIONS_HELD_FILE, checkConventionsHeld, readConventionsHeld } from "./conventions-held.mjs";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A tree where `live` is registered and behind on real rules; everything else is as flagged. */
function tree(over = {}) {
  const t = {
    registered: new Set(["live", "old", "inner", "current", "described"]),
    deprecated: new Set(["old"]),
    internal: new Set(["inner"]),
    behind: { live: ["bindingsDeclared", "canvasFill", "catalogSidecar"], old: ["bindingsDeclared"], inner: ["bindingsDeclared"], described: ["catalogSidecar"] },
    ...over,
  };
  return {
    registered: (id) => t.registered.has(id),
    deprecated: (id) => t.deprecated.has(id),
    internal: (id) => t.internal.has(id),
    behindOn: (id) => t.behind[id] ?? [],
  };
}

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-conventions-held-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const writeList = (dir, body) => {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, CONVENTIONS_HELD_FILE), typeof body === "string" ? body : JSON.stringify(body));
};

test("a live template behind on a code rule, with a reason, holds", () => {
  const r = checkConventionsHeld({ live: "one job, one door" }, tree());
  assert.deepEqual(r, { ok: true, ids: ["live"], problems: [] });
});

test("an empty list holds nothing and is fine", () => {
  assert.deepEqual(checkConventionsHeld({}, tree()), { ok: true, ids: [], problems: [] });
});

test("an entry with no reason is refused", () => {
  for (const reason of ["", "   ", undefined, 3]) {
    const r = checkConventionsHeld({ live: reason }, tree());
    assert.equal(r.ok, false);
    assert.deepEqual(r.ids, []);
    assert.match(r.problems[0], /^live: no reason/);
  }
});

test("a stale entry is refused, each for its own reason", () => {
  const cases = [
    ["gone", /not a registered template/],
    ["old", /is deprecated/],
    ["inner", /is internal/],
    ["current", /no longer behind on any convention/],
    ["described", /catalogSidecar alone/],
  ];
  for (const [id, why] of cases) {
    const r = checkConventionsHeld({ [id]: "a reason" }, tree());
    assert.equal(r.ok, false, id);
    assert.deepEqual(r.ids, [], id);
    assert.equal(r.problems.length, 1, id);
    assert.match(r.problems[0], why, id);
    assert.ok(r.problems[0].startsWith(`${id}: `), id);
  }
});

test("good and stale entries are judged independently, in id order", () => {
  const r = checkConventionsHeld({ old: "x", live: "y", gone: "z" }, tree());
  assert.equal(r.ok, false);
  assert.deepEqual(r.ids, ["live"]);
  assert.deepEqual(r.problems.map((p) => p.split(":")[0]), ["gone", "old"]);
});

test("a held template that catches up stops holding (the entry must go)", () => {
  const before = checkConventionsHeld({ live: "y" }, tree());
  assert.equal(before.ok, true);
  const after = checkConventionsHeld({ live: "y" }, tree({ behind: {} }));
  assert.equal(after.ok, false);
  assert.match(after.problems[0], /no longer behind/);
});

test("readConventionsHeld: absent file = nothing held", () => {
  withTmpDir((dir) => assert.deepEqual(readConventionsHeld(dir), {}));
});

test("readConventionsHeld: reads the held map", () => {
  withTmpDir((dir) => {
    writeList(dir, { schemaVersion: 1, held: { a: "why" } });
    assert.deepEqual(readConventionsHeld(dir), { a: "why" });
  });
});

test("readConventionsHeld: a malformed file throws instead of holding nothing", () => {
  for (const body of [{}, { held: [] }, { held: "x" }, "null"]) {
    withTmpDir((dir) => {
      writeList(dir, body);
      assert.throws(() => readConventionsHeld(dir), /expected \{ schemaVersion, held/);
    });
  }
  withTmpDir((dir) => {
    writeList(dir, "{not json");
    assert.throws(() => readConventionsHeld(dir));
  });
});

test("real tree: the committed list parses and every entry carries a reason", () => {
  const held = readConventionsHeld(PKG_ROOT);
  for (const [id, reason] of Object.entries(held)) {
    assert.match(id, /^@[a-z0-9-]+\//, id);
    assert.ok(typeof reason === "string" && reason.trim().length > 20, `${id}: a real reason`);
  }
});

test("the list lives under src/ so it can never reach the tarball", () => {
  assert.ok(CONVENTIONS_HELD_FILE.startsWith("src/"));
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
  assert.ok(!pkg.files.some((f) => f === "src" || f.startsWith("src/")));
});
