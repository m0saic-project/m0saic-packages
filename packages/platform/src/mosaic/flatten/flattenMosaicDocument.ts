import type {
  AssetId,
  MosaicDocument,
  MosaicDiagnostic,
  MosaicSource,
  MosaicAssetManifest,
} from "@m0saic/types";
import { asAssetId, asDiagnosticCode, isMosaicDataSource } from "@m0saic/types";
import { toM0String, rewriteOverlayChains } from "@m0saic/dsl-stdlib";
import { parseM0StringComplete, toCanonicalM0String } from "@m0saic/dsl";
import type { M0IR, RenderFrame } from "@m0saic/dsl";
import { validateMosaicDocument } from "../validate/validateMosaicDocument";
import { substituteLocalTime, substituteTileMacros } from "../../ffexpr/macros";

/**
 * Flatten denormalizes nested mosaic refs into a single document with one
 * sources array and one manifest. Authored assets are document-local —
 * "hero_area" in one template instance is a *different entry* than
 * "hero_area" in another instance of the same template. To preserve that
 * boundary after flattening into a single namespace, we namespace each
 * child's assetIds with a per-instance prefix on the way up.
 *
 * The prefix encodes the parent source index that introduced the child
 * (e.g. `c2_`), so:
 *   - Same template referenced at three slots → three distinct prefixes
 *     (`c2_`, `c3_`, `c4_`), no collisions even with identical keys.
 *   - Nested templates compose readably (`c2_c0_hero_area`).
 *   - Original key remains visible at the end for debuggability.
 *
 * Authored sources inside the child are rewritten to use the new ids so
 * the (assetId on source) → (key in manifest) invariant holds post-flatten.
 */
function namespaceChildManifest(
  childAssets: MosaicAssetManifest | undefined,
  prefix: string,
): { renamed: MosaicAssetManifest; idMap: Map<AssetId, AssetId> } {
  const renamed: MosaicAssetManifest = {};
  const idMap = new Map<AssetId, AssetId>();
  if (childAssets == null) return { renamed, idMap };
  for (const key of Object.keys(childAssets) as Array<keyof MosaicAssetManifest>) {
    const originalId = key as unknown as AssetId;
    const newId = asAssetId(`${prefix}${String(originalId)}`);
    renamed[newId] = childAssets[key]!;
    idMap.set(originalId, newId);
  }
  return { renamed, idMap };
}

/** Apply an `idMap` to every assetId field on a source (and `alpha-image`
 *  masks). Returns a copy — the input is not mutated. */
function rewriteSourceAssetIds(
  source: MosaicSource,
  idMap: Map<AssetId, AssetId>,
): MosaicSource {
  if (idMap.size === 0) return source;
  const rewritten: MosaicSource = { ...source };
  if (rewritten.type === "media" && rewritten.assetId) {
    const next = idMap.get(rewritten.assetId);
    if (next) rewritten.assetId = next;
  }
  const maskHost = rewritten as MosaicSource & {
    mask?: { kind?: string; assetId?: AssetId };
  };
  if (
    maskHost.mask &&
    maskHost.mask.kind === "alpha-image" &&
    maskHost.mask.assetId
  ) {
    const next = idMap.get(maskHost.mask.assetId);
    if (next) {
      maskHost.mask = { ...maskHost.mask, assetId: next };
    }
  }
  return rewritten;
}

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

export type FlattenMosaicDocumentOptions = {
  file: MosaicDocument;
  width: number;
  height: number;
  resolveRef: (ref: string) => MosaicDocument | null;
  /**
   * Engine-internal asset kinds (e.g. "node-output", "lavfi",
   * "workspace-file") to tolerate during validation. `@m0saic/core` mints
   * these into a document's manifest while building a plan, mutating the
   * in-memory renderable in place. A caller that only wants the *geometry*
   * (the flattened m0 + per-cell stableKeys) — not the pixel content of
   * those assets — can pass them here so a post-plan renderable still
   * flattens instead of tripping `ASSET_KIND_UNKNOWN`. Forwarded verbatim
   * to {@link validateMosaicDocument}. Defaults to strict (none accepted).
   */
  acceptedEngineInternalKinds?: readonly string[];
};

export type FlattenResult =
  | { ok: true; file: MosaicDocument }
  | { ok: false; diagnostics: MosaicDiagnostic[] };

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function fail(diagnostics: MosaicDiagnostic[]): FlattenResult {
  return { ok: false, diagnostics };
}

