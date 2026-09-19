import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicTemplateUpstreamData,
  MosaicTemplateUpstreamVariables,
} from "@m0saic/types";
import { asAliasId, asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { defineMosaicTemplate, definePropsSchema, getUpstreamBlock, makeErrorMosaic, registerTemplate } from "@m0saic/template-utils";
import type { WeeklyPulse } from "../../../hero/ffmpeg-pulse/_shared/pulse-data";
import type { GithubRepoFacts } from "../../repo-facts-fetcher/v1/facts";
import { deriveWeeklyPulse } from "./derive-pulse";

/**
 * `@m0saic/github/weekly-pulse-adapter/v1` — the core-tier PURE adapter (F5
 * Seam C). Reads the upstream `githubRepoFacts` block (published by
 * `repo-facts-fetcher/v1`), derives the `WeeklyPulse` sheet the ffmpeg-pulse
 * beats consume, and re-publishes it under the alias `weeklyPulse` (+ sidecar).
 *
 * `role: "adapter"` (new in `@m0saic/types` this Feature). Zero network, zero
 * clock, zero randomness — a pure function of the facts + props. The
 * `githubRepoFacts` upstream block is REQUIRED: a missing producer surfaces as a
 * resolve-time `VARIABLES_SCHEMA_MISMATCH` (the required-key schema below) AND a
 * hard render error (no props fallback by design).
 */

export type WeeklyPulseAdapterProps = {
  /** Override the adaptive KPI selection (ordered keys). */
  kpiKeys?: string[];
  /** Notable-commit feed length (default 5). */
  notableCount?: number;
  /** Path segments defining a "changed area" (default 1). */
  areaDepth?: number;
  /** Top-N contributors (default 5). */
  topContributors?: number;
};

type WeeklyPulseAdapterSidecars = { weeklyPulse: WeeklyPulse };

/** The fixed publish alias — part of the adapter's producer contract. */
export const WEEKLY_PULSE_ALIAS = "weeklyPulse";
/** The upstream alias this adapter consumes. */
export const GITHUB_REPO_FACTS_UPSTREAM_ALIAS = "githubRepoFacts";

const propsSchema = definePropsSchema<WeeklyPulseAdapterProps>({
  kpiKeys: {
    type: "string[]", required: false,
    description: "Override the adaptive KPI selection with an explicit ordered key list.",
    meta: { ui: { label: "KPI keys", order: 1, consumer: "agent" } },
  },
  notableCount: {
    type: "number", required: false,
    description: "Number of notable commits in the feed.",
    meta: { constraints: { min: 1, max: 12 }, ui: { label: "Notable count", order: 2 } },
  },
  areaDepth: {
    type: "number", required: false,
    description: "Path segments that define a changed area (1 = top-level dir).",
    meta: { constraints: { min: 1, max: 4 }, ui: { label: "Area depth", order: 3 } },
  },
  topContributors: {
    type: "number", required: false,
    description: "Top-N contributors in the table.",
    meta: { constraints: { min: 1, max: 12 }, ui: { label: "Top contributors", order: 4 } },
  },
});

/** Wrap a derived pulse sheet in the carrier + aliased-data + sidecar document. */
export function pulseToDocument(pulse: WeeklyPulse): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String("1", "weeklyPulse"),
    assets: {},
    sources: [
      { type: "lavfi", color: "#000000" as MosaicColor },
      {
        type: "data",
        alias: asAliasId(WEEKLY_PULSE_ALIAS),
        variables: pulse as unknown as Record<string, unknown>,
        editor: { owner: "template" },
      },
    ],
    sidecars: { weeklyPulse: pulse },
  };
}

export const WeeklyPulseAdapter = defineMosaicTemplate<
  WeeklyPulseAdapterProps,
  WeeklyPulse,
  MosaicTemplateUpstreamVariables,
  MosaicTemplateUpstreamData,
  WeeklyPulseAdapterSidecars
>({
  id: asTemplateId("@m0saic/github/weekly-pulse-adapter/v1"),
  label: "Weekly Pulse Adapter",
  version: 1,
  description:
    "Pure core-tier adapter: reads the upstream githubRepoFacts block and derives the WeeklyPulse sheet (adaptive KPIs, activity + heatmap, contributors, changes-by-area, notable commits) for the ffmpeg-pulse beats. Zero network/clock/randomness; the githubRepoFacts producer is required.",
  role: "adapter",
  capabilities: { tier: "core" },
  // A data carrier between the fetcher and the beats, not a picture: with no
  // upstream githubRepoFacts block (the only way a picker can open it) its
  // render IS the error frame. Off the public shelf like the fetcher
  // (founder, 2026-09-16) — still reachable by id for pipelines.
  internal: true,
  tags: ["utility", "github", "connector", "adapter", "pulse", "developers"],

  outputHints: {

    format: { kind: "image", container: "png" },
    width: 64,
    height: 64,
    fps: 1,
    durationMs: 1000,
    note: "Publishes weeklyPulse; renders only a degenerate black carrier tile. Wrap in a pipeline step with intermediate:true.",
  },

  // REQUIRED upstream block — a present-but-drifted block errors at resolve time
  // (VARIABLES_SCHEMA_MISMATCH); an absent one errors too (required keys).
  upstreamDataSchema: {
    githubRepoFacts: {
      description: "Repo-facts sheet published by @m0saic/github/repo-facts-fetcher/v1.",
      variables: {
        schemaVersion: { type: "number", required: true },
        repo: { type: "object", required: true },
        window: { type: "object", required: true },
        commits: { type: "any", required: true },
        trailing8WeekCommitsLite: { type: "any", required: true },
        coverage: { type: "object", required: true },
      },
    },
  },

  outputsSchema: {
    repo: { type: "object", required: true },
    period: { type: "object", required: true },
    kpis: { type: "any", required: true },
    activity: { type: "object", required: true },
    contributors: { type: "object", required: true },
    changes: { type: "object", required: true },
    notable: { type: "object", required: true },
    fin: { type: "object", required: true },
  },

  propsSchema,
  defaultProps: {
    notableCount: 5,
    areaDepth: 1,
    topContributors: 5,
  },

  async render(props: WeeklyPulseAdapterProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const facts = getUpstreamBlock(ctx, GITHUB_REPO_FACTS_UPSTREAM_ALIAS) as GithubRepoFacts | undefined;
    if (!facts || typeof facts !== "object") {
      // Degrade, don't throw: return a valid error-frame document so the render
      // still completes. It publishes NO `weeklyPulse`, so a downstream beat /
      // runner sees the data is missing and can surface its own error frame. The
      // required `upstreamDataSchema` block below is the loud resolve-time signal
      // for a mis-wired pipeline; this is the graceful render-time fallback.
      return makeErrorMosaic(
        "Required upstream block `githubRepoFacts` is absent — wire @m0saic/github/repo-facts-fetcher/v1 as an earlier pipeline step.",
        {
          width: Math.max(1, Math.round(ctx.target.width)),
          height: Math.max(1, Math.round(ctx.target.height)),
          title: "Weekly Pulse Adapter",
          errorCode: "MISSING_UPSTREAM_GITHUB_REPO_FACTS",
        },
      );
    }
    const pulse = deriveWeeklyPulse(facts, {
      kpiKeys: props.kpiKeys,
      notableCount: props.notableCount,
      areaDepth: props.areaDepth,
      topContributors: props.topContributors,
    });
    return pulseToDocument(pulse);
  },
});

registerTemplate(WeeklyPulseAdapter);

export default WeeklyPulseAdapter;
