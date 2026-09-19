#!/usr/bin/env node
/**
 * render-pack — Render a template pack (batch of variants) to .mosaic files.
 *
 * USAGE:
 *   node packages/template-utils/tools/dev/render-pack.mjs <pack.json>
 *
 * EXAMPLES:
 *   node packages/template-utils/tools/dev/render-pack.mjs \
 *     packages/template-utils/tools/dev/packs/chart-frame.pack.json
 *
 * Pack JSON shape:
 *   {
 *     "templateId": "@m0saic/hero/bar-graph/internal/chart-frame/v1",
 *     "defaults": { "propsPath", "injectPath", "wrap", "width", "height", "fps", "durationMs" },
 *     "variants": [{ "name", "props"? }, ...]
 *   }
 *
 * Output goes to: tools/dev/out/<packName>/
 */

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve, basename, dirname } from "node:path";

const require = createRequire(import.meta.url);

// ---- Parse args ----
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error("Usage: render-pack <pack.json>");
  process.exit(1);
}

const packPath = resolve(args[0]);

// ---- Import template modules for side-effect registration ----
try {
  require("@m0saic/templates");
} catch (e) {
  console.error("Failed to import @m0saic/templates — ensure it is built:");
  console.error("  npm run build:changed");
  console.error(String(e.message));
  process.exit(1);
}

// ---- Import the pack helper ----
const { renderTemplatePackToMosaicFiles } = require("@m0saic/template-utils");

// ---- Load pack definition ----
let pack;
try {
  const raw = await readFile(packPath, "utf8");
  pack = JSON.parse(raw);
} catch (e) {
  console.error(`Failed to read pack from ${packPath}: ${e.message}`);
  process.exit(1);
}

// ---- Build variants with defaults merged ----
const packName = basename(packPath, ".pack.json");
const outDir = resolve(dirname(packPath), "..", "out", packName);

const variants = pack.variants.map((v) => ({
  ...v,
  propsPath: pack.defaults.propsPath,
  injectPath: pack.defaults.injectPath,
}));

// ---- Render ----
try {
  const result = await renderTemplatePackToMosaicFiles(pack.templateId, variants, {
    outDir,
    width: pack.defaults.width,
    height: pack.defaults.height,
    fps: pack.defaults.fps,
    durationMs: pack.defaults.durationMs,
    wrap: pack.defaults.wrap,
    warnOnMissingRefs: true,
  });

  console.log(`Pack "${packName}" rendered ${result.variants.length} variants to ${result.outDir}/`);
  for (const v of result.variants) {
    console.log(`  ${v.name}.mosaic`);
  }
} catch (e) {
  console.error(`Pack render failed: ${e.message}`);
  process.exit(1);
}
