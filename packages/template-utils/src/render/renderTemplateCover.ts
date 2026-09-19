import type {
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicTemplate,
} from "@m0saic/types";

/**
 * Render a template's **cover** — the polished one-page landing shown when the
 * template is first opened in an editor with pure default props, before the
 * user has touched anything.
 *
 * DELIBERATE CONTRACT DIFFERENCE vs `renderTemplateLite`: this returns `null`
 * when the template declares no `renderCover`, and NEVER falls back to
 * `render` / `renderLite`. Covers are strictly opt-in — a host that gets
 * `null` must behave exactly as it did before the feature existed (fall
 * through to its normal preview path). Encoding that at the seam keeps every
 * host from having to remember not to synthesize one.
 *
 * Pair with a context built in `mode: "design"` (see `createDesignContext`)
 * and an EMPTY media registry — a cover is self-contained by contract.
 */
export async function renderTemplateCover(
  tmpl: MosaicTemplate<Record<string, unknown>>,
  props: Record<string, unknown>,
  ctx: MosaicEngineContext,
): Promise<MosaicRenderableFile | null> {
  if (!tmpl.renderCover) return null;
  return tmpl.renderCover(props, ctx);
}
