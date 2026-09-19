/**
 * `@m0saic/forensic/watermark/video/v1`
 *
 * Embed an imperceptible per-render payload (subscriber ID, install
 * UUID, …) into a base video using a spatial-cell BCH-coded
 * watermark. The decoder is its sibling template,
 * `@m0saic/forensic/watermark/verify/v1` — run it through `make` like
 * any other template; it renders a verdict card and emits the result
 * as a `watermarkCheck` sidecar.
 *
 * Algorithm
 * ---------
 *  1. Encode the payload via BCH(127, 36, 15) (id32) or
 *     BCH(255, 131, 18) (uuid128).
 *  2. Build a cell-grid mask from the PRNG seed; each cell carries
 *     one codeword bit with a per-cell sign flip.
 *  3. Materialize an RGBA PNG (cells → upscaled to canvas) with
 *     near-transparent ±luminance overlays.
 *  4. Composite the PNG over the base video at full alpha (the PNG's
 *     own alpha channel does the blending).
 *  5. Emit a `ForensicWatermarkSidecar` describing every parameter
 *     the decoder needs.
 *
 * Output envelope — the deliverable IS the source video
 * -----------------------------------------------------
 * The result is a 1-step `emit:"multi"` pipeline (the media-pack
 * pattern: blur-regions, highlights, the visible watermark), so the
 * output tracks the SOURCE's dimensions, frame rate and duration
 * instead of the template's 1920×1080 / 10 s hints — a 720p 12 s clip
 * comes back as a 720p 12 s clip with an invisible mark, audio intact.
 * An explicit duration / fps ask (CLI `--durationMs`/`--fps`, the Make
 * Duration override) still wins over the follow.
 *
 * Determinism: identical (payload, seed, grid, canvas, α curve, host
 * grid when adaptive) produces byte-identical PNG bytes and a
 * byte-identical sidecar.
 *
 * Robustness target (v1)
 *  - Survives single/double H.264 re-encodes at ≥ 4 Mbps for 1080p.
 *  - Does NOT survive crop, rotation, scale change, or
 *    screen-recording / camcorder capture.
 *
 * See the internal forensic-watermarking notes for the design.
 */

