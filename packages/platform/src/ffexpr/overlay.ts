/**
 * Template-facing overlay constructors.
 *
 * These helpers return `MosaicOverlayExpr` objects with raw expressions
 * (containing `lt`, `W`, `H` macros). The engine normalizes them later
 * via `compile.ts`.
 */

import type {
  MosaicOverlayExpr,
  MosaicOverlayBlendMode,
} from "@m0saic/types";
import { enableLocalWindow, u01 } from "./time";

/** Input arguments for building an overlay expression. */
export type OverlayArgs = {
  startAtSec?: number;
  enable?: string;
  alpha?: string;
  xExpr?: string;
  yExpr?: string;
  blendMode?: MosaicOverlayBlendMode;
};

/**
 * Build a `MosaicOverlayExpr` from the given arguments.
 *
 * Only defined fields are included in the result.
 */
export function overlay(args: OverlayArgs): MosaicOverlayExpr {
  const result: MosaicOverlayExpr = {};
  if (args.startAtSec != null) result.startAtSec = args.startAtSec;
  if (args.enable != null) result.enable = args.enable;
  if (args.alpha != null) result.alpha = args.alpha;
  if (args.xExpr != null) result.xExpr = args.xExpr;
  if (args.yExpr != null) result.yExpr = args.yExpr;
  if (args.blendMode != null) result.blendMode = args.blendMode;
  return result;
}

/**
 * Build an overlay that animates vertical position.
 *
 * If `durSec` is provided and `enable` is not in the args,
 * an `enableLocalWindow(durSec)` is added automatically.
 */
export function moveY(args: {
  yExpr: string;
  startAtSec?: number;
  durSec?: number | string;
  enable?: string;
  alpha?: string;
  blendMode?: MosaicOverlayBlendMode;
}): MosaicOverlayExpr {
  const enable =
    args.enable ?? (args.durSec != null ? enableLocalWindow(args.durSec) : undefined);

  return overlay({
    yExpr: args.yExpr,
    startAtSec: args.startAtSec,
    enable,
    alpha: args.alpha,
    blendMode: args.blendMode,
  });
}

/**
 * Build a fade-in overlay.
 *
 * Returns an overlay with `enable` set to a local time window and
 * `alpha` set to a 0→1 ramp (optionally eased).
 *
 * @param easeExpr - Optional transform applied to the raw u01 progress.
 *   Receives the u01 expression string and returns the eased expression.
 *   Default: linear (identity).
 */
export function fadeIn(args: {
  startAtSec?: number;
  durSec: number | string;
  easeExpr?: (u01Expr: string) => string;
}): MosaicOverlayExpr {
  const rawU01 = u01(args.durSec);
  const alpha = args.easeExpr ? args.easeExpr(rawU01) : rawU01;

  return overlay({
    startAtSec: args.startAtSec,
    enable: enableLocalWindow(args.durSec),
    alpha,
  });
}
