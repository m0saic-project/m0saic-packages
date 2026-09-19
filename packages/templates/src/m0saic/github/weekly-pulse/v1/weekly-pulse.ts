import type {
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicTemplate,
  MosaicTextLayer,
  MosaicTextSource,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { definePropsSchema, makeErrorMosaic, registerTemplate } from "@m0saic/template-utils";
import { GithubClient } from "../../client";
import { lastFullWeek } from "../../week-math";
import { buildRepoFacts } from "../../repo-facts-fetcher/v1/build-facts";
import { resolveGithubAccess } from "../../repo-facts-fetcher/v1/repo-facts-fetcher";
import { SAMPLE_FACTS } from "../../repo-facts-fetcher/v1/sample-facts";
import type { GithubRepoFacts } from "../../repo-facts-fetcher/v1/facts";
import { deriveWeeklyPulse } from "../../weekly-pulse-adapter/v1/derive-pulse";
import { buildPulsePipeline } from "../../../hero/ffmpeg-pulse/runner/v1/runner";
import { GITHUB_CONNECTION_ID } from "../../connection";

/**
 * `@m0saic/github/weekly-pulse/v1` — the ONE self-contained, app-runnable Weekly
 * Pulse. Capability-tier: it fetches a repo's week itself from prop input (repo +
 * window + token), derives the WeeklyPulse sheet, and renders all 8 beats — no
 * `.mosaicx` pipeline, no upstream wiring. The app counterpart to the fetcher →
 * adapter → runner chain the Jobs cron uses.
 *
 * NETWORK DISCIPLINE (renderLite): editor previews / prop changes call
 * `renderLite`, which does NOT fetch — it shows a friendly "ready" card so
 * tweaking props never hammers the API. The live fetch happens only on an
 * explicit Make (`render`). Power users can set `livePreview:true` to fetch on
 * every preview and geometrically inspect the real data — an intentional opt-in.
 *
 * WINDOW: live mode defaults to the last COMPLETE Mon..Sun week (UTC, computed
 * at render time — this capability template is inherently non-deterministic, so
 * it reads the clock; core templates never do). Set `window` to pin a week. The
 * fully deterministic path is the cron `.mosaicx` (`{{lastFullWeek*}}` tokens).
 */

export type GithubWeeklyPulseProps = {
  /** `replay` (embedded sample, no network — default) or `live` (fetch `repo`). */
  source?: "replay" | "live";
  /** Replay payload. Default: the embedded sample. */
  facts?: GithubRepoFacts;
  /** `owner/name` (live). */
  repo?: string;
  /** UTC Monday..Sunday inclusive (live). Omit → the last complete week. */
  window?: { startISO: string; endISO: string };
  /** Connection id for the base URL + keychain token (live). */
  connectionId?: string;
  /** Explicit SecretRef escape hatch (e.g. `env:GITHUB_TOKEN`); falls through to the connection when unresolvable. */
  tokenRef?: string;
  commitDetails?: "auto" | "full" | "none";
  maxCommits?: number;
  callBudget?: number;
  /** Power-user opt-in: fetch + render real data on EVERY editor preview (not just Make). Off by default. */
  livePreview?: boolean;
  // adapter (pulse-shaping) knobs
  kpiKeys?: string[];
  notableCount?: number;
  areaDepth?: number;
  topContributors?: number;
  // runner (sequencing) knobs
  timings?: Record<string, number>;
  crossfadeMs?: number;
  renderMode?: "premium" | "light";
};

const propsSchema = definePropsSchema<GithubWeeklyPulseProps>({
  source: { type: "string", required: false, description: "replay = embedded sample, no network (default); live = fetch `repo` over `window`.", meta: { constraints: { oneOf: ["replay", "live"] }, ui: { label: "Source", order: 1 } } },
  facts: { type: "json", required: false, description: "Replay payload (a GithubRepoFacts sheet). Defaults to the embedded sample.", meta: { ui: { label: "Facts (replay)", order: 2, consumer: "agent" } } },
  repo: { type: "string", required: false, description: 'Repository "owner/name" (live).', meta: { ui: { label: "Repository", order: 3 } } },
  window: { type: "json", required: false, description: "UTC { startISO, endISO } — Monday..Sunday. Omit → the last complete week (live).", meta: { ui: { label: "Window", order: 4, consumer: "agent" } } },
  connectionId: { type: "string", required: false, description: "Host connection id for the base URL + keychain token (live).", meta: { ui: { label: "Connection", order: 5 } } },
  tokenRef: { type: "string", required: false, description: "Explicit SecretRef (e.g. env:GITHUB_TOKEN). Falls through to the connection token when unresolvable.", meta: { ui: { label: "Token ref", order: 6 } } },
  commitDetails: { type: "string", required: false, description: "auto (full when authenticated, none anonymous), full, or none.", meta: { constraints: { oneOf: ["auto", "full", "none"] }, ui: { label: "Commit details", order: 7 } } },
  maxCommits: { type: "number", required: false, description: "Per-window commit cap.", meta: { constraints: { min: 1, max: 5000 }, ui: { label: "Max commits", order: 8 } } },
  callBudget: { type: "number", required: false, description: "Hard cap on API calls per render.", meta: { constraints: { min: 1, max: 5000 }, ui: { label: "Call budget", order: 9 } } },
  livePreview: { type: "boolean", required: false, description: "Fetch + render real data on every editor preview (not just Make). Off by default so prop changes don't hammer the API.", meta: { ui: { label: "Live preview (fetch on preview)", order: 10 } } },
  kpiKeys: { type: "string[]", required: false, description: "Override the adaptive KPI selection (ordered keys).", meta: { ui: { label: "KPI keys", order: 11, consumer: "agent" } } },
  notableCount: { type: "number", required: false, description: "Notable-commit feed length.", meta: { constraints: { min: 1, max: 12 }, ui: { label: "Notable count", order: 12 } } },
  areaDepth: { type: "number", required: false, description: "Path segments defining a changed area.", meta: { constraints: { min: 1, max: 4 }, ui: { label: "Area depth", order: 13 } } },
  topContributors: { type: "number", required: false, description: "Top-N contributors.", meta: { constraints: { min: 1, max: 12 }, ui: { label: "Top contributors", order: 14 } } },
  timings: { type: "group" as never, required: false, description: "Per-beat durations in ms.", meta: { ui: { label: "Beat timings", collapsedByDefault: true, consumer: "agent" } } },
  crossfadeMs: { type: "number", required: false, description: "Cross-fade between beats (ms). 0 = hard cut.", meta: { constraints: { min: 0, max: 2000 }, ui: { label: "Cross-fade" } } },
  renderMode: { type: "string", required: false, description: '"premium" (default) alpha-fade reveals; "light" geq-free pops.', meta: { constraints: { oneOf: ["light", "premium"] }, ui: { label: "Render mode" } } },
});

/** Live window: the explicit prop, else the last complete Mon..Sun week (UTC).
 *  Capability-tier + inherently non-deterministic, so it reads the clock here. */
function effectiveWindow(props: GithubWeeklyPulseProps): { startISO: string; endISO: string } {
  return props.window ?? lastFullWeek(new Date().toISOString().slice(0, 10));
}

/** The full fetch/replay → derive → render, shared by `render` (Make) and
 *  `renderLite` when the user opted into a live preview. */
async function renderPulse(props: GithubWeeklyPulseProps, ctx: MosaicEngineContext): Promise<MosaicDocument | MosaicDocumentPipeline> {
  const source = props.source ?? "replay";
  if (source !== "replay" && source !== "live") {
    throw new Error(`github/weekly-pulse: source must be "replay" or "live", got ${JSON.stringify(source)}.`);
  }

  let facts: GithubRepoFacts;
  if (source === "replay") {
    const f = (props.facts as GithubRepoFacts | undefined) ?? SAMPLE_FACTS;
    if (f === null || typeof f !== "object" || Array.isArray(f)) {
      throw new Error("github/weekly-pulse: replay `facts` must be a GithubRepoFacts object.");
    }
    facts = f;
  } else {
    const repo = props.repo ?? "FFmpeg/FFmpeg";
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      throw new Error(`github/weekly-pulse: repo must be "owner/name", got ${JSON.stringify(repo)}.`);
    }
    const window = effectiveWindow(props);
    const commitDetails = props.commitDetails ?? "auto";
    const maxCommits = props.maxCommits ?? 500;
    const callBudget = props.callBudget ?? 300;
    try {
      const { token, baseUrl } = await resolveGithubAccess({ tokenRef: props.tokenRef, connectionId: props.connectionId }, ctx);
      const client = new GithubClient({ baseUrl, token, callBudget });
      facts = await buildRepoFacts(client, { repo, window, commitDetails, maxCommits });
    } catch (e) {
      return makeErrorMosaic(
        `GitHub Weekly Pulse: fetch failed for ${repo} (${window.startISO}..${window.endISO}): ${e instanceof Error ? e.message : String(e)}`,
        { width: Math.max(1, Math.round(ctx.target.width)), height: Math.max(1, Math.round(ctx.target.height)), title: "GitHub Weekly Pulse", errorCode: "GITHUB_FETCH_FAILED", backgroundColor: "#000000" as MosaicColor },
      );
    }
  }

  const pulse = deriveWeeklyPulse(facts, {
    kpiKeys: props.kpiKeys,
    notableCount: props.notableCount,
    areaDepth: props.areaDepth,
    topContributors: props.topContributors,
  });
  return buildPulsePipeline(pulse, { timings: props.timings, crossfadeMs: props.crossfadeMs, renderMode: props.renderMode }, ctx);
}

