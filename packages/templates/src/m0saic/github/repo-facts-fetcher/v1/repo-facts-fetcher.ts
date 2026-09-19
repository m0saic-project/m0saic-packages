import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicTemplateUpstreamData,
  MosaicTemplateUpstreamVariables,
} from "@m0saic/types";
import { asAliasId, asTemplateId, mintConnectionSecretRef } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { defineMosaicTemplate, definePropsSchema, makeErrorMosaic, registerTemplate } from "@m0saic/template-utils";
import { GithubClient } from "../../client";
import { GITHUB_CONNECTION_ID, GITHUB_TOKEN_FIELD } from "../../connection";
import { buildRepoFacts } from "./build-facts";
import { SAMPLE_FACTS } from "./sample-facts";
import type { GithubRepoFacts } from "./facts";

/**
 * `@m0saic/github/repo-facts-fetcher/v1` — the capability-tier fetcher that
 * publishes `githubRepoFacts` (a {@link GithubRepoFacts} sheet) for the
 * `weekly-pulse-adapter` and other consumers. The FIRST real user of the F1
 * capability surface (host connections + secrets + upstream threading).
 *
 * Two modes, one output shape:
 *  - `replay` (DEFAULT) — publishes `props.facts` (the embedded {@link
 *    SAMPLE_FACTS} by default). NO network, byte-deterministic — this is what
 *    the e2e sweep and CI pipelines render.
 *  - `live` — fetches `repo` over `window` via the GitHub REST client, records
 *    coverage, and publishes the assembled facts. Nondeterministic, quarantined
 *    behind the client; never touched by CI.
 *
 * Doc shape mirrors `meta/fixture-fetcher`: a black lavfi CARRIER cell + the
 * aliased data source (skipped from layout) + a verbatim `sidecars` mirror. Wrap
 * in an `intermediate:true` pipeline step so the carrier never reaches output.
 *
 * Secret hygiene: the token is passed to the client (request headers) ONLY. It
 * never enters `variables`, `sidecars`, diagnostics, errors, or logs —
 * `coverage.authenticated` is the only signal that a token was used.
 */

export type RepoFactsFetcherProps = {
  /** `replay` (no network, publish `facts`) or `live` (fetch `repo`). */
  source?: "replay" | "live";
  /** Replay payload (also the test seam). Default: the embedded sample. */
  facts?: GithubRepoFacts;
  /** `owner/name` (live mode). */
  repo?: string;
  /** UTC Monday..Sunday inclusive (live mode). */
  window?: { startISO: string; endISO: string };
  /** Host connection id for non-secret values + the keychain token (live mode). */
  connectionId?: string;
  /** Explicit SecretRef escape hatch (e.g. `env:GITHUB_TOKEN`); wins over the connection. */
  tokenRef?: string;
  /** Per-commit detail: `auto` (full when authenticated, none anonymous), or force. */
  commitDetails?: "auto" | "full" | "none";
  /** Per-window commit cap; overflow → `coverage.truncated.commits`. */
  maxCommits?: number;
  /** Hard cap on API calls per render; overflow → truncate + record. */
  callBudget?: number;
};

type RepoFactsFetcherSidecars = { githubRepoFacts: GithubRepoFacts };

/** The fixed publish alias — part of the producer contract (Seam B). */
export const GITHUB_REPO_FACTS_ALIAS = "githubRepoFacts";

