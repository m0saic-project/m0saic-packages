/**
 * Live assembly: turn GitHub REST responses (via the injectable {@link
 * GithubClient}) into a bounded {@link GithubRepoFacts} sheet.
 *
 * All nondeterminism lives here and is quarantined behind the client — the
 * template's replay path never calls this, and every unit test drives it with a
 * stubbed-fetch client. Coverage is RECORDED, never assumed: an anonymous fetch,
 * a mirror repo, a 422 on `code_frequency`, or a spent call-budget each drop
 * fields and say so in `coverage`.
 *
 * The token is used ONLY inside the client's request headers — it never reaches
 * the facts sheet (verified by test).
 */

import type { GithubClient } from "../../client";
import { addDaysISO, civilFromDays, formatISODate } from "../../week-math";
import type {
  GithubCommitFacts,
  GithubCommitLite,
  GithubCoverage,
  GithubIssueFacts,
  GithubPullFacts,
  GithubRepoFacts,
  GithubStarFacts,
} from "./facts";

export type BuildFactsOptions = {
  repo: string;
  window: { startISO: string; endISO: string };
  commitDetails: "auto" | "full" | "none";
  maxCommits: number;
  filesPerCommit?: number;
};

/** UNIX seconds → `"YYYY-MM-DD"` (Date-free, via the civil day-count). */
function unixToISODate(sec: number): string {
  return formatISODate(civilFromDays(Math.floor(sec / 86_400)));
}

/** Split a commit message into its headline + trailers, stripping emails from
 *  trailer values (keeps `Reviewed-by: Name`, drops `<name@host>`). */
export function parseCommitMessage(message: string): { headline: string; trailers?: Record<string, string[]> } {
  const lines = (message || "").split("\n");
  const headline = lines[0] || "";
  const trailers: Record<string, string[]> = {};
  const re = /^([A-Za-z][A-Za-z-]+):\s*(.+)$/;
  for (const line of lines.slice(1)) {
    const m = re.exec(line.trim());
    if (!m || !/-by$/i.test(m[1])) continue; // Reviewed-by, Signed-off-by, Co-authored-by, Tested-by, …
    const value = m[2].replace(/\s*<[^>]*>/g, "").trim();
    if (value) (trailers[m[1]] ||= []).push(value);
  }
  return Object.keys(trailers).length ? { headline, trailers } : { headline };
}

/** Count stargazers whose `starred_at` falls in the window / previous week, by
 *  back-paginating from the newest page. ISO timestamps sort lexicographically,
 *  so no `Date` is needed. Returns `undefined` (→ coverage.starDeltas=false) on
 *  any 401 / budget-hit — anonymous star+json is 401, and partial counts lie. */
export async function computeStarDeltas(
  client: GithubClient,
  repo: string,
  window: { startISO: string; endISO: string },
): Promise<{ deltaInWindow: number; deltaPrevWindow: number } | undefined> {
  const first = await client.getStargazersPage(repo, 1);
  if (first.budgetHit || first.status !== 200 || !Array.isArray(first.body)) return undefined;
  const lastMatch = first.links.last ? /[?&]page=(\d+)/.exec(first.links.last) : null;
  const lastPage = lastMatch ? Number(lastMatch[1]) : 1;

  const winStart = `${window.startISO}T00:00:00Z`;
  const winEnd = `${addDaysISO(window.endISO, 1)}T00:00:00Z`;
  const prevStart = `${addDaysISO(window.startISO, -7)}T00:00:00Z`;

  let inWindow = 0;
  let inPrev = 0;
  for (let page = lastPage; page >= 1; page--) {
    const r = page === 1 ? first : await client.getStargazersPage(repo, page);
    if (r.budgetHit || r.status !== 200 || !Array.isArray(r.body) || r.body.length === 0) {
      if (r.budgetHit) return undefined;
      break;
    }
    for (const s of r.body) {
      const at = s.starred_at;
      if (at >= winStart && at < winEnd) inWindow++;
      else if (at >= prevStart && at < winStart) inPrev++;
    }
    // Ascending order: if this page's newest entry predates prevStart, all
    // older pages are irrelevant.
    if (r.body[r.body.length - 1].starred_at < prevStart) break;
  }
  return { deltaInWindow: inWindow, deltaPrevWindow: inPrev };
}

