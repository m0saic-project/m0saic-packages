#!/usr/bin/env node
/**
 * Build-time registry gate (founder rulings 2026-09-05 + 2026-09-06).
 *
 * Stage 1 — load the freshly built registry FIRST-PARTY so every template
 * passes through `defineMosaicTemplate`, the seam that enforces the
 * DEFINITION-TIME conventions (defaultProps, colorProps, noLocalPaths,
 * browseSurface, propLabels). A throw-posture violation throws here, naming
 * the template, the knobs, and the fix — the build fails before the template
 * can load in Mosaic Desktop or the CLI. Record-posture violations print as
 * warnings.
 *
 * Stage 2 — render every template at its `defaultProps` on its hinted canvas
 * and audit the RENDER-TIME conventions (rendersAtDefaults, bindingsSound,
 * bindingsCover, svgGlyphCoverage, safeMinimumCanvas, canvasEnvelope,
 * deterministic, textFits, costBudget, latticeSmooth) via
 * `auditRenderedTemplate`. Capability-tier templates and templates whose
 * required inputs have no default are skipped, not failed.
 *
 * Stage 0 (freeze), 0b (shipped web ids) and 0c (registry pins) run before
 * any of that — see each block. 0c needs the loaded registry, so it sits
 * right after the registry load and before Stage 1.
 *
 * The manifest generator deliberately reads only the curated metadata list,
 * so without this step a build could pass with a template the app refuses at
 * boot. Plan: `.ai/proposed-plans/template-conventions-v1.md`.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { checkPinnedWebIds, checkShippedWebIds, readGeneratedWebIds, readShippedWebIds, GENERATED_WEB_IDS_FILE, SHIPPED_WEB_IDS_FILE } from "./shipped-web-ids.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// No template may re-invoke a CLI from inside a gate (benchmark runners are
// capability-tier and skipped anyway; this is belt and braces).
process.env.M0SAIC_CLI ??= "/usr/bin/false";

// `--sweep`: also render every template on the standard canvases (1080p
// landscape / portrait / square) for the `canvasEnvelope` rule. Off by
// default — a build gate renders once; the sweep is a few times the cost.
const SWEEP = process.argv.includes("--sweep");
// `--json`: one machine-readable report on stdout (every finding with its
// convention, severity, keys, details and the fix), no human log lines —
// for agents looping on their own errors. Exit code is unchanged.
const JSON_OUT = process.argv.includes("--json");
// `--update-fingerprints`: (re)write layout-fingerprints/*.fingerprint from
// the current flattened layouts instead of comparing against them. Commit
// the result: the diff IS the review of a layout change.
const UPDATE_FP = process.argv.includes("--update-fingerprints");
// `--update-freeze`: re-mint frozen.manifest.json from the current tree. This
// is the DELIBERATE act performed at a release, never the fix for a failing
// gate — a frozen template that needs to change gets a new vN+1 folder.
const UPDATE_FREEZE = process.argv.includes("--update-freeze");
// Fingerprints are SIDECARS: `<srcRoot>/<pack>/<slug>/vN/<slug>.layout.m0`
// next to the template source; a template whose id has no source folder
// falls back to `layout-fingerprints/<key>.m0`.
const FP_OPTS = { srcRoot: 'src/m0saic' };
const log0 = console.log.bind(console);
const warn0 = console.warn.bind(console);
const err0 = console.error.bind(console);
const say = (...a) => { if (!JSON_OUT) log0(...a); };
const warn = (...a) => { if (!JSON_OUT) warn0(...a); };
const fail = (...a) => { if (!JSON_OUT) err0(...a); };
const report = { ok: true, mode: SWEEP ? "sweep" : "gate", templates: 0, rendered: 0, skipped: [], errors: [], warnings: [], notes: [], fingerprints: { srcRoot: FP_OPTS.srcRoot, fallbackDir: "layout-fingerprints", minted: 0, unchanged: 0, missing: 0, changed: 0 } };
const toJson = (f) => ({ templateId: f.templateId, convention: f.convention, severity: f.severity, violations: f.violations, fix: templateUtils.TEMPLATE_CONVENTION_FIX?.[f.convention] ?? null });
const finish = (code) => {
  if (JSON_OUT) { report.ok = code === 0; process.stdout.write(JSON.stringify(report, null, 2) + "\n"); }
  process.exit(code);
};

// ── Stage 0: the freeze gate ───────────────────────────────────────────────
// Runs FIRST and fails fast: it is pure filesystem + hashing, so a violation
// costs nothing to find, and there is no point rendering 94 templates to tell
// someone they edited a frozen one. Contract: `.ai/CLAUDE.md` §10.
{
  const freeze = require("../dist/freeze.js");
  if (UPDATE_FREEZE) {
    const { execFileSync } = require("node:child_process");
    const git = (...a) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "unknown"; } };
    // Pins need the live registry: load it here (definition-time conventions
    // fire on load — a release mint should not bless a template that throws).
    let live;
    try { live = liveRegistrations(freeze); }
    catch (err) {
      fail(`\n[check-registry] \u2717 the built registry refused to load, so nothing was minted:\n\n${err && err.message ? err.message : err}\n`);
      fail("[check-registry] Fix the template above, rebuild, then mint again.");
      finish(1);
    }
    // The web pins need the generated id list AND the browser entry's own
    // registrations. Both come from the build; minting without them would
    // bless a manifest with zero `web: true` pins that every later gate then
    // waves through — so a missing file FAILS the mint, never warns.
    const webIds = readGeneratedWebIds(ROOT);
    if (!webIds) {
      fail(`\n[check-registry] \u2717 ${GENERATED_WEB_IDS_FILE} IS MISSING \u2014 a release mint pins which ids are on web, and cannot without it.`);
      fail(`    Run the FULL package build first (tsc + generators), then mint again.\n`);
      finish(1);
    }
    const webLive = webLiveRegistrations();
    // A release re-mint keeps the previous manifest's `note` and its
    // "(pending)" tag wording while the release tag does not exist yet — the
    // post-tag re-mint is the moment `git describe` starts answering
    // `v<release>`, and only then do tag/commit/note move (the runbook's
    // "only tag/commit/note may change" check).
    const release = require("../package.json").version;
    const previous = freeze.readFreezeManifest(ROOT);
    const described = git("describe", "--tags", "--abbrev=0");
    const tag = described === `v${release}` ? described : `v${release} (pending \u2014 the tag lands at npm publish; hashes bind from this commit)`;
    const note = previous && previous.release === release && typeof previous.note === "string" && previous.note
      ? previous.note
      : "Frozen at release. Comments only; any behavioural change needs a new vN+1 folder. See .ai/CLAUDE.md \u00a710.";
    let minted;
    try { minted = freeze.mintFreezeManifest(ROOT, { release, tag, commit: git("rev-parse", "HEAD"), note }, { live, webIds, webLive }); }
    catch (err) {
      fail(`\n[check-registry] \u2717 ${err && err.message ? err.message : err}\n`);
      finish(1);
    }
    fs.writeFileSync(path.join(ROOT, freeze.FREEZE_MANIFEST_FILE), JSON.stringify(minted, null, 2) + "\n");
    const webDiverged = Object.values(minted.registry).filter((p) => p.webFile !== undefined).length;
    say(`[check-registry] \u270e freeze manifest minted (hash v${minted.hashVersion}): ${Object.keys(minted.files).length} files, ${live.length} registry pins (${webIds.length} on web, ${webDiverged} with a distinct web-side definition) at ${minted.tag} (${minted.commit.slice(0, 7)}) \u2192 ${freeze.FREEZE_MANIFEST_FILE} (commit it).`);
    // Minting is a standalone act — don't drag the 94-template render sweep
    // behind it. Run the gate normally afterwards to verify.
    finish(0);
  } else {
    const manifest = freeze.readFreezeManifest(ROOT);
    if (!manifest) {
      // FATAL, not a warning (founder ruling 2026-09-09). The manifest is
      // committed, so the only ways to reach this are deleting it or a
      // corrupted checkout — and a freeze you can switch off by removing one
      // file is not a freeze. An absent manifest means the gate cannot answer
      // the question it exists to answer, which is a failure, not a pass.
      report.ok = false;
      report.freeze = { state: "absent" };
      fail(`\n[check-registry] \u2717 ${freeze.FREEZE_MANIFEST_FILE} IS MISSING \u2014 the freeze gate cannot run.\n`);
      fail(`    It is a committed file. Restore it:  git checkout -- packages/templates/${freeze.FREEZE_MANIFEST_FILE}`);
      fail(`\n[check-registry] Do NOT re-mint to clear this error \u2014 that would bless whatever the tree`);
      fail(`[check-registry] currently holds as "what shipped". Minting (--update-freeze) belongs to a RELEASE.\n`);
      finish(1);
    } else {
      const r = freeze.checkFreeze(ROOT, manifest);
      report.freeze = {
        release: manifest.release, hashVersion: freeze.manifestHashVersion(manifest), checkerHashVersion: freeze.FREEZE_HASH_VERSION,
        unchanged: r.unchanged.length, changed: r.changed.length,
        deleted: r.deleted.length, unfrozen: r.unfrozen.length, lowConfidence: r.lowConfidence.length,
        changedFiles: r.changed, deletedFiles: r.deleted,
      };
      if (r.hashVersionMismatch) {
        // Loud and specific: the hashes are incomparable, so nothing else is
        // reported — a wall of "changed" would send someone hunting through
        // 343 untouched files. Only a release re-mint clears this.
        report.ok = false;
        report.freeze.state = "hash-version-mismatch";
        report.freeze.message = r.hashVersionMismatch.message;
        fail(`\n[check-registry] \u2717 FREEZE MANIFEST HASH VERSION MISMATCH \u2014 ${r.hashVersionMismatch.message}\n`);
        fail(`[check-registry] The frozen files were NOT compared (their hashes cannot be). Nothing in the tree is known to have changed \u2014 and nothing is known to be unchanged either.`);
        fail(`[check-registry] Founder only, at a release: node tools/check-registry.mjs --update-freeze, then commit the manifest with --no-verify (the hook refuses re-mints on purpose).\n`);
        finish(1);
      }
      if (!r.ok) {
        report.ok = false;
        fail(`\n[check-registry] \u2717 FROZEN TEMPLATE MODIFIED \u2014 ${manifest.release} shipped these; someone holds their output.\n`);
        for (const f of r.changed) fail(`    changed  ${f}`);
        for (const f of r.deleted) fail(`    DELETED  ${f}  (removing shipped behaviour)`);
        fail(`\n[check-registry] Comments are the ONLY permitted edit to a frozen file.`);
        fail(`[check-registry] To change behaviour, copy the template into a NEW vN+1/ folder and change that.`);
        fail(`[check-registry] Shared helpers are frozen too \u2014 copy the helper into the new version's folder rather than editing it in place.`);
        fail(`[check-registry] (If you are minting a NEW release: node tools/check-registry.mjs --update-freeze)\n`);
        finish(1);
      }
      say(`[check-registry] \u2713 freeze (${manifest.release}): ${r.unchanged.length} frozen files unchanged, ${r.unfrozen.length} not yet frozen (new work).`);
      if (r.lowConfidence.length) warn(`[check-registry] \u26a0 ${r.lowConfidence.length} file(s) could not be tokenised confidently and are hashed RAW (comment edits will trip the gate): ${r.lowConfidence.join(", ")}`);
    }
  }
}

// \u2500\u2500 Stage 0b: shipped web ids (additive-only lock on src/web.ts) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// `web-template-ids.json` ships in the CLI tarball and the CLI prints
// `app.m0saic.io/make?t=<id>` for exactly those ids \u2014 so an id removed from
// `src/web.ts` after a release is a dead link in every installed CLI.
// `src/web-template-ids.frozen.json` is the list as it shipped (under `src/`
// so the tarball can never carry it); every id in it must still be registered
// on web. Re-minted only at a CLI release, never to clear this error.
// Pure filesystem like Stage 0, so it runs before the registry loads.
{
  const shipped = readShippedWebIds(ROOT);
  if (!shipped) {
    report.shippedWebIds = { state: "absent" };
    say(`[check-registry] \u2139 no ${SHIPPED_WEB_IDS_FILE} \u2014 shipped web ids not locked (mint one at the next CLI release).`);
  } else {
    const current = readGeneratedWebIds(ROOT);
    if (!current) {
      // Same posture as a missing freeze manifest: the gate cannot answer.
      report.ok = false;
      report.shippedWebIds = { state: "unverifiable", release: shipped.release, shipped: shipped.ids.length };
      fail(`\n[check-registry] \u2717 ${GENERATED_WEB_IDS_FILE} IS MISSING \u2014 the shipped web ids gate cannot run.`);
      fail(`    The build writes it:  node dist/gen-web-template-ids.js  (then re-run this gate).\n`);
      finish(1);
    }
    const w = checkShippedWebIds(shipped, current);
    report.shippedWebIds = { state: w.ok ? "ok" : "removed", release: w.release, commit: w.commit, shipped: w.shipped, registered: w.registered, missing: w.missing, added: w.added };
    if (!w.ok) {
      report.ok = false;
      fail(`\n[check-registry] \u2717 SHIPPED WEB ID REMOVED \u2014 the m0saic@${w.release} CLI prints app.m0saic.io/make?t=<id> for these; removing one makes every installed CLI print a dead link.\n`);
      for (const id of w.missing) fail(`    missing  ${id}`);
      fail(`\n[check-registry] Rule: never remove an id from src/web.ts that the shipped ${GENERATED_WEB_IDS_FILE} lists (${SHIPPED_WEB_IDS_FILE}).`);
      fail(`[check-registry] Ids are additive-only until the next CLI release re-mints the snapshot. Restore the import(s) in src/web.ts and rebuild.`);
      fail(`[check-registry] Do NOT edit ${SHIPPED_WEB_IDS_FILE} to clear this error \u2014 the installed CLI does not know you did.\n`);
      finish(1);
    }
    say(`[check-registry] \u2713 shipped web ids (${w.release}): ${w.registered}/${w.shipped} still registered on web` + (w.added.length ? ` (+${w.added.length} added since \u2014 the ${w.release} CLI does not advertise them yet)` : "") + `.`);

    // Cross-check against the freeze manifest's registry pins: a re-minted
    // snapshot that lost an id passes the check above (the snapshot no longer
    // lists it) — but the manifest still pins it as on-web, and the manifest
    // cannot be re-minted without the pre-commit hook refusing.
    const freeze = require("../dist/freeze.js");
    const manifest = freeze.readFreezeManifest(ROOT);
    const pinnedWeb = manifest ? freeze.pinnedWebIds(manifest) : [];
    const x = checkPinnedWebIds(pinnedWeb, shipped.ids, current);
    report.shippedWebIds.pinnedWeb = { pinned: x.pinned, notInSnapshot: x.notInSnapshot, notOnWeb: x.notOnWeb };
    if (!x.ok) {
      report.ok = false;
      report.shippedWebIds.state = "pinned-web-id-lost";
      fail(`\n[check-registry] \u2717 PINNED WEB ID LOST \u2014 ${freeze.FREEZE_MANIFEST_FILE} pins these ids as on Mosaic Web at the ${manifest.release} mint, and the shipped CLI links to them:\n`);
      for (const id of x.notInSnapshot) fail(`    dropped from ${SHIPPED_WEB_IDS_FILE}  ${id}`);
      for (const id of x.notOnWeb) fail(`    no longer registered by src/web.ts    ${id}`);
      fail(`\n[check-registry] Restore the id in src/web.ts (and the snapshot) and rebuild. A re-minted snapshot cannot drop a pinned id \u2014 that needs the manifest re-minted at a release.\n`);
      finish(1);
    }
    if (x.pinned) say(`[check-registry] \u2713 pinned web ids: ${x.pinned}/${x.pinned} still in the snapshot and on web.`);
  }
}

/**
 * Every live registration as the freeze pins it: id, registering SOURCE file
 * (dist module mapped back to src), and the definition hash. Loads the
 * registry (side effect: registerTemplate for every template).
 */
