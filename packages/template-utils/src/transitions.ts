/**
 * transitions.ts — authoring ergonomics for pipeline boundary transitions.
 *
 * The typed/engine layers already ship the transition surface: the
 * {@link MosaicPipelineTransition} union, the 58-mode {@link MosaicXfadeMode}
 * catalog ({@link MOSAIC_XFADE_MODES}), the per-step `transitionToNext` hint,
 * the pipeline-level `defaultTransition`, and the engine lowering
 * (`makePipelineXfadeCmd`). This module is the **template-author-facing**
 * helper layer over that surface — validated constructors + a runner-loop
 * sugar — so templates never hand-write transition literals. It touches no
 * engine code.
 *
 * ## The three transition shapes
 * - `{ type: "cut" }` — hard cut, no overlap.
 * - `{ type: "fade", durationMs }` — the plain cross-dissolve sugar; the
 *   engine lowers it to the xfade `"fade"` kind.
 * - `{ type: "xfade", kind, durationMs }` — any of the 58 catalog wipes/
 *   dissolves (`circleopen`, `slideleft`, `wipedown`, …).
 *
 * ## Overlap model (why durationMs matters)
 * An xfade/fade boundary **overlaps** the two neighbouring clips: for clips of
 * length A and B joined by a `durationMs = d` transition, the concatenated
 * output runs `A + B − d`, not `A + B`. `d` must be strictly less than the
 * shorter neighbour or the engine clamps it. A `cut` has `d = 0` and no
 * overlap. Pick `d` well under the beat length (a few hundred ms reads as a
 * transition; a multi-second `d` eats the clips).
 *
 * ## Why no `"custom"`
 * The catalog is a closed union — `"custom"` (arbitrary ffmpeg xfade expr) is
 * deliberately unrepresentable in {@link MosaicXfadeMode} AND rejected at
 * runtime here, so a stringly-typed caller can't smuggle an unvalidated
 * expression into the filtergraph. Use a catalog mode or `cut`.
 *
 * All constructors fail fast (template contract §10): a non-catalog kind or a
 * non-positive / non-finite `durationMs` throws rather than emitting a
 * malformed transition. Durations are rounded to whole milliseconds.
 */
import type { MosaicPipelineTransition, MosaicXfadeMode, MosaicPipelineStep } from "@m0saic/types";
import { MOSAIC_XFADE_MODES, MOSAIC_XFADE_MODES_SET } from "@m0saic/types";

export type { MosaicPipelineTransition, MosaicXfadeMode } from "@m0saic/types";
export { MOSAIC_XFADE_MODES, MOSAIC_XFADE_MODES_SET } from "@m0saic/types";

/** Type guard over the 58-mode xfade catalog. Rejects `"custom"` and any
 *  non-catalog string. */
export function isXfadeMode(kind: string): kind is MosaicXfadeMode {
  return MOSAIC_XFADE_MODES_SET.has(kind);
}

/** Validate a transition duration: finite, and a positive whole number of ms
 *  after rounding (so a sub-0.5ms value that would round to 0 is rejected). */
function assertDurationMs(durationMs: number, fn: string): number {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    throw new Error(`${fn}: durationMs must be a finite number, got ${String(durationMs)}`);
  }
  const rounded = Math.round(durationMs);
  if (rounded <= 0) {
    throw new Error(
      `${fn}: durationMs must round to a positive whole number of ms, got ${String(durationMs)}`,
    );
  }
  return rounded;
}

/** Hard cut — no overlap. */
export function cut(): MosaicPipelineTransition {
  return { type: "cut" };
}

/** Plain cross-dissolve of `durationMs` (lowered by the engine to xfade
 *  `"fade"`). */
export function fade(durationMs: number): MosaicPipelineTransition {
  return { type: "fade", durationMs: assertDurationMs(durationMs, "fade") };
}

/** A catalog xfade wipe/dissolve of `durationMs`. Throws if `kind` is not one
 *  of the 58 {@link MOSAIC_XFADE_MODES} (this is where `"custom"` is
 *  rejected). */
export function xfade(kind: MosaicXfadeMode, durationMs: number): MosaicPipelineTransition {
  if (!isXfadeMode(kind)) {
    throw new Error(
      `xfade: "${String(kind)}" is not a valid xfade mode. Use one of MOSAIC_XFADE_MODES or cut().`,
    );
  }
  return { type: "xfade", kind, durationMs: assertDurationMs(durationMs, "xfade") };
}

/**
 * One-call constructor:
 * - `transition("cut")` → hard cut (`durationMs` ignored).
 * - `transition("fade", 350)` → the fade sugar.
 * - `transition("circleopen", 350)` → an xfade wipe.
 *
 * `durationMs` is required for every non-`cut` kind.
 */
export function transition(
  kind: "cut" | MosaicXfadeMode,
  durationMs?: number,
): MosaicPipelineTransition {
  if (kind === "cut") return cut();
  if (durationMs === undefined) {
    throw new Error(`transition: "${String(kind)}" requires a durationMs.`);
  }
  if (kind === "fade") return fade(durationMs);
  return xfade(kind, durationMs);
}

/**
 * Runner sugar: stamp `transitionToNext` on every output step that doesn't
 * already declare one, except the last output step (which has no following
 * boundary). This factors the ffmpeg-pulse runner's hand-written per-beat
 * loop.
 *
 * Rules:
 * - **Intermediate steps** (`intermediate: true`) are left untouched —
 *   `transitionToNext` is ignored on them (they don't join the concat chain).
 * - The **last non-intermediate step** is left untouched — no next boundary.
 * - A step that **already sets** `transitionToNext` keeps its own value.
 * - **Pure:** the input array and its step objects are never mutated; stamped
 *   steps are returned as new objects.
 */
export function applyTransitionsBetween(
  steps: MosaicPipelineStep[],
  t: MosaicPipelineTransition,
): MosaicPipelineStep[] {
  // Index of the last output (non-intermediate) step — its boundary has no
  // "next" to transition to.
  let lastOutputIdx = -1;
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i].intermediate) lastOutputIdx = i;
  }

  return steps.map((step, i) => {
    if (step.intermediate) return step;
    if (i === lastOutputIdx) return step;
    if (step.transitionToNext !== undefined) return step;
    return { ...step, transitionToNext: t };
  });
}
