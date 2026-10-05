/**
 * The declared template catalogs (0.3.1), process-global like the registry.
 *
 * A repo declares its catalog (`declareTemplateCatalog`, in templateRegistry)
 * before its templates are defined; `defineMosaicTemplate` and
 * `registerTemplate` both apply the entry for a template's id — catalog-first,
 * before the definition-time conventions judge it. An entry binds to the
 * ORIGIN that declared it, so an external repo can never restyle, hide or
 * deprecate a template another origin defines. Its own module so both seams
 * can read it without importing each other.
 */
import type { MosaicTemplateCatalogEntry } from "@m0saic/types";
import { processRegistry } from "../processRegistry";
import type { TemplateOrigin } from "./templateOriginScope";

/** id → the catalog entry declared for it, and the origin that declared it. */
export const templateCatalogEntries = processRegistry<string, { entry: MosaicTemplateCatalogEntry; origin: string }>(
  "templateCatalogEntries",
);

/** A stable key for an origin: catalog entries bind to the origin that declared them. */
export function templateOriginKey(origin: TemplateOrigin): string {
  return origin.kind === "external" ? `external:${origin.source}` : "first-party";
}

/** origin → the conventions target that origin's repo declared (`repo.conventions`, 0.3.1). */
export const templateConventionTargets = processRegistry<string, string>("templateConventionTargets");

/** The conventions target `origin` declared — undefined when it declared none. */
export function declaredConventionsTarget(origin: TemplateOrigin): string | undefined {
  return templateConventionTargets.get(templateOriginKey(origin));
}

/** The entry declared for `id` BY `origin` — undefined when none, or when another origin declared it. */
export function declaredCatalogEntry(id: string, origin: TemplateOrigin): MosaicTemplateCatalogEntry | undefined {
  const declared = templateCatalogEntries.get(id);
  return declared && declared.origin === templateOriginKey(origin) ? declared.entry : undefined;
}
