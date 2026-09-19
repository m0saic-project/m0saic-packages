#!/usr/bin/env node
/**
 * Live registrations of the BROWSER entry (`dist/web.js`), printed as JSON —
 * one `LiveRegistration` (id, registering source file, definition hashes) per
 * id, sorted by id.
 *
 * Run in a FRESH process, never imported: the template registry is
 * process-global, so the only faithful way to read "what web registers" is to
 * load `dist/web.js` in a process that has NOT loaded the node entry — the
 * same reason `dist/gen-web-template-ids.js` runs on its own. check-registry
 * spawns this for the web half of Stage 0c (and `--update-freeze` for the
 * `webFile` / `webDefinitionSha256` pins).
 *
 * Run:  node packages/templates/tools/web-live-registrations.mjs
 */
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same belt-and-braces as check-registry: no template may re-invoke a CLI.
process.env.M0SAIC_CLI ??= "/usr/bin/false";

const freeze = require("../dist/freeze.js");
require("../dist/web.js"); // side effect: registerTemplate() for every web template
const tu = require("@m0saic/template-utils");

const live = tu.listRegisteredTemplateIds().map(String).sort().map((id) => {
  const from = typeof tu.getTemplateMeta === "function" ? tu.getTemplateMeta(id)?.registeredFrom : undefined;
  return freeze.liveRegistrationOf(id, from ? freeze.registeringSourcePath(ROOT, from) : "(unknown)", tu.getTemplate(id));
});
process.stdout.write(JSON.stringify(live));
