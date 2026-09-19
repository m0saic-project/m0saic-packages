/**
 * Two orthogonal axes coexist on a candidate:
 *
 *   - `LayoutIntent` (from `../scoring`) — **structural kind** of the
 *     candidate's geometry (grid / comparison / spotlight / …). Picked by the
 *     scorer's caller so `scoreLayout` uses the right weight row.
 *   - `SessionCategory` (this file) — **kind of exploration** the session is
 *     performing (spacing-alignment / hierarchy-emphasis / …). Picked by the
 *     human or agent to classify what the iteration is FOR.
 *
 * A single candidate has both: a `grid`-shaped layout can sit inside a
 * `spacing-alignment` session (we're refining the gutters of that grid). The
 * vocabulary contract in `./README.md` spells this out with a worked example.
 */

/**
 * Starter taxonomy of session categories. Closed union — new entries land
 * here once a pattern recurs in real `KnownCategory: "other"` uses ~3+
 * times. Until then `{ kind: "other", label }` is the escape hatch.
 *
 * **DRAFT** — these nine are the Plan-agent's best guess; the user reviews
 * and refines before Pillar B's serializer changes land. See the plan's
 * open question #1.
 */
export type KnownCategory =
  /** Greenfield: the agent proposes the first geometry from a prose brief. */
  | "scaffold-from-scratch"
  /** Refining gaps, padding, optical alignment of an existing layout. */
  | "spacing-alignment"
  /** Reweighting which region reads first / second / third. */
  | "hierarchy-emphasis"
  /** Making a layout survive long titles, missing data, extreme ratios. */
  | "edge-case-handling"
  /** Swapping palettes / contrast under fixed geometry. */
  | "color-palette-exploration"
  /** Building reusable template machinery (props, defaults, internals). */
  | "template-scaffolding"
  /** Figuring out what data the layout needs to consume. */
  | "data-shape-exploration"
  /** Porting one layout across canvases (desktop → mobile → story). */
  | "geometry-translation"
  /** Walking through a finished session for documentation / learning. */
  | "review-postmortem";

/**
 * The category a session is exploring. Closed union with an explicit escape
 * hatch — when the closed list doesn't fit, write `{ kind: "other", label }`
 * with a short slug; recurring labels graduate to first-class
 * `KnownCategory` entries.
 */
export type SessionCategory =
  | { kind: "known"; value: KnownCategory }
  | { kind: "other"; label: string };

/**
 * What a single candidate (or the whole session) is trying to accomplish.
 * Prose-ish — `summary` carries the free-form description — paired with an
 * optional verb classification that helps train future routing.
 */
export type SessionIntent = {
  /** One-line description of THIS candidate's goal. Free-form prose. */
  summary: string;
  /**
   * Verb classification, closed union. Used to identify session-arc
   * landmarks (the candidate that "ships" closes the session; an "abandon"
   * marks a dead end worth knowing about).
   */
  action?: "propose" | "refine" | "branch" | "revert" | "ship" | "abandon";
};
