/**
 * Re-export shim: the window planner moved to
 * `@m0saic/template-utils` (`stamp/stampWindows.ts`) so the watermark
 * template can share it (same precedent as the v1 expressions' move to
 * `codes/qrStampExpressions.ts`). This module keeps the QR-flavored
 * names + the `qrNaturalDurMs` opts field so every existing caller and
 * `windows.test.ts` keep working unchanged — the suite staying green
 * is the parity proof for the move.
 */

import {
  planStampWindows,
  type PlanStampWindowsOpts,
  type PlanStampWindowsResult,
  type StampVariant,
  type StampWindow,
} from "@m0saic/template-utils";

export {
  avgLumaForWindow,
  buildWindowsAlphaExpr,
  groupWindowsByVariant,
  pickCoverage,
  pickVariantForWindow,
  type BuildWindowsAlphaExprOpts,
} from "@m0saic/template-utils";

export type QrVariant = StampVariant;
export type QrWindow = StampWindow;

export type PlanWindowsOpts = Omit<PlanStampWindowsOpts, "slotDurMs"> & {
  /** Natural duration of the committed qr-animate mp4, ms (→ shared `slotDurMs`). */
  qrNaturalDurMs: number;
};

export type PlanWindowsResult = PlanStampWindowsResult;

export function planWindows(opts: PlanWindowsOpts): PlanWindowsResult {
  const { qrNaturalDurMs, ...rest } = opts;
  return planStampWindows({ ...rest, slotDurMs: qrNaturalDurMs });
}
