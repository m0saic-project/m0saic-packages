/**
 * `@m0saic/forensic/watermark/verify/v1`
 *
 * The decode half of the forensic watermarking family. Point it at a
 * delivered video plus the `.watermark.json` the embed wrote, and it
 * samples the video, recovers the payload, and renders a report card
 * stating the verdict and why.
 *
 * This used to be `m0saic decode-watermark`. It moved because a CLI
 * cannot grow a bespoke command per template family — the decoder is a
 * template like everything else, reached through `m0saic make`, and it
 * shows up in the Templates UI instead of being buried in `--help`.
 *
 * Exit codes vs. the verdict
 * --------------------------
 * `make` exits 0 whenever the *render* succeeds, so a FAIL verdict is a
 * successful render of a FAIL card. Scripts that need to branch read the
 * `watermarkCheck` sidecar (`verdict` / `ok`), which is written on every
 * path for exactly that reason.
 */

import type {
  ForensicWatermarkCheckReport,
  ForensicWatermarkCheckSidecars,
  MosaicAssetManifest,
  MosaicDocument,
  MosaicEngineContext,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import {
  defineMosaicTemplate,
  definePropsSchema,
  makeErrorMosaic,
  registerTemplate,
} from "@m0saic/template-utils";

import {
  alpineTheme,
  resolveAlpineTheme,
  type AlpinePreset,
} from "../../../../alpine/_shared/alpine-theme";
import { cellLuminanceSampler } from "../../_shared/cellLuminance";
import { discoverSidecarPath, runCheck } from "./decode";
import { buildReportCard, verdictPresentation } from "./report";

const TEMPLATE_ID = "@m0saic/forensic/watermark/verify/v1";
const VIDEO_ASSET_ID = "verify_input";

// ── Props ─────────────────────────────────────────────────────────

export type ForensicWatermarkVerifyV1Props = {
  /** The delivered video to check. */
  videoPath?: string;
  /** Embed sidecar; auto-discovered next to the video when omitted. */
  sidecarPath?: string;
  /** Assert against a specific payload instead of the sidecar's claim. */
  expectedHex?: string;
  /**
   * Pixel rect `"x,y,w,h"` of the delivered frame that holds the marked
   * content — set it when a platform padded the copy (letterbox /
   * pillarbox bars) so the cells line up again. Empty = whole frame.
   */
  contentRect?: string;
  /** Card title. */
  title?: string;
  /** Light / dark chrome. */
  preset?: AlpinePreset;
  /** Show payload hexes in full. Off redacts to `••••beef`. */
  showPayload?: boolean;
  /** Which frame the input panel shows. */
  posterFrameMs?: number;
};

const DEFAULTS: ForensicWatermarkVerifyV1Props = {
  title: "Watermark check",
  preset: "light",
  showPayload: true,
  posterFrameMs: 0,
};

const propsSchema = definePropsSchema<ForensicWatermarkVerifyV1Props>({
  videoPath: {
    type: "media",
    required: true,
    description: "The delivered video to check for an embedded payload.",
    meta: {
      ui: { label: "Video to check", order: 1 },
      control: { picker: "file", accept: ["video"] },
    },
  },
  sidecarPath: {
    type: "string",
    required: false,
    description:
      "The `.watermark.json` written at embed time. Defaults to the same basename next to the video — set it explicitly when the delivered file has been renamed.",
    // No `accept` — it only narrows media kinds (video/audio/image), and
    // this is a JSON sidecar.
    meta: {
      ui: { label: "Sidecar", order: 2 },
      control: { placeholder: "auto (next to the video)", picker: "file" },
    },
  },
  expectedHex: {
    type: "string",
    required: false,
    description:
      "Assert a specific payload (hex). Defaults to whatever the sidecar says was embedded; set it to ask whether this is one particular recipient's copy.",
    meta: { control: { placeholder: "from sidecar" }, ui: { label: "Expected payload", order: 3 } },
  },
  contentRect: {
    type: "string",
    required: false,
    description:
      "Pixel rect `x,y,w,h` of the marked content inside the delivered frame. Set it when a platform letterboxed or pillarboxed the copy (e.g. a 16:9 clip inside a 1080×1920 Reel: `0,420,1080,608`). Empty = the whole frame.",
    meta: { control: { placeholder: "whole frame" }, ui: { label: "Content rect", order: 8 } },
  },
  title: {
    type: "string",
    required: false,
    description: "Card title.",
    meta: { ui: { label: "Title", order: 4 } },
  },
  preset: {
    type: "string",
    required: false,
    description: "Chrome preset (light | dark).",
    meta: { ui: { label: "Preset", order: 5 }, constraints: { oneOf: ["light", "dark"] } },
  },
  showPayload: {
    type: "boolean",
    required: false,
    description:
      "Print payload hexes in full. Turn off when the card will be shared — payloads identify recipients.",
    meta: { ui: { label: "Show payload", order: 6 } },
  },
  posterFrameMs: {
    type: "number",
    required: false,
    description: "Offset of the frame shown in the input panel.",
    meta: { ui: { label: "Poster frame (ms)", order: 7 }, constraints: { min: 0 } },
  },
});

// ── Helpers ───────────────────────────────────────────────────────

/** "1920×1080 · 30 fps · 12.4 s" from what the engine already probed. */
function inputCaption(ctx: MosaicEngineContext, videoPath: string): string | undefined {
  const meta = ctx.media?.[asAssetId(videoPath)];
  if (!meta) return undefined;
  const bits: string[] = [];
  if (meta.width && meta.height) bits.push(`${meta.width}×${meta.height}`);
  if (meta.fps) bits.push(`${Math.round(meta.fps)} fps`);
  if (meta.durationMs) bits.push(`${(meta.durationMs / 1000).toFixed(1)} s`);
  return bits.length ? bits.join(" · ") : undefined;
}

/** `"x,y,w,h"` → crop rect; undefined when blank, null when malformed. */
export function parseContentRect(
  raw: string | undefined,
): { x: number; y: number; width: number; height: number } | undefined | null {
  const t = raw?.trim();
  if (!t) return undefined;
  const parts = t.split(/[,\s]+/).map((v) => Number(v));
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width < 2 || height < 2) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** A report shell for states where no decode has run. */
function blankReport(
  videoPath: string,
  sidecarPath: string,
): ForensicWatermarkCheckReport {
  return {
    ok: false,
    recoveredHex: undefined,
    expectedHex: "",
    matches: false,
    correctedBitCount: 0,
    errorPositions: [],
    worstAbsScore: 0,
    framesSampled: 0,
    mode: "id32",
    verdict: "error",
    grid: { cols: 0, rows: 0 },
    ecc: { n: 0, k: 0, t: 0 },
    videoPath,
    sidecarPath,
  };
}

// ── Template ──────────────────────────────────────────────────────

export const ForensicWatermarkVerifyV1 = defineMosaicTemplate<
  ForensicWatermarkVerifyV1Props,
  {},
  {},
  {},
  ForensicWatermarkCheckSidecars
>({
  id: asTemplateId(TEMPLATE_ID),
  label: "Forensic Watermark — Verify",
  version: 1,
  description:
    "Check a delivered video against its `.watermark.json` and render a report card: PASS / MISMATCH / FAIL / ERROR, the recovered payload, ECC headroom and confidence, plus the reason. Emits a `watermarkCheck` sidecar carrying the same result as JSON. The decode half of `@m0saic/forensic/watermark/video/v1`.",
  capabilities: {
    tier: "capability",
    // Read-only by design: the sidecar is read, the video is sampled
    // through the engine's `ctx.analysis.cellLuminance` pass (the host's
    // toolchain ffmpeg), nothing is written or staged. Narrower than the
    // embed template, which needs write+temp for its mask PNG.
    caps: { fs: { read: true }, exec: { spawn: true } },
  },
  tags: ["utility", "forensic", "watermark", "verify", "provenance", "attribution", "creators", "developers", "video"],

  outputHints: {
    width: 1600,
    height: 1000,
    // A verdict has no time dimension — as a video this would be N
    // identical frames. `doc.format` stays unset so an explicit
    // `-o out.mp4` still works; it just holds one frame.
    format: { kind: "image", container: "png" },
  },

  propsSchema,
  defaultProps: DEFAULTS,

  sidecarsSchema: {
    watermarkCheck: {
      type: "object",
      required: true,
      description:
        "Decode verdict + full stats → `{output-basename}.watermarkCheck.json`. Written unconditionally: the render exits 0 regardless of verdict, so this is the machine-readable channel.",
    },
  },

  async render(
    props: ForensicWatermarkVerifyV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    if (!props.videoPath) {
      // ASCII only in this card: makeErrorMosaic renders via drawtext,
      // which has no unicode support (an em-dash comes out as "?"). The
      // report card itself uses the SVG rasterizer and is unicode-safe.
      return makeErrorMosaic(
        "ForensicWatermarkVerifyV1: set `videoPath` to the video you want to check. " +
          "The `.watermark.json` sidecar is found next to it automatically, or set `sidecarPath`.",
        { title: "Forensic Watermark - Verify", width: W, height: H },
      );
    }

    const theme = await resolveAlpineTheme(props.preset ?? "light", ctx);
    const contentRect = parseContentRect(props.contentRect);
    if (props.contentRect?.trim() && !contentRect) {
      return makeErrorMosaic(
        `ForensicWatermarkVerifyV1: contentRect must be "x,y,w,h" in pixels (got "${props.contentRect}").`,
        { title: "Forensic Watermark - Verify", width: W, height: H },
      );
    }
    const report = await runCheck({
      videoPath: props.videoPath,
      sidecarPath: props.sidecarPath,
      expectedHex: props.expectedHex,
      ...(contentRect ? { crop: contentRect } : {}),
      // The engine's sampling pass, bound to the host's toolchain ffmpeg.
      // Absent (no toolchain) → the check reports ANALYSIS_UNAVAILABLE on
      // the card instead of guessing at a binary on PATH.
      sampler: cellLuminanceSampler(ctx),
    });

    const assets: MosaicAssetManifest = {
      [asAssetId(VIDEO_ASSET_ID)]: {
        kind: "file",
        path: props.videoPath,
        mediaType: "video",
      },
    } as MosaicAssetManifest;

    const root = buildReportCard({
      report,
      theme,
      W,
      H,
      title: props.title ?? DEFAULTS.title!,
      showPayload: props.showPayload ?? true,
      videoAssetId: VIDEO_ASSET_ID,
      posterFrameMs: props.posterFrameMs ?? 0,
      inputCaption: inputCaption(ctx, props.videoPath),
    });

    return {
      kind: "mosaic_document",
      version: 1,
      m0: root.m0 as never,
      backgroundColor: theme.canvas,
      assets,
      sources: root.sources,
      sidecars: { watermarkCheck: report },
    } as MosaicDocument;
  },

  /**
   * Preview stand-in. Shows the real layout so the operator can size and
   * theme the card, but never samples the video and never emits a
   * sidecar — a design-mode preview must not look like a verdict.
   */
  renderLite(
    props: ForensicWatermarkVerifyV1Props,
    ctx: MosaicEngineContext,
  ): MosaicDocument {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    // Sync preset lookup — renderLite is synchronous, so it takes the
    // preset chrome directly rather than awaiting token resolution.
    const theme = alpineTheme(props.preset ?? "light");

    const videoPath = props.videoPath ?? "";
    const sidecarPath = props.sidecarPath?.trim()
      ? props.sidecarPath.trim()
      : videoPath
        ? discoverSidecarPath(videoPath)
        : "";

    const report = blankReport(videoPath, sidecarPath);

    const assets: MosaicAssetManifest = (
      videoPath
        ? {
            [asAssetId(VIDEO_ASSET_ID)]: {
              kind: "file",
              path: videoPath,
              mediaType: "video",
            },
          }
        : {}
    ) as MosaicAssetManifest;

    const root = buildReportCard({
      report,
      theme,
      W,
      H,
      title: props.title ?? DEFAULTS.title!,
      showPayload: props.showPayload ?? true,
      videoAssetId: videoPath ? VIDEO_ASSET_ID : undefined,
      posterFrameMs: props.posterFrameMs ?? 0,
      bandOverride: {
        color: theme.muted,
        headline: "NOT CHECKED — run Make to sample the video",
      },
      pending: true,
    });

    return {
      kind: "mosaic_document",
      version: 1,
      m0: root.m0 as never,
      backgroundColor: theme.canvas,
      assets,
      sources: root.sources,
    } as MosaicDocument;
  },
});

registerTemplate(ForensicWatermarkVerifyV1);
export default ForensicWatermarkVerifyV1;

// Surface the presentation helper for tests that assert band colour per verdict.
export { verdictPresentation };
