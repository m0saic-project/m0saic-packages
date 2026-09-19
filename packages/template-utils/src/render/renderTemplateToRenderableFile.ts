import type {
  MosaicRenderableFile,
  MosaicTemplate,
  MosaicTemplateProps,
  MosaicDiagnostic,
  MosaicEngineContext,
} from "@m0saic/types";

import { validateTemplateProps } from "../template/validateTemplateProps";
import { finalizeRenderable } from "./finalizeRenderable";

const DEFAULT_FINALIZE_OPTS = {
  defaultRenderableOwner: "user" as const,
  defaultSourceOwner: "user" as const,
};

/**
 * Validate props against the template's propsSchema, then call render().
 *
 * - Returns a MosaicRenderableFile (mosaic OR pipeline) if validation passes.
 * - Throws an Error if there are any diagnostics with severity "error".
 */
export async function renderTemplateToRenderableFile<P extends MosaicTemplateProps>(
  template: MosaicTemplate<P>,
  props: P,
  ctx: MosaicEngineContext
): Promise<MosaicRenderableFile> {
  const diagnostics: MosaicDiagnostic[] = validateTemplateProps(template, props);

  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    const lines = errors.map((e) => `- ${e.message}`).join("\n");
    throw new Error(`Invalid props for template '${template.id}':\n${lines}`);
  }

  const raw = await template.render(props, ctx);
  const opts = template.defaultFinalizeOpts ?? DEFAULT_FINALIZE_OPTS;
  return finalizeRenderable(raw, ctx, opts);
}
