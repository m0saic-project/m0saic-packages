/**
 * Compute how many frames a video-fan-out template should emit, given a
 * duration in ms and a frame rate. Shared so per-frame templates (Frame
 * Stripper today; future "extract-every-Nth-frame" / "split-into-clips"
 * variants) agree on the rounding rule and the cap semantics — drift on
 * `Math.round` vs `Math.floor` vs `Math.ceil` at boundary fps values is
 * exactly the kind of bug that's painful to notice.
 *
 * Rounding rule: `Math.round(durationMs / frameDurationMs)`. A 1000ms
 * clip at 24fps yields 24 frames (1000 / (1000/24) ≈ 24.0 exactly).
 * A 999ms clip at 24fps yields 24 frames too (999 / 41.66… ≈ 23.976 →
 * rounds to 24) — we'd rather over-emit one frame than under-emit and
 * lose the final frame to floor-truncation.
 *
 * Floor at 1: a zero-duration input still gets one frame. Templates
 * usually want a non-empty pipeline so the user sees *something*.
 *
 * @returns The number of frames and the per-frame duration in ms.
 *          Both are positive integers (frame count) / positive numbers
 *          (frame duration ms, non-integer for non-30fps inputs).
 */
export function computeFrameCount(args: {
  /** Total clip duration in milliseconds. Non-positive is clamped up. */
  durationMs: number;
  /** Frame rate in frames per second. Non-positive is rejected. */
  fps: number;
  /** Optional cap. When set and positive, returned count is `min(natural, cap)`. */
  maxFrames?: number;
}): { count: number; frameDurationMs: number } {
  if (!Number.isFinite(args.fps) || args.fps <= 0) {
    throw new Error(`computeFrameCount: fps must be a positive number (got ${args.fps}).`);
  }
  const frameDurationMs = 1000 / args.fps;
  const safeDuration = Number.isFinite(args.durationMs) && args.durationMs > 0
    ? args.durationMs
    : 0;
  const natural = Math.max(1, Math.round(safeDuration / frameDurationMs));
  const cap = args.maxFrames != null && args.maxFrames > 0
    ? Math.floor(args.maxFrames)
    : natural;
  return { count: Math.min(natural, cap), frameDurationMs };
}
