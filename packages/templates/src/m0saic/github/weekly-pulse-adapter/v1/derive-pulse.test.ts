// covers: weekly-pulse-adapter derive-pulse — the pure GithubRepoFacts →
// WeeklyPulse derivation. Full-coverage + degraded sheet snapshots (founder
// review) plus targeted Seam-C invariants: grid-last-col == days, adaptive KPI
// selection, delta omission on zero base, notable determinism, message-prefix
// fallback, contributor tie-break.
import { deriveWeeklyPulse } from "./derive-pulse";
import { SAMPLE_FACTS } from "../../repo-facts-fetcher/v1/sample-facts";
import { isoWeekNumber } from "../../week-math";
import type { GithubRepoFacts } from "../../repo-facts-fetcher/v1/facts";

/** Anonymous/degraded variant: no commit detail, no code-freq, no star deltas, no PR/issue. */
function degraded(base: GithubRepoFacts): GithubRepoFacts {
  return {
    ...base,
    commits: base.commits.map(({ additions, deletions, files, ...rest }) => rest),
    weeklyCodeFrequency: undefined,
    stars: { total: base.stars?.total ?? 0 },
    pulls: undefined,
    issues: undefined,
    coverage: { ...base.coverage, commitDetails: "none", pulls: false, issues: false, starDeltas: false },
  };
}

/** Mirror variant: has_issues false, no PR/issue data (like FFmpeg). */
function mirror(base: GithubRepoFacts): GithubRepoFacts {
  return {
    ...base,
    repo: { ...base.repo, hasIssues: false },
    pulls: undefined,
    issues: undefined,
    coverage: { ...base.coverage, pulls: false, issues: false },
  };
}

const keys = (kpis: { key: string }[]) => kpis.map((k) => k.key);

describe("deriveWeeklyPulse — full coverage (SAMPLE_FACTS)", () => {
  const pulse = deriveWeeklyPulse(SAMPLE_FACTS);

  it("matches the reviewed full-coverage sheet snapshot", () => {
    expect(pulse).toMatchSnapshot();
  });

  it("period.weekNumber is the ISO week of the window start", () => {
    expect(pulse.period.weekNumber).toBe(isoWeekNumber("2026-06-01"));
  });

  it("activity.peak is the max day, ties → earliest (Wed, 3 commits)", () => {
    expect(pulse.activity.peak).toEqual({ dayLabel: "Wed", dateISO: "2026-06-03", commits: 3 });
  });

  it("grid last column equals activity.days (the window week)", () => {
    pulse.activity.grid.rows.forEach((row, r) => {
      expect(row.values[row.values.length - 1]).toBe(pulse.activity.days[r].commits);
    });
  });

  it("adaptive KPIs: cap 8, PR/issue included, openIssues dropped past the cap", () => {
    expect(pulse.kpis.length).toBe(8);
    expect(keys(pulse.kpis)).toEqual([
      "commits", "contributors", "additions", "deletions", "filesChanged", "starsDelta", "pullRequests", "mergedPrs",
    ]);
  });

  it("contributors: all tied on commits (2 each) → ordered by additions desc", () => {
    // ada 192, grace 120, alan 350, katherine 152 → alan, ada, katherine, grace
    expect(pulse.contributors.rows.map((r) => r.login)).toEqual(["alan", "ada", "katherine", "grace"]);
    expect(pulse.contributors.rows[0]).toMatchObject({ rank: 1, login: "alan", commits: 2, additions: 350 });
  });

  it("changes: distinct-path areas, api (2 files) leads, totalFiles = 8", () => {
    expect(pulse.changes.totalFiles).toBe(8);
    expect(pulse.changes.byArea[0]).toMatchObject({ area: "api", files: 2 });
    expect(pulse.changes.byArea.every((s) => typeof s.color === "string")).toBe(true);
  });

  it("notable: deterministic, top-5, the SIMD/perf commit wins", () => {
    const again = deriveWeeklyPulse(SAMPLE_FACTS);
    expect(pulse.notable.items).toEqual(again.notable.items);
    expect(pulse.notable.items.length).toBe(5);
    expect(pulse.notable.items[0]).toMatchObject({ hash: "c0ffee01", kind: "perf", signal: "win" });
    expect(pulse.notable.items[0].reviewers).toEqual(["Grace Hopper"]);
    expect(pulse.notable.items[0].pr).toBeUndefined();
  });

  it("KPIs carry deltas (non-zero prev base present in the trailing weeks)", () => {
    const commits = pulse.kpis.find((k) => k.key === "commits");
    expect(commits?.direction).toBeDefined();
    expect(typeof commits?.deltaPct).toBe("number"); // prev week = 5 commits
  });
});

describe("deriveWeeklyPulse — degraded (anonymous, commitDetails:none)", () => {
  const pulse = deriveWeeklyPulse(degraded(SAMPLE_FACTS));

  it("matches the reviewed degraded sheet snapshot", () => {
    expect(pulse).toMatchSnapshot();
  });

  it("KPIs drop additions/deletions/filesChanged/starsDelta/PR/issue", () => {
    expect(keys(pulse.kpis)).toEqual(["commits", "contributors"]);
  });

  it("changes donut is commit-basis (totalFiles = window commit count) via message prefix", () => {
    expect(pulse.changes.totalFiles).toBe(SAMPLE_FACTS.commits.length); // 8 commits, not files
    // prefixes: core, io, api, render, tests, cli, docs — all commit-count 1 except core (2)
    expect(pulse.changes.byArea.find((s) => s.area === "core")?.files).toBe(2);
    expect(pulse.changes.rail[0].label).toBe("Total Commits"); // rail label switches to commits
  });

  it("contributor add/del are 0 without detail", () => {
    expect(pulse.contributors.rows.every((r) => r.additions === 0 && r.deletions === 0)).toBe(true);
  });

  it("notable area falls back to the message prefix", () => {
    const simd = pulse.notable.items.find((i) => i.hash === "c0ffee01");
    expect(simd?.area).toBe("core");
  });
});

describe("deriveWeeklyPulse — coverage-driven selection", () => {
  it("mirror repo (hasIssues false) emits NO PR/issue KPIs", () => {
    const pulse = deriveWeeklyPulse(mirror(SAMPLE_FACTS));
    expect(keys(pulse.kpis)).not.toContain("pullRequests");
    expect(keys(pulse.kpis)).not.toContain("mergedPrs");
    expect(keys(pulse.kpis)).not.toContain("openIssues");
    expect(keys(pulse.kpis)).toEqual(["commits", "contributors", "additions", "deletions", "filesChanged", "starsDelta"]);
  });

  it("omits deltaPct + direction when the previous-window base is unknown (empty trailing)", () => {
    const noTrailing: GithubRepoFacts = { ...SAMPLE_FACTS, trailing8WeekCommitsLite: [] };
    const commits = deriveWeeklyPulse(noTrailing).kpis.find((k) => k.key === "commits");
    expect(commits?.deltaPct).toBeUndefined();
    expect(commits?.direction).toBeUndefined();
  });

  it("respects an explicit kpiKeys override (order + selection)", () => {
    const pulse = deriveWeeklyPulse(SAMPLE_FACTS, { kpiKeys: ["starsDelta", "commits"] });
    expect(keys(pulse.kpis)).toEqual(["starsDelta", "commits"]);
  });
});
