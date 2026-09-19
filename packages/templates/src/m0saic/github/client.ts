/**
 * GitHub REST client for the `repo-facts-fetcher` (F5).
 *
 * Low-level transport ONLY — auth-header assembly, Link-header pagination,
 * `202` warm-up retry for `stats/*`, a per-run call-budget ledger, and thin
 * typed wrappers for the endpoints in the F5 plan (Seam B). It returns
 * close-to-raw GitHub JSON; normalizing that into the bounded `GithubRepoFacts`
 * sheet (coverage record, degradation ladder, star-Δ walk) is the fetcher's job
 * (Phase 2), not this file's.
 *
 * `fetch` and `sleep` are INJECTABLE (constructor args, sane global defaults) so
 * unit tests stub transport + retry timing without module hacks or real waits.
 *
 * GitHub-API only. `baseUrl` targets `api.github.com` or a GitHub Enterprise
 * host that speaks the same REST API — NOT a Gitea/Forgejo forge (their `/api/v1`
 * shapes differ; e.g. FFmpeg's `code.ffmpeg.org` uses `stars_count`, not
 * `stargazers_count`). A forge connector is a separate, deferred publisher.
 */

import { addDaysISO } from "./week-math";

/** Minimal structural `fetch` — compatible with `globalThis.fetch` AND the
 *  host-connection probe's `fetchImpl` seam (which omits `headers`). */
export type GithubFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
  headers?: { get(name: string): string | null };
};
export type GithubFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<GithubFetchResponse>;

export type GithubClientOptions = {
  /** API base. Default `https://api.github.com`. Trailing slash tolerated. */
  baseUrl?: string;
  /** PAT. When set, sent as `Authorization: Bearer`. Absent → anonymous. */
  token?: string;
  /** Injectable transport. Default `globalThis.fetch`. */
  fetchImpl?: GithubFetch;
  /** Injectable delay for 202 retries. Default real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Hard cap on API calls this client makes. Default `Infinity`. */
  callBudget?: number;
  /** Sent as `User-Agent` (GitHub requires one). */
  userAgent?: string;
  /** Caller abort signal, forwarded to every request. */
  signal?: AbortSignal;
};

/** Parsed rel-targets from a `Link` header. */
export type GithubLinks = { next?: string; prev?: string; first?: string; last?: string };

/** One response the client hands back. `body` is parsed JSON (or `undefined`). */
export type GithubResponse<T = unknown> = {
  status: number;
  ok: boolean;
  body: T | undefined;
  links: GithubLinks;
  /** True when the call-budget was already spent — no request was made. */
  budgetHit: boolean;
};

const DEFAULT_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const JSON_ACCEPT = "application/vnd.github+json";
const STAR_ACCEPT = "application/vnd.github.star+json";

/** Parse a GitHub `Link` header into rel-targets. */
export function parseLinkHeader(header: string | null | undefined): GithubLinks {
  const links: GithubLinks = {};
  if (!header) return links;
  for (const part of header.split(",")) {
    const m = /<([^>]+)>;\s*rel="(next|prev|first|last)"/.exec(part.trim());
    if (m) links[m[2] as keyof GithubLinks] = m[1];
  }
  return links;
}

/** Committer-date window → GitHub `since`/`until` query params.
 *  `end` is inclusive Sunday, so `until` is `end + 1 day` at 00:00Z. */
export function windowToSinceUntil(window: { startISO: string; endISO: string }): {
  since: string;
  until: string;
} {
  return {
    since: `${window.startISO}T00:00:00Z`,
    until: `${addDaysISO(window.endISO, 1)}T00:00:00Z`,
  };
}

export class GithubClient {
  readonly baseUrl: string;
  readonly authenticated: boolean;
  private readonly token?: string;
  private readonly fetchImpl: GithubFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;
  private readonly signal?: AbortSignal;
  readonly callBudget: number;
  private calls = 0;
  /** Latest `x-ratelimit-{limit,remaining}` seen, if any. */
  rateLimit?: { limit: number; remaining: number };

  constructor(opts: GithubClientOptions = {}) {
    this.baseUrl = (opts.baseUrl?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
    this.token = opts.token && opts.token.length > 0 ? opts.token : undefined;
    this.authenticated = this.token !== undefined;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as GithubFetch);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.callBudget = opts.callBudget ?? Infinity;
    this.userAgent = opts.userAgent ?? "m0saic-github-connector";
    this.signal = opts.signal;
  }

  /** API calls made so far (for the fetcher's coverage/truncation record). */
  callsMade(): number {
    return this.calls;
  }

