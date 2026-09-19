/**
 * withLayoutContract — the dev tripwire for label-keyed ratio invariants.
 *
 *   return withLayoutContract(doc, ctx, {
 *     templateId, constraints, debug: props.debugLayout,
 *   });
 *
 * `debug` falsy (default) → returns `doc` UNTOUCHED at zero cost. True → runs
 * `checkLayout`, stamps `editor.layoutContract` (+ backfills `doc.labels` from
 * source tags), and on a violation returns a `LAYOUT_CONTRACT` error mosaic at
 * the canvas that broke. `assertLayout` is the throwing sibling for CI; and
 * `checkLayout` itself is the pure evaluator a layout search loops on.
 *
 * DELIBERATELY debug-only (founder ruling 2026-08-22): m0saic is a best-effort,
 * no-SLA tool — a render with slightly clipped text beats no render at all, so
 * violations never block a real render. Text-fit and friends are the pre-ship
 * stress tool: flip Debug layout while stressing, or lean on the unit-suite
 * assertLayout sweeps, to catch clipping before a template ships.
 */

import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicLayoutContractStamp,
} from "@m0saic/types";
import { makeErrorMosaic } from "../sources/makeErrorMosaic";
import { checkLayout } from "./layoutConstraint";
import type { LayoutConstraint, RelationalConstraint } from "./layoutConstraint";
import { buildContractWireframe } from "./violationWireframe";

const MAX_ERROR_LINES = 6;

export type WithLayoutContractOptions = {
  templateId: string;
  /** Per-element ratio invariants. */
  constraints?: LayoutConstraint[];
  /** Relational invariants (across a set of labeled nodes). */
  relations?: RelationalConstraint[];
  /**
   * Assert THROUGH nested children (flatten first). Default: auto (flatten when
   * `doc.children` is present). Pass `false` when the constraints target only the
   * PARENT's own top-level geometry (chrome / slot rects) — its m0 already carries
   * those, and a nested child's separate flatten quirk (e.g. a grid primitive's
   * per-pixel `SPLIT_EXCEEDS_AXIS` at a small canvas) would otherwise collapse the
   * whole check even though the parent's chrome is fine.
   */
  flatten?: boolean;
  /** Dev gate — falsy (default) returns `doc` UNTOUCHED at zero cost. */
  debug?: boolean;
  /**
   * Violation-wireframe rects: `"painted"` (default) bakes insets back into
   * the geometry (the granular intended rects); `"cells"` draws the raw
   * quantized split cells. See `buildViolationWireframe`.
   */
  violationBoxes?: "painted" | "cells";
};

export type AssertLayoutOptions = { constraints?: LayoutConstraint[]; relations?: RelationalConstraint[]; flatten?: boolean };

/** Merge the stamp + backfill `doc.labels` from resolved source tags (non-mutating). */
function stampedLayout(
  doc: MosaicDocument,
  stamp: MosaicLayoutContractStamp,
  resolvedLabels: Record<string, string>,
): MosaicDocument {
  // BACKFILL: fill keys the template didn't author. A template that already
  // wrote a doc.labels entry (e.g. the collage's crop-enriched display
  // labels) keeps it — the plain source tag only lands where nothing exists.
  const mergedLabels = { ...resolvedLabels, ...(doc.labels ?? {}) };
  const hasLabels = Object.keys(mergedLabels).length > 0;
  return {
    ...doc,
    ...(hasLabels ? { labels: mergedLabels } : {}),
    editor: { ...doc.editor, layoutContract: stamp },
  };
}

export function withLayoutContract(
  doc: MosaicDocument,
  ctx: MosaicEngineContext,
  opts: WithLayoutContractOptions,
): MosaicDocument {
  if (!opts.debug) return doc;

  const W = Math.max(1, Math.round(ctx.target.width));
  const H = Math.max(1, Math.round(ctx.target.height));
  const result = checkLayout(doc, { canvasW: W, canvasH: H, constraints: opts.constraints, relations: opts.relations, flatten: opts.flatten });

  const stamp: MosaicLayoutContractStamp = {
    ok: result.ok,
    violations: result.violations,
    constraintCount: (opts.constraints?.length ?? 0) + (opts.relations?.length ?? 0),
    canvas: { w: W, h: H },
    templateId: opts.templateId,
  };

  // debug on = SHOW the contract, both ways. Pass → the same wireframe with
  // every rule member green + a banner listing each rule's measured result
  // (a passing contract that no-ops is indistinguishable from one that never
  // ran). Fail → offenders red + the violation text. Fall back to the old
  // non-visual behavior when the wireframe can't be built.
  const wire = buildContractWireframe({
    templateId: opts.templateId,
    canvasW: W,
    canvasH: H,
    fps: ctx.target.fps ?? doc.fps,
    durationMs: ctx.target.durationMs ?? doc.durationMs,
    doc,
    violations: result.violations,
    constraints: opts.constraints,
    relations: opts.relations,
    flatten: opts.flatten,
    boxes: opts.violationBoxes,
  });

  if (result.ok) return stampedLayout(wire ?? doc, stamp, wire ? {} : result.resolvedLabels);
  if (wire) return stampedLayout(wire, stamp, {});

  const shown = result.violations.slice(0, MAX_ERROR_LINES).map((v) => v.detail);
  const extra = result.violations.length - shown.length;
  const message = shown.join("\n") + (extra > 0 ? `\n...and ${extra} more violation${extra === 1 ? "" : "s"}.` : "");

  const err = makeErrorMosaic(message, {
    width: W,
    height: H,
    title: `Layout contract — ${opts.templateId}`,
    errorCode: "LAYOUT_CONTRACT",
  });
  const errDoc: MosaicDocument = {
    ...err,
    fps: ctx.target.fps ?? doc.fps,
    durationMs: ctx.target.durationMs ?? doc.durationMs,
    size: { width: W, height: H },
  };
  return stampedLayout(errDoc, stamp, {});
}

/** Throwing sibling — for unit tests / CI. */
export function assertLayout(
  doc: MosaicDocument,
  ctx: MosaicEngineContext,
  templateId: string,
  opts: AssertLayoutOptions,
): void {
  const W = Math.max(1, Math.round(ctx.target.width));
  const H = Math.max(1, Math.round(ctx.target.height));
  const result = checkLayout(doc, { canvasW: W, canvasH: H, constraints: opts.constraints, relations: opts.relations, flatten: opts.flatten });
  if (!result.ok) {
    const lines = result.violations.map((v) => `  • ${v.detail}`).join("\n");
    throw new Error(
      `${templateId}: layout contract violated at ${W}×${H} ` +
        `(${result.violations.length} violation${result.violations.length === 1 ? "" : "s"}):\n${lines}`,
    );
  }
}
