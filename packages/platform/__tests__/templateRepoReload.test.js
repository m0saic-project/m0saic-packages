/**
 * External template-repo RELOAD tests — the rebuild → "Refresh repos" loop
 * that lets a template author (or an agent) iterate against a running app.
 *
 * These run under `node --test`, not Jest, and against the BUILT package.
 * Both choices are load-bearing: the behavior under test is Node's real ESM
 * module cache, which has no eviction API. Jest's VM refuses a native dynamic
 * import outright, and any test that stubbed the importer would skip the
 * exact cache it's supposed to be proving. Jest keeps the pure-logic half in
 * `src/template-repos/loadTemplateRepoFromPath.test.ts`.
 *
 * Run with: node --test __tests__/templateRepoReload.test.js
 * (requires `npm run build:platform` first)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadTemplateRepoFromPath } = require("@m0saic/platform/template-repos");

/** Bump every file's mtime so the loader's build stamp changes. Explicit
 *  rather than sleeping — mtime granularity would make this flaky. */
function touchAll(dir, whenMs) {
  const when = new Date(whenMs);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) touchAll(p, whenMs);
    else fs.utimesSync(p, when, when);
  }
}

/**
 * A CommonJS repo — what `tsc` emits by default — whose ENTRY re-exports a
 * value from a SUB-MODULE. That shape is what exposes a partial reload:
 * busting only the entry's import URL leaves the sub-module stale.
 */
function writeCjsRepo(dir, marker) {
  const dist = path.join(dir, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "probe-repo", version: "1.0.0", main: "dist/index.js" }),
  );
  fs.writeFileSync(
    path.join(dist, "marker.js"),
    `module.exports.marker = ${JSON.stringify(marker)};\n`,
  );
  fs.writeFileSync(
    path.join(dist, "index.js"),
    [
      'const { marker } = require("./marker.js");',
      'exports.repo = { repoId: "probe@repo", displayName: "Probe Repo", schemaVersion: 1 };',
      "exports.templates = [{",
      '  id: "@probe/smoke/v1",',
      "  label: marker,",
      "  version: 1,",
      '  capabilities: { tier: "core" },',
      "  propsSchema: {},",
      "  defaultProps: {},",
      "  render: async () => ({}),",
      "}];",
      "",
    ].join("\n"),
  );
}

/**
 * A CommonJS repo whose entry is a BARREL: it imports from a child AND
 * `export *`s the same child. That is what `tsc` emits for the everyday
 *
 *     import { X } from "./x";
 *     export * from "./x";
 *
 * pattern, and it produces a SECOND `require("./x")` after the module body.
 * Re-importing that graph through a cache-busted `file://` URL makes Node's
 * ESM→CJS translation hand back an EMPTY exports object for the child, so
 * `templates` silently fills with `undefined`. The reload path routes CJS
 * entries through `require()` precisely to dodge this.
 */
function writeBarrelRepo(dir, marker) {
  const dist = path.join(dir, "dist");
  const childDir = path.join(dist, "thing", "v1");
  fs.mkdirSync(childDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "barrel-repo", version: "1.0.0", main: "dist/index.js" }),
  );
  fs.writeFileSync(
    path.join(childDir, "thing.js"),
    [
      'Object.defineProperty(exports, "__esModule", { value: true });',
      "exports.Thing = {",
      '  id: "@barrel/thing/v1",',
      `  label: ${JSON.stringify(marker)},`,
      "  version: 1,",
      '  capabilities: { tier: "core" },',
      "  propsSchema: {},",
      "  defaultProps: {},",
      "  render: async () => ({}),",
      "};",
      "exports.default = exports.Thing;",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dist, "index.js"),
    [
      "var __createBinding = function (o, m, k, k2) {",
      "  if (k2 === undefined) k2 = k;",
      "  var d = Object.getOwnPropertyDescriptor(m, k);",
      '  if (!d || ("get" in d ? !m.__esModule : d.writable || d.configurable)) {',
      "    d = { enumerable: true, get: function () { return m[k]; } };",
      "  }",
      "  Object.defineProperty(o, k2, d);",
      "};",
      "var __exportStar = function (m, exports) {",
      "  for (var p in m)",
      '    if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p))',
      "      __createBinding(exports, m, p);",
      "};",
      'Object.defineProperty(exports, "__esModule", { value: true });',
      "exports.templates = exports.repo = void 0;",
      'var thing_1 = require("./thing/v1/thing");',
      'exports.repo = { repoId: "@barrel", displayName: "Barrel Repo", schemaVersion: 1 };',
      "exports.templates = [thing_1.Thing];",
      // The second require — the whole point of this fixture.
      '__exportStar(require("./thing/v1/thing"), exports);',
      "",
    ].join("\n"),
  );
}

