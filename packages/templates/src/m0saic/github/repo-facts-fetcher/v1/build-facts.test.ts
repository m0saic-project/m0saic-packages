// covers: repo-facts-fetcher build-facts — message/trailer parse (email strip),
// star-Δ back-pagination, pulls/issues gating, and the full buildRepoFacts
// coverage/degradation ladder (anon vs token, detail on/off, truncation, 422
// code_frequency, 401 stargazers, secret-never-in-output). Transport stubbed.
import { GithubClient } from "../../client";
import type { GithubFetch, GithubFetchResponse } from "../../client";
import { buildRepoFacts, computeStarDeltas, fetchPullsIssues, parseCommitMessage } from "./build-facts";

type RespArgs = { status?: number; body?: unknown; link?: string; rl?: [number, number] };
function ghResp({ status = 200, body, link, rl }: RespArgs): GithubFetchResponse {
  const headers: Record<string, string> = {};
  if (link) headers["link"] = link;
  if (rl) { headers["x-ratelimit-limit"] = String(rl[0]); headers["x-ratelimit-remaining"] = String(rl[1]); }
  return {
    ok: status >= 200 && status < 300, status, statusText: String(status),
    async text() { return JSON.stringify(body); },
    async json() { if (body === undefined) throw new Error("no body"); return body; },
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  };
}

type Route = { when: (url: string) => boolean } & RespArgs;
function router(routes: Route[]) {
  const calls: { url: string; auth?: string }[] = [];
  const fetchImpl: GithubFetch = async (url, init) => {
    calls.push({ url, auth: init?.headers?.Authorization });
    const r = routes.find((rt) => rt.when(url));
    return ghResp(r ?? { status: 404, body: { message: `no route ${url}` } });
  };
  return { fetchImpl, calls };
}
function clientFor(routes: Route[], opts: { token?: string; callBudget?: number } = {}) {
  const { fetchImpl, calls } = router(routes);
  return { client: new GithubClient({ fetchImpl, sleep: async () => {}, ...opts }), calls };
}

const WINDOW = { startISO: "2026-06-01", endISO: "2026-06-07" };
const REPO_BODY = (over: Record<string, unknown> = {}) => ({
  full_name: "o/r", name: "r", default_branch: "main", description: "d",
  stargazers_count: 100, forks_count: 5, subscribers_count: 3, open_issues_count: 7,
  has_issues: true, pushed_at: "2026-06-07T00:00:00Z", ...over,
});
const commit = (sha: string, committed: string, msg: string) => ({
  sha, commit: { message: msg, author: { name: "Ada", date: committed }, committer: { name: "Ada", date: committed } },
  author: { login: "ada", avatar_url: "https://a/ada.png" },
});

describe("parseCommitMessage", () => {
  it("extracts headline + trailers, stripping emails from trailer values", () => {
    const r = parseCommitMessage("core: fix a bug\n\nSigned-off-by: Ada Lovelace <ada@example.com>\nReviewed-by: Grace Hopper <grace@x.io>");
    expect(r.headline).toBe("core: fix a bug");
    expect(r.trailers).toEqual({ "Signed-off-by": ["Ada Lovelace"], "Reviewed-by": ["Grace Hopper"] });
    expect(JSON.stringify(r)).not.toMatch(/@/);
  });
  it("omits trailers when none present", () => {
    expect(parseCommitMessage("just a subject")).toEqual({ headline: "just a subject" });
  });
});

describe("computeStarDeltas", () => {
  const stargazerRoute = (page: number, entries: string[], last?: number): Route => ({
    // `&page=N` (not `page=N`) so it doesn't also match `per_page=100`.
    when: (u) => u.includes("/stargazers") && u.includes(`&page=${page}`),
    body: entries.map((starred_at) => ({ starred_at })),
    ...(last ? { link: `<https://api.github.com/repos/o/r/stargazers?per_page=100&page=${last}>; rel="last"` } : {}),
  });
  it("counts starred_at in the window and previous week across back-paginated pages", async () => {
    // page 1 = oldest (Link says last=2), page 2 = newest (has window + prev stars)
    const { client } = clientFor([
      stargazerRoute(1, ["2026-04-01T00:00:00Z"], 2),
      stargazerRoute(2, ["2026-05-27T12:00:00Z", "2026-06-02T09:00:00Z", "2026-06-05T09:00:00Z"]),
    ], { token: "t" });
    const d = await computeStarDeltas(client, "o/r", WINDOW);
    expect(d).toEqual({ deltaInWindow: 2, deltaPrevWindow: 1 }); // 06-02 & 06-05 in window; 05-27 in prev week
  });
  it("returns undefined on a 401 (anonymous star+json)", async () => {
    const { client } = clientFor([{ when: (u) => u.includes("/stargazers"), status: 401, body: { message: "Requires authentication" } }]);
    expect(await computeStarDeltas(client, "o/r", WINDOW)).toBeUndefined();
  });
});

