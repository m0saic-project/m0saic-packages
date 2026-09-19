/**
 * Type-level smoke tests for MosaicDiagnostic.
 *
 * MosaicDiagnostic is the render-pipeline planning diagnostic, distinct
 * from the validator-output Diagnostic in ./diagnostic.
 */
import type { MosaicDiagnostic, MosaicDiagnosticCode } from "./diagnostic";
import {
  MOSAIC_DIAGNOSTIC_CODES,
  isMosaicDiagnosticCode,
} from "./diagnostic";
import {
  asDiagnosticCode,
  DIAGNOSTIC_CODE_PATTERN,
} from "../identifiers";

describe("MosaicDiagnostic", () => {
  it("accepts the minimal required shape", () => {
    const d: MosaicDiagnostic = {
      code: asDiagnosticCode("MISSING_SOURCE"),
      message: "Source for tile 0 was not provided",
      severity: "error",
    };
    expect(d.code).toBe("MISSING_SOURCE");
  });

  it("severity is the closed two-value union", () => {
    const errSev: MosaicDiagnostic["severity"] = "error";
    const warnSev: MosaicDiagnostic["severity"] = "warning";
    expect([errSev, warnSev]).toEqual(["error", "warning"]);
  });
});

describe("MOSAIC_DIAGNOSTIC_CODES (diagnostic-code registry)", () => {
  it("every registered code matches DIAGNOSTIC_CODE_PATTERN", () => {
    // The pattern is the tier contract; the registry is the
    // current closed set. Every registered code must satisfy the
    // contract (or the registry has drifted from its own brand).
    for (const code of MOSAIC_DIAGNOSTIC_CODES) {
      expect(DIAGNOSTIC_CODE_PATTERN.test(code)).toBe(true);
    }
  });

  it("contains the historically required core codes", () => {
    // Anchors against accidental removal during refactors.
    // Anything in this set is part of the v1 contract.
    const required: MosaicDiagnosticCode[] = [
      "MISSING_SOURCE",
      "MOSAIC_REF_FORWARD_REFERENCE",
      "VARIABLES_NOT_YET_IMPLEMENTED",
      "SIDECAR_NOT_YET_IMPLEMENTED",
      "OUTPUT_TARGET_FORMAT_CONFLICT",
      "M0C_LABEL_MISSING",
    ];
    for (const code of required) {
      expect(MOSAIC_DIAGNOSTIC_CODES.includes(code)).toBe(true);
    }
  });

  it("contains the layout-floor code the planner emits for a canvas below the safe minimum", () => {
    expect(MOSAIC_DIAGNOSTIC_CODES.includes("LAYOUT_BELOW_SAFE_MIN")).toBe(true);
    expect(isMosaicDiagnosticCode("LAYOUT_BELOW_SAFE_MIN")).toBe(true);
  });

  it("contains the playback playSpeed wiring codes", () => {
    const required: MosaicDiagnosticCode[] = [
      "PLAY_SPEED_NOT_WIRED_FOR_SOURCE",
      "PLAY_SPEED_INVALID_IGNORED",
      "PLAY_SPEED_CLAMPED",
    ];
    for (const code of required) {
      expect(MOSAIC_DIAGNOSTIC_CODES.includes(code)).toBe(true);
    }
  });

  it("has no duplicates", () => {
    const set = new Set(MOSAIC_DIAGNOSTIC_CODES);
    expect(set.size).toBe(MOSAIC_DIAGNOSTIC_CODES.length);
  });

  it("does NOT include retired codes (back-edge invariant)", () => {
    // MOSAIC_REF_CYCLE_DETECTED is structurally impossible under
    // the back-edge-only invariant. Forward references replace it.
    expect(
      (MOSAIC_DIAGNOSTIC_CODES as readonly string[]).includes(
        "MOSAIC_REF_CYCLE_DETECTED",
      ),
    ).toBe(false);
  });

  it("each registered code round-trips through asDiagnosticCode", () => {
    for (const code of MOSAIC_DIAGNOSTIC_CODES) {
      const d: MosaicDiagnostic = {
        code: asDiagnosticCode(code),
        message: "test",
        severity: "error",
      };
      expect(d.code).toBe(code);
    }
  });
});

describe("isMosaicDiagnosticCode", () => {
  it("accepts every registered code", () => {
    for (const code of MOSAIC_DIAGNOSTIC_CODES) {
      expect(isMosaicDiagnosticCode(code)).toBe(true);
    }
  });

  it("rejects unregistered codes, even if they match the pattern", () => {
    expect(isMosaicDiagnosticCode("NOT_A_REAL_CODE")).toBe(false);
    expect(isMosaicDiagnosticCode("FUTURE_CODE_NOT_YET_ADDED")).toBe(false);
  });

  it("rejects malformed values", () => {
    expect(isMosaicDiagnosticCode(undefined)).toBe(false);
    expect(isMosaicDiagnosticCode(null)).toBe(false);
    expect(isMosaicDiagnosticCode(42)).toBe(false);
    expect(isMosaicDiagnosticCode("lowercase")).toBe(false);
  });
});
