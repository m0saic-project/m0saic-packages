/**
 * The check itself: sidecar + delivered video → verdict.
 *
 * Ported from the CLI's `decode-watermark` command, minus two things:
 * the ffmpeg sampling now goes through the family's shared sampler — the
 * engine's `ctx.analysis.cellLuminance`, so embed and verify provably run
 * the same filtergraph on the host's toolchain ffmpeg — and nothing is
 * written to disk — the template's render path owns output.
 *
 * Everything here is total: `runCheck` never throws. Expected failures
 * (missing sidecar, unreadable video, un-decodable payload) come back as
 * a report with `verdict: "error"` or `"fail"`, because the caller is a
 * template `render()` that has to draw *something* either way.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type {
  ForensicWatermarkCheckReport,
  ForensicWatermarkSidecar,
} from "@m0saic/types";
import { forensic } from "@m0saic/template-utils";

import {
  CellSampleError,
  sampleCellLuminance,
  type CellLuminanceSampler,
} from "../../_shared/cellLuminance";

/** Suffix `writeSidecars` gives the embed sidecar, next to the video. */
export const SIDECAR_SUFFIX = ".watermark.json";

/**
 * Presence floor on the MEAN |score| (luma units summed over a bit's
 * cells). The un-marked original subtracts against its own host
 * reference to a zero residual; every score is 0, the all-zero codeword
 * is syndrome-clean, and BCH alone "recovers" payload 0 — a `mismatch`
 * that would read as "someone else's copy". A real mark at the default
 * α puts ~1.5 luma × cellsPerBit into every score (mean ≈ 16 at 64×36
 * on 720p; ≈ 2–6 on the coarsest grids / harshest re-encodes measured),
 * so 0.25 is far below any legitimate decode and far above float noise.
 */
export const MIN_PRESENCE_MEAN_ABS_SCORE = 0.25;

/** Sidecar problems carry a stable code so the report card can branch. */
export class SidecarError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SidecarError";
    this.code = code;
  }
}

/**
 * Where the embed sidecar lands by convention: same directory, same
 * basename, `.watermark.json`. The render pipeline derives both from one
 * output path, so `out.mp4` → `out.watermark.json` holds by construction.
 *
 * This is a convenience, not a guarantee — a leaked file is rarely still
 * named after the render that produced it, which is why `sidecarPath`
 * stays an explicit prop.
 */
export function discoverSidecarPath(videoPath: string): string {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  return path.join(dir, `${base}${SIDECAR_SUFFIX}`);
}

/**
 * Read + validate the embed sidecar.
 *
 * @throws {SidecarError} not found, unreadable, not JSON, or a
 * version/algorithm this build cannot decode.
 */
