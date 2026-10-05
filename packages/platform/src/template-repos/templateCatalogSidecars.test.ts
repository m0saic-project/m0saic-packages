import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { collectTemplateCatalog, serializeTemplateCatalog, writeTemplateCatalog } from "./templateCatalogSidecars";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-catalog-sidecars-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const put = (rel: string, value: unknown): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof value === "string" ? value : JSON.stringify(value));
};

describe("collectTemplateCatalog — sidecars beside the code become the wire catalog", () => {
  it("gathers every <name>.catalog.json under src, keyed by the id it names, ids sorted", () => {
    put("src/cards/quote/v2/quote.catalog.json", { schemaVersion: 1, templateId: "@acme/cards/quote/v2", label: "Quote", tags: ["social"] });
    put("src/cards/quote/v1/quote.catalog.json", { schemaVersion: 1, templateId: "@acme/cards/quote/v1", deprecated: { reason: "v2", replacement: "@acme/cards/quote/v2", since: "2026-09-29" } });
    put("src/cards/quote/v2/fixture.json", { not: "a sidecar" });
    put("node_modules/x/src/y.catalog.json", { schemaVersion: 1, templateId: "@evil/x/v1" });
    const c = collectTemplateCatalog(root);
    expect(c.problems).toEqual([]);
    expect(Object.keys(c.file.templates)).toEqual(["@acme/cards/quote/v1", "@acme/cards/quote/v2"]);
    expect(c.file.templates["@acme/cards/quote/v2"]).toEqual({ label: "Quote", tags: ["social"] });
    expect(c.sidecars).toEqual([
      { path: "src/cards/quote/v1/quote.catalog.json", templateId: "@acme/cards/quote/v1" },
      { path: "src/cards/quote/v2/quote.catalog.json", templateId: "@acme/cards/quote/v2" },
    ]);
  });

  it("reports bad JSON, a sidecar naming no id, and two sidecars naming one id", () => {
    put("src/a/v1/a.catalog.json", "{ nope");
    put("src/b/v1/b.catalog.json", { schemaVersion: 1, label: "B" });
    put("src/c/v1/c.catalog.json", { schemaVersion: 1, templateId: "@acme/c/v1" });
    put("src/c/v1/c2.catalog.json", { schemaVersion: 1, templateId: "@acme/c/v1" });
    const c = collectTemplateCatalog(root);
    expect(c.problems.join("\n")).toMatch(/a\.catalog\.json: not valid JSON/);
    expect(c.problems.join("\n")).toMatch(/b\.catalog\.json.*templateId/);
    expect(c.problems.join("\n")).toMatch(/already described by src\/c\/v1\/c\.catalog\.json/);
    expect(Object.keys(c.file.templates)).toEqual(["@acme/c/v1"]);
  });

  it("writes the canonical wire file at the repo root", () => {
    put("src/q/v1/q.catalog.json", { schemaVersion: 1, templateId: "@acme/q/v1", tags: ["x"] });
    const out = writeTemplateCatalog(root, collectTemplateCatalog(root).file);
    expect(out).toBe(path.join(root, "template-catalog.json"));
    expect(fs.readFileSync(out, "utf8")).toBe(serializeTemplateCatalog({ schemaVersion: 1, templates: { "@acme/q/v1": { tags: ["x"] } } }));
    expect(fs.readFileSync(out, "utf8").endsWith("}\n")).toBe(true);
  });
});