function liveRegistrations(freeze) {
  require("../dist/index.js");
  const tu = require("@m0saic/template-utils");
  return tu.listRegisteredTemplateIds().map(String).map((id) => {
    const meta = typeof tu.getTemplateMeta === "function" ? tu.getTemplateMeta(id) : undefined;
    const from = meta?.registeredFrom;
    return freeze.liveRegistrationOf(id, from ? freeze.registeringSourcePath(ROOT, from) : "(unknown)", tu.getTemplate(id));
  });
}

/**
 * Every live registration of the BROWSER entry (`dist/web.js`), gathered in a
 * FRESH child process — the registry is process-global and this process has
 * (or will have) loaded the node entry, so the web registry cannot be read in
 * here (same reason `dist/gen-web-template-ids.js` runs on its own).
 * Throws when the child fails: a web registry that cannot be read is a gate
 * that cannot answer, never a pass.
 */
function webLiveRegistrations() {
  const { execFileSync } = require("node:child_process");
  const out = execFileSync(process.execPath, [path.join(ROOT, "tools", "web-live-registrations.mjs")], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("web-live-registrations.mjs: the browser entry registered no templates");
  return parsed;
}

let templateUtils;
try {
  require("../dist/index.js"); // side effect: registerTemplate() for every template
  templateUtils = require("@m0saic/template-utils");
  // The filesystem half of layout fingerprints lives in the node-only entry
  // (the root barrel is walked by the web bundle and must stay free of node:fs).
  templateUtils = { ...templateUtils, ...require("@m0saic/template-utils/dist/dev/index.js") };
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  fail(`\n[check-registry] ✗ the built registry refused to load:\n\n${message}\n`);
  fail("[check-registry] Fix the template above, then rebuild. (packages/templates/tools/check-registry.mjs)");
  finish(1);
}

const ids = templateUtils.listRegisteredTemplateIds().map(String);

// ── Stage 0c: registry pins ────────────────────────────────────────────────
// The file hashes (Stage 0) cannot see a NEW, unfrozen file registering a
// shipped id, or a pack barrel repointed at a different registering module
// while the original stays byte-identical. The manifest pins, per shipped id,
// the registering source file and a hash of the definition fields that decide
// shipped behaviour (freeze.ts DEFINITION_PIN_FIELDS) plus the canonical text
// of its compiled render / renderLite / renderCover / resolveOutputHints (RENDER_PIN_FIELDS — a
// registered template is deep-frozen, and this is how a render body that
// changed under an unchanged file hash shows up); the live registry must
// still match. Ids registered now but not pinned are new work — free.
{
  const freeze = require("../dist/freeze.js");
  const manifest = freeze.readFreezeManifest(ROOT);
  const live = ids.map((id) => {
    const from = templateUtils.getTemplateMeta?.(id)?.registeredFrom;
    return freeze.liveRegistrationOf(id, from ? freeze.registeringSourcePath(ROOT, from) : "(unknown)", templateUtils.getTemplate(id));
  });
  const p = freeze.checkRegistryPins(manifest ?? {}, live);
  report.registryPins = { state: p.ok ? (p.pinned ? "ok" : "unpinned") : "violated", pinned: p.pinned, held: p.held.length, unpinned: p.unpinned.length, missing: p.missing, moved: p.moved, redefined: p.redefined };
  if (!p.ok) {
    report.ok = false;
    fail(`\n[check-registry] \u2717 SHIPPED TEMPLATE RE-REGISTERED \u2014 ${manifest.release} pinned how each shipped id registers; the live registry disagrees:\n`);
    for (const m of p.missing) fail(`    missing    ${m.id}  (was registered by ${m.file}; not registered now \u2014 removing shipped behaviour)`);
    for (const m of p.moved) fail(`    moved      ${m.id}  pinned ${m.pinnedFile} \u2192 now ${m.file}  (a different file registers the shipped id)`);
    for (const m of p.redefined) fail(m.reason === "render body"
      ? `    redefined  ${m.id}  ${m.file}  (render body \u2014 the compiled text of ${freeze.RENDER_PIN_FIELDS.join(" / ")} moved while the definition fields held; the pin is over compiled output, so a build-chain change that alters emitted code needs a re-mint at a release)`
      : `    redefined  ${m.id}  ${m.file}  (defaultProps / propsSchema / outputHints / flags changed \u2014 fields: ${freeze.DEFINITION_PIN_FIELDS.join(", ")})`);
    fail(`\n[check-registry] A shipped id has exactly one registering file and one definition. New behaviour is a NEW id (vN+1) in a new folder; the old id keeps registering from the file that shipped it.`);
    fail(`[check-registry] Do NOT re-mint to clear this \u2014 minting belongs to a release (and the pre-commit hook refuses a manifest whose pins moved).\n`);
    finish(1);
  }
  if (p.pinned) say(`[check-registry] \u2713 registry pins (${manifest.release}): ${p.held.length}/${p.pinned} shipped ids register from their pinned file with their pinned definition` + (p.unpinned.length ? ` (${p.unpinned.length} not yet pinned \u2014 new work)` : "") + `.`);
  else say(`[check-registry] \u2139 no registry pins in ${freeze.FREEZE_MANIFEST_FILE} (minted before pins) \u2014 ${ids.length} ids unpinned; the next release mint pins them.`);

  // Every pinned registering file must itself be hashed: a pin over unhashed
  // code holds the definition but not the code it runs. The frozen set is the
  // import closure of every vN/ and _shared/ file, so this can only fail when
  // a mint predates the closure rule or the manifest was hand-edited.
  if (p.pinned && typeof freeze.unfrozenPinFiles === "function") {
    const unfrozen = freeze.unfrozenPinFiles(manifest);
    report.registryPins.unfrozenPinFiles = unfrozen;
    if (unfrozen.length) {
      report.ok = false;
      report.registryPins.state = "pin-file-unfrozen";
      fail(`\n[check-registry] \u2717 PINNED REGISTERING FILE NOT FROZEN \u2014 ${unfrozen.length} pin(s) name a file ${freeze.FREEZE_MANIFEST_FILE} does not hash:\n`);
      for (const u of unfrozen) fail(`    ${u.id}  \u2190 ${u.file}`);
      fail(`\n[check-registry] A pin over unhashed code is not a lock. The frozen set is the relative-import closure of every vN/ and _shared/ file; a registering module outside it means the manifest predates that rule or was edited by hand. Re-mint at a release.\n`);
      finish(1);
    }
  }

  // The WEB half: the browser entry builds its registry through different
  // import paths (src/web.ts \u2192 pack barrels / cherry-picked slugs / one
  // .web.ts stand-in), so a `web: true` pin is ALSO held against what
  // dist/web.js registers \u2014 in a fresh process. Otherwise a new unfrozen
  // file could register a shipped id on web with different defaults while
  // node stays pinned and green, and every /make?t= link the shipped CLI
  // prints would render something else.
  if (p.pinned && typeof freeze.webRegistryPins === "function") {
    const webPins = freeze.webRegistryPins(manifest);
    const webPinned = Object.keys(webPins.registry ?? {}).length;
    if (webPinned) {
      let webLive;
      try { webLive = webLiveRegistrations(); }
      catch (err) {
        report.ok = false;
        report.registryPins.web = { state: "unverifiable", message: err && err.message ? err.message : String(err) };
        fail(`\n[check-registry] \u2717 the browser entry (dist/web.js) could not be loaded to verify the web-side pins:\n\n${err && err.message ? err.message : err}\n`);
        finish(1);
      }
      const w = freeze.checkRegistryPins(webPins, webLive);
      report.registryPins.web = { state: w.ok ? "ok" : "violated", pinned: w.pinned, held: w.held.length, unpinned: w.unpinned.length, missing: w.missing, moved: w.moved, redefined: w.redefined };
      if (!w.ok) {
        report.ok = false;
        report.registryPins.state = "violated";
        fail(`\n[check-registry] \u2717 SHIPPED WEB TEMPLATE RE-REGISTERED ON WEB \u2014 ${manifest.release} pinned how each web id registers in the BROWSER entry (src/web.ts); dist/web.js disagrees:\n`);
        for (const m of w.missing) fail(`    missing    ${m.id}  (web entry no longer registers it \u2014 was ${m.file})`);
        for (const m of w.moved) fail(`    moved      ${m.id}  pinned ${m.pinnedFile} \u2192 now ${m.file}  (a different file registers the shipped id on web)`);
        for (const m of w.redefined) fail(`    redefined  ${m.id}  ${m.file}  (${m.reason === "render body" ? "render body moved on web while the definition fields held" : "defaultProps / propsSchema / outputHints / flags differ on web"})`);
        fail(`\n[check-registry] The web registry must resolve every shipped id to the same file and definition it shipped with (or the .web.ts stand-in the mint recorded). Restore the import path in src/web.ts / the pack barrel; new behaviour is a NEW id.\n`);
        finish(1);
      }
      say(`[check-registry] \u2713 web registry pins (${manifest.release}): ${w.held.length}/${w.pinned} shipped web ids register in dist/web.js from their pinned file with their pinned definition` + (w.unpinned.length ? ` (${w.unpinned.length} on web since \u2014 new work)` : "") + `.`);
    }
  }
}

// ── Repo level: the front door (hello-world convention, 2026-09-14) ────────
// `repo.helloWorld` names the template a newcomer renders first — the
// canonical card via defineHelloWorldTemplate, or the pack's own. Record
// posture: the finding rides the same log Stage 1 prints, keyed by the repo
// id. Core exports TEMPLATE_REPO; an external repo exports `repo`.
{
  const entry = require("../dist/index.js");
  const repo = entry.TEMPLATE_REPO ?? entry.repo ?? null;
  const violations = typeof templateUtils.auditRepoFrontDoor === "function" ? templateUtils.auditRepoFrontDoor(repo, ids) : [];
  if (violations.length) {
    templateUtils.recordTemplateConventionFinding(
      templateUtils.makeTemplateConventionFinding(String(repo?.repoId ?? "(repo)"), "repoFrontDoor", violations, false),
    );
  }
}
const printFindings = (label, findings) => {
  for (const f of findings) {
    fail(`  ${label} ${f.templateId} — ${f.convention}: ${f.violations.map((v) => v.key).join(", ")}`);
    for (const v of f.violations.slice(0, 4)) fail(`      ${v.detail}`);
    if (f.violations.length > 4) fail(`      …+${f.violations.length - 4} more`);
  }
};

report.templates = typeof ids !== "undefined" ? ids.length : (typeof count !== "undefined" ? count : 0);
// ── Deprecated templates: advice OFF, immutability ON ──────────────────────
// A deprecated template is defunct by definition — it stays registered for
// back-compat and as a good-vs-bad reference, but nobody is going to act on
// convention advice about it, so nagging forever is pure noise. The fix for a
// non-conforming shipped template is a vN+1, which deprecates the old one and
// SILENCES IT AUTOMATICALLY. Mirrors the CLI e2e sweep's existing flag
// (`M0SAIC_INCLUDE_DEPRECATED=1`, documented in
// .ai/knowledge/templates/reference/template-flags.md).
//
// ⭐ THIS SUPPRESSES ADVICE ONLY. The freeze gate (Stage 0) and layout
// fingerprints (Stage 3) still cover deprecated templates in full — deprecation
// means "stop suggesting improvements", never "this may now change". A shipped
// template is frozen whether or not it is deprecated; arguably more so.
const INCLUDE_DEPRECATED = /^(1|true|yes)$/i.test(process.env.M0SAIC_INCLUDE_DEPRECATED || "");
const DEPRECATED = new Set();
for (const id of ids) {
  try { if (templateUtils.getTemplate(id)?.deprecated) DEPRECATED.add(String(id)); } catch { /* unreadable → treat as live */ }
}
const suppressed = { definition: 0, render: 0 };
const isMuted = (templateId) => !INCLUDE_DEPRECATED && DEPRECATED.has(String(templateId));

// ── Stage 1: definition time ───────────────────────────────────────────────
const recordedAll = templateUtils.listTemplateConventionFindings().filter((f) => !f.external);
const recorded = recordedAll.filter((f) => {
  if (!isMuted(f.templateId)) return true;
  suppressed.definition++;
  return false;
});
const errors1 = recorded.filter((f) => f.severity === "error");
report.errors.push(...errors1.map(toJson));
const warnings1 = recorded.filter((f) => f.severity === "warning");
report.warnings.push(...warnings1.map(toJson));
if (ids.length === 0 || errors1.length > 0) {
  fail(`[check-registry] ✗ ${ids.length} templates registered, ${errors1.length} first-party convention error(s) recorded.`);
  printFindings("✗", errors1);
  finish(1);
}
const warnedKnobs = warnings1.reduce((n, f) => n + f.violations.length, 0);
say(`[check-registry] ✓ ${ids.length} templates registered — definition-time conventions hold` +
  (warnings1.length ? ` (${warnings1.length} template(s) carry ${warnedKnobs} warning knob(s): ${[...new Set(warnings1.map((f) => f.convention))].join(", ")})` : "") + ".");

// ── Stage 2: render time ───────────────────────────────────────────────────
/** Set by scripts/sync-public-packages.mjs (and the public repo's CI): the tree
 *  is a standalone mirror without the monorepo's fixture dirs. */
const STANDALONE_CHECKOUT = process.env.M0SAIC_STANDALONE_CHECKOUT === "1";
const errors2 = [];
const warnings2 = [];
const skipped = report.skipped; // same array — `--json` used to print skipped: [] because this was a detached local
const layouts = [];
const bitmapDeclared = [];
let rendered = 0;
for (const id of ids) {
  const template = templateUtils.getTemplate(id);
  const audit = await templateUtils.auditRenderedTemplate(template, SWEEP ? { sweepCanvases: templateUtils.STANDARD_SWEEP_CANVASES } : {});
  if (audit.skipped) {
    skipped.push(`${id}: ${audit.skipped}`);
    continue;
  }
  rendered++;
  report.rendered = rendered;
  if (audit.layout) layouts.push({ id: audit.templateId, layout: audit.layout });
  for (const f of audit.findings) {
    if (isMuted(f.templateId ?? id)) { suppressed.render++; continue; }
    // A standalone checkout (the public m0saic-packages mirror, its CI) has no
    // monorepo fixtures: a template whose DEFAULTS read one (post-mortem/v1
    // renders packages/sandbox/sessions) cannot render there. That is an
    // absent input, not a convention break — record it as a skip. The monorepo
    // build never sets this and still holds every template to the render.
    if (STANDALONE_CHECKOUT && f.convention === "rendersAtDefaults" && f.violations.some((v) => /ENOENT/.test(v.detail))) {
      skipped.push(`${id}: rendersAtDefaults — fixture absent in a standalone checkout (M0SAIC_STANDALONE_CHECKOUT=1)`);
      say(`  ℹ ${id}: defaults read a monorepo fixture that this checkout does not carry — render skipped (M0SAIC_STANDALONE_CHECKOUT=1)`);
      continue;
    }
    (f.severity === "error" ? errors2 : warnings2).push(f); (f.severity === "error" ? report.errors : report.warnings).push(toJson(f));
  }
  for (const note of audit.notes) report.notes.push({ templateId: audit.templateId, note });
  // Notes are INFORMATION, not findings (a rule that could not run, a declared
  // exemption honoured). Print them with ℹ, and fold the one-per-template
  // "skipped — bitmap" declarations into a single line below.
  for (const note of audit.notes) {
    if (/^latticeSmooth: skipped — lattice.mode/.test(note)) { bitmapDeclared.push(id); continue; }
    say(`  ℹ ${id}: ${note}`);
  }
}
if (bitmapDeclared.length) say(`[check-registry] ℹ latticeSmooth: ${bitmapDeclared.length} template(s) declare lattice.mode "bitmap" (baked rasters, never live-composed) and are not held to the lattice: ${bitmapDeclared.join(", ")}`);
if (warnings2.length) {
  warn(`[check-registry] ⚠ ${warnings2.length} render-time warning(s) (record posture — fix when you touch the template):`);
  printFindings("⚠", warnings2);
}
// ── Stage 3: layout fingerprints ───────────────────────────────────────────
// The flattened layout at the hinted canvas, committed per template as a
// native `.m0` sidecar next to its source (`# size:` = the canvas, `# title:`
// = the id). A change is a build ERROR until re-minted with
// --update-fingerprints — so an edit to a shared helper shows its blast
// radius as a diff, not a surprise.
for (const { id, layout } of layouts) {
  if (UPDATE_FP) {
    if (templateUtils.writeLayoutFingerprint(ROOT, id, layout, FP_OPTS) > 0) report.fingerprints.minted++; else report.fingerprints.unchanged++;
    continue;
  }
  const result = templateUtils.checkLayoutFingerprint(ROOT, id, layout, false, FP_OPTS);
  if (result === "missing") {
    report.fingerprints.missing++;
    const where = templateUtils.layoutFingerprintLocation(ROOT, id, FP_OPTS);
    const f = { templateId: id, convention: "layoutFingerprint", severity: "warning", violations: [{ key: "missing", detail: `no committed fingerprint at ${path.relative(ROOT, path.join(where.dir, templateUtils.layoutFingerprintFileName(where.base)))} — run \`node tools/check-registry.mjs --update-fingerprints\` and commit it.` }] };
    warnings2.push(f); report.warnings.push(toJson(f));
  } else if (result) {
    report.fingerprints.changed++; errors2.push(result); report.errors.push(toJson(result));
  } else {
    report.fingerprints.unchanged++;
  }
}
if (UPDATE_FP) say(`[check-registry] ✎ layout fingerprints: ${report.fingerprints.minted} written, ${report.fingerprints.unchanged} unchanged → <template folder>/<slug>.layout.m0 (commit them).`);
else say(`[check-registry] ✓ layout fingerprints: ${report.fingerprints.unchanged} unchanged, ${report.fingerprints.missing} missing, ${report.fingerprints.changed} changed.`);

if (errors2.length) {
  fail(`[check-registry] ✗ ${errors2.length} render-time convention error(s):`);
  printFindings("✗", errors2);
  fail("[check-registry] Fix the template(s) above, then rebuild. (packages/templates/tools/check-registry.mjs)");
  finish(1);
}
const mutedTotal = suppressed.definition + suppressed.render;
report.deprecated = { count: DEPRECATED.size, included: INCLUDE_DEPRECATED, suppressedFindings: mutedTotal };
if (mutedTotal > 0) {
  say(`[check-registry] \u2139 ${mutedTotal} finding(s) on ${DEPRECATED.size} deprecated template(s) suppressed (advice only \u2014 freeze + fingerprints still apply). M0SAIC_INCLUDE_DEPRECATED=1 to see them.`);
} else if (DEPRECATED.size && INCLUDE_DEPRECATED) {
  say(`[check-registry] \u2139 ${DEPRECATED.size} deprecated template(s) INCLUDED in convention checks (M0SAIC_INCLUDE_DEPRECATED=1).`);
}
if (SWEEP) say(`[check-registry] (sweep) each template was also rendered on ${templateUtils.STANDARD_SWEEP_CANVASES.length} standard canvases for the canvasEnvelope rule.`);
say(`[check-registry] ✓ ${rendered} templates rendered at their defaults — render-time conventions hold (${skipped.length} skipped: capability tier / inputs required).`);
finish(0);