/** PR / issue windowed counts via the search API. Gated on `authenticated &&
 *  hasIssues` — a mirror (hasIssues:false, e.g. FFmpeg) records both absent, so
 *  the adapter drops PR/issue KPIs. Any failed count degrades that group to
 *  absent rather than publishing a partial one. */
export async function fetchPullsIssues(
  client: GithubClient,
  repo: string,
  window: { startISO: string; endISO: string },
  hasIssues: boolean,
): Promise<{ pulls?: GithubPullFacts; issues?: GithubIssueFacts }> {
  if (!client.authenticated || !hasIssues) return {};
  const range = `${window.startISO}..${window.endISO}`;
  const count = async (q: string): Promise<number | undefined> => {
    const r = await client.request<{ total_count?: number }>(`/search/issues?q=${encodeURIComponent(q)}&per_page=1`);
    return r.status === 200 && typeof r.body?.total_count === "number" ? r.body.total_count : undefined;
  };
  const [pOpen, pOpened, pMerged, iOpen, iOpened, iClosed] = await Promise.all([
    count(`repo:${repo} is:pr is:open`),
    count(`repo:${repo} is:pr created:${range}`),
    count(`repo:${repo} is:pr is:merged merged:${range}`),
    count(`repo:${repo} is:issue is:open`),
    count(`repo:${repo} is:issue created:${range}`),
    count(`repo:${repo} is:issue closed:${range}`),
  ]);
  const pulls = pOpen !== undefined && pOpened !== undefined && pMerged !== undefined
    ? { open: pOpen, openedInWindow: pOpened, mergedInWindow: pMerged }
    : undefined;
  const issues = iOpen !== undefined && iOpened !== undefined && iClosed !== undefined
    ? { open: iOpen, openedInWindow: iOpened, closedInWindow: iClosed }
    : undefined;
  return { pulls, issues };
}

