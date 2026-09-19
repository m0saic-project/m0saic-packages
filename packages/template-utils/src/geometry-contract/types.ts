/**
 * Geometry contract — the spatial sibling of `assertTiming`.
 *
 * A template is `(props, canvas) → m0`: it computes intended rects in JS pixel
 * math, encodes them, and throws the intent away at return. This module lets a
 * template DECLARE those rects as expectations and check that the geometry it
 * computed survived to the pixels AT THIS CANVAS — catching the silent
 * quantization squashes (the stat-card icon 26→33px / value band 59→38px
 * incident) that every string-level tool misses because the STRING was healthy.
 *
 * See the internal template-geometry-contract notes, handbook
 * `feasibility-precision-quantization.md` §3, and `composition-arithmetic.md`
 * §4 (base × fiber — the inset lives in the fiber).
 */

import type {
  MosaicGeometryViolation,
  MosaicGeometryContractFloors,
  MosaicGeometryContractMatch,
  MosaicGeometryContractStamp,
} from "@m0saic/types";

/** One element's intended geometry + the assertions to run against its realized box. */
export type GeometryExpectation = {
  /** Human name for violation readouts ("value-band", "chip"). */
  name?: string;
  /**
   * Select the frame to check by its **StableKey** — the deterministic
   * structural path the parser assigns each node (e.g. `"r/gcolc2/fc2"`), the
   * SAME identity the editor's `geometryEdits` key on. GUARANTEED unique
   * selection: no positional zip / nearest-containing guessing, and you assert
   * ONLY the chrome you care about instead of enumerating every rect. Obtain a
   * key by parsing the m0 once (`frame.meta.stableKey`) or from a front-door
   * emitter that stamps it.
   *
   * **Index vs identity (keep in mind):** the checker works on FRAMES
   * (geometry), which carry the stableKey — so keyed geometry checks are clean.
   * But a `MosaicDocument` binds `sources[i]` to the i-th PAINTED frame by
   * INDEX, not by stableKey. Any code that maps a frame back to its source
   * (the emitters, Make's jump-to-piece) bridges through paint-order index, and
   * index↔stableKey drift if the m0's paint order changes.
   */
  stableKey?: string;
  /**
   * Intended rect in canvas px — the JS pixel-math truth. OPTIONAL: omit when
   * selecting by `stableKey` and asserting size / aspect only (`expectSize` /
   * `expectAspect` / `minPx`). When present it drives BOTH positional selection
   * (if no `stableKey`) AND the position+size assertion. At least one of
   * `stableKey` / `rect` must be given (the selector).
   */
  rect?: { x: number; y: number; w: number; h: number };
  /**
   * Assert the realized w/h independent of position — pairs with `stableKey`
   * for "this labeled chrome must be X×Y, wherever it landed". Ignored when
   * `rect` is present (rect's size check subsumes it).
   */
  expectSize?: { w?: number; h?: number };
  /**
   * Max px any realized edge may deviate. Default: `0` for inset-recovery
   * expectations (byte-exactness IS their contract), else the checker-level
   * default (`1` — the ≤1px healthy-ratio jitter is by design).
   */
  tolerancePx?: number;
  /** Assert the realized box's aspect ratio (w/h) within `aspectTolerance`. */
  expectAspect?: number;
  /** Aspect tolerance for `expectAspect` / `maskBounds`. Default `0.02`. */
  aspectTolerance?: number;
  /** Realized box must be at least this many px on each axis (clip guard). */
  minPx?: { w?: number; h?: number };
  /**
   * When the piece rides a recovery inset (placeInsetPieces), the check replays
   * the ENGINE's exact floor math (`Math.floor(f · cellDim)` per edge) against
   * the realized cell and asserts the recovered box — verifying the zero-drift
   * claim per element per canvas, not just trusting it. `null` / omitted = no
   * inset (the realized frame IS the painted box directly).
   */
  inset?: { top: number; right: number; bottom: number; left: number } | null;
  /** Mask bounds must scale 1:1 (undistorted) into the (post-inset) painted box. */
  maskBounds?: { width: number; height: number } | null;
};

/**
 * One intent-vs-realized discrepancy. Re-exported from `@m0saic/types` (the
 * canonical cross-package home) so private consumers read the identical shape.
 */
export type GeometryViolation = MosaicGeometryViolation;

/** `checkDocGeometry` result — the violation list + the `evaluateM0` floors. */
export type CheckDocGeometryResult = {
  ok: boolean;
  violations: GeometryViolation[];
  /** `evaluateM0` bundle at this canvas, for the matrix report. */
  floors: MosaicGeometryContractFloors;
  /**
   * Per-expectation resolved identity (stableKey ↔ sourceIndex ↔ label), one
   * entry per expectation in order — the reliable map for external tools,
   * resolved from the single parse this check already does.
   */
  matched: MosaicGeometryContractMatch[];
  /**
   * `stableKey → label` for every tagged source (`sources[i].editor.label`),
   * resolved from the same parse. `withGeometryContract` backfills `doc.labels`
   * from this so running the contract also populates the human-readable label
   * map that Make / `.m0c` / diagnostics read.
   */
  resolvedLabels: Record<string, string>;
};

/** The stamp written onto `editor.geometryContract`. Re-exported from `@m0saic/types`. */
export type GeometryContractStamp = MosaicGeometryContractStamp;
