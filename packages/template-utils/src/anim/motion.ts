import type { MosaicOverlayExpr } from "@m0saic/types";
import { easingExpr, progressExpr, type EaseName } from "./index";

/**
 * Entrance / exit motion generators (the ffmpeg-filter-adoption spec's
 * "animation kit"). LOCKED design: helper-only — these emit scalar
 * `MosaicOverlayExpr` fields (xExpr/yExpr/alpha/enable) onto the ALREADY
 * WIRED overlay binding; no new type, no core change.
 *
 * Cost model (why kinds differ in mechanism):
 *   - slide kinds emit x/y offset exprs + a native `enable` gate — the
 *     overlay fast path, scalar per frame, ~free.
 *   - fade / rise / sink emit an `alpha` expr — that rides the per-pixel
 *     alpha fold, which is worth paying only for a genuine ramp. For a fade
 *     anchored at clip start/end prefer `effects.fadeInMs`/`fadeOutMs`
 *     (compiled `fade` kernel); use these helpers when the ramp starts at an
 *     arbitrary `atSec`.
 *
 * All exprs are ABSOLUTE-time (`t`, never the `lt` token), so entrance and
 * exit compose on one source without fighting over the `startAtSec` anchor
 * (returned as metadata per the spec's shape). Offsets use the engine's
 * tile-local `W`/`H` macros. Merge the result onto a source's `overlay`
 * (or through {@link composeMotion} for entrance + exit together).
 */

export type EntranceKind = "fade" | "slide-left" | "slide-up" | "rise";
export type ExitKind = "fade" | "slide-right" | "slide-down" | "sink";

export type EntranceSpec = {
  kind: EntranceKind;
  /** Ramp length in ms. */
  durationMs: number;
  /** Absolute time the entrance STARTS, in seconds. */
  atSec: number;
  /** Easing over the ramp. Default "linear". */
  ease?: EaseName;
};

export type ExitSpec = {
  kind: ExitKind;
  /** Ramp length in ms. */
  durationMs: number;
  /** Absolute time the exit STARTS, in seconds. */
  atSec: number;
  /** Easing over the ramp. Default "linear". */
  ease?: EaseName;
};

/** Vertical drift distance for the `rise` / `sink` kinds, as a fraction of
 *  the tile height. Fixed (not a knob) so identical specs render identically
 *  across templates. */
export const RISE_SINK_DISTANCE_FRAC = 0.15;

function durSec(durationMs: number): number {
  return Number((durationMs / 1000).toFixed(3));
}

/**
 * Entrance: the tile arrives at its resting place over
 * `[atSec, atSec + durationMs]`.
 *
 * - `fade`: alpha ramps 0 → 1.
 * - `slide-left`: enters from one tile-width RIGHT of its cell, travelling
 *   left; hidden (native enable gate) before `atSec`.
 * - `slide-up`: enters from one tile-height BELOW, travelling up; hidden
 *   before `atSec`.
 * - `rise`: fade + a subtle upward drift ({@link RISE_SINK_DISTANCE_FRAC}).
 */
export function entrance(spec: EntranceSpec): MosaicOverlayExpr {
  const d = durSec(spec.durationMs);
  const p = easingExpr(spec.ease ?? "linear", progressExpr(spec.atSec, d));
  // Structured lifetime twin of the gate/ramp (enable-gating sprint): the
  // tile is invisible before `atSec` (enable off / alpha 0), so the engine
  // may skip its upstream work there.
  const window = { startSec: spec.atSec };

  switch (spec.kind) {
    case "fade":
      return { alpha: p, startAtSec: spec.atSec, window };
    case "slide-left":
      return {
        xExpr: `(1-${p})*W`,
        enable: `gte(t,${spec.atSec})`,
        startAtSec: spec.atSec,
        window,
      };
    case "slide-up":
      return {
        yExpr: `(1-${p})*H`,
        enable: `gte(t,${spec.atSec})`,
        startAtSec: spec.atSec,
        window,
      };
    case "rise":
      return {
        alpha: p,
        yExpr: `(1-${p})*${RISE_SINK_DISTANCE_FRAC}*H`,
        startAtSec: spec.atSec,
        window,
      };
  }
}

