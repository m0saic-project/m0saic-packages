/**
 * `SAMPLE_FACTS` — the embedded, deterministic, full-coverage replay payload for
 * `repo-facts-fetcher/v1`. Serves three jobs:
 *   1. the network-free default render (so the e2e sweep never touches GitHub),
 *   2. the byte-equality seam for the fetcher's replay determinism test,
 *   3. a full-coverage fixture the `weekly-pulse-adapter` (P3) can snapshot
 *      against before the founder records the real FFmpeg week.
 *
 * A coherent single week for a fictional normal repo (`acme/rocket`, June 1–7
 * 2026, Mon..Sun): 8 window commits across 4 contributors, full commit detail,
 * star deltas, and PR/issue counts — i.e. every `coverage` flag true, so the
 * adaptive KPI path lights up. Built via tiny local helpers to stay compact;
 * the result is a fixed constant (no Date, no randomness).
 */

import { addDaysISO, civilFromDays, daysFromCivil, formatISODate } from "../../week-math";
import type { GithubCommitLite, GithubRepoFacts, GithubWeeklyActivity, GithubWeeklyCodeFrequency } from "./facts";

const lite = (sha: string, committedISO: string, authorLogin: string, authorName: string): GithubCommitLite => ({
  sha,
  committedISO,
  authorLogin,
  authorName,
});

/** N Sunday-start weekly-activity rows ending at (and including) `lastSundayISO`. */
function activityWeeks(lastSundayISO: string, totals: number[]): GithubWeeklyActivity[] {
  return totals.map((total, i) => {
    const weekStartISO = addDaysISO(lastSundayISO, -7 * (totals.length - 1 - i));
    // Spread the week's total across weekdays deterministically (Mon-heavy).
    const days = [0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < total; k++) days[k % 7]++;
    return { weekStartISO, days, total };
  });
}

function codeFreqWeeks(lastSundayISO: string, rows: [number, number][]): GithubWeeklyCodeFrequency[] {
  return rows.map(([additions, deletions], i) => ({
    weekStartISO: addDaysISO(lastSundayISO, -7 * (rows.length - 1 - i)),
    additions,
    deletions,
  }));
}

// The GitHub "week" that contains the window's Sunday (2026-06-07) starts Sun 2026-06-07.
const LAST_SUNDAY = formatISODate(civilFromDays(daysFromCivil(2026, 6, 7)));

