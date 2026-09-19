/**
 * Typed contract for the `watermark` sidecar emitted by the forensic
 * watermarking template family (`@m0saic/forensic/watermark/*`).
 *
 * Forensic watermarks embed an imperceptible per-render payload (e.g.
 * a subscriber/install ID) into a video such that it survives
 * transcoding (YouTube/Twitter re-upload). The watermark itself lives
 * in the pixels; this sidecar is the **decoder's recipe** — without
 * it, the embedded payload cannot be recovered, since the decoder
 * needs the PRNG key, the cell grid, the slot timing, the ECC
 * parameters, and (for the non-blind variant) the host-signal
 * reference.
 *
 * Written to disk as `{output-basename}.watermark.json` next to the
 * watermarked video. Distinct from the visible scannable QR stamps
 * under `@m0saic/brand/qr-*` — those are brand markers, not
 * payload-bearing channels.
 *
 * The on-disk file-format side (`MosaicDocument.sidecars["watermark"]`)
 * stays opaque (`unknown`); this typed shape is the template-tier
 * contract that authors and decoder tools share.
 *
 * Algorithm reference: spatio-temporal A/B sequence with BCH error
 * correction — see the internal forensic-watermarking notes for
 * the full design.
 */

import type { MosaicTemplateSidecars } from "./template";

/**
 * Payload size modes supported in v1.
 *
 * - `"id32"` — 32-bit payload, BCH(127, k≈32) codeword. Subscriber /
 *   install short-id range; intended to pair with a server-side
 *   lookup for richer context. Survives one or two H.264 re-encodes
 *   at YouTube-ish bitrates with high reliability.
 * - `"uuid128"` — 128-bit payload (full UUID or installId + render
 *   serial). Self-contained identity; no lookup needed at decode
 *   time. Slightly less robust than `id32` at the same clip length
 *   because it carries 4× the data.
 *
 * Future modes (deferred): `"provenance"` — variable-length payload
 * up to ~4KB, intended to embed the full m0 string so a leaked clip
 * self-describes its rendering recipe.
 */
export type ForensicWatermarkPayloadMode = "id32" | "uuid128";

/**
 * Per-render embedding record. Everything the decoder needs.
 *
 * Field groups:
 *
 * - `payload` — the cleartext payload (for verification on a
 *   successful decode; the actual encoded bits live in the video).
 * - `ecc` — Bose–Chaudhuri–Hocquenghem code parameters used to
 *   wrap the payload before slot embedding.
 * - `key` — PRNG seed used to generate the spatial mask `W`.
 * - `grid` — spatial cell grid that the mask is defined over.
 * - `slots` — temporal slot timing.
 * - `embed` — alpha-curve parameters used at embed time.
 * - `hostReference` — per-cell expected luminance (the m0saic edge:
 *   non-blind decode boosts correlator SNR by ~10 dB vs. blind).
 * - `render` — render dimensions/fps/duration for sanity-checking
 *   the decoder input matches the embed conditions.
 */
export interface ForensicWatermarkSidecar {
  /** Sidecar contract version. Bump when the shape changes incompatibly. */
  version: "watermark/v1";

  /**
   * Algorithm tag. Recognized by the decoder; future variants ship
   * under new tags (`"spatio-temporal-ab-bch-v2"`, `"dct-coeff"`, …).
   */
  algorithm: "spatio-temporal-ab-bch";

  /** Payload (cleartext) and the chosen size mode. */
  payload: {
    mode: ForensicWatermarkPayloadMode;
    /** Number of payload bits (32 or 128 in v1). */
    bits: number;
    /** Hex-encoded payload value (lowercase, no `0x` prefix). */
    valueHex: string;
  };

  /** BCH(n, k, t) error-correction parameters. */
  ecc: {
    type: "BCH";
    /** Codeword length. v1 uses 127 (id32) or 255 (uuid128). */
    n: number;
    /** Data bits in the codeword (payload bits + any padding to fit). */
    k: number;
    /** Maximum correctable error count per codeword. */
    t: number;
    /** Hex-encoded generator polynomial (lowercase, no prefix). */
    generatorHex: string;
  };