/**
 * Exit: the tile leaves its resting place over `[atSec, atSec + durationMs]`.
 *
 * - `fade`: alpha ramps 1 → 0.
 * - `slide-right`: travels one tile-width right; hidden (native enable gate)
 *   after the exit completes.
 * - `slide-down`: travels one tile-height down; hidden after completion.
 * - `sink`: fade-out + a subtle downward drift.
 */
export function exit(spec: ExitSpec): MosaicOverlayExpr {
  const d = durSec(spec.durationMs);
  const p = easingExpr(spec.ease ?? "linear", progressExpr(spec.atSec, d));
  const endSec = Number((spec.atSec + d).toFixed(3));
  // Structured lifetime twin: the tile is invisible after the exit completes
  // (enable off / alpha 0), so the engine may stop its upstream work there.
  const window = { endSec };

  switch (spec.kind) {
    case "fade":
      return { alpha: `(1-${p})`, startAtSec: spec.atSec, window };
    case "slide-right":
      return {
        xExpr: `${p}*W`,
        enable: `lt(t,${endSec})`,
        startAtSec: spec.atSec,
        window,
      };
    case "slide-down":
      return {
        yExpr: `${p}*H`,
        enable: `lt(t,${endSec})`,
        startAtSec: spec.atSec,
        window,
      };
    case "sink":
      return {
        alpha: `(1-${p})`,
        yExpr: `${p}*${RISE_SINK_DISTANCE_FRAC}*H`,
        startAtSec: spec.atSec,
        window,
      };
  }
}

/**
 * Compose motions (e.g. an entrance AND an exit on one source) into a single
 * `MosaicOverlayExpr`:
 *
 * - `xExpr` / `yExpr` offsets ADD (disjoint windows each contribute 0 at rest);
 * - `alpha` terms MULTIPLY (each is 1 outside its own ramp);
 * - `enable` gates MULTIPLY (all must hold);
 * - `window` lifetimes INTERSECT (latest start, earliest end);
 * - `startAtSec` takes the earliest (metadata only — exprs are absolute-time).
 *
 * Spread the result onto the source's overlay:
 * `overlay: { ...composeMotion(entrance(...), exit(...)) }`.
 */
export function composeMotion(...motions: MosaicOverlayExpr[]): MosaicOverlayExpr {
  const out: MosaicOverlayExpr = {};

  const joined = (
    field: "xExpr" | "yExpr" | "alpha" | "enable",
    op: "+" | "*"
  ): string | undefined => {
    const parts = motions
      .map((m) => m[field])
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    return parts.map((p) => `(${p})`).join(op);
  };

  const xExpr = joined("xExpr", "+");
  const yExpr = joined("yExpr", "+");
  const alpha = joined("alpha", "*");
  const enable = joined("enable", "*");
  if (xExpr !== undefined) out.xExpr = xExpr;
  if (yExpr !== undefined) out.yExpr = yExpr;
  if (alpha !== undefined) out.alpha = alpha;
  if (enable !== undefined) out.enable = enable;

  const starts = motions
    .map((m) => m.startAtSec)
    .filter((v): v is number => typeof v === "number");
  if (starts.length > 0) out.startAtSec = Math.min(...starts);

  // Lifetimes intersect: visible only where EVERY motion allows it.
  const winStarts = motions
    .map((m) => m.window?.startSec)
    .filter((v): v is number => typeof v === "number");
  const winEnds = motions
    .map((m) => m.window?.endSec)
    .filter((v): v is number => typeof v === "number");
  if (winStarts.length > 0 || winEnds.length > 0) {
    out.window = {
      ...(winStarts.length > 0 ? { startSec: Math.max(...winStarts) } : {}),
      ...(winEnds.length > 0 ? { endSec: Math.min(...winEnds) } : {}),
    };
  }

  return out;
}