export const SAMPLE_FACTS: GithubRepoFacts = {
  schemaVersion: 1,
  repo: {
    fullName: "acme/rocket",
    name: "rocket",
    defaultBranch: "main",
    description: "A tidy demo repo for the Weekly Pulse.",
    stars: 4200,
    forks: 310,
    watchers: 88,
    openIssues: 42,
    hasIssues: true,
    pushedAt: "2026-06-07T18:04:11Z",
  },
  window: { startISO: "2026-06-01", endISO: "2026-06-07" },

  commits: [
    {
      sha: "c0ffee01", committedISO: "2026-06-01T09:12:00Z", authoredISO: "2026-06-01T09:12:00Z",
      headline: "core: speed up render loop with a SIMD path",
      trailers: { "Reviewed-by": ["Grace Hopper"] },
      authorName: "Ada Lovelace", authorLogin: "ada", avatarUrl: "https://avatars.example/ada.png",
      additions: 180, deletions: 40,
      files: [{ path: "core/render.ts", additions: 180, deletions: 40, status: "modified" }],
    },
    {
      sha: "c0ffee02", committedISO: "2026-06-01T14:48:00Z", authoredISO: "2026-06-01T14:48:00Z",
      headline: "io: fix memory leak in the stream reader",
      trailers: { "Reviewed-by": ["Ada Lovelace"] },
      authorName: "Grace Hopper", authorLogin: "grace", avatarUrl: "https://avatars.example/grace.png",
      additions: 24, deletions: 18,
      files: [{ path: "io/stream.ts", additions: 24, deletions: 18, status: "modified" }],
    },
    {
      sha: "c0ffee03", committedISO: "2026-06-02T11:03:00Z", authoredISO: "2026-06-02T10:50:00Z",
      headline: "api: add pagination to the list endpoints",
      trailers: { "Reviewed-by": ["Ada Lovelace", "Grace Hopper"] },
      authorName: "Alan Turing", authorLogin: "alan", avatarUrl: "https://avatars.example/alan.png",
      additions: 210, deletions: 12,
      files: [
        { path: "api/list.ts", additions: 168, deletions: 12, status: "modified" },
        { path: "api/types.ts", additions: 42, deletions: 0, status: "modified" },
      ],
    },
    {
      sha: "c0ffee04", committedISO: "2026-06-03T08:20:00Z", authoredISO: "2026-06-03T08:20:00Z",
      headline: "core: fix crash on empty input",
      authorName: "Ada Lovelace", authorLogin: "ada", avatarUrl: "https://avatars.example/ada.png",
      additions: 12, deletions: 4,
      files: [{ path: "core/render.ts", additions: 12, deletions: 4, status: "modified" }],
    },
    {
      sha: "c0ffee05", committedISO: "2026-06-03T13:31:00Z", authoredISO: "2026-06-03T13:31:00Z",
      headline: "docs: document the pagination API",
      authorName: "Katherine Johnson", authorLogin: "katherine", avatarUrl: "https://avatars.example/katherine.png",
      additions: 64, deletions: 2,
      files: [{ path: "docs/api.md", additions: 64, deletions: 2, status: "modified" }],
    },
    {
      sha: "c0ffee06", committedISO: "2026-06-03T17:59:00Z", authoredISO: "2026-06-03T17:59:00Z",
      headline: "render: cache the glyph atlas between frames",
      trailers: { "Reviewed-by": ["Alan Turing"] },
      authorName: "Grace Hopper", authorLogin: "grace", avatarUrl: "https://avatars.example/grace.png",
      additions: 96, deletions: 30,
      files: [{ path: "render/atlas.ts", additions: 96, deletions: 30, status: "modified" }],
    },
    {
      sha: "c0ffee07", committedISO: "2026-06-04T10:07:00Z", authoredISO: "2026-06-04T10:07:00Z",
      headline: "tests: add coverage for pagination edge cases",
      authorName: "Alan Turing", authorLogin: "alan", avatarUrl: "https://avatars.example/alan.png",
      additions: 140, deletions: 0,
      files: [{ path: "tests/api.test.ts", additions: 140, deletions: 0, status: "added" }],
    },
    {
      sha: "c0ffee08", committedISO: "2026-06-06T15:22:00Z", authoredISO: "2026-06-06T15:22:00Z",
      headline: "cli: add a --watch flag",
      trailers: { "Reviewed-by": ["Ada Lovelace"] },
      authorName: "Katherine Johnson", authorLogin: "katherine", avatarUrl: "https://avatars.example/katherine.png",
      additions: 88, deletions: 6,
      files: [{ path: "cli/watch.ts", additions: 88, deletions: 6, status: "added" }],
    },
  ],

  trailing8WeekCommitsLite: [
    // window week (2026-06-01) — mirrors the 8 commits above
    lite("c0ffee01", "2026-06-01T09:12:00Z", "ada", "Ada Lovelace"),
    lite("c0ffee02", "2026-06-01T14:48:00Z", "grace", "Grace Hopper"),
    lite("c0ffee03", "2026-06-02T11:03:00Z", "alan", "Alan Turing"),
    lite("c0ffee04", "2026-06-03T08:20:00Z", "ada", "Ada Lovelace"),
    lite("c0ffee05", "2026-06-03T13:31:00Z", "katherine", "Katherine Johnson"),
    lite("c0ffee06", "2026-06-03T17:59:00Z", "grace", "Grace Hopper"),
    lite("c0ffee07", "2026-06-04T10:07:00Z", "alan", "Alan Turing"),
    lite("c0ffee08", "2026-06-06T15:22:00Z", "katherine", "Katherine Johnson"),
    // prev week (2026-05-25) — 5 commits (this week 8 vs prev 5 → +60%)
    lite("a0000501", "2026-05-25T09:00:00Z", "ada", "Ada Lovelace"),
    lite("a0000502", "2026-05-26T09:00:00Z", "grace", "Grace Hopper"),
    lite("a0000503", "2026-05-27T09:00:00Z", "alan", "Alan Turing"),
    lite("a0000504", "2026-05-28T09:00:00Z", "ada", "Ada Lovelace"),
    lite("a0000505", "2026-05-29T09:00:00Z", "grace", "Grace Hopper"),
    // 2026-05-18 — 4
    lite("a0001801", "2026-05-18T09:00:00Z", "ada", "Ada Lovelace"),
    lite("a0001802", "2026-05-19T09:00:00Z", "alan", "Alan Turing"),
    lite("a0001803", "2026-05-20T09:00:00Z", "grace", "Grace Hopper"),
    lite("a0001804", "2026-05-22T09:00:00Z", "katherine", "Katherine Johnson"),
    // 2026-05-11 — 3
    lite("a0001101", "2026-05-11T09:00:00Z", "ada", "Ada Lovelace"),
    lite("a0001102", "2026-05-13T09:00:00Z", "grace", "Grace Hopper"),
    lite("a0001103", "2026-05-15T09:00:00Z", "alan", "Alan Turing"),
    // 2026-05-04 — 2
    lite("a0000401", "2026-05-04T09:00:00Z", "ada", "Ada Lovelace"),
    lite("a0000402", "2026-05-07T09:00:00Z", "katherine", "Katherine Johnson"),
    // 2026-04-27 — 3
    lite("a0002701", "2026-04-27T09:00:00Z", "grace", "Grace Hopper"),
    lite("a0002702", "2026-04-29T09:00:00Z", "ada", "Ada Lovelace"),
    lite("a0002703", "2026-05-01T09:00:00Z", "alan", "Alan Turing"),
    // 2026-04-20 — 2
    lite("a0002001", "2026-04-20T09:00:00Z", "ada", "Ada Lovelace"),
    lite("a0002002", "2026-04-24T09:00:00Z", "grace", "Grace Hopper"),
    // 2026-04-13 — 2
    lite("a0001301", "2026-04-13T09:00:00Z", "alan", "Alan Turing"),
    lite("a0001302", "2026-04-17T09:00:00Z", "ada", "Ada Lovelace"),
  ],

  weeklyActivity: activityWeeks(LAST_SUNDAY, [11, 9, 14, 8, 12, 10, 9, 13]),
  weeklyCodeFrequency: codeFreqWeeks(LAST_SUNDAY, [
    [1200, -400], [900, -260], [1500, -520], [640, -180],
    [1100, -300], [980, -410], [720, -220], [814, -140],
  ]),

  stars: { total: 4200, deltaInWindow: 37, deltaPrevWindow: 21 },
  pulls: { open: 12, openedInWindow: 9, mergedInWindow: 7 },
  issues: { open: 42, openedInWindow: 6, closedInWindow: 8 },
  coverage: { authenticated: true, commitDetails: "full", pulls: true, issues: true, starDeltas: true },
  rateLimit: { limit: 5000, remaining: 4923 },
};
