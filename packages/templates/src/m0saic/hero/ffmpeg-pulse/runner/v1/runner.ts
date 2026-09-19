import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/hero/ffmpeg-pulse/runner/v1 — Weekly Pulse · Runner (pipeline)
 * ============================================================================
 *
 * Sequences the eight FFmpeg Weekly Pulse beats into one MosaicDocumentPipeline:
 *   title → kpi-overview → activity-trend → top-contributors → changes-breakdown
 *         → contributions → notable-commits → fin
 *
 * Each beat renders full-canvas (renderNestedTemplate at the runner's target size)
 * as its own pipeline step, so every step gets a fresh overlay-depth budget. The
 * whole `pulse` data sheet is passed to each beat as a direct prop (Phase 4 swaps
 * to upstream-first). Per-beat durations are props (deterministic defaults ~35s);
 * steps cross-fade. Aspect-adaptive (the beats classify W/H themselves).
 * ============================================================================
 */

import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicPipelineStep,
  MosaicTemplate,
} from "@m0saic/types";
import { definePropsSchema, getTemplate, makeErrorMosaic, makeStubMosaic, registerTemplate, renderNestedTemplate, stripPropBindings } from "@m0saic/template-utils";
import { type WeeklyPulse, MOCK_FFMPEG_PULSE, resolvePulse, WEEKLY_PULSE_UPSTREAM_SCHEMA } from "../../_shared/pulse-data";

type BeatTimings = {
  title?: number;
  kpiOverview?: number;
  activityTrend?: number;
  contributions?: number;
  topContributors?: number;
  changesBreakdown?: number;
  notableCommits?: number;
  fin?: number;
};
/** Render weight applied to every beat — see `renderMode` prop. */
type RenderMode = "premium" | "light";
type RunnerProps = { pulse: WeeklyPulse; timings?: BeatTimings; crossfadeMs?: number; renderMode?: RenderMode; requireUpstream?: boolean };

// Beat order + default per-beat durations (ms). Sum ≈ 35s. Order pairs the two
// activity views (trend → heatmap) and ends on the closing card.
const BEATS: { key: keyof BeatTimings; id: string; defMs: number }[] = [
  { key: "title", id: "@m0saic/hero/ffmpeg-pulse/title/v1", defMs: 4000 },
  { key: "kpiOverview", id: "@m0saic/hero/ffmpeg-pulse/kpi-overview/v1", defMs: 5000 },
  { key: "activityTrend", id: "@m0saic/hero/ffmpeg-pulse/activity-trend/v1", defMs: 5000 },
  { key: "contributions", id: "@m0saic/hero/ffmpeg-pulse/contributions/v1", defMs: 4500 },
  { key: "topContributors", id: "@m0saic/hero/ffmpeg-pulse/top-contributors/v1", defMs: 5000 },
  { key: "changesBreakdown", id: "@m0saic/hero/ffmpeg-pulse/changes-breakdown/v1", defMs: 5000 },
  { key: "notableCommits", id: "@m0saic/hero/ffmpeg-pulse/notable-commits/v1", defMs: 5500 },
  { key: "fin", id: "@m0saic/hero/ffmpeg-pulse/fin/v1", defMs: 4000 },
];

/**
 * Sequence the eight beats into one cross-faded MosaicDocumentPipeline from an
 * already-resolved pulse sheet. Shared by the core runner (mock / prop / upstream)
 * and the capability-tier `@m0saic/github/weekly-pulse` (fetch → derive → render),
 * so both produce the identical beat pipeline.
 */
export async function buildPulsePipeline(
  pulse: WeeklyPulse,
  opts: { timings?: BeatTimings; crossfadeMs?: number; renderMode?: RenderMode },
  ctx: MosaicEngineContext,
): Promise<MosaicDocumentPipeline> {
  const W = Math.max(1, Math.round(ctx.target.width));
  const H = Math.max(1, Math.round(ctx.target.height));
  const timings = opts.timings ?? {};
  const crossfadeMs = Math.max(0, Math.round(opts.crossfadeMs ?? 350));
  const renderMode: RenderMode = opts.renderMode === "light" ? "light" : "premium";

  const steps: MosaicPipelineStep[] = [];
  for (let i = 0; i < BEATS.length; i++) {
    const b = BEATS[i];
    const isLast = i === BEATS.length - 1;
    const hasCrossfade = !isLast && crossfadeMs > 0;
    // A crossfade OVERLAPS the two beats it joins — the stitched
    // pipeline is `Σ steps − Σ crossfade`, not `Σ steps`. So a beat
    // that fades out has to carry its own transition ON TOP of its
    // visible time, or the hero renders short of the total its beat
    // timings add up to (8 beats × 350ms fades = 2.45s short).
    const visibleMs = Math.max(500, Math.round(timings[b.key] ?? b.defMs));
    const durationMs = visibleMs + (hasCrossfade ? crossfadeMs : 0);
    // Each beat binds its header text to ITS props (eyebrow / headline / …);
    // composed here as a step of the runner, those keys would resolve against
    // the runner's schema and reject. The runner owns the composition, so the
    // beat's bindings are stripped at the seam (labels and geometry stay).
    const file = stripPropBindings(
      (await renderNestedTemplate(b.id, { pulse, renderMode } as never, ctx, { slot: { width: W, height: H, durationMs } })) as MosaicDocument,
    );
    steps.push({
      durationMs,
      file,
      ...(hasCrossfade ? { transitionToNext: { type: "fade" as const, durationMs: crossfadeMs } } : {}),
    });
  }

  return { kind: "mosaic_pipeline", version: 1, defaultTransition: { type: "cut" }, steps };
}

