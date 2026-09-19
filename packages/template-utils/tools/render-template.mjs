#!/usr/bin/env node
/**
 * render-template — CLI tool for the dev authoring loop.
 *
 * Renders any registered template to a .mosaic JSON file, which can then
 * be rendered with the normal m0saic CLI (`m0saic make <file.mosaic>`).
 *
 * USAGE:
 *   node packages/template-utils/tools/render-template.mjs <templateId> <props.json> <out.mosaic> [--wrap]
 *
 * EXAMPLES:
 *   # Render the ChartFrame harness to a .mosaic file:
 *   node packages/template-utils/tools/render-template.mjs \
 *     "@m0saic/dev/bar-graph/chart-frame-harness/v1" \
 *     packages/template-utils/tools/chart-frame-props.json \
 *     .scratch/chart-frame.mosaic \
 *     --wrap
 *
 *   # Then render to video with the CLI:
 *   m0saic make .scratch/chart-frame.mosaic -o .scratch/chart-frame.mp4
 *
 * FLAGS:
 *   --wrap          Wrap output in a 2-row layout with a title bar (debugging).
 *   --width=N       Override output width (pixels).
 *   --height=N      Override output height (pixels).
 *   --fps=N         Override output FPS.
 *   --durationMs=N  Override output duration (ms).
 *   --inject=FILE.json  Dev-only: inject children map into the rendered doc.
 *                       Useful for previewing internal component templates that
 *                       reference children by ref (local-only resolution).
 */

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

// ---- Parse args ----
const args = process.argv.slice(2);
const positional = [];
const flags = {};

for (const arg of args) {
  if (arg.startsWith("--")) {
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      flags[arg.slice(2)] = true;
    }
  } else {
    positional.push(arg);
  }
}

if (positional.length < 3) {
  console.error("Usage: render-template <templateId> <props.json> <out.mosaic> [--wrap]");
  process.exit(1);
}

const [templateId, propsPath, outPath] = positional;

// ---- Import template modules for side-effect registration ----
// This triggers registerTemplate() calls for all templates.
try {
  require("@m0saic/templates");
} catch (e) {
  console.error("Failed to import @m0saic/templates — ensure it is built:");
  console.error(`  npm run build:changed`);
  console.error(String(e.message));
  process.exit(1);
}

// ---- Import the render helper ----
const { renderTemplateToMosaicFile } = require("@m0saic/template-utils");

// ---- Read props ----
let props;
try {
  const raw = await readFile(resolve(propsPath), "utf8");
  props = JSON.parse(raw);
} catch (e) {
  console.error(`Failed to read props from ${propsPath}: ${e.message}`);
  process.exit(1);
}

// ---- Read injectChildren (optional) ----
let injectChildren;
if (typeof flags.inject === "string") {
  try {
    const raw = await readFile(resolve(flags.inject), "utf8");
    injectChildren = JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to read injectChildren from ${flags.inject}: ${e.message}`);
    process.exit(1);
  }
}

// ---- Build opts ----
const opts = {
  outPath: resolve(outPath),
  wrap: flags.wrap === true,
  width: flags.width ? Number(flags.width) : undefined,
  height: flags.height ? Number(flags.height) : undefined,
  fps: flags.fps ? Number(flags.fps) : undefined,
  durationMs: flags.durationMs ? Number(flags.durationMs) : undefined,
  wrapTitle: typeof flags.wrapTitle === "string" ? flags.wrapTitle : undefined,

  // ✅ new
  injectChildren,
  warnOnMissingRefs: true,
};

// ---- Render ----
try {
  const result = await renderTemplateToMosaicFile(templateId, props, opts);
  console.log(`Wrote: ${result.outPath}`);
} catch (e) {
  console.error(`Render failed: ${e.message}`);
  process.exit(1);
}
