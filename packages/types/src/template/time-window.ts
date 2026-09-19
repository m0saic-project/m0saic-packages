/**
 * Canonical declarative time-window spec for animated templates.
 *
 * The timing mental model is three nouns: the **clip** `[0, durationMs]`
 * (owned by the render/pipeline via `ctx.target` — templates never invent
 * time), **windows** carved from it (WHEN something happens), and **tracks**
 * (WHAT moves inside a window — keyframes, gates, entrance/exit).
 * `MosaicTimeWindow` is the shared vocabulary for one window: a JSON spec a
 * parent can hand to every animated child, each resolving it identically via
 * `resolveWindow(window, durationMs)` in `@m0saic/template-utils`.
 *
 * The first (and overwhelmingly most common) consumer is the intro: the prop
 * convention is `intro?: MosaicTimeWindow`. An outro or any later window
 * reuses this same type and resolver — the noun generalizes; the prop key
 * stays human. Evolved from the 2026-06-18 "shared animation timing"
 * candidate's `MosaicIntro` (option A), generalized 2026-07-05 after a
 * fleet inventory found ~17 bespoke timing dialects re-expressing these
 * fields; F4's per-piece visits migrate templates onto this shape and delete
 * the bespoke dialects (founder-approved: no deprecated fallbacks).
 *
 * Deliberately JSON-serializable (no functions, no branded types): the same
 * spec shape is what a UI timeline band (Make's TimelinePanel thinks in ms
 * bands) or a future `.m0t` temporal sidecar can serialize and round-trip.
 */
export type MosaicTimeWindow = {
  /** Window length as a fraction of the render duration (0..1). */
  fraction?: number;
  /** Absolute window length (ms). Overrides `fraction`. */
  ms?: number;
  /** Start offset from t=0 (ms). Default 0. */
  delayMs?: number;
  /** Per-item cascade (ms), for templates that stagger. Default 0. */
  staggerMs?: number;
  /** Easing over the window's ramp. */
  ease?: "linear" | "smoothstep" | "easeOut" | "easeInOut";
};
