import type { MosaicDiagnostic, MosaicRenderableFile } from "@m0saic/types";
import { asDiagnosticCode } from "@m0saic/types";

/**
 * Validate an on-disk `.mosaic` (or `.mosaic-plan.json`) file for
 * the "self-describing artifact" invariant: the file MUST carry the
 * geometry it was/will be rendered at — `size`, `fps`, `durationMs`.
 *
 * Templates author with these fields optional (template intent); the
 * write-time stamper (`stampRenderableOutput`) fills them in before
 * serialization. By the time a file lands on disk, the geometry
 * triple should be present. If it isn't, the file is ambiguous: a
 * downstream tool or human reader can't tell what the render was
 * configured for.
 *
 * Codec/format/audio/color are NOT required by this validator —
 * they have engine defaults and most templates don't set them.
 *
 * See the internal rendering-model-contract notes for the
 * "stamp at write time" contract.
 */
export function validateSerializedMosaicDocument(
  file: MosaicRenderableFile,
): MosaicDiagnostic[] {
  const diagnostics: MosaicDiagnostic[] = [];

  const targets: Array<{
    doc: MosaicRenderableFile;
    path: string;
  }> = [];

  if (file.kind === "mosaic_document" || file.kind === "mosaicx_document") {
    // Both flat-form (`mosaic_document`) and source-form
    // (`mosaicx_document`) carry the same `size`/`fps`/`durationMs`
    // geometry triple at the top level (MosaicXDocument is a sibling
    // of MosaicDocument via `Omit<...>`). Same self-describing-artifact
    // invariant applies: any serialized file MUST stamp geometry
    // before write.
    targets.push({ doc: file, path: "" });
    // Walk children (both kinds carry the same `children` map shape).
    if (file.children) {
      for (const [key, child] of Object.entries(file.children)) {
        if (!child) continue;
        if (child.kind === "mosaic_document") {
          targets.push({ doc: child, path: `children.${key}` });
        }
      }
    }
  } else {
    // pipeline (runnable `mosaic_pipeline` or source-form
    // `mosaicx_pipeline` — same geometry contract at both roots):
    // validate pipeline-level + each inline step's doc
    targets.push({ doc: file, path: "" });
    for (let i = 0; i < file.steps.length; i++) {
      const step = file.steps[i];
      if ("file" in step && step.file !== undefined) {
        targets.push({ doc: step.file, path: `steps[${i}].file` });
      }
    }
  }

  for (const { doc, path } of targets) {
    const prefix = path ? `${path}.` : "";

    if (!doc.size || typeof doc.size.width !== "number" || typeof doc.size.height !== "number") {
      diagnostics.push({
        code: asDiagnosticCode("SERIALIZED_DOC_MISSING_SIZE"),
        message: `Serialized ${doc.kind} at ${path || "<root>"} is missing ${prefix}size — geometry must be stamped before write.`,
        severity: "error",
      });
    }

    if (typeof doc.fps !== "number") {
      diagnostics.push({
        code: asDiagnosticCode("SERIALIZED_DOC_MISSING_FPS"),
        message: `Serialized ${doc.kind} at ${path || "<root>"} is missing ${prefix}fps — must be stamped before write.`,
        severity: "error",
      });
    }

    if (typeof doc.durationMs !== "number") {
      diagnostics.push({
        code: asDiagnosticCode("SERIALIZED_DOC_MISSING_DURATIONMS"),
        message: `Serialized ${doc.kind} at ${path || "<root>"} is missing ${prefix}durationMs — must be stamped before write.`,
        severity: "error",
      });
    }
  }

  return diagnostics;
}
