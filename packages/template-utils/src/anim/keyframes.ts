/**
 * ============================================================================
 * anim/keyframes — piecewise keyframe interpolation → ONE ffmpeg expression
 * ============================================================================
 *
 * There is one global clock. ffmpeg evaluates expressions per frame; there is
 * no per-frame JS callback. So "ease this value from 0.25 to 0.60 between
 * t=3.2s and t=4.1s" cannot be code that runs at 3.2s — it must be compiled,
 * before the render starts, into a closed-form arithmetic expression of `t`
 * that returns the right value for ANY t. That compiler is `keyframeExpr`.
 *
 * The emitted shape is load-bearing: a FLAT SUM of disjoint window-gated
 * segments — never a nested `if(lt(t,…),…,if(…))` chain. ffmpeg's expression
 * parser has a ~100-recursion budget and a nested chain burns one level per
 * keyframe, so a dense timeline (e.g. a 10×10 walk) makes `crop` fail at
 * config ("Missing ')' or too many args"). The gates partition the timeline —
 * `lt` head (hold first value), half-open `gte·lt` segments, `gte` tail (hold
 * last value) — so exactly one term is nonzero at any `t`, and the engine
 * funnels (`rebalanceAdditiveChains`) regroup the long `+` chain into a tree,
 * keeping parse depth O(log n). See
 * the internal ffmpeg-expression-limits notes.
 *
 * Relationship to `entrance()` / `exit()` (anim/motion.ts): those are
 * single-ramp motion generators over an overlay binding and stay as they are;
 * `keyframeExpr` is the substrate for NEW multi-keyframe motion (the follow
 * camera compiles onto it) and the natural compile target for a future `.m0t`
 * temporal sidecar — which is why {@link Keyframe} is plain JSON
 * (serializable, no functions, no branded types).
 *
 * Extracted from dsl-tutorial's camera `focusExpr` (the proof at scale); at
 * the defaults (`ease:"smoothstep"`, `precision:5`, `timeVar:"t"`) the output
 * is byte-identical to it, locked by golden-string tests.
 * ============================================================================
 */

import type { TimeVar } from "@m0saic/platform/ffexpr";
import { easingExpr, type EaseName } from "./index";

/**
 * One keyframe. `ease` shapes the segment LEAVING this key (toward the next
 * key); omitted → the track-level default ({@link KeyframeExprOpts.ease}).
 * Keys must be sorted ascending by `t`. (.m0t-ready: JSON-serializable, no
 * functions, no branded types.)
 */
export type Keyframe = { t: number; v: number; ease?: EaseName };

export type KeyframeExprOpts = {
  /** Default segment easing. Default "smoothstep" (focusExpr parity). */
  ease?: EaseName;
  /** Time variable the expression reads. Default "t" (global). */
  timeVar?: TimeVar;
  /** Numeric precision (toFixed digits). Default 5 (focusExpr parity). */
  precision?: number;
  /**
   * Expression when `keys` is empty. Default "0". A number is formatted at
   * `precision`; a string is emitted verbatim. (focusExpr's "0.5" is camera
   * policy — dsl-tutorial's alias passes it explicitly.)
   */
  emptyValue?: number | string;
};

/**
 * Compile (t, v) keyframes into ONE ffmpeg expression: hold the first value
 * before the first key, ease between adjacent keys, hold the last value after
 * the last key. Emitted as a flat sum of disjoint window-gated segments (see
 * the module header for why that shape, and never a nested if-chain).
 *
 * Adjacent keys closer than 1e-4s get a floored segment duration so the ramp
 * never divides by zero (an effectively instant cut).
 */
export function keyframeExpr(keys: Keyframe[], opts: KeyframeExprOpts = {}): string {
  const { ease = "smoothstep", timeVar = "t", precision = 5 } = opts;
  const f = (n: number) => n.toFixed(precision);

  if (keys.length === 0) {
    const empty = opts.emptyValue ?? "0";
    return typeof empty === "number" ? f(empty) : empty;
  }
  if (keys.length === 1) return f(keys[0].v);

  const tv = timeVar;
  const terms: string[] = [];
  terms.push(`lt(${tv},${f(keys[0].t)})*(${f(keys[0].v)})`); // hold first value
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const dur = Math.max(1e-4, b.t - a.t);
    const p = `min(1,max(0,(${tv}-${f(a.t)})/${f(dur)}))`;
    const eased = easingExpr(a.ease ?? ease, p);
    const lerp = `(${f(a.v)}+(${f(b.v)}-${f(a.v)})*${eased})`;
    terms.push(`(gte(${tv},${f(a.t)})*lt(${tv},${f(b.t)}))*${lerp}`);
  }
  const last = keys[keys.length - 1];
  terms.push(`gte(${tv},${f(last.t)})*(${f(last.v)})`); // hold last value
  return terms.join("+");
}
