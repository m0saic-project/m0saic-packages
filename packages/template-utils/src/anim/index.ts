/**
 * Shared animation helpers (FFmpeg-expression based) for templates.
 *
 * All easing / animation converges here. These produce FFmpeg expression
 * strings consumed by:
 *   - expr text layers (`content: { kind: "expr", eval: "frame" }` on a
 *     `renderMode: { kind: "video" }` source) — e.g. counting numbers; and
 *   - `overlay.alpha` / `overlay.enable` — e.g. fade / reveal timing.
 *
 * Drawtext `%{…}` expansion needs commas escaped (`\,`); the engine's textfile
 * path unescapes them. Filter-context exprs (overlay.alpha) use raw commas.
 */

export type EaseName = "linear" | "smoothstep" | "easeOut" | "easeInOut";

/**
 * FFmpeg-safe easing expression mapping a progress expr `u`∈[0..1] → eased∈[0..1].
 * `uExpr` is substituted in (it may itself be an expression, e.g. a clamped
 * time ramp). No commas/colons are introduced here, so escaping is the caller's
 * concern (driven by `uExpr`).
 */
export function easingExpr(ease: EaseName, uExpr: string): string {
  const u = `(${uExpr})`;
  switch (ease) {
    case "smoothstep":
    case "easeInOut":
      return `${u}*${u}*(3-2*${u})`;
    case "easeOut":
      return `(1-(1-${u})*(1-${u}))`; // quadratic ease-out — decelerate, premium feel
    case "linear":
    default:
      return u;
  }
}

/**
 * Clamped, normalized progress ramp over `[startSec, startSec+durSec]` → [0..1].
 * `comma` selects the comma style: `"\\,"` (escaped, for drawtext `%{}`
 * expansion) or `","` (raw, for filter-context exprs like overlay.alpha).
 */
export function progressExpr(
  startSec: number,
  durSec: number,
  comma: "\\," | "," = ",",
): string {
  const d = durSec <= 0 ? 0.0001 : durSec;
  // min/max (not clip) so both ffmpeg AND the web preview's expr evaluator can
  // read it — the latter supports min/max but not clip.
  return `min(1${comma}max(0${comma}(t-${startSec})/${d}))`;
}

/**
 * A drawtext `%{eif:…}` count-up expression: an integer that eases from 0 → `to`
 * over `[startSec, startSec+durSec]`, then holds. Pair with an expr text layer
 * (`eval: "frame"`) on a `renderMode: { kind: "video" }` source. `+0.5` rounds
 * (eif:d truncates); the clamp pins the final frame exactly to `to`. Optional
 * `suffix` is appended verbatim — keep it free of `%` (drawtext expansion).
 */
export function countUpExpr(opts: {
  to: number;
  durationSec: number;
  startSec?: number;
  ease?: EaseName;
  suffix?: string;
}): string {
  const { to, durationSec, startSec = 0, ease = "easeOut", suffix = "" } = opts;
  const eased = easingExpr(ease, progressExpr(startSec, durationSec, "\\,"));
  return `%{eif\\:${to}*(${eased})+0.5\\:d}${suffix}`;
}

/** Fade-in alpha expression (0 → 1) over a window — for `overlay.alpha`. */
export function fadeInExpr(startSec: number, durSec: number, ease: EaseName = "smoothstep"): string {
  return easingExpr(ease, progressExpr(startSec, durSec, ","));
}

