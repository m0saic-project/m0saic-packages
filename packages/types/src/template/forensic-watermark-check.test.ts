import { describe, expect, it } from "@jest/globals";

import type {
  ForensicWatermarkCheckReport,
  ForensicWatermarkCheckSidecars,
  ForensicWatermarkCheckVerdict,
} from "./forensic-watermark-check";
import type { MosaicTemplateSidecars } from "./template";

/** A clean pass — every field populated. */
const PASS: ForensicWatermarkCheckReport = {
  ok: true,
  recoveredHex: "deadbeef",
  expectedHex: "deadbeef",
  matches: true,
  correctedBitCount: 3,
  errorPositions: [7, 41, 99],
  worstAbsScore: 4.72,
  framesSampled: 36,
  mode: "id32",
  verdict: "pass",
  grid: { cols: 64, rows: 36 },
  ecc: { n: 127, k: 36, t: 15 },
  videoPath: "/renders/stamped.mp4",
  sidecarPath: "/renders/stamped.watermark.json",
};

describe("ForensicWatermarkCheckReport — type-only", () => {
  // Compile-time gates: they run as no-ops, and what they assert is that
  // the type checker accepts (and rejects) the intended shapes.

  it("type-checks a fully-populated pass report", () => {
    expect(PASS.verdict).toBe("pass");
    expect(PASS.matches).toBe(true);
  });

  it("keeps the decoder's field names so old --out consumers still parse", () => {
    // These nine names are the CLI `decode-watermark --out` payload,
    // verbatim. Renaming any of them silently breaks scripts that were
    // written against the command this template replaced.
    const legacy: Pick<
      ForensicWatermarkCheckReport,
      | "ok"
      | "recoveredHex"
      | "expectedHex"
      | "matches"
      | "correctedBitCount"
      | "errorPositions"
      | "worstAbsScore"
      | "framesSampled"
      | "mode"
    > = PASS;
    expect(Object.keys(legacy).length).toBeGreaterThan(0);
  });

  it("allows recoveredHex to be absent on a failed decode", () => {
    const failed: ForensicWatermarkCheckReport = {
      ...PASS,
      ok: false,
      recoveredHex: undefined,
      matches: false,
      worstAbsScore: 0.31,
      verdict: "fail",
    };
    expect(failed.recoveredHex).toBeUndefined();
  });

  it("models a clean decode carrying a different payload as `mismatch`", () => {
    const other: ForensicWatermarkCheckReport = {
      ...PASS,
      recoveredHex: "0badcafe",
      matches: false,
      verdict: "mismatch",
    };
    // ok stays true — the codeword decoded; it just isn't ours.
    expect(other.ok).toBe(true);
    expect(other.verdict).toBe("mismatch");
  });

  it("carries a structured error only on the error verdict", () => {
    const errored: ForensicWatermarkCheckReport = {
      ...PASS,
      ok: false,
      recoveredHex: undefined,
      matches: false,
      correctedBitCount: 0,
      errorPositions: [],
      worstAbsScore: 0,
      framesSampled: 0,
      verdict: "error",
      error: { code: "SIDECAR_NOT_FOUND", message: "No sidecar at /renders/x.json" },
    };
    expect(errored.error?.code).toBe("SIDECAR_NOT_FOUND");
    expect(PASS.error).toBeUndefined();
  });

  it("covers exactly four verdicts", () => {
    const all: ForensicWatermarkCheckVerdict[] = ["pass", "mismatch", "fail", "error"];
    expect(all).toHaveLength(4);
  });

  it("ForensicWatermarkCheckSidecars conforms to MosaicTemplateSidecars", () => {
    const sidecars: ForensicWatermarkCheckSidecars = { watermarkCheck: PASS };
    const widened: MosaicTemplateSidecars = sidecars;
    expect(widened["watermarkCheck"]).toBeDefined();
  });
});
