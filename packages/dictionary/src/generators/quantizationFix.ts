/**
 * Shared "force quantization-free" affordance for dictionary generators.
 *
 * A generator's m0 is usually a portable weighted split — resolution-independent,
 * but it can quantize (spread) at sizes its basis doesn't divide. For a layout the
 * user will PERSIST and reuse at a known size, that spread is avoidable: re-emit the
 * SAME layout as exact pixels for a target canvas via `placeRects`.
 *
 * Opt-in (the user chooses when to trade portability for exactness): a checkbox +
 * target dims that appear only when it's on. The transform derives each frame's
 * IDEAL fractional rect from a high-res re-parse (so the proportions — not the
 * already-quantized px — drive it), rounds each edge independently to target px, and
 * places the rects exactly. Gaps (gutters / null regions) survive as empty space
 * between the placed rects; frame order is preserved so source/label indices stay
 * aligned.
 */

import { placeRects } from "@m0saic/dsl-stdlib";
import { parseM0StringToRenderFrames, toCanonicalM0String } from "@m0saic/dsl";
import type { GeneratorParamDescriptor } from "./types";

// High-res multiple used to recover near-ideal fractional geometry. Parse cost is
// proportional to cell count (not resolution), so this is cheap.
const REF = 64;

/** Opt-in params block — spread into a generator's `params` array. */
export function forceQuantizationFreeParams(): GeneratorParamDescriptor[] {
  return [
    {
      key: "forceQuantizationFree",
      title: "Force quantization-free",
      type: "bool",
      default: false,
      description:
        "Bake the layout to exact pixels at a target canvas (placeRects) so it renders with zero quantization spread. Trades portability (resolution-locked) for an exact result — for layouts you'll persist/reuse at a known size.",
    },
    {
      key: "targetW",
      title: "Target width (px)",
      type: "int",
      default: 1920,
      min: 1,
      max: 7680,
      visibleWhen: { forceQuantizationFree: true },
      description: "Canvas width the exact pixels are baked for.",
    },
    {
      key: "targetH",
      title: "Target height (px)",
      type: "int",
      default: 1080,
      min: 1,
      max: 4320,
      visibleWhen: { forceQuantizationFree: true },
      description: "Canvas height the exact pixels are baked for.",
    },
  ];
}

export type ForceQuantizationFreeParams = {
  forceQuantizationFree?: boolean;
  targetW?: number;
  targetH?: number;
};

export type QuantizeFreeResult = {
  m0: string;
  idealCanvas: { width: number; height: number };
};

/**
 * Re-emit `m0` as an exact, quantization-free placeRects layout for a target canvas.
 * Throws (via the parser/placeRects) if `m0` is invalid.
 */
export function forceQuantizationFree(
  m0: string,
  targetW: number,
  targetH: number,
): QuantizeFreeResult {
  const W = Math.max(1, Math.round(targetW));
  const H = Math.max(1, Math.round(targetH));

  const hi = parseM0StringToRenderFrames(m0, W * REF, H * REF);
  const ordered = hi.slice().sort((a, b) => a.logicalIndex - b.logicalIndex);

  const rects = ordered.map((f) => {
    const x = Math.round((f.x / (W * REF)) * W);
    const y = Math.round((f.y / (H * REF)) * H);
    const x2 = Math.round(((f.x + f.width) / (W * REF)) * W);
    const y2 = Math.round(((f.y + f.height) / (H * REF)) * H);
    return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y), claimant: "1" };
  });

  const placed = placeRects({ rootW: W, rootH: H, rects });
  return {
    m0: toCanonicalM0String(String(placed.m0)),
    idealCanvas: { width: W, height: H },
  };
}

/**
 * Convenience: if `params.forceQuantizationFree`, return the exact placeRects m0 +
 * idealCanvas for `(targetW, targetH)`; otherwise return the original m0 unchanged
 * (no idealCanvas — it stays portable).
 */
export function applyForceQuantizationFree(
  m0: string,
  params: ForceQuantizationFreeParams,
): { m0: string; idealCanvas?: { width: number; height: number } } {
  if (!params.forceQuantizationFree) return { m0 };
  return forceQuantizationFree(m0, params.targetW ?? 1920, params.targetH ?? 1080);
}
