/**
 * The official pack's catalog — `template-catalog.json` (0.3.1).
 *
 * The template convention since 0.3.1: a template FILE is immutable once it
 * ships (comments only — the agent contract §10). What describes it without
 * changing what it renders — label, description, tags, platforms, channels,
 * preview, internal, primitive, deprecated — lives in the catalog, because it
 * may change after the template ships: a shipped `vN` is superseded, re-tagged
 * or hidden here, never by editing its file (the `npm deprecate` model). Every
 * repo keeps the same file beside its `template-manifest.json`
 * (`MosaicTemplateCatalogFile` in `@m0saic/types`).
 *
 * AUTHORED beside each template's code: `<name>.catalog.json` in the template's
 * own folder (one per template, naming it by `templateId`; the freeze hashes
 * code, never this, so it stays editable after the code freezes). GENERATED
 * from those by `tools/gen-template-catalog.mjs` (first build step) into
 * `src/template-catalog.json` — imported here, so both entries (`./index` for
 * node, `./web` for the browser bundle) carry it under `rootDir: src` — and
 * the wire copy `template-catalog.json` beside `template-manifest.json`.
 *
 * IMPORTING THIS MODULE DECLARES THE CATALOG — both entries import it FIRST, so
 * every template registers with its entry applied (catalog-first) before the
 * definition-time conventions judge it. Templates shipped before 0.3.1 keep the
 * fields their files declare; an entry here overrides them. New templates
 * declare none (`catalogSidecar`). A deprecation that has shipped is permanent
 * (the freeze mint records it; check-registry Stage 0d holds it).
 */
import { parseTemplateCatalogFile } from "@m0saic/platform";
import { declareTemplateCatalog, declareTemplateConventions } from "@m0saic/template-utils";
import { TEMPLATE_REPO } from "./repo";
import catalogJson from "./template-catalog.json";

export { TEMPLATE_CATALOG_FILE } from "@m0saic/platform";

const parsed = parseTemplateCatalogFile(catalogJson);

/** This pack's catalog, parsed (malformed fields dropped — see the problems). */
export const TEMPLATE_CATALOG = parsed.file;

/** What is wrong with the catalog as authored — the build gate fails on any (check-registry Stage 0d). */
export const TEMPLATE_CATALOG_PROBLEMS: readonly string[] = parsed.problems;

declareTemplateCatalog(TEMPLATE_CATALOG.templates);
// …and the pack's conventions target (`TEMPLATE_REPO.conventions`, 0.3.1).
declareTemplateConventions(TEMPLATE_REPO.conventions);
