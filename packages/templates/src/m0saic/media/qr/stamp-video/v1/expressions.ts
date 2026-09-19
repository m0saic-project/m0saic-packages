/**
 * Re-export shim — the pure helpers moved to `@m0saic/template-utils`
 * (file: `qrStampExpressions.ts`) so the new `stampQrOnMedia` composer
 * could share them without a `template-utils ← templates` cycle.
 *
 * Existing call sites (`./qr-stamp.ts`, sibling v2, the still v1
 * template, and `expressions.test.ts`) keep importing from this path —
 * they exercise the moved implementation transparently.
 */

export {
  bucketLightAlpha,
  buildAdaptiveAlphaExpr,
  buildEntranceExpr,
  composeAlpha,
  buildCornerStampM0,
  type CornerStampLayout,
} from "@m0saic/template-utils";
