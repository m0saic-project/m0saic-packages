import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/hero/ffmpeg-pulse/scatter-bake/v1 — one-off internal BAKE template
 * ============================================================================
 *
 * Renders the signature rectangle scatter + its left→right rank-set reveal,
 * full-canvas on the dark canvas, as a standalone clip — so it can be baked to
 * a FLAT VIDEO and dropped into the beats as a single media source.
 *
 * Why: the live scatter is ~80K chars of m0 (225 per-tile sources) nested in
 * every beat — heavy DSL + render. The field is CONSTANT across the video, so
 * baking it once (the "reduce to 1 → flat video" perf win) collapses each beat's
 * parent m0 to a single scatter `F` and renders cheap. Bake one per aspect:
 *   m0saic make @m0saic/hero/ffmpeg-pulse/scatter-bake/v1 -w 1920 -h 1080 \
 *     --durationMs 9000 -o .../_shared/assets/scatter-desktop.mp4
 * (square 1080×1080 → scatter-square.mp4, mobile 1080×1920 → scatter-mobile.mp4)
 *
 * INTERNAL: not a curated/shippable template — purely a bake harness.
 * ============================================================================
 */

import type { MosaicDocument, MosaicEngineContext, MosaicTemplate } from "@m0saic/types";
import { definePropsSchema, registerTemplate } from "@m0saic/template-utils";
import { scatterNode } from "../../_shared/scatter";
import { pulseTheme } from "../../_shared/pulse-theme";

type ScatterBakeProps = {
  /** Fraction of the clip by which the reveal completes (matches the beats). */
  revealFinishFrac?: number;
  /** Per-tile fade duration (seconds). */
  tileSec?: number;
};

const propsSchema = definePropsSchema<ScatterBakeProps>({
  revealFinishFrac: { type: "number", required: false, description: "Fraction of the clip by which the L→R reveal completes.", meta: { ui: { label: "Reveal finish" } } },
  tileSec: { type: "number", required: false, description: "Per-tile fade duration (sec).", meta: { ui: { label: "Tile fade" } } },
});

export const FfmpegPulseScatterBake: MosaicTemplate<ScatterBakeProps> = {
  id: asTemplateId("@m0saic/hero/ffmpeg-pulse/scatter-bake/v1"),
  label: "Weekly Pulse · Scatter Bake (internal)",
  version: 1,
  description: "Internal bake harness: renders the FFmpeg Weekly Pulse rectangle scatter + its L→R rank-set reveal, full-canvas, for baking to a flat video the beats reference as one source.",
  capabilities: { tier: "core" },
  internal: true,
  tags: ["hero", "ffmpeg-pulse", "scatter", "bake", "internal"],
  outputHints: { width: 1920, height: 1080, fps: 30, durationMs: 9000 },
  propsSchema,
  defaultProps: { revealFinishFrac: 0.22, tileSec: 0.4 },

  render(props: ScatterBakeProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const theme = pulseTheme();
    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 9000) / 1000);
    const tileSec = props.tileSec ?? 0.4;
    const finishT = Math.max(tileSec + 0.05, clipSec * (props.revealFinishFrac ?? 0.22));
    const node = scatterNode({
      W, H,
      reveal: { startSec: 0, spanSec: Math.max(0.1, finishT - tileSec), tileSec, order: "horizontal" },
    });
    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: node.m0 as any,
      sources: node.sources,
      backgroundColor: theme.canvas, // opaque dark canvas baked in
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument);
  },
};

registerTemplate(FfmpegPulseScatterBake);
