#!/usr/bin/env node
/**
 * record-facts.mjs — manual-run recorder for the GitHub `repo-facts-fetcher`
 * fixture (Brussels EPIC F5, Phase 0 task 0.3).
 *
 * Emits ONE frozen `GithubRepoFacts` JSON for a single complete Mon..Sun week,
 * to drive the `weekly-pulse-adapter` snapshot tests (F5 Phase 3). This is a
 * ONE-SHOT dev tool, NOT a template and NOT the production client:
 *
 *   - It may use wall-clock (`new Date`) and the live network freely — the
 *     determinism rule binds templates, not this recorder.
 *   - Its fetch/window/bucket logic is deliberately simple + inline; the
 *     tested, injectable-fetch production version lands in `github/client.ts`
 *     (P1) + `repo-facts-fetcher` (P2). Shared contract = the `GithubRepoFacts`
 *     SHAPE only (Seam B of the F5 plan).
 *
 * Run it ONCE, commit the emitted JSON, then leave it frozen.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node record-facts.mjs                       # full coverage, auto last-full-week, FFmpeg/FFmpeg
 *   GITHUB_TOKEN=ghp_xxx node record-facts.mjs FFmpeg/FFmpeg --start 2026-07-06 --end 2026-07-12
 *   node record-facts.mjs                                            # anonymous → DEGRADED (no per-commit files, no star deltas)
 *
 * Flags:
 *   <owner/name>            positional repo (default FFmpeg/FFmpeg)
 *   --start YYYY-MM-DD      window start (Monday, UTC). Default: last full Mon..Sun week before now.
 *   --end   YYYY-MM-DD      window end   (Sunday, UTC). Default: start + 6 days.
 *   --out <path>           output file. Default: ./ffmpeg-week-<startISO>.facts.json next to this script.
 *   --commit-details auto|full|none   default auto (full when token present, none anonymous).
 *   --max-commits <n>      per-window commit cap (default 500).
 *   --call-budget <n>      hard cap on API calls (default 300).
 *   --files-per-commit <n> cap on files[] recorded per commit (default 40).
 *   --max-bytes <n>        trim files[] until JSON < n bytes (default 1_000_000).
 *
 * Secret hygiene: the token rides request headers only. It never enters the
 * emitted JSON. `commit.author.email` / `commit.committer.email` are stripped
 * at record time (public commit metadata minus PII — see F5 plan task 0.4).
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://api.github.com";
const SCHEMA_VERSION = 1;

// ── args ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { repo: "FFmpeg/FFmpeg", commitDetails: "auto", maxCommits: 500, callBudget: 300, filesPerCommit: 40, maxBytes: 1_000_000 };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--start") a.start = rest[++i];
    else if (t === "--end") a.end = rest[++i];
    else if (t === "--out") a.out = rest[++i];
    else if (t === "--commit-details") a.commitDetails = rest[++i];
    else if (t === "--max-commits") a.maxCommits = Number(rest[++i]);
    else if (t === "--call-budget") a.callBudget = Number(rest[++i]);
    else if (t === "--files-per-commit") a.filesPerCommit = Number(rest[++i]);
    else if (t === "--max-bytes") a.maxBytes = Number(rest[++i]);
    else if (!t.startsWith("--")) a.repo = t;
  }
  return a;
}

// ── UTC date helpers (recorder may use Date — not a template) ────────────
const DAY_MS = 86_400_000;
function ymd(d) { return d.toISOString().slice(0, 10); }
function atUTCmidnight(iso) { return new Date(iso + "T00:00:00Z"); }
/** Most recent COMPLETE Mon..Sun week strictly before `now`. */
function lastFullWeek(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  const thisMonday = new Date(d.getTime() - dow * DAY_MS);
  const lastMonday = new Date(thisMonday.getTime() - 7 * DAY_MS);
  const lastSunday = new Date(lastMonday.getTime() + 6 * DAY_MS);
  return { start: ymd(lastMonday), end: ymd(lastSunday) };
}
/** ISO-8601 week number of a Monday-start week. */
function isoWeek(startISO) {
  const d = atUTCmidnight(startISO);
  const thursday = new Date(d.getTime() + 3 * DAY_MS); // Mon-start → its Thursday
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil(((thursday - yearStart) / DAY_MS + 1) / 7);
}
/** Monday (UTC, YYYY-MM-DD) of the ISO week containing committer date `iso`. */
function mondayOf(iso) {
  const d = atUTCmidnight(iso.slice(0, 10));
  const dow = (d.getUTCDay() + 6) % 7;
  return ymd(new Date(d.getTime() - dow * DAY_MS));
}