const propsSchema = definePropsSchema<RepoFactsFetcherProps>({
  source: {
    type: "string", required: false,
    description: 'replay = publish `facts` with no network (default); live = fetch `repo` over `window`.',
    meta: { constraints: { oneOf: ["replay", "live"] }, ui: { label: "Source", order: 1 } },
  },
  facts: {
    type: "json", required: false,
    description: "Replay payload — a GithubRepoFacts sheet. Defaults to the embedded sample.",
    meta: { ui: { label: "Facts (replay)", order: 2, consumer: "agent" } },
  },
  repo: {
    type: "string", required: false,
    description: 'Repository "owner/name" (live mode).',
    meta: { ui: { label: "Repository", order: 3 } },
  },
  window: {
    type: "json", required: false,
    description: "UTC { startISO, endISO } — Monday..Sunday inclusive (live mode).",
    meta: { ui: { label: "Window", order: 4, consumer: "agent" } },
  },
  connectionId: {
    type: "string", required: false,
    description: "Host connection id for the base URL + keychain token (live mode).",
    meta: { ui: { label: "Connection", order: 5 } },
  },
  tokenRef: {
    type: "string", required: false,
    description: "Explicit SecretRef (e.g. env:GITHUB_TOKEN). Wins over the connection token.",
    meta: { ui: { label: "Token ref", order: 6 } },
  },
  commitDetails: {
    type: "string", required: false,
    description: "auto (full when authenticated, none anonymous), full, or none.",
    meta: { constraints: { oneOf: ["auto", "full", "none"] }, ui: { label: "Commit details", order: 7 } },
  },
  maxCommits: {
    type: "number", required: false,
    description: "Per-window commit cap (overflow recorded in coverage.truncated).",
    meta: { constraints: { min: 1, max: 5000 }, ui: { label: "Max commits", order: 8 } },
  },
  callBudget: {
    type: "number", required: false,
    description: "Hard cap on API calls per render (overflow recorded in coverage.truncated).",
    meta: { constraints: { min: 1, max: 5000 }, ui: { label: "Call budget", order: 9 } },
  },
});

/**
 * Resolve the live-mode access: the connection's base URL (non-secret) and the
 * token. Token precedence: explicit `tokenRef` → connection keychain ref →
 * anonymous. Never throws on a missing/unresolvable token — degrades to
 * anonymous (coverage records it). Exported for unit testing with a fake ctx.
 */
export async function resolveGithubAccess(
  props: RepoFactsFetcherProps,
  ctx: MosaicEngineContext,
): Promise<{ token?: string; baseUrl?: string }> {
  const connId = props.connectionId && props.connectionId.length > 0 ? props.connectionId : String(GITHUB_CONNECTION_ID);

  let baseUrl: string | undefined;
  if (ctx.connections) {
    const vals = await ctx.connections.get(connId);
    if (vals && typeof vals.baseUrl === "string" && vals.baseUrl.length > 0) baseUrl = vals.baseUrl;
  }

  let token: string | undefined;
  // Escape hatch: an explicit tokenRef wins WHEN it resolves.
  if (props.tokenRef && props.tokenRef.length > 0 && ctx.secrets && (await ctx.secrets.has(props.tokenRef))) {
    token = await ctx.secrets.get(props.tokenRef);
  }
  // Fall through to the connection's keychain token (Seam A order:
  // tokenRef → connection → anonymous). So a set-but-unresolvable tokenRef —
  // e.g. `env:GITHUB_TOKEN` unset in the desktop app — still uses the token
  // configured under Settings → Integrations rather than dropping to anonymous.
  if (token === undefined && ctx.secrets && ctx.connections && (await ctx.connections.has(connId))) {
    const ref = mintConnectionSecretRef(connId, GITHUB_TOKEN_FIELD);
    if (await ctx.secrets.has(ref)) token = await ctx.secrets.get(ref);
  }

  return { token, baseUrl };
}

/** Wrap a facts sheet in the carrier + aliased-data + sidecar document. Pure —
 *  shared by both render modes and unit-tested directly. */
export function factsToDocument(facts: GithubRepoFacts): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String("1", "githubRepoFacts"),
    assets: {},
    sources: [
      // Degenerate carrier — a mosaic ref must point at something renderable;
      // intermediate:true keeps this black tile out of the deliverable.
      { type: "lavfi", color: "#000000" as MosaicColor },
      {
        type: "data",
        alias: asAliasId(GITHUB_REPO_FACTS_ALIAS),
        variables: facts as unknown as Record<string, unknown>,
        editor: { owner: "template" },
      },
    ],
    sidecars: { githubRepoFacts: facts },
  };
}

export const RepoFactsFetcher = defineMosaicTemplate<
  RepoFactsFetcherProps,
  GithubRepoFacts,
  MosaicTemplateUpstreamVariables,
  MosaicTemplateUpstreamData,
  RepoFactsFetcherSidecars
