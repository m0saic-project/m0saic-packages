/**
 * Engine-facing normalization and compilation.
 *
 * Applies macro substitution and local-time resolution to all
 * expression-bearing fields, producing ffmpeg-safe strings.
 */

import type { MosaicOverlayExpr } from "@m0saic/types";
import {
  substituteLocalTime,
  substituteTileMacros,
  type TileMacroDims,
} from "./macros";
import { forbidXY } from "./guards";
import { quoteEnableArg } from "./ffmpeg";

/** Tile pixel dimensions for the compile step. */
export type CompileDims = {
  tileW: number;
  tileH: number;
  tileTW?: number;
  tileTH?: number;
};

/**
 * Normalize a single expression string.
 *
 * Applies tile macros then local time substitution.
 */
export function normalizeExpr(
  expr: string,
  args: { startAtSec?: number; dims: TileMacroDims },
): string {
  let out = substituteTileMacros(expr, args.dims);
  out = substituteLocalTime(out, args.startAtSec);
  return out;
}

/**
 * Normalize all expression fields on a `MosaicOverlayExpr`.
 *
 * Applies, in order:
 * 1. Tile-dimension macro substitution (`W`, `H`, `TW`, `TH`)
 * 2. Local-time substitution (`lt` → `t` or `(t-offset)`)
 * 3. `x`/`y` guard on offset expressions (default: enabled)
 *
 * Returns a new `MosaicOverlayExpr` with resolved expressions.
 * Returns `undefined` if the input is `undefined`.
 */
export function normalizeOverlayExpr(
  ov: MosaicOverlayExpr | undefined,
  dims: CompileDims,
  opts?: { forbidXYInOffsets?: boolean },
): MosaicOverlayExpr | undefined {
  if (!ov) return undefined;

  const tileDims: TileMacroDims = {
    W: dims.tileW,
    H: dims.tileH,
    TW: dims.tileTW,
    TH: dims.tileTH,
  };
  const startAtSec = ov.startAtSec;

  function norm(expr: string | undefined): string | undefined {
    if (expr == null) return undefined;
    return normalizeExpr(expr, { startAtSec, dims: tileDims });
  }

  const xExpr = norm(ov.xExpr);
  const yExpr = norm(ov.yExpr);
  const enable = norm(ov.enable);
  const alpha = norm(ov.alpha);

  const shouldForbidXY = opts?.forbidXYInOffsets ?? true;
  if (shouldForbidXY) {
    if (xExpr != null) forbidXY(xExpr);
    if (yExpr != null) forbidXY(yExpr);
  }

  const result: MosaicOverlayExpr = {};
  if (startAtSec != null) result.startAtSec = startAtSec;
  if (xExpr != null) result.xExpr = xExpr;
  if (yExpr != null) result.yExpr = yExpr;
  if (enable != null) result.enable = enable;
  if (alpha != null) result.alpha = alpha;
  if (ov.blendMode != null) result.blendMode = ov.blendMode;

  return result;
}

/**
 * Compile a `MosaicOverlayExpr` into a safe `:enable='...'` argument string.
 *
 * Substitutes `lt` in the enable expression using the overlay's `startAtSec`,
 * then escapes and quotes for ffmpeg.
 *
 * Returns the empty string when no enable expression is present,
 * so callers can unconditionally append the result.
 */
export function compileEnableArg(
  ov: MosaicOverlayExpr | undefined,
): string {
  if (!ov?.enable) return "";

  // Ensure lt is substituted (idempotent if already normalized)
  const normalized = substituteLocalTime(ov.enable, ov.startAtSec);
  return quoteEnableArg(normalized);
}

/**
 * Normalize an opacityExpr string.
 *
 * Only applies local-time substitution (no W/H macros — opacity
 * is not spatial).
 */
export function normalizeOpacityExpr(
  opacityExpr: string | undefined,
  startAtSec?: number,
): string | undefined {
  if (opacityExpr == null) return undefined;
  return substituteLocalTime(opacityExpr, startAtSec);
}