export async function buildRepoFacts(client: GithubClient, opts: BuildFactsOptions): Promise<GithubRepoFacts> {
  const { repo, window } = opts;
  const filesPerCommit = opts.filesPerCommit ?? 40;
  const truncated: NonNullable<GithubCoverage["truncated"]> = {};

  // 1. repo scalars (operational error if this fails — nothing to publish).
  const repoRes = await client.getRepo(repo);
  if (repoRes.status !== 200 || !repoRes.body) {
    throw new Error(`repo-facts-fetcher: could not fetch repo ${JSON.stringify(repo)} (HTTP ${repoRes.status}).`);
  }
  const R = repoRes.body;
  const repoFacts = {
    fullName: R.full_name,
    name: R.name,
    defaultBranch: R.default_branch,
    ...(R.description ? { description: R.description } : {}),
    stars: R.stargazers_count,
    forks: R.forks_count,
    watchers: R.subscribers_count,
    openIssues: R.open_issues_count,
    hasIssues: R.has_issues,
    pushedAt: R.pushed_at,
  };

  // 2. window commits (API `since`/`until` filter on committer date).
  const commitList = await client.listCommits(repo, window, { maxItems: opts.maxCommits });
  if (commitList.truncated && commitList.items.length >= opts.maxCommits) truncated.commits = opts.maxCommits;
  if (commitList.budgetHit) truncated.callBudgetHit = true;

  const detailMode = opts.commitDetails === "auto" ? (client.authenticated ? "full" : "none") : opts.commitDetails;
  let detailCoverage: GithubCoverage["commitDetails"] = detailMode === "none" ? "none" : "full";
  let detailStopped = false;

  const commits: GithubCommitFacts[] = [];
  for (const c of commitList.items) {
    const cm = c.commit ?? {};
    const { headline, trailers } = parseCommitMessage(cm.message ?? "");
    const entry: GithubCommitFacts = {
      sha: c.sha,
      committedISO: cm.committer?.date ?? "",
      authoredISO: cm.author?.date ?? "",
      headline,
      ...(trailers ? { trailers } : {}),
      authorName: cm.author?.name ?? "(unknown)", // git author name, never the email
      ...(c.author?.login ? { authorLogin: c.author.login } : {}),
      ...(c.author?.avatar_url ? { avatarUrl: c.author.avatar_url } : {}),
    };
    if (detailMode === "full" && !detailStopped) {
      const d = await client.getCommitDetail(repo, c.sha);
      if (d.budgetHit) {
        detailCoverage = "partial";
        truncated.callBudgetHit = true;
        detailStopped = true; // stop spending on details; remaining commits go bare
      } else if (d.status === 200 && d.body?.stats) {
        entry.additions = d.body.stats.additions;
        entry.deletions = d.body.stats.deletions;
        const allFiles = d.body.files ?? [];
        entry.files = allFiles.slice(0, filesPerCommit).map((f) => ({
          path: f.filename,
          additions: f.additions,
          deletions: f.deletions,
          status: f.status,
        }));
        if (allFiles.length > filesPerCommit) truncated.filesPerCommit = filesPerCommit;
      } else {
        detailCoverage = "partial"; // a detail call failed but budget remains
      }
    }
    commits.push(entry);
  }

  // 3. trailing 8 Monday-weeks (window + 7 prior) → grid + deltas.
  const trailingStart = addDaysISO(window.startISO, -49);
  const trailingList = await client.listCommits(repo, { startISO: trailingStart, endISO: window.endISO }, { maxItems: 5000 });
  if (trailingList.budgetHit) truncated.callBudgetHit = true;
  const trailing8WeekCommitsLite: GithubCommitLite[] = trailingList.items.map((c) => ({
    sha: c.sha,
    committedISO: c.commit?.committer?.date ?? "",
    ...(c.author?.login ? { authorLogin: c.author.login } : {}),
    authorName: c.commit?.author?.name ?? "(unknown)",
  }));

  // 4. weekly activity (Sunday-start; may be empty if stats stayed 202).
  const ca = await client.getCommitActivity(repo);
  const weeklyActivity = ca.status === 200 && Array.isArray(ca.body)
    ? ca.body.map((w) => ({ weekStartISO: unixToISODate(w.week), days: w.days, total: w.total }))
    : [];

  // 5. weekly code frequency (absent on 422 — repos too large, e.g. FFmpeg).
  const cf = await client.getCodeFrequency(repo);
  const weeklyCodeFrequency = cf.status === 200 && Array.isArray(cf.body)
    ? cf.body.map((w) => ({ weekStartISO: unixToISODate(w[0]), additions: w[1], deletions: w[2] }))
    : undefined;

  // 6. stars (+ deltas when authenticated).
  let stars: GithubStarFacts = { total: R.stargazers_count };
  let starDeltas = false;
  if (client.authenticated) {
    const d = await computeStarDeltas(client, repo, window);
    if (d) {
      stars = { total: R.stargazers_count, ...d };
      starDeltas = true;
    }
  }

  // 7. pulls / issues (authenticated + non-mirror only).
  const { pulls, issues } = await fetchPullsIssues(client, repo, window, R.has_issues);

  const coverage: GithubCoverage = {
    authenticated: client.authenticated,
    commitDetails: detailCoverage,
    pulls: pulls !== undefined,
    issues: issues !== undefined,
    starDeltas,
    ...(Object.keys(truncated).length ? { truncated } : {}),
  };

  return {
    schemaVersion: 1,
    repo: repoFacts,
    window: { startISO: window.startISO, endISO: window.endISO },
    commits,
    trailing8WeekCommitsLite,
    weeklyActivity,
    ...(weeklyCodeFrequency ? { weeklyCodeFrequency } : {}),
    stars,
    ...(pulls ? { pulls } : {}),
    ...(issues ? { issues } : {}),
    coverage,
    ...(client.rateLimit ? { rateLimit: client.rateLimit } : {}),
  };
}
