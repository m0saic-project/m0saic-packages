import type {
  MosaicDocument,
  MosaicRenderableFile,
  MosaicXDocument,
  MosaicXPipeline,
} from "@m0saic/types";
import { toCanonicalM0String, validateM0String } from "@m0saic/dsl";

// Canonical-m0 gate for the DOCUMENT formats (`.mosaic` / `.mosaicx`),
// mirroring `canonicalizeAndValidateM0` in @m0saic/dsl-file-formats so the
// document formats share the same contract as `.m0` / `.m0c` / `.m0p`:
//
//   - INPUT may be canonical OR pretty (expanded) DSL — both accepted.
//   - OUTPUT is ALWAYS canonical — no serialized document (and no loaded
//     in-memory tree) carries pretty-form m0.
//   - INVALID m0 can never be written or read — it throws at the boundary.
//
// A document tree holds m0 in MORE than one place: the top-level `m0`, every
// nested `children[*]` document (recursively), and every pipeline
// `steps[*].file`. The walk below mirrors `absolutizeManifestPathsInPlace`
// (loadMosaicDocument.ts) so coverage stays in lockstep with that visitor.
// Both source-form kinds (`mosaicx_document` / `mosaicx_pipeline`) walk
// exactly like their runnable counterparts — the m0 gate is about layout,
// not about whether invocations are still unresolved.
//
// Browser-safe: no node imports — the web Compose save path imports this.

/**
 * Canonicalize and validate one m0 string. Returns the canonical form;
 * throws (prefixed with `label`) when empty or invalid.
 */
export function canonicalizeDocM0(label: string, raw: string): string {
  const m0 = toCanonicalM0String(raw);
  if (!m0) {
    throw new Error(`${label}: m0 layout string cannot be empty.`);
  }
  const res = validateM0String(m0);
  if (!res.ok) {
    const e = res.error;
    const where = e.position != null ? ` at position ${e.position}` : "";
    throw new Error(
      `${label}: invalid m0 layout${where} — ${e.message} [${e.kind}/${e.code}]`,
    );
  }
  return m0;
}

/**
 * Walk a renderable tree and rewrite every m0 string to canonical form
 * in place (top-level + recursive `children` + pipeline `steps[].file`).
 * Throws on the first invalid m0. Mutates the input — callers that must
 * not disturb a live tree pass a clone (the serializers below do).
 */
export function canonicalizeRenderableM0InPlace(
  node: unknown,
  label = "serializeMosaicDocument",
): void {
  if (node == null || typeof node !== "object") return;
  const kind = (node as { kind?: string }).kind;

  if (kind === "mosaic_document" || kind === "mosaicx_document") {
    const doc = node as { m0?: unknown; children?: unknown };
    if (typeof doc.m0 === "string") {
      doc.m0 = canonicalizeDocM0(label, doc.m0);
    }
    const children = doc.children;
    if (children != null && typeof children === "object" && !Array.isArray(children)) {
      for (const child of Object.values(children as Record<string, unknown>)) {
        canonicalizeRenderableM0InPlace(child, label);
      }
    }
  } else if (kind === "mosaic_pipeline" || kind === "mosaicx_pipeline") {
    const steps = (node as { steps?: unknown }).steps;
    if (Array.isArray(steps)) {
      for (const step of steps) {
        const file = (step as { file?: unknown })?.file;
        if (file != null) canonicalizeRenderableM0InPlace(file, label);
      }
    }
  }
}

/**
 * Serialize a `.mosaic` (or any renderable: document / mosaicx / pipeline)
 * to the canonical on-disk JSON string. Every m0 in the tree is
 * canonicalized and validated first; invalid m0 throws. The input is left
 * untouched (a clone is canonicalized). This is the ONE writer the
 * `.mosaic` write paths should route through.
 */
export function serializeMosaicDocument(renderable: MosaicRenderableFile): string {
  const clone = structuredClone(renderable);
  canonicalizeRenderableM0InPlace(clone, "serializeMosaicDocument");
  assertRootCanvas(clone, "serializeMosaicDocument");
  return JSON.stringify(clone, null, 2);
}

/**
 * Boundary law (gate 28): a ROOT mosaic document always carries its canvas
 * — `size` is what makes "open a .mosaic, render, get the same thing"
 * true, and hosts treat it as the default render dims. Children/steps are
 * exempt (a child may deliberately omit size — the stretch-vs-letterbox
 * lever); pipelines size per step (rule 4).
 */
export function assertRootCanvas(
  renderable: { kind?: string; size?: { width?: number; height?: number } },
  context: string,
): void {
  if (renderable?.kind !== "mosaic_document") return;
  const sz = renderable.size;
  if (
    !sz ||
    !Number.isFinite(sz.width) ||
    !Number.isFinite(sz.height) ||
    (sz.width as number) <= 0 ||
    (sz.height as number) <= 0
  ) {
    throw new Error(
      `${context}: root mosaic_document has no canvas — 'size' {width,height} ` +
        `is required on root documents (children may omit it).`,
    );
  }
}

/**
 * Serialize a `.mosaicx` source form to canonical JSON. Same contract
 * as {@link serializeMosaicDocument}; narrows the input type for the
 * Compose / export callers that hold a `MosaicXDocument` — or, for a
 * root-level template chain, a `MosaicXPipeline`.
 */
export function serializeMosaicXDocument(
  doc: MosaicXDocument | MosaicXPipeline | MosaicDocument,
): string {
  const clone = structuredClone(doc);
  canonicalizeRenderableM0InPlace(clone, "serializeMosaicXDocument");
  return JSON.stringify(clone, null, 2);
}