// In expr-text (drawtext expansion=normal), `%`, `{`, `}` are control chars —
// escape with a backslash so they render literally.
function escapeExprLiteral(s: string): string {
  return s.replace(/%/g, "\\%").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

/** Count-up expr for a single number token (integer, or `int.dec`). */
function numberCountUp(numStr: string, easedExpr: string, padTo?: number): string {
  const dot = numStr.indexOf(".");
  const to = parseFloat(numStr);
  if (dot < 0) {
    // +0.5 rounds (eif:d truncates); clamp pins the final frame to `to`. `padTo`
    // zero-pads a grouped thousands block to its width (the eif length arg).
    return padTo != null
      ? `%{eif\\:${to}*(${easedExpr})+0.5\\:d\\:${padTo}}`
      : `%{eif\\:${to}*(${easedExpr})+0.5\\:d}`;
  }
  const decimals = numStr.length - dot - 1;
  const scale = Math.pow(10, decimals);
  // Integer part truncates; fractional part via mod (screencap-grid sub-unit idiom),
  // zero-padded to `decimals` digits with the eif length arg.
  const intExpr = `%{eif\\:${to}*(${easedExpr})\\:d}`;
  const decExpr = `%{eif\\:mod(${to}*(${easedExpr})*${scale}\\,${scale})\\:d\\:${decimals}}`;
  return `${intExpr}.${decExpr}`;
}

/**
 * Replace every numeric run in a pre-formatted string (e.g. `"+18 (+7.9%)"`)
 * with a drawtext count-up expr, easing 0 → each number over the same window;
 * non-numeric characters stay literal (`%` escaped). For short numeric "flare"
 * on already-formatted labels. Pair with an expr text layer (`eval: "frame"`)
 * on a `renderMode: { kind: "video" }` source.
 */
export function animateNumbersInText(
  text: string,
  opts: { durationSec: number; startSec?: number; ease?: EaseName },
): string {
  const { durationSec, startSec = 0, ease = "easeOut" } = opts;
  const eased = easingExpr(ease, progressExpr(startSec, durationSec, "\\,"));
  const re = /\d+(?:\.\d+)?/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lit = text.slice(last, m.index);
    out += escapeExprLiteral(lit);
    // A run that immediately follows a thousands separator (",") is a grouped
    // digit-block and must keep its width while counting (e.g. "284,000" → the
    // "000" group must stay 3 digits, not collapse to "0"). Pad such integer
    // runs to their original length; the leading run (and decimals) stay natural.
    const isGroup = /,\s*$/.test(lit) && !m[0].includes(".");
    out += numberCountUp(m[0], eased, isGroup ? m[0].length : undefined);
    last = m.index + m[0].length;
  }
  out += escapeExprLiteral(text.slice(last));
  return out;
}

// Entrance / exit motion generators (kept last: motion.ts imports easingExpr /
// progressExpr from this module, so its re-export must follow their definitions).
export {
  entrance,
  exit,
  composeMotion,
  RISE_SINK_DISTANCE_FRAC,
  type EntranceKind,
  type ExitKind,
  type EntranceSpec,
  type ExitSpec,
} from "./motion";

// Keyframe compiler + duration-fit timeline (same constraint as motion.ts:
// both import easingExpr / EaseName from this module, so these re-exports
// must also follow the definitions above).
export { keyframeExpr, type Keyframe, type KeyframeExprOpts } from "./keyframes";
export {
  computeTimeline,
  stepNumberExpr,
  resolvePinnedDurationMs,
  resolveOutputDurationMs,
  resolveWindow,
  DEFAULT_WINDOW_FRACTION,
  type Timeline,
  type TimelineSpec,
  type ResolvedTimeWindow,
} from "./timing";

// Follow camera + enable-gated track builders (camera rides ./keyframes;
// tracks has no intra-module imports).
export {
  autoZoomForLegibility,
  centerFocus,
  followCamera,
  resolvePullBackEnvelope,
  cameraViewportRect,
  CAMERA_LEGIBLE_PX,
  CAMERA_MIN_WORTH_ZOOM,
  CAMERA_MAX_AUTO_ZOOM,
  CAMERA_HOLD_TARGET_SEC,
  type CameraTarget,
  type FollowCameraPullBack,
} from "./camera";
export {
  gatedBoxTrackSource,
  curtainSource,
  dashedGuideBoxes,
  gatedEnableExpr,
  roundedRectPathD,
  maskAtlasSource,
  GATED_BOX_BUDGET,
  DASH_SEGMENT_BUDGET,
  MASK_SUBPATH_BUDGET,
  type GatedBox,
  type DashedGuideLine,
} from "./tracks";
