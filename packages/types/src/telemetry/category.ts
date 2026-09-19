/**
 * Faceted bucket for a {@link MosaicTelemetryEvent}, used to filter the
 * stream by subsystem (e.g. "show me only runtime + plan events").
 *
 * Closed registry on the same precedent as `MOSAIC_DIAGNOSTIC_CODES` —
 * an open string would invite typos and silent drift. Adding a new
 * category is a minor-version safe addition; removing one is a major.
 *
 * # Naming convention
 *
 * Two dot-separated segments: `<package>.<phase>`. The leading
 * segment names the source package (engine, platform, ui); the
 * trailing segment names the lifecycle phase that emits.
 *
 * # Current categories
 *
 *  - `engine.template`  — `MosaicTemplate.render()` execution
 *  - `engine.plan`      — flatten / weigh / schedule planner phases
 *  - `engine.runtime`   — ffmpeg command execution (mirrors RenderEvent)
 *  - `engine.resolve`   — `.mosaicx` → `.mosaic` resolver phase
 *                        (walks `template_invocation` sources and
 *                        materializes each into a child renderable)
 *  - `platform.jobs`    — individual job-run lifecycle
 *  - `platform.sets`    — job-set (multi-job) lifecycle
 *  - `platform.batch`   — batch-mode aggregate counters / summaries
 */
export const MOSAIC_TELEMETRY_CATEGORIES = [
  "engine.template",
  "engine.plan",
  "engine.runtime",
  "engine.resolve",
  "platform.jobs",
  "platform.sets",
  "platform.batch",
] as const;

export type MosaicTelemetryCategory =
  (typeof MOSAIC_TELEMETRY_CATEGORIES)[number];

const CATEGORY_SET: ReadonlySet<string> = new Set(MOSAIC_TELEMETRY_CATEGORIES);

/** Runtime predicate: is `v` a known {@link MosaicTelemetryCategory}? */
export const isMosaicTelemetryCategory = (
  v: unknown,
): v is MosaicTelemetryCategory =>
  typeof v === "string" && CATEGORY_SET.has(v);
