/**
 * The forensic-watermark family's one way to sample a video into a per-cell
 * luminance grid: `ctx.analysis.cellLuminance`, the engine-owned pass bound
 * to the host's toolchain ffmpeg.
 *
 * Both halves of the family go through this file so they provably run the
 * same filtergraph — the embed side probes the SOURCE, the verify side
 * samples the DELIVERED copy, and baseline subtraction only recovers the
 * payload because the two chains match. The chain itself lives in
 * `@m0saic/core` (`probeCellLuminance`); templates never spawn ffmpeg
 * themselves, so a packaged desktop with no `ffmpeg` on PATH works exactly
 * like the CLI.
 *
 * `ctx.analysis` is absent in `mode: "design"` (previews must never spawn)
 * and on hosts without a toolchain. Callers turn {@link CellSampleError}
 * into an error card / error verdict — never a throw out of `render()`.
 */

import type {
  MosaicCellLuminanceOpts,
  MosaicCellLuminanceResult,
  MosaicEngineContext,
} from "@m0saic/types";

export type CellLuminanceSampler = (
  mediaPath: string,
  opts: MosaicCellLuminanceOpts,
) => Promise<MosaicCellLuminanceResult>;

export class CellSampleError extends Error {
  readonly code: "ANALYSIS_UNAVAILABLE" | "SAMPLING_FAILED";
  constructor(code: "ANALYSIS_UNAVAILABLE" | "SAMPLING_FAILED", message: string) {
    super(message);
    this.name = "CellSampleError";
    this.code = code;
  }
}

export const ANALYSIS_UNAVAILABLE_MESSAGE =
  "This host attached no media analysis (ffmpeg toolchain not available). " +
  "Run `m0saic setup` (CLI) or pick a toolchain under Tools (desktop) and render again.";

/**
 * Resolve the sampler off the engine context. Undefined when the host
 * attached no analysis surface — callers decide how to degrade.
 */
export function cellLuminanceSampler(
  ctx: Pick<MosaicEngineContext, "analysis">,
): CellLuminanceSampler | undefined {
  const fn = ctx.analysis?.cellLuminance;
  if (typeof fn !== "function") return undefined;
  return (mediaPath, opts) => fn.call(ctx.analysis, mediaPath, opts);
}

/**
 * Sample through the engine pass, re-homing every failure onto
 * {@link CellSampleError} so callers branch on one class.
 *
 * @param label Verb for the message ("probe" / "sampling") — cosmetic, it
 * lets each caller's failure read naturally on a user-facing card.
 */
export async function sampleCellLuminance(
  sampler: CellLuminanceSampler | undefined,
  mediaPath: string,
  opts: MosaicCellLuminanceOpts,
  label: "probe" | "sampling" = "sampling",
): Promise<MosaicCellLuminanceResult> {
  if (!sampler) {
    throw new CellSampleError("ANALYSIS_UNAVAILABLE", ANALYSIS_UNAVAILABLE_MESSAGE);
  }
  try {
    return await sampler(mediaPath, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CellSampleError(
      "SAMPLING_FAILED",
      `ffmpeg ${label} failed for ${mediaPath}: ${message}`,
    );
  }
}
