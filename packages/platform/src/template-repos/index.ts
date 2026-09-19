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
