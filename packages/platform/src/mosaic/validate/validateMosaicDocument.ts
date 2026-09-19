import type { MosaicDocument, MosaicDiagnostic } from "@m0saic/types";
import { asDiagnosticCode, isMosaicDataSource } from "@m0saic/types";
import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";
import { validateAssetManifest, type ValidateAssetManifestOptions } from "./validateAssetManifest";
import { validateMosaicSources } from "./validateSources";
import { validateMosaicOutput } from "./validateMosaicOutput";

export type ValidateMosaicDocumentOptions = {
  /**
   * Forwarded to `validateAssetManifest`. The engine (`@m0saic/core`) passes
   * its internal kinds ("lavfi", "node-output") here so mid-traversal
   * validation doesn't reject transient entries the engine mints itself.
   */
  acceptedEngineInternalKinds?: ValidateAssetManifestOptions["acceptedEngineInternalKinds"];
};

export function validateMosaicDocument(
  file: MosaicDocument,
  width: number,
  height: number,
  opts: ValidateMosaicDocumentOptions = {},
): MosaicDiagnostic[] {
  const diagnostics: MosaicDiagnostic[] = [];

  const sources = file.sources ?? [];
  const assets = file.assets ?? {};

  // Output-config (durationMs / fps / format) lives flat on the document
  // post-flatten (2026-05-15). We read durationMs directly for the
  // "parent duration" fallback used by text-source duration checks.
  // Field-level validation (INVALID_DURATION / INVALID_FPS / EMPTY_BITRATE /
  // EMPTY_PIXEL_FORMAT plus the container-kind matrix) is delegated to
  // `validateMosaicOutput`, called once with the doc's bundled output knobs.
  const parentDurationMs = file.durationMs;
  diagnostics.push(...validateMosaicOutput(file, "default"));

  //
  // 0) Validate the document's asset manifest. If the manifest itself is
  //    broken, downstream checks (assetId references in sources) will
  //    cascade into noise — but we still surface them so the user sees
  //    the full picture in one pass.
  //
  diagnostics.push(
    ...validateAssetManifest(file.assets, "assets", {
      acceptedEngineInternalKinds: opts.acceptedEngineInternalKinds,
    }),
  );

  //
  // 1) Validate M0 string syntax
  //
  if (!isValidM0String(file.m0)) {
    diagnostics.push({
      code: asDiagnosticCode("INVALID_MOSAIC_STRING"),
      message: "M0 string is syntactically invalid.",
      severity: "error",
    });
    return diagnostics; // can't proceed further if DSL is invalid
  }

  //
  // 3) Validate source count vs number of '1' leaves in DSL
  //
  const frames = parseM0StringToRenderFrames(file.m0, width, height);

  // Count only frames that actually expect a media source, and compare
  // against the **renderable** subset of `sources[]`. Data sources don't
  // occupy m0 cells (they're a side-channel for `variables`), so they're
  // excluded from the count.
  const expectedSourceCount = frames.length;
  const renderableSources = sources.filter((s) => !isMosaicDataSource(s));
  const actualSourceCount = renderableSources.length;

  if (expectedSourceCount !== actualSourceCount) {
    diagnostics.push({
      code: asDiagnosticCode("SOURCE_COUNT_MISMATCH"),
      message: `Mosaic expects ${expectedSourceCount} renderable sources but doc.sources has ${actualSourceCount} (data sources are skipped).`,
      severity: "error",
    });
  }

  //
  // 5) Validate sources (doc-level rules that need a parent duration)
  //

  // Text renderMode.kind="video" requires a duration:
  // - either the text source itself sets playback.clipDurationMs
  // - or some output entry on the doc provides a durationMs
  for (let i = 0; i < sources.length; i++) {
    const s: any = sources[i];
    if (s?.type !== "text") continue;

    const renderKind = s.renderMode?.kind ?? "image";
    if (renderKind !== "video") continue;

    const localDur = s.playback?.clipDurationMs;
    const parentDur = parentDurationMs;

    const hasLocal =
      typeof localDur === "number" && Number.isFinite(localDur) && localDur > 0;
    const hasParent =
      typeof parentDur === "number" && Number.isFinite(parentDur) && parentDur > 0;

    if (!hasLocal && !hasParent) {
      diagnostics.push({
        code: asDiagnosticCode("TEXT_RENDER_MODE_DURATION_MISSING"),
        message: `Text source at sources[${i}] has renderMode.kind="video" but no duration is available (set text.playback.clipDurationMs or doc.durationMs).`,
        severity: "error",
      });
    }
  }

  diagnostics.push(...validateMosaicSources(sources, assets));

  return diagnostics;
}
