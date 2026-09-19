/**
 * Typed contract for the `watermarkCheck` sidecar emitted by
 * `@m0saic/forensic/watermark/verify/v1` — the decode half of the
 * forensic watermarking family.
 *
 * Where `ForensicWatermarkSidecar` (see `./forensic-watermark`) is the
 * decoder's *recipe*, written at embed time, this is the decoder's
 * *verdict*, written at check time. The verify template samples a
 * delivered video against that recipe and reports what it recovered.
 *
 * Why a sidecar and not an exit code
 * ----------------------------------
 * The check runs as an ordinary template render (`m0saic make …`), so
 * the process exit code means "the render succeeded", not "the payload
 * matched". A failing verdict is a successful render of a FAIL card.
 * Scripts that need to branch on the outcome read this sidecar's
 * `verdict` (or `ok`) — that is the machine-readable channel, and it is
 * written unconditionally for exactly that reason.
 *
 * Written to disk as `{output-basename}.watermarkCheck.json` next to the
 * rendered report card.
 */

import type { ForensicWatermarkPayloadMode } from "./forensic-watermark";
import type { MosaicTemplateSidecars } from "./template";

/**
 * The four outcomes a check can reach.
 *
 * - `"pass"` — a clean codeword decoded AND it matches the expected
 *   payload. The delivered file is the copy you think it is.
 * - `"mismatch"` — a clean codeword decoded, but it carries a
 *   *different* payload. Not a tool failure: this is the "someone
 *   else's copy leaked" answer, and it is usually the single most
 *   operationally interesting result. Kept distinct from `"fail"` so
 *   callers never have to guess which red they got.
 * - `"fail"` — no syndrome-clean codeword could be recovered, OR the
 *   correlation carried no watermark energy at all (`meanAbsScore`
 *   below the presence floor — the un-marked original subtracts to a
 *   zero residual, whose all-zero codeword is trivially "clean").
 *   Either the file was never watermarked, or the channel was degraded
 *   past what the ECC can correct. `worstAbsScore`, `meanAbsScore` and
 *   `correctedBitCount` are the signal for telling those apart.
 * - `"error"` — the check could not run at all (sidecar unreadable,
 *   ffmpeg sampling failed, grid mismatch). Says nothing about the
 *   video; see `error`.
 */
export type ForensicWatermarkCheckVerdict = "pass" | "mismatch" | "fail" | "error";

/**
 * Per-check result record.
 *
 * The first block is the decoder's raw output, field-for-field. The
 * second block adds the context a human (or a report card) needs to
 * interpret it without also opening the embed sidecar.
 */
export interface ForensicWatermarkCheckReport {
  // ── decoder output ────────────────────────────────────────

  /** True iff BCH-decode produced a syndrome-clean codeword. */
  ok: boolean;
  /** Recovered payload (hex, lowercase, no `0x`). Undefined when `ok` is false. */
  recoveredHex?: string;
  /** The payload the check was asserting against. */
  expectedHex: string;
  /** Whether `recoveredHex` equals `expectedHex`. */
  matches: boolean;
  /** Number of bit positions BCH had to correct. */
  correctedBitCount: number;
  /** Codeword indices BCH corrected. */
  errorPositions: number[];
  /**
   * Smallest absolute correlation score across all bits — the
   * confidence proxy. Rule of thumb: ≥3 healthy, 1–3 marginal,
   * <1 means the watermark is effectively not there.
   */
  worstAbsScore: number;
  /**
   * Mean absolute correlation score across all bits — the PRESENCE
   * proxy. An un-marked copy of the exact source subtracts to zero
   * residual everywhere, and the all-zero codeword is syndrome-clean,
   * so BCH alone would "decode" payload 0… and report a mismatch. Below
   * `~0.25` the checker reports `fail` (no watermark energy) instead.
   * Absent on `error` verdicts (nothing was correlated).
   */
  meanAbsScore?: number;
  /** Frames sampled from the video. */
  framesSampled: number;
  /** Payload size mode the embed sidecar declared. */
  mode: ForensicWatermarkPayloadMode;

  // ── check context ─────────────────────────────────────────

  /** The classified outcome. */
  verdict: ForensicWatermarkCheckVerdict;
  /** Cell grid the check sampled at (mirrors the embed sidecar's `grid`). */
  grid: { cols: number; rows: number };
  /** BCH parameters in play — `t` is the correctable-error budget. */
  ecc: { n: number; k: number; t: number };
  /** The video that was checked. */
  videoPath: string;
  /** The embed sidecar that was used as the recipe. */
  sidecarPath: string;
  /** Present only when `verdict` is `"error"`. */
  error?: { code: string; message: string };
}

/**
 * Sidecars shape for the verify template. Extends the base so templates
 * declared with this shape still match `MosaicTemplateSidecars`.
 */
export interface ForensicWatermarkCheckSidecars extends MosaicTemplateSidecars {
  watermarkCheck: ForensicWatermarkCheckReport;
}
