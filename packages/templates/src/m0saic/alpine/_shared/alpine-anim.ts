/**
 * ============================================================================
 * Alpine pack — shared reveal + animation-schema helpers (F4 U-A0)
 * ============================================================================
 *
 * Two shared pieces the alpine tier adopts:
 *
 *  1. `revealGate` — the geq-free intro reveal. Alpine templates each carried a
 *     local `fadeIn`/`wrapFade` wrapper that set a time-varying `overlay.alpha`
 *     (`fadeInExpr`) — which compiles to a per-pixel `geq` fold (cost-model R3/R4,
 *     paid every frame of a nesting parent's whole timeline). `revealGate` swaps
 *     that for a free scalar `overlay.enable` gate: the element pops in at its
 *     moment, no geq. (For elements that also SLIDE — a bar/fill growing via an
 *     `xExpr`/`yExpr` translate — just drop the `alpha`; keep the translate. The
 *     slide is the grow; the alpha was redundant fade sugar.)
 *
 *  2. `ALPINE_ANIM_FIELDS` + field helpers — the `anim` prop group shipped as a
 *     `type:"group"` with NO `fields`, so it rendered as a raw JSON bag in Make.
 *     These give it real labeled sub-fields. Templates with extra anim knobs
 *     spread + add: `fields: { ...ALPINE_ANIM_FIELDS, countUp: fBool("Count up") }`.
 * ============================================================================
 */

import type { MosaicSource } from "@m0saic/types";
import { fadeInExpr } from "@m0saic/template-utils";
import type { Node } from "./alpine-card";

/**
 * Reveal a source at `atSec` via a free `overlay.enable` gate (no geq). Raw
 * `gte(t,X)` form — the engine escapes commas natively; do NOT use the
 * comma-escaped `gatedEnableExpr`. `on = false` returns the source untouched
 * (reduceMotion / static). Preserves any existing overlay (position/slide).
 */
export function revealGate<T extends MosaicSource>(src: T, atSec: number, on = true): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  const at = Number(atSec.toFixed(3));
  return {
    ...src,
    overlay: {
      ...prev,
      enable: `gte(t,${atSec.toFixed(3)})`,
      // Structured twin of the gate (enable-gating sprint): lets the engine
      // trim the source's upstream chain to its lifetime.
      window: { startSec: at },
    },
  } as T;
}

/** Map `revealGate` over every source in a node (the enable-gate analog of the
 *  per-template `wrapFade` that fanned a fade over `node.sources`). */
export function revealGateNode(node: Node, atSec: number, on = true): Node {
  if (!on) return node;
  return { ...node, sources: node.sources.map((s) => revealGate(s, atSec, true)) };
}

/**
 * Soft slide-in reveal — still geq-free. Enable-gates the source at `atSec` AND
 * slides it up `distPx` into place over `durSec` via a per-frame `yExpr` translate
 * (a position anim — cheap, NO alpha/geq). Reads softer than a hard `enable` pop
 * without the per-pixel fade cost. `on=false` returns the source untouched.
 */
export function revealSlide<T extends MosaicSource>(src: T, atSec: number, durSec: number, distPx: number, on = true): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  const eased = `min(1,max(0,lt/${Math.max(0.001, durSec).toFixed(3)}))`; // 0..1 over the window (local time)
  return {
    ...src,
    overlay: {
      ...prev,
      startAtSec: atSec,
      enable: `gte(t,${atSec.toFixed(3)})`,
      yExpr: `${Math.round(distPx)}*(1-(${eased}))`,
      window: { startSec: Number(atSec.toFixed(3)) },
    },
  } as T;
}

/** Map `revealSlide` over every source in a node. */
export function revealSlideNode(node: Node, atSec: number, durSec: number, distPx: number, on = true): Node {
  if (!on) return node;
  return { ...node, sources: node.sources.map((s) => revealSlide(s, atSec, durSec, distPx, true)) };
}

/**
 * Premium fade reveal — a time-varying `overlay.alpha` crossfade (`fadeInExpr`).
 * This IS a per-pixel geq (heavier), used by a template's `renderMode:"premium"`
 * path for the softest look; the `light` path uses `revealGate`/`revealSlide`
 * instead. `on=false` returns the source untouched.
 */
export function revealFade<T extends MosaicSource>(src: T, atSec: number, durSec: number, on = true): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return {
    ...src,
    overlay: {
      ...prev,
      alpha: fadeInExpr(atSec, durSec),
      // The ramp holds alpha 0 before atSec — the source's lifetime starts
      // there (feeds the engine's trim; the fade itself lowers natively).
      window: { startSec: atSec },
    },
  } as T;
}

/** Map `revealFade` over every source in a node. */
export function revealFadeNode(node: Node, atSec: number, durSec: number, on = true): Node {
  if (!on) return node;
  return { ...node, sources: node.sources.map((s) => revealFade(s, atSec, durSec, true)) };
}

// ── anim-group schema fields (kills the JSON-bag `anim` group) ────────────────

/** Boolean sub-field. */
export const fBool = (label: string, description = ""): any => ({ type: "boolean", required: false, description, meta: { ui: { label } } });
/** String sub-field. */
export const fStr = (label: string, description = "", placeholder?: string): any => ({ type: "string", required: false, description, meta: { ui: { label }, ...(placeholder ? { control: { placeholder } } : {}) } });
/** Number sub-field. */
export const fNum = (label: string, description = "", control?: any, constraints?: any): any => ({ type: "number", required: false, description, meta: { ...(constraints ? { constraints } : {}), ...(control ? { control } : {}), ui: { label } } });
/** 0..1 slider sub-field. */
export const fFrac = (label: string, description = "", placeholder?: string): any => fNum(label, description, { flavor: "slider", step: 0.05, ...(placeholder ? { placeholder } : {}) }, { min: 0, max: 1 });
/** Enum (oneOf) sub-field. */
export const fEnum = (label: string, oneOf: string[], description = ""): any => ({ type: "string", required: false, description, meta: { constraints: { oneOf }, ui: { label } } });

/** The common alpine `anim` group fields. Templates spread + extend for extras
 *  (e.g. `countUp`). Field names match the pack's `AnimConfig` keys. */
export const ALPINE_ANIM_FIELDS: Record<string, any> = {
  reduceMotion: fBool("Reduce motion", "Skip motion; render the final static card."),
  introFrac: fFrac("Intro length", "Share of the clip the intro fills (the rest holds)."),
  easing: fEnum("Easing", ["easeOut", "smoothstep", "easeInOut", "linear"], "Intro easing curve."),
};
