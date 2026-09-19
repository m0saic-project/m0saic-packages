/**
 * Audience layer for a {@link MosaicTelemetryEvent}.
 *
 * Four hard-separated tiers, not a single ordered axis. Each tier
 * has its own valid `level` union — narrowing on `tier` (or on
 * `kind`, which implies tier) narrows `level` too.
 *
 * - **`"m0saic"`** — the engine's own plumbing decisions. "I'm
 *   running command 3 of 5", "plan built in 12ms", "engine invoked
 *   template X", "pipeline step 2/4 starting". This tier answers
 *   *what is the engine doing*. Volume: low. Levels:
 *   {@link M0saicTelemetryLevel} (info / warn / error — no trace
 *   here; deep tracing is a `template` or `ffmpeg` concern).
 *
 * - **`"template"`** — events emitted BY a template via
 *   `getTelemetry(ctx).emit(...)`. Distinct audience from m0saic
 *   narration: a template author debugging their own logic wants to
 *   grep these in isolation, and a single template can fire orders
 *   of magnitude more events than the engine wrapping it. Volume:
 *   variable (template-author-controlled). Levels:
 *   {@link TemplateTelemetryLevel} (trace / info / warn / error).
 *
 * - **`"ffmpeg-boundary"`** — the *interface* between m0saic and
 *   ffmpeg. Events at this tier are everything you'd need to replay
 *   the render without m0saic in the loop: the full ffmpeg argv, the
 *   sidecar files (`.ffgraph` filtergraph scripts, lavfi inputs,
 *   workspace-relative input paths). This tier answers *what would
 *   I need to capture to reproduce this render?*. Volume: moderate
 *   (one event per ffmpeg invocation + one per sidecar file).
 *   Levels: {@link FfmpegBoundaryTelemetryLevel} — a single
 *   information level; events are not severity-graded.
 *
 * - **`"ffmpeg"`** — ffmpeg's own stderr stream and parsed
 *   diagnostics. The high-volume tier. This is what ffmpeg is
 *   *saying back* during a render — banners, codec init lines, mux
 *   warnings, errors. Off by default in most personas. Levels:
 *   {@link FfmpegTelemetryLevel} (trace / info / warn / error,
 *   matching ffmpeg's own log-level vocabulary).
 *
 * Filtering uses {@link byTier} (admit / drop entire tiers) or
 * {@link byTierLevel} (per-tier threshold) — both in `./sink`.
 */
export type MosaicTelemetryTier =
  | "m0saic"
  | "template"
  | "ffmpeg-boundary"
  | "ffmpeg";

/**
 * Severity for m0saic-tier events.
 *
 * - `"info"`  — top-line lifecycle ("plan built", "render started")
 * - `"warn"`  — recoverable irregularity ("CLI fps overrode doc fps")
 * - `"error"` — non-recoverable ("plan can't be built")
 *
 * No `"trace"` here. Deep tracing of template-internal logic lives
 * on the `"template"` tier; deep tracing of ffmpeg lives on the
 * `"ffmpeg"` tier. The m0saic tier is the engine's high-level
 * narration only.
 */
export type M0saicTelemetryLevel = "info" | "warn" | "error";

/**
 * Severity for template-tier events.
 *
 * Templates emit at this tier via `getTelemetry(ctx).emit(...)`.
 * Levels match ffmpeg's four-tier vocabulary so a template author
 * can do `trace`-level instrumentation of internal logic without
 * cluttering the engine's m0saic-tier narration.
 *
 * - `"trace"` — fine-grain template instrumentation (per-loop body,
 *   per-fetched-item, per-decision-branch). Off in every persona
 *   except `template-dev`.
 * - `"info"`  — meaningful template milestones (fetched N items
 *   from API, generated K children).
 * - `"warn"`  — recoverable in-template issue (input field missing,
 *   fell back to default value).
 * - `"error"` — template emitted an error (will likely surface as
 *   a `MosaicDiagnostic` too; the telemetry is the narrative beat).
 */
export type TemplateTelemetryLevel = "trace" | "info" | "warn" | "error";

/**
 * Severity for ffmpeg-boundary-tier events.
 *
 * Single-level union: boundary events are *classifiers* (this is a
 * replay anchor), not severity-graded. Filtering at this tier
 * happens via tier inclusion / exclusion, not by level threshold.
 *
 * Modelled as a literal type rather than `never` or omitted so the
 * envelope shape stays uniform: every event has `tier` AND `level`,
 * and downstream NDJSON serializers can read both fields
 * unconditionally.
 */
export type FfmpegBoundaryTelemetryLevel = "info";

/**
 * Severity for ffmpeg-tier events. Matches ffmpeg's own log-level
 * vocabulary (`-loglevel trace|info|warning|error`), modulo the
 * `warning` → `warn` rename for consistency with the m0saic tier.
 *
 * - `"trace"` — ffmpeg's deepest internal logs (decoder state,
 *   filter init details). Massive volume — generally only useful
 *   when reproducing a specific ffmpeg-internal bug.
 * - `"info"`  — banners, codec init, normal mux progress
 * - `"warn"`  — recoverable irregularity (deprecated option, codec
 *   substituted internally)
 * - `"error"` — non-recoverable ffmpeg failure
 */
export type FfmpegTelemetryLevel = "trace" | "info" | "warn" | "error";

/**
 * Union of every level value that can appear in {@link MosaicTelemetryEvent}.
 *
 * Useful for cross-tier ranking ({@link LEVEL_RANK}, {@link byLevel})
 * when a caller wants "everything at severity X or louder regardless
 * of tier" — e.g. an `oss-quiet` persona that ignores tier but only
 * surfaces errors anywhere in the stack.
 *
 * The per-tier unions ({@link M0saicTelemetryLevel} etc.) are the
 * authoritative shapes — the envelope variant for each tier types
 * `level` against its specific union, so an `event.tier === "m0saic"`
 * narrowing also narrows `event.level` to `info | warn | error`.
 */
export type MosaicTelemetryLevel = "trace" | "info" | "warn" | "error";

/**
 * Integer ordering for {@link MosaicTelemetryLevel}.
 *
 * Higher = louder. `byLevel("warn")` admits warn + error and drops
 * trace + info. The mapping is shared across all tiers — when
 * comparing levels across tiers (e.g. "is this ffmpeg `trace` louder
 * than that m0saic `info`?"), the cross-tier rank is the comparison.
 */
export const LEVEL_RANK: Readonly<Record<MosaicTelemetryLevel, number>> = {
  trace: 5,
  info: 20,
  warn: 30,
  error: 40,
};