// ── fetch plumbing ───────────────────────────────────────────────────────
let CALLS = 0;
let RATE = undefined;
async function gh(pathOrUrl, { token, accept = "application/vnd.github+json", budget } = {}) {
  if (budget !== undefined && CALLS >= budget) {
    return { budgetHit: true, status: 0, headers: new Headers(), body: undefined };
  }
  CALLS++;
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : API + pathOrUrl;
  const headers = { Accept: accept, "User-Agent": "m0saic-record-facts" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const lim = res.headers.get("x-ratelimit-limit");
  const rem = res.headers.get("x-ratelimit-remaining");
  if (lim && rem) RATE = { limit: Number(lim), remaining: Number(rem) };
  let body;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) { try { body = await res.json(); } catch { body = undefined; } }
  return { status: res.status, headers: res.headers, body };
}
/** GitHub Link-header "next" URL, or null. */
function nextLink(headers) {
  const link = headers.get("link");
  if (!link) return null;
  const m = /<([^>]+)>;\s*rel="next"/.exec(link);
  return m ? m[1] : null;
}
function lastLink(headers) {
  const link = headers.get("link");
  if (!link) return null;
  const m = /<([^>]+)>;\s*rel="last"/.exec(link);
  return m ? m[1] : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** stats/* endpoints return 202 while GitHub computes — bounded retry. */
async function ghStats(path, opts, retries = 3, waitMs = 1500) {
  for (let i = 0; i <= retries; i++) {
    const r = await gh(path, opts);
    if (r.status === 202) { await sleep(waitMs); continue; }
    return r;
  }
  return { status: 202, headers: new Headers(), body: undefined };
}

// ── trailers + headline ──────────────────────────────────────────────────
function splitMessage(message) {
  const lines = (message || "").split("\n");
  const headline = lines[0] || "";
  const trailers = {};
  const re = /^([A-Za-z][A-Za-z-]+):\s*(.+)$/;
  for (const line of lines.slice(1)) {
    const m = re.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    if (!/-by$|^Fixes$|^Bug$/i.test(key)) continue; // Signed-off-by, Reviewed-by, Co-authored-by, Tested-by, ...
    // Trailer values are `Name <email>` — keep the name, strip the email (PII).
    const value = m[2].replace(/\s*<[^>]*>/g, "").trim();
    if (value) (trailers[key] ||= []).push(value);
  }
  return { headline, trailers: Object.keys(trailers).length ? trailers : undefined };
}

// ── PII scrub (task 0.4: the frozen fixture must contain NO emails) ───────
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Deep-replace any email-shaped substring with `[email]`. Belt-and-suspenders
 *  over the targeted trailer strip — guarantees the frozen fixture is PII-free. */
function scrubEmails(value) {
  if (typeof value === "string") return value.replace(EMAIL_RE, "[email]");
  if (Array.isArray(value)) return value.map(scrubEmails);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = scrubEmails(value[k]);
    return out;
  }
  return value;
}