/** The network-free "ready" card shown on editor previews (renderLite). Themed,
 *  friendly, and honest about what a Make will do — NO fetch, NO side effects. */
function readyCard(props: GithubWeeklyPulseProps, ctx: MosaicEngineContext): MosaicDocument {
  const W = Math.max(1, Math.round(ctx.target.width));
  const source = props.source ?? "replay";
  const repo = props.repo ?? "FFmpeg/FFmpeg";
  const ew = effectiveWindow(props);
  const win = props.window ? `${ew.startISO} - ${ew.endISO}` : `${ew.startISO} - ${ew.endISO} (auto)`;
  const body =
    source === "live"
      ? [`Live - fetches ${repo} on render`, `Window: ${win}`, "Press Render to build the full pulse.", "Set livePreview to fetch + preview real data here."]
      : ["Replay - the embedded sample", "Press Render to build the full pulse.", "Switch source to 'live' + set a repo to fetch real data."];

  const titleFont = Math.max(18, Math.min(52, Math.round(W / 20)));
  const bodyFont = Math.max(12, Math.min(24, Math.round(W / 44)));
  const layers: MosaicTextLayer[] = [
    { content: { kind: "literal", text: "GITHUB WEEKLY PULSE" }, style: { fontSize: titleFont, fontColor: "#2ea043" } as never, placement: { hAlign: "left", vAlign: "top", xExpr: "w*0.07", yExpr: "h*0.16" } as never },
    { content: { kind: "literal", text: "ready" }, style: { fontSize: bodyFont, fontColor: "#8b949e" } as never, placement: { hAlign: "left", vAlign: "top", xExpr: "w*0.07", yExpr: "h*0.30" } as never },
    ...body.map((text, i) => ({
      content: { kind: "literal" as const, text },
      style: { fontSize: bodyFont, fontColor: "#c9d1d9" } as never,
      placement: { hAlign: "left", vAlign: "top", xExpr: "w*0.07", yExpr: `h*${(0.44 + i * 0.11).toFixed(2)}` } as never,
    })),
  ];

  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String("F", "weeklyPulseReady"),
    assets: {},
    sources: [{ type: "text", visual: { backgroundColor: "#0d1117" as MosaicColor }, layers } as MosaicTextSource],
  };
}

