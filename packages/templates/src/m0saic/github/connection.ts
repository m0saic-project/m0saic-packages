/**
 * `github@default` — the host connection for the GitHub data connector (F5).
 *
 * Declares what the fetcher needs (a GitHub API base URL + an optional PAT) so
 * the host renders a form under Settings → Integrations, and a probe that
 * distinguishes reachable-vs-authenticated by hitting `/rate_limit` (which costs
 * no rate budget). Registration is a module-eval side effect — importing this
 * file (via the `github/` barrel, re-exported from the templates registry)
 * makes `github@default` appear in both the Electron app and the CLI.
 *
 * Secret handling: the token is a `secret`-kind field stored in the OS keychain;
 * the fetcher reads it back via `ctx.secrets.get(mintConnectionSecretRef(id,
 * "token"))`. Cleartext reaches the probe only (host process), never a document.
 */

import type {
  MosaicHostConnectionProbe,
  MosaicHostConnectionProbeOpts,
  MosaicHostConnectionProbeResult,
  MosaicHostConnectionRegistration,
  MosaicHostConnectionSchema,
} from "@m0saic/types";
import { asMosaicHostConnectionId } from "@m0saic/types";
import { registerHostConnection } from "@m0saic/template-utils";
import { GithubClient } from "./client";

/** Canonical connection id. `publisher` = `github`, `profile` = `default`. */
export const GITHUB_CONNECTION_ID = asMosaicHostConnectionId("github@default");
/** The `secret`-kind field key the fetcher mints a SecretRef for. */
export const GITHUB_TOKEN_FIELD = "token";

export const GITHUB_CONNECTION_SCHEMA: MosaicHostConnectionSchema = {
  id: GITHUB_CONNECTION_ID,
  version: 1,
  label: "GitHub",
  description:
    "Read-only access to a GitHub repository's public activity (commits, contributors, stars) for data templates like the Weekly Pulse.",
  publisher: "github",
  fields: [
    {
      kind: "url",
      key: "baseUrl",
      label: "API base URL",
      required: false,
      placeholder: "https://api.github.com",
      description:
        "GitHub or GitHub Enterprise REST API base. Must speak the GitHub REST API — NOT a Gitea/Forgejo forge (e.g. code.ffmpeg.org). Leave blank for github.com.",
    },
    {
      kind: "secret",
      key: GITHUB_TOKEN_FIELD,
      label: "Personal access token",
      required: false,
      storage: "keychain",
      description:
        "Optional fine-grained PAT with read-only Contents + Metadata scope. Without it, requests are anonymous (60 req/hr) and coverage degrades — no per-commit file stats, no star deltas.",
    },
  ],
};

/** Probe: `GET {baseUrl}/rate_limit`. `authenticated` iff a token was sent and
 *  accepted (a rejected token 401s; anonymous succeeds with the 60/hr bucket). */
export const githubConnectionProbe: MosaicHostConnectionProbe = {
  async probe(
    values: Readonly<Record<string, unknown>>,
    opts?: MosaicHostConnectionProbeOpts,
  ): Promise<MosaicHostConnectionProbeResult> {
    const baseUrl = typeof values.baseUrl === "string" ? values.baseUrl : undefined;
    const token = typeof values.token === "string" ? values.token : undefined;
    const tokenProvided = token !== undefined && token.length > 0;

    // Best-effort timeout when the host didn't pass its own signal.
    let signal = opts?.signal;
    const AS = (globalThis as { AbortSignal?: { timeout?: (ms: number) => AbortSignal } }).AbortSignal;
    if (!signal && typeof AS?.timeout === "function") {
      signal = AS.timeout(opts?.timeoutMs ?? 10_000);
    }

    const client = new GithubClient({ baseUrl, token, fetchImpl: opts?.fetchImpl, signal });

    let res;
    try {
      res = await client.getRateLimit();
    } catch (e) {
      return { ok: false, code: "UNREACHABLE", message: `Could not reach ${client.baseUrl}: ${e instanceof Error ? e.message : String(e)}` };
    }

    if (res.status === 401) {
      return { ok: false, code: "AUTH_FAILED", message: "The access token was rejected (HTTP 401)." };
    }
    if (res.status !== 200) {
      return { ok: false, code: "UNREACHABLE", message: `Unexpected response from ${client.baseUrl}/rate_limit (HTTP ${res.status}).` };
    }

    const core = res.body?.resources?.core;
    return {
      ok: true,
      reachable: true,
      authenticated: tokenProvided,
      ...(core ? { info: { limit: core.limit, remaining: core.remaining } } : {}),
    };
  },
};

export const GITHUB_CONNECTION_REGISTRATION: MosaicHostConnectionRegistration = {
  schema: GITHUB_CONNECTION_SCHEMA,
  probe: githubConnectionProbe,
};

registerHostConnection(GITHUB_CONNECTION_REGISTRATION);
