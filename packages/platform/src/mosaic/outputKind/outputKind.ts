/**
 * Output kind of a renderable — the ONE predicate for "is this a still or a
 * video?" when nothing says so explicitly.
 *
 * Authors may stamp `format.kind` on a document (or on a pipeline's final
 * step). Most templates don't, and a host that then falls back to a fixed
 * default gets it wrong for one whole family (an animated chart offered as
 * a PNG). The truthful fallback is the document itself: anything that
 * varies over time — overlay expressions, expression / video-mode text,
 * a camera, more than one output step — is a video; a document with none
 * of those is a still. Pure (no node imports); shared by the Make page
 * (Auto output type) and template tests.
 */

import type { MosaicRenderableFile } from "@m0saic/types";

export type OutputKind = "video" | "image";

type AnyRecord = Record<string, unknown>;

/** Time-varying evidence found in a document tree (children included). */
export type MotionEvidence = {
  overlayExprs: number;
  exprText: number;
  videoText: number;
  cameras: number;
  /** Non-intermediate pipeline steps seen. */
  outputSteps: number;
};

function isRecord(v: unknown): v is AnyRecord {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function scanDoc(doc: AnyRecord, ev: MotionEvidence, seen: Set<unknown>): void {
  if (seen.has(doc)) return;
  seen.add(doc);
  const sources = Array.isArray(doc.sources) ? (doc.sources as unknown[]) : [];
  for (const s of sources) {
    if (!isRecord(s)) continue;
    const o = isRecord(s.overlay) ? s.overlay : null;
    if (o && (o.alpha != null || o.xExpr != null || o.yExpr != null || o.enable != null || o.startAtSec != null || o.window != null)) {
      ev.overlayExprs++;
    }
    if (s.type === "text") {
      const layers = Array.isArray(s.layers) ? (s.layers as unknown[]) : [];
      if (layers.some((l) => isRecord(l) && isRecord(l.content) && l.content.kind === "expr")) ev.exprText++;
      if (isRecord(s.renderMode) && s.renderMode.kind === "video") ev.videoText++;
    }
    if (isRecord(s.effects) && s.effects.camera != null) ev.cameras++;
  }
  const children = isRecord(doc.children) ? doc.children : null;
  if (children) for (const c of Object.values(children)) scanFile(c, ev, seen);
}

function scanFile(file: unknown, ev: MotionEvidence, seen: Set<unknown>): void {
  if (!isRecord(file)) return;
  if (Array.isArray(file.steps)) {
    for (const step of file.steps as unknown[]) {
      if (!isRecord(step)) continue;
      if (step.intermediate !== true) ev.outputSteps++;
      scanFile(step.file, ev, seen);
    }
    return;
  }
  scanDoc(file, ev, seen);
}

/** Collect the time-varying evidence in a renderable (document or pipeline). */
export function collectMotionEvidence(file: MosaicRenderableFile | AnyRecord): MotionEvidence {
  const ev: MotionEvidence = { overlayExprs: 0, exprText: 0, videoText: 0, cameras: 0, outputSteps: 0 };
  scanFile(file, ev, new Set());
  return ev;
}

/** True when anything in the renderable changes over time. */
export function isAnimatedRenderable(file: MosaicRenderableFile | AnyRecord): boolean {
  const ev = collectMotionEvidence(file);
  return ev.overlayExprs + ev.exprText + ev.videoText + ev.cameras > 0 || ev.outputSteps > 1;
}

/** The kind the author stamped, if any: `format.kind` on a document, or on
 *  the first non-intermediate step of a pipeline. */
export function stampedOutputKind(file: MosaicRenderableFile | AnyRecord | null | undefined): OutputKind | null {
  if (!isRecord(file)) return null;
  const f0 = file as AnyRecord;
  const read = (f: unknown): OutputKind | null => {
    const k = isRecord(f) && isRecord(f.format) ? f.format.kind : undefined;
    return k === "video" || k === "image" ? k : null;
  };
  if (Array.isArray(f0.steps)) {
    for (const step of f0.steps as unknown[]) {
      if (!isRecord(step) || step.intermediate === true) continue;
      const k = read(step.file);
      if (k) return k;
    }
    return null;
  }
  return read(f0);
}

/**
 * Resolve a renderable's output kind: the author's stamp when present, else
 * inferred from the document's own time-variance. Never null for a real
 * renderable; `null` only for a missing / malformed input.
 */
export function inferOutputKind(file: MosaicRenderableFile | AnyRecord | null | undefined): OutputKind | null {
  if (!isRecord(file)) return null;
  return stampedOutputKind(file) ?? (isAnimatedRenderable(file) ? "video" : "image");
}