  /** Deterministic PRNG seed used to build the spatial mask. */
  key: {
    /** PRNG identifier. v1 uses `mulberry32` from `@m0saic/template-utils`. */
    type: "mulberry32";
    /** Hex-encoded seed (8 hex chars for a 32-bit seed). */
    seedHex: string;
  };

  /** Spatial cell grid the mask `W` is defined over. */
  grid: {
    /** Cells along width. Default 64 for 1920px. */
    cols: number;
    /** Cells along height. Default 36 for 1080px. */
    rows: number;
    /** Cell width in pixels (`floor(width / cols)`). */
    cellWidth: number;
    /** Cell height in pixels (`floor(height / rows)`). */
    cellHeight: number;
  };

  /** Temporal slot layout. */
  slots: {
    /** Total number of slots (always equals `ecc.n` × repetition). */
    count: number;
    /** Number of output frames per slot (auto-derived from duration + fps). */
    framesPerSlot: number;
    /** Output-timeline ms when slot 0 begins (usually 0). */
    startMs: number;
    /**
     * Number of times each codeword bit is replayed across consecutive
     * slots. Larger = more robust, fewer distinct bits per clip. v1
     * auto-derives this from clip duration so even short clips get
     * the full codeword stamped at least once.
     */
    repetition: number;
  };

  /** Embedding alpha (luminance bias) parameters. */
  embed: {
    /** Baseline α applied per cell (e.g. 0.012 = 1.2% luminance shift). */
    alphaBase: number;
    /** Minimum α after luminance-adaptive scaling. */
    alphaMin: number;
    /** Maximum α after luminance-adaptive scaling. */
    alphaMax: number;
    /**
     * When true, per-cell α is scaled by a luminance-bucket curve so
     * smooth regions get smaller bias (less visible) and textured
     * regions get larger bias (better SNR). When false, every cell
     * uses `alphaBase`.
     */
    luminanceAdaptive: boolean;
  };

  /**
   * The m0saic edge: authored host-signal reference.
   *
   * For each (slot, cell), the renderer records the expected
   * luminance (0–255) of the host video at that location *before*
   * the watermark overlay was composited. At decode time, the
   * decoder subtracts this baseline from the sampled luminance,
   * leaving only watermark + codec noise — boosting correlator SNR
   * by ~10 dB vs. blind decode (which has to estimate the host
   * signal from neighboring cells).
   *
   * Shape: `luminanceGrid[slotIdx][cellIdx]` where `cellIdx = row *
   * cols + col`. Values are 0–255 unsigned 8-bit luminance.
   *
   * For long clips with many slots this can run ~100s of KB; the
   * sidecar is gzipped on write by the CLI. A future `--lean-sidecar`
   * mode will omit this field and the decoder will fall back to
   * blind decode.
   */
  hostReference: {
    type: "cell-luminance-grid";
    luminanceGrid: number[][];
  };

  /** Render dimensions/timing — decoder sanity-checks against these. */
  render: {
    fps: number;
    width: number;
    height: number;
    durationMs: number;
  };
}

/**
 * Sidecars shape for forensic-watermark templates. Extends the base
 * (so templates declared with this shape still match
 * `MosaicTemplateSidecars`).
 *
 * Pattern (from CLAUDE.md and template.ts JSDoc):
 *
 *   export const ForensicWatermarkVideoV1 = defineMosaicTemplate<
 *     Props,
 *     MosaicTemplateOutputs,
 *     MosaicTemplateUpstreamVariables,
 *     MosaicTemplateUpstreamData,
 *     ForensicWatermarkSidecars
 *   >({ … });
 */
export interface ForensicWatermarkSidecars extends MosaicTemplateSidecars {
  watermark: ForensicWatermarkSidecar;
}
