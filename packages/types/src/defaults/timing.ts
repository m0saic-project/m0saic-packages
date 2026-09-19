export const DEFAULT_DURATION_MS = 5000; // 5 seconds
export const DEFAULT_FPS = 30;

export const MIN_FPS = 1;
export const MAX_FPS = 240;

export const DEFAULT_PLAY_SPEED = 1;

/**
 * Engine clamp range for `MosaicPlaybackProps.playSpeed`. ±10× caps the
 * chained-`atempo` audio decomposition at 4 stages (each ffmpeg instance
 * accepts 0.5–2.0), keeps every emitted setpts/atempo literal in plain
 * decimal (no exponent notation in filter graphs), and bounds loop-size
 * inflation toward ffmpeg `loop`'s 32767-frame cap under slowdown.
 * Finite values outside the range clamp with `PLAY_SPEED_CLAMPED`.
 */
export const MIN_PLAY_SPEED = 0.1;
export const MAX_PLAY_SPEED = 10;