import type { LoopMode } from "../source/source";

/**
 * Maximum number of segment files fed to a single pipeline stitch pass.
 *
 * This avoids:
 *   - OS command line length limits
 *   - ffmpeg input graph limits
 *   - excessive memory usage during concat
 *
 * Past this ceiling the planner reduces in batched cut-concat rounds and
 * drops ALL xfade transitions (the xfade chain is a single command over
 * every input, so it can't be batched).
 *
 * 80 is a conservative cross-platform default.
 *
 * Lives in `@m0saic/types` — not `@m0saic/core` — because the timeline
 * math in {@link computePipelineTimeline} has to reproduce the
 * drop-all-transitions rule, and that math is consumed by public
 * packages and the web app, neither of which may depend on core.
 */
export const DEFAULT_MAX_PIPELINE_CONCAT_INPUTS = 80;

/**
 * Fit mode used when a pipeline declares a `durationMs` that differs
 * from its natural (overlap-adjusted) length and sets no
 * `durationFit`.
 *
 * `"loop"` matches the default a NESTED pipeline already gets from its
 * embedding source's `playback.loopMode` — a pipeline should fit the
 * same way whether the target duration comes from a parent slot or
 * from its own declaration.
 */
export const DEFAULT_PIPELINE_DURATION_FIT: LoopMode = "loop";
