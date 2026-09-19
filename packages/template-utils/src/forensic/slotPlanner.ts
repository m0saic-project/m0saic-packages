/**
 * Slot/frame planning for forensic watermarking.
 *
 * The v1 algorithm is **spatial-primary**: every frame of the
 * watermarked clip carries the full BCH codeword across its cell
 * grid. Temporal averaging at decode time adds noise rejection.
 * This planner mostly computes metadata for the sidecar and
 * sanity-checks the clip is long enough to produce a usable
 * watermark.
 *
 * Returned `count: 1` and `framesPerSlot: totalFrames` reflect the
 * spatial-primary design — the entire clip is "one slot" in the
 * temporal-modulation sense.
 *
 * A future v2 may multiplex across temporal slots (different
 * codeword sub-payloads per slot) for higher capacity; that change
 * will live in this module without changing the sidecar shape.
 */

export interface SlotPlan {
  /** Number of temporal slots. v1 = 1 (purely spatial). */
  count: number;
  /** Frames in each slot. v1 = total frames in the clip. */
  framesPerSlot: number;
  /** Output-timeline ms when slot 0 begins. */
  startMs: number;
  /**
   * Spatial repetition: number of cells assigned to each codeword
   * bit (= `floor(cols * rows / codewordBits)`).
   */
  repetition: number;
}

export interface PlanSlotsOpts {
  /** Clip duration in ms. */
  durationMs: number;
  /** Output frame rate. */
  fps: number;
  /** Cell grid columns. */
  cols: number;
  /** Cell grid rows. */
  rows: number;
  /** Codeword length (BCH n). */
  codewordBits: number;
  /**
   * Minimum frames required for a usable watermark. Default 4 — fewer
   * than this leaves too little temporal averaging headroom against
   * codec quantization noise.
   */
  minFrames?: number;
}

const DEFAULT_MIN_FRAMES = 4;

export function planSlots(opts: PlanSlotsOpts): SlotPlan {
  const {
    durationMs,
    fps,
    cols,
    rows,
    codewordBits,
    minFrames = DEFAULT_MIN_FRAMES,
  } = opts;

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error(`planSlots: durationMs must be > 0 (got ${durationMs})`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`planSlots: fps must be > 0 (got ${fps})`);
  }
  if (cols < 1 || rows < 1) {
    throw new Error(
      `planSlots: cols/rows must be ≥ 1 (got ${cols}×${rows})`,
    );
  }
  if (codewordBits < 1) {
    throw new Error(`planSlots: codewordBits must be ≥ 1 (got ${codewordBits})`);
  }

  const totalFrames = Math.max(1, Math.floor((durationMs * fps) / 1000));
  if (totalFrames < minFrames) {
    throw new Error(
      `planSlots: clip too short — ${totalFrames} frame(s) at ${fps}fps for ` +
        `${durationMs}ms, need ≥ ${minFrames}. Either lengthen the clip or ` +
        `lower minFrames.`,
    );
  }

  const cellCount = cols * rows;
  if (codewordBits > cellCount) {
    throw new Error(
      `planSlots: codewordBits (${codewordBits}) > cells (${cellCount}); ` +
        `widen the cell grid or pick a smaller codeword`,
    );
  }
  const repetition = Math.floor(cellCount / codewordBits);

  return {
    count: 1,
    framesPerSlot: totalFrames,
    startMs: 0,
    repetition,
  };
}
