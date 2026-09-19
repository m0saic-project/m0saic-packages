import type {
  MosaicRenderableFile,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicPipelineStep,
  MosaicSource,
  MosaicEngineContext,
} from "@m0saic/types";
import { isPipelineFile } from "@m0saic/types";

  // TODO: stamp timing info from context (fps, durationMs)

type FinalizeOptions = {
  /** Default owner for renderables produced by templates */
  defaultRenderableOwner?: "template" | "user";

  /** Default owner for sources inside documents */
  defaultSourceOwner?: "template" | "user";
};

export function finalizeRenderable(
  file: MosaicRenderableFile,
  ctx: MosaicEngineContext,
  opts: FinalizeOptions = {}
): MosaicRenderableFile {

  if (isPipelineFile(file)) {
    return finalizePipeline(file, ctx, opts);
  }

  return finalizeDocument(file as MosaicDocument, ctx, opts);
}

function finalizePipeline(
  pipe: MosaicDocumentPipeline,
  ctx: MosaicEngineContext,
  opts: FinalizeOptions
): MosaicDocumentPipeline {
  return {
    ...pipe,
    editor: {
      owner: opts.defaultRenderableOwner,
      ...pipe.editor,
    },
    engine: {
      renderStatus: "ok",
      ...pipe.engine,
    },
    steps: pipe.steps.map((step): MosaicPipelineStep => {
      if (!("file" in step) || !step.file) return step;
      // At this point, TypeScript knows step has 'file' property
      const stepWithFile = step as Extract<MosaicPipelineStep, { file: MosaicDocument }>;
      return {
        ...stepWithFile,
        file: finalizeRenderable(stepWithFile.file, ctx, opts) as MosaicDocument,
      };
    }),
  };
}

function finalizeDocument(
  doc: MosaicDocument,
  ctx: MosaicEngineContext,
  opts: FinalizeOptions
): MosaicDocument {
  return {
    ...doc,
    editor: {
      owner: opts.defaultRenderableOwner,
      ...doc.editor,
    },
    engine: {
      renderStatus: "ok",
      ...doc.engine,
    },
    // Sources hoisted to the doc top-level post-redesign.
    sources: (doc.sources ?? []).map((s: MosaicSource) => finalizeSource(s, opts)),
    children: doc.children
      ? Object.fromEntries(
          Object.entries(doc.children).map(([k, v]) => [
            k,
            finalizeRenderable(v, ctx, opts),
          ])
        )
      : undefined,
  };
}

/**
 * Default every source to renderStatus "ok" unless the template explicitly
 * set source.engine.renderStatus to "error" (e.g. for failed media).
 */
function finalizeSource(
  source: MosaicSource,
  opts: FinalizeOptions
): MosaicSource {
  return {
    ...source,
    editor: {
      owner: opts.defaultSourceOwner,
      ...source.editor,
    },
    engine: {
      renderStatus: "ok",
      ...source.engine, // template-set "error" overwrites default
    },
  };
}