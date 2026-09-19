import type {
  MosaicRenderableFile,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicPipelineStep,
} from "@m0saic/types";
import { isPipelineFile } from "@m0saic/types";
import { compactLossless } from "@m0saic/dsl-stdlib";

/**
 * Automatic lossless compaction of template render output.
 *
 * Layout exploration is layer-additive and weights are often authored at
 * a precise count, so a raw template render can carry **pure null layers**
 * (root-chain layers that paint nothing — noise once the human is looking
 * at OUTPUT rather than iterating) and **over-counted splits** (a 10-way
 * split that is the same geometry as a 5-way). `defineMosaicTemplate` runs
 * this pass on every render so templates get a minimal, render-faithful m0
 * for free — no per-author discipline required.
 *
 * It is STRICTLY LOSSLESS: {@link compactLossless} only reduces a split
 * when the reduction is verified pixel-identical at the document's canvas,
 * and only drops layers that paint nothing. Rendered-leaf count and paint
 * order are invariant, so positional sidecars (sources / masks / fills)
 * stay attached; key-addressed `labels` are migrated along the rekey map
 * (never silently detached).
 *
 * ## Opt-out
 *
 * A template that returns deliberate geometry opts out via the template
 * `skipAutoCompact` flag (passed here as `opts.skip`) or, per render, via
 * `doc.engine.skipAutoCompact`.
 *
 * ## Dimensions / safety
 *
 * Compaction needs the canvas the document renders at. `ctx.target` is
 * authoritative for the top-level document and for unsized pipeline steps
 * (the engine stamps it there). A nested child in `doc.children`, however,
 * is sized by the slot it fills — unknown here — so a child is compacted
 * only when it carries its OWN `size`. Children sub-rendered from nested
 * templates already went through this pass at their correct canvas.
 */
/** Shared config for the compaction walk. */
interface CompactConfig {
  /**
   * Drift budget forwarded to {@link compactLossless} → `reduceSplitCounts`.
   * The per-render auto pass always uses 0 (strictly pixel-lossless). The field
   * is kept so a deliberate, non-render caller could opt into bounded-lossy
   * collapse, but nothing does today.
   */
  maxDriftPx: number;
  /**
   * Honour a document's `engine.skipAutoCompact` opt-out. The automatic
   * per-render pass sets this true (a template can demand verbatim geometry).
   */
  consultSkipFlag: boolean;
}

export function autoCompactRenderable(
  file: MosaicRenderableFile,
  renderTarget: { width: number; height: number },
  opts: { skip: boolean },
): MosaicRenderableFile {
  if (opts.skip) return file;
  return compactFile(file, renderTarget, { maxDriftPx: 0, consultSkipFlag: true });
}

/**
 * @param fallbackDims authoritative canvas for this file when it carries
 *   no `size`. `null` means "no authoritative canvas" → this file (and
 *   any unsized descendants) is left untouched, but sized descendants are
 *   still compacted.
 */
function compactFile(
  file: MosaicRenderableFile,
  fallbackDims: { width: number; height: number } | null,
  cfg: CompactConfig,
): MosaicRenderableFile {
  if (isPipelineFile(file)) {
    return compactPipeline(file, fallbackDims, cfg);
  }
  return compactDocument(file as MosaicDocument, fallbackDims, cfg);
}

function compactPipeline(
  pipe: MosaicDocumentPipeline,
  fallbackDims: { width: number; height: number } | null,
  cfg: CompactConfig,
): MosaicDocumentPipeline {
  return {
    ...pipe,
    steps: pipe.steps.map((step): MosaicPipelineStep => {
      if (!("file" in step) || !step.file) return step;
      const stepWithFile = step as Extract<MosaicPipelineStep, { file: MosaicDocument }>;
      // Engine stamps the render target onto an unsized step, so the
      // render target is the authoritative fallback for steps.
      return {
        ...stepWithFile,
        file: compactFile(stepWithFile.file, fallbackDims, cfg) as MosaicDocument,
      };
    }),
  };
}

function compactDocument(
  doc: MosaicDocument,
  fallbackDims: { width: number; height: number } | null,
  cfg: CompactConfig,
): MosaicDocument {
  const dims = doc.size ?? fallbackDims;
  let next: MosaicDocument = doc;

  const optedOut = cfg.consultSkipFlag && doc.engine?.skipAutoCompact === true;
  if (dims != null && doc.m0 && !optedOut) {
    const result = compactLossless({
      m0: doc.m0,
      width: dims.width,
      height: dims.height,
      maxDriftPx: cfg.maxDriftPx,
    });
    if (result.m0 !== doc.m0) {
      next = { ...doc, m0: result.m0 };
      if (doc.labels && !result.keysStable) {
        next = { ...next, labels: migrateLabels(doc.labels, result.rekey, result.liveKeys) };
      }
    }
  }

  // Recurse into children. A child is compacted only at its OWN size — the
  // slot it fills is unknown here, so no inherited fallback.
  if (next.children) {
    next = {
      ...next,
      children: Object.fromEntries(
        Object.entries(next.children).map(([k, v]) => [k, compactFile(v, null, cfg)]),
      ),
    };
  }

  return next;
}

/**
 * Re-key per-cell labels along the compaction rekey map and drop entries
 * whose target no longer exists in the compacted document.
 */
function migrateLabels(
  labels: Record<string, string>,
  rekey: ReadonlyArray<{ from: string; to: string }>,
  liveKeys: ReadonlyArray<string>,
): Record<string, string> {
  const remap = new Map(rekey.map((p) => [p.from, p.to]));
  const live = new Set(liveKeys);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    const target = remap.get(key) ?? key;
    if (live.has(target)) out[target] = value;
  }
  return out;
}