import type {
  ForensicWatermarkPayloadMode,
  ForensicWatermarkSidecar,
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaMetadata,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import { placeRect, toM0String } from "@m0saic/dsl-stdlib";
import {
  buildStepNames,
  defineMosaicTemplate,
  definePropsSchema,
  forensic,
  makeColorTile,
  makeErrorMosaic,
  registerTemplate,
} from "@m0saic/template-utils";

import { overlay, paint, rowSplit } from "../../../../alpine/_shared/alpine-card";
import { cellLuminanceSampler } from "../../_shared/cellLuminance";
import { buildMaskPng, makeFingerprint } from "./maskAsset";
import { ProbeHostError, probeHostLuminance } from "./probeHost";

const {
  DEFAULT_ALPHA_OPTS,
  encodePayload,
  paramsForMode,
} = forensic;

const TEMPLATE_ID = "@m0saic/forensic/watermark/video/v1";
const LABEL = "Forensic Watermark (Video)";

// ── Props ─────────────────────────────────────────────────────────

export type ForensicWatermarkVideoV1Props = {
  /** Path to the base video file. Required. */
  videoPath?: string;

  /** `"id32"` (32-bit payload) or `"uuid128"` (128-bit). */
  payloadMode?: ForensicWatermarkPayloadMode;

  /** Hex-encoded payload value. Length must match the chosen mode. */
  payloadHex?: string;

  /**
   * PRNG seed driving the cell→bit assignment and sign mask. Hex
   * string (1–8 chars). Optional — auto-derived from a hash of
   * `payloadHex` when omitted. **Different renders MUST use different
   * keys**, otherwise distinct payloads share the same cell layout
   * and a leaker who recovered one mark can de-stamp others.
   */
  keyHex?: string;

  /** Cell grid columns. Default 64. */
  gridCols?: number;
  /** Cell grid rows. Default 36. */
  gridRows?: number;

  /** Uniform α (luminance shift, 0..1) when `luminanceAdaptive` is off. Default 0.012. */
  alphaBase?: number;

  /**
   * Scale α per cell by the host: a luminance bell (peaking at `alphaMax`
   * on mid-greys, `alphaMin` at near-black / near-white) multiplied by a
   * TEXTURE mask (flat cells — walls, sky, gradients, where a constant
   * step reads as a checkerboard — fall to `alphaMin`; textured cells
   * keep the bell). Probed from the source at 2× the grid. Default ON;
   * off = uniform `alphaBase`.
   */
  luminanceAdaptive?: boolean;

  /** Floor α of the adaptive curve (dark/bright cells). Default 0.004. */
  alphaMin?: number;

  /** Ceiling α of the adaptive curve (textured mid-grey cells). Default 0.02. */
  alphaMax?: number;

  /**
   * Soft cell edges: Gaussian blur of the mask, as a fraction of the cell
   * size (0 = hard cells, 0.5 = a full half-cell ramp). A hard per-cell
   * step on a smooth gradient reads as a faint checkerboard; softened over
   * a few px it becomes a low-frequency bump the eye ignores while the
   * cell interior the decoder integrates keeps its offset. Default 0.15.
   */
  edgeSoftness?: number;

  /**
   * Pre-probed per-cell host luminance (row-major, length cols*rows).
   * When supplied, the template skips the engine probe and uses this
   * directly as the sidecar's `hostReference.luminanceGrid`. Agent /
   * test hatch — hidden from the Make form.
   */
  hostLuminanceGrid?: number[];
};

// ── Defaults ──────────────────────────────────────────────────────

const DEFAULTS = {
  payloadMode: "id32" as ForensicWatermarkPayloadMode,
  payloadHex: "deadbeef",
  gridCols: 64,
  gridRows: 36,
  alphaBase: DEFAULT_ALPHA_OPTS.alphaBase,
  // Gate-34 tuning (founder: "sorta visible on renders"): adaptive α with
  // the texture mask + soft cell edges. Measured on three clips vs the old
  // uniform-0.012 hard grid: flat-region residual 1.88 → 1.10 luma RMS
  // (bright), 1.53 → 0.37 (dark night); decode margin still ≥ 3 native and
  // PASS after a 1 Mbps re-encode on every clip.
  luminanceAdaptive: true,
  alphaMin: DEFAULT_ALPHA_OPTS.alphaMin,
  alphaMax: 0.02,
  edgeSoftness: 0.15,
};

const propsSchema = definePropsSchema<ForensicWatermarkVideoV1Props>({
  videoPath: {
    type: "media",
    required: true,
    description:
      "Base video to watermark. The output keeps its dimensions, frame rate, duration and audio.",
    meta: { ui: { label: "Video", order: 1 }, control: { picker: "file", accept: ["video"] } },
  },
  payloadMode: {
    type: "string",
    required: false,
    description: "Payload size mode: id32 (32-bit, 8 hex chars) or uuid128 (128-bit, 32 hex chars).",
    meta: { ui: { label: "Payload mode", order: 2 }, constraints: { oneOf: ["id32", "uuid128"] } },
  },
  payloadHex: {
    type: "string",
    required: false,
    description:
      "Hex-encoded payload — the recipient / install id this copy is stamped with (8 chars for id32, 32 chars for uuid128).",
    meta: { ui: { label: "Payload (hex)", order: 3 } },
  },
  keyHex: {
    type: "string",
    required: false,
    description:
      "Hex-encoded PRNG seed (1–8 chars). Auto-derived from the payload when omitted; use a distinct key per render so one recovered mark can't de-stamp others.",
    meta: { ui: { label: "Key (hex)", order: 4 }, control: { placeholder: "derived from payload" } },
  },
  gridCols: {
    type: "number",
    required: false,
    description: "Cell grid columns. More cells per codeword bit = more decode margin, larger sidecar.",
    meta: { ui: { label: "Grid columns", order: 5 }, constraints: { min: 4, max: 256 } },
  },
  gridRows: {
    type: "number",
    required: false,
    description: "Cell grid rows.",
    meta: { ui: { label: "Grid rows", order: 6 }, constraints: { min: 4, max: 256 } },
  },
  alphaBase: {
    type: "number",
    required: false,
    description: "Uniform per-cell luminance shift (0..1) used when Adaptive strength is OFF. 0.012 ≈ 1.5 luma levels; survives a 500 kbps re-encode.",
    meta: { ui: { label: "Strength (α, uniform)", order: 7 }, constraints: { min: 0.001, max: 0.1 } },
  },
  luminanceAdaptive: {
    type: "boolean",
    required: false,
    description:
      "Scale α per cell by the host: full strength on textured mid-greys, the floor on flat / near-black / near-white cells where a constant step would show. Off = uniform α.",
    meta: { ui: { label: "Adaptive strength", order: 8 } },
  },
  alphaMin: {
    type: "number",
    required: false,
    description: "Adaptive curve floor — α on flat, near-black or near-white cells.",
    meta: { ui: { label: "Adaptive α min", order: 9 }, constraints: { min: 0.0, max: 0.1 } },
  },
  alphaMax: {
    type: "number",
    required: false,
    description: "Adaptive curve ceiling — α on textured mid-grey cells.",
    meta: { ui: { label: "Adaptive α max", order: 10 }, constraints: { min: 0.0, max: 0.2 } },
  },
  edgeSoftness: {
    type: "number",
    required: false,
    description:
      "Soft cell edges — blur the mask by this fraction of a cell (0 = hard blocks, 0.5 = half-cell ramp). Hides the faint checkerboard a hard grid leaves on smooth gradients.",
    meta: { ui: { label: "Edge softness", order: 11 }, constraints: { min: 0, max: 0.5 } },
  },
  hostLuminanceGrid: {
    type: "json",
    required: false,
    description:
      "Pre-probed per-cell host luminance (row-major, length cols*rows). Skips the engine probe when supplied — agent / test hatch.",
    meta: { ui: { label: "Host luminance grid", hidden: true, consumer: "agent" } },
  },
});

// ── Helpers ───────────────────────────────────────────────────────

const PAYLOAD_HEX_LEN: Record<ForensicWatermarkPayloadMode, number> = {
  id32: 8, // 32 bits / 4 bits-per-hex-char
  uuid128: 32, // 128 / 4
};

/** Derive a deterministic 32-bit key from a payload hex when keyHex absent. */
function keyFromPayload(payloadHex: string): string {
  // Simple non-cryptographic hash — sufficient for "make a default seed
  // different per payload"; production callers should pass an explicit
  // keyHex.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < payloadHex.length; i += 1) {
    h ^= payloadHex.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function parseKey(keyHex: string): number {
  const cleaned = keyHex.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{1,8}$/.test(cleaned)) {
    throw new Error(`forensic-watermark: invalid keyHex "${keyHex}"`);
  }
  return parseInt(cleaned, 16) >>> 0;
}

/** Even pixel dims — yuv420p needs them, and probed sizes can be odd. */
function evenRound(v: number): number {
  const r = Math.round(v);
  return r % 2 === 0 ? r : r + 1;
}

/**
 * The output envelope: follow the SOURCE (dims / fps / duration) when the
 * host probed it, else fall back to the target the host handed us. An
 * explicit user ask (`ctx.userIntent`) wins over the follow for the
 * fields a user can ask for.
 */
export function resolveOutputEnvelope(
  meta: MosaicMediaMetadata | undefined,
  ctx: Pick<MosaicEngineContext, "target" | "userIntent">,
): { width: number; height: number; fps: number; durationMs: number; followed: boolean } {
  const followed = !!meta && meta.width > 0 && meta.height > 0;
  const width = followed ? evenRound(meta.width) : Math.max(2, evenRound(ctx.target.width));
  const height = followed ? evenRound(meta.height) : Math.max(2, evenRound(ctx.target.height));
  const followFps =
    followed && typeof meta.fps === "number" && meta.fps > 0 ? Math.max(1, Math.round(meta.fps)) : undefined;
  const followDur =
    followed && typeof meta.durationMs === "number" && meta.durationMs > 0
      ? Math.max(1, Math.round(meta.durationMs))
      : undefined;
  const userFps = ctx.userIntent?.fps;
  const userDur = ctx.userIntent?.durationMs;
  const fps =
    typeof userFps === "number" && userFps > 0
      ? Math.round(userFps)
      : followFps ?? Math.max(1, Math.round(ctx.target.fps ?? 30));
  const durationMs =
    typeof userDur === "number" && userDur > 0
      ? Math.round(userDur)
      : followDur ?? Math.max(1, Math.round(ctx.target.durationMs ?? 1000));
  return { width, height, fps, durationMs, followed };
}

/** One SVG-rasterized text cell (design-mode stand-in only). */
function bandText(content: string, fontSize: number, color: MosaicColor, label: string): MosaicSource {
  return {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: content },
        style: { fontSize, fontColor: color, fontWeight: "bold" as const },
        placement: { fit: "contain", hAlign: "left", vAlign: "middle", padding: { left: 0.02, right: 0.02 } },
      },
    ],
    editor: { owner: "template", label },
  } as unknown as MosaicSource;
}

