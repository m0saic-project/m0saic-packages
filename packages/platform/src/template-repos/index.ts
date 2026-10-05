export {
  loadTemplateRepoFromPath,
  resolveTemplateRepoEntry,
} from "./loadTemplateRepoFromPath";

export type {
  LoadedTemplateRepo,
  ResolvedEntry,
  TemplateRepoSelection,
} from "./loadTemplateRepoFromPath";

export { TEMPLATE_REPO_DEP_ALLOWLIST } from "./depAllowlist";

export {
  installHostFirstResolution,
  isHostScopedRequest,
  originatesUnderRegisteredRoot,
  registerHostFirstRepoRoot,
  registeredHostFirstRepoRoots,
  resolveFromHost,
  __resetHostFirstResolutionForTests,
} from "./hostFirstResolution";

export {
  resolveTemplatePreview,
  resolveAllTemplatePreviews,
  encodeTemplateKey,
} from "./resolveTemplatePreview";

export type { ResolvedPreview } from "./resolveTemplatePreview";

export { validateTemplateRoles } from "./validateTemplateRoles";

// The catalog sidecars (0.3.1): `<name>.catalog.json` beside each template,
// gathered by a repo's build into its root `template-catalog.json`.
export { collectTemplateCatalog, serializeTemplateCatalog, writeTemplateCatalog } from "./templateCatalogSidecars";
export type { CollectedTemplateCatalog } from "./templateCatalogSidecars";