>({
  id: asTemplateId("@m0saic/github/repo-facts-fetcher/v1"),
  label: "GitHub Repo Facts (fetcher)",
  version: 1,
  description:
    "Capability-tier data fetcher: publishes a normalized GithubRepoFacts sheet (commits, contributors, activity, stars, coverage) under the alias githubRepoFacts. Replay mode (default) is network-free + deterministic; live mode fetches a repo/window over the GitHub REST API with a recorded coverage/degradation ladder. Feeds the weekly-pulse-adapter.",
  role: "data-fetcher",
  capabilities: { tier: "capability", caps: { net: { fetch: true } } },
  // A data carrier, not a picture: it publishes `githubRepoFacts` for a
  // pipeline step and renders only a 64×64 black tile. Out of the public
  // pickers (founder, 2026-09-14) — still reachable by id for pipelines and
  // nested renders.
  internal: true,
  tags: ["utility", "github", "connector", "data-fetcher"],

  outputHints: {

    format: { kind: "image", container: "png" },
    width: 64,
    height: 64,
    fps: 1,
    durationMs: 1000,
    note: "Publishes githubRepoFacts; renders only a degenerate black carrier tile. Wrap in a pipeline step with intermediate:true so the carrier never reaches the deliverable.",
  },

  outputsSchema: {
    schemaVersion: { type: "number", required: true },
    repo: { type: "object", required: true },
    window: { type: "object", required: true },
    commits: { type: "any", required: true },
    trailing8WeekCommitsLite: { type: "any", required: true },
    weeklyActivity: { type: "any", required: true },
    weeklyCodeFrequency: { type: "any", required: false },
    stars: { type: "object", required: false },
    pulls: { type: "object", required: false },
    issues: { type: "object", required: false },
    coverage: { type: "object", required: true },
    rateLimit: { type: "object", required: false },
  },

  propsSchema,
  defaultProps: {
    source: "replay",
    facts: SAMPLE_FACTS,
    repo: "FFmpeg/FFmpeg",
    window: SAMPLE_FACTS.window,
    connectionId: String(GITHUB_CONNECTION_ID),
    tokenRef: "",
    commitDetails: "auto",
    maxCommits: 500,
    callBudget: 300,
  },

  async render(props: RepoFactsFetcherProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const source = props.source ?? "replay";
    if (source !== "replay" && source !== "live") {
      throw new Error(`repo-facts-fetcher: source must be "replay" or "live", got ${JSON.stringify(source)}.`);
    }

    if (source === "replay") {
      const facts = (props.facts as GithubRepoFacts | undefined) ?? SAMPLE_FACTS;
      if (facts === null || typeof facts !== "object" || Array.isArray(facts)) {
        throw new Error("repo-facts-fetcher: replay `facts` must be a GithubRepoFacts object.");
      }
      return factsToDocument(facts);
    }

    // ── live ──────────────────────────────────────────────────────
    const repo = props.repo ?? "FFmpeg/FFmpeg";
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      throw new Error(`repo-facts-fetcher: repo must be "owner/name", got ${JSON.stringify(repo)}.`);
    }
    const window = props.window ?? SAMPLE_FACTS.window;
    if (!window || typeof window.startISO !== "string" || typeof window.endISO !== "string") {
      throw new Error("repo-facts-fetcher: window must be { startISO, endISO } (UTC YYYY-MM-DD).");
    }
    const commitDetails = props.commitDetails ?? "auto";
    if (commitDetails !== "auto" && commitDetails !== "full" && commitDetails !== "none") {
      throw new Error(`repo-facts-fetcher: commitDetails must be auto|full|none, got ${JSON.stringify(commitDetails)}.`);
    }
    const maxCommits = props.maxCommits ?? 500;
    const callBudget = props.callBudget ?? 300;

    // Runtime fetch failures (network, 404, keychain) degrade to a valid error
    // frame — the render survives and publishes no facts, so a downstream
    // consumer sees the gap and error-frames too. Malformed props above still
    // fail fast (an author/config error, not a runtime data problem).
    try {
      const { token, baseUrl } = await resolveGithubAccess(props, ctx);
      const client = new GithubClient({ baseUrl, token, callBudget });
      const facts = await buildRepoFacts(client, { repo, window, commitDetails, maxCommits });
      return factsToDocument(facts);
    } catch (e) {
      return makeErrorMosaic(
        `GitHub fetch failed for ${repo} (${window.startISO}..${window.endISO}): ${e instanceof Error ? e.message : String(e)}`,
        {
          width: Math.max(1, Math.round(ctx.target.width)),
          height: Math.max(1, Math.round(ctx.target.height)),
          title: "GitHub Repo Facts",
          errorCode: "GITHUB_FETCH_FAILED",
        },
      );
    }
  },
});

registerTemplate(RepoFactsFetcher);

export default RepoFactsFetcher;
