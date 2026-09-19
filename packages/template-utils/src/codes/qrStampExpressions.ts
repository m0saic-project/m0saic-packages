/**
 * Pure expression + layout builders for QR stamping.
 *
 * These were originally inlined under `qr-stamp/video/v1/expressions.ts`
 * in the templates package. They've moved here so the new
 * `stampQrOnMedia` helper (also in `@m0saic/template-utils`) can share
 * them without a `template-utils ← templates` cycle. The legacy
 * import path stays a thin re-export shim — existing callers
 * (`qr-stamp/video/v1`, `qr-stamp/video/v2`, `qr-stamp/still/v1`) and
 * their tests keep working unchanged.
 *
 * All functions are deterministic, allocation-light, and side-effect
 * free. They return ffmpeg-evaluator-compatible strings or m0 layouts.
 */

import type { M0String } from "@m0saic/dsl";
import { placeRect } from "@m0saic/dsl-stdlib";
import type { LuminanceBucket } from "@m0saic/types";

// ── Internal ──────────────────────────────────────────────────

/**
 * Format a number to 3 decimal places for deterministic expression output.
 * Keeps the rendered alpha expression byte-identical across runs.
 */
function fixed(n: number): string {
  return n.toFixed(3);
}

// ── Variant pick ──────────────────────────────────────────────

/**
 * Per-bucket variant pick. Returns 1 if the bucket should use the
 * light-bg variant (white card), 0 if it should use the dark-bg variant
 * (black card). The threshold sits at the midpoint of `[lowLuma, highLuma]`.
 */
export function bucketLightAlpha(
  luma: number,
  lowLuma: number,
  highLuma: number,
): 0 | 1 {
  const threshold = (lowLuma + highLuma) / 2;
  return luma > threshold ? 1 : 0;
}

// ── Adaptive crossfade ────────────────────────────────────────

/**
 * Build a discrete-pick alpha expression with smoothstep transitions
 * between scene-luminance buckets.
 *
 * For variant === "light", per-bucket target alpha is 0 or 1 (the
 * variant either wins the bucket or doesn't, decided at the
 * `(lowLuma + highLuma) / 2` midpoint). The "dark" variant is the
 * complement. Between adjacent buckets whose pick disagrees, a
 * smoothstep ramp centered on the bucket boundary (half-width
 * `crossfadeDurSec / 2`) carries each variant cleanly between its
 * 0 / 1 holds.
 *
 * Degenerate cases:
 *  - 0 buckets → constant 1 for the "light" variant, 0 for "dark".
 *  - 1 bucket  → constant 0 or 1.
 *  - All buckets agree → constant 0 or 1 (no transition emitted).
 */
export function buildAdaptiveAlphaExpr(
  buckets: ReadonlyArray<LuminanceBucket>,
  variant: "light" | "dark",
  lowLuma: number,
  highLuma: number,
  crossfadeDurSec: number = 0.4,
): string {
  if (buckets.length === 0) {
    return variant === "light" ? "1.000" : "0.000";
  }

  const targets = buckets.map((b) => {
    const lightA = bucketLightAlpha(b.avgLuma, lowLuma, highLuma);
    return variant === "light" ? lightA : ((1 - lightA) as 0 | 1);
  });

  const a0 = targets[0]!;
  const halfDur = Math.max(0, crossfadeDurSec) / 2;

  const parts: string[] = [fixed(a0)];
  for (let i = 0; i < buckets.length - 1; i += 1) {
    const dA = targets[i + 1]! - targets[i]!;
    if (dA === 0) continue;
    const tBoundarySec = buckets[i]!.endMs / 1000;
    const t0 = fixed(tBoundarySec - halfDur);
    const dur = fixed(Math.max(0.001, crossfadeDurSec));
    const u = `min(1,max(0,(t-${t0})/${dur}))`;
    const smoothstep = `(${u}*${u}*(3-2*${u}))`;
    parts.push(`(${fixed(dA)}*${smoothstep})`);
  }

  if (parts.length === 1) return fixed(a0);
  return `min(1,max(0,${parts.join("+")}))`;
}

// ── Entrance fade ─────────────────────────────────────────────

/**
 * Smoothstep 0→1 entrance ramp over `durSec` starting at global `startSec`.
 * Holds at 1 after the entrance completes.
 */
export function buildEntranceExpr(startSec: number, durSec: number): string {
  if (durSec <= 0) return "1";
  const u = `min(1,max(0,(t-${fixed(startSec)})/${fixed(durSec)}))`;
  return `(${u}*${u}*(3-2*${u}))`;
}

// ── Alpha composition ─────────────────────────────────────────

