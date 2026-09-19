import type {
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicTemplate,
} from "@m0saic/types";

/**
 * Render a template's **tutorial** — the self-documenting walkthrough a host
 * surfaces behind an explicit affordance (the Make page's "?" pill). The user
 * watches / scrubs it in place; it is never rendered to a file.
 *
 * Same opt-in seam as {@link renderTemplateCover}: returns `null` when the
 * template declares no `renderTutorial`, and NEVER falls back to `render` /
 * `renderLite`. Hosts gate the affordance on the template's meta flag, so a
 * `null` here means the flag and the registry disagree (stale meta) — degrade
 * quietly rather than showing the wrong thing.
 *
 * Callers pass the template's OWN `defaultProps` — never the user's working
 * props — so the walkthrough is stable regardless of editor state. Pair with a
 * `mode: "design"` context, an EMPTY media registry, and NO form duration: the
 * tutorial's own per-step `durationMs` values are authoritative.
 */
export async function renderTemplateTutorial(
  tmpl: MosaicTemplate<Record<string, unknown>>,
  props: Record<string, unknown>,
  ctx: MosaicEngineContext,
): Promise<MosaicRenderableFile | null> {
  if (!tmpl.renderTutorial) return null;
  return tmpl.renderTutorial(props, ctx);
}
