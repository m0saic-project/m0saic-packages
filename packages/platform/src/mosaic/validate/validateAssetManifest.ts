import type {
  MosaicDiagnostic,
} from "@m0saic/types";
import {
  ASSET_KINDS,
  FRIENDLY_SLUG_PATTERN,
  asDiagnosticCode,
} from "@m0saic/types";

// `ASSET_KEY_PATTERN` used to live in @m0saic/types; the identifier-hygiene
// redesign folded it into `FRIENDLY_SLUG_PATTERN` (same regex, broader scope).
const ASSET_KEY_PATTERN = FRIENDLY_SLUG_PATTERN;

/**
 * Structural validation of a MosaicDocument's `assets` map.
 *
 * Returns diagnostics covering missing/malformed manifests, unknown kinds,
 * per-kind required fields, and obvious mistakes like empty keys.
 *
 * The known kinds are exactly `ASSET_KINDS` from `@m0saic/types`
 * (`file` / `url` / `data-uri`). Any other kind is rejected as
 * `ASSET_KIND_UNKNOWN` — including engine-internal kinds, which exist
 * only inside `@m0saic/core` and must never appear in serialized JSON.
 *
 * File-existence checks are NOT performed here — `.mosaic` files travel
 * between machines, so parse-time stat calls would be wrong. Render-time
 * code (`validateJob.js` in the Electron app) handles existence.
 */
export type ValidateAssetManifestOptions = {
  /**
   * Engine-internal kinds (e.g. "lavfi", "node-output") that must NOT appear in
   * serialized JSON, but which `@m0saic/core` mints transiently during plan
   * building. When validating a document mid-traversal, the engine passes the
   * names of its internal kinds here so they don't trip ASSET_KIND_UNKNOWN.
   * Defaults to empty — load-time / serialization validation strictly enforces
   * the on-disk kind set.
   */
  acceptedEngineInternalKinds?: readonly string[];
};

export function validateAssetManifest(
  assets: unknown,
  pointerPrefix: string = "assets",
  opts: ValidateAssetManifestOptions = {},
): MosaicDiagnostic[] {
  const diagnostics: MosaicDiagnostic[] = [];

  if (assets == null || typeof assets !== "object" || Array.isArray(assets)) {
    diagnostics.push({
      code: asDiagnosticCode("ASSETS_MISSING"),
      message: `${pointerPrefix} must be an object mapping AssetIds to MosaicAsset entries.`,
      severity: "error",
    });
    return diagnostics;
  }

  const acceptedInternal = opts.acceptedEngineInternalKinds ?? [];
  const map = assets as Record<string, unknown>;
  for (const key of Object.keys(map)) {
    const ptr = `${pointerPrefix}["${key}"]`;

    if (!ASSET_KEY_PATTERN.test(key)) {
      diagnostics.push({
        code: asDiagnosticCode("ASSET_KEY_INVALID"),
        message: `${ptr}: asset id ${JSON.stringify(key)} must match ${ASSET_KEY_PATTERN} — letters, digits, "_", "-", "."; first char not "." or "-"; 1..128 chars.`,
        severity: "error",
      });
      continue;
    }

    const entry = map[key];
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      diagnostics.push({
        code: asDiagnosticCode("ASSET_MALFORMED"),
        message: `${ptr}: entry must be an object.`,
        severity: "error",
      });
      continue;
    }

    const e = entry as Record<string, unknown>;
    const kind = e.kind;

    if (typeof kind !== "string") {
      diagnostics.push({
        code: asDiagnosticCode("ASSET_MALFORMED"),
        message: `${ptr}: missing or non-string "kind".`,
        severity: "error",
      });
      continue;
    }

    if (!(ASSET_KINDS as readonly string[]).includes(kind)) {
      // Engine-internal kinds are minted transiently during plan-build and
      // never serialize; when validating mid-traversal we accept them.
      if (acceptedInternal.includes(kind)) {
        continue;
      }
      diagnostics.push({
        code: asDiagnosticCode("ASSET_KIND_UNKNOWN"),
        message: `${ptr}: kind "${kind}" is not a recognized asset kind (expected one of: ${ASSET_KINDS.join(", ")}).`,
        severity: "error",
      });
      continue;
    }

    // Per-kind required fields
    switch (kind) {
      case "file":
        if (typeof e.path !== "string" || e.path.length === 0) {
          diagnostics.push({
            code: asDiagnosticCode("ASSET_KIND_FIELDS_MISSING"),
            message: `${ptr}: kind="file" requires a non-empty "path" string.`,
            severity: "error",
          });
        }
        // Loader is supposed to absolutize; warn if not done yet.
        if (
          typeof e.path === "string" &&
          e.path.length > 0 &&
          !isLikelyAbsolute(e.path)
        ) {
          diagnostics.push({
            code: asDiagnosticCode("ASSET_PATH_NOT_ABSOLUTE"),
            message: `${ptr}: kind="file" path "${e.path}" is not absolute. The loader should have resolved it against the document directory.`,
            severity: "warning",
          });
        }
        break;
      case "url":
        if (typeof e.url !== "string" || e.url.length === 0) {
          diagnostics.push({
            code: asDiagnosticCode("ASSET_KIND_FIELDS_MISSING"),
            message: `${ptr}: kind="url" requires a non-empty "url" string.`,
            severity: "error",
          });
        }
        break;
      case "data-uri":
        if (typeof e.uri !== "string" || e.uri.length === 0) {
          diagnostics.push({
            code: asDiagnosticCode("ASSET_KIND_FIELDS_MISSING"),
            message: `${ptr}: kind="data-uri" requires a non-empty "uri" string.`,
            severity: "error",
          });
        }
        break;
    }
  }

  return diagnostics;
}

/**
 * Cross-platform absolute-path heuristic. POSIX absolute paths start with
 * "/"; Windows absolute paths start with "<letter>:" (drive letter) or
 * with "\\" (UNC). Pure string check — no fs access, runs in browser too.
 */
function isLikelyAbsolute(p: string): boolean {
  if (p.length === 0) return false;
  if (p[0] === "/") return true;
  if (p.startsWith("\\\\")) return true; // UNC
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  return false;
}
