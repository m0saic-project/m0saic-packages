/**
 * ============================================================================
 * hero/ffmpeg-pulse — the WeeklyPulse data contract + canonical mock
 * ============================================================================
 *
 * ONE typed {@link WeeklyPulse} object feeds the ENTIRE video. The runner passes
 * it as a direct prop to every beat (Phases 1–3); the Phase-4 GitHub fetcher
 * publishes the SAME shape on `ctx.upstreamData.weeklyPulse` and beats read
 * upstream-first, prop-fallback — so the fetcher is a drop-in.
 *
 * METRICS SCOPE — API-derivable only. Every field here is a cheap GitHub
 * REST/GraphQL read (or a free derivation from one). There are NO mock-only
 * fields: the storyboard's CI-success-rate / review-time / deployments tiles are
 * intentionally dropped because they need Actions/Checks/Deployments APIs +
 * heuristics. See the field-by-field source notes below.
 * ============================================================================
 */

import type { MosaicEngineContext, MosaicTemplateVariableDefinition } from "@m0saic/types";

export type Trend = "up" | "down" | "flat";

/** A KPI / stat tile. `value` is the raw number; `display` overrides the
 *  formatted value (e.g. "7/7", "+87") when compaction isn't wanted. */
export type PulseKpi = {
  /** Stable id (e.g. "commits"). */
  key: string;
  /** Display label (e.g. "Total Commits"). */
  label: string;
  /** Raw value — counts up in animation; formatted via {@link compactNum} unless `display` is set. */
  value: number;
  /** Pre-formatted value override (e.g. "+87", "7/7", "18.1"). */
  display?: string;
  /** Percent change vs. the previous week (signed). */
  deltaPct?: number;
  /** Delta direction → arrow + color. */
  direction?: Trend;
  /** Muted caption (e.g. "vs last week", "May 15"). */
  sublabel?: string;
};

export type PulsePeriod = {
  /** ISO week number. */
  weekNumber: number;
  /** Window start, "YYYY-MM-DD". */
  startISO: string;
  /** Window end, "YYYY-MM-DD". */
  endISO: string;
};

/** A row of the contributors table. */
export type ContributorRow = {
  rank: number;
  login: string;
  name: string;
  /** Avatar image url/path (GitHub `author.avatar_url`); optional in the mock. */
  avatarUrl?: string;
  commits: number;
  additions: number;
  deletions: number;
};

/** A slice of the changes-by-area donut + legend. */
export type AreaSlice = { area: string; files: number; color?: string };

export type CommitKind = "feat" | "fix" | "perf" | "docs" | "test" | "chore";
/** A notable-commits feed row. `kind` drives the colored icon tile; `signal` drives
 *  the left status bar (win/warn/neutral) so maintainers spot risky vs. clean work. */
export type NotableCommit = {
  kind: CommitKind;
  title: string;
  hash: string;
  author: string;
  /** Commit date, "YYYY-MM-DD". */
  dateISO: string;
  /** Associated PR number. API: commit → `/commits/{sha}/pulls`. */
  pr?: number;
  /** Reviewer logins/names. API: PR `/reviews` (state APPROVED/COMMENTED). */
  reviewers?: string[];
  /** Subsystem / package (top-level changed dir). */
  area?: string;
  /** Attention signal: a win, a risky/warn change, or neutral. */
  signal?: "win" | "warn" | "neutral";
};

/**
 * The whole-video data sheet. Field → beat → GitHub source:
 * - `repo` / `period`  — Title pill + every footer.            `GET /repos/{o}/{r}` + the window args.
 * - `kpis`             — Beat 1 KPI grid (flexible count).     counts from `/commits`,`/pulls`,`/issues`,`/repos` (stars); deltas free from multi-week stats.
 * - `activity`         — Beat 2 trend + rail.                  `GET /stats/commit_activity` (daily) — peak/avg/active-days all derived.
 * - `contributors`     — Beat 3 table + rail.                  `GET /stats/contributors` (weekly c/a/d) + `author.avatar_url`.
 * - `changes`          — Beat 4 donut + legend + rail.         per-commit `files[]` / compare API; byArea = group changed paths by top dir.
 * - `notable`          — Beat 5 feed + rail.                   `/commits` in range; `kind` from message prefix.
 * - `fin`              — Fin card.                             reuses the above aggregates.
 */
