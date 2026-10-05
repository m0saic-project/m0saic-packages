import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/hero/ffmpeg-pulse/runner/v2 — Weekly Pulse · Runner (pipeline)
 * ============================================================================
 *
 * The 0.3.1 generation of the runner. It sequences the same eight beats through
 * v1's `buildPulsePipeline` (the ONE sequencer — the capability-tier
 * `@m0saic/github/weekly-pulse` shares it too), so the film is v1's, frame for
 * frame. What moved: the copy lives in `runner.catalog.json` beside this file,
 * and the cross-fade is declared as timing (it shows on no rect).
 *
 * The runner has no canvas handles of its own: every picture is a beat's, drawn
 * from the `pulse` sheet, and the beats' own bindings name THEIR props — the
 * sequencer strips them at the seam.
 * ============================================================================
 */

import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicTemplate,
} from "@m0saic/types";
import { definePropsSchema, getTemplate, makeErrorMosaic, registerTemplate } from "@m0saic/template-utils";
import { type WeeklyPulse, MOCK_FFMPEG_PULSE, resolvePulse, WEEKLY_PULSE_UPSTREAM_SCHEMA } from "../../_shared/pulse-data";
import { buildPulsePipeline, runnerPreviewStub } from "../v1/runner";

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

// The eight beats the sequencer composes (its order) — named here only to ask
// whether they are registered (they are node-only; the web build has none).
const BEAT_IDS = [
  "@m0saic/hero/ffmpeg-pulse/title/v1",
  "@m0saic/hero/ffmpeg-pulse/kpi-overview/v1",
  "@m0saic/hero/ffmpeg-pulse/activity-trend/v1",
  "@m0saic/hero/ffmpeg-pulse/contributions/v1",
  "@m0saic/hero/ffmpeg-pulse/top-contributors/v1",
  "@m0saic/hero/ffmpeg-pulse/changes-breakdown/v1",
  "@m0saic/hero/ffmpeg-pulse/notable-commits/v1",
  "@m0saic/hero/ffmpeg-pulse/fin/v1",
];

const propsSchema = definePropsSchema<RunnerProps>({
  pulse: { type: "group" as any, required: false, meta: { ui: { consumer: "agent" } } },
  timings: { type: "group" as any, required: false, meta: { ui: { consumer: "agent" } } },
  crossfadeMs: { type: "number", required: false, meta: { constraints: { min: 0, max: 2000 } } },
  renderMode: { type: "string", required: false, meta: { constraints: { oneOf: ["light", "premium"] } } },
  requireUpstream: { type: "boolean", required: false },
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
  return BEAT_IDS.every((id) => getTemplate(id) !== undefined);
}

export const FfmpegPulseRunnerV2: MosaicTemplate<RunnerProps> = {
  id: asTemplateId("@m0saic/hero/ffmpeg-pulse/runner/v2"),
  version: 2,
  capabilities: { tier: "core" },
  // posterTimeMs: inside the title beat (4s), after its reveal.
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1920, height: 1080, fps: 30, durationMs: 38000, posterTimeMs: 2500 },
  upstreamDataSchema: WEEKLY_PULSE_UPSTREAM_SCHEMA,
  propsSchema,
  bindings: { unbound: { crossfadeMs: "timing" } },

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

registerTemplate(FfmpegPulseRunnerV2);
