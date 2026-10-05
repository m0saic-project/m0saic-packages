/**
 * Gather a repo's catalog SIDECARS into its wire catalog (0.3.1).
 *
 * Authors keep each template's catalog in `<name>.catalog.json` beside the
 * template's module (label, tags, deprecation, prop copy — what may change
 * after the code ships). The repo's build calls this to produce
 * `template-catalog.json` at the repo root, beside `template-manifest.json` —
 * the one file hosts read. Node-only (it walks the source tree).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { MosaicTemplateCatalogFile } from "@m0saic/types";
import {
  TEMPLATE_CATALOG_FILE,
  TEMPLATE_CATALOG_SIDECAR_SUFFIX,
  parseTemplateCatalogSidecar,
} from "../templateCatalog/templateCatalog";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);

export type CollectedTemplateCatalog = {
  /** The wire catalog: every sidecar's entry, keyed by its template id, ids sorted. */
  file: MosaicTemplateCatalogFile;
  /** Each sidecar found (repo-relative POSIX path) and the id it names. */
  sidecars: Array<{ path: string; templateId: string }>;
  /** Everything wrong: parse problems, a sidecar naming no id, two sidecars naming one. */
  problems: string[];
};

/**
 * Walk `<repoRoot>/<srcDir>` (default `src`) for `*.catalog.json` sidecars and
 * gather them. Never throws on a bad sidecar — it is reported, and a repo's
 * build gate turns `problems` into errors.
 */
export function collectTemplateCatalog(repoRoot: string, opts: { srcDir?: string } = {}): CollectedTemplateCatalog {
  const srcRoot = path.join(repoRoot, opts.srcDir ?? "src");
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); continue; }
      if (e.isFile() && e.name.endsWith(TEMPLATE_CATALOG_SIDECAR_SUFFIX)) found.push(path.join(dir, e.name));
    }
  };
  walk(srcRoot);
  found.sort();

  const problems: string[] = [];
  const sidecars: CollectedTemplateCatalog["sidecars"] = [];
  const byId = new Map<string, { rel: string; entry: MosaicTemplateCatalogFile["templates"][string] }>();
  for (const abs of found) {
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(abs, "utf8")); }
    catch (err) {
      problems.push(`${rel}: not valid JSON (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const parsed = parseTemplateCatalogSidecar(raw, rel);
    problems.push(...parsed.problems.map((p) => (p.startsWith(rel) ? p : `${rel}: ${p}`)));
    if (!parsed.templateId) continue;
    const prior = byId.get(parsed.templateId);
    if (prior) {
      problems.push(`${rel}: ${parsed.templateId} is already described by ${prior.rel} — one sidecar per template`);
      continue;
    }
    byId.set(parsed.templateId, { rel, entry: parsed.entry });
    sidecars.push({ path: rel, templateId: parsed.templateId });
  }
  const templates: MosaicTemplateCatalogFile["templates"] = {};
  for (const id of [...byId.keys()].sort()) templates[id] = byId.get(id)!.entry;
  return { file: { schemaVersion: 1, templates }, sidecars, problems };
}

/** The wire catalog's canonical text (ids sorted, 2-space JSON, trailing newline). */
export function serializeTemplateCatalog(file: MosaicTemplateCatalogFile): string {
  const templates: MosaicTemplateCatalogFile["templates"] = {};
  for (const id of Object.keys(file.templates).sort()) templates[id] = file.templates[id]!;
  return JSON.stringify({ schemaVersion: 1, templates }, null, 2) + "\n";
}

/** Write `template-catalog.json` at the repo root. Returns its path. */
export function writeTemplateCatalog(repoRoot: string, file: MosaicTemplateCatalogFile): string {
  const out = path.join(repoRoot, TEMPLATE_CATALOG_FILE);
  fs.writeFileSync(out, serializeTemplateCatalog(file), "utf8");
  return out;
}
