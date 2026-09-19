import type { MosaicXDocument, MosaicDiagnostic } from "@m0saic/types";
import { asDiagnosticCode, isMosaicDataSource, isMosaicTemplateInvocationSource } from "@m0saic/types";
import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";
import { validateAssetManifest, type ValidateAssetManifestOptions } from "./validateAssetManifest";
import { validateMosaicSources } from "./validateSources";
import { validateMosaicOutput } from "./validateMosaicOutput";

export type ValidateMosaicXDocumentOptions = {
  /**
   * Forwarded to `validateAssetManifest`. The engine (`@m0saic/core`)
   * passes its internal kinds ("lavfi", "node-output") here so
   * mid-traversal validation doesn't reject transient entries the
   * engine mints itself.
   */
  acceptedEngineInternalKinds?: ValidateAssetManifestOptions["acceptedEngineInternalKinds"];
};

/**
 * Structural validation for a `.mosaicx` source-form document.
 *
 * Distinct from {@link validateMosaicDocument}:
 * - Accepts `template_invocation` sources (validates their shape:
 *   templateId is a TemplateId, props is present); the standard
 *   validator rejects them with `UNRESOLVED_TEMPLATE_INVOCATION`.
 * - Counts `template_invocation` sources as renderable for the
 *   source-count-vs-frame-count check, since they materialize into
 *   `mosaic`-kind cells at resolve time.
 *
 * Other checks (m0 syntax, asset manifest, output knobs, data-source
 * alias collisions) are shared with the standard validator — same
 * underlying helpers.
 *
 * Semantic / runtime errors (template not found, propsSchema
 * mismatch, depth-cap exceeded) are emitted by the resolver
 * (`resolveMosaicx`), not here — `validateMosaicXDocument` is a
 * file-shape lint, not a render-time check.
 */
export function validateMosaicXDocument(
  file: MosaicXDocument,
  width: number,
  height: number,
  opts: ValidateMosaicXDocumentOptions = {},
): MosaicDiagnostic[] {
  const diagnostics: MosaicDiagnostic[] = [];

  const sources = file.sources ?? [];
  const assets = file.assets ?? {};

  // Output-config (durationMs / fps / format) lives flat on the doc.
  // Field-level validation (INVALID_DURATION / INVALID_FPS / etc.) is
  // delegated to validateMosaicOutput, identical to the resolved-form
  // validator.
  diagnostics.push(...validateMosaicOutput(file, "default"));

  // 0) Asset manifest structural lint. Same as the resolved validator —
  // .mosaicx manifests must also conform to the asset-kinds registry
  // (file / url / data-uri); the resolver may add entries when it
  // materializes child docs but cannot relax the format constraint.
  diagnostics.push(
    ...validateAssetManifest(file.assets, "assets", {
      acceptedEngineInternalKinds: opts.acceptedEngineInternalKinds,
    }),
  );

  // 1) M0 string syntax. Can't proceed further if DSL is invalid.
  if (!isValidM0String(file.m0)) {
    diagnostics.push({
      code: asDiagnosticCode("INVALID_MOSAIC_STRING"),
      message: "M0 string is syntactically invalid.",
      severity: "error",
    });
    return diagnostics;
  }

  // 2) Source count vs renderable-cell count.
  //
  // Same rule as the resolved validator with one twist: a
  // `template_invocation` source becomes a `mosaic` cell at resolve
  // time, so it counts as renderable here. Only `data` sources are
  // excluded (they don't occupy m0 cells either before or after
  // resolution).
  const frames = parseM0StringToRenderFrames(file.m0, width, height);
  const expectedSourceCount = frames.length;
  const renderableSources = sources.filter(
    (s) => !isMosaicDataSource(s),
  );
  const actualSourceCount = renderableSources.length;

  if (expectedSourceCount !== actualSourceCount) {
    const invocationCount = sources.filter(
      isMosaicTemplateInvocationSource,
    ).length;
    diagnostics.push({
      code: asDiagnosticCode("SOURCE_COUNT_MISMATCH"),
      message: `Mosaicx expects ${expectedSourceCount} renderable sources but doc.sources has ${actualSourceCount} (${invocationCount} template_invocation, data sources are skipped).`,
      severity: "error",
    });
  }

  // 3) Per-source structural validation. `allowTemplateInvocation` flips
  // validateMosaicSources into source-form mode where
  // `template_invocation` sources are accepted + structurally checked
  // instead of being rejected outright.
  diagnostics.push(
    ...validateMosaicSources(sources, assets, {
      allowTemplateInvocation: true,
    }),
  );

  return diagnostics;
}