// ── commit list (windowed, committer-date filtered by the API) ────────────
async function fetchCommitList(repo, sinceISO, untilISO, { token, budget, maxCommits }) {
  const out = [];
  let url = `/repos/${repo}/commits?since=${sinceISO}&until=${untilISO}&per_page=100`;
  while (url) {
    const r = await gh(url, { token, budget });
    if (r.budgetHit || r.status !== 200 || !Array.isArray(r.body)) break;
    out.push(...r.body);
    if (out.length >= maxCommits) break;
    url = nextLink(r.headers);
  }
  return out;
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const token = process.env.GITHUB_TOKEN || "";
  const now = new Date();
  const win = args.start && args.end ? { start: args.start, end: args.end } : lastFullWeek(now);
  const start = args.start || win.start;
  const end = args.end || win.end;
  const sinceISO = `${start}T00:00:00Z`;
  const untilISO = `${ymd(new Date(atUTCmidnight(end).getTime() + DAY_MS))}T00:00:00Z`; // end + 1d
  const authenticated = Boolean(token);
  const detailMode = args.commitDetails === "auto" ? (authenticated ? "full" : "none") : args.commitDetails;

  console.error(`[record-facts] repo=${args.repo} window=${start}..${end} authenticated=${authenticated} commitDetails=${detailMode}`);

  const truncated = {};

  // 1. repo scalars
  const repoRes = await gh(`/repos/${args.repo}`, { token, budget: args.callBudget });
  if (repoRes.status !== 200 || !repoRes.body) throw new Error(`repo fetch failed: HTTP ${repoRes.status}`);
  const R = repoRes.body;
  const repo = {
    fullName: R.full_name, name: R.name, defaultBranch: R.default_branch,
    ...(R.description ? { description: R.description } : {}),
    stars: R.stargazers_count, forks: R.forks_count, watchers: R.subscribers_count,
    openIssues: R.open_issues_count, hasIssues: R.has_issues, pushedAt: R.pushed_at,
  };

  // 2. window commits (committer-date bucketed — the since/until args already filter on committer date)
  const raw = await fetchCommitList(args.repo, sinceISO, untilISO, { token, budget: args.callBudget, maxCommits: args.maxCommits });
  if (raw.length >= args.maxCommits) truncated.commits = args.maxCommits;
  let commitDetailsCoverage = detailMode === "none" ? "none" : "full";
  const commits = [];
  for (const c of raw) {
    const cm = c.commit || {};
    const { headline, trailers } = splitMessage(cm.message);
    const entry = {
      sha: c.sha,
      committedISO: cm.committer?.date,
      authoredISO: cm.author?.date,
      headline,
      ...(trailers ? { trailers } : {}),
      authorName: cm.author?.name || "(unknown)",         // git author name, no email
      ...(c.author?.login ? { authorLogin: c.author.login } : {}),
      ...(c.author?.avatar_url ? { avatarUrl: c.author.avatar_url } : {}),
    };
    // 3. per-commit detail (coverage-gated): additions/deletions/files[]
    if (detailMode === "full") {
      const d = await gh(`/repos/${args.repo}/commits/${c.sha}`, { token, budget: args.callBudget });
      if (d.budgetHit) { commitDetailsCoverage = "partial"; truncated.callBudgetHit = true; }
      else if (d.status === 200 && d.body?.stats) {
        entry.additions = d.body.stats.additions;
        entry.deletions = d.body.stats.deletions;
        const files = (d.body.files || []).slice(0, args.filesPerCommit).map((f) => ({
          path: f.filename, additions: f.additions, deletions: f.deletions, status: f.status,
        }));
        if ((d.body.files || []).length > args.filesPerCommit) truncated.filesPerCommit = args.filesPerCommit;
        entry.files = files;
      } else { commitDetailsCoverage = "partial"; }
    }
    commits.push(entry);
  }

  // 4. trailing 8-week lite list (window + 7 prior weeks) → grid + deltas
  const trailingStart = ymd(new Date(atUTCmidnight(start).getTime() - 7 * 7 * DAY_MS));
  const trailingRaw = await fetchCommitList(args.repo, `${trailingStart}T00:00:00Z`, untilISO, { token, budget: args.callBudget, maxCommits: 5000 });
  const trailing8WeekCommitsLite = trailingRaw.map((c) => ({
    sha: c.sha, committedISO: c.commit?.committer?.date,
    ...(c.author?.login ? { authorLogin: c.author.login } : {}),
    authorName: c.commit?.author?.name || "(unknown)",
  }));

  // 5. stats/commit_activity (52 Sunday-start weeks)
  let weeklyActivity = [];
  const ca = await ghStats(`/repos/${args.repo}/stats/commit_activity`, { token, budget: args.callBudget });
  if (ca.status === 200 && Array.isArray(ca.body)) {
    weeklyActivity = ca.body.map((w) => ({ weekStartISO: new Date(w.week * 1000).toISOString().slice(0, 10), days: w.days, total: w.total }));
  }

  // 6. stats/code_frequency (may 422 on very large repos → absent)
  let weeklyCodeFrequency;
  const cf = await ghStats(`/repos/${args.repo}/stats/code_frequency`, { token, budget: args.callBudget });
  if (cf.status === 200 && Array.isArray(cf.body)) {
    weeklyCodeFrequency = cf.body.map((w) => ({ weekStartISO: new Date(w[0] * 1000).toISOString().slice(0, 10), additions: w[1], deletions: w[2] }));
  } else {
    console.error(`[record-facts] code_frequency unavailable (HTTP ${cf.status}) — weeklyCodeFrequency omitted`);
  }

  // 7. stars: total always; deltas via starred_at back-pagination (needs auth — anon is 401)
  let stars = { total: R.stargazers_count };
  let starDeltas = false;
  if (authenticated) {
    const delta = await starDeltaInWindow(args.repo, token, start, end, args.callBudget);
    if (delta) { stars = { total: R.stargazers_count, ...delta }; starDeltas = true; }
  }

  // 8. pulls / issues — only meaningful + authenticated (FFmpeg mirror records false)
  let pulls, issues;
  const wantIssues = repo.hasIssues && authenticated;
  // (PR/issue windowed counts left to the production fetcher; the recorder
  //  records coverage flags so the adapter's adaptive KPI path is exercisable.)

  const coverage = {
    authenticated,
    commitDetails: commitDetailsCoverage,
    pulls: Boolean(pulls),
    issues: Boolean(issues),
    starDeltas,
    ...(Object.keys(truncated).length ? { truncated } : {}),
  };

  let facts = {
    schemaVersion: SCHEMA_VERSION,
    repo, window: { startISO: start, endISO: end },
    commits, trailing8WeekCommitsLite, weeklyActivity,
    ...(weeklyCodeFrequency ? { weeklyCodeFrequency } : {}),
    stars,
    ...(pulls ? { pulls } : {}),
    ...(issues ? { issues } : {}),
    coverage,
    ...(RATE ? { rateLimit: RATE } : {}),
  };

  // PII guarantee: scrub every email-shaped token, then assert none remain.
  facts = scrubEmails(facts);
  const leaked = JSON.stringify(facts).match(EMAIL_RE);
  if (leaked) throw new Error(`PII scrub failed — ${leaked.length} email(s) remain, e.g. ${leaked[0]}`);

  // 9. size trim — drop files[] tails until under maxBytes (record the trim)
  let json = JSON.stringify(facts, null, 2);
  if (json.length > args.maxBytes) {
    for (const c of facts.commits) if (c.files) c.files = c.files.slice(0, 5);
    facts.coverage.truncated = { ...(facts.coverage.truncated || {}), filesPerCommit: 5 };
    json = JSON.stringify(facts, null, 2);
    if (json.length > args.maxBytes) { for (const c of facts.commits) delete c.files; json = JSON.stringify(facts, null, 2); }
  }

  const outPath = args.out
    ? (isAbsolute(args.out) ? args.out : join(process.cwd(), args.out))
    : join(HERE, `ffmpeg-week-${start}.facts.json`);
  writeFileSync(outPath, json + "\n");
  console.error(`[record-facts] wrote ${outPath}  (${json.length} bytes, ${commits.length} commits, ${CALLS} API calls, coverage=${JSON.stringify(coverage)})`);
}