/**
 * Multiply a list of alpha factor expressions and clamp the result to [0, 1].
 * Used to compose entrance × adaptive into a single overlay.alpha string.
 */
export function composeAlpha(...factors: string[]): string {
  const trimmed = factors.filter((f) => f && f !== "1");
  if (trimmed.length === 0) return "1";
  return `min(1,max(0,${trimmed.join("*")}))`;
}

// ── Corner-stamp m0 layout ────────────────────────────────────

/**
 * Composed m0 + cell metrics for a corner-positioned stamp layout.
 *
 * The outer F is the base media (fills the canvas). Each overlay
 * layer carves a single cell at the chosen corner sized
 * `(stampPx + gutterPx) × (stampPx + gutterPx)`. The cell host source
 * is placed `hAlign: left, vAlign: top, inset: { right: insetRight,
 * bottom: insetBottom }` to leave the gutter visible as edge margin.
 */
export type CornerStampLayout = {
  /** Composed m0 string: `F{<cell>{<cell>...}}` with `overlayCount` layers. */
  m0: M0String;
  /** Pixel dimensions of each placed cell (`stampPx + gutterPx`, clamped to canvas). */
  cellW: number;
  cellH: number;
  /** Fraction of cell width to use as `placement.inset.right` on the QR source (legacy br shape). */
  insetRight: number;
  /** Fraction of cell height to use as `placement.inset.bottom` on the QR source (legacy br shape). */
  insetBottom: number;
  /** Corner-aware placement for the stamp content source — anchors opposite
   *  the corner with gutter insets on the corner-facing sides. Spread this
   *  (plus `fit`) onto the mosaic-ref source's placement. */
  contentPlacement: {
    hAlign: "left" | "right";
    vAlign: "top" | "bottom";
    inset: { left?: number; right?: number; top?: number; bottom?: number };
  };
};

/**
 * Build a corner-stamp m0 layout for any of the four corners (default
 * "br", byte-identical to the original bottom-right-only surface).
 */
export function buildCornerStampM0(opts: {
  canvasW: number;
  canvasH: number;
  stampPx: number;
  gutterPx: number;
  overlayCount: number;
  /** Which corner anchors the cell. Default "br" — the ONLY value the
   *  free-tier wrap and the brand qr-stamp templates use, and their
   *  output stays byte-identical (same code path, same numbers). The
   *  other three corners were a NEVER-WIRED knob on media/qr/stamp/v1
   *  until gate 23 (founder catch: "a lot of the knobs don't work"). */
  corner?: "br" | "bl" | "tr" | "tl";
}): CornerStampLayout {
  const { canvasW, canvasH, stampPx, gutterPx, overlayCount } = opts;
  const corner = opts.corner ?? "br";
  if (!Number.isInteger(overlayCount) || overlayCount < 1) {
    throw new Error(
      `buildCornerStampM0: overlayCount must be a positive integer, got ${overlayCount}`,
    );
  }
  const onRight = corner === "br" || corner === "tr";
  const onBottom = corner === "br" || corner === "bl";
  const cellSide = stampPx + gutterPx;
  const cellW = Math.min(cellSide, canvasW);
  const cellH = Math.min(cellSide, canvasH);
  const { m0: cellM0 } = placeRect({
    rootW: canvasW,
    rootH: canvasH,
    rectW: cellW,
    rectH: cellH,
    hAlign: onRight ? "right" : "left",
    vAlign: onBottom ? "bottom" : "top",
  });
  // Nest `overlayCount` overlay layers: F{cell{cell{cell...}}}
  const open = Array.from({ length: overlayCount }, () => `{${cellM0}`).join(
    "",
  );
  const close = "}".repeat(overlayCount);
  const m0 = `F${open}${close}` as M0String;
  const insetH = Math.min(1, Math.max(0, gutterPx / cellW));
  const insetV = Math.min(1, Math.max(0, gutterPx / cellH));
  return {
    m0,
    cellW,
    cellH,
    // Legacy br-shaped fields (brand qr-stamp templates read these).
    insetRight: insetH,
    insetBottom: insetV,
    // Corner-aware content placement: the stamp content anchors OPPOSITE
    // the corner, and the gutter insets carve the corner-facing sides.
    // For "br" this is byte-identical to the legacy literal
    // ({hAlign:"left", vAlign:"top", inset:{right, bottom}}).
    contentPlacement: {
      hAlign: onRight ? ("left" as const) : ("right" as const),
      vAlign: onBottom ? ("top" as const) : ("bottom" as const),
      inset: {
        ...(onRight ? { right: insetH } : { left: insetH }),
        ...(onBottom ? { bottom: insetV } : { top: insetV }),
      },
    },
  };
}
