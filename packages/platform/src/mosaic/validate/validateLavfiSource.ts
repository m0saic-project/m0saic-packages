import type { MosaicDiagnostic, MosaicLavfiSource } from "@m0saic/types";
import { asDiagnosticCode } from "@m0saic/types";

export function validateLavfiSource(
  source: MosaicLavfiSource,
  index: number,
  diagnostics: MosaicDiagnostic[]
): void {
  // --- required fields -------------------------------------------------------
  const hasLavfi = "lavfi" in source;
  const hasColor = "color" in source;

  if (!hasLavfi && !hasColor) {
    diagnostics.push({
      code: asDiagnosticCode("LAVFI_SOURCE_MISSING"),
      message: `Source[${index}] (lavfi) must specify either "lavfi" or "color".`,
      severity: "error",
    });
    return;
  }

  if (hasLavfi) {
    const v = (source as any).lavfi;
    if (typeof v !== "string") {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_EXPR_INVALID"),
        message: `Source[${index}] (lavfi) "lavfi" must be a string.`,
        severity: "error",
      });
      return;
    }
    if (v.trim().length === 0) {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_EXPR_EMPTY"),
        message: `Source[${index}] (lavfi) "lavfi" cannot be an empty string.`,
        severity: "error",
      });
      return;
    }
  }

  if (hasColor) {
    const c = (source as any).color;
    if (typeof c !== "string") {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_COLOR_INVALID"),
        message: `Source[${index}] (lavfi) "color" must be a string.`,
        severity: "error",
      });
      return;
    }
    if (c.trim().length === 0) {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_COLOR_EMPTY"),
        message: `Source[${index}] (lavfi) "color" cannot be an empty string.`,
        severity: "error",
      });
      return;
    }
  }

  // --- optional: size --------------------------------------------------------
  if (source.size) {
    const { wExpr, hExpr } = source.size;

    if (wExpr != null && typeof wExpr !== "string") {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_SIZE_WEXPR_INVALID"),
        message: `Source[${index}] (lavfi) size.wExpr must be a string when provided.`,
        severity: "error",
      });
    } else if (typeof wExpr === "string" && wExpr.trim().length === 0) {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_SIZE_WEXPR_EMPTY"),
        message: `Source[${index}] (lavfi) size.wExpr cannot be an empty string.`,
        severity: "error",
      });
    }

    if (hExpr != null && typeof hExpr !== "string") {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_SIZE_HEXPR_INVALID"),
        message: `Source[${index}] (lavfi) size.hExpr must be a string when provided.`,
        severity: "error",
      });
    } else if (typeof hExpr === "string" && hExpr.trim().length === 0) {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_SIZE_HEXPR_EMPTY"),
        message: `Source[${index}] (lavfi) size.hExpr cannot be an empty string.`,
        severity: "error",
      });
    }
  }

  // --- optional: overlay -----------------------------------------------------
  if (source.overlay) {
    const o: any = source.overlay;

    if (o.xExpr != null && typeof o.xExpr !== "string") {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_OVERLAY_XEXPR_INVALID"),
        message: `Source[${index}] (lavfi) overlay.xExpr must be a string when provided.`,
        severity: "error",
      });
    } else if (typeof o.xExpr === "string" && o.xExpr.trim().length === 0) {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_OVERLAY_XEXPR_EMPTY"),
        message: `Source[${index}] (lavfi) overlay.xExpr cannot be an empty string.`,
        severity: "error",
      });
    }

    if (o.yExpr != null && typeof o.yExpr !== "string") {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_OVERLAY_YEXPR_INVALID"),
        message: `Source[${index}] (lavfi) overlay.yExpr must be a string when provided.`,
        severity: "error",
      });
    } else if (typeof o.yExpr === "string" && o.yExpr.trim().length === 0) {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_OVERLAY_YEXPR_EMPTY"),
        message: `Source[${index}] (lavfi) overlay.yExpr cannot be an empty string.`,
        severity: "error",
      });
    }

    if (o.enable != null && typeof o.enable !== "string") {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_OVERLAY_ENABLE_INVALID"),
        message: `Source[${index}] (lavfi) overlay.enable must be a string when provided.`,
        severity: "error",
      });
    } else if (typeof o.enable === "string" && o.enable.trim().length === 0) {
      diagnostics.push({
        code: asDiagnosticCode("LAVFI_OVERLAY_ENABLE_EMPTY"),
        message: `Source[${index}] (lavfi) overlay.enable cannot be an empty string.`,
        severity: "error",
      });
    }

    if (o.startAtSec != null) {
      if (typeof o.startAtSec !== "number" || !Number.isFinite(o.startAtSec)) {
        diagnostics.push({
          code: asDiagnosticCode("LAVFI_OVERLAY_STARTAT_INVALID"),
          message: `Source[${index}] (lavfi) overlay.startAtSec must be a finite number when provided.`,
          severity: "error",
        });
      } else if (o.startAtSec < 0) {
        diagnostics.push({
          code: asDiagnosticCode("LAVFI_OVERLAY_STARTAT_NEGATIVE"),
          message: `Source[${index}] (lavfi) overlay.startAtSec cannot be negative.`,
          severity: "error",
        });
      }
    }
  }

  // playback/effects/visual/placement are already validated (or tolerated) elsewhere.
}