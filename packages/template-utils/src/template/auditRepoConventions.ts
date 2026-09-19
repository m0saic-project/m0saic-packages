// Repo-level conventions — rules about a template REPO rather than one
// template. They ride the same finding shape and posture table as the
// per-template conventions (`templateConventions.ts`), keyed by the repo id
// instead of a template id, so every gate prints them the same way.
import type { MosaicTemplateRepoDescriptor } from "@m0saic/types";
import type { TemplateConventionViolation } from "./auditSchemaConventions";

/**
 * `repoFrontDoor`: a repo names the template a newcomer renders first.
 *
 * The hello-world convention (2026-09-14): every template repo declares
 * `repo.helloWorld` — the id of its front door. The default is the canonical
 * brand card via `defineHelloWorldTemplate({ id, subline })`; a pack that
 * wants its own look writes its own template and points the field at it.
 * Hosts (the CLI's `m0saic hello-world --template-repo`, Make's "Start
 * here") read the field; the manifest carries it zero-exec.
 *
 * Record posture — a warning in the gate, never fatal.
 */
export function auditRepoFrontDoor(
  repo: Pick<MosaicTemplateRepoDescriptor, "repoId" | "helloWorld"> | null | undefined,
  registeredIds: ReadonlyArray<string>,
): TemplateConventionViolation[] {
  if (!repo) return [];
  const id = typeof repo.helloWorld === "string" ? repo.helloWorld.trim() : "";
  if (!id) {
    return [
      {
        key: "helloWorld",
        detail:
          `repo "${String(repo.repoId)}" declares no front door — set repo.helloWorld to the template a newcomer renders first ` +
          `(the canonical card: defineHelloWorldTemplate({ id: "${String(repo.repoId)}/basics/hello-world/v1", subline }); or your own template).`,
      },
    ];
  }
  if (!registeredIds.includes(id)) {
    return [
      {
        key: "helloWorld",
        detail: `repo.helloWorld names "${id}", which this repo does not register — point it at one of the repo's own template ids.`,
      },
    ];
  }
  return [];
}
