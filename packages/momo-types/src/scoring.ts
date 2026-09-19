/**
 * Public types for `scoreLayout` — the AI-evaluation primitive that
 * grades a m0saic DSL string. Lives in `@m0saic/momo-types` so callers
 * (file-format layer, candidate evaluation, the post-mortem template)
 * can reference the typed result without taking a dep on the scoring
 * runtime. The values (`WEIGHTS`, `THRESHOLDS`, `scoreLayout`, quality
 * curves) live in `@m0saic/momo/scoring`.
 */

/**
 * Categorical hint for what kind of layout the DSL is expected to be.
 * Drives which metrics carry weight (see `WEIGHTS` in
 * `@m0saic/momo/scoring`).
 *
 * Pick the closest match for hand-authored DSL; for generator output,
 * pass the generator's id directly (matches one-to-one with intents).
 *
 * **Source of truth for the union members:** kept in sync with the
 * `WEIGHTS` keys in `packages/momo/src/scoring/scoreLayout.ts` via a
 * `satisfies Record<LayoutIntent, ...>` assertion on the runtime side.
 * Adding a new intent: add a member here AND a row in `WEIGHTS`.
 */
export type LayoutIntent =
  | "grid"
  | "comparison"
  | "spotlight"
  | "magazine"
  | "ranked-list"
  | "free";

/** Input to `scoreLayout`. */
export type ScoreInput = {
  /** Canonical or pretty m0saic DSL string. */
  dsl: string;
  /** Output canvas dimensions in pixels. */
  canvas: { width: number; height: number };
  /** Layout category — drives metric weighting. */
  intent: LayoutIntent;
};

/** Per-metric score component — useful for telemetry / explainability. */
export type ScoreComponent = {
  /** 0..1 quality contribution from this metric (1 = ideal, 0 = unusable). */
  quality: number;
  /** Weight pulled from `WEIGHTS[intent]` — 0 means the metric was skipped. */
  weight: number;
  /** Raw metric value (px, count, ratio…) for downstream display. */
  raw: number;
};

/** Six metric keys that make up a score breakdown. */
export type ScoreComponentKey =
  | "precision"
  | "spread"
  | "gutter"
  | "frames"
  | "structure"
  | "compactness";

/** Output of `scoreLayout`. */
export type ScoreBreakdown = {
  /**
   * Aggregate score in 0..1 where 1 is ideal. NaN when `feasible` is false
   * — callers should filter on `feasible` before sorting.
   */
  total: number;
  /**
   * Whether the layout fits the canvas. False ⇒ precision exceeds canvas
   * (one or more cells would round to <1px on at least one axis).
   * Hard reject — never weighted into the score.
   */
  feasible: boolean;
  /** Human-readable reason when `feasible: false`. Omit otherwise. */
  reason?: string;
  /** Per-metric breakdown. Always populated, even when infeasible. */
  components: Record<ScoreComponentKey, ScoreComponent>;
};