describe("fetchPullsIssues", () => {
  it("returns both absent when the repo is a mirror (hasIssues false)", async () => {
    const { client, calls } = clientFor([], { token: "t" });
    const r = await fetchPullsIssues(client, "o/r", WINDOW, false);
    expect(r).toEqual({});
    expect(calls.length).toBe(0); // no search calls at all
  });
  it("returns both absent when anonymous", async () => {
    const { client } = clientFor([]);
    expect(await fetchPullsIssues(client, "o/r", WINDOW, true)).toEqual({});
  });
  it("fetches counts via search when authenticated + hasIssues", async () => {
    let n = 0;
    const totals = [12, 9, 7, 42, 6, 8]; // pOpen,pOpened,pMerged,iOpen,iOpened,iClosed (invoked in array order)
    const fetchImpl: GithubFetch = async () => ghResp({ body: { total_count: totals[n++] } });
    const client = new GithubClient({ fetchImpl, token: "t" });
    const r = await fetchPullsIssues(client, "o/r", WINDOW, true);
    expect(r.pulls).toEqual({ open: 12, openedInWindow: 9, mergedInWindow: 7 });
    expect(r.issues).toEqual({ open: 42, openedInWindow: 6, closedInWindow: 8 });
  });
});

describe("buildRepoFacts — coverage/degradation ladder", () => {
  const baseRoutes = (over: { repo?: Record<string, unknown>; codeFreq?: RespArgs } = {}): Route[] => [
    { when: (u) => /\/repos\/o\/r$/.test(u.split("?")[0]), body: REPO_BODY(over.repo) },
    { when: (u) => u.includes("/commits?") && u.includes("since=2026-06-01"), body: [commit("s1", "2026-06-02T09:00:00Z", "core: add x\n\nReviewed-by: Grace Hopper <g@x.io>"), commit("s2", "2026-06-05T09:00:00Z", "io: fix y")] },
    { when: (u) => u.includes("/commits?") && u.includes("since=2026-04-13"), body: [commit("s1", "2026-06-02T09:00:00Z", "core: add x"), commit("s2", "2026-06-05T09:00:00Z", "io: fix y"), commit("s0", "2026-05-20T09:00:00Z", "old")] },
    { when: (u) => /\/commits\/s1$/.test(u), body: { sha: "s1", commit: { message: "core: add x" }, stats: { additions: 10, deletions: 2, total: 12 }, files: [{ filename: "a.ts", additions: 10, deletions: 2, status: "modified" }] } },
    { when: (u) => /\/commits\/s2$/.test(u), body: { sha: "s2", commit: { message: "io: fix y" }, stats: { additions: 5, deletions: 1, total: 6 }, files: [{ filename: "b.ts", additions: 5, deletions: 1, status: "modified" }] } },
    { when: (u) => u.includes("/stats/commit_activity"), body: [{ week: 1748822400, days: [1, 2, 3, 4, 3, 2, 1], total: 16 }] },
    { when: (u) => u.includes("/stats/code_frequency"), ...(over.codeFreq ?? { body: [[1748822400, 500, -100]] }) },
    { when: (u) => u.includes("/stargazers"), body: [{ starred_at: "2026-06-03T00:00:00Z" }, { starred_at: "2026-06-04T00:00:00Z" }] },
    { when: (u) => u.includes("/search/issues"), body: { total_count: 3 } },
  ];

  it("token + auto → FULL coverage: per-commit detail, star deltas, pulls/issues", async () => {
    const { client } = clientFor(baseRoutes(), { token: "t" });
    const f = await buildRepoFacts(client, { repo: "o/r", window: WINDOW, commitDetails: "auto", maxCommits: 500 });
    expect(f.coverage).toMatchObject({ authenticated: true, commitDetails: "full", pulls: true, issues: true, starDeltas: true });
    expect(f.commits[0]).toMatchObject({ additions: 10, deletions: 2 });
    expect(f.commits[0].files?.[0].path).toBe("a.ts");
    expect(f.commits[0].trailers).toEqual({ "Reviewed-by": ["Grace Hopper"] });
    expect(f.stars).toEqual({ total: 100, deltaInWindow: 2, deltaPrevWindow: 0 });
    expect(f.pulls).toEqual({ open: 3, openedInWindow: 3, mergedInWindow: 3 });
    expect(f.weeklyCodeFrequency).toEqual([{ weekStartISO: expect.any(String), additions: 500, deletions: -100 }]);
    expect(f.trailing8WeekCommitsLite.length).toBe(3);
  });

  it("anonymous + auto → NONE detail, no star deltas, no pulls/issues", async () => {
    const { client, calls } = clientFor(baseRoutes(), {}); // no token
    const f = await buildRepoFacts(client, { repo: "o/r", window: WINDOW, commitDetails: "auto", maxCommits: 500 });
    expect(f.coverage).toMatchObject({ authenticated: false, commitDetails: "none", pulls: false, issues: false, starDeltas: false });
    expect(f.commits[0].additions).toBeUndefined();
    expect(f.commits[0].files).toBeUndefined();
    expect(f.stars).toEqual({ total: 100 });
    expect(calls.some((c) => c.url.includes("/commits/s1"))).toBe(false); // no detail calls
    expect(calls.some((c) => c.url.includes("/stargazers"))).toBe(false); // no star walk anon
  });

  it("commitDetails:none overrides even when authenticated", async () => {
    const { client } = clientFor(baseRoutes(), { token: "t" });
    const f = await buildRepoFacts(client, { repo: "o/r", window: WINDOW, commitDetails: "none", maxCommits: 500 });
    expect(f.coverage.commitDetails).toBe("none");
    expect(f.commits[0].additions).toBeUndefined();
  });

  it("mirror repo (hasIssues false) records pulls/issues coverage false", async () => {
    const { client } = clientFor(baseRoutes({ repo: { has_issues: false } }), { token: "t" });
    const f = await buildRepoFacts(client, { repo: "o/r", window: WINDOW, commitDetails: "auto", maxCommits: 500 });
    expect(f.coverage.pulls).toBe(false);
    expect(f.coverage.issues).toBe(false);
    expect(f.pulls).toBeUndefined();
  });

  it("code_frequency 422 → weeklyCodeFrequency absent (adapter tolerates)", async () => {
    const { client } = clientFor(baseRoutes({ codeFreq: { status: 422, body: { message: "too large" } } }), { token: "t" });
    const f = await buildRepoFacts(client, { repo: "o/r", window: WINDOW, commitDetails: "auto", maxCommits: 500 });
    expect(f.weeklyCodeFrequency).toBeUndefined();
  });

  it("maxCommits cap records coverage.truncated.commits", async () => {
    const { client } = clientFor(baseRoutes(), { token: "t" });
    const f = await buildRepoFacts(client, { repo: "o/r", window: WINDOW, commitDetails: "none", maxCommits: 1 });
    expect(f.commits.length).toBe(1);
    expect(f.coverage.truncated?.commits).toBe(1);
  });

  it("call-budget exhaustion during detail → partial + callBudgetHit", async () => {
    // budget 3: repo(1) + window commits(1) + s1 detail(1) = 3; s2 detail hits budget
    const { client } = clientFor(baseRoutes(), { token: "t", callBudget: 3 });
    const f = await buildRepoFacts(client, { repo: "o/r", window: WINDOW, commitDetails: "full", maxCommits: 500 });
    expect(f.coverage.commitDetails).toBe("partial");
    expect(f.coverage.truncated?.callBudgetHit).toBe(true);
  });

  it("NEVER leaks the token into the published facts (but DOES send it as a Bearer header)", async () => {
    const { client, calls } = clientFor(baseRoutes(), { token: "SECRET_TOKEN_XYZ" });
    const f = await buildRepoFacts(client, { repo: "o/r", window: WINDOW, commitDetails: "auto", maxCommits: 500 });
    expect(JSON.stringify(f)).not.toContain("SECRET_TOKEN_XYZ");
    expect(calls.every((c) => c.auth === "Bearer SECRET_TOKEN_XYZ")).toBe(true);
  });

  it("throws a clear error when the repo fetch fails", async () => {
    const { client } = clientFor([{ when: (u) => u.includes("/repos/"), status: 404, body: { message: "Not Found" } }], { token: "t" });
    await expect(buildRepoFacts(client, { repo: "o/r", window: WINDOW, commitDetails: "auto", maxCommits: 500 })).rejects.toThrow(/could not fetch repo/);
  });
});
