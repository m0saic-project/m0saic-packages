/**
 * Probe per-cell average luminance from the source video at render
 * time. Populates the sidecar's `hostReference.luminanceGrid`, which
 * lets the decoder subtract the host signal cleanly and recover the
 * watermark with ~10 dB more SNR than blind correlation.
 *
 * This is the load-bearing "m0saic edge" the original plan called out
 * — the engine authored the geometry, so we can also tell the decoder
 * exactly what the host looked like before the watermark was applied.
 *
 * Implementation
 * --------------
 * A thin wrapper over the family's shared sampler
 * (`../../_shared/cellLuminance` → `ctx.analysis.cellLuminance`). All this
 * file adds is the options that make the probe see what the RENDER will
 * see:
 *
 *  - **cover-scale + center-crop** (`coverTo`), because the pipeline fits
 *    the source to the output canvas that way. Skip it and the cells
 *    reported don't correspond to the pixels actually composited.
 *  - **last-frame hold** (`holdLastFrame`), because when the requested
 *    duration outlasts the source the pipeline holds the final frame for
 *    the remainder. Skip it and the reference covers only the moving part
 *    while the delivered video is largely a frozen frame.
 *
 * Either omission leaves residual host bias that swamps the watermark
 * (α≈0.012 is only ~1.6 luma levels) and decode fails on real content.
 *
 * The cell-grid tail (`scale=COLS:ROWS:flags=area,format=gray`) and the
 * frame-averaging live in the engine pass, so the verify template runs
 * byte-identical sampling on the delivered file.
 *
 * Determinism
 * -----------
 * Deterministic given a deterministic source video. Re-encoded
 * sources at different bitrates may shift per-cell luminance by ±1;
 * BCH's error-correction tolerates this.
 */

import {
  CellSampleError,
  sampleCellLuminance,
  type CellLuminanceSampler,
} from "../../_shared/cellLuminance";

export interface ProbeHostInputs {
  videoPath: string;
  cols: number;
  rows: number;
  /**
   * Output canvas dimensions the watermark will be rendered at. The
   * probe applies the same cover-scale (`scale=W:H:force_original_aspect_ratio=increase,crop=W:H`)
   * the render pipeline does, so per-cell luminance matches exactly
   * after the source is composited onto the canvas. Without this
   * match, baseline subtraction leaves residual host bias and decode
   * fails on real-content frames.
   */
  canvasW: number;
  canvasH: number;
  /** Output frame rate the render will use. Probe matches it to align frame counts. */
  fps: number;
  /** Output duration ms the render will use. Probe trims source to match. */
  durationMs: number;
}

export interface ProbeHostResult {
  /** Per-cell average luminance (0..255), row-major, length cols*rows. */
  luminanceGrid: number[];
  /** Number of frames the average was computed over. */
  frameCount: number;
}

export class ProbeHostError extends Error {
  readonly code: CellSampleError["code"];
  constructor(code: CellSampleError["code"], message: string) {
    super(message);
    this.name = "ProbeHostError";
    this.code = code;
  }
}

export async function probeHostLuminance(
  sampler: CellLuminanceSampler | undefined,
  inputs: ProbeHostInputs,
): Promise<ProbeHostResult> {
  try {
    return await sampleCellLuminance(
      sampler,
      inputs.videoPath,
      {
        cols: inputs.cols,
        rows: inputs.rows,
        // Mirror the render pipeline's source-scale chain (cover-fit to
        // canvas, then center-crop) ahead of the cell-grid downsample…
        coverTo: { width: inputs.canvasW, height: inputs.canvasH },
        // …and what it does when the render OUTLASTS the source: the
        // pipeline holds the final frame for the remainder. Without this,
        // `-t` simply stops the probe at the source's end, so the reference
        // averages only the moving part while the delivered video is (often
        // mostly) a frozen frame. The two then describe different videos,
        // baseline subtraction leaves a large DC + per-cell bias, and
        // decode fails — silently and only for renders longer than their
        // source. A no-op when the source already covers the duration.
        holdLastFrame: true,
        // Pin rate + duration so the sampled frame count matches what the
        // watermarked output will produce.
        fps: inputs.fps,
        durationMs: inputs.durationMs,
      },
      "probe",
    );
  } catch (err) {
    // Re-home onto this module's error class: `forensic-watermark.ts`
    // branches on `instanceof ProbeHostError` to render an error card
    // instead of throwing.
    if (err instanceof CellSampleError) throw new ProbeHostError(err.code, err.message);
    throw err;
  }
}
