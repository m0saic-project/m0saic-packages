import type {
  MosaicDiagnostic,
  MosaicTemplate,
  MosaicTemplateProps,
} from "@m0saic/types";
import {
  TEMPLATE_ROLE_ID_HINTS,
  asDiagnosticCode,
  isTemplateRole,
} from "@m0saic/types";

/**
 * Validate the opt-in `role` declaration on every template in a repo.
 *
 * Pure helper: takes the loaded templates, returns diagnostics. Called
 * by {@link loadTemplateRepoFromPath} after templates are extracted from
 * the imported module.
 *
 * Rules:
 *  - Templates without `role` produce no diagnostic (unchanged behavior).
 *  - Templates with `role` outside the closed {@link TEMPLATE_ROLES} union
 *    produce `TEMPLATE_ROLE_NAMING_MISMATCH` (warning).
 *  - Templates with a valid `role` whose `id` does not match
 *    {@link TEMPLATE_ROLE_ID_HINTS}[role] produce
 *    `TEMPLATE_ROLE_NAMING_MISMATCH` (warning).
 *
 * Always a warning, never an error — the role tag is an authoring
 * nudge, not a runtime invariant.
 */
export function validateTemplateRoles(
  templates: MosaicTemplate<MosaicTemplateProps>[],
): MosaicDiagnostic[] {
  const diagnostics: MosaicDiagnostic[] = [];

  for (const t of templates) {
    if (!t.id || typeof t.id !== "string") continue;

    const role = (t as { role?: unknown }).role;
    if (role === undefined) continue;

    if (!isTemplateRole(role)) {
      diagnostics.push({
        code: asDiagnosticCode("TEMPLATE_ROLE_NAMING_MISMATCH"),
        message:
          `Template "${t.id}" declares an unrecognized role "${String(role)}". ` +
          `Allowed: renderable, data-fetcher, building-block, orchestrator, harness.`,
        severity: "warning",
      });
      continue;
    }

    const hint = TEMPLATE_ROLE_ID_HINTS[role];
    if (!hint.test(t.id)) {
      diagnostics.push({
        code: asDiagnosticCode("TEMPLATE_ROLE_NAMING_MISMATCH"),
        message:
          `Template "${t.id}" declares role "${role}" but its id does not match the naming convention ${hint}. ` +
          `Rename the template (or drop the role declaration) to clear this warning.`,
        severity: "warning",
      });
    }
  }

  return diagnostics;
}
