// covers: github/client — auth headers, Link pagination, call-budget ledger,
// 202 warm-up retry (injected sleep), committer-date window math, status
// tolerance (422/401), rate-limit tracking. Transport is fully stubbed.
import { GithubClient, parseLinkHeader, windowToSinceUntil } from "./client";
import type { GithubFetch, GithubFetchResponse } from "./client";

type Canned = { status?: number; body?: unknown; link?: string; rateLimit?: [number, number]; throwErr?: string };

function resp({ status = 200, body, link, rateLimit }: Canned): GithubFetchResponse {
  const headers: Record<string, string> = {};
  if (link) headers["link"] = link;
  if (rateLimit) { headers["x-ratelimit-limit"] = String(rateLimit[0]); headers["x-ratelimit-remaining"] = String(rateLimit[1]); }
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    async text() { return JSON.stringify(body); },
    async json() { if (body === undefined) throw new Error("no json body"); return body; },
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  };
}

/** Fetch stub: pops canned responses in order; records every (url, init). */
function makeFetch(queue: Canned[]) {
  const calls: { url: string; init?: { headers?: Record<string, string> } }[] = [];
  const fetchImpl: GithubFetch = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected extra fetch: ${url}`);
    if (next.throwErr) throw new Error(next.throwErr);
    return resp(next);
  };
  return { fetchImpl, calls };
}

describe("github/client", () => {
  describe("parseLinkHeader", () => {
    it("extracts rel targets", () => {
      const links = parseLinkHeader('<https://api/x?page=2>; rel="next", <https://api/x?page=9>; rel="last"');
      expect(links.next).toBe("https://api/x?page=2");
      expect(links.last).toBe("https://api/x?page=9");
      expect(links.prev).toBeUndefined();
    });
    it("empty on missing header", () => {
      expect(parseLinkHeader(null)).toEqual({});
    });
  });

  describe("windowToSinceUntil (Mon..Sun -> since/until, committer date)", () => {
    it("until is end + 1 day at 00:00Z", () => {
      expect(windowToSinceUntil({ startISO: "2026-07-06", endISO: "2026-07-12" })).toEqual({
        since: "2026-07-06T00:00:00Z",
        until: "2026-07-13T00:00:00Z",
      });
    });
  });

  describe("auth header assembly", () => {
    it("sends Bearer + Accept + UA + api-version WITH a token", async () => {
      const { fetchImpl, calls } = makeFetch([{ body: {} }]);
      await new GithubClient({ token: "ghp_secret", fetchImpl }).getRepo("o/r");
      const h = calls[0].init?.headers ?? {};
      expect(h.Authorization).toBe("Bearer ghp_secret");
      expect(h.Accept).toBe("application/vnd.github+json");
      expect(h["User-Agent"]).toBeTruthy();
      expect(h["X-GitHub-Api-Version"]).toBeTruthy();
      expect(calls[0].url).toBe("https://api.github.com/repos/o/r");
    });
    it("omits Authorization when anonymous", async () => {
      const { fetchImpl, calls } = makeFetch([{ body: {} }]);
      const c = new GithubClient({ fetchImpl });
      expect(c.authenticated).toBe(false);
      await c.getRepo("o/r");
      expect(calls[0].init?.headers?.Authorization).toBeUndefined();
    });
    it("honours a custom baseUrl (GHE), stripping trailing slash", async () => {
      const { fetchImpl, calls } = makeFetch([{ body: {} }]);
      await new GithubClient({ baseUrl: "https://ghe.example/api/v3/", fetchImpl }).getRepo("o/r");
      expect(calls[0].url).toBe("https://ghe.example/api/v3/repos/o/r");
    });
  });

  describe("pagination", () => {
    it("walks rel=next and concatenates", async () => {
      const { fetchImpl, calls } = makeFetch([
        { body: [1, 2], link: '<https://api.github.com/repos/o/r/commits?page=2>; rel="next"' },
        { body: [3] },
      ]);
      const out = await new GithubClient({ fetchImpl }).paginate<number>("/repos/o/r/commits?per_page=100");
      expect(out.items).toEqual([1, 2, 3]);
      expect(out.truncated).toBe(false);
      expect(out.budgetHit).toBe(false);
      expect(calls.length).toBe(2);
      expect(calls[1].url).toBe("https://api.github.com/repos/o/r/commits?page=2");
    });
    it("caps at maxItems and reports truncated", async () => {
      const { fetchImpl } = makeFetch([
        { body: [1, 2, 3], link: '<https://api.github.com/x?page=2>; rel="next"' },
      ]);
      const out = await new GithubClient({ fetchImpl }).paginate<number>("/x", { maxItems: 2 });
      expect(out.items).toEqual([1, 2]);
      expect(out.truncated).toBe(true);
    });
  });

  describe("call-budget ledger", () => {
    it("returns budgetHit WITHOUT calling fetch once exhausted", async () => {
      const { fetchImpl, calls } = makeFetch([{ body: {} }]);
      const c = new GithubClient({ fetchImpl, callBudget: 1 });
      const first = await c.request("/repos/o/r");
      expect(first.budgetHit).toBe(false);
      const second = await c.request("/repos/o/r2");
      expect(second.budgetHit).toBe(true);
      expect(second.status).toBe(0);
      expect(calls.length).toBe(1); // second never hit the wire
      expect(c.callsMade()).toBe(1);
    });
    it("pagination stops with budgetHit truncation", async () => {
      const { fetchImpl } = makeFetch([
        { body: [1], link: '<https://api.github.com/x?page=2>; rel="next"' },
      ]);
      const out = await new GithubClient({ fetchImpl, callBudget: 1 }).paginate<number>("/x");
      expect(out.items).toEqual([1]);
      expect(out.budgetHit).toBe(true);
      expect(out.truncated).toBe(true);
    });
  });

  describe("202 warm-up retry (stats/*)", () => {
    it("retries via injected sleep until 200", async () => {
      const waits: number[] = [];
      const { fetchImpl } = makeFetch([{ status: 202 }, { status: 202 }, { status: 200, body: [{ week: 1, days: [], total: 0 }] }]);
      const c = new GithubClient({ fetchImpl, sleep: async (ms) => { waits.push(ms); } });
      const r = await c.getCommitActivity("o/r");
      expect(r.status).toBe(200);
      expect(waits.length).toBe(2); // slept twice, then succeeded
    });
    it("gives up after the bounded retries, returning the last 202", async () => {
      const { fetchImpl, calls } = makeFetch([{ status: 202 }, { status: 202 }, { status: 202 }, { status: 202 }]);
      const c = new GithubClient({ fetchImpl, sleep: async () => {} });
      const r = await c.getCommitActivity("o/r");
      expect(r.status).toBe(202);
      expect(calls.length).toBe(4); // initial + 3 retries
    });
  });

  describe("status tolerance (never throws on HTTP status)", () => {
    it("code_frequency 422 is returned, not thrown", async () => {
      const { fetchImpl } = makeFetch([{ status: 422, body: { message: "too large" } }]);
      const r = await new GithubClient({ fetchImpl, sleep: async () => {} }).getCodeFrequency("o/r");
      expect(r.status).toBe(422);
      expect(r.ok).toBe(false);
    });
    it("stargazers 401 (anonymous star+json) is returned, not thrown", async () => {
      const { fetchImpl, calls } = makeFetch([{ status: 401, body: { message: "Requires authentication" } }]);
      const r = await new GithubClient({ fetchImpl }).getStargazersPage("o/r", 1);
      expect(r.status).toBe(401);
      expect(calls[0].init?.headers?.Accept).toBe("application/vnd.github.star+json");
    });
  });

  describe("rate-limit tracking + listCommits window url", () => {
    it("captures x-ratelimit headers", async () => {
      const { fetchImpl } = makeFetch([{ body: {}, rateLimit: [5000, 4998] }]);
      const c = new GithubClient({ fetchImpl });
      await c.getRepo("o/r");
      expect(c.rateLimit).toEqual({ limit: 5000, remaining: 4998 });
    });
    it("listCommits builds the committer-date windowed url", async () => {
      const { fetchImpl, calls } = makeFetch([{ body: [] }]);
      await new GithubClient({ fetchImpl }).listCommits("FFmpeg/FFmpeg", { startISO: "2026-07-06", endISO: "2026-07-12" });
      expect(calls[0].url).toBe(
        "https://api.github.com/repos/FFmpeg/FFmpeg/commits?since=2026-07-06T00:00:00Z&until=2026-07-13T00:00:00Z&per_page=100",
      );
    });
  });
});
