/**
 * `GithubRepoFacts` — the normalized, bounded, near-raw sheet the
 * `repo-facts-fetcher` publishes under the alias `githubRepoFacts`
 * (`schemaVersion: 1`). This is the F5 producer→consumer contract: the
 * `weekly-pulse-adapter` consumes it and derives the `WeeklyPulse` sheet.
 *
 * Every field is a cheap GitHub REST read (or a free derivation from one).
 * Coverage is always recorded, never assumed — a mirror repo (no issues, few
 * PRs) or an anonymous fetch legitimately drops fields, and `coverage` says so.
 */

export type GithubCommitFileFacts = {
  path: string;
  additions: number;
  deletions: number;
  status: string;
};

export type GithubCommitFacts = {
  sha: string;
  /** Committer date (window bucketing key). */
  committedISO: string;
  /** Author date (may predate committedISO — mailing-list workflows). */
  authoredISO: string;
  /** First line of the commit message. */
  headline: string;
  /** Parsed message trailers (Reviewed-by, Signed-off-by, …) — names, no emails. */
  trailers?: Record<string, string[]>;
  authorName: string;
  authorLogin?: string;
  avatarUrl?: string;
  /** From the per-commit detail call (coverage-gated). */
  additions?: number;
  deletions?: number;
  files?: GithubCommitFileFacts[];
};

export type GithubCommitLite = {
  sha: string;
  committedISO: string;
  authorLogin?: string;
  authorName: string;
};

export type GithubWeeklyActivity = {
  /** Sunday-start week (GitHub's `stats/commit_activity`). */
  weekStartISO: string;
  days: number[];
  total: number;
};

export type GithubWeeklyCodeFrequency = {
  weekStartISO: string;
  additions: number;
  deletions: number;
};

export type GithubStarFacts = {
  total: number;
  deltaInWindow?: number;
  deltaPrevWindow?: number;
};

export type GithubPullFacts = { open: number; openedInWindow: number; mergedInWindow: number };
export type GithubIssueFacts = { open: number; openedInWindow: number; closedInWindow: number };

export type GithubCoverage = {
  authenticated: boolean;
  commitDetails: "full" | "partial" | "none";
  pulls: boolean;
  issues: boolean;
  starDeltas: boolean;
  truncated?: {
    commits?: number;
    filesPerCommit?: number;
    callBudgetHit?: boolean;
  };
};

export type GithubRepoFacts = {
  schemaVersion: 1;
  repo: {
    fullName: string;
    name: string;
    defaultBranch: string;
    description?: string;
    stars: number;
    forks: number;
    watchers: number;
    openIssues: number;
    hasIssues: boolean;
    pushedAt: string;
  };
  /** UTC Monday..Sunday inclusive. */
  window: { startISO: string; endISO: string };
  /** THE window's commits, committer-date bucketed. */
  commits: GithubCommitFacts[];
  /** Window + 7 prior weeks — feeds the grid + all week-over-week deltas. */
  trailing8WeekCommitsLite: GithubCommitLite[];
  weeklyActivity: GithubWeeklyActivity[];
  weeklyCodeFrequency?: GithubWeeklyCodeFrequency[];
  stars?: GithubStarFacts;
  pulls?: GithubPullFacts;
  issues?: GithubIssueFacts;
  coverage: GithubCoverage;
  rateLimit?: { limit: number; remaining: number };
};