export function readSidecar(sidecarPath: string): ForensicWatermarkSidecar {
  if (!fs.existsSync(sidecarPath)) {
    throw new SidecarError(
      "SIDECAR_NOT_FOUND",
      `Sidecar not found: ${sidecarPath}`,
    );
  }
  let raw: string;
  try {
    raw = fs.readFileSync(sidecarPath, "utf8");
  } catch (err) {
    throw new SidecarError(
      "SIDECAR_UNREADABLE",
      `Failed to read sidecar at ${sidecarPath}: ${(err as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SidecarError(
      "SIDECAR_INVALID_JSON",
      `Sidecar at ${sidecarPath} is not valid JSON: ${(err as Error).message}`,
    );
  }
  const sc = parsed as ForensicWatermarkSidecar;
  if (sc.version !== "watermark/v1") {
    throw new SidecarError(
      "SIDECAR_VERSION_UNSUPPORTED",
      `Unsupported sidecar version "${(sc as { version?: string }).version}". This template handles watermark/v1.`,
    );
  }
  if (sc.algorithm !== "spatio-temporal-ab-bch") {
    throw new SidecarError(
      "SIDECAR_ALGORITHM_UNSUPPORTED",
      `Unsupported algorithm "${(sc as { algorithm?: string }).algorithm}". This template handles spatio-temporal-ab-bch.`,
    );
  }
  return sc;
}

/**
 * Build the per-cell host baseline the correlator subtracts.
 *
 * Non-blind (the sidecar carries a real grid) is the +10 dB path. Blind
 * falls back to the global mean, which holds up on flat content and
 * collapses on real content — worth knowing when a `fail` verdict shows
 * a near-zero `worstAbsScore`.
 */
function buildHostLuminance(
  sidecar: ForensicWatermarkSidecar,
  sampled: number[],
  cellCount: number,
): number[] {
  const grid = sidecar.hostReference?.luminanceGrid ?? [];
  if (grid.length === 0) {
    let mean = 0;
    for (let i = 0; i < cellCount; i += 1) mean += sampled[i]!;
    mean /= cellCount;
    return new Array(cellCount).fill(mean);
  }
  // v1 writes exactly one slot.
  const slot0 = grid[0];
  if (!slot0 || slot0.length !== cellCount) {
    throw new SidecarError(
      "SIDECAR_HOST_REFERENCE_MALFORMED",
      `Sidecar hostReference is malformed: expected slot 0 to have ${cellCount} cells, got ${slot0?.length ?? 0}.`,
    );
  }
  return slot0.slice();
}

export interface RunCheckInputs {
  /** The delivered video to check. */
  videoPath: string;
  /** Embed sidecar. Discovered next to the video when omitted. */
  sidecarPath?: string;
  /**
   * Payload to assert against. Defaults to whatever the sidecar says was
   * embedded; set it to answer "is this specifically subscriber X's copy?"
   * independent of the sidecar's own claim.
   */
  expectedHex?: string;
  /**
   * The engine sampling pass (`ctx.analysis.cellLuminance`). Undefined when
   * the host attached no analysis surface — the check then reports an
   * `ANALYSIS_UNAVAILABLE` error verdict instead of guessing at a binary.
   */
  sampler: CellLuminanceSampler | undefined;
  /**
   * Sample only this pixel rect of the delivered frame (a platform's
   * letterbox / pillarbox bars sit outside it). Whole frame when omitted.
   */
  crop?: { x: number; y: number; width: number; height: number };
}

/** Shape an `error` verdict when the check could not run. */
function errorReport(
  inputs: { videoPath: string; sidecarPath: string; expectedHex: string },
  code: string,
  message: string,
): ForensicWatermarkCheckReport {
  return {
    ok: false,
    recoveredHex: undefined,
    expectedHex: inputs.expectedHex,
    matches: false,
    correctedBitCount: 0,
    errorPositions: [],
    worstAbsScore: 0,
    framesSampled: 0,
    mode: "id32",
    verdict: "error",
    grid: { cols: 0, rows: 0 },
    ecc: { n: 0, k: 0, t: 0 },
    videoPath: inputs.videoPath,
    sidecarPath: inputs.sidecarPath,
    error: { code, message },
  };
}

/**
 * Run the check. Never throws — see the module header.
 */
export async function runCheck(inputs: RunCheckInputs): Promise<ForensicWatermarkCheckReport> {
  const sidecarPath = inputs.sidecarPath?.trim()
    ? inputs.sidecarPath.trim()
    : discoverSidecarPath(inputs.videoPath);
  const ctx = {
    videoPath: inputs.videoPath,
    sidecarPath,
    expectedHex: inputs.expectedHex ?? "",
  };

  let sidecar: ForensicWatermarkSidecar;
  try {
    sidecar = readSidecar(sidecarPath);
  } catch (err) {
    if (err instanceof SidecarError) {
      return errorReport(ctx, err.code, err.message);
    }
    return errorReport(ctx, "SIDECAR_UNREADABLE", (err as Error).message);
  }

  const { cols, rows } = sidecar.grid;
  const cellCount = cols * rows;
  const expectedHex = inputs.expectedHex?.trim()
    ? inputs.expectedHex.trim().toLowerCase()
    : sidecar.payload.valueHex;
  const withPayload = { ...ctx, expectedHex };

  let sampled: number[];
  let framesSampled: number;
  try {
    // The delivered file as-is: no cover-fit, no hold, the file's own rate
    // and length. The embed side authored its reference over the same
    // cell-grid tail, so the two grids subtract cleanly.
    const res = await sampleCellLuminance(inputs.sampler, inputs.videoPath, {
      cols,
      rows,
      ...(inputs.crop ? { crop: inputs.crop } : {}),
    });
    sampled = res.luminanceGrid;
    framesSampled = res.frameCount;
  } catch (err) {
    const code = err instanceof CellSampleError ? err.code : "SAMPLING_ERROR";
    return errorReport(withPayload, code, (err as Error).message);
  }

  let hostLuminance: number[];
  try {
    hostLuminance = buildHostLuminance(sidecar, sampled, cellCount);
  } catch (err) {
    const code = err instanceof SidecarError ? err.code : "HOST_REFERENCE_ERROR";
    return errorReport(withPayload, code, (err as Error).message);
  }

  let decoded: ReturnType<typeof forensic.decodePayload>;
  try {
    decoded = forensic.decodePayload({
      mode: sidecar.payload.mode,
      seed: parseInt(sidecar.key.seedHex.replace(/^0x/, ""), 16),
      cols,
      rows,
      sampledLuminance: sampled,
      hostLuminance,
    });
  } catch (err) {
    return errorReport(withPayload, "DECODE_ERROR", (err as Error).message);
  }

  const meanAbsScore =
    decoded.scores.length > 0
      ? decoded.scores.reduce((acc, v) => acc + Math.abs(v), 0) / decoded.scores.length
      : 0;
  // No watermark ENERGY → fail, whatever BCH made of the zero vector (see
  // MIN_PRESENCE_MEAN_ABS_SCORE). Checked before the codeword verdict.
  const present = meanAbsScore >= MIN_PRESENCE_MEAN_ABS_SCORE;
  const ok = decoded.ok && present;
  const recoveredHex = ok ? decoded.payloadHex : undefined;
  const matches = !!recoveredHex && recoveredHex === expectedHex;
  // A clean codeword carrying someone else's payload is a `mismatch`, not
  // a `fail` — the tool worked; the file just isn't the copy we expected.
  const verdict = !ok ? "fail" : matches ? "pass" : "mismatch";

  return {
    ok,
    recoveredHex,
    expectedHex,
    matches,
    correctedBitCount: decoded.correctedBitCount,
    errorPositions: decoded.errorPositions,
    worstAbsScore: decoded.worstAbsScore,
    meanAbsScore,
    framesSampled,
    mode: sidecar.payload.mode,
    verdict,
    grid: { cols, rows },
    ecc: { n: sidecar.ecc.n, k: sidecar.ecc.k, t: sidecar.ecc.t },
    videoPath: inputs.videoPath,
    sidecarPath,
  };
}