// Plain-object template (like the pulse runner): it returns a duration-follows-
// timings pipeline, so it opts out of defineMosaicTemplate's fixed-duration
// timing assertion. Capability-tier — the host threads secrets/connections onto
// ctx, which renderPulse passes straight to resolveGithubAccess.
export const GithubWeeklyPulse: MosaicTemplate<GithubWeeklyPulseProps> = {
  id: asTemplateId("@m0saic/github/weekly-pulse/v1"),
  label: "GitHub Weekly Pulse",
  version: 1,
  description:
    "Self-contained, app-runnable Weekly Pulse: fetches a GitHub repo's week from prop input (repo + window + token), derives the pulse sheet, and renders all 8 beats — one capability-tier template, no pipeline wiring. Replay mode (default) is network-free; live mode fetches over the GitHub REST API and degrades to an error frame on failure. Editor previews use a network-free renderLite card.",
  capabilities: { tier: "capability", caps: { net: { fetch: true } } },
  tags: ["data-viz", "github", "ffmpeg-pulse", "pulse", "live", "animated", "developers", "analysts", "weekly", "report"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1920, height: 1080, fps: 30, durationMs: 38000, note: "The full 8-beat weekly pulse. Live mode fetches GitHub; replay uses the embedded sample; previews show a renderLite card." },
  propsSchema,
  defaultProps: {
    source: "replay",
    facts: SAMPLE_FACTS,
    repo: "FFmpeg/FFmpeg",
    connectionId: String(GITHUB_CONNECTION_ID),
    tokenRef: "",
    commitDetails: "auto",
    maxCommits: 500,
    callBudget: 300,
    livePreview: false,
    notableCount: 5,
    areaDepth: 1,
    topContributors: 5,
    crossfadeMs: 350,
    renderMode: "premium",
  },

  async render(props: GithubWeeklyPulseProps, ctx: MosaicEngineContext): Promise<MosaicDocument | MosaicDocumentPipeline> {
    return renderPulse(props, ctx);
  },

  /** Preview / design hot path — NO network unless the user opted into livePreview. */
  async renderLite(props: GithubWeeklyPulseProps, ctx: MosaicEngineContext): Promise<MosaicDocument | MosaicDocumentPipeline> {
    if (props.livePreview) return renderPulse(props, ctx); // power-user opt-in: fetch + preview real data
    return readyCard(props, ctx);
  },
};

registerTemplate(GithubWeeklyPulse);

export default GithubWeeklyPulse;