  private headers(accept: string): Record<string, string> {
    const h: Record<string, string> = {
      Accept: accept,
      "User-Agent": this.userAgent,
      "X-GitHub-Api-Version": API_VERSION,
    };
    // Secret hygiene: the token exists ONLY in this request header.
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  /** One raw request. Never throws on HTTP status; budget-exhaustion returns a
   *  `budgetHit` sentinel so the fetcher can record truncation instead of dying. */
  async request<T = unknown>(path: string, accept: string = JSON_ACCEPT): Promise<GithubResponse<T>> {
    if (this.calls >= this.callBudget) {
      return { status: 0, ok: false, body: undefined, links: {}, budgetHit: true };
    }
    this.calls++;
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    const res = await this.fetchImpl(url, { headers: this.headers(accept), signal: this.signal });

    const lim = res.headers?.get("x-ratelimit-limit");
    const rem = res.headers?.get("x-ratelimit-remaining");
    if (lim != null && rem != null) this.rateLimit = { limit: Number(lim), remaining: Number(rem) };

    let body: T | undefined;
    try {
      body = (await res.json()) as T;
    } catch {
      body = undefined;
    }
    return { status: res.status, ok: res.ok, body, links: parseLinkHeader(res.headers?.get("link")), budgetHit: false };
  }

  /** Walk `rel="next"` pages, concatenating arrays, until exhausted / capped /
   *  budget-hit. Stops on the first non-200 or non-array page. */
  async paginate<T = unknown>(
    path: string,
    opts: { accept?: string; maxItems?: number } = {},
  ): Promise<{ items: T[]; truncated: boolean; budgetHit: boolean }> {
    const accept = opts.accept ?? JSON_ACCEPT;
    const maxItems = opts.maxItems ?? Infinity;
    const items: T[] = [];
    let url: string | undefined = path;
    while (url) {
      const r: GithubResponse<T[]> = await this.request<T[]>(url, accept);
      if (r.budgetHit) return { items, truncated: true, budgetHit: true };
      if (r.status !== 200 || !Array.isArray(r.body)) break;
      items.push(...r.body);
      if (items.length >= maxItems) return { items: items.slice(0, maxItems), truncated: true, budgetHit: false };
      url = r.links.next;
    }
    return { items, truncated: false, budgetHit: false };
  }

  /** `stats/*` endpoints answer `202` while GitHub computes — bounded retry via
   *  the injected `sleep`. Returns the last response (may still be 202/422). */
  async getStats<T = unknown>(
    path: string,
    opts: { retries?: number; waitMs?: number } = {},
  ): Promise<GithubResponse<T>> {
    const retries = opts.retries ?? 3;
    const waitMs = opts.waitMs ?? 1500;
    let r: GithubResponse<T> = await this.request<T>(path);
    for (let i = 0; i < retries && r.status === 202 && !r.budgetHit; i++) {
      await this.sleep(waitMs);
      r = await this.request<T>(path);
    }
    return r;
  }

  // ── typed thin wrappers (Seam B endpoints) ──────────────────────────────

  getRepo(repo: string): Promise<GithubResponse<GithubRepoResponse>> {
    return this.request<GithubRepoResponse>(`/repos/${repo}`);
  }

  /** Window commits (the API filters `since`/`until` on COMMITTER date). */
  listCommits(
    repo: string,
    window: { startISO: string; endISO: string },
    opts: { maxItems?: number } = {},
  ): Promise<{ items: GithubCommitListItem[]; truncated: boolean; budgetHit: boolean }> {
    const { since, until } = windowToSinceUntil(window);
    return this.paginate<GithubCommitListItem>(
      `/repos/${repo}/commits?since=${since}&until=${until}&per_page=100`,
      { maxItems: opts.maxItems },
    );
  }

  getCommitDetail(repo: string, sha: string): Promise<GithubResponse<GithubCommitDetail>> {
    return this.request<GithubCommitDetail>(`/repos/${repo}/commits/${sha}`);
  }

  getCommitActivity(repo: string): Promise<GithubResponse<GithubCommitActivityWeek[]>> {
    return this.getStats<GithubCommitActivityWeek[]>(`/repos/${repo}/stats/commit_activity`);
  }

  getCodeFrequency(repo: string): Promise<GithubResponse<GithubCodeFrequencyWeek[]>> {
    return this.getStats<GithubCodeFrequencyWeek[]>(`/repos/${repo}/stats/code_frequency`);
  }

  /** One page of stargazers WITH `starred_at` (the `star+json` media type).
   *  Anonymous requests get `401` here — the fetcher degrades on that. */
  getStargazersPage(repo: string, page: number): Promise<GithubResponse<GithubStargazer[]>> {
    return this.request<GithubStargazer[]>(`/repos/${repo}/stargazers?per_page=100&page=${page}`, STAR_ACCEPT);
  }

  getRateLimit(): Promise<GithubResponse<GithubRateLimitResponse>> {
    return this.request<GithubRateLimitResponse>(`/rate_limit`);
  }
}

// ── raw GitHub response shapes (only the fields the connector reads) ────────

export type GithubRepoResponse = {
  full_name: string;
  name: string;
  default_branch: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
  open_issues_count: number;
  has_issues: boolean;
  pushed_at: string;
};

export type GithubGitUser = { name?: string; date?: string };
export type GithubAuthorRef = { login?: string; avatar_url?: string } | null;
export type GithubCommitListItem = {
  sha: string;
  commit: { message: string; author?: GithubGitUser; committer?: GithubGitUser };
  author?: GithubAuthorRef;
};
export type GithubCommitFile = { filename: string; additions: number; deletions: number; status: string };
export type GithubCommitDetail = GithubCommitListItem & {
  stats?: { additions: number; deletions: number; total: number };
  files?: GithubCommitFile[];
};

export type GithubCommitActivityWeek = { week: number; days: number[]; total: number };
/** `stats/code_frequency` rows are `[weekUnixSeconds, additions, deletions]`. */
export type GithubCodeFrequencyWeek = [number, number, number];
export type GithubStargazer = { starred_at: string; user?: { login?: string } };
export type GithubRateLimitResponse = { resources?: { core?: { limit: number; remaining: number } } };
