/**
 * `deriveWeeklyPulse` — the PURE core of the weekly-pulse-adapter (F5 Seam C).
 *
 * A deterministic function of `GithubRepoFacts` + preview props → a `WeeklyPulse`
 * sheet. NO clock, NO network, NO randomness. Every derivation below is the
 * determinism contract; the adapter's snapshot tests lock the exact output.
 *
 * Coverage-aware by design: a mirror repo (no PR/issue KPIs) or an anonymous
 * fetch (`commitDetails:"none"` → commit-basis donut, 0 additions/deletions)
 * degrades honestly — the basis is labeled, never faked.
 */

import type {
  AreaSlice,
  CommitKind,
  ContributorRow,
  NotableCommit,
  PulseKpi,
  PulsePeriod,
  Trend,
  WeeklyPulse,
} from "../../../hero/ffmpeg-pulse/_shared/pulse-data";
import { PULSE_AREA, monthDay } from "../../../hero/ffmpeg-pulse/_shared/pulse-data";
import { addDaysISO, isoDayOfWeek, isoWeekNumber, mondayOfISO, parseISODate } from "../../week-math";
import type { GithubCommitFacts, GithubRepoFacts } from "../../repo-facts-fetcher/v1/facts";

export type DeriveWeeklyPulseProps = {
  /** Override the adaptive KPI selection (ordered keys). */
  kpiKeys?: string[];
  /** Number of notable commits (default 5). */
  notableCount?: number;
  /** Path segments that define a "changed area" (default 1). */
  areaDepth?: number;
  /** Top-N contributors (default 5). */
  topContributors?: number;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Notable-commit keyword table — case-insensitive, FIRST match wins; both
 *  classifies `kind` and sets `signal` + a score boost (F5 Seam C). */
const KEYWORD_RULES: { re: RegExp; kind: CommitKind; signal: "win" | "warn" | "neutral"; boost: number }[] = [
  { re: /security|cve|overflow/i, kind: "fix", signal: "warn", boost: 6 },
  { re: /revert|regression/i, kind: "fix", signal: "warn", boost: 4 },
  { re: /fix|leak|crash/i, kind: "fix", signal: "win", boost: 2 },
  { re: /\b(add|support|new|implement)/i, kind: "feat", signal: "neutral", boost: 2 },
  { re: /faster|optimi|simd|speed/i, kind: "perf", signal: "win", boost: 3 },
  { re: /docs?\b/i, kind: "docs", signal: "neutral", boost: 0 },
  { re: /test|fate/i, kind: "test", signal: "neutral", boost: 0 },
];
function classify(headline: string): { kind: CommitKind; signal: "win" | "warn" | "neutral"; boost: number } {
  for (const r of KEYWORD_RULES) if (r.re.test(headline)) return r;
  return { kind: "chore", signal: "neutral", boost: 0 };
}

/** `area: description` prefix of a commit subject, capped to `areaDepth` segments. */
function messagePrefix(headline: string, areaDepth: number): string | undefined {
  const m = /^([\w/,.-]+):/.exec(headline);
  return m ? m[1].split("/").slice(0, areaDepth).join("/") : undefined;
}

/** The dominant changed directory of a commit (fallback: message prefix). */
function topChangedDir(commit: GithubCommitFacts, areaDepth: number): string | undefined {
  const counts = new Map<string, number>();
  for (const f of commit.files ?? []) {
    const seg = f.path.split("/").slice(0, areaDepth).join("/");
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  if (counts.size) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  }
  return messagePrefix(commit.headline, areaDepth);
}

/** Top-6 areas + an aggregated `other`, colored from the shared PULSE_AREA ramp. */
function buildByArea(areas: { area: string; files: number }[]): AreaSlice[] {
  const out: AreaSlice[] = areas.slice(0, 6).map((a, i) => ({ area: a.area, files: a.files, color: PULSE_AREA(i) }));
  const otherFiles = areas.slice(6).reduce((s, a) => s + a.files, 0);
  if (otherFiles > 0) out.push({ area: "other", files: otherFiles, color: PULSE_AREA(5) });
  return out;
}

/** direction (from the sign) + deltaPct (omitted when the base is 0 / unknown). */
function deltaFields(cur: number | undefined, prev: number | undefined): { direction?: Trend; deltaPct?: number } {
  if (cur === undefined || prev === undefined) return {};
  const diff = cur - prev;
  const out: { direction?: Trend; deltaPct?: number } = { direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat" };
  if (prev !== 0) out.deltaPct = Math.round((diff / prev) * 1000) / 10;
  return out;
}

export function deriveWeeklyPulse(facts: GithubRepoFacts, props: DeriveWeeklyPulseProps = {}): WeeklyPulse {
  const areaDepth = Math.max(1, Math.floor(props.areaDepth ?? 1));
  const notableCount = Math.max(1, Math.floor(props.notableCount ?? 5));
  const topContributors = Math.max(1, Math.floor(props.topContributors ?? 5));
  const cov = facts.coverage;
  const hasDetails = cov.commitDetails === "full";
  const windowCommits = facts.commits;
  const windowMonday = mondayOfISO(facts.window.startISO);
  const prevMonday = addDaysISO(windowMonday, -7);
  const haveTrailing = facts.trailing8WeekCommitsLite.length > 0;

  // ── period ─────────────────────────────────────────────────────
  const period: PulsePeriod = { weekNumber: isoWeekNumber(facts.window.startISO), startISO: facts.window.startISO, endISO: facts.window.endISO };

  // ── activity.days + peak (committer-date bucketed, Mon..Sun) ────
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const c of windowCommits) dayCounts[isoDayOfWeek(c.committedISO)]++;
  const days = DAY_LABELS.map((label, i) => ({ label, commits: dayCounts[i] }));
  let peakIdx = 0;
  for (let i = 1; i < 7; i++) if (dayCounts[i] > dayCounts[peakIdx]) peakIdx = i; // tie → earliest
  const peakDateISO = addDaysISO(windowMonday, peakIdx);
  const peak = { dayLabel: DAY_LABELS[peakIdx], dateISO: peakDateISO, commits: dayCounts[peakIdx] };

  // ── activity.grid (trailing 8 Mon-weeks, entirely from the lite list) ──
  const weekStarts: string[] = [];
  for (let w = 7; w >= 0; w--) weekStarts.push(addDaysISO(windowMonday, -7 * w));
  const gridCounts = DAY_LABELS.map(() => weekStarts.map(() => 0));
  for (const c of facts.trailing8WeekCommitsLite) {
    const col = weekStarts.indexOf(mondayOfISO(c.committedISO));
    if (col >= 0) gridCounts[isoDayOfWeek(c.committedISO)][col]++;
  }
  const grid = {
    weekLabels: weekStarts.map((ws) => "W" + isoWeekNumber(ws)),
    rows: DAY_LABELS.map((label, r) => ({ label, values: gridCounts[r] })),
  };

  // ── contributors (window commits grouped by login ?? name) ─────
  const groups = new Map<string, { login: string; name: string; avatarUrl?: string; commits: number; additions: number; deletions: number }>();
  for (const c of windowCommits) {
    const key = c.authorLogin ?? c.authorName;
    let g = groups.get(key);
    if (!g) { g = { login: c.authorLogin ?? "", name: c.authorName, avatarUrl: c.avatarUrl, commits: 0, additions: 0, deletions: 0 }; groups.set(key, g); }
    g.commits++;
    if (hasDetails) { g.additions += c.additions ?? 0; g.deletions += c.deletions ?? 0; }
  }
  const contribRows: ContributorRow[] = [...groups.entries()]
    .map(([key, g]) => ({ key, g }))
    .sort((a, b) => b.g.commits - a.g.commits || b.g.additions - a.g.additions || (a.key < b.key ? -1 : 1))
    .slice(0, topContributors)
    .map(({ g }, i) => ({ rank: i + 1, login: g.login, name: g.name, ...(g.avatarUrl ? { avatarUrl: g.avatarUrl } : {}), commits: g.commits, additions: g.additions, deletions: g.deletions }));

  const contributorsThis = groups.size;
  const prevAuthors = new Set<string>();
  let prevWeekCommits = 0;
  for (const c of facts.trailing8WeekCommitsLite) {
    if (mondayOfISO(c.committedISO) === prevMonday) { prevWeekCommits++; prevAuthors.add(c.authorLogin ?? c.authorName); }
  }
  const prevCommitsArg = haveTrailing ? prevWeekCommits : undefined;
  const prevContribArg = haveTrailing ? prevAuthors.size : undefined;

  // ── scalar aggregates ──────────────────────────────────────────
  const totalCommits = windowCommits.length;
  const sumAdds = hasDetails ? windowCommits.reduce((s, c) => s + (c.additions ?? 0), 0) : undefined;
  const sumDels = hasDetails ? windowCommits.reduce((s, c) => s + (c.deletions ?? 0), 0) : undefined;
  const wcf = facts.weeklyCodeFrequency;
  const cfCur = wcf && wcf.length ? wcf[wcf.length - 1] : undefined;
  const cfPrev = wcf && wcf.length >= 2 ? wcf[wcf.length - 2] : undefined;

  // ── changes (full = distinct changed paths by area; degraded = message-prefix commit counts) ──
  let totalFiles: number;
  let byArea: AreaSlice[];
  if (hasDetails) {
    const distinct = new Set<string>();
    const areaSets = new Map<string, Set<string>>();
    for (const c of windowCommits) for (const f of c.files ?? []) {
      distinct.add(f.path);
      const seg = f.path.split("/").slice(0, areaDepth).join("/");
      let set = areaSets.get(seg);
      if (!set) { set = new Set(); areaSets.set(seg, set); }
      set.add(f.path);
    }
    totalFiles = distinct.size;
    byArea = buildByArea([...areaSets.entries()].map(([area, set]) => ({ area, files: set.size })).sort((a, b) => b.files - a.files || (a.area < b.area ? -1 : 1)));
  } else {
    const areaCounts = new Map<string, number>();
    for (const c of windowCommits) {
      const seg = messagePrefix(c.headline, areaDepth) ?? "other";
      areaCounts.set(seg, (areaCounts.get(seg) ?? 0) + 1);
    }
    totalFiles = windowCommits.length; // basis = commits, not files (labeled in the rail)
    byArea = buildByArea([...areaCounts.entries()].map(([area, files]) => ({ area, files })).sort((a, b) => b.files - a.files || (a.area < b.area ? -1 : 1)));
  }

  // ── KPI pool (each entry present only when its inputs exist) ────
  const pool: Record<string, PulseKpi> = {};
  const addKpi = (k: PulseKpi) => { pool[k.key] = k; };
  addKpi({ key: "commits", label: "Commits", value: totalCommits, sublabel: "vs last week", ...deltaFields(totalCommits, prevCommitsArg) });
  addKpi({ key: "totalCommits", label: "Total Commits", value: totalCommits, sublabel: "vs last week", ...deltaFields(totalCommits, prevCommitsArg) });
  addKpi({ key: "contributors", label: "Contributors", value: contributorsThis, sublabel: "vs last week", ...deltaFields(contributorsThis, prevContribArg) });
  if (sumAdds !== undefined) addKpi({ key: "additions", label: "Additions", value: sumAdds, sublabel: "vs last week", ...deltaFields(cfCur?.additions, cfPrev?.additions) });
  if (sumDels !== undefined) addKpi({ key: "deletions", label: "Deletions", value: sumDels, sublabel: "vs last week", ...deltaFields(cfCur ? Math.abs(cfCur.deletions) : undefined, cfPrev ? Math.abs(cfPrev.deletions) : undefined) });
  if (sumAdds !== undefined && sumDels !== undefined) addKpi({ key: "netChanges", label: "Net Changes", value: sumAdds - sumDels, display: (sumAdds - sumDels >= 0 ? "+" : "") + (sumAdds - sumDels).toLocaleString("en-US") });
  if (hasDetails) { addKpi({ key: "totalFiles", label: "Total Files Changed", value: totalFiles }); addKpi({ key: "filesChanged", label: "Files Changed", value: totalFiles }); }
  if (cov.starDeltas && facts.stars?.deltaInWindow !== undefined) {
    addKpi({ key: "starsDelta", label: "Stars Δ", value: facts.stars.deltaInWindow, display: "+" + facts.stars.deltaInWindow, sublabel: "vs last week", ...deltaFields(facts.stars.deltaInWindow, facts.stars.deltaPrevWindow) });
  }
  if (cov.pulls && facts.pulls) {
    addKpi({ key: "pullRequests", label: "Pull Requests", value: facts.pulls.openedInWindow });
    addKpi({ key: "mergedPrs", label: "Merged PRs", value: facts.pulls.mergedInWindow });
  }
  if (cov.issues && facts.issues) addKpi({ key: "openIssues", label: "Open Issues", value: facts.issues.open });

  const activeDays = dayCounts.filter((c) => c > 0).length;
  const avg = totalCommits / 7;
  addKpi({ key: "peakDay", label: "Peak Day", value: peak.commits, sublabel: `${monthDay(peakDateISO)}, ${parseISODate(peakDateISO).y}` });
  addKpi({ key: "dailyAvg", label: "Daily Avg", value: Math.round(avg), display: avg.toFixed(1) });
  addKpi({ key: "activeDays", label: "Active Days", value: activeDays, display: `${activeDays}/7`, sublabel: `${Math.round((activeDays / 7) * 100)}% of week` });
  const reviewed = windowCommits.filter((c) => (c.trailers?.["Reviewed-by"]?.length ?? 0) > 0).length;
  const reviewPct = totalCommits ? Math.round((reviewed / totalCommits) * 100) : 0;
  addKpi({ key: "reviewCoverage", label: "Review Coverage", value: reviewPct, display: `${reviewPct}%`, sublabel: "of commits" });

  // ── adaptive kpi selection (cap 8) ─────────────────────────────
  const KPI_PRIORITY = ["commits", "contributors", "additions", "deletions", "filesChanged", "starsDelta", "pullRequests", "mergedPrs", "openIssues"];
  const order = props.kpiKeys && props.kpiKeys.length ? props.kpiKeys : KPI_PRIORITY;
  const kpis = order.map((k) => pool[k]).filter((k): k is PulseKpi => Boolean(k)).slice(0, 8);

  // ── notable (deterministic score → top N, ties by sha asc) ─────
  const notableItems: NotableCommit[] = windowCommits
    .map((c) => {
      const cls = classify(c.headline);
      const score = 2 * Math.log(1 + (c.additions ?? 0) + (c.deletions ?? 0)) + 0.5 * (c.files?.length ?? 0) + cls.boost;
      return { c, cls, score };
    })
    .sort((a, b) => b.score - a.score || (a.c.sha < b.c.sha ? -1 : 1))
    .slice(0, notableCount)
    .map(({ c, cls }) => {
      const reviewers = [...new Set(c.trailers?.["Reviewed-by"] ?? [])].slice(0, 2);
      const area = topChangedDir(c, areaDepth);
      return {
        kind: cls.kind,
        title: c.headline,
        hash: c.sha,
        author: c.authorName,
        dateISO: c.committedISO.slice(0, 10),
        ...(area ? { area } : {}),
        signal: cls.signal,
        ...(reviewers.length ? { reviewers } : {}),
        // `pr` intentionally omitted — the facts sheet carries no commit→PR mapping.
      };
    });

  // ── rails (fixed key-lists filtered to the available pool) ─────
  const railFrom = (keys: string[]): PulseKpi[] => keys.map((k) => pool[k]).filter((k): k is PulseKpi => Boolean(k));

  return {
    repo: { name: facts.repo.name, fullName: facts.repo.fullName },
    period,
    kpis,
    activity: { days, peak, grid, rail: railFrom(["totalCommits", "peakDay", "dailyAvg", "activeDays"]) },
    contributors: { rows: contribRows, rail: railFrom(["totalCommits", "contributors", "additions", "deletions", "starsDelta"]) },
    changes: { totalFiles, byArea, rail: hasDetails ? railFrom(["totalFiles", "additions", "deletions", "netChanges"]) : railFrom(["totalCommits", "contributors"]) },
    notable: { items: notableItems, rail: railFrom(["mergedPrs", "reviewCoverage", "openIssues", "contributors"]) },
    fin: {
      headline: "THANK YOU!",
      subhead: "ANOTHER WEEK OF PROGRESS.",
      kpiStrip: railFrom(["commits", "contributors", "filesChanged", "starsDelta"]),
      qr: { url: "https://www.m0saic.io", caption: "Make your own — m0saic.io" },
      footer: "Built with m0saic",
    },
  };
}