/** Count stargazers whose starred_at falls in [start,end] and the prior week,
 *  by back-paginating from the last page (ascending starred_at order). */
async function starDeltaInWindow(repo, token, start, end, budget) {
  const first = await gh(`/repos/${repo}/stargazers?per_page=100`, { token, accept: "application/vnd.github.star+json", budget });
  if (first.status !== 200 || !Array.isArray(first.body)) return undefined;
  const lastUrl = lastLink(first.headers);
  const lastPage = lastUrl ? Number(new URL(lastUrl).searchParams.get("page")) : 1;
  const winStart = atUTCmidnight(start).getTime();
  const winEnd = atUTCmidnight(end).getTime() + DAY_MS;
  const prevStart = winStart - 7 * DAY_MS;
  let inWindow = 0, inPrev = 0;
  for (let page = lastPage; page >= 1; page--) {
    const r = page === lastPage && !lastUrl
      ? first
      : await gh(`/repos/${repo}/stargazers?per_page=100&page=${page}`, { token, accept: "application/vnd.github.star+json", budget });
    if (r.budgetHit || r.status !== 200 || !Array.isArray(r.body)) break;
    let anyOlderThanPrev = false;
    for (const s of r.body) {
      const t = new Date(s.starred_at).getTime();
      if (t >= winStart && t < winEnd) inWindow++;
      else if (t >= prevStart && t < winStart) inPrev++;
      else if (t < prevStart) anyOlderThanPrev = true;
    }
    if (anyOlderThanPrev) break; // walked past the prev window — done
  }
  return { deltaInWindow: inWindow, deltaPrevWindow: inPrev };
}

main().catch((e) => { console.error("[record-facts] FAILED:", e.message); process.exit(1); });
