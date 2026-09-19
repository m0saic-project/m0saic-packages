/**
 * withGeometryContract — the dev tripwire. Wrap a template's return:
 *
 *   return withGeometryContract(doc, ctx, {
 *     templateId, expectations, debug: props.debugGeometry,
 *   });
 *
 * `debug` falsy (the deterministic default) → returns `doc` UNTOUCHED with ZERO
 * cost (no parse, no allocation). `debug` true → runs the checker and ALWAYS
 * stamps `editor.geometryContract` (pass OR fail, for external sweeps); on
 * violations it returns a `makeErrorMosaic` at `ctx.target` dims with errorCode
 * `GEOMETRY_CONTRACT` and one capped line per violation — the render SURVIVES
 * and the composition shows WHERE and WHY, at exactly the canvas that broke.
 */

import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicGeometryContractStamp,
} from "@m0saic/types";
import { makeErrorMosaic } from "../sources/makeErrorMosaic";
import { checkDocGeometry } from "./checkDocGeometry";
import { buildGeometryContractWireframe } from "./violationWireframe";
import type { GeometryExpectation, GeometryViolation } from "./types";

/** Error-mosaic payload budget — the rest goes to the throw message + the matrix. */
export const MAX_ERROR_LINES = 6;

export type WithGeometryContractOptions = {
  templateId: string;
  expectations: GeometryExpectation[];
  /** Dev gate — falsy (default) returns `doc` UNTOUCHED at zero cost. */
  debug?: boolean;
  /** Default per-edge tolerance (px). See `checkDocGeometry`. */
  tolerancePx?: number;
};

/** Cap the violation list into an error-mosaic message (`...and N more`). */
export function formatViolationsMessage(
  violations: GeometryViolation[],
  max: number = MAX_ERROR_LINES,
): string {
  const shown = violations.slice(0, max).map((v) => v.detail);
  const extra = violations.length - shown.length;
  return (
    shown.join("\n") +
    (extra > 0 ? `\n...and ${extra} more violation${extra === 1 ? "" : "s"}.` : "")
  );
}

/**
 * Merge the stamp onto a shallow clone's `editor` namespace (non-mutating), and
 * backfill `doc.labels` from any source tags the checker resolved (stableKey →
 * label), so running the contract also populates the human-readable label map.
 */
function stamped(
  doc: MosaicDocument,
  stamp: MosaicGeometryContractStamp,
  resolvedLabels: Record<string, string>,
): MosaicDocument {
  const mergedLabels = { ...(doc.labels ?? {}), ...resolvedLabels };
  const hasLabels = Object.keys(mergedLabels).length > 0;
  return {
    ...doc,
    ...(hasLabels ? { labels: mergedLabels } : {}),
    editor: { ...doc.editor, geometryContract: stamp },
  };
}

export function withGeometryContract(
  doc: MosaicDocument,
  ctx: MosaicEngineContext,
  opts: WithGeometryContractOptions,
): MosaicDocument {
  // Zero-cost when off: return the SAME reference, no parse, no allocation.
  if (!opts.debug) return doc;

  const W = Math.max(1, Math.round(ctx.target.width));
  const H = Math.max(1, Math.round(ctx.target.height));
  const result = checkDocGeometry(doc, {
    canvasW: W,
    canvasH: H,
    expectations: opts.expectations,
    tolerancePx: opts.tolerancePx,
  });

  const stamp: MosaicGeometryContractStamp = {
    ok: result.ok,
    violations: result.violations,
    floors: result.floors,
    matched: result.matched,
    expectationCount: opts.expectations.length,
    canvas: { w: W, h: H },
    templateId: opts.templateId,
  };

  // debug on = SHOW the contract, both ways (same treatment as the layout
  // contract, 2026-08-20): PASS → every expected element green + "N elements
  // exact" banner (a passing no-op is indistinguishable from a contract that
  // never ran); FAIL → realized boxes red with the INTENDED rect as an amber
  // ghost outline, so the drift is visible as the gap between the two. Falls
  // back to the old non-visual behavior when the wireframe can't be built.
  const wire = buildGeometryContractWireframe({
    templateId: opts.templateId,
    canvasW: W,
    canvasH: H,
    fps: ctx.target.fps ?? doc.fps,
    durationMs: ctx.target.durationMs ?? doc.durationMs,
    doc,
    expectations: opts.expectations,
    violations: result.violations,
    matched: result.matched,
    tolerancePx: opts.tolerancePx,
  });

  if (result.ok) {
    // The wireframe REPLACES the doc, and it sets no `editor.label` of its
    // own — so the doc's label (which describes what the template actually
    // built, and which templates gate behind the same `debug` flag) was
    // dropped for nothing on every PASSING debug render. Carry it across.
    const out =
      wire && doc.editor?.label && !wire.editor?.label
        ? { ...wire, editor: { ...wire.editor, label: doc.editor.label } }
        : (wire ?? doc);
    return stamped(out, stamp, wire ? {} : result.resolvedLabels);
  }
  if (wire) return stamped(wire, stamp, {});

  // Violations → LOUD error mosaic at the target dims, capped payload. The
  // source is engine-marked `renderStatus:"error"` by makeErrorMosaic (UI can
  // disable Make deterministically); carry timing/size so it renders in the
  // same slot as the doc it replaces.
  const err = makeErrorMosaic(formatViolationsMessage(result.violations), {
    width: W,
    height: H,
    title: `Geometry contract — ${opts.templateId}`,
    errorCode: "GEOMETRY_CONTRACT",
  });
  const errDoc: MosaicDocument = {
    ...err,
    fps: ctx.target.fps ?? doc.fps,
    durationMs: ctx.target.durationMs ?? doc.durationMs,
    size: { width: W, height: H },
  };
  // The error mosaic replaces the doc — its stableKeys differ, so no label
  // backfill (the original doc + its labels are discarded on failure).
  return stamped(errDoc, stamp, {});
}
