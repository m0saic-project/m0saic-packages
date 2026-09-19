/**
 * Generate web-template-ids.json — the template ids the BROWSER entry registers.
 *
 * Usage:  node dist/gen-web-template-ids.js   (a FRESH process — see below)
 *
 * The browser entry (`./web`) registers the curated node-clean subset of the
 * library, and that subset is exactly what Mosaic Web can open: the web
 * receiver of a `/make?t=…` link classifies by membership in its registry
 * listing. The registry is process-global, so the only faithful way to read
 * "what web registers" is to import `./web` in a process that has NOT loaded
 * the node entry — this script, run on its own by the package build.
 *
 * Consumers read the file through `isWebTemplateId` / `listWebTemplateIds`
 * (`./webTemplateIds`) — the CLI uses it to decide whether the Mosaic Web
 * customize link is worth printing after a render.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { listRegisteredTemplateIds } from "./web";
import { WEB_TEMPLATE_IDS_FILE } from "./webTemplateIds";

const ROOT = path.resolve(__dirname, "..");

const ids = listRegisteredTemplateIds()
  .map(String)
  .sort();

if (ids.length === 0) {
  throw new Error("gen-web-template-ids: the browser entry registered no templates");
}

const outPath = path.join(ROOT, WEB_TEMPLATE_IDS_FILE);
fs.writeFileSync(
  outPath,
  JSON.stringify({ schemaVersion: 1, entryModule: "./dist/web.js", ids }, null, 2) + "\n",
  "utf8",
);
console.log(`Wrote ${outPath} (${ids.length} template ids)`);