const propsSchema = definePropsSchema<RunnerProps>({
  pulse: { type: "group" as any, required: false, description: "Weekly Pulse data sheet — passed to every beat.", meta: { ui: { label: "Pulse data", order: 1, consumer: "agent" } } },
  timings: { type: "group" as any, required: false, description: "Per-beat durations in ms (title/kpiOverview/activityTrend/contributions/topContributors/changesBreakdown/notableCommits/fin).", meta: { ui: { label: "Beat timings", collapsedByDefault: true, consumer: "agent" } } },
  crossfadeMs: { type: "number", required: false, description: "Cross-fade duration between beats (ms). 0 = hard cut.", meta: { constraints: { min: 0, max: 2000 }, ui: { label: "Cross-fade" } } },
  renderMode: { type: "string", required: false, description: "Render weight for ALL beats. \"premium\" (default): alpha-fade reveals across the nested charts/cards — the softer look; the engine's enable-gating makes the per-pixel geq nearly free. \"light\": geq-free enable-gate pops — cheapest, most composable. Propagates to every beat.", meta: { constraints: { oneOf: ["light", "premium"] }, ui: { label: "Render mode", order: 5 } } },
  requireUpstream: { type: "boolean", required: false, description: "When true, render a visible error frame (instead of the built-in mock) if no upstream `weeklyPulse` block is present. Set this on data-connected pipelines (fetcher → adapter → runner) so a failed producer looks failed, not fake. Default false — standalone/preview renders use the mock.", meta: { ui: { label: "Require upstream data", order: 2 } } },
});

async function renderRunner(
  props: RunnerProps,
  ctx: MosaicEngineContext,
): Promise<MosaicDocument | MosaicDocumentPipeline> {
  const W = Math.max(1, Math.round(ctx.target.width));
  const H = Math.max(1, Math.round(ctx.target.height));
  // Data-connected pipelines set requireUpstream:true — a missing weeklyPulse
  // then means the upstream producer failed, so surface a visible error frame
  // instead of silently rendering the built-in mock.
  if (props.requireUpstream && !ctx.upstreamData?.weeklyPulse) {
    return makeErrorMosaic(
      "Weekly Pulse: upstream `weeklyPulse` is unavailable - the GitHub data producer failed or wasn't wired. (Preview on the mock with requireUpstream:false.)",
      { width: W, height: H, title: "Weekly Pulse", errorCode: "MISSING_UPSTREAM_WEEKLY_PULSE" },
    );
  }
  const pulse = resolvePulse(props.pulse, ctx);
  // "premium" (default): alpha-fade reveals across the nested charts/cards;
  // "light": geq-free enable-gate pops. Propagated to every beat.
  return buildPulsePipeline(
    pulse,
    { timings: props.timings, crossfadeMs: props.crossfadeMs, renderMode: props.renderMode },
    ctx,
  );
}

/** Are all eight beat templates registered? They import `node:path` and are
 *  EXCLUDED from the web build — when absent, the runner can't compose them, so
 *  `renderLite` shows a stand-in instead of throwing. */
function beatsRegistered(): boolean {
  return BEATS.every((b) => getTemplate(b.id) !== undefined);
}

/** The preview stand-in shown when the beat templates aren't registered (the
 *  web build). The real 8-beat composition needs the native render templates,
 *  which only exist in the desktop engine. */
export function runnerPreviewStub(ctx: MosaicEngineContext): MosaicDocument {
  const W = Math.max(1, Math.round(ctx.target.width));
  const H = Math.max(1, Math.round(ctx.target.height));
  return makeStubMosaic("Weekly Pulse - Runner", {
    width: W,
    height: H,
    note: "Sequences 8 cross-faded beats from native render templates - build the full pulse in Mosaic Desktop.",
  });
}

export const FfmpegPulseRunner: MosaicTemplate<RunnerProps> = {
  id: asTemplateId("@m0saic/hero/ffmpeg-pulse/runner/v1"),
  label: "Weekly Pulse · Runner",
  version: 1,
  description: "FFmpeg Weekly Pulse — the runner. Sequences all eight beats (title → kpi-overview → activity-trend → contributions → top-contributors → changes-breakdown → notable-commits → fin) into one cross-faded MosaicDocumentPipeline. Aspect-adaptive; per-beat durations as props.",
  capabilities: { tier: "core" },
  tags: ["data-viz", "hero", "ffmpeg-pulse", "runner", "pipeline", "animated", "developers", "marketers", "github", "changelog", "showcase"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1920, height: 1080, fps: 30, durationMs: 38000 },
  upstreamDataSchema: WEEKLY_PULSE_UPSTREAM_SCHEMA,
  propsSchema,

  defaultProps: {
    requireUpstream: false,
    pulse: MOCK_FFMPEG_PULSE,
    crossfadeMs: 350,
    renderMode: "premium",
  },

  async render(props: RunnerProps, ctx: MosaicEngineContext): Promise<MosaicDocument | MosaicDocumentPipeline> {
    return renderRunner(props, ctx);
  },

  // Preview / design hot path. The runner composes eight NESTED beat templates
  // (title, kpi-overview, …) — node-only, and EXCLUDED from the web build. When
  // they're registered (desktop) preview the real pulse; when they're not (web)
  // return a stand-in instead of throwing "template not registered".
  async renderLite(props: RunnerProps, ctx: MosaicEngineContext): Promise<MosaicDocument | MosaicDocumentPipeline> {
    if (!beatsRegistered()) return runnerPreviewStub(ctx);
    return renderRunner(props, ctx);
  },
};

registerTemplate(FfmpegPulseRunner);