export type WeeklyPulse = {
  repo: { name: string; fullName: string; logoAssetId?: string };
  period: PulsePeriod;
  kpis: PulseKpi[];
  activity: {
    days: { label: string; commits: number }[];
    peak: { dayLabel: string; dateISO: string; commits: number };
    /** Trailing N-week contribution grid (7 weekday rows × N week cols) for the
     *  heatmap beat. API: `GET /stats/commit_activity` (52 weeks × 7 days) — slice the
     *  trailing N. Last column == this week's `days`. */
    grid: { weekLabels: string[]; rows: { label: string; values: number[] }[] };
    rail: PulseKpi[];
  };
  contributors: { rows: ContributorRow[]; rail: PulseKpi[] };
  changes: { totalFiles: number; byArea: AreaSlice[]; rail: PulseKpi[] };
  notable: { items: NotableCommit[]; rail: PulseKpi[] };
  fin: {
    headline: string;
    subhead: string;
    kpiStrip: PulseKpi[];
    qr: { url: string; caption: string };
    footer: string;
  };
};

// ---------------------------------------------------------------------------
// Derive helpers (deterministic — no wall-clock, no Date() reads of `now`)
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse a "YYYY-MM-DD" string into integer parts (no Date construction). */
function parseISODate(iso: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return { y: 0, m: 1, d: 1 };
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** "2025-05-15" → "May 15". */
export function monthDay(iso: string): string {
  const { m, d } = parseISODate(iso);
  return `${MONTHS[Math.max(0, Math.min(11, m - 1))]} ${d}`;
}

/** Compact a big number: 4500 → "4.5K", 1_234_567 → "1.2M". */
export function compactNum(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return sign + trimOne(abs / 1_000_000) + "M";
  if (abs >= 1_000) return sign + trimOne(abs / 1_000) + "K";
  return String(Math.round(n));
}
function trimOne(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** A KPI's display string: explicit `display` wins, else compacted value. */
export function kpiValue(k: PulseKpi): string {
  return k.display != null && k.display !== "" ? k.display : compactNum(k.value);
}

/** Signed percent: 18 → "+18%", -4.3 → "-4.3%". */
export function signedPct(p: number): string {
  const r = Math.round(p * 10) / 10;
  return (r >= 0 ? "+" : "") + r + "%";
}

/** A KPI's delta string (e.g. "+18%"), or "" when no delta. */
export function kpiDelta(k: PulseKpi): string {
  return k.deltaPct == null ? "" : signedPct(k.deltaPct);
}

/** "May 12 – May 18, 2025  ·  WEEK 20" — the title pill / footer label. */
export function periodLabel(p: PulsePeriod): string {
  const { y } = parseISODate(p.endISO);
  return `${monthDay(p.startISO)} – ${monthDay(p.endISO)}, ${y}`;
}

// ---------------------------------------------------------------------------
// Canonical mock — FFmpeg, Week 20 (May 12–18, 2025)
// ---------------------------------------------------------------------------
// Internally coherent numbers (the storyboard's two KPI sets disagreed; this is
// one consistent week). Every value is shaped like a real fetch result.

const up = (deltaPct: number): Pick<PulseKpi, "deltaPct" | "direction"> => ({ deltaPct, direction: "up" });
const down = (deltaPct: number): Pick<PulseKpi, "deltaPct" | "direction"> => ({ deltaPct, direction: "down" });

export const MOCK_FFMPEG_PULSE: WeeklyPulse = {
  repo: { name: "FFmpeg", fullName: "FFmpeg/FFmpeg" },
  period: { weekNumber: 20, startISO: "2025-05-12", endISO: "2025-05-18" },

  // Beat 1 — KPI overview (8 derivable headline metrics).
  kpis: [
    { key: "commits", label: "Commits", value: 127, ...up(18), sublabel: "vs last week" },
    { key: "pullRequests", label: "Pull Requests", value: 34, ...up(8.7), sublabel: "vs last week" },
    { key: "mergedPrs", label: "Merged PRs", value: 28, ...up(9.1), sublabel: "vs last week" },
    { key: "openIssues", label: "Open Issues", value: 156, ...down(4.3), sublabel: "vs last week" },
    { key: "contributors", label: "Contributors", value: 19, ...up(26), sublabel: "vs last week" },
    { key: "additions", label: "Additions", value: 18463, ...up(22), sublabel: "vs last week" },
    { key: "deletions", label: "Deletions", value: 9731, ...up(8), sublabel: "vs last week" },
    { key: "stars", label: "Stars Δ", value: 87, display: "+87", ...up(9), sublabel: "vs last week" },
  ],

  // Beat 2 — activity trend (Mon–Sun = 127 commits, peak Thu).
  activity: {
    days: [
      { label: "Mon", commits: 12 },
      { label: "Tue", commits: 18 },
      { label: "Wed", commits: 21 },
      { label: "Thu", commits: 35 },
      { label: "Fri", commits: 22 },
      { label: "Sat", commits: 11 },
      { label: "Sun", commits: 8 },
    ],
    peak: { dayLabel: "Thu", dateISO: "2025-05-15", commits: 35 },
    // Trailing 8-week heatmap grid (W13→W20); last column == this week's `days` above.
    grid: {
      weekLabels: ["W13", "W14", "W15", "W16", "W17", "W18", "W19", "W20"],
      rows: [
        { label: "Mon", values: [10, 14, 8, 16, 11, 13, 9, 12] },
        { label: "Tue", values: [16, 20, 15, 22, 18, 19, 14, 18] },
        { label: "Wed", values: [19, 24, 17, 26, 20, 23, 16, 21] },
        { label: "Thu", values: [28, 33, 25, 38, 30, 34, 24, 35] },
        { label: "Fri", values: [18, 22, 16, 25, 19, 24, 17, 22] },
        { label: "Sat", values: [8, 12, 6, 14, 9, 13, 7, 11] },
        { label: "Sun", values: [5, 8, 4, 10, 6, 9, 5, 8] },
      ],
    },
    rail: [
      { key: "totalCommits", label: "Total Commits", value: 127, ...up(18), sublabel: "vs last week" },
      { key: "peakDay", label: "Peak Day", value: 35, sublabel: "May 15, 2025" },
      { key: "dailyAvg", label: "Daily Avg", value: 18, display: "18.1", ...up(12), sublabel: "vs last week" },
      { key: "activeDays", label: "Active Days", value: 7, display: "7/7", sublabel: "100% of week" },
    ],
  },

  // Beat 3 — top contributors (weekly commits / additions / deletions).
  contributors: {
    rows: [
      { rank: 1, login: "akhirnov", name: "Anton Khirnov", commits: 23, additions: 4512, deletions: 2103 },
      { rank: 2, login: "michaelni", name: "Michael Niedermayer", commits: 18, additions: 3204, deletions: 1034 },
      { rank: 3, login: "jamrial", name: "James Almer", commits: 14, additions: 2193, deletions: 812 },
      { rank: 4, login: "cus", name: "Marton Balint", commits: 11, additions: 1842, deletions: 1201 },
      { rank: 5, login: "lance-lmwang", name: "Limin Wang", commits: 9, additions: 1503, deletions: 623 },
    ],
    rail: [
      { key: "totalCommits", label: "Total Commits", value: 127, ...up(18), sublabel: "vs last week" },
      { key: "contributors", label: "Total Contributors", value: 19, ...up(26), sublabel: "vs last week" },
      { key: "additions", label: "Additions", value: 18463, ...up(22), sublabel: "vs last week" },
      { key: "deletions", label: "Deletions", value: 9731, ...up(8), sublabel: "vs last week" },
      { key: "stars", label: "Stars Δ", value: 87, display: "+87", ...up(9), sublabel: "vs last week" },
    ],
  },

  // Beat 4 — changes by area (files sum to totalFiles).
  changes: {
    totalFiles: 842,
    byArea: [
      { area: "libavcodec", files: 286, color: PULSE_AREA(0) },
      { area: "libavformat", files: 185, color: PULSE_AREA(1) },
      { area: "libavfilter", files: 126, color: PULSE_AREA(2) },
      { area: "doc", files: 84, color: PULSE_AREA(3) },
      { area: "tests", files: 67, color: PULSE_AREA(4) },
      { area: "tools", files: 50, color: PULSE_AREA(5) },
      { area: "other", files: 44, color: PULSE_AREA(5) },
    ],
    rail: [
      { key: "totalFiles", label: "Total Files Changed", value: 842, ...up(14), sublabel: "vs last week" },
      { key: "additions", label: "Additions", value: 18463, ...up(22), sublabel: "vs last week" },
      { key: "deletions", label: "Deletions", value: 9731, ...up(8), sublabel: "vs last week" },
      { key: "netChanges", label: "Net Changes", value: 8732, display: "+8,732", ...up(16), sublabel: "vs last week" },
    ],
  },

  // Beat 5 — notable commits (message-prefix kind).
  notable: {
    items: [
      { kind: "perf", area: "avcodec", title: "avcodec: improve AV1 decode performance", hash: "a1b2c3d", author: "Anton Khirnov", dateISO: "2025-05-15", pr: 14201, reviewers: ["James Almer", "Michael Niedermayer"], signal: "warn" },
      { kind: "feat", area: "avformat", title: "avformat: add support for new container", hash: "d4e5f6g", author: "James Almer", dateISO: "2025-05-14", pr: 14198, reviewers: ["Anton Khirnov"], signal: "neutral" },
      { kind: "fix", area: "avfilter", title: "avfilter: fix memory leak in overlay filter", hash: "h7i8j9k", author: "Marton Balint", dateISO: "2025-05-13", pr: 14185, reviewers: ["Anton Khirnov", "Limin Wang"], signal: "win" },
      { kind: "docs", area: "doc", title: "doc: update HLS documentation", hash: "l0m1n2o", author: "Limin Wang", dateISO: "2025-05-12", pr: 14180, reviewers: ["Marton Balint"], signal: "neutral" },
      { kind: "test", area: "tests", title: "tests: add FATE test for edge case", hash: "p3q4r5s", author: "Michael Niedermayer", dateISO: "2025-05-16", pr: 14205, reviewers: ["James Almer"], signal: "win" },
    ],
    rail: [
      { key: "mergedPrs", label: "Merged PRs", value: 31, ...up(18), sublabel: "vs last week" },
      { key: "reviewCoverage", label: "Review Coverage", value: 92, display: "92%", sublabel: "of merged PRs" },
      { key: "openIssues", label: "Open Issues", value: 47, ...up(6), sublabel: "vs last week" },
      { key: "contributors", label: "Contributors", value: 19, ...up(26), sublabel: "vs last week" },
    ],
  },

  // Fin.
  fin: {
    headline: "THANK YOU!",
    subhead: "ANOTHER WEEK OF PROGRESS.",
    kpiStrip: [
      { key: "commits", label: "Commits", value: 127, ...up(18), sublabel: "vs last week" },
      { key: "contributors", label: "Contributors", value: 19, ...up(26), sublabel: "vs last week" },
      { key: "filesChanged", label: "Files Changed", value: 842, ...up(14), sublabel: "vs last week" },
      { key: "stars", label: "Stars Δ", value: 87, display: "+87", ...up(9), sublabel: "vs last week" },
    ],
    qr: { url: "https://www.m0saic.io", caption: "Make your own — m0saic.io" },
    footer: "Built with m0saic",
  },
};

// Area color lookup kept tiny + local (avoids importing the theme into the data
// sheet — the data stays render-agnostic; the chrome can re-color if it wants).
// Exported so the weekly-pulse-adapter colors its derived changes-by-area donut
// from the same ramp (F5 Seam C).
export function PULSE_AREA(i: number): string {
  const ramp = ["#2ea043", "#238636", "#3fb950", "#d29922", "#8957e5", "#6e7681"];
  return ramp[i % ramp.length];
}

// ---------------------------------------------------------------------------
// Upstream-first resolution (F5 Seam D)
// ---------------------------------------------------------------------------

/**
 * The single pulse-resolution rule for every beat + the runner: upstream data
 * (published by `@m0saic/github/weekly-pulse-adapter/v1` under the alias
 * `weeklyPulse`) wins, then the direct prop, then the canonical mock. So a beat
 * renders standalone on the mock, takes an explicit `pulse` prop when given one,
 * and becomes a drop-in live consumer when wired behind the adapter — no code
 * change at the call site beyond this one helper.
 */
export function resolvePulse(
  propsPulse: WeeklyPulse | undefined,
  ctx: MosaicEngineContext,
): WeeklyPulse {
  return (ctx.upstreamData?.weeklyPulse as WeeklyPulse | undefined) ?? propsPulse ?? MOCK_FFMPEG_PULSE;
}

/**
 * The OPTIONAL `weeklyPulse` upstream block every beat + the runner declares.
 * All keys are `required: false`, so a beat stays standalone-renderable on the
 * mock (absent block → no diagnostic) while a PRESENT-but-drifted block still
 * fails loudly at resolve time (`VARIABLES_SCHEMA_MISMATCH`, per F1).
 */
export const WEEKLY_PULSE_UPSTREAM_SCHEMA: Partial<
  Record<string, { description?: string; variables: Partial<Record<string, MosaicTemplateVariableDefinition>> }>
> = {
  weeklyPulse: {
    description:
      "Optional WeeklyPulse sheet from @m0saic/github/weekly-pulse-adapter/v1. Absent → the beat renders on its mock; present-but-drifted → resolve-time VARIABLES_SCHEMA_MISMATCH.",
    variables: {
      repo: { type: "object", required: false },
      period: { type: "object", required: false },
      kpis: { type: "any", required: false },
      activity: { type: "object", required: false },
      contributors: { type: "object", required: false },
      changes: { type: "object", required: false },
      notable: { type: "object", required: false },
      fin: { type: "object", required: false },
    },
  },
};
