/**
 * External template-repo CATALOG — `template-catalog.json` beside
 * `template-manifest.json` (0.3.1). What describes a template without changing
 * what it renders (label, tags, visibility, deprecation, …) lives there, never
 * inside a frozen template; the loader merges it, catalog-first, into the
 * templates it returns, so every host registers templates that already carry it.
 *
 * `node --test` against the BUILT package, like templateRepoReload.test.js:
 * a real load imports the repo's entry, which Jest's VM refuses. The parser
 * and the merge have Jest tests beside them in src/templateCatalog/.
 *
 * Run with: node --test __tests__/templateRepoCatalog.test.js
 * (requires `npm run build:platform` first)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadTemplateRepoFromPath } = require("@m0saic/platform/template-repos");
const { authoredCatalogFields } = require("@m0saic/platform");

/** A CommonJS repo exporting v1 (as shipped: label + tags in the file) and v2
 *  (the 0.3.1 way: nothing descriptive in the file), plus an optional catalog. */
function tmpRepo(catalog) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-catalog-"));
  const dist = path.join(dir, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "catalog-repo", version: "1.0.0", main: "dist/index.js" }));
  const tpl = (id, extra) => `{ id: ${JSON.stringify(id)}, version: 1, capabilities: { tier: "core" }, propsSchema: {}, defaultProps: {}, ${extra} render: async () => ({}) }`;
  fs.writeFileSync(
    path.join(dist, "index.js"),
    [
      'exports.repo = { repoId: "@probe", displayName: "Probe Repo", schemaVersion: 1 };',
      "exports.templates = [",
      `  ${tpl("@probe/cards/quote/v1", 'label: "Quote v1", tags: ["old"],')},`,
      `  ${tpl("@probe/cards/quote/v2", "")},`,
      "];",
      "",
    ].join("\n"),
  );
  if (catalog !== undefined) {
    fs.writeFileSync(path.join(dir, "template-catalog.json"), typeof catalog === "string" ? catalog : JSON.stringify(catalog));
  }
  return dir;
}

const DEP = { reason: "v2 binds every prop", replacement: "@probe/cards/quote/v2", since: "2026-09-29" };
const byId = (res) => Object.fromEntries(res.templates.map((t) => [t.id, t]));
const catalogDiags = (res) => res.diagnostics.filter((d) => /CATALOG/.test(d.code));

test("merges the catalog, catalog-first: v1 is superseded and re-tagged, v2 gets its label from the catalog", async () => {
  const dir = tmpRepo({
    schemaVersion: 1,
    templates: {
      "@probe/cards/quote/v1": { tags: ["social", "legacy"], deprecated: DEP },
      "@probe/cards/quote/v2": { label: "Quote Card", description: "Pull quote.", tags: ["social"] },
    },
  });
  try {
    const res = await loadTemplateRepoFromPath(dir);
    const t = byId(res);
    assert.deepEqual(t["@probe/cards/quote/v1"].deprecated, DEP);
    assert.deepEqual(t["@probe/cards/quote/v1"].tags, ["social", "legacy"]);
    assert.equal(t["@probe/cards/quote/v1"].label, "Quote v1");
    assert.equal(t["@probe/cards/quote/v2"].label, "Quote Card");
    // The template still answers for its FILE (what a freeze pins and the catalogSidecar rule reads).
    assert.deepEqual(authoredCatalogFields(t["@probe/cards/quote/v1"]), { label: "Quote v1", tags: ["old"] });
    assert.deepEqual(authoredCatalogFields(t["@probe/cards/quote/v2"]), {});
    assert.deepEqual(res.catalog.applied, ["@probe/cards/quote/v1", "@probe/cards/quote/v2"]);
    assert.equal(res.catalog.path, path.join(dir, "template-catalog.json"));
    assert.equal(catalogDiags(res).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no catalog: templates load exactly as exported, no catalog report", async () => {
  const dir = tmpRepo();
  try {
    const res = await loadTemplateRepoFromPath(dir);
    assert.equal(byId(res)["@probe/cards/quote/v1"].label, "Quote v1");
    assert.equal(byId(res)["@probe/cards/quote/v2"].label, undefined);
    assert.equal(res.catalog, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown id, a non-catalog key and a malformed field are warnings, never errors", async () => {
  const dir = tmpRepo({
    schemaVersion: 1,
    templates: { "@probe/cards/gone/v1": { tags: ["x"] }, "@probe/cards/quote/v2": { defaultProps: { a: 1 }, tags: "social" } },
  });
  try {
    const res = await loadTemplateRepoFromPath(dir);
    const codes = res.diagnostics.map((d) => `${d.severity}:${d.code}`);
    assert.ok(codes.includes("warning:TEMPLATE_REPO_CATALOG_UNKNOWN_ID"), codes.join());
    assert.ok(codes.includes("warning:TEMPLATE_REPO_CATALOG_INVALID"), codes.join());
    assert.ok(!res.diagnostics.some((d) => d.severity === "error" && /CATALOG/.test(d.code)));
    assert.deepEqual(byId(res)["@probe/cards/quote/v2"].defaultProps, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unparseable catalog is a warning and the repo still loads", async () => {
  const dir = tmpRepo("{ not json");
  try {
    const res = await loadTemplateRepoFromPath(dir);
    assert.ok(res.diagnostics.some((d) => d.code === "TEMPLATE_REPO_CATALOG_INVALID" && d.severity === "warning"));
    assert.equal(res.templates.length, 2);
    assert.equal(res.catalog, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