function failOne(code: string, message: string): FlattenResult {
  return fail([{ code: asDiagnosticCode(code), message, severity: "error" }]);
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Collapse a `MosaicDocument` tree (root + all nested `children`) into a
 * single flat document the engine can render directly. The engine never
 * sees per-child shapes; it operates on the merged form below.
 *
 * # What flattens together
 *
 * | Field                    | Flatten behavior                                                                                                                              |
 * |--------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
 * | `m0` DSL                 | Spliced into **one master m0 string** that describes every cell in the final render.                                                          |
 * | `assets` manifest        | Merged with **per-child namespace prefixes** (`c0_`, `c1_`, `c2_`, …). Every `assetId` reference in spliced sources is rewritten to match.    |
 * | `sources` array          | Spliced in DSL-frame order; matched positionally against the flattened m0 string. AssetId references rewritten to namespaced ids.             |
 * | `children` map           | Resolved and consumed — empty after flatten.                                                                                                  |
 * | `outputs`                | Preserved on the root only — top-level config, not in the flatten path.                                                                       |
 * | `meta` / `created` etc.  | Preserved on the root only.                                                                                                                   |
 * | `editor` / `engine`      | Preserved on the root only.                                                                                                                   |
 *
 * # Why this matters
 *
 * - **One keyspace post-flatten.** The flattened root has a single DSL,
 *   a single manifest, and a single sources array — one unified
 *   keyspace for stableKeys and asset ids.
 * - **{@link MosaicRefSource} resolution.** The ref source's
 *   `flattenedStableKey` resolves against *this* merged keyspace, not
 *   any per-child local key. Cross-child mirroring (render once, reuse
 *   many) is what flattening enables.
 * - **Determinism.** The namespace prefix encodes the parent source
 *   index that introduced the child, so the same template referenced
 *   at three slots gets three distinct prefixes (`c2_`, `c3_`, `c4_`)
 *   with no collisions even when keys are identical.
 *
 * Cycles are detected via the ancestor-refs set passed through
 * recursion. Forward references and inter-pipeline-step references are
 * caller / engine concerns, not flatten concerns.
 */
export function flattenMosaicDocument(options: FlattenMosaicDocumentOptions): FlattenResult {
  const { file, width, height, resolveRef, acceptedEngineInternalKinds } = options;
  const validateOpts = { acceptedEngineInternalKinds };

  // 1. Validate input document
  const inputDiags = validateMosaicDocument(file, width, height, validateOpts);
  const inputErrors = inputDiags.filter((d) => d.severity === "error");
  if (inputErrors.length > 0) {
    return fail(inputDiags);
  }

  // 2. Recursively flatten — root resolver chains the document's own
  //    children map with the caller-provided external resolver.
  const rootResolve = buildResolver(file, resolveRef);
  const result = flattenRecursive(file, width, height, new Set<string>(), rootResolve);
  if (!result.ok) return result;

  // 3. Safety check: validate the flattened output
  const outputDiags = validateMosaicDocument(result.file, width, height, validateOpts);
  const outputErrors = outputDiags.filter((d) => d.severity === "error");
  if (outputErrors.length > 0) {
    return fail(outputDiags);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// Parent overlay push-down
// ─────────────────────────────────────────────────────────────

type OverlayLike = {
  startAtSec?: number;
  enable?: string;
  alpha?: string;
  xExpr?: string;
  yExpr?: string;
  blendMode?: string;
  window?: unknown;
} & Record<string, unknown>;

const OVERLAY_EXPR_KEYS = ["xExpr", "yExpr", "alpha", "enable"] as const;

/**
 * A `mosaic` ref source may carry its own `overlay` — timing (`startAtSec`),
 * a gate (`enable` / `window`), motion (`xExpr` / `yExpr`), `alpha`, a blend
 * mode. The engine applies it to the CHILD COMPOSITE as a whole. Splicing
 * the child's sources in verbatim silently DROPPED it, so every flattened
 * form of an animated mosaic ref — the `.mosaic` twin, Make's edit-mode doc,
 * `resolve --flatten` — showed the child from t=0, unmoved, at full alpha
 * (found on the animated wireframe, gate 30: all four cells on at frame 0).
 *
 * Push it down onto each inlined source. Gate, alpha, start and blend apply
 * identically per sub-cell, so per-source is the same picture. Positional
 * exprs are exact once the engine's macros are baked the way the engine
 * bakes them at the PARENT slot: `W`/`H` → the parent tile's pixel dims
 * (`substituteTileMacros`), `lt` → `(t-startAtSec)` (`substituteLocalTime`)
 * — a sub-cell's own dims or start must never re-scale them. A source that
 * already carries an overlay keeps its own timing/blend/window; its gate and
 * alpha compose with the parent's by product and its offsets by sum, which is
 * what the nested render does (the child's own gate inside the composite,
 * the composite's gate outside).
 */
function pushDownParentOverlay(
  sources: MosaicSource[],
  parent: MosaicSource,
  frame: { width: number; height: number },
): MosaicSource[] {
  const ov = (parent as { overlay?: OverlayLike }).overlay;
  if (!ov) return sources;
  const dims = { W: frame.width, H: frame.height };
  const baked: OverlayLike = { ...ov };
  for (const k of OVERLAY_EXPR_KEYS) {
    const v = baked[k];
    if (typeof v === "string") {
      baked[k] = substituteLocalTime(substituteTileMacros(v, dims), ov.startAtSec);
    }
  }
  return sources.map((s) => {
    if (isMosaicDataSource(s)) return s;
    const own = (s as { overlay?: OverlayLike }).overlay;
    if (!own) return { ...s, overlay: { ...baked } } as MosaicSource;
    const merged: OverlayLike = { ...baked, ...own };
    const both = (k: keyof OverlayLike): boolean =>
      typeof own[k] === "string" && typeof baked[k] === "string";
    if (both("enable")) merged.enable = `(${own.enable})*(${baked.enable})`;
    if (both("alpha")) merged.alpha = `(${own.alpha})*(${baked.alpha})`;
    if (both("xExpr")) merged.xExpr = `(${own.xExpr})+(${baked.xExpr})`;
    if (both("yExpr")) merged.yExpr = `(${own.yExpr})+(${baked.yExpr})`;
    return { ...s, overlay: merged } as MosaicSource;
  });
}

// ─────────────────────────────────────────────────────────────
// Recursive core
// ─────────────────────────────────────────────────────────────

/**
 * Build a resolver that checks the document's own children first,
 * then falls back to a parent resolver.  This lets nested children
 * resolve sibling refs that live on an ancestor's children map.
 */
function buildResolver(
  doc: MosaicDocument,
  parentResolve: (ref: string) => MosaicDocument | null,
): (ref: string) => MosaicDocument | null {
  return (ref: string) => {
    const local = (doc.children as Record<string, unknown> | undefined)?.[ref];
    if (
      local &&
      typeof local === "object" &&
      (local as any).kind === "mosaic_document" &&
      (local as any).version === 1
    ) {
      return local as MosaicDocument;
    }
    return parentResolve(ref);
  };
}

/**
 * Parse the canonical DSL and return the IR or a fail result.
 * Wraps parseM0StringComplete and works around TS discriminated-union
 * narrowing issues across package boundaries.
 */
function parseDsl(
  canonical: string,
  w: number,
  h: number,
): { ir: M0IR } | FlattenResult {
  const parsed = parseM0StringComplete(canonical, w, h, );
  if (parsed.ok) {
    return { ir: parsed.ir };
  }
  // parsed.ok === false → error branch
  const errObj = parsed as { ok: false; error: { code?: string; message: string } };
  const code =
    errObj.error.code === "SPLIT_EXCEEDS_AXIS"
      ? "SPLIT_EXCEEDS_AXIS"
      : "INVALID_MOSAIC_STRING";
  return failOne(code, errObj.error.message);
}

function flattenRecursive(
  doc: MosaicDocument,
  w: number,
  h: number,
  ancestorRefs: Set<string>,
  externalResolve: (ref: string) => MosaicDocument | null,
): FlattenResult {
  const canonical = toCanonicalM0String(doc.m0);

  // Parse  so every frame carries its token span
  const parseOut = parseDsl(canonical, w, h);
  if ("ok" in parseOut && !parseOut.ok) return parseOut as FlattenResult;
  const ir = (parseOut as { ir: M0IR }).ir;

  // Frames sorted by logical (source) index
  const logicalFrames: RenderFrame[] = ir.renderFrames
    .slice()
    .sort((a, b) => a.logicalIndex - b.logicalIndex);

  const docSources = doc.sources ?? [];

  // Source count must match frame count — but skip data sources. They don't
  // occupy m0 cells; they pass through `doc.sources[]` purely as a side-channel
  // for `variables` payloads and aren't matched against frames.
  const renderableSources = docSources.filter(
    (s) => !isMosaicDataSource(s),
  );
  if (logicalFrames.length !== renderableSources.length) {
    return failOne(
      "SOURCE_COUNT_MISMATCH",
      `Mosaic expects ${logicalFrames.length} renderable sources but doc.sources has ${renderableSources.length} (data sources are skipped).`,
    );
  }

  // Quick check: any mosaic sources to process?
  const hasMosaic = docSources.some((s: MosaicSource) => s.type === "mosaic");
  if (!hasMosaic) {
    return { ok: true, file: doc };
  }

  // ── Collect replacements ──────────────────────────────────
  type Replacement = {
    span: { start: number; end: number };
    newDsl: string;
  };

  const replacements: Replacement[] = [];
  const newSources: MosaicSource[] = [];
  let mergedAssets: MosaicAssetManifest = { ...(doc.assets ?? {}) };

  // Walk `docSources` and `logicalFrames` with separate cursors: data sources
  // pass through (no frame pairing) preserving their position in `newSources`;
  // renderable sources consume one frame each. The frame-count check above
  // guarantees the renderable cursor stays in bounds.
  let frameCursor = 0;
  for (let i = 0; i < docSources.length; i++) {
    const source = docSources[i];

    if (isMosaicDataSource(source)) {
      // No m0 cell, no frame. Preserve in `newSources` so the flattened doc
      // still publishes its `variables` to downstream steps.
      newSources.push(source);
      continue;
    }

    const frame = logicalFrames[frameCursor++];

    if (source.type !== "mosaic") {
      newSources.push(source);
      continue;
    }

    const ref = source.ref;

    // Cycle detection
    if (ancestorRefs.has(ref)) {
      const cyclePath = [...ancestorRefs, ref].join(" -> ");
      return failOne("MOSAIC_CYCLE_DETECTED", `Cycle detected in mosaic references: ${cyclePath}`);
    }

    // Resolve via the chained resolver (own children → parent → external)
    const child = externalResolve(ref);
    if (!child) {
      return failOne(
        "MOSAIC_REF_NOT_FOUND",
        `Mosaic reference "${ref}" at source index ${i} could not be resolved.`,
      );
    }

    // Recursively flatten the child at the parent tile's pixel dimensions
    const childAncestors = new Set(ancestorRefs);
    childAncestors.add(ref);
    const childResolve = buildResolver(child, externalResolve);
    const childResult = flattenRecursive(child, frame.width, frame.height, childAncestors, childResolve);
    if (!childResult.ok) return childResult;

    const flatChild = childResult.file;
    const childCanonical = toCanonicalM0String(flatChild.m0);

    // Record the span replacement and splice sources
    const span = frame.meta.span;
    if (!span) {
      return failOne(
        "INTERNAL_FLATTEN_ERROR",
        `Frame at source index ${i} has no span metadata (spans may not be enabled).`,
      );
    }

    replacements.push({ span, newDsl: childCanonical });

    // Namespace this child instance's manifest so authored assets in
    // sibling instances of the same template never collide post-flatten.
    // Prefix is per parent-source-slot so three refs to the same template
    // get three distinct prefixes (c0_, c1_, c2_, …).
    const prefix = `c${i}_`;
    const { renamed, idMap } = namespaceChildManifest(flatChild.assets, prefix);
    const rewrittenSources = pushDownParentOverlay(
      (flatChild.sources ?? []).map((s: MosaicSource) => rewriteSourceAssetIds(s, idMap)),
      source,
      frame,
    );
    newSources.push(...rewrittenSources);
    Object.assign(mergedAssets, renamed);
  }

  // ── Apply DSL replacements (right-to-left to preserve positions) ──
  replacements.sort((a, b) => b.span.start - a.span.start);

  let newDsl = canonical;
  for (const r of replacements) {
    newDsl = newDsl.substring(0, r.span.start) + r.newDsl + newDsl.substring(r.span.end);
  }

  // ── Normalize overlay chains, canonicalize, validate, brand ─
  // Flattening can produce overlay chains (}{) when a parent overlay
  // slot is replaced with a child that has its own overlay. Rewrite
  // explicitly before branding.
  const normalized = rewriteOverlayChains(toCanonicalM0String(newDsl));
  const m0 = toM0String(normalized, "flattenMosaicDocument");

  // ── Build flattened document ──────────────────────────────
  // Preserve root-level top-level fields (outputs, meta, labels,
  // variables, sidecars, lifecycle stamps); replace m0, sources and
  // assets with the flattened forms. Children are consumed; the
  // flattened doc has no remaining children to resolve.
  const flattenedDoc: MosaicDocument = {
    ...doc,
    kind: "mosaic_document",
    version: 1,
    m0,
    assets: mergedAssets,
    sources: newSources,
    children: undefined,
  };

  // Preserve editor/engine metadata from the root
  if (doc.editor) flattenedDoc.editor = doc.editor;
  if (doc.engine) flattenedDoc.engine = doc.engine;

  return { ok: true, file: flattenedDoc };
}