function writeEsmRepo(dir, marker) {
  const dist = path.join(dir, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(
    path.join(dist, "marker.mjs"),
    `export const marker = ${JSON.stringify(marker)};\n`,
  );
  fs.writeFileSync(
    path.join(dist, "index.mjs"),
    [
      'import { marker } from "./marker.mjs";',
      'export const repo = { repoId: "probe@esm", displayName: "Probe ESM", schemaVersion: 1 };',
      "export const templates = [{",
      '  id: "@probe/esm-smoke/v1",',
      "  label: marker,",
      "  version: 1,",
      '  capabilities: { tier: "core" },',
      "  propsSchema: {},",
      "  defaultProps: {},",
      "  render: async () => ({}),",
      "}];",
      "",
    ].join("\n"),
  );
}

/** Each test gets its own temp dir — a shared path would collide in the
 *  process-wide ESM cache and make results order-dependent. */
function withRepo(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `m0saic-repo-${name}-`));
  return Promise.resolve(fn(root)).finally(() =>
    fs.rmSync(root, { recursive: true, force: true }),
  );
}

test("loads a CommonJS repo's descriptor + templates", () =>
  withRepo("basic", async (dir) => {
    writeCjsRepo(dir, "V1");

    const res = await loadTemplateRepoFromPath(dir);

    assert.deepEqual(res.diagnostics.filter((d) => d.severity === "error"), []);
    assert.equal(res.repo.repoId, "probe@repo");
    assert.equal(res.repo.displayName, "Probe Repo");
    assert.equal(res.templates.length, 1);
    assert.equal(res.templates[0].label, "V1");
  }));

// The regression the `reload` option exists for. Node's ESM cache hands back
// the module it imported the FIRST time, forever — so without opting in, a
// long-running host silently serves the author's pre-rebuild code.
test("without reload, a rebuilt repo still serves STALE code", () =>
  withRepo("stale", async (dir) => {
    writeCjsRepo(dir, "V1");
    assert.equal((await loadTemplateRepoFromPath(dir)).templates[0].label, "V1");

    writeCjsRepo(dir, "V2");
    touchAll(dir, Date.now() + 10_000);

    const again = await loadTemplateRepoFromPath(dir);
    assert.equal(
      again.templates[0].label,
      "V1",
      "plain re-load is expected to be stale — this is why reload:true exists",
    );
  }));

