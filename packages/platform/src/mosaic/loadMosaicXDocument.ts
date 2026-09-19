import type { MosaicXDocument, MosaicXPipeline } from "@m0saic/types";
import { absolutizeManifestPathsInPlace } from "./loadMosaicDocument";
import { canonicalizeRenderableM0InPlace } from "./serializeMosaicDocument";

/**
 * Load a `.mosaicx` JSON file from disk + absolutize manifest paths.
 *
 * Pure function with side-effect only on the returned tree (no I/O of
 * its own — pass the raw JSON string in). Throws SyntaxError on
 * malformed JSON. Throws Error on a structurally-invalid envelope
 * (missing/wrong `kind`).
 *
 * Accepts BOTH source-form roots: `mosaicx_document` (a layout whose
 * sources may be unresolved invocations) and `mosaicx_pipeline` (a
 * top-level chain whose steps carry them). Callers that require one
 * specific root discriminate on the returned `kind`.
 *
 * Distinct from {@link loadMosaicDocument}:
 * - This loader narrows the return type to the source forms for
 *   callers that need source-form-specific behavior (e.g. Compose's
 *   editor, the resolver).
 * - It rejects the runnable kinds (`"mosaic_document"`,
 *   `"mosaic_pipeline"`) so a typo / wrong-file-path doesn't silently
 *   round-trip a resolved renderable through the mosaicx code path.
 *
 * For loaders that accept either format (e.g. file-open handlers that
 * dispatch based on the parsed shape), use `loadMosaicDocument` —
 * its return type is the full `MosaicRenderableFile` union and the
 * path-absolutization visitor handles both mosaicx and mosaic kinds.
 */
export function loadMosaicXDocument(
  raw: string,
  definitionFilePath: string,
): MosaicXDocument | MosaicXPipeline {
  const parsed = JSON.parse(raw) as unknown;
  const parsedKind =
    parsed && typeof parsed === "object"
      ? (parsed as { kind?: unknown }).kind
      : undefined;
  if (
    parsed == null ||
    typeof parsed !== "object" ||
    (parsedKind !== "mosaicx_document" && parsedKind !== "mosaicx_pipeline")
  ) {
    const got =
      parsed && typeof parsed === "object"
        ? String(parsedKind ?? "(unset)")
        : typeof parsed;
    throw new Error(
      `loadMosaicXDocument: expected kind="mosaicx_document" or "mosaicx_pipeline", got "${got}".`,
    );
  }
  const doc = parsed as MosaicXDocument | MosaicXPipeline;
  absolutizeManifestPathsInPlace(doc, definitionFilePath);
  // Normalize the whole tree to canonical m0 and reject invalid layouts on
  // read (template_invocation sources carry no m0; the placeholder top-level
  // m0 still canonicalizes).
  canonicalizeRenderableM0InPlace(doc, "loadMosaicXDocument");
  return doc;
}
