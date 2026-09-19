import type {
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicTemplate,
} from "@m0saic/types";

/**
 * Render a template for a **preview / design** pass — when a template is merely
 * selected or its props change in the editor, before the user has committed to
 * a render.
 *
 * Prefers the template's `renderLite` (a cheap, side-effect-free stand-in) when
 * present, otherwise falls back to `render` (the historical behavior). Preview
 * hosts MUST route through here rather than calling `render` directly, so that a
 * side-effecting `tier: "capability"` template doesn't run its real work (spawn
 * processes, write files, hit the network) just from being selected in the UI.
 *
 * Pair with a context built in `mode: "design"` (see `createEngineContext`).
 */
export async function renderTemplateLite(
  tmpl: MosaicTemplate<Record<string, unknown>>,
  props: Record<string, unknown>,
  ctx: MosaicEngineContext,
): Promise<MosaicRenderableFile> {
  if (tmpl.renderLite) return tmpl.renderLite(props, ctx);
  return tmpl.render(props, ctx);
}