test("reload:true picks up a rebuild, including SUB-MODULE changes", () =>
  withRepo("reload", async (dir) => {
    writeCjsRepo(dir, "V1");
    assert.equal((await loadTemplateRepoFromPath(dir)).templates[0].label, "V1");

    // ONLY marker.js changes — index.js is byte-identical. Busting the entry
    // URL alone would still report V1; the require.cache subtree evict is
    // what makes the sub-module re-read.
    fs.writeFileSync(
      path.join(dir, "dist", "marker.js"),
      'module.exports.marker = "V2";\n',
    );
    touchAll(dir, Date.now() + 10_000);

    const reloaded = await loadTemplateRepoFromPath(dir, { reload: true });
    assert.equal(reloaded.templates[0].label, "V2");
    assert.deepEqual(
      reloaded.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
  }));

// Regression: a barrel entry used to reload into `templates: [undefined]`.
// Silent, and it looks exactly like "my repo exported nothing".
test("reload:true handles a BARREL entry (import + export * of one child)", () =>
  withRepo("barrel", async (dir) => {
    writeBarrelRepo(dir, "V1");
    const first = await loadTemplateRepoFromPath(dir);
    assert.equal(first.templates.length, 1);
    assert.equal(first.templates[0].label, "V1");

    fs.writeFileSync(
      path.join(dir, "dist", "thing", "v1", "thing.js"),
      fs
        .readFileSync(path.join(dir, "dist", "thing", "v1", "thing.js"), "utf8")
        .replace('"V1"', '"V2"'),
    );
    touchAll(dir, Date.now() + 10_000);

    const reloaded = await loadTemplateRepoFromPath(dir, { reload: true });
    assert.deepEqual(
      reloaded.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    assert.equal(reloaded.templates.length, 1);
    assert.ok(reloaded.templates[0], "template slot must not be an undefined hole");
    assert.equal(reloaded.templates[0].label, "V2");
  }));

// Whatever the cause, an undefined slot must read as a repo-export problem —
// not blow up on `t.id` with a TypeError the author can't act on.
test("undefined entries in templates[] become an actionable diagnostic", () =>
  withRepo("holes", async (dir) => {
    const dist = path.join(dir, "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "holey", version: "1.0.0", main: "dist/index.js" }),
    );
    fs.writeFileSync(
      path.join(dist, "index.js"),
      [
        'exports.repo = { repoId: "@holey", displayName: "Holey", schemaVersion: 1 };',
        "exports.templates = [undefined, undefined];",
        "",
      ].join("\n"),
    );

    const res = await loadTemplateRepoFromPath(dir);

    assert.equal(res.templates.length, 0, "holes must be filtered out");
    const d = res.diagnostics.find(
      (x) => x.code === "TEMPLATE_REPO_INVALID_TEMPLATES",
    );
    assert.ok(d, "expected an INVALID_TEMPLATES diagnostic");
    assert.match(d.message, /undefined/);
    assert.match(d.message, /barrel/i);
  }));

test("reload:true is stable when nothing was rebuilt", () =>
  withRepo("norebuild", async (dir) => {
    writeCjsRepo(dir, "V1");

    await loadTemplateRepoFromPath(dir, { reload: true });
    const second = await loadTemplateRepoFromPath(dir, { reload: true });

    assert.equal(second.templates[0].label, "V1");
    assert.deepEqual(
      second.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
  }));

// True ESM can't be fully invalidated at any price. Say so out loud rather
// than letting the author debug a phantom.
test("reload:true warns that an ESM entry only reloads partially", () =>
  withRepo("esm", async (dir) => {
    writeEsmRepo(dir, "V1");

    const res = await loadTemplateRepoFromPath(dir, { reload: true });

    assert.equal(res.templates[0].label, "V1");
    const warn = res.diagnostics.find(
      (d) => d.code === "TEMPLATE_REPO_ESM_RELOAD_PARTIAL",
    );
    assert.ok(warn, "expected an ESM partial-reload warning");
    assert.equal(warn.severity, "warning");
    assert.match(warn.message, /CommonJS/);
  }));

test("no ESM warning when reload is off", () =>
  withRepo("esm-noreload", async (dir) => {
    writeEsmRepo(dir, "V1");

    const res = await loadTemplateRepoFromPath(dir);

    assert.equal(
      res.diagnostics.some(
        (d) => d.code === "TEMPLATE_REPO_ESM_RELOAD_PARTIAL",
      ),
      false,
    );
  }));

/* ── Host-first @m0saic/* resolution (the full loader path, real import) ── */

/** A CJS repo whose entry `require`s the substrate, with a PLANTED
 *  `@m0saic/template-utils` at `plantDir` that drops a marker if evaluated. */
function writePlantedRepo(dir, plantDir) {
  const marker = path.join(dir, "PLANT-WAS-EVALUATED");
  const plantPkg = path.join(plantDir, "@m0saic", "template-utils");
  fs.mkdirSync(plantPkg, { recursive: true });
  fs.writeFileSync(
    path.join(plantPkg, "index.js"),
    `require("fs").writeFileSync(${JSON.stringify(marker)}, "evaluated");\nthrow new Error("planted module evaluated");\n`,
  );
  fs.writeFileSync(path.join(plantPkg, "package.json"), '{"name":"@m0saic/template-utils","main":"index.js"}');
  const dist = path.join(dir, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "planted-repo", main: "dist/index.js" }));
  fs.writeFileSync(
    path.join(dist, "index.js"),
    [
      'const { defineMosaicTemplate } = require("@m0saic/template-utils");',
      'const { asTemplateId } = require("@m0saic/types");',
      'exports.repo = { repoId: "planted@repo", displayName: "Planted", schemaVersion: 1 };',
      "exports.templates = [defineMosaicTemplate({",
      '  id: asTemplateId("@planted/smoke/v1"),',
      '  label: require.resolve("@m0saic/template-utils"),',
      '  description: "probe", tags: ["probe"],',
      "  version: 1,",
      '  capabilities: { tier: "core" },',
      "  propsSchema: {},",
      "  defaultProps: {},",
      "  render: async () => ({}),",
      "})];",
      // Lazy, render-time style require — must ALSO go host-first.
      'exports.templates[0].probeLazy = () => require.resolve("@m0saic/types");',
      "",
    ].join("\n"),
  );
  return marker;
}

const HOST_PACKAGES = fs.realpathSync(path.resolve(__dirname, "..", ".."));
// The host-first tests below need the REAL sibling packages (`template-utils`,
// `types`) next to this one. A standalone checkout that has not synced them yet
// (the public mirror, mid-increment) skips them rather than failing.
const HOST_HAS_SIBLINGS = ["template-utils", "types"].every((d) => fs.existsSync(path.join(HOST_PACKAGES, d)));
const HOST_TEST_OPTS = HOST_HAS_SIBLINGS ? {} : { skip: "host checkout has no template-utils/types sibling yet" };

test("a planted <checkout>/node_modules/@m0saic/template-utils is never evaluated through the real loader", HOST_TEST_OPTS, () =>
  withRepo("planted", async (dir) => {
    const marker = writePlantedRepo(dir, path.join(dir, "node_modules"));

    const res = await loadTemplateRepoFromPath(dir);

    assert.deepEqual(res.diagnostics.filter((d) => d.severity === "error"), []);
    assert.equal(fs.existsSync(marker), false, "the planted module must not run");
    const resolvedTo = fs.realpathSync(res.templates[0].label);
    assert.ok(resolvedTo.startsWith(path.join(HOST_PACKAGES, "template-utils") + path.sep), resolvedTo);
    const lazy = res.templates[0].probeLazy();
    assert.ok(fs.realpathSync(lazy).startsWith(path.join(HOST_PACKAGES, "types") + path.sep), lazy);
    assert.equal(fs.existsSync(marker), false);
  }));

test("a plant under dist/node_modules loses the same way, and a symlinked checkout path still counts as the root", HOST_TEST_OPTS, () =>
  withRepo("planted-dist", async (dir) => {
    const real = path.join(dir, "real");
    fs.mkdirSync(real);
    const marker = writePlantedRepo(real, path.join(real, "dist", "node_modules"));
    const link = path.join(dir, "link");
    fs.symlinkSync(real, link, "dir");

    const res = await loadTemplateRepoFromPath(link);

    assert.deepEqual(res.diagnostics.filter((d) => d.severity === "error"), []);
    assert.equal(fs.existsSync(marker), false);
  }));

test("a clone OUTSIDE the workspace (no node_modules on the walk) still loads — the host supplies @m0saic/*", HOST_TEST_OPTS, () =>
  withRepo("orphan", async (dir) => {
    // No plant, no node_modules at all: under os.tmpdir() there is nothing
    // to walk up to, so before host-first resolution this was
    // "Cannot find module '@m0saic/template-utils'".
    writeCjsRepo(dir, "V1");
    fs.writeFileSync(
      path.join(dir, "dist", "index.js"),
      [
        'const { defineMosaicTemplate } = require("@m0saic/template-utils");',
        'exports.repo = { repoId: "orphan@repo", displayName: "Orphan", schemaVersion: 1 };',
        'exports.templates = [defineMosaicTemplate({ id: "@orphan/smoke/v1", label: "ok", description: "probe", tags: ["probe"], version: 1, capabilities: { tier: "core" }, propsSchema: {}, defaultProps: {}, render: async () => ({}) })];',
        "",
      ].join("\n"),
    );
    assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);

    const res = await loadTemplateRepoFromPath(dir);

    assert.deepEqual(res.diagnostics.filter((d) => d.severity === "error"), []);
    assert.equal(res.templates[0].label, "ok");
  }));
