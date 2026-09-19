/**
 * @m0saic/ffexpr — FFmpeg expression helpers for m0saic templates and engine.
 *
 * @module ffexpr
 */

// --- time (template-facing) ---
export {
  enableLocalWindow,
  enableGlobalWindow,
  clamp01,
  u01,
  localStartAt,
} from "./time";
export type { TimeVar } from "./time";

// --- macros (engine-facing normalization) ---
export {
  substituteTileMacros,
  substituteLocalTime,
} from "./macros";
export type { TileMacroDims } from "./macros";

// --- ffmpeg (quoting/escaping) ---
export {
  escapeFilterExpr,
  quoteExpr,
  escapeEnableExpr,
  quoteEnableArg,
  escapeEvalExpr,
  quoteEvalExpr,
} from "./ffmpeg";

// --- guards ---
export { forbidXY } from "./guards";

// --- balance (parser-depth safety) ---
export {
  rebalanceAdditiveChains,
  DEFAULT_MAX_FLAT_ADDITIVE_TERMS,
} from "./balance";

// --- window (enable-window static analysis) ---
export { parseEnableWindow } from "./window";
export type { EnableWindow } from "./window";

// --- overlay (template-facing constructors) ---
export {
  overlay,
  moveY,
  fadeIn,
} from "./overlay";
export type { OverlayArgs } from "./overlay";

// --- compile (engine-facing normalization + compilation) ---
export {
  normalizeExpr,
  normalizeOverlayExpr,
  compileEnableArg,
  normalizeOpacityExpr,
} from "./compile";
export type { CompileDims } from "./compile";
