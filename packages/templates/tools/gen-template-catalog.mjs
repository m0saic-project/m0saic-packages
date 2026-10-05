#!/usr/bin/env node
/**
 * Gather the pack's catalog SIDECARS into its catalog (0.3.1) — runs FIRST in
 * `npm run build`, before tsc.
 *
 * Each template's catalog lives beside its code: `<name>.catalog.json` in the
 * template's own folder (label, tags, deprecation, prop copy — what may change
 * after the code ships; the freeze hashes code, never this). This writes:
 *   src/template-catalog.json   imported by ./catalog (both entries) — GENERATED
 *   template-catalog.json       the wire copy beside template-manifest.json
 * Never hand-edit either; check-registry Stage 0d refuses a stale one.
 *
 * Run:  node packages/templates/tools/gen-template-catalog.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { collectTemplateCatalog, serializeTemplateCatalog } = require("@m0saic/platform/template-repos");

const collected = collectTemplateCatalog(ROOT, { srcDir: "src/m0saic" });
if (collected.problems.length) {
  console.error(`[gen-template-catalog] ✗ ${collected.problems.length} problem(s) in the catalog sidecars:`);
  for (const p of collected.problems) console.error(`    ${p}`);
  process.exit(1);
}
const text = serializeTemplateCatalog(collected.file);
fs.writeFileSync(path.join(ROOT, "src", "template-catalog.json"), text, "utf8");
fs.writeFileSync(path.join(ROOT, "template-catalog.json"), text, "utf8");
console.log(`[gen-template-catalog] wrote src/template-catalog.json + template-catalog.json (${collected.sidecars.length} sidecar(s))`);
