import * as path from "path";
import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicRenderableFile,
  MosaicXDocument,
} from "@m0saic/types";
import { assertRootCanvas, canonicalizeRenderableM0InPlace } from "./serializeMosaicDocument";

/**
 * Walk a parsed `.mosaic` (or `.mosaicx`) JSON tree and absolutize
 * every `kind: "file"` asset path against the directory containing
 * the source file.
 *
 * Replaces the old `resolveRenderablePathsInPlace` (which walked
 * `config.sources[*].src`) — paths now live exclusively in the asset
 * manifest, so this is where they get normalized once and never again.
 *
 * Mutates the input. Recurses into `children` (mosaic / mosaicx /
 * pipeline) and `pipeline.steps[].file`. Non-file asset kinds (`url`,
 * `data-uri`, engine-synthesized) are left untouched; the validator
 * will reject any engine-only kinds that snuck onto disk.
 *
 * MosaicX docs are structurally identical to MosaicDocument from this
 * function's perspective (same `assets` map, same `children` map);
 * `template_invocation` sources don't carry file paths, so they need
 * no special handling here. The resolver runs separately.
 */
export function absolutizeManifestPathsInPlace(
  renderable: MosaicRenderableFile,
  definitionFilePath: string,
): void {
  const baseDir = path.dirname(definitionFilePath);
  visitRenderable(renderable, baseDir);
}

function visitRenderable(node: unknown, baseDir: string): void {
  if (node == null || typeof node !== "object") return;
  const kind = (node as { kind?: string }).kind;
  if (kind === "mosaic_document" || kind === "mosaicx_document") {
    // Structurally identical for path-absolutization purposes: same
    // `assets` map, same `children` recursion. The `template_invocation`
    // source kind that only appears in mosaicx docs doesn't carry any
    // file paths of its own.
    visitMosaic(node as MosaicDocument | MosaicXDocument, baseDir);
  } else if (kind === "mosaic_pipeline" || kind === "mosaicx_pipeline") {
    // Same walk for the source form: a `mosaicx_pipeline`'s step files
    // carry the same asset manifests, resolved or not.
    visitPipeline(node as MosaicDocumentPipeline, baseDir);
  }
}

function visitMosaic(doc: MosaicDocument | MosaicXDocument, baseDir: string): void {
  const assets = (doc as { assets?: unknown }).assets;
  if (assets != null && typeof assets === "object" && !Array.isArray(assets)) {
    const map = assets as Record<string, unknown>;
    for (const id of Object.keys(map)) {
      const entry = map[id];
      if (
        entry != null &&
        typeof entry === "object" &&
        (entry as { kind?: string }).kind === "file"
      ) {
        const e = entry as { path?: unknown };
        if (typeof e.path === "string" && e.path.length > 0 && !path.isAbsolute(e.path)) {
          e.path = path.resolve(baseDir, e.path);
        }
      }
    }
  }

  const children = (doc as { children?: unknown }).children;
  if (children != null && typeof children === "object" && !Array.isArray(children)) {
    for (const child of Object.values(children as Record<string, unknown>)) {
      visitRenderable(child, baseDir);
    }
  }
}

function visitPipeline(pipe: MosaicDocumentPipeline, baseDir: string): void {
  const steps = (pipe as { steps?: unknown }).steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      const file = (step as { file?: unknown })?.file;
      if (file != null) visitRenderable(file, baseDir);
      // step.ref is an external resolver key; resolved by caller.
    }
  }
}

/**
 * Load a `.mosaic` JSON file from disk + absolutize manifest paths.
 *
 * Pure function with side-effect only on the returned tree (no I/O of its
 * own — pass the raw JSON string in). Throws SyntaxError on malformed JSON.
 */
export function loadMosaicDocument(
  raw: string,
  definitionFilePath: string,
): MosaicRenderableFile {
  const parsed = JSON.parse(raw) as MosaicRenderableFile;
  absolutizeManifestPathsInPlace(parsed, definitionFilePath);
  // Accept canonical OR pretty m0 on read; normalize the whole tree to
  // canonical and reject invalid m0 — a loaded doc never carries pretty or
  // broken layout strings (matches the .m0c/.m0p parse contract).
  canonicalizeRenderableM0InPlace(parsed, "loadMosaicDocument");
  // Boundary law (gate 28): a root document must declare its canvas —
  // same contract as the writer, so a sizeless file fails loudly at load
  // instead of rendering at whatever the host happened to pass.
  assertRootCanvas(parsed, "loadMosaicDocument");
  return parsed;
}