function errorCard(message: string, ctx: MosaicEngineContext): MosaicDocument {
  return makeErrorMosaic(message, {
    title: LABEL,
    width: ctx.target.width,
    height: ctx.target.height,
  });
}

// ── Template ──────────────────────────────────────────────────────

type Sidecars = { watermark: ForensicWatermarkSidecar };

export const ForensicWatermarkVideoV1 = defineMosaicTemplate<
  ForensicWatermarkVideoV1Props,
  {},
  {},
  {},
  Sidecars
>({
  id: asTemplateId(TEMPLATE_ID),
  label: LABEL,
  version: 1,
  description:
    "Embed an invisible per-render payload (subscriber/install ID or UUID) into a video using a BCH-coded spatial-cell watermark. The output keeps the source's size, frame rate, duration and audio; the mark survives YouTube-grade re-encodes. Emits a `.watermark.json` sidecar carrying the keys needed to recover the payload; check a delivered copy with `@m0saic/forensic/watermark/verify/v1`.",
  capabilities: {
    tier: "capability",
    // fs.write/temp: `maskAsset.ts` materializes the cell mask as a PNG in
    // the temp dir. exec.spawn: the host-luminance probe is an ffmpeg pass
    // (engine-mediated via ctx.analysis, bound to the toolchain binary).
    caps: { fs: { read: true, write: true, temp: true }, exec: { spawn: true } },
  },
  tags: ["utility", "forensic", "watermark", "provenance", "attribution", "creators", "developers", "animated", "invisible", "video"],

  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 10_000,
    format: { kind: "video", container: "mp4" },
  },

  propsSchema,
  defaultProps: DEFAULTS,

  sidecarsSchema: {
    watermark: {
      type: "object",
      required: true,
      description:
        "Per-render embedding record (payload, ECC params, key, grid, slots, embed α, host reference, render dims). The decoder uses this to recover the payload from a leaked copy.",
    },
  },

  async render(
    props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument | MosaicDocumentPipeline> {
    // ── Resolve props with defaults ───────────────────────────
    if (!props.videoPath) {
      return errorCard(
        "ForensicWatermarkVideoV1: pick the video to watermark (videoPath). The output keeps its size, frame rate, duration and audio; a `.watermark.json` sidecar lands next to it.",
        ctx,
      );
    }

    const payloadMode = props.payloadMode ?? DEFAULTS.payloadMode;
    const payloadHex = (props.payloadHex ?? DEFAULTS.payloadHex).toLowerCase();
    const gridCols = props.gridCols ?? DEFAULTS.gridCols;
    const gridRows = props.gridRows ?? DEFAULTS.gridRows;
    const alphaBase = props.alphaBase ?? DEFAULTS.alphaBase;
    const luminanceAdaptive = props.luminanceAdaptive ?? DEFAULTS.luminanceAdaptive;
    const alphaMin = props.alphaMin ?? DEFAULTS.alphaMin;
    const alphaMax = props.alphaMax ?? DEFAULTS.alphaMax;
    const edgeSoftness = Math.max(0, Math.min(0.5, props.edgeSoftness ?? DEFAULTS.edgeSoftness));

    // Validate payload length matches mode
    const expectedHexLen = PAYLOAD_HEX_LEN[payloadMode];
    if (payloadHex.length !== expectedHexLen) {
      return errorCard(
        `ForensicWatermarkVideoV1: payloadHex must be ${expectedHexLen} chars for ${payloadMode} mode (got ${payloadHex.length}).`,
        ctx,
      );
    }
    if (!/^[0-9a-f]+$/.test(payloadHex)) {
      return errorCard("ForensicWatermarkVideoV1: payloadHex must be hex (0-9, a-f).", ctx);
    }
    if (luminanceAdaptive && !(alphaMin <= alphaMax)) {
      return errorCard(
        `ForensicWatermarkVideoV1: alphaMin (${alphaMin}) must not exceed alphaMax (${alphaMax}) when luminanceAdaptive is on.`,
        ctx,
      );
    }

    const keyHex = props.keyHex ?? keyFromPayload(payloadHex);
    let seed: number;
    try {
      seed = parseKey(keyHex);
    } catch (err) {
      return errorCard((err as Error).message, ctx);
    }

    // ── Output envelope: the deliverable is the source video ──
    const meta = ctx.media[asAssetId(props.videoPath)];
    if (meta && meta.kind !== "video" && meta.kind !== "unknown") {
      return errorCard(
        `ForensicWatermarkVideoV1: needs a video input (got ${meta.kind}): ${props.videoPath}`,
        ctx,
      );
    }
    const env = resolveOutputEnvelope(meta, ctx);
    const canvasW = env.width;
    const canvasH = env.height;
    const fps = env.fps;
    const durationMs = env.durationMs;

    // ── Probe per-cell host luminance ─────────────────────────
    // The decoder's non-blind correlation needs a per-cell baseline
    // (what the host looked like BEFORE the watermark) so it can
    // subtract host bias and recover the ±α perturbation. Blind
    // correlation (subtracting a global mean) is overwhelmed by
    // real-content variation — sky vs. ground in a single frame
    // swamps the ~1.5 lumen-unit watermark with ~50+ lumen-unit
    // residual host signal.
    //
    // The probe is the engine's `ctx.analysis.cellLuminance` pass
    // (toolchain ffmpeg): source cover-fit to the output canvas, last
    // frame held, area-downsampled to the grid and averaged across all
    // frames — the same cell-grid tail the verify template runs on the
    // delivered output, so probe and decode see apples-to-apples cells.
    let hostGrid: number[];
    // Per-cell ACTIVITY (spread of the 2×2 sub-cell means) — the texture
    // mask for adaptive α. Probed at twice the grid in a second pass; the
    // 1× reference above stays the exact chain the decoder re-runs.
    let hostActivity: number[] | undefined;
    const expectedGridLen = gridCols * gridRows;
    if (props.hostLuminanceGrid !== undefined) {
      if (props.hostLuminanceGrid.length !== expectedGridLen) {
        return errorCard(
          `ForensicWatermarkVideoV1: hostLuminanceGrid length ${props.hostLuminanceGrid.length} != cols*rows ${expectedGridLen}.`,
          ctx,
        );
      }
      hostGrid = props.hostLuminanceGrid.slice();
    } else {
      try {
        const probe = await probeHostLuminance(cellLuminanceSampler(ctx), {
          videoPath: props.videoPath,
          cols: gridCols,
          rows: gridRows,
          canvasW,
          canvasH,
          fps,
          durationMs,
        });
        hostGrid = probe.luminanceGrid;
        if (luminanceAdaptive) {
          const fine = await probeHostLuminance(cellLuminanceSampler(ctx), {
            videoPath: props.videoPath,
            cols: gridCols * 2,
            rows: gridRows * 2,
            canvasW,
            canvasH,
            fps,
            durationMs,
          });
          hostActivity = cellActivity(fine.luminanceGrid, gridCols, gridRows);
        }
      } catch (err) {
        if (err instanceof ProbeHostError) {
          return errorCard(
            `ForensicWatermarkVideoV1: host-luminance probe failed: ${err.message}`,
            ctx,
          );
        }
        throw err;
      }
    }

    // ── Encode payload → per-cell plan ───────────────────────
    const encoded = encodePayload({
      mode: payloadMode,
      payloadHex,
      seed,
      cols: gridCols,
      rows: gridRows,
      alpha: { alphaBase, alphaMin, alphaMax, luminanceAdaptive },
      // Adaptive α reads the same host grid the decoder subtracts; the
      // decoder correlates on SIGN, so per-cell magnitude never has to be
      // carried in the sidecar.
      ...(luminanceAdaptive ? { hostLuminance: hostGrid } : {}),
      ...(luminanceAdaptive && hostActivity ? { hostActivity } : {}),
    });

    // ── Materialize the mask PNG ─────────────────────────────
    // Content-addressed: everything that decides the PNG bytes goes into
    // the fingerprint — with adaptive α that includes every cell's α.
    const fingerprint = makeFingerprint([
      "forensic/v1",
      payloadMode,
      payloadHex,
      keyHex,
      gridCols,
      gridRows,
      canvasW,
      canvasH,
      alphaBase.toFixed(6),
      luminanceAdaptive
        ? `adaptive:${alphaMin.toFixed(6)}:${alphaMax.toFixed(6)}:${encoded.cells.map((c) => c.alpha.toFixed(6)).join(",")}`
        : "uniform",
      `soft:${edgeSoftness.toFixed(3)}`,
    ]);
    const cellPxW = canvasW / gridCols;
    const cellPxH = canvasH / gridRows;
    const blurSigmaPx = edgeSoftness * Math.min(cellPxW, cellPxH);
    const { pngPath } = await buildMaskPng({
      cells: encoded.cells.map((c: { polarity: -1 | 1; alpha: number }) => ({
        polarity: c.polarity,
        alpha: c.alpha,
      })),
      cols: gridCols,
      rows: gridRows,
      canvasW,
      canvasH,
      fingerprint,
      blurSigmaPx,
    });

    // ── Layout: base video filling canvas + mask overlaid full-rect ──
    const layout = placeRect({
      rootW: canvasW,
      rootH: canvasH,
      rectW: canvasW,
      rectH: canvasH,
      hAlign: "left",
      vAlign: "top",
    });
    const m0 = toM0String(
      `F{${layout.m0}}` as never,
      "ForensicWatermarkVideoV1",
    );

    // ── Assets ───────────────────────────────────────────────
    const baseAssetId = asAssetId("forensic_v1_base");
    const maskAssetId = asAssetId("forensic_v1_mask");
    const assets: MosaicAssetManifest = {
      [baseAssetId]: {
        kind: "file",
        path: props.videoPath,
        mediaType: "video",
      },
      [maskAssetId]: {
        kind: "file",
        path: pngPath,
        mediaType: "image",
      },
    };

    // ── Sources ──────────────────────────────────────────────
    const sources: MosaicSource[] = [
      // Base video — fills the canvas (a 1:1 fit when the envelope
      // follows the source; a cover-crop only on an explicit odd canvas).
      {
        type: "media",
        mediaType: "video",
        assetId: baseAssetId,
        placement: { fit: "cover" },
      },
      // Watermark mask — covers the canvas; PNG alpha channel does the
      // blending so we set overlay alpha=1. The PNG is already rendered
      // at canvas dims by `buildMaskPng`, so `cover` is a 1:1 placement.
      {
        type: "media",
        mediaType: "image",
        assetId: maskAssetId,
        placement: { fit: "cover" },
        overlay: { alpha: "1" },
      },
    ];

    // ── Sidecar ──────────────────────────────────────────────
    const { params } = paramsForMode(payloadMode);
    const cellWidth = Math.floor(canvasW / gridCols);
    const cellHeight = Math.floor(canvasH / gridRows);
    // Pack the binary generator polynomial (LSB-first per byte) into a hex
    // string so the sidecar carries a stable, decoder-readable form.
    const genBytes: number[] = [];
    const gen = params.generator as ReadonlyArray<number>;
    for (let i = 0; i < gen.length; i += 1) {
      const byteIdx = Math.floor(i / 8);
      genBytes[byteIdx] = (genBytes[byteIdx] ?? 0) | ((gen[i] ?? 0) << (i % 8));
    }
    const generatorHex = Buffer.from(genBytes).toString("hex");
    const totalFrames = Math.max(1, Math.floor((durationMs * fps) / 1000));
    const sidecar: ForensicWatermarkSidecar = {
      version: "watermark/v1",
      algorithm: "spatio-temporal-ab-bch",
      payload: {
        mode: payloadMode,
        bits: payloadMode === "id32" ? 32 : 128,
        valueHex: payloadHex,
      },
      ecc: {
        type: "BCH",
        n: params.n,
        k: params.k,
        t: params.t,
        generatorHex,
      },
      key: {
        type: "mulberry32",
        seedHex: keyHex.padStart(8, "0"),
      },
      grid: {
        cols: gridCols,
        rows: gridRows,
        cellWidth,
        cellHeight,
      },
      slots: {
        count: 1,
        framesPerSlot: totalFrames,
        startMs: 0,
        // v1 spatial mode: "repetition" = cells per codeword bit.
        repetition: encoded.mask.cellsPerBit,
      },
      embed: {
        alphaBase,
        alphaMin,
        alphaMax,
        luminanceAdaptive,
      },
      hostReference: {
        // Per-cell mean luminance of the source video, probed via the
        // engine's ffmpeg pass before render. The decoder subtracts this
        // baseline before correlation — the +10 dB non-blind SNR lever
        // that recovers payloads from real-content frames where global-
        // mean subtraction alone is overwhelmed by host variance.
        type: "cell-luminance-grid",
        luminanceGrid: [hostGrid],
      },
      render: {
        fps,
        width: canvasW,
        height: canvasH,
        durationMs,
      },
    };

    const stepDoc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0,
      assets,
      sources,
      size: { width: canvasW, height: canvasH },
      fps,
      durationMs,
      format: { kind: "video", container: "mp4" },
      sidecars: { watermark: sidecar },
    };

    // 1-step multi-emit pipeline: the step's own size/fps/duration ARE the
    // output envelope on every host (CLI -w/-h is only the default canvas
    // for steps that don't declare one), and the `watermark` sidecar lands
    // next to the step's deliverable — `out.mp4` → `out.watermark.json`,
    // exactly where the verify template auto-discovers it.
    return {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      fps,
      steps: [
        {
          name: buildStepNames([props.videoPath])[0]!,
          label: stepLabel(props.videoPath),
          durationMs,
          file: stepDoc,
        },
      ],
    };
  },

  /**
   * Design-mode stand-in: the picked video full-bleed above a slim status
   * band saying what WILL be embedded. Never probes, never writes a mask,
   * never emits a sidecar — selecting the template in Make must not spawn
   * an ffmpeg pass over the whole source (the real `render()` does).
   */
  renderLite(props: ForensicWatermarkVideoV1Props, ctx: MosaicEngineContext): MosaicDocument {
    if (!props.videoPath) {
      return errorCard(
        "ForensicWatermarkVideoV1: pick the video to watermark (videoPath). The output keeps its size, frame rate, duration and audio; a `.watermark.json` sidecar lands next to it.",
        ctx,
      );
    }
    const W = Math.max(2, Math.round(ctx.target.width));
    const H = Math.max(2, Math.round(ctx.target.height));
    const payloadMode = props.payloadMode ?? DEFAULTS.payloadMode;
    const payloadHex = (props.payloadHex ?? DEFAULTS.payloadHex).toLowerCase();
    const baseAssetId = asAssetId("forensic_v1_base");
    const bandH = Math.max(28, Math.round(H / 14));
    const bandFont = Math.max(11, Math.round(bandH * 0.38));
    const root = rowSplit([
      {
        weight: Math.max(1, H - bandH),
        node: paint({
          type: "media",
          mediaType: "video",
          assetId: baseAssetId,
          placement: { fit: "contain" },
        } as MosaicSource),
      },
      {
        weight: bandH,
        node: overlay([
          paint(makeColorTile("#111827" as MosaicColor)),
          paint(
            bandText(
              `FORENSIC WATERMARK — NOT YET EMBEDDED · run Make to stamp ${payloadMode} ${payloadHex} invisibly into this video`,
              bandFont,
              "#E5E7EB" as MosaicColor,
              "standin-band",
            ),
          ),
        ]),
      },
    ]);
    return {
      kind: "mosaic_document",
      version: 1,
      m0: root.m0 as never,
      backgroundColor: "#000000" as MosaicColor,
      assets: {
        [baseAssetId]: { kind: "file", path: props.videoPath, mediaType: "video" },
      } as MosaicAssetManifest,
      sources: root.sources,
    };
  },
});

/**
 * Per-cell activity from a 2×-resolution luminance grid: the spread
 * (max − min) of each cell's four sub-cell means, in luma units. A smooth
 * gradient reads ~1–4, real texture ≥ 24 (see `ACTIVITY_FULL_GAIN`).
 */
export function cellActivity(fine: ReadonlyArray<number>, cols: number, rows: number): number[] {
  const fineCols = cols * 2;
  const out = new Array<number>(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = fine[(2 * r) * fineCols + 2 * c] ?? 0;
      const b = fine[(2 * r) * fineCols + 2 * c + 1] ?? 0;
      const d = fine[(2 * r + 1) * fineCols + 2 * c] ?? 0;
      const e = fine[(2 * r + 1) * fineCols + 2 * c + 1] ?? 0;
      out[r * cols + c] = Math.max(a, b, d, e) - Math.min(a, b, d, e);
    }
  }
  return out;
}

/** Input basename without directory or extension — the step label. */
function stepLabel(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

registerTemplate(ForensicWatermarkVideoV1);
export default ForensicWatermarkVideoV1;
